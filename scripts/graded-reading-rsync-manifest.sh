#!/usr/bin/env bash
# Thin wrapper around the machine-readable graded-reading manifest.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$REPO_ROOT"
TARGET_ROOT="/home/thuvien.eagles.edu.vn/public_html/efast"
MANIFEST_DOC="$REPO_ROOT/graded-reading-rsync-manifest.md"
MANIFEST_HELPER="$SCRIPT_DIR/graded_reading_rsync_manifest.py"
APPLY=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply] [--source PATH] [--target PATH]

Options:
  --apply         Write to the target with sudo rsync.
  --source PATH   Override the dev root (default: repo root).
  --target PATH   Override the live mirror target.
  --help          Show this help.

Workflow:
  1. Run without --apply to print the exact manifest and dry-run rsync.
  2. Run with --apply once the dry-run looks correct.
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
TARGET_ROOT="${TARGET_ROOT%/}"

if [[ ! -f "$MANIFEST_DOC" ]]; then
  echo "ERROR: Manifest doc not found: $MANIFEST_DOC" >&2
  exit 1
fi

if [[ ! -x "$MANIFEST_HELPER" ]]; then
  chmod +x "$MANIFEST_HELPER"
fi

manifest_file="$(mktemp "${TMPDIR:-/tmp}/graded-reading-manifest.XXXXXX")"
trap 'rm -f "$manifest_file"' EXIT

helper_output="$(
  python3 "$MANIFEST_HELPER" \
    --manifest-doc "$MANIFEST_DOC" \
    --source "$SOURCE_ROOT" \
    --target "$TARGET_ROOT" \
    --manifest-file "$manifest_file"
)"

printf '%s\n' "$helper_output"
echo "Mode: $([[ "$APPLY" -eq 1 ]] && printf 'APPLY' || printf 'DRY-RUN')"
echo "Source: $SOURCE_ROOT"
echo "Target: $TARGET_ROOT"
echo "Manifest: $manifest_file"
echo "Dry-run command:"
echo "sudo rsync -a --delete --from0 --files-from=\"$manifest_file\" \"$SOURCE_ROOT/\" \"$TARGET_ROOT/\""
echo

if [[ "$APPLY" -eq 1 ]]; then
  sudo mkdir -p "$TARGET_ROOT"
  sudo rsync -a --delete --from0 --files-from="$manifest_file" "$SOURCE_ROOT/" "$TARGET_ROOT/"
else
  sudo rsync -a -n --delete --from0 --files-from="$manifest_file" "$SOURCE_ROOT/" "$TARGET_ROOT/"
fi
