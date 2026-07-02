#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST_DIR="${PPMC_PDFIUM_DIR:-$ROOT_DIR/src-tauri/resources/pdfium}"
VERSION="${PPMC_PDFIUM_VERSION:-latest}"
REPO="${PPMC_PDFIUM_REPO:-bblanchon/pdfium-binaries}"

fail() {
  printf 'ppmc pdfium setup: %s\n' "$1" >&2
  exit 1
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

case "$(uname -s)" in
  Linux) os=linux ;;
  *) fail 'only Linux is supported by this setup script for now' ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

asset="pdfium-$os-$arch.tgz"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/$REPO/releases/latest/download/$asset"
else
  release_tag=$(printf '%s' "$VERSION" | sed 's#/#%2F#g')
  url="https://github.com/$REPO/releases/download/$release_tag/$asset"
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT INT HUP TERM

archive="$tmp_dir/$asset"
printf 'Downloading %s\n' "$url"
download "$url" "$archive"

tar -xzf "$archive" -C "$tmp_dir"
lib_path=$(find "$tmp_dir" -type f -name 'libpdfium.so' | head -n 1)
[ -n "$lib_path" ] || fail 'libpdfium.so was not found in the archive'

mkdir -p "$DEST_DIR"
cp "$lib_path" "$DEST_DIR/libpdfium.so"
chmod 644 "$DEST_DIR/libpdfium.so"

printf 'Installed PDFium to %s\n' "$DEST_DIR/libpdfium.so"
printf 'Run: npm run tauri -- dev\n'
