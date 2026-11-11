FROM node:24-bookworm-slim

WORKDIR /app

COPY . .

# Railway exposes the triggering Git commit during image builds. DSH uses this
# value for client build metadata and otherwise tries `git rev-parse HEAD`.
ARG RAILWAY_GIT_COMMIT_SHA=0000000
ENV DSH_CLIENT_COMMIT_HASH=$RAILWAY_GIT_COMMIT_SHA

RUN corepack enable && pnpm install --frozen-lockfile && pnpm run build

ENV DSH_HOME=/data

RUN mkdir /data

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "/app/scripts/railway-start.sh"]
