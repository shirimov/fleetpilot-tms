# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
ARG APP_COMMIT_SHA=unknown
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
ENV DATABASE_URL=postgresql://fleetpilot:build-only@localhost:5432/fleetpilot?schema=public
ENV AUTH_SECRET=fleetpilot-build-only-secret-not-for-runtime
COPY . .
RUN npx prisma generate
RUN npm run build

FROM builder AS migrator
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
ARG APP_COMMIT_SHA=unknown
ENV NODE_ENV=production
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 fleetpilot \
    && useradd --system --uid 1001 --gid fleetpilot fleetpilot
COPY --from=builder --chown=fleetpilot:fleetpilot /app/public ./public
COPY --from=builder --chown=fleetpilot:fleetpilot /app/.next/standalone ./
COPY --from=builder --chown=fleetpilot:fleetpilot /app/.next/static ./.next/static
USER fleetpilot
EXPOSE 3000
CMD ["node", "server.js"]
