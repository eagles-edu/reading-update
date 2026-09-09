#!/usr/bin/env bash
# Development-only, whitelist-based sync for the efast reading site.
# Dry-run is the default. This never deletes files from either target.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT"
PUBLIC_ROOT="/home/thuvien.eagles.edu.vn/public_html"
APPLY=0
COMPRESS=1
USE_SUDO="auto"

READING_DIRECTORIES=(
  "audio" "css" "fonts" "images" "img" "js" "pics" "style"
  "easydialogs" "kidsenglish" "kidsenglish2" "kidsenglish3"
  "begin1" "begin2" "begin3" "begin4" "begin5" "begin6"
  "supereasy" "easyread" "eslread" "people" "essays"
)

EXCLUDE_PATTERNS=(
  "**/.git/***" "**/.vscode/***" "**/node_modules/***" "**/vendor/***"
  "**/.backups/***" "**/.playwright-cli/***" "**/robot/***"
  "**/AboutPageAssets/***" "**/_notes/***" "**/_vti_cnf/***"
  "**/*.bak*" "**/*.BAK" "**/*.old" "**/*.older" "**/*.bu"
  "**/*.zip" "**/*.7z" "**/*.log" "**/*.gz" "**/*.br"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Sync the public landing page and the approved reading subtree. Dry-run is the
default and target deletions are never requested.

Options:
  --apply             Copy changed files. Without this option, preview only.
  --source PATH       Local source root (default: $REPO_ROOT).
  --public-root PATH  Public webroot (default: $PUBLIC_ROOT).
  --target PATH       Alias for --public-root.
  --no-compress       Do not use rsync transport compression.
  --no-sudo           Do not use sudo for local targets.
  --help              Show this help.

Examples:
  npm run sync:dev
  npm run sync:dev:apply
  npm run sync:dev -- --public-root /tmp/efast-preview --no-sudo --apply

The root phase copies only source index.html to the public webroot. The
reading phase copies favicon.ico and the approved site directories to
public_html/reading. Documentation, scripts, dependencies, backups, /efast,
and generated archives are never selected.
EOF
}

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --source)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --source requires a path" >&2; exit 2; }
      SOURCE_ROOT="$1"
      ;;
    --public-root|--target)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --public-root requires a path" >&2; exit 2; }
      PUBLIC_ROOT="$1"
      ;;
    --no-compress) COMPRESS=0 ;;
    --no-sudo) USE_SUDO="never" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

SOURCE_ROOT="$(cd -- "$SOURCE_ROOT" && pwd -P)"
if [[ ! -f "$SOURCE_ROOT/index.html" ]]; then
  echo "ERROR: source root does not contain index.html: $SOURCE_ROOT" >&2
  exit 1
fi
PUBLIC_ROOT="${PUBLIC_ROOT%/}"
READING_ROOT="$PUBLIC_ROOT/reading"
if [[ -z "$PUBLIC_ROOT" || "$PUBLIC_ROOT" == "/" ]]; then
  echo "ERROR: public root must be a non-root directory" >&2
  exit 2
fi

command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync is required" >&2; exit 1; }

run_rsync() {
  if [[ "$USE_SUDO" == "never" ]]; then
    rsync "$@"
  else
    sudo rsync "$@"
  fi
}

append_common_filters() {
  local pattern
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    READING_ARGS+=("--exclude=$pattern")
  done
}

RSYNC_ARGS=(
  --archive --partial --human-readable --itemize-changes --prune-empty-dirs
  --omit-dir-times --no-perms --no-owner --no-group
  "--out-format=%i %n%L"
)
if [[ "$COMPRESS" -eq 1 ]]; then
  RSYNC_ARGS+=(--compress --compress-level=6)
fi
if [[ "$APPLY" -eq 0 ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

if [[ "$APPLY" -eq 1 ]]; then
  if [[ "$USE_SUDO" == "never" ]]; then
    mkdir -p -- "$PUBLIC_ROOT" "$READING_ROOT"
  else
    sudo mkdir -p -- "$PUBLIC_ROOT" "$READING_ROOT"
  fi
elif [[ ! -d "$PUBLIC_ROOT" || ! -d "$READING_ROOT" ]]; then
  echo "ERROR: dry-run requires both target directories:" >&2
  echo "  $PUBLIC_ROOT" >&2
  echo "  $READING_ROOT" >&2
  echo "Run apply once to create them, or pass an existing --public-root." >&2
  exit 1
fi

ROOT_ARGS=("${RSYNC_ARGS[@]}" "--include=/index.html" "--exclude=*")
READING_ARGS=("${RSYNC_ARGS[@]}")
append_common_filters
for directory in "${READING_DIRECTORIES[@]}"; do
  READING_ARGS+=("--include=/$directory/***")
done
READING_ARGS+=("--include=/favicon.ico" "--exclude=*")

echo "Mode: $([[ "$APPLY" -eq 1 ]] && printf 'APPLY' || printf 'DRY-RUN')"
echo "Source: $SOURCE_ROOT"
echo "Root index target: $PUBLIC_ROOT/index.html"
echo "Reading target: $READING_ROOT"
echo "Transport compression: $([[ "$COMPRESS" -eq 1 ]] && printf 'enabled' || printf 'disabled')"
echo "Safety: no target deletions; non-whitelisted paths are excluded"
echo

echo "[1/2] Root index"
run_rsync "${ROOT_ARGS[@]}" "$SOURCE_ROOT/" "$PUBLIC_ROOT/"
echo
echo "[2/2] Reading subtree"
run_rsync "${READING_ARGS[@]}" "$SOURCE_ROOT/" "$READING_ROOT/"

if [[ "$APPLY" -eq 1 ]]; then
  echo
  echo "Precompressing approved text assets in $PUBLIC_ROOT"
  if [[ "$USE_SUDO" == "never" ]]; then
    "$SCRIPT_DIR/precompress-web-assets.sh" --root "$PUBLIC_ROOT" --no-sudo
  else
    sudo env GZIP_LEVEL="${GZIP_LEVEL:-6}" BROTLI_LEVEL="${BROTLI_LEVEL:-5}" \
      "$SCRIPT_DIR/precompress-web-assets.sh" --root "$PUBLIC_ROOT" --no-sudo
  fi
fi
