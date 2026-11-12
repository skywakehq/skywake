# Finds or installs what Skywake needs. Sourced by scripts/start.sh and scripts/dev.sh.
# Asks before installing anything; SKYWAKE_YES=1 answers yes.

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
os=$(uname -s)
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if [ "$(id -u)" = 0 ]; then sudo() { "$@"; }; fi

ask() {
  [ "${SKYWAKE_YES:-}" = 1 ] && return 0
  [ -t 0 ] || fail "$1? Run again with SKYWAKE_YES=1 to allow it."
  printf '%s? [Y/n] ' "$1"
  read -r answer
  case $answer in [nN]*) fail "Stopped. Install it yourself and run this again." ;; esac
}

need_brew() {
  have brew && return
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)" && return
  [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)" && return
  ask "Install Homebrew, to install the rest"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
}

apt_install() {
  have apt-get || fail "Install $* with your package manager, then run this again."
  ask "Install $* with apt"
  sudo apt-get update -qq && sudo apt-get install -y -qq "$@"
}

colima_socket() {
  if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ] && [ -S "$HOME/.colima/default/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  fi
}

# $1: the least memory, in GB, Docker should have.
need_docker() {
  memory=${1:-4}
  if ! have docker; then
    case $os in
      Darwin)
        need_brew
        ask "Install Docker (Colima, docker and docker-compose) with Homebrew"
        brew install colima docker docker-compose
        ;;
      Linux)
        ask "Install Docker with its official script (uses sudo)"
        curl -fsSL https://get.docker.com | sudo sh
        [ "$(id -u)" = 0 ] || sudo usermod -aG docker "$(id -un)"
        ;;
      *) fail "Install Docker, then run this again." ;;
    esac
  fi
  if [ "$os" = Darwin ] && ! docker compose version >/dev/null 2>&1 && have brew; then
    brew list docker-compose >/dev/null 2>&1 || brew install docker-compose
    mkdir -p "$HOME/.docker/cli-plugins"
    ln -sf "$(brew --prefix)/opt/docker-compose/bin/docker-compose" "$HOME/.docker/cli-plugins/docker-compose"
  fi
  colima_socket
  if ! docker info >/dev/null 2>&1; then
    case $os in
      Darwin)
        if have colima; then
          say "Starting Colima"
          colima start --cpu 4 --memory "$((memory + 2))"
          colima_socket
        elif [ -d /Applications/Docker.app ]; then
          say "Starting Docker Desktop"
          open -a Docker
          for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
        fi
        ;;
      Linux)
        sudo systemctl start docker 2>/dev/null || true
        if ! docker info >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1 && have sg; then
          # Joined the docker group in this run: carry on as a member of it.
          exec sg docker -c "$0 ${SKYWAKE_ARGS:-}"
        fi
        ;;
    esac
  fi
  docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start it, then run this again."
  docker compose version >/dev/null 2>&1 || apt_install docker-compose-plugin
  bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
  if [ "$bytes" -lt "$((memory * 1000000000))" ]; then
    has=$((bytes / 1000000000))
    if [ "$os" = Darwin ] && have colima && colima status >/dev/null 2>&1; then
      ask "Docker has ${has} GB and needs ${memory}. Restart Colima with $((memory + 2)) GB (running containers restart)"
      colima stop && colima start --cpu 4 --memory "$((memory + 2))"
    else
      say "Docker has ${has} GB of memory; ${memory} GB or more is safer. Give it more in its settings if a build fails."
    fi
  fi
}

need_tools() {
  for tool in curl openssl git; do
    have "$tool" || { [ "$os" = Linux ] && apt_install "$tool"; } || fail "Install $tool, then run this again."
  done
}

need_node() {
  [ -d "$HOME/.local/node/bin" ] && export PATH="$HOME/.local/node/bin:$PATH"
  if have node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
    :
  elif [ "$os" = Darwin ]; then
    need_brew
    ask "Install Node.js with Homebrew"
    brew install node
  else
    ask "Install Node.js 22 from nodejs.org into ~/.local/node"
    case $(uname -m) in
      x86_64) arch=x64 ;;
      aarch64 | arm64) arch=arm64 ;;
      *) fail "Install Node.js 22.18 or later, then run this again." ;;
    esac
    dist=https://nodejs.org/dist/latest-v22.x
    sums=$(curl -fsSL "$dist/SHASUMS256.txt")
    file=$(echo "$sums" | grep -o "node-v22[^ ]*-linux-$arch.tar.gz" | head -1)
    tmp=$(mktemp -d)
    curl -fsSL -o "$tmp/$file" "$dist/$file"
    (cd "$tmp" && echo "$sums" | grep " $file\$" | sha256sum -c - >/dev/null) || fail "The Node.js download did not match its checksum."
    mkdir -p "$HOME/.local/node"
    tar -xzf "$tmp/$file" -C "$HOME/.local/node" --strip-components 1
    rm -rf "$tmp"
    export PATH="$HOME/.local/node/bin:$PATH"
    say "Node.js is in ~/.local/node/bin; add it to your PATH to use it outside these scripts."
  fi
  if ! have pnpm; then
    pnpm=$(node -p 'require("./package.json").packageManager')
    say "Installing $pnpm"
    if have corepack; then corepack enable pnpm 2>/dev/null || npm install -g "$pnpm"; else npm install -g "$pnpm"; fi
  fi
}

need_rust() {
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  if [ "$os" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install 2>/dev/null || true
    fail "Install the Xcode command line tools from the window that opened, then run this again."
  fi
  if [ "$os" = Linux ] && ! have cc; then
    apt_install build-essential pkg-config
  fi
  if ! have cargo; then
    ask "Install Rust with rustup, in your home folder"
    curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
    . "$HOME/.cargo/env"
  fi
}

# Fails when a port Skywake needs is taken. $2 names the .env setting that moves it, if any.
free_port() {
  have lsof && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 || return 0
  [ -n "${2:-}" ] && fail "Port $1 is in use. Stop what uses it, or set $2 in .env to another port."
  fail "Port $1 is in use. Stop what uses it, then run this again."
}
