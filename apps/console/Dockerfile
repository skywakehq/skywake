# The Skywake console. Build from the repository root:
#   docker build -f apps/console/Dockerfile -t skywake-console .
# The base path is fixed at build time: the root by default, or
#   --build-arg CONSOLE_BASE_PATH=/dashboard  to share a host with the site.

FROM node:25-bookworm-slim AS build
RUN corepack enable
WORKDIR /skywake
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config packages/config
COPY packages/email packages/email
COPY packages/env packages/env
COPY packages/ui packages/ui
COPY apps/console apps/console
RUN pnpm install --frozen-lockfile --filter @skywake/console...
ARG CONSOLE_BASE_PATH=
RUN pnpm --filter @skywake/console build

# Next's standalone output: the server and only the packages it uses.
FROM node:25-bookworm-slim
WORKDIR /skywake
COPY --from=build /skywake/apps/console/.next/standalone ./
COPY --from=build /skywake/apps/console/.next/static apps/console/.next/static

ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3100
USER node
EXPOSE 3100
CMD ["node", "apps/console/server.js"]
