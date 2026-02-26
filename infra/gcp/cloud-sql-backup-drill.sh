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

if [ -z "${GCP_PROJECT_ID:-}" ] || [ -z "${GCP_CLOUD_SQL_INSTANCE:-}" ]; then
  echo "Missing GCP_PROJECT_ID or GCP_CLOUD_SQL_INSTANCE in $ENV_FILE"
  exit 1
fi

execute=false
cleanup=false
for arg in "$@"; do
  case "$arg" in
    --execute) execute=true ;;
    --cleanup) cleanup=true ;;
    *)
      echo "Unknown flag: $arg"
      echo "Usage: $0 [--execute] [--cleanup]"
      exit 1
      ;;
  esac
done

instance_name=$(printf "%s" "$GCP_CLOUD_SQL_INSTANCE" | awk -F: '{print $NF}')
if [ -z "$instance_name" ]; then
  echo "Cannot parse instance name from GCP_CLOUD_SQL_INSTANCE=$GCP_CLOUD_SQL_INSTANCE"
  exit 1
fi

timestamp=$(date +%Y%m%d%H%M%S)
clone_name="${CLOUD_SQL_DRILL_CLONE_NAME:-${instance_name}-drill-${timestamp}}"

echo "Project: $GCP_PROJECT_ID"
echo "Source instance: $instance_name"
echo "Clone instance: $clone_name"

echo ""
echo "Planned commands:"
echo "1) gcloud sql backups create --project \"$GCP_PROJECT_ID\" --instance \"$instance_name\" --description \"drill-$timestamp\" --quiet"
echo "2) gcloud sql backups list --project \"$GCP_PROJECT_ID\" --instance \"$instance_name\" --limit 1 --sort-by=\"~endTime\""
echo "3) gcloud sql instances clone \"$instance_name\" \"$clone_name\" --project \"$GCP_PROJECT_ID\" --quiet"
echo "4) gcloud sql instances describe \"$clone_name\" --project \"$GCP_PROJECT_ID\""
if [ "$cleanup" = true ]; then
  echo "5) gcloud sql instances delete \"$clone_name\" --project \"$GCP_PROJECT_ID\" --quiet"
fi

if [ "$execute" != true ]; then
  echo ""
  echo "Dry run only. Re-run with --execute to run drill."
  exit 0
fi

echo ""
echo "Running backup creation..."
gcloud sql backups create \
  --project "$GCP_PROJECT_ID" \
  --instance "$instance_name" \
  --description "drill-$timestamp" \
  --quiet

echo "Latest backup:"
gcloud sql backups list \
  --project "$GCP_PROJECT_ID" \
  --instance "$instance_name" \
  --limit 1 \
  --sort-by="~endTime"

echo "Creating clone instance for restore verification..."
gcloud sql instances clone \
  "$instance_name" \
  "$clone_name" \
  --project "$GCP_PROJECT_ID" \
  --quiet

echo "Clone instance details:"
gcloud sql instances describe "$clone_name" --project "$GCP_PROJECT_ID" --format="value(state,region,databaseVersion)"

if [ "$cleanup" = true ]; then
  echo "Cleaning up clone instance..."
  gcloud sql instances delete "$clone_name" --project "$GCP_PROJECT_ID" --quiet
fi

echo "Backup/restore drill completed."
