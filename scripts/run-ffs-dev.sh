#!/usr/bin/env bash

# Run the two curated FreeFileSync batch jobs, then precompress the local
# public root and its /reading/ subtree.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_CONFIG="$SCRIPT_DIR/efast-root-index.ffs_batch"
READING_CONFIG="$SCRIPT_DIR/efast-reading.ffs_batch"
PUBLIC_ROOT="/home/thuvien.eagles.edu.vn/public_html"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Runs these curated FreeFileSync jobs:
  $ROOT_CONFIG
  $READING_CONFIG

Targets:
  root index: $PUBLIC_ROOT/index.html
  reading:    $PUBLIC_ROOT/reading/

After both successful syncs, approved text assets are precompressed as .gz
and .br. FreeFileSync is run through the root desktop environment because it
is a graphical application, while the batch files remain non-destructive.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: unknown option: $1" >&2
  usage >&2
  exit 2
fi

command -v FreeFileSync >/dev/null 2>&1 || {
  echo "ERROR: FreeFileSync is required" >&2
  exit 1
}

for config in "$ROOT_CONFIG" "$READING_CONFIG"; do
  if [[ ! -f "$config" ]]; then
    echo "ERROR: FreeFileSync configuration not found: $config" >&2
    exit 1
  fi
done

echo "[1/2] Running root-index FreeFileSync sync"
sudo -H env HOME=/root XDG_CONFIG_HOME=/root/.config SDL_AUDIODRIVER=dummy \
  FreeFileSync "$ROOT_CONFIG"

echo
echo "[2/2] Running reading-subtree FreeFileSync sync"
sudo -H env HOME=/root XDG_CONFIG_HOME=/root/.config SDL_AUDIODRIVER=dummy \
  FreeFileSync "$READING_CONFIG"

echo
echo "Running Brotli/gzip precompression"
sudo env GZIP_LEVEL="${GZIP_LEVEL:-6}" BROTLI_LEVEL="${BROTLI_LEVEL:-5}" \
  "$SCRIPT_DIR/precompress-web-assets.sh" --root "$PUBLIC_ROOT" --no-sudo
