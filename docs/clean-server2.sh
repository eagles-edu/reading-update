#!/bin/bash
# Server #2 — Safer System Cleanup (dockerz at /home/eagles/dockerz)
# - Cleans APT, logs, snaps (interactive or auto), Docker (prompted), caches
# - Targets known rebuildable user-state from this server: root trash, Codex,
#   Codeium, and VS Code caches plus old VS Code extension installs.
# - Keeps the legacy Docker cleanup step that was already in this script, but
#   does not expand into Docker data inspection or extra Docker-specific logic.
# - Fixes duplicate /var/log/syslog logrotate stanzas before forcing rotation
# - Prunes Flatpak unused runtimes/apps
# - Reports/Reloads OpenLiteSpeed lsphp handler after upgrades
# - Reports bytes reclaimed per step + total before SSD trim
# Usage:
#   sudo ./cleanup-server2.sh            # interactive mode
#   sudo ./cleanup-server2.sh --auto     # non-interactive safe mode (auto-yes for safe actions)
#   sudo ./cleanup-server2.sh --dry-run  # print actions without changing anything

set -Eeuo pipefail
trap 'echo "ERROR at line $LINENO: command \"${BASH_COMMAND}\" failed." >&2' ERR
export LC_ALL=C

# ----------- Args -----------
AUTO=0
DRY_RUN=0
for arg in "${@-}"; do
  case "$arg" in
    --auto) AUTO=1 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

# ----------- Space accounting -----------
bytes_avail() { df -B1 / | awk 'NR==2{print $4}'; }
fmt_bytes() {
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B --format=%.1f "$1"
  else
    # rough fallback in MB
    awk -v b="$1" 'BEGIN{printf "%.1fMB", b/1024/1024}'
  fi
}

declare -a CULLED_NAMES=()
declare -a CULLED_BYTES=()
TOTAL_CULLED=0
_STEP_NAME=""
_STEP_START=0

start_step() { _STEP_NAME="$1"; _STEP_START="$(bytes_avail)"; }
end_step() {
  local end freed
  end="$(bytes_avail)"
  freed=$(( end - _STEP_START ))
  (( freed < 0 )) && freed=0
  CULLED_NAMES+=("$_STEP_NAME")
  CULLED_BYTES+=("$freed")
  TOTAL_CULLED=$(( TOTAL_CULLED + freed ))
  _STEP_NAME=""; _STEP_START=0
}
print_cull_summary() {
  echo
  echo "=== Space reclaimed this run ==="
  local i; for (( i=0; i<${#CULLED_NAMES[@]}; i++ )); do
    printf " - %-28s %12s\n" "${CULLED_NAMES[$i]}" "$(fmt_bytes "${CULLED_BYTES[$i]}")"
  done
  printf " = %-28s %12s\n" "TOTAL" "$(fmt_bytes "$TOTAL_CULLED")"
  echo "================================"
}

# ----------- Helpers -----------
prompt_yes_no() {
  local prompt="$1" ans
  if (( AUTO == 1 )); then
    echo "$prompt [auto-Y]"
    return 0
  fi
  if ! [[ -t 0 && -t 1 ]]; then
    echo "$prompt [non-interactive -> N]"
    return 1
  fi
  read -rp "$prompt [y/N] " ans
  [[ $ans =~ ^[Yy]$ ]]
}

safely_remove() {
  if [[ -e "$1" ]]; then
    if (( DRY_RUN == 1 )); then
      echo "[dry-run] rm -rf -- $1"
    else
      rm -rf -- "$1"
      echo "Removed: $1"
    fi
  else
    echo "Not found: $1"
  fi
}

run_or_echo() {
  if (( DRY_RUN == 1 )); then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

remove_many_paths() {
  local label="$1"
  shift
  local path
  echo "$label"
  for path in "$@"; do
    if [[ -e "$path" ]]; then
      echo " - deleting $path"
      if (( DRY_RUN == 1 )); then
        echo "   [dry-run] rm -rf --one-file-system -- $path"
      else
        rm -rf --one-file-system -- "$path" 2>/dev/null || true
      fi
    else
      echo " - not found: $path"
    fi
  done
}

empty_root_trash() {
  local trash_dir="/root/.local/share/Trash"
  if [[ ! -d "$trash_dir" ]]; then
    echo "Root trash not found; skipping."
    return 0
  fi

  echo "Emptying root trash at $trash_dir ..."
  if [[ -d "$trash_dir/files" ]]; then
    if (( DRY_RUN == 1 )); then
      find "$trash_dir/files" -mindepth 1 -maxdepth 1 -print 2>/dev/null || true
    else
      find "$trash_dir/files" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
    fi
  else
    echo " - trash files dir missing; skipping."
  fi
  if [[ -d "$trash_dir/info" ]]; then
    if (( DRY_RUN == 1 )); then
      find "$trash_dir/info" -mindepth 1 -maxdepth 1 -print 2>/dev/null || true
    else
      find "$trash_dir/info" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null || true
    fi
  else
    echo " - trash info dir missing; skipping."
  fi
}

prune_user_tool_caches() {
  local user_home="$1"
  remove_many_paths \
    "Removing rebuildable user-tool caches..." \
    "$user_home/.codex/sessions" \
    "$user_home/.codeium/ws-browser" \
    "$user_home/.codeium/database" \
    "$user_home/.vscode/agent-plugins" \
    "$user_home/.config/Code/WebStorage" \
    "$user_home/.config/Code/User/workspaceStorage" \
    "$user_home/.config/Code/Cache" \
    "$user_home/.config/Code/CachedExtensionVSIXs" \
    "$user_home/.config/Code/CachedData" \
    "$user_home/.config/Code/Dictionaries" \
    "$user_home/.config/Code/logs" \
    "$user_home/.config/code-root" \
    "$user_home/.cache/uv" \
    "$user_home/.cache/trivy" \
    "$user_home/.cache/puppeteer" \
    "$user_home/.cache/cloud-code" \
    "$user_home/.cache/ms-playwright-go" \
    "$user_home/.cache/prisma" \
    "$user_home/.cache/go-build" \
    "$user_home/.cache/node-gyp" \
    "$user_home/.cache/typescript" \
    "$user_home/.cache/pip" \
    "$user_home/.cache/jedi" \
    "$user_home/.cache/redisinsight-updater" \
    "$user_home/.cache/thumbnails" \
    "$user_home/.cache/mesa_shader_cache" \
    "$user_home/.cache/fontconfig"
}

prune_vscode_caches() {
  local user_home="$1"
  local -a paths=(
    "$user_home/.config/Code/Cache"
    "$user_home/.config/Code/CachedData"
    "$user_home/.config/Code/CachedExtensionVSIXs"
    "$user_home/.config/Code/User/workspaceStorage"
    "$user_home/.config/Code/WebStorage"
    "$user_home/.config/Code/logs"
    "$user_home/.vscode/agent-plugins"
  )

  remove_many_paths "Removing VS Code caches only (keeping installed extensions)..." "${paths[@]}"
}

prune_old_nvm_versions() {
  local user_home="$1"
  local inv_user="$2"
  local nvm_versions_dir="$user_home/.nvm/versions/node"
  local active_node_version=""

  if [[ ! -d "$nvm_versions_dir" ]]; then
    echo "NVM versions directory not found; skipping."
    return 0
  fi

  if command -v sudo >/dev/null 2>&1; then
    active_node_version="$(sudo -H -u "$inv_user" bash -lc 'node -v 2>/dev/null || true' | tr -d '\r' || true)"
  fi

  if [[ -z "$active_node_version" ]]; then
    echo "Could not determine active Node version for $inv_user; skipping NVM version pruning."
    return 0
  fi

  echo "Keeping active Node version for $inv_user: $active_node_version"
  local dir base
  for dir in "$nvm_versions_dir"/v*; do
    [[ -d "$dir" ]] || continue
    base="${dir##*/}"
    if [[ "$base" == "$active_node_version" ]]; then
      echo " - keeping $dir"
    else
      echo " - removing $dir"
      if (( DRY_RUN == 1 )); then
        echo "   [dry-run] rm -rf --one-file-system -- $dir"
      else
        rm -rf --one-file-system -- "$dir" 2>/dev/null || true
      fi
    fi
  done
}

ensure_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "This script must run as root. Use: sudo $0" >&2
    exit 1
  fi
}

# Return the non-root user who invoked sudo (fallback to root)
get_invoking_user() {
  if [[ -n "${SUDO_USER-}" && "$SUDO_USER" != "root" ]]; then
    echo "$SUDO_USER"
  else
    logname 2>/dev/null || echo "root"
  fi
}

# Keep rsyslog and /etc/logrotate.conf; move other duplicates aside
fix_duplicate_syslog_logrotate() {
  echo "Checking for duplicate /var/log/syslog logrotate stanzas..."
  local bak_dir="/root/logrotate-bak-$(date +%F_%H%M%S)"
  mapfile -t hits < <(grep -RIl "^[[:space:]]*/var/log/syslog" /etc/logrotate.conf /etc/logrotate.d 2>/dev/null || true)

  if (( ${#hits[@]} == 0 )); then
    echo "No /var/log/syslog stanzas found (nothing to fix)."
    return 0
  fi
  if (( ${#hits[@]} <= 1 )); then
    echo "No duplicates detected."
    return 0
  fi

  echo "Found ${#hits[@]} files referencing /var/log/syslog:"
  printf ' - %s\n' "${hits[@]}"

  mkdir -p "$bak_dir"
  for f in "${hits[@]}"; do
    if [[ "$f" == "/etc/logrotate.conf" ]] || [[ "$f" =~ /etc/logrotate.d/rsyslog$ ]]; then
      echo "Keeping $f"
      continue
    fi
    echo "Backing up duplicate: $f -> $bak_dir/"
    if (( DRY_RUN == 1 )); then
      echo "   [dry-run] mv -f -- $f $bak_dir/"
    else
      mv -f -- "$f" "$bak_dir/"
    fi
  done
  echo "Duplicates moved to $bak_dir"
}

snap_cleanup() {
  echo
  echo "→ Snap cleanup…"
  if ! command -v snap &>/dev/null; then
    echo "Snap not installed; skipping."
    return
  fi

  run_or_echo snap abort --all 2>/dev/null || true

  local count
  count=$(snap list --all | awk '/disabled/ {print $1}' | wc -l | tr -d '[:space:]')
  if (( count == 0 )); then
    echo "No disabled revisions to prune."
  else
    echo "Found ${count} disabled revision(s) to remove:"
    snap list --all | awk '/disabled/ {printf "  %s (rev %s)\n", $1, $3}'

    if prompt_yes_no "Remove ALL disabled Snap revisions now?"; then
      snap list --all | awk '/disabled/ {print $1, $3}' | \
      while read -r name rev; do
        echo "  Removing $name (rev $rev)…"
        if (( DRY_RUN == 1 )); then
          echo "   [dry-run] snap remove --purge $name --revision=$rev"
        else
          snap remove --purge "$name" --revision="$rev" || echo "    FAILED: $name $rev"
        fi
      done
    else
      echo "Skipped removing disabled revisions."
    fi
  fi

  if prompt_yes_no "Set 'snap refresh.retain=2' to limit future old revisions?"; then
    run_or_echo snap set system refresh.retain=2 || true
  fi
  if prompt_yes_no "Clear /var/lib/snapd/cache (download cache)?"; then
    if (( DRY_RUN == 1 )); then
      echo "[dry-run] rm -rf /var/lib/snapd/cache/*"
    else
      rm -rf /var/lib/snapd/cache/* 2>/dev/null || true
    fi
  fi

  echo "→ Restarting snapd…"
  run_or_echo systemctl restart snapd
  echo "→ Snap cleanup done."
}

flatpak_cleanup() {
  echo
  echo "→ Flatpak cleanup…"
  if ! command -v flatpak &>/dev/null; then
    echo "Flatpak not installed; skipping."
    return
  fi
  echo "Size before:"
  du -sh /var/lib/flatpak 2>/dev/null || true
  run_or_echo flatpak uninstall --unused -y || true
  if prompt_yes_no "Run 'flatpak repair' (slower)?"; then
    run_or_echo flatpak repair --system || true
  fi
  echo "Size after:"
  du -sh /var/lib/flatpak 2>/dev/null || true
  echo "→ Flatpak cleanup done."
}

apt_safe_upgrade() {
  if (( DRY_RUN == 1 )); then
    echo "[dry-run] apt-get -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y upgrade"
    echo "[dry-run] dpkg --configure -a"
    echo "[dry-run] apt-get -f install -y"
    return 0
  fi
  echo "Upgrading installed packages (noninteractive)..."
  if ! apt-get -o Dpkg::Options::=--force-confdef \
               -o Dpkg::Options::=--force-confold -y upgrade; then
    echo "APT upgrade failed — attempting dpkg recovery..."
    dpkg --configure -a || true
    apt-get -f install -y || true
    apt-get -o Dpkg::Options::=--force-confdef \
             -o Dpkg::Options::=--force-confold -y upgrade
  fi
}

ensure_lsphp_phpdismod_exec() {
  if (( DRY_RUN == 1 )); then
    echo "[dry-run] would ensure exec bit on /usr/local/lsws/lsphp*/bin/phpdismod"
    return 0
  fi
  # Pre-empt package-maintainer scripts that call phpdismod
  local f
  shopt -s nullglob
  for f in /usr/local/lsws/lsphp*/bin/phpdismod; do
    if [[ -f "$f" && ! -x "$f" ]]; then
      chmod +x "$f"
      echo "Fixed exec bit: $f"
    fi
  done
  shopt -u nullglob
}

# --- OpenLiteSpeed: report active lsphp & optional reload ---
ols_report_lsphp() {
  local conf="/usr/local/lsws/conf/httpd_config.conf"
  if [[ ! -r "$conf" ]]; then
    echo "OpenLiteSpeed config not found at $conf"; return 0
  fi
  local handler path ver
  handler=$(awk '
    $1=="scriptHandler" {inSH=1}
    inSH && $1=="{" {next}
    inSH && $1=="add" && $2 ~ /^lsapi:/ {
      split($2,a,":"); print a[2]; inSH=0
    }
  ' "$conf")
  [[ -n "$handler" ]] || handler=$(awk '/^extProcessor[[:space:]]+lsphp[0-9]+/ {print $2; exit}' "$conf")

  if [[ -z "$handler" ]]; then
    echo "Could not determine lsphp handler name from $conf"; return 0
  fi

  path=$(awk -v n="$handler" '
    $1=="extProcessor" && $2==n {in=1}
    in && $1=="path" {print $2; exit}
    in && $1=="}" {in=0}
  ' "$conf")

  echo "OLS PHP handler: ${handler}"
  if [[ -n "$path" ]]; then
    echo "OLS lsphp path: ${path}"
    if [[ -x "$path" ]]; then
      ver=$("$path" -v 2>&1 | head -n1)
      echo "lsphp reports: ${ver}"
    else
      echo "lsphp path is not executable."
    fi
  else
    echo "No lsphp path found for handler '${handler}'."
  fi

  if prompt_yes_no "Reload OpenLiteSpeed now to ensure the handler is active?"; then
    ols_reload
  else
    echo "Skipping OpenLiteSpeed reload."
  fi
}

ols_reload() {
  echo "Reloading OpenLiteSpeed..."
  if (( DRY_RUN == 1 )); then
    echo "[dry-run] systemctl reload openlitespeed"
    echo "[dry-run] systemctl restart openlitespeed"
    echo "[dry-run] systemctl reload lsws"
    echo "[dry-run] systemctl restart lsws"
    echo "[dry-run] /usr/local/lsws/bin/lswsctrl restart"
    return 0
  fi
  systemctl reload openlitespeed 2>/dev/null || \
  systemctl restart openlitespeed 2>/dev/null || \
  systemctl reload lsws 2>/dev/null || \
  systemctl restart lsws 2>/dev/null || \
  /usr/local/lsws/bin/lswsctrl restart 2>/dev/null || \
  echo "Could not reload OpenLiteSpeed via systemd or lswsctrl."
}

# ----------- Main -----------
ensure_root
INV_USER="$(get_invoking_user)"
USER_HOME="$(eval echo ~"$INV_USER")"

# Server #2 defaults
USER_BASE="/home/eagles"; [[ -d "$USER_BASE" ]] || USER_BASE="$USER_HOME"
DOCKERZ_DIR="${USER_BASE}/dockerz"

# PRE-FIX litespeed helpers to avoid upgrade failures
ensure_lsphp_phpdismod_exec

echo "=== Safer System Cleanup (Server #2) === (invoking user: $INV_USER)"
if (( DRY_RUN == 1 )); then
  echo "=== DRY RUN: no changes will be made ==="
fi
export DEBIAN_FRONTEND=noninteractive

echo "Updating package lists..."
if (( DRY_RUN == 1 )); then
  echo "[dry-run] apt-get update -qq"
else
  apt-get update -qq
fi

apt_safe_upgrade
ols_report_lsphp

# APT cache + autoremove
start_step "APT cache/autoremove"
echo "Cleaning up APT cache..."
if (( DRY_RUN == 1 )); then
  echo "[dry-run] apt-get clean"
  echo "[dry-run] apt-get -y autoremove --purge"
else
  apt-get clean
  apt-get -y autoremove --purge
fi
end_step

# Journald vacuum
start_step "Journal vacuum"
echo "Cleaning systemd journal logs (older than 14 days)..."
run_or_echo journalctl --vacuum-time=14d || true
if prompt_yes_no "Also cap systemd journal to 200MB?"; then
  run_or_echo journalctl --vacuum-size=200M || true
fi
end_step

# Temp cleanup
start_step "Temp cleanup"
echo "Clearing temporary files older than 1 day..."
if (( DRY_RUN == 1 )); then
  find /tmp -xdev -mindepth 1 -mtime +1 -print 2>/dev/null || true
  find /var/tmp -xdev -mindepth 1 -mtime +1 -print 2>/dev/null || true
else
  find /tmp -xdev -mindepth 1 -mtime +1 -exec rm -rf -- {} + 2>/dev/null || true
  find /var/tmp -xdev -mindepth 1 -mtime +1 -exec rm -rf -- {} + 2>/dev/null || true
fi
end_step

# Old rotated/compressed logs
start_step "Old logs cleanup"
echo "Removing rotated/compressed log archives older than 30 days..."
if (( DRY_RUN == 1 )); then
  find /var/log -type f \( -regex '.*/[^/]+\.[0-9]+(\.gz)?$' -o -name '*.gz' \) -mtime +30 -print 2>/dev/null || true
else
  find /var/log -type f \( -regex '.*/[^/]+\.[0-9]+(\.gz)?$' -o -name '*.gz' \) -mtime +30 -delete 2>/dev/null || true
fi
end_step

# Snap cleanup (interactive or auto)
start_step "Snap cleanup"
if prompt_yes_no "Perform Snap cleanup now?"; then
  snap_cleanup
else
  echo "Skipping Snap cleanup."
fi
end_step

# Flatpak cleanup (non-destructive; removes unused)
start_step "Flatpak cleanup"
if prompt_yes_no "Prune Flatpak unused runtimes/apps now?"; then
  flatpak_cleanup
else
  echo "Skipping Flatpak cleanup."
fi
end_step

# Docker cleanup
start_step "Docker prune"
if command -v docker >/dev/null 2>&1; then
  echo "Docker present."
  if prompt_yes_no "Prune Docker (images/containers/networks) AND VOLUMES? This can delete data. Proceed"; then
    run_or_echo docker system prune -af --volumes
    echo "Docker prune complete."
  else
    echo "Skipping Docker prune."
  fi
else
  echo "Docker not installed; skipping."
fi
end_step

# npm & yarn cleanup for the invoking user (not root)
start_step "npm/yarn cache"
if command -v npm >/dev/null 2>&1; then
  echo "Cleaning npm cache for user: $INV_USER ..."
  if (( DRY_RUN == 1 )); then
    echo "[dry-run] sudo -H -u $INV_USER npm cache clean --force"
    echo "[dry-run] rm -rf -- $USER_HOME/.npm/_cacache $USER_HOME/.cache/npm"
  else
    sudo -H -u "$INV_USER" npm cache clean --force || true
    sudo -H -u "$INV_USER" rm -rf "$USER_HOME/.npm/_cacache" "$USER_HOME/.cache/npm" 2>/dev/null || true
  fi
fi
if command -v yarn >/dev/null 2>&1; then
  echo "Cleaning yarn cache for user: $INV_USER ..."
  run_or_echo sudo -H -u "$INV_USER" yarn cache clean || true
fi
end_step

# Dev cache scrub (npx, Playwright, Codacy)
start_step "Dev caches (npx/playwright/codacy)"
DEV_CLEAN_TARGETS=(
  "$USER_HOME/.npm/_npx"
  "$USER_HOME/.cache/codacy"
)
echo "Removing dev caches under ${USER_HOME}..."
for path in "${DEV_CLEAN_TARGETS[@]}"; do
  if [[ -e "$path" ]]; then
    echo " - deleting $path"
    if (( DRY_RUN == 1 )); then
      echo "   [dry-run] rm -rf -- $path"
    else
      rm -rf -- "$path" 2>/dev/null || true
    fi
  else
    echo " - not found: $path"
  fi
done
end_step

# Root trash
start_step "Root trash"
if prompt_yes_no "Empty root trash now?"; then
  empty_root_trash
else
  echo "Skipping root trash."
fi
end_step

# User tool caches from this server's actual usage
start_step "User tool caches"
if prompt_yes_no "Prune rebuildable user-tool caches now?"; then
  prune_user_tool_caches "$USER_HOME"
else
  echo "Skipping user-tool cache pruning."
fi
end_step

# VS Code caches only
start_step "VS Code caches"
if prompt_yes_no "Prune VS Code caches now? (installed extensions will be kept)"; then
  prune_vscode_caches "$USER_HOME"
else
  echo "Skipping VS Code cache pruning."
fi
end_step

# Downloads cleanup (old files only)
start_step "Downloads (older than 45d)"
DL_DIR="${USER_HOME}/Downloads"
if [[ -d "$DL_DIR" ]]; then
  if prompt_yes_no "Purge ${DL_DIR} items older than 45 days?"; then
    if (( DRY_RUN == 1 )); then
      find "$DL_DIR" -mindepth 1 -mtime +45 -print 2>/dev/null || true
      find "$DL_DIR" -type d -empty -print 2>/dev/null || true
    else
      find "$DL_DIR" -mindepth 1 -mtime +45 -print -delete 2>/dev/null || true
      find "$DL_DIR" -type d -empty -delete 2>/dev/null || true
    fi
  else
    echo "Skipping Downloads purge."
  fi
else
  echo "Downloads directory not found; skipping."
fi
end_step

# Fix duplicate syslog stanzas before forcing logrotate (move, not delete; skip accounting)

fix_duplicate_syslog_logrotate

# Force logrotate (may reclaim some)
start_step "Logrotate force"
echo "Validating logrotate configuration..."
if logrotate -d /etc/logrotate.conf >/tmp/logrotate.dryrun 2>&1; then
  echo "Forcing logrotate once..."
  run_or_echo logrotate -f /etc/logrotate.conf || true
else
  echo "Logrotate dry-run found issues. See /tmp/logrotate.dryrun"
  echo "Skipping force rotate to avoid errors."
fi
end_step

# ----------- Reports -----------
echo
echo "User directories under ${USER_BASE}:"
for dir in Downloads Documents; do
  if [[ -d "${USER_BASE}/${dir}" ]]; then
    echo "  - ${USER_BASE}/${dir}"
  else
    echo "  - ${USER_BASE}/${dir} (not found)"
  fi
done
if [[ -d "$DOCKERZ_DIR" ]]; then
  echo "  - ${DOCKERZ_DIR}"
else
  echo "  - ${DOCKERZ_DIR} (not found)"
fi

# Files larger than 55MB — sort by SIZE DESC, keep date/time/path
echo
echo "Files larger than 55MB (size, date, path):"
if command -v numfmt >/dev/null 2>&1; then
  {
    for p in /boot /var/lib /var/log /usr/local /usr/share /home; do
      find "$p" -xdev -type f -size +55M -printf '%s %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null
    done
  } | sort -nr -k1,1 | awk '{
        cmd="numfmt --to=iec --suffix=B --format=%.1f " $1; cmd | getline h; close(cmd);
        printf "%s %s %s %s\n", h, $2, $3, substr($0, index($0,$4));
      }'
else
  {
    for p in /boot /var/lib /var/log /usr/local /usr/share /home; do
      find "$p" -xdev -type f -size +55M -printf '%s %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null
    done
  } | sort -nr -k1,1 | awk '{ printf "%sB %s %s %s\n", $1, $2, $3, substr($0, index($0,$4)); }'
fi
# | head -n 200  # uncomment to cap output

# Directories 1GB or larger, leaf-only (no ancestor chain clutter)
echo
echo "Directories 1GB or larger (terminal directories only):"
{
  du -B1 --max-depth=6 / 2>/dev/null \
    | awk '$1 >= 1073741824 {print $1, $2}' \
    | sort -nr -k1,1
} | awk '
  {
    size[$2]=$1
    paths[NR]=$2
    count=NR
  }
  END {
    for (i=1; i<=count; i++) {
      path=paths[i]
      skip=0
      for (j=1; j<=count; j++) {
        other=paths[j]
        if (other != path && index(other, path "/") == 1) {
          skip=1
          break
        }
      }
      if (!skip) {
        printf "%.1fG\t%s\n", size[path]/1024/1024/1024, path
      }
    }
  }
' | sort -hr | head -n 60 || true

# VS Code config size
echo
echo "VS Code configuration directory size (${USER_BASE}/.config/Code):"
du -h --max-depth=1 "${USER_BASE}/.config/Code" 2>/dev/null | sort -hr || true

# VS Code history prune (NUL-safe + oldest-first trim)
start_step "VS Code history prune"
HISTORY_DIR="${USER_BASE}/.config/Code/User/History"
echo
echo "Pruning VS Code History in ${HISTORY_DIR}..."
if [[ -d "${HISTORY_DIR}" ]]; then
  echo " - Deleting entries older than 30 days..."
  if (( DRY_RUN == 1 )); then
    find "${HISTORY_DIR}" -mindepth 1 -mtime +30 -print 2>/dev/null || true
  else
    find "${HISTORY_DIR}" -mindepth 1 -mtime +30 -print0 2>/dev/null \
      | xargs -0 -r rm -rf -- || true
  fi

  MAX_ENTRIES=2000
  ENTRY_COUNT="$(find "${HISTORY_DIR}" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | grep -cz . || true)"
  if (( ENTRY_COUNT > MAX_ENTRIES )); then
    REMOVE_COUNT=$((ENTRY_COUNT - MAX_ENTRIES))
    echo " - Too many entries (${ENTRY_COUNT}). Removing oldest ${REMOVE_COUNT}..."
    mapfile -d '' -t OLDIES < <(
      find "${HISTORY_DIR}" -mindepth 1 -maxdepth 1 -printf '%T@ %p\0' 2>/dev/null \
        | sort -z -n -k1,1
    )
    for ((i=0; i<REMOVE_COUNT && i<${#OLDIES[@]}; i++)); do
      path="${OLDIES[i]#* }"
      if (( DRY_RUN == 1 )); then
        echo "   [dry-run] rm -rf -- $path"
      else
        rm -rf -- "$path" || true
      fi
    done
  fi
else
  echo "History directory not found; skipping."
fi
end_step

# ---- Reclaim summary (printed just above fstrim) ----
print_cull_summary

# Trim SSD
if command -v fstrim >/dev/null 2>&1; then
  echo "Trimming SSD..."
  fstrim -av || true
fi

echo "Providing disk usage report..."
df -h

echo
echo "=== System cleanup complete! ==="
