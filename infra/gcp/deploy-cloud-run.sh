#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
ENV_FILE="$ROOT_DIR/infra/gcp/cloud-run.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "Copy infra/gcp/cloud-run.env.example to infra/gcp/cloud-run.env and fill values."
  exit 1
fi

# shellcheck disable=SC1090
. "$ENV_FILE"

required_vars="
GCP_PROJECT_ID
GCP_REGION
GCP_AR_REPOSITORY
GCP_BACKEND_SERVICE
GCP_FRONTEND_SERVICE
GCP_CLOUD_SQL_INSTANCE
GCP_BACKEND_SERVICE_ACCOUNT
GCP_FRONTEND_SERVICE_ACCOUNT
"

for name in $required_vars; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Missing required variable: $name"
    exit 1
  fi
done

DATABASE_URL_SECRET_NAME="${DATABASE_URL_SECRET_NAME:-DATABASE_URL}"
JWT_SECRET_NAME="${JWT_SECRET_NAME:-JWT_SECRET}"
DEVICE_API_SECRET_NAME="${DEVICE_API_SECRET_NAME:-DEVICE_API_SECRET}"
BACKEND_CPU="${BACKEND_CPU:-1}"
BACKEND_MEMORY="${BACKEND_MEMORY:-1Gi}"
BACKEND_MIN_INSTANCES="${BACKEND_MIN_INSTANCES:-0}"
BACKEND_MAX_INSTANCES="${BACKEND_MAX_INSTANCES:-3}"
FRONTEND_CPU="${FRONTEND_CPU:-1}"
FRONTEND_MEMORY="${FRONTEND_MEMORY:-512Mi}"
FRONTEND_MIN_INSTANCES="${FRONTEND_MIN_INSTANCES:-0}"
FRONTEND_MAX_INSTANCES="${FRONTEND_MAX_INSTANCES:-3}"

AR_HOST="${GCP_REGION}-docker.pkg.dev"
BACKEND_IMAGE="${AR_HOST}/${GCP_PROJECT_ID}/${GCP_AR_REPOSITORY}/telemed-backend:manual-$(date +%Y%m%d%H%M%S)"
FRONTEND_IMAGE="${AR_HOST}/${GCP_PROJECT_ID}/${GCP_AR_REPOSITORY}/telemed-frontend:manual-$(date +%Y%m%d%H%M%S)"

echo "Configuring Docker auth for $AR_HOST..."
gcloud auth configure-docker "$AR_HOST" --quiet

echo "Building and pushing backend image..."
docker build -t "$BACKEND_IMAGE" "$ROOT_DIR/backend"
docker push "$BACKEND_IMAGE"

origin="${FRONTEND_BASE_URL:-https://placeholder.invalid}"
secret_bindings="DATABASE_URL=${DATABASE_URL_SECRET_NAME}:latest,JWT_SECRET=${JWT_SECRET_NAME}:latest,DEVICE_API_SECRET=${DEVICE_API_SECRET_NAME}:latest"
if [ -n "${NOVU_API_KEY_SECRET_NAME:-}" ]; then
  secret_bindings="${secret_bindings},NOVU_API_KEY=${NOVU_API_KEY_SECRET_NAME}:latest"
fi

echo "Deploying backend..."
gcloud run deploy "$GCP_BACKEND_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --platform managed \
  --image "$BACKEND_IMAGE" \
  --port 8000 \
  --service-account "$GCP_BACKEND_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$GCP_CLOUD_SQL_INSTANCE" \
  --cpu "$BACKEND_CPU" \
  --memory "$BACKEND_MEMORY" \
  --min-instances "$BACKEND_MIN_INSTANCES" \
  --max-instances "$BACKEND_MAX_INSTANCES" \
  --set-env-vars "JWT_EXPIRES_IN=3600" \
  --set-env-vars "AUTH_COOKIE_SECURE=true" \
  --set-env-vars "RUN_MIGRATIONS_ON_STARTUP=false" \
  --set-env-vars "RUN_SEED_ON_STARTUP=false" \
  --set-env-vars "FRONTEND_BASE_URL=${origin}" \
  --set-env-vars "CORS_ORIGINS=${origin}" \
  --set-secrets "$secret_bindings"

backend_url=$(gcloud run services describe "$GCP_BACKEND_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='value(status.url)')
if [ -z "$backend_url" ]; then
  echo "Cannot resolve backend URL."
  exit 1
fi

echo "Building and pushing frontend image..."
docker build \
  -t "$FRONTEND_IMAGE" \
  --build-arg NEXT_PUBLIC_API_BASE_URL=/api \
  --build-arg NEXT_SERVER_API_PROXY_TARGET="$backend_url" \
  --build-arg NEXT_SERVER_API_BASE_URL="$backend_url" \
  "$ROOT_DIR/frontend"
docker push "$FRONTEND_IMAGE"

echo "Deploying frontend..."
gcloud run deploy "$GCP_FRONTEND_SERVICE" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --platform managed \
  --image "$FRONTEND_IMAGE" \
  --port 3000 \
  --service-account "$GCP_FRONTEND_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --cpu "$FRONTEND_CPU" \
  --memory "$FRONTEND_MEMORY" \
  --min-instances "$FRONTEND_MIN_INSTANCES" \
  --max-instances "$FRONTEND_MAX_INSTANCES" \
  --set-env-vars "NEXT_PUBLIC_API_BASE_URL=/api" \
  --set-env-vars "NEXT_SERVER_API_PROXY_TARGET=${backend_url}" \
  --set-env-vars "NEXT_SERVER_API_BASE_URL=${backend_url}"

frontend_url=$(gcloud run services describe "$GCP_FRONTEND_SERVICE" --project "$GCP_PROJECT_ID" --region "$GCP_REGION" --format='value(status.url)')
if [ -n "$frontend_url" ] && [ -z "${FRONTEND_BASE_URL:-}" ]; then
  echo "Syncing backend CORS to frontend URL..."
  gcloud run services update "$GCP_BACKEND_SERVICE" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --update-env-vars "FRONTEND_BASE_URL=${frontend_url},CORS_ORIGINS=${frontend_url}"
fi

echo "Backend URL: $backend_url"
echo "Frontend URL: $frontend_url"
