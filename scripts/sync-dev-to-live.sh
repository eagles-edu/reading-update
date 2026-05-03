#!/usr/bin/env bash
# Sync the homepage plus the reading mirror into the live webroot.
# Dry-run by default. Use --apply to write to the live target.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$REPO_ROOT"
TARGET_ROOT="/home/thuvien.eagles.edu.vn/public_html"
APPLY=0

# Keep the root sync explicit. The reading mirror is handled by the efast rsync
# manifest helper so it can stay replacement-safe under the /efast/ target.
ROOT_SYNC_ITEMS=(
  "index.html"
  "favicon.ico"
  "pics/"
  "images/"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply] [--source PATH] [--target PATH] [--item RELPATH]

Options:
  --apply         Copy to the target webroot.
  --source PATH   Override the dev root (default: repo root).
  --target PATH   Override the live webroot (default: $TARGET_ROOT).
  --item PATH     Add an extra relative path to the root sync. Can be repeated.
  --help          Show this help.

Workflow:
  1. Make changes in dev.
  2. Run this script without --apply to review the exact sync set.
  3. Run with --apply only after the dev state is stable.

Notes:
  - The root sync uses rsync with --delete so it replaces stale files.
  - The reading mirror is synced into /efast/ through the manifest helper.
  - Add new live-worthy root paths with --item or by editing ROOT_SYNC_ITEMS.
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
      ROOT_SYNC_ITEMS+=("$1")
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
if command -v realpath >/dev/null 2>&1; then
  TARGET_ROOT="$(realpath -m -- "$TARGET_ROOT")"
else
  TARGET_ROOT="${TARGET_ROOT%/}"
fi
EFast_TARGET="$TARGET_ROOT/efast"
MANIFEST_HELPER="$SCRIPT_DIR/efast-rsync-manifest.sh"

sync_root_item() {
  local item="$1"
  local rel="${item%/}"

  if [[ ! -e "$rel" ]]; then
    echo "SKIP missing: $rel"
    return 0
  fi

  if [[ "$APPLY" -eq 1 && -d "$rel" ]]; then
    sudo mkdir -p "$TARGET_ROOT/$rel"
  fi

  local rsync_args=(-a --delete --relative --itemize-changes)
  if [[ "$APPLY" -eq 0 ]]; then
    rsync_args+=(-n)
  fi

  echo "SYNC root $rel"
  sudo rsync "${rsync_args[@]}" "$item" "$TARGET_ROOT/"
}

sync_efast_tree() {
  echo "SYNC efast/"
  if [[ "$APPLY" -eq 1 ]]; then
    bash "$MANIFEST_HELPER" --source "$SOURCE_ROOT" --target "$EFast_TARGET" --apply
  else
    bash "$MANIFEST_HELPER" --source "$SOURCE_ROOT" --target "$EFast_TARGET"
  fi
}

if [[ "$APPLY" -eq 1 ]]; then
  sudo mkdir -p "$TARGET_ROOT"
fi

echo "Mode: $([[ "$APPLY" -eq 1 ]] && printf 'APPLY' || printf 'DRY-RUN')"
echo "Source: $SOURCE_ROOT"
echo "Target: $TARGET_ROOT"
echo "Efast target: $EFast_TARGET"
echo "Root items:"
printf '  - %s\n' "${ROOT_SYNC_ITEMS[@]}"
echo

pushd "$SOURCE_ROOT" >/dev/null

for item in "${ROOT_SYNC_ITEMS[@]}"; do
  sync_root_item "$item"
done

echo
sync_efast_tree

popd >/dev/null
