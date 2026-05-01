#!/usr/bin/env bash
# EagleEye Domain Name Updater — Website Tool
# Bulk-scan a codebase for hard-coded domains/URLs and optionally rewrite them.
# DRY-RUN by default. EXECUTE with -e. Writes a digest log of intended/executed replacements.

set -Eeuo pipefail

#######################################
# Defaults & globals
#######################################
# These two are editable defaults for clarity in prompts/usage:
DEFAULT_BASE="/home/user/example.net/"
DEFAULT_SCRIPT_REL="scripts/"

# Derived default for webroot prompt (Ubuntu 22.04 + CyberPanel/OpenLiteSpeed pattern)
WEB_ROOT_DEFAULT="${DEFAULT_BASE%/}/public_html"

# Script location as called (used if user hits enter at prompts)
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."  # fallback: parent of scripts/
MAP_FILE_DEFAULT="$SCRIPT_DIR/domains.map"

MAP_FILE=""                 # -m path (optional)
MAP_INLINE=""               # -i "old=>new,old2=>new2"
LOG_FILE="$SCRIPT_DIR/domain-update.digest.log"
DRY_RUN=1                   # default: dry-run
BACKUP_EXT=""               # e.g. ".bak"
EXT_REGEX='html?'           # conservative by default: HTML only

# Extension TAGS (union when multiple tags specified via -t/--tags)
# Use --tags=? to list.
declare -A TAG_SETS=(
  ["html"]="html?"
  ["web"]="html?|css|js|mjs"
  ["assets"]="css|js|mjs|ts|tsx"
  ["templates"]="tpl|twig|jinja|ejs|hbs|phtml|mustache|liquid"
  ["backend"]="php|rb|py|pl|go|java|jsp|cs|cfm|phtml"
  ["config"]="json|ya?ml|xml|ini|conf|config|toml|env"
  ["text"]="md|txt|csv|tsv|rst"
  ["markup"]="html?|xml|svg"
)
TAGS_SPEC=""                # -t value (comma-separated)

# Excluded directories (append with -x)
EXCLUDE_DIRS=( ".git" ".vscode" "node_modules" "vendor" "dist" "build" ".cache" ".undo" ".next" "coverage" "tmp" "logs" )

# Mapping arrays
declare -a MAP_OLD=()
declare -a MAP_NEW=()

# Report aggregation
declare -A FILE_HITS=()       # file -> count
declare -A FILE_FIRST_LOC=()  # file -> "line:col"
declare -i TOTAL_FILES_SCANNED=0
declare -i TOTAL_FILES_WITH_HITS=0
declare -i TOTAL_OCCURRENCES=0

# Working files
RUN_DIR="$(mktemp -d)"
MATCHES_TSV="$RUN_DIR/matches.tsv"   # file<TAB>line<TAB>col<TAB>old<TAB>new
: > "$MATCHES_TSV"

cleanup() { rm -rf "$RUN_DIR"; }
trap cleanup EXIT

#######################################
# Helpers
#######################################
trim() {
  local s="${1-}"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

join_by() { local IFS="$1"; shift; echo "$*"; }

abs_path() {
  local p="${1-}"
  if [[ "$p" == /* ]]; then
    printf '%s\n' "$p"
  else
    printf '%s\n' "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
  fi
}

tags_to_regex() {
  local csv="${1-}"
  [[ -z "$csv" ]] && return 0
  local acc=()
  IFS=',' read -r -a parts <<<"$csv"
  for t in "${parts[@]}"; do
    t="$(trim "$t")"
    [[ -z "$t" ]] && continue
    if [[ "$t" == "?" ]]; then
      echo "Available tags:" >&2
      for k in "${!TAG_SETS[@]}"; do printf "  %-10s %s\n" "$k" "${TAG_SETS[$k]}"; done >&2
      exit 0
    fi
    if [[ -n "${TAG_SETS[$t]:-}" ]]; then
      acc+=("${TAG_SETS[$t]}")
    else
      echo "WARN: unknown tag '$t' (use --tags=? to list). Ignored." >&2
    fi
  done
  if ((${#acc[@]})); then
    # Union the sets (just join with | and dedupe roughly)
    local joined
    joined="$(printf "%s|" "${acc[@]}")"
    joined="${joined%|}"
    # Best-effort dedupe by splitting on | and using associative tmp map
    declare -A seen=()
    local out=()
    IFS='|' read -r -a exts <<<"$joined"
    for e in "${exts[@]}"; do
      [[ -z "$e" ]] && continue
      if [[ -z "${seen[$e]:-}" ]]; then out+=("$e"); seen["$e"]=1; fi
    done
    EXT_REGEX="$(IFS='|'; echo "${out[*]}")"
  fi
}

print_usage() {
  cat <<EOF
EagleEye Domain Name Updater — Website Tool

Usage: $(basename "$0") [options]

Scan and replace domains using a mapping list.

Placement (interactive prompts appear if you just run the script):
  1) Full path to your website's ROOT (web root). Examples:
     - Ubuntu 22.04 + CyberPanel/OpenLiteSpeed: /home/<user>/<domain>/public_html
     - cPanel: /home/<user>/public_html/
     - Debian/Apache: /var/www/html/ (or /var/www/<add.on.domain>/)
     - Plesk: /var/www/vhosts/<domain>/httpdocs/
  2) Relative path from that root to THIS script (e.g., scripts/, js/, assets/sh/, utilities/, tools/, dev/)

Options:
  -r <root>        Root directory to scan (overrides interactive root)
  -m <mapfile>     Mapping file path (default: ./scripts/domains.map if present)
                   Lines: "old => new" or "old<ws>new". '#' starts a comment.
  -i "<inline>"    Inline mappings, comma-separated, e.g.:
                     "http://old.com=>https://new.com,old2=>new2"
  -t <tags>        Extension tags (comma-separated). Union of sets. Examples:
                     -t html
                     -t web
                     -t templates,backend
                   Use --tags=? to list sets. Overridden by -E.
  --tags=<tags>    Same as -t; --tags=? lists sets and exits.
  -E <regex>       File extension regex (overrides -t). Default: ${EXT_REGEX}
  -x <dir>         Additional directory name to exclude (repeatable)
  -l <logfile>     Digest log output (default: ${LOG_FILE})
  -e               Execute replacements (default: dry-run)
  -n               Force dry-run (overrides -e)
  -b <ext>         Keep per-file backup with this extension (e.g. .bak)
  -h               Help

Digest format:
- Banner + run details (mode, root, map, pairs, regex, excludes)
- Stats (files scanned, with hits, total occurrences)
- By-resource ranking
- Per-file section:
    /abs/path:first_line:first_col — N replacement(s)
      line:col OLD --> NEW

Start narrow (default html only), review digest, then widen with -t or -E.
EOF
}

#######################################
# Interactive placement pre-run
#######################################
interactive_placement() {
  # Ask only if neither -r nor explicit non-empty ROOT_DIR override is set by user.
  local answered_root=""
  local answered_rel=""

  echo
  echo "EagleEye placement setup:"
  read -rp "1) Full path to your website's root [${WEB_ROOT_DEFAULT}]: " answered_root || true
  answered_root="${answered_root:-$WEB_ROOT_DEFAULT}"

  cat <<EXAMPLES

   (Examples)
     - cPanel:               /home/<user>/public_html/
     - Debian/Apache:        /var/www/html/   (or /var/www/<add.on.domain>/)
     - Plesk:                /var/www/vhosts/<domain>/httpdocs/
     - Ubuntu 22.04 + OLS:   /home/<user>/<domain>/public_html

EXAMPLES

  read -rp "2) Relative path from that root to this script [${DEFAULT_SCRIPT_REL}]: " answered_rel || true
  answered_rel="${answered_rel:-$DEFAULT_SCRIPT_REL}"

  # Normalize: ensure root absolute, ensure rel has no leading slash
  if [[ "${answered_root}" != /* ]]; then
    echo "ERROR: Web root must be an absolute path. Got: ${answered_root}" >&2
    exit 2
  fi
  answered_rel="${answered_rel#/}"

  # Adopt interactive answers
  ROOT_DIR="$(abs_path "$answered_root")"

  # Recompute SCRIPT_DIR (best-effort) so default map + log land under the chosen relative dir
  local guessed_script_dir="${ROOT_DIR%/}/${answered_rel%/}"
  if [[ -d "$guessed_script_dir" ]]; then
    SCRIPT_DIR="$guessed_script_dir"
    MAP_FILE_DEFAULT="$SCRIPT_DIR/domains.map"
    # Only reset LOG_FILE to new location if user didn't override -l
    if [[ "$LOG_FILE" == "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/domain-update.digest.log" ]]; then
      LOG_FILE="$SCRIPT_DIR/domain-update.digest.log"
    fi
  fi

  echo
  echo "Using:"
  echo "  Web root:   $ROOT_DIR"
  echo "  Script dir: $SCRIPT_DIR"
  echo "  Map file:   (will use $MAP_FILE_DEFAULT if present)"
  echo "  Log file:   $LOG_FILE"
  echo
}

#######################################
# CLI parsing
#######################################
LONG_TAGS=""
while (( "$#" )); do
  case "$1" in
    --tags=*) LONG_TAGS="${1#*=}"; shift ;;
    --tags)   LONG_TAGS="$2"; shift 2 ;;
    --help)   print_usage; exit 0 ;;
    --)       shift; break ;;
    -*)       # fall back to getopts for short flags
              set -- "$@" "$1"; shift ;;
    *)        set -- "$@" "$1"; shift ;;
  esac
done

# Reset so getopts sees only short flags we re-pushed above.
set -- "$@"

while getopts ":r:m:i:l:enx:E:b:t:h" opt; do
  case "$opt" in
    r) ROOT_DIR="$OPTARG" ;;
    m) MAP_FILE="$OPTARG" ;;
    i) MAP_INLINE="$OPTARG" ;;
    l) LOG_FILE="$OPTARG" ;;
    e) DRY_RUN=0 ;;
    n) DRY_RUN=1 ;;
    x) EXCLUDE_DIRS+=("$OPTARG") ;;
    E) EXT_REGEX="$OPTARG" ;;
    b) BACKUP_EXT="$OPTARG" ;;
    t) TAGS_SPEC="$OPTARG" ;;
    h) print_usage; exit 0 ;;
    \?) echo "ERROR: Unknown option -$OPTARG" >&2; print_usage; exit 2 ;;
    :)  echo "ERROR: Option -$OPTARG requires an argument" >&2; exit 2 ;;
  esac
done

# Merge LONG_TAGS if provided
if [[ -n "$LONG_TAGS" ]]; then
  if [[ -n "$TAGS_SPEC" ]]; then
    TAGS_SPEC="$TAGS_SPEC,$LONG_TAGS"
  else
    TAGS_SPEC="$LONG_TAGS"
  fi
fi

# If -E not provided and tags provided, compute EXT_REGEX from tags
if [[ "${EXT_REGEX}" == "html?" && -n "${TAGS_SPEC}" ]]; then
  tags_to_regex "$TAGS_SPEC"
fi

# Paths to abs
ROOT_DIR="$(abs_path "$ROOT_DIR")"
LOG_FILE="$(abs_path "$LOG_FILE")"
if [[ -n "${MAP_FILE-}" ]]; then
  MAP_FILE="$(abs_path "$MAP_FILE")"
fi

#######################################
# Load mapping
#######################################
load_map_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    local line old new
    line="${raw%%#*}"
    line="$(trim "$line")"
    [[ -z "$line" ]] && continue

    if [[ "$line" == *"=>"* ]]; then
      old="$(trim "${line%%=>*}")"
      new="$(trim "${line#*=>}")"
    else
      read -r old new _rest <<<"$line" || true
      old="$(trim "${old-}")"
      new="$(trim "${new-}")"
    fi

    [[ -z "$old" || -z "$new" ]] && continue
    MAP_OLD+=("$old")
    MAP_NEW+=("$new")
  done < "$f"
  return 0
}

load_map_inline() {
  local spec="${1-}"
  [[ -z "$spec" ]] && return 0
  IFS=',' read -r -a pairs <<<"$spec"
  for p in "${pairs[@]}"; do
    p="$(trim "$p")"
    [[ -z "$p" ]] && continue
    if [[ "$p" != *"=>"* ]]; then
      echo "WARN: Inline pair '$p' must use => separator; skipping." >&2
      continue
    fi
    local old new
    old="$(trim "${p%%=>*}")"
    new="$(trim "${p#*=>}")"
    [[ -z "$old" || -z "$new" ]] && continue
    MAP_OLD+=("$old")
    MAP_NEW+=("$new")
  done
}

#######################################
# File finder
#######################################
build_find_cmd() {
  local -a cmd=( find "$ROOT_DIR" )
  if ((${#EXCLUDE_DIRS[@]} > 0)); then
    cmd+=( \( )
    local first=1
    for d in "${EXCLUDE_DIRS[@]}"; do
      if (( first )); then
        cmd+=( -path "*/$d/*" )
        first=0
      else
        cmd+=( -o -path "*/$d/*" )
      fi
    done
    cmd+=( -prune \) -o )
  fi
  cmd+=( -type f -regextype posix-extended -regex ".*\.(${EXT_REGEX})$" -print )
  printf '%q ' "${cmd[@]}"
}

#######################################
# Scan
#######################################
scan_files() {
  local find_cmd; find_cmd="$(build_find_cmd)"
  # shellcheck disable=SC2086
  while IFS= read -r file; do
    ((TOTAL_FILES_SCANNED++))
    local have_hits=0

    for ((i=0; i<${#MAP_OLD[@]}; i++)); do
      local old="${MAP_OLD[$i]}" new="${MAP_NEW[$i]}"
      awk -v s="$old" -v f="$file" -v n="$new" '
        {
          line=$0; pos=1;
          while ((idx=index(line, s))>0) {
            col=pos+idx-1;
            printf "%s\t%d\t%d\t%s\t%s\n", f, NR, col, s, n
            pos=col+length(s);
            line=substr(line, idx+length(s));
          }
        }' "$file" >> "$MATCHES_TSV" || true
    done

    local count
    count=$(awk -F'\t' -v f="$file" '$1==f{c++} END{print c+0}' "$MATCHES_TSV")
    if (( count > 0 )); then
      have_hits=1
      FILE_HITS["$file"]=$count
      ((TOTAL_FILES_WITH_HITS++))
      local firstloc
      firstloc=$(awk -F'\t' -v f="$file" '$1==f{print $2":"$3; exit}' "$MATCHES_TSV")
      FILE_FIRST_LOC["$file"]="$firstloc"
    fi
  done < <( eval "$find_cmd" )

  if [[ -s "$MATCHES_TSV" ]]; then
    TOTAL_OCCURRENCES=$(wc -l < "$MATCHES_TSV" | tr -d ' ')
  else
    TOTAL_OCCURRENCES=0
  fi
}

#######################################
# Execute
#######################################
execute_replacements() {
  [[ -s "$MATCHES_TSV" ]] || return 0
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    mapfile -t pairs < <(awk -F'\t' -v file="$f" '$1==file{print $4 "\t" $5}' "$MATCHES_TSV" | sort -u)
    [[ ${#pairs[@]} -eq 0 ]] && continue

    if [[ -n "$BACKUP_EXT" && ! -e "${f}${BACKUP_EXT}" ]]; then
      cp -p -- "$f" "${f}${BACKUP_EXT}" || true
    fi

    declare -a perl_args=()
    for line in "${pairs[@]}"; do
      local old="${line%%$'\t'*}"
      local new="${line#*$'\t'}"
      local rep="${new//\\/\\\\}"
      rep="${rep//\//\\/}"
      rep="${rep//&/\\&}"
      perl_args+=( "-e" "s/\\Q${old//\\/\\\\}\\E/${rep}/g" )
    done

    # NOTE: include -p for automatic read/print, and -0777 for slurp mode
    perl -0777 -i -p "${perl_args[@]}" -- "$f"
  done < <(
    for k in "${!FILE_HITS[@]}"; do
      printf "%08d\t%s\n" "${FILE_HITS[$k]}" "$k"
    done | sort -rn | cut -f2-
  )
}

#######################################
# Digest writer
#######################################
write_digest() {
  local mode_str
  if [[ $DRY_RUN -eq 1 ]]; then
    mode_str="DRY-RUN (no files modified)"
  else
    mode_str="EXECUTED (files modified)"
  fi

  {
    echo "=== EAGLEEYE DOMAIN NAME UPDATER — ${mode_str} ==="
    date +"Run: %Y-%m-%d %H:%M:%S %z"
    echo "Root: $ROOT_DIR"
    if [[ -n "${MAP_FILE-}" && -f "$MAP_FILE" ]]; then
      echo "Map file: $MAP_FILE"
    else
      if [[ -f "$MAP_FILE_DEFAULT" ]]; then
        echo "Map file: $MAP_FILE_DEFAULT"
      else
        echo "Map file: (inline / mixed)"
      fi
    fi
    echo "Pairs loaded: ${#MAP_OLD[@]}"
    echo "Extensions regex: .(${EXT_REGEX})"
    echo "Excluding dirs: $(join_by ', ' "${EXCLUDE_DIRS[@]}")"
    echo
    echo "Stats:"
    echo "  Files scanned:     $TOTAL_FILES_SCANNED"
    echo "  Files with hits:   $TOTAL_FILES_WITH_HITS"
    echo "  Total occurrences: $TOTAL_OCCURRENCES"
    echo

    echo "By resource (descending hits):"
    if (( ${#FILE_HITS[@]} > 0 )); then
      for f in "${!FILE_HITS[@]}"; do
        printf "%8d  %s\n" "${FILE_HITS[$f]}" "$f"
      done | sort -rn
    else
      echo "  (none)"
    fi
    echo

    if (( ${#FILE_HITS[@]} > 0 )); then
      while IFS= read -r f; do
        local firstloc="${FILE_FIRST_LOC[$f]-1:1}"
        echo "--------------------------------------------------------------------------------"
        echo "$f:${firstloc}  — ${FILE_HITS[$f]} replacement(s)"
        awk -F'\t' -v file="$f" '$1==file { printf "  %s:%s %s --> %s\n", $2, $3, $4, $5 }' "$MATCHES_TSV"
        echo
      done < <(
        for f in "${!FILE_HITS[@]}"; do
          printf "%08d\t%s\n" "${FILE_HITS[$f]}" "$f"
        done | sort -rn | cut -f2-
      )
    fi
  } > "$LOG_FILE"
}

#######################################
# Main
#######################################
main() {
  # If user didn’t specify -r, prompt for placement to keep things explicit
  if [[ "$ROOT_DIR" == "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.." ]]; then
    interactive_placement
  fi

  # Resolve/merge mappings: explicit -m, else default file if present, then inline on top
  if [[ -n "${MAP_FILE-}" && -f "$MAP_FILE" ]]; then
    load_map_file "$MAP_FILE" || true
  elif [[ -f "$MAP_FILE_DEFAULT" ]]; then
    MAP_FILE="$MAP_FILE_DEFAULT"
    load_map_file "$MAP_FILE_DEFAULT" || true
  fi
  load_map_inline "$MAP_INLINE"

  if (( ${#MAP_OLD[@]} == 0 )); then
    echo "ERROR: No mapping entries loaded (file and inline empty)." >&2
    exit 2
  fi

  # 1) Scan
  scan_files

  # 2a) Dry-run digest OR 2b) Execute then digest
  if [[ $DRY_RUN -eq 1 ]]; then
    write_digest
  else
    execute_replacements
    write_digest
  fi

  echo "Digest written to: $LOG_FILE"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "Dry-run only. Re-run with -e to execute."
  fi
}

main "$@"
