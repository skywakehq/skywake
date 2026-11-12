# Linux environment to build and test the FUSE mount.
# Use it through scripts/shell.sh, which gives the container /dev/fuse.
FROM rust:1.92-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends fuse3 pkg-config git nodejs npm python3 python3-venv awscli fio sqlite3 \
 && rm -rf /var/lib/apt/lists/* \
 && rustup component add clippy rustfmt

ENV CARGO_TARGET_DIR=/target
WORKDIR /skywake
