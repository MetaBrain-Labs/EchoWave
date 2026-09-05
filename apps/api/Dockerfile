# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm --filter @echowave/contracts build \
  && pnpm --filter @echowave/api build \
  && pnpm --filter @echowave/api deploy --prod --legacy /opt/echowave-api

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /opt/echowave-api/ ./
RUN mkdir -p /app/.data/audio /app/.data/secrets /app/.tmp \
  && chown -R node:node /app/.data /app/.tmp

USER node
EXPOSE 3001

CMD ["node", "dist/bootstrap/server.js"]
