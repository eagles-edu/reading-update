#!/usr/bin/env bash
# Thin wrapper around the efast rsync manifest helper.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/graded-reading-rsync-manifest.sh" "$@"
