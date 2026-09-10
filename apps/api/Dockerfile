# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

ARG NPM_REGISTRY=https://registry.npmjs.org

ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
ENV ONNXRUNTIME_NODE_INSTALL=skip

RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm config set registry "$NPM_REGISTRY" \
  && pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts

RUN pnpm --filter @echowave/contracts build \
  && pnpm --filter @echowave/api build \
  && pnpm --filter @echowave/api deploy --prod --legacy /opt/echowave-api


FROM node:24-bookworm-slim AS runtime

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security

RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       ffmpeg \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build --chown=node:node /opt/echowave-api/ ./

RUN mkdir -p /app/.data/audio /app/.data/secrets /app/.tmp \
  && chown -R node:node /app/.data /app/.tmp

USER node

EXPOSE 3001

CMD ["node", "dist/bootstrap/server.js"]
