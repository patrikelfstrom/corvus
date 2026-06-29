FROM oven/bun:1.2 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN bun build scripts/cli.ts --target=bun --outfile=/tmp/corvus

FROM oven/bun:1.2-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/app/data
ENV CONFIG_PATH=/app/data
ENV LOG_FILE_PATH=/app/data/app.log
ENV SYNC_CRON="0 0 * * *"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=bun:bun /app/.output ./.output
COPY --from=build --chown=bun:bun /app/public ./public
COPY --from=build --chown=bun:bun /tmp/corvus /usr/local/bin/corvus

RUN chmod +x /usr/local/bin/corvus \
  && mkdir -p /app/data \
  && chown -R bun:bun /app

USER bun

EXPOSE 3000

CMD ["bun", ".output/server/index.mjs"]
