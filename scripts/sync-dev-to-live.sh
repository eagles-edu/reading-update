#!/usr/bin/env bash
# Sync selected dev files to the live webroot only when the current tree is stable.
# Dry-run by default. Use --apply to write to the live target.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$REPO_ROOT"
TARGET_ROOT="/home/thuvien.eagles.edu.vn/public_html"
APPLY=0

# Keep this list small and explicit so we do not ship orphaned or clutter files.
SYNC_ITEMS=(
  "index.html"
  "favicon.ico"
  "graded-reading/"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply] [--source PATH] [--target PATH] [--item RELPATH]

Options:
  --apply         Copy to the target webroot.
  --source PATH   Override the dev root (default: repo root).
  --target PATH   Override the live webroot (default: $TARGET_ROOT).
  --item PATH     Add an extra relative path to sync. Can be repeated.
  --help          Show this help.

Workflow:
  1. Make changes in dev.
  2. Run this script without --apply to review the exact sync set.
  3. Run with --apply only after the dev state is stable.

Notes:
  - The script uses rsync without --delete.
  - Only the explicit paths above are synced.
  - Add new live-worthy paths with --item or by editing SYNC_ITEMS.
EOF
}

while (($#)); do
  case "$1" in
    --apply)
      APPLY=1
      ;;
    --source)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --source requires a path" >&2; exit 2; }
      SOURCE_ROOT="$1"
      ;;
    --target)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --target requires a path" >&2; exit 2; }
      TARGET_ROOT="$1"
      ;;
    --item)
      shift
      [[ $# -gt 0 ]] || { echo "ERROR: --item requires a path" >&2; exit 2; }
      SYNC_ITEMS+=("$1")
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift || true
done

SOURCE_ROOT="$(cd -- "$SOURCE_ROOT" && pwd)"
TARGET_ROOT="$(cd -- "$TARGET_ROOT" && pwd)"

if [[ "$APPLY" -eq 1 ]]; then
  mkdir -p "$TARGET_ROOT"
fi

echo "Mode: $([[ "$APPLY" -eq 1 ]] && printf 'APPLY' || printf 'DRY-RUN')"
echo "Source: $SOURCE_ROOT"
echo "Target: $TARGET_ROOT"
echo "Items:"
printf '  - %s\n' "${SYNC_ITEMS[@]}"
echo

pushd "$SOURCE_ROOT" >/dev/null

for item in "${SYNC_ITEMS[@]}"; do
  rel="${item%/}"
  if [[ ! -e "$rel" ]]; then
    echo "SKIP missing: $rel"
    continue
  fi

  if [[ "$APPLY" -eq 1 && -d "$rel" ]]; then
    mkdir -p "$TARGET_ROOT/$rel"
  fi

  rsync_args=(-a --relative --itemize-changes)
  if [[ "$APPLY" -eq 0 ]]; then
    rsync_args+=(-n)
  fi

  echo "SYNC $rel"
  rsync "${rsync_args[@]}" "$item" "$TARGET_ROOT/"
done

popd >/dev/null
