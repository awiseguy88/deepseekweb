FROM node:24-bookworm-slim

WORKDIR /app

COPY . .

RUN corepack enable && pnpm install --frozen-lockfile && pnpm run build

ENV DSH_HOME=/data

RUN mkdir /data

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "/app/scripts/railway-start.sh"]
