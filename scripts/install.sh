#!/bin/sh
set -eu

REPO="${PPMC_REPO:-Nyayuta1060/ppmc}"
VERSION="${PPMC_VERSION:-latest}"
BIN_DIR="${PPMC_BIN_DIR:-$HOME/.local/bin}"
APP_DIR="${PPMC_APP_DIR:-$HOME/.local/share/ppmc}"

fail() {
  printf 'ppmc install: %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

download() {
  url=$1
  output=$2

  if command -v curl >/dev/null 2>&1; then
    curl -fL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  else
    fail 'curl or wget is required'
  fi
}

latest_version() {
  url="https://github.com/$REPO/releases/latest"

  if command -v curl >/dev/null 2>&1; then
    final_url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$url")
  elif command -v wget >/dev/null 2>&1; then
    final_url=$(wget -qS --spider "$url" 2>&1 | sed -n 's/^  Location: //p' | tr -d '\r' | tail -n 1)
  else
    fail 'curl or wget is required'
  fi

  basename "$final_url"
}

case "$(uname -s)" in
  Linux) os=linux ;;
  *) fail 'only Linux is supported by this installer for now' ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x86_64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

if [ "$VERSION" = "latest" ]; then
  VERSION=$(latest_version)
fi

asset="ppmc-$VERSION-$os-$arch.AppImage"
base_url="https://github.com/$REPO/releases/download/$VERSION"
app_path="$APP_DIR/$asset"
wrapper_path="$BIN_DIR/ppmc"
tmp_path="$app_path.tmp"
checksum_path="$tmp_path.sha256"

mkdir -p "$APP_DIR" "$BIN_DIR"

printf 'Downloading %s\n' "$asset"
download "$base_url/$asset" "$tmp_path"

if download "$base_url/$asset.sha256" "$checksum_path"; then
  need_cmd sha256sum
  expected=$(sed 's/[[:space:]].*$//' "$checksum_path")
  actual=$(sha256sum "$tmp_path" | awk '{print $1}')
  [ "$expected" = "$actual" ] || fail 'checksum verification failed'
  rm -f "$checksum_path"
else
  rm -f "$checksum_path"
  printf 'Checksum not found; continuing without verification.\n' >&2
fi

chmod +x "$tmp_path"
mv "$tmp_path" "$app_path"

cat >"$wrapper_path" <<EOF
#!/bin/sh
exec "$app_path" "\$@"
EOF
chmod +x "$wrapper_path"

printf 'Installed ppmc to %s\n' "$wrapper_path"
printf 'Run: ppmc slides.pdf\n'
