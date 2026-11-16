FROM node:24-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright HOST=0.0.0.0
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./worker/
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && cd worker && npm ci --omit=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY worker/core.mjs worker/explorer.mjs ./worker/
COPY service ./service/
RUN mkdir -p /data && chown -R node:node /app /data /ms-playwright
EXPOSE 8787
ENTRYPOINT ["/bin/sh", "/app/service/entrypoint.sh"]
