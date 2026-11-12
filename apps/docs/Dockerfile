# The Skywake docs. Build from the repository root:
#   docker build -f apps/docs/Dockerfile -t skywake-docs .
# The base path is fixed at build time: `/docs` by default, or
#   --build-arg DOCS_BASE_PATH=  for the root of a host of their own.

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /skywake
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config packages/config
COPY packages/env packages/env
COPY packages/contract packages/contract
COPY packages/ui packages/ui
COPY apps/docs apps/docs
RUN pnpm install --frozen-lockfile --filter @skywake/docs...
ARG DOCS_BASE_PATH=/docs
ARG DOCS_ASSET_PREFIX
RUN pnpm --filter @skywake/docs build

# Next's standalone output: the server and only the packages it uses.
FROM node:22-bookworm-slim
WORKDIR /skywake
COPY --from=build /skywake/apps/docs/.next/standalone ./
COPY --from=build /skywake/apps/docs/.next/static apps/docs/.next/static

ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3200
USER node
EXPOSE 3200
CMD ["node", "apps/docs/server.js"]
