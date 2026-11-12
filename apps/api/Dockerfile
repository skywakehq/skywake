# The Skywake API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t skywake-api .

# The engine, compiled for Node.
FROM rust:1.99-bookworm AS engine
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY vendor vendor
COPY bindings/node bindings/node
COPY benchmarks benchmarks
COPY sdks/rust sdks/rust
RUN cargo build --release --locked -p skywake-node

FROM node:22-bookworm-slim
# The engine's S3 client needs the system's CA certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /skywake
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config packages/config
COPY packages/env packages/env
COPY packages/contract packages/contract
COPY bindings/node bindings/node
COPY apps/api apps/api
COPY --from=engine /src/target/release/libskywake_node.so bindings/node/engine.node
RUN pnpm install --frozen-lockfile --prod --filter @skywake/api...

ENV NODE_ENV=production SKYWAKE_API_LISTEN=0.0.0.0:8080
USER node
WORKDIR /skywake/apps/api
EXPOSE 8080
CMD ["node", "src/main.ts"]
