# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
COPY schema ./schema
COPY specs ./specs
COPY tsconfig.json ./

RUN npm ci \
  && npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg gosu tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    VERA_HOST=0.0.0.0 \
    VERA_PORT=4173 \
    VERA_DATABASE=/data/vera.sqlite \
    VERA_OBJECTS=/data/objects \
    VERA_WEB_ROOT=packages/web/dist

COPY --from=build /app /app
COPY scripts/container-entrypoint.sh /usr/local/bin/vera-entrypoint
RUN chmod 0755 /usr/local/bin/vera-entrypoint \
  && mkdir -p /data \
  && chown node:node /data

VOLUME ["/data"]
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:4173/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/vera-entrypoint"]
CMD ["node", "packages/server/src/main.ts"]
