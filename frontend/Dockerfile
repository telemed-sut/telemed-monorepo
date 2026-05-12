# Dependencies stage
FROM oven/bun:1.3.13-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349 AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build stage
FROM oven/bun:1.3.13-alpine@sha256:4de475389889577f346c636f956b42a5c31501b654664e9ae5726f94d7bb5349 AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_SERVER_API_PROXY_TARGET=http://backend:8000
ARG NEXT_SERVER_API_BASE_URL=http://backend:8000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
  NEXT_SERVER_API_PROXY_TARGET=${NEXT_SERVER_API_PROXY_TARGET} \
  NEXT_SERVER_API_BASE_URL=${NEXT_SERVER_API_BASE_URL}
RUN bun run build

# Production stage
FROM node:26-alpine@sha256:e71ac5e964b9201072425d59d2e876359efa25dc96bb1768cb73295728d6e4ea AS runner
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 \
  NEXT_SERVER_API_PROXY_TARGET=http://backend:8000 \
  NEXT_SERVER_API_BASE_URL=http://backend:8000

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs && \
  mkdir .next && chown nextjs:nodejs .next

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --input-type=module -e "try { const response = await fetch('http://127.0.0.1:3000/health', { cache: 'no-store' }); if (!response.ok) process.exit(1); } catch { process.exit(1); }"

CMD ["node", "server.js"]
