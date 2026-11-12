#!/bin/sh
# Boots a small Linux VM in QEMU that mounts a branch over virtio-fs, and
# checks that its writes reach the store: synced writes at once, the rest
# at unmount. Runs in Docker. Build a release first:
# scripts/shell.sh cargo build --release
#
#   scripts/vm-test.sh
set -eu
if [ ! -e /.dockerenv ]; then
  cd "$(dirname "$0")/.."
  docker build -q -t skywake-dev docker/dev >/dev/null
  docker build -q -t skywake-vm docker/dev/vm >/dev/null
  exec docker run --rm -v "$PWD":/skywake -v skywake-target:/target skywake-vm sh /skywake/scripts/vm-test.sh
fi
B=/target/release
W=/tmp/vm; rm -rf $W; mkdir -p $W/initrd/bin $W/initrd/lib $W/seed
export SKYWAKE_STORE=$W/store SKYWAKE_ROOT=$W/root SKYWAKE_SAVE_EVERY_MS=600000

# The guest: busybox, the virtio-fs kernel modules, and a test script.
V=$(ls /lib/modules)
cp /bin/busybox $W/initrd/bin/
for m in virtio_pci virtiofs; do modprobe -S $V --show-depends $m; done | awk '$1=="insmod"{print $2}' | awk '!seen[$0]++' > $W/mods
for m in $(cat $W/mods); do cp $m $W/initrd/lib/; echo "insmod /lib/$(basename $m)"; done > $W/insmods
cat > $W/initrd/init <<INIT
#!/bin/busybox sh
/bin/busybox --install -s /bin
mkdir -p /proc /sys /dev /mnt
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev
$(cat $W/insmods)
(
  set -e
  mount -t virtiofs skywake /mnt && cd /mnt
  echo "guest read: \$(cat hello.txt)"
  echo synced > synced.txt && sync synced.txt && echo "guest fsync done"
  mkdir -p src/deep && echo from-vm > src/deep/note.txt
  dd if=/dev/urandom of=big.bin bs=1M count=3 2>/dev/null && md5sum big.bin > big.md5
  mv src/deep/note.txt src/note.txt && rm hello.txt && ln -s src/note.txt link
  mkdir target && echo build > target/out
) && echo GUEST-DONE
poweroff -f
INIT
chmod +x $W/initrd/init
(cd $W/initrd && find . | cpio -o -H newc 2>/dev/null | gzip) > $W/initrd.gz

# A branch, served by skywaked on a socket.
echo hello > $W/seed/hello.txt
$B/skywake new main && $B/skywake commit main $W/seed -m seed >/dev/null
$B/skywaked > $W/skywaked.log 2>&1 &
sleep 1
$B/skywake mount main $W/fs.sock --vm

timeout 600 qemu-system-aarch64 -machine virt -cpu max -smp 2 -m 512 -nographic -no-reboot -nic none \
  -kernel /boot/vmlinuz-$V -initrd $W/initrd.gz -append "console=ttyAMA0 rdinit=/init quiet" \
  -object memory-backend-memfd,id=mem,size=512M,share=on -numa node,memdev=mem \
  -chardev socket,id=fs,path=$W/fs.sock -device vhost-user-fs-pci,chardev=fs,tag=skywake \
  > $W/guest.log || true

failed=0
check() {
  if eval "$2"; then echo "PASS: $1"; else echo "FAIL: $1"; failed=1; fi
}
check "the guest mounts the branch and reads it" 'grep -q "guest read: hello" $W/guest.log'
check "the guest's writes all succeed" 'grep -q GUEST-DONE $W/guest.log'
$B/skywake checkout main $W/synced
check "an fsync'd write is in the store before any save" '[ "$(cat $W/synced/synced.txt)" = synced ]'
$B/skywake unmount $W/fs.sock
$B/skywake checkout main $W/out
check "a 3 MiB file arrives intact" '(cd $W/out && md5sum --status -c big.md5)'
check "renames, deletes and symlinks arrive" \
  '[ "$(cat $W/out/src/note.txt)" = from-vm ] && [ ! -e $W/out/hello.txt ] && [ "$(readlink $W/out/link)" = src/note.txt ]'
check "ignored folders stay out" '[ ! -e $W/out/target ]'
[ $failed = 0 ] || { cat $W/guest.log $W/skywaked.log; exit 1; }
