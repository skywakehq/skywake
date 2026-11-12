# A node of the shared chunk cache. Build from the repository root:
#   docker build -f crates/cache/Dockerfile -t skywake-cache .
FROM rust:1.92-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY vendor vendor
COPY bindings/node bindings/node
COPY benchmarks benchmarks
COPY sdks/rust sdks/rust
RUN cargo build --release --locked -p skywake-cache

FROM debian:bookworm-slim
# The S3 client needs the system's CA certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/skywake-cache /usr/local/bin/skywake-cache
ENV SKYWAKE_CACHE_LISTEN=0.0.0.0:7070 SKYWAKE_CACHE_DIR=/cache
USER nobody
EXPOSE 7070
CMD ["skywake-cache"]
