#!/usr/bin/env bash

# Precompress the public landing page and /reading/ text assets.
# The web server must be configured to serve the generated .br/.gz sidecars.

set -Eeuo pipefail

ROOT="/home/thuvien.eagles.edu.vn/public_html"
GZIP_LEVEL="${GZIP_LEVEL:-6}"
BROTLI_LEVEL="${BROTLI_LEVEL:-5}"
USE_SUDO="auto"

COMPRESSION_ROOTS=(
  "index.html"
  "reading"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --root PATH       Public webroot (default: $ROOT).
  --gzip-level N    gzip level 1-9 (default: $GZIP_LEVEL).
  --brotli-level N  Brotli level 0-11 (default: $BROTLI_LEVEL).
  --no-sudo         Do not use sudo for a local root.
  --help            Show this help.

Creates or refreshes .gz and .br files beside approved HTML, CSS, JavaScript,
JSON, SVG, XML, text, and webmanifest files in the root index and /reading/.
Audio, archives, backups, /efast/, and unrelated public-root files are not
compressed.
EOF
}

while (($#)); do
  case "$1" in
    --root)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --root requires a path" >&2; exit 2; }
      ROOT="$1"
      ;;
    --gzip-level)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --gzip-level requires a number" >&2; exit 2; }
      GZIP_LEVEL="$1"
      ;;
    --brotli-level)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --brotli-level requires a number" >&2; exit 2; }
      BROTLI_LEVEL="$1"
      ;;
    --no-sudo) USE_SUDO="never" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$GZIP_LEVEL" in
  1|2|3|4|5|6|7|8|9) ;;
  *) echo "ERROR: GZIP_LEVEL must be 1-9" >&2; exit 1 ;;
esac

case "$BROTLI_LEVEL" in
  0|1|2|3|4|5|6|7|8|9|10|11) ;;
  *) echo "ERROR: BROTLI_LEVEL must be 0-11" >&2; exit 1 ;;
esac

command -v gzip >/dev/null 2>&1 || { echo "ERROR: gzip is required" >&2; exit 1; }
command -v brotli >/dev/null 2>&1 || {
  echo "ERROR: brotli is required; install with: sudo apt-get install brotli" >&2
  exit 1
}

ROOT="${ROOT%/}"
if [[ -z "$ROOT" || ! -d "$ROOT" ]]; then
  echo "ERROR: public root does not exist: $ROOT" >&2
  exit 1
fi

run_command() {
  if [[ "$USE_SUDO" == "never" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

collect_files() {
  local item="$1"
  local path="$ROOT/$item"

  if [[ -f "$path" ]]; then
    printf '%s\0' "$path"
    return
  fi

  [[ -d "$path" ]] || return 0

  find -L "$path" -type f \
    \( -name '*.html' -o -name '*.htm' -o -name '*.css' -o -name '*.js' \
       -o -name '*.mjs' -o -name '*.json' -o -name '*.svg' -o -name '*.xml' \
       -o -name '*.txt' -o -name '*.webmanifest' \) \
    ! -name '*.gz' ! -name '*.br' \
    ! -path '*/.git/*' ! -path '*/.vscode/*' ! -path '*/node_modules/*' \
    ! -path '*/vendor/*' ! -path '*/.backups/*' ! -path '*/.playwright-cli/*' \
    ! -path '*/robot/*' ! -path '*/AboutPageAssets/*' \
    ! -path '*/_notes/*' ! -path '*/_vti_cnf/*' \
    ! -name '*.bak*' ! -name '*.BAK' ! -name '*.old' ! -name '*.older' \
    ! -name '*.bu' ! -name '*.zip' ! -name '*.7z' ! -name '*.log' \
    -print0
}

manifest="$(mktemp)"
trap 'rm -f "$manifest"' EXIT

for item in "${COMPRESSION_ROOTS[@]}"; do
  collect_files "$item" >>"$manifest"
done

files=0
source_bytes=0
gzip_bytes=0
brotli_bytes=0

while IFS= read -r -d '' file; do
  run_command gzip -n -k -f -"$GZIP_LEVEL" -- "$file"
  run_command brotli -f -q "$BROTLI_LEVEL" -o "$file.br" -- "$file"

  source_size="$(stat -c '%s' -- "$file")"
  gzip_size="$(stat -c '%s' -- "$file.gz")"
  brotli_size="$(stat -c '%s' -- "$file.br")"
  source_bytes=$((source_bytes + source_size))
  gzip_bytes=$((gzip_bytes + gzip_size))
  brotli_bytes=$((brotli_bytes + brotli_size))
  files=$((files + 1))
done <"$manifest"

if [[ "$files" -eq 0 ]]; then
  echo "ERROR: no eligible text assets found in $ROOT" >&2
  exit 1
fi

percent() {
  local value="$1"
  local total="$2"
  if [[ "$total" -eq 0 ]]; then
    printf '0'
  else
    printf '%s' "$((100 * value / total))"
  fi
}

echo "Precompression complete: $ROOT/index.html and $ROOT/reading/"
printf '  files:  %s\n' "$files"
printf '  source: %s bytes\n' "$source_bytes"
printf '  gzip:   %s bytes (%s%%)\n' "$gzip_bytes" "$(percent "$gzip_bytes" "$source_bytes")"
printf '  brotli: %s bytes (%s%%)\n' "$brotli_bytes" "$(percent "$brotli_bytes" "$source_bytes")"
