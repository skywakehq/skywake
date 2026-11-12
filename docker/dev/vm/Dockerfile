FROM skywake-dev
# QEMU, a standard Debian kernel (virtio-fs is a module), and busybox
# for the guest.
RUN apt-get update && apt-get install -y --no-install-recommends qemu-system-arm linux-image-arm64 busybox-static cpio && rm -rf /var/lib/apt/lists/*
