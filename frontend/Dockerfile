# Dependencies stage
FROM oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build stage
FROM oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981 AS builder
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
FROM node:24-alpine@sha256:01743339035a5c3c11a373cd7c83aeab6ed1457b55da6a69e014a95ac4e4700b AS runner
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
