# The host resolves this public Node20 reference to a digest before building.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS acceptance
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/opt/playwright PLAYWRIGHT=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
ARG APP_COMMIT_SHA
ENV APP_COMMIT_SHA=${APP_COMMIT_SHA}
ENV DATABASE_URL=postgresql://acceptance:build-only@127.0.0.1:5432/acceptance?schema=public
ENV AUTH_SECRET=disposable-build-only-not-runtime
COPY --chown=node:node . .
RUN node node_modules/prisma/build/index.js generate
RUN npm run build
# Existing locked Playwright, not npx installation or a new dependency.
RUN node node_modules/playwright/cli.js install --with-deps chromium \
    && chmod -R a+rX /opt/playwright
# Keep storage ancestry trusted even if COPY inherits checkout directory modes.
RUN chown root:root /app && chmod 0755 /app \
    && install -d -o node -g node -m 0700 /app/private-files
ENV NODE_ENV=production
USER node
CMD ["/bin/sleep", "600"]
