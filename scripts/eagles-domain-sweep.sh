#!/usr/bin/env bash
# eagles-domain-sweep.sh
# Scan a tree for hard-coded domains and (optionally) replace them.
# DRY-RUN: writes a digest of all intended replacements.
# EXECUTE: performs replacements and writes the same digest as "EXECUTED".

set -Eeuo pipefail

#######################################
# Defaults & globals
#######################################
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."                         # default root: parent of scripts/
MAP_FILE_DEFAULT="$SCRIPT_DIR/domains.map"        # default external map file
MAP_FILE=""                                       # -m path (optional)
MAP_INLINE=""                                     # -i "old=>new,old2=>new2"
LOG_FILE="$SCRIPT_DIR/domain.update.digest.log"           # digest output path
DRY_RUN=1                                         # dry-run by default
BACKUP_EXT=""                                     # e.g. ".bak" to keep backups
EXT_REGEX='html?|css|js|mjs|ts|tsx|json|xml|svg|txt|md|php|tpl|jinja|ejs|conf|config|ini'

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
  # Portable-ish absolute path resolver
  local p="${1-}"
  if [[ "$p" == /* ]]; then
    printf '%s\n' "$p"
  else
    printf '%s\n' "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
  fi
}

print_usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Scan and replace domains using a mapping list.

Options:
  -r <root>       Root directory to scan (default: $ROOT_DIR)
  -m <mapfile>    Mapping file path (default: $MAP_FILE_DEFAULT if present)
                  Lines can be "old => new" or "old<ws>new". '#' starts a comment.
  -i "<inline>"   Inline mappings, comma-separated, e.g.:
                    "http://old.com=>https://new.com,old2=>new2"
  -l <logfile>    Digest log output (default: $LOG_FILE)
  -e              Execute replacements (default: dry-run)
  -n              Dry-run (overrides -e)
  -x <dir>        Additional directory name to exclude (can repeat)
  -E <regex>      File extension regex (default: $EXT_REGEX)
  -b <ext>        Keep per-file backup with this extension (e.g. .bak)
  -h              Help

Digest format:
- Banner + run details
- Stats
- By-resource ranking (all files with hits)
- Per-file section:
    /abs/path:first_line:first_col — N replacement(s)
      line:col OLD --> NEW
      line:col OLD --> NEW
      ...
EOF
}

#######################################
# CLI parsing
#######################################
while getopts ":r:m:i:l:enx:E:b:h" opt; do
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
    h) print_usage; exit 0 ;;
    \?) echo "ERROR: Unknown option -$OPTARG" >&2; print_usage; exit 2 ;;
    :)  echo "ERROR: Option -$OPTARG requires an argument" >&2; exit 2 ;;
  esac
done

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
      # whitespace split into two fields
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

# Resolve map precedence: explicit -m, else default file, then inline merges in.
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

#######################################
# Find files builder
#######################################
build_find_cmd() {
  # Build: find ROOT \( -path '*/EX/*' -o ... \) -prune -o -type f -regex '.*\.(exts)$' -print
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
# Scan: collect every match (file, line, col, old, new)
#######################################
scan_files() {
  local find_cmd; find_cmd="$(build_find_cmd)"
  # shellcheck disable=SC2086
  while IFS= read -r file; do
    ((TOTAL_FILES_SCANNED++))
    local have_hits=0

    for ((i=0; i<${#MAP_OLD[@]}; i++)); do
      local old="${MAP_OLD[$i]}" new="${MAP_NEW[$i]}"
      # Output every occurrence with 1-based column
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

    # Count hits for this file
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
# Execute replacements (based on MATCHES_TSV)
#######################################
execute_replacements() {
  [[ -s "$MATCHES_TSV" ]] || return 0
  # Iterate files with hits (descending by hit count for nice progress)
  while IFS= read -r f; do
    [[ -f "$f" ]] || continue

    # Unique old/new pairs for this file
    mapfile -t pairs < <(awk -F'\t' -v file="$f" '$1==file{print $4 "\t" $5}' "$MATCHES_TSV" | sort -u)
    [[ ${#pairs[@]} -eq 0 ]] && continue

    # Optional backup
    if [[ -n "$BACKUP_EXT" && ! -e "${f}${BACKUP_EXT}" ]]; then
      cp -p -- "$f" "${f}${BACKUP_EXT}" || true
    fi

    # Build a single perl -pe chain using safe escaping
    # - We use \Q...\E for the pattern
    # - In the replacement, escape \, /, and & to avoid special handling
    declare -a perl_args=()
    for line in "${pairs[@]}"; do
      local old="${line%%$'\t'*}"
      local new="${line#*$'\t'}"
      local rep="${new//\\/\\\\}"
      rep="${rep//\//\\/}"
      rep="${rep//&/\\&}"
      perl_args+=( "-e" "BEGIN{binmode(STDIN);binmode(STDOUT)} s/\\Q${old//\\/\\\\}\\E/${rep}/g" )
    done

    perl -0777 -i "$f" "${perl_args[@]}"
  done < <(
    for k in "${!FILE_HITS[@]}"; do
      printf "%08d\t%s\n" "${FILE_HITS[$k]}" "$k"
    done | sort -rn | cut -f2-
  )
}

#######################################
# Digest writer (overwrites LOG_FILE)
#######################################
write_digest() {
  local mode_str
  if [[ $DRY_RUN -eq 1 ]]; then
    mode_str="DRY-RUN (no files modified)"
  else
    mode_str="EXECUTED (files modified)"
  fi

  {
    echo "=== EAGLES DOMAIN SWEEP — ${mode_str} ==="
    date +"Run: %Y-%m-%d %H:%M:%S %z"
    echo "Root: $ROOT_DIR"
    if [[ -n "${MAP_FILE-}" && -f "$MAP_FILE" ]]; then
      echo "Map file: $MAP_FILE"
    else
      echo "Map file: (inline / mixed)"
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
  # 1) Scan and compile matches
  scan_files

  if [[ $DRY_RUN -eq 1 ]]; then
    # 2a) Dry-run digest (planned)
    write_digest
  else
    # 2b) Execute replacements using the planned matches, then write digest
    execute_replacements
    write_digest
  fi

  echo "Digest written to: $LOG_FILE"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "Dry-run only. Re-run with -e to execute."
  fi
}

main "$@"
