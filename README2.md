




You said:
please do README.md


ChatGPT said:
eagles-domain-sweep
Bulk-scan a codebase for hard-coded domains/URLs and optionally rewrite them safely. Designed for large web projects and rebrands, it does a single pass per file for all pairs and produces a digest log that lists every intended or executed replacement with path:line:col anchors.

Purpose
Find & fix stale domains across HTML/CSS/JS/PHP/templates/etc.

Dry-run first for code review; then execute with backups.

Keep a complete audit log of what would change / did change.

Features
Dry-run by default – no changes until you pass -e.

Digest log (dry-run & exec) with:

Banner → stats → “by resource” ranking → unabridged per-file listing.

Each file once as a heading: full/path:line:col — N replacement(s).

Then per occurrence: line:col OLD --> NEW.

Flexible mapping:

Accepts old => new, old new (whitespace), old,new, old|new.

Inline # comments and CRLF line endings OK.

Map from file (-m) or inline (-i "a=>b,c=>d").

Memory-friendly: reads each file once and checks all pairs via AWK.

Safe replacements: literal match for OLD; NEW is escaped for safety.

Backups per file (-b .bak).

Scope control: root dir (-r), extension regex (-E), directory excludes (-x).

Portable Bash (Linux; macOS with GNU findutils).

Requirements
Linux (recommended) or macOS with GNU find (brew install findutils).

bash 4+, awk, perl.

Read/write perms in the target tree.

Install
Place the script in your repo, e.g.:

swift
Copy
Edit
/home/eagles/dockerz/efast-copy/scripts/eagles-domain-sweep.sh
(Optional) Create a map file next to it:

swift
Copy
Edit
/home/eagles/dockerz/efast-copy/scripts/domains.map
Make the script executable:

bash
Copy
Edit
chmod +x /home/eagles/dockerz/efast-copy/scripts/eagles-domain-sweep.sh
Example domains.map
txt
Copy
Edit
# Recommended "=>" form
www.eagles.edu.vn => www.thuvien.eagles.edu.vn
http://eagles.edu.vn => https://eagles.edu.vn

# Also accepted:
old,new
old | new
old    new           # whitespace delimited
# comments allowed
Usage (quick start)
bash
Copy
Edit
# 1) Dry-run the repo (defaults: project root, scripts/domains.map if present)
./scripts/eagles-domain-sweep.sh

# 2) Execute with backups
./scripts/eagles-domain-sweep.sh -e -b .bak

# Custom root & map; exclude more dirs; limit to html/css/js
./scripts/eagles-domain-sweep.sh -r /var/www/site \
  -m /var/www/site/domains.map \
  -x public_html/vendor -x .cache \
  -E 'html?|css|js'

# One-off inline mapping (no file)
./scripts/eagles-domain-sweep.sh -i 'http://old.com=>https://new.com,www.old.com=>www.new.com'

# Custom digest location
./scripts/eagles-domain-sweep.sh -l /tmp/sweep.digest.log
Flags & Defaults
Flag	Arg	Purpose	Default
-r	<root>	Root directory to scan.	Parent of scripts/ (repo root)
-m	<mapfile>	Mapping file path.	scripts/domains.map if present; otherwise none
-i	"<inline>"	Inline pairs, comma-separated (e.g., "a=>b,c=>d").	None
-l	<logfile>	Digest output file.	scripts/sweep.digest.log
-e	—	Execute replacements (write to files).	Off (dry-run)
-n	—	Force dry-run (overrides -e).	On by default
-x	<dirname>	Exclude a directory name (repeatable).	.git, .vscode, node_modules, vendor, dist, build, .cache, .undo, .next, coverage, tmp, logs
-E	<regex>	File extensions regex to scan.	`html?
-b	<ext>	Keep per-file backup with this extension.	None
-h	—	Help.	—

If no -m or -i is provided, the script auto-looks for scripts/domains.map. If still not found, it exits with an error.

Digest Log (format)
Default location:
/home/eagles/dockerz/efast-copy/scripts/sweep.digest.log

Structure:

Banner – mode (DRY-RUN or EXECUTED), timestamp, root, map info, extension filter, excludes.

Stats – files scanned, files with hits, total occurrences, files changed (exec).

By resource (descending hits) – ranking of files by number of matches.

Per-file (unabridged) – one heading per file with first hit position:

sql
Copy
Edit
/full/path/to/file.ext:123:9 — 7 replacement(s)
  123:9  OLD --> NEW
  145:1  OLD --> NEW
  208:15 OLD --> NEW
  ...
On execute, the digest is overwritten with actual results and updated stats.

Sample snippet
yaml
Copy
Edit
=== eagles-domain-sweep — DRY-RUN ===
when: 2025-07-27 00:12:32 +0700
root: /home/eagles/dockerz/efast-copy
map:  scripts/domains.map (2 pairs)
ext:  html?|css|js|mjs|ts|tsx|json|xml|svg|txt|md|php|tpl|jinja|ejs|conf|config|ini
x:    .git,.vscode,node_modules,vendor,dist,build,.cache,.undo,.next,coverage,tmp,logs

Files scanned:  612
Files w/ hits:  38
Occurrences:    124

— by resource (top) —
  17 /home/.../esl/page1.html
  11 /home/.../index.html
  10 /home/.../app.js
  ...

/home/.../index.html:44:13 — 11 replacement(s)
  44:13  http://eagles.edu.vn --> https://eagles.edu.vn
  89:5   www.eagles.edu.vn --> www.thuvien.eagles.edu.vn
  ...
Best-practice workflow
Stage changes or work on a feature branch.

Dry-run and review the digest:

bash
Copy
Edit
./scripts/eagles-domain-sweep.sh -l /tmp/sweep.digest.log
less /tmp/sweep.digest.log
Adjust scope: -r (root), -E (extensions), -x (excludes).

Execute with backups on first pass:

bash
Copy
Edit
./scripts/eagles-domain-sweep.sh -e -b .bak
Inspect diffs, then remove backups when satisfied.

Mapping Rules (details)
One pair per line.

Accepts any of:

old => new (recommended)

old new (any whitespace)

old,new

old|new

Trailing # comment allowed.

Blank lines ignored.

If either side missing, line is skipped with a warning.

Performance & scaling
Single pass per file for all pairs (AWK assisted).

If you hit memory pressure:

Narrow root with -r.

Tighter -E (e.g. html?|css|js).

Add more -x excludes (e.g., -x vendor -x dist -x .cache).

Safety
Dry-run first, always.

Use -b .bak on your first execute run.

Replacements treat OLD as a literal (no regex surprises) and NEW is escaped (/, \, &) to avoid breakage.

Troubleshooting
“No mapping entries loaded” → Provide -m or -i, or create scripts/domains.map.

“Killed” → System OOM; reduce scope with -r, -E, -x.

macOS → Use GNU find (gfind) or run on Linux.

License
MIT (or your preferred repo license).










Thought for 13s
eagles-domain-sweep
Finds and replaces domain/URL strings across a codebase with a rock-solid, reviewable workflow:

Dry-run (no changes) →

Human-readable digest log of every intended replacement (with path:line:col old → new) →

Execute mode (safe write with backups) → same digest overwritten with final results + stats.

Perfect for multi-site migrations (e.g., http://eagles.edu.vn → https://eagles.edu.vn, www.thuvien.eagles.edu.vn → library.eagles.edu.vn) across HTML/CSS/JS/PHP/etc., while skipping build artifacts and vendor dirs.

✨ Features
Dry-run by default (no surprises)

Execute mode with on-disk backups (.bak by default)

Digest log: banner → stats → per-file headings → every old → new pair listed with line:col

Domain map file (external) or inline CLI mapping

Extension filter (regex): target only relevant text files

Directory excludes (repeatable)

Idempotent & resume-friendly (uses backups; no partial write on failure)

No binary edits (skips non-text by design)

Exit codes suitable for CI

🚦 Requirements
Linux/macOS, bash ≥ 4.0

Standard tools: grep, sed, awk, sort, uniq, date, mktemp

Optional: shellcheck (for linting)

📦 Install
Quick copy
bash
Copy
Edit
# assuming repo root at /home/eagles/dockerz/efast-copy
cp scripts/eagles-domain-sweep.sh /usr/local/bin/eagles-domain-sweep
chmod +x /usr/local/bin/eagles-domain-sweep
Via Makefile (if you used the provided one)
bash
Copy
Edit
make install
# installs as /usr/local/bin/eagles-domain-sweep
🗺️ Domain map
Create a domains.map file listing OLD → NEW per line. Supported formats:

bash
Copy
Edit
# comments and blank lines allowed
OLD NEW
OLD=>NEW
"OLD value with space" => "NEW value with space"
www.eagles.edu.vn  www.thuvien.eagles.edu.vn
http://eagles.edu.vn  https://eagles.edu.vn
Rules:

Lines starting with # are ignored.

Whitespace-separated or => are both accepted.

Quotes are optional; use quotes if a value contains spaces.

Every line must contain both OLD and NEW. The tool warns and skips malformed rows.

Put it next to the script (default lookup) or point to it with -m.

🚀 Quick start
bash
Copy
Edit
# 1) Dry-run (no changes); writes digest log
eagles-domain-sweep -r /home/user/domain.name\
  -m /home/eagles/dockerz/efast-copy/scripts/domains.map \
  -l /home/eagles/dockerz/efast-copy/scripts/sweep.digest.log

# 2) Review the digest
less /home/eagles/dockerz/efast-copy/scripts/sweep.digest.log

# 3) Execute (writes changes; keeps *.bak backups)
eagles-domain-sweep -r /home/user/domain.name\
  -m /home/eagles/dockerz/efast-copy/scripts/domains.map \
  -e -b .bak \
  -l /home/eagles/dockerz/efast-copy/scripts/sweep.digest.log
Tip: You can also inject inline mapping (good for quick tests):

bash
Copy
Edit
eagles-domain-sweep -r /var/www/site \
  -i 'http://old.com=>https://new.com,www.old.com=>www.new.com'
⚙️ CLI reference
Flag	Arg	Default	Purpose
-r	<root>	required	Root folder to scan & modify.
-m	<mapfile>	scripts/domains.map (if exists)	External mapping file (see “Domain map”).
-i	OLD=>NEW[,OLD=>NEW...]	(none)	Inline mapping (comma-separated). Adds to/overrides mapfile.
-E	<regex>	`html?	css
-x	<dir>	repeatable; default: .git .vscode node_modules vendor dist build .cache .undo .next coverage tmp logs	Exclude directories. Repeat -x dir as needed.
-e	—	(dry-run)	Execute mode (actually writes changes).
-b	<ext>	.bak	Backup extension for originals (only when -e).
-l	<file>	scripts/sweep.digest.log (if resolvable)	Digest log path (overwritten each run).
-h	—	—	Help/usage.

Defaults (when flags omitted):

Mode: dry-run

Backups: enabled only in execute mode

Map file: auto-resolved near the script; warn if missing and no -i

Extensions: common web/text types (see -E above)

Excludes: sensible build/vendor caches (see -x above)

📄 Digest log format
On each run the digest log is overwritten with:

Banner (tool, timestamp, root, mode)

Stats (files scanned, matches found, pairs planned/executed)

Per-file sections. Each file appears once as a heading:

bash
Copy
Edit
/full/path/to/file.html:12:34
12:34   http://eagles.edu.vn  →  https://eagles.edu.vn
45:10   www.thuvien.eagles.edu.vn  →  library.eagles.edu.vn
88:5    //eagles.edu.vn  →  https://eagles.edu.vn
The heading includes the first match location (line:col) so editors can jump to it.

Each subsequent line lists line:col old → new for every occurrence (no abridging).

Totals (planned or executed) with file & occurrence counts, and run duration.

🧯 Safety & best practices
Dry-run first. The digest is the contract—review it before executing.

Backups: In execute mode, original files are kept as filename.ext.bak (configurable).

Restore: To roll back, delete the modified file and rename its .bak back to the original name.

Permissions: Run with sufficient rights for the tree you’re editing.

Binary safety: Only targeted text extensions are scanned; others are skipped.

Scope: Add -x for heavy folders you don’t want to scan (e.g., -x public/uploads).

🧪 Examples
Dry-run entire site with custom excludes

bash
Copy
Edit
eagles-domain-sweep -r /var/www/site \
  -m /var/www/site/scripts/domains.map \
  -x .git -x node_modules -x public/vendor -x storage \
  -l /var/www/site/sweep.digest.log
Execute with non-standard extensions and different backup suffix

bash
Copy
Edit
eagles-domain-sweep -r /var/www/site \
  -m /var/www/site/domains.map \
  -E 'html?|css|js|json|tpl|twig|php|conf|ini|yml' \
  -e -b .orig \
  -l /var/www/site/sweep.digest.log
Inline only (no map file)

bash
Copy
Edit
eagles-domain-sweep -r /srv/web \
  -i 'http://old.local=>https://new.local,cdn.old.local=>cdn.new.local'
Minimal (use defaults)

bash
Copy
Edit
# if scripts/domains.map exists next to the script
eagles-domain-sweep -r /home/eagles/dockerz/efast-copy
🛠️ Troubleshooting
“Mapping file not found”
Provide -m /path/to/domains.map or use -i for inline pairs.

“Killed” (out of memory)
Narrow the scan: add more -x excludes, tighten -E extensions, or run in chunks per subfolder.

“Permission denied”
Run with appropriate privileges (e.g., sudo) for files under the root.

Columns look off by a few chars
Columns are computed from the first byte position on the line; tabs or multibyte characters can visually offset in some editors. Lines and replacements are still accurate.

Backups piling up
After validating the run, you can clean them:

bash
Copy
Edit
find /your/root -type f -name '*.bak' -print -delete
Validate script syntax

bash
Copy
Edit
shellcheck scripts/eagles-domain-sweep.sh
🤝 Contributing
PRs and issues welcome! Please include:

Your map and a small anonymized sample file set that reproduces the case

The exact command you ran

Your digest log (dry-run) excerpt

📄 License
MIT — see LICENSE if provided; otherwise consider this under MIT terms by default.

🧭 Project layout (suggested)
arduino
Copy
Edit
repo-root/
  scripts/
    eagles-domain-sweep.sh
    domains.map
    sweep.digest.log       # generated
  Makefile                 # optional (see provided)
  README.md                # this file
If you want, I can also drop in a sample domains.map tailored to your domains, and a .editorconfig to keep LF endings and UTF-8 consistent.








Sources
You said:
drop in a sample domains.map tailored to your domains, and a .editorconfig to keep LF endings and UTF-8 consistent.


ChatGPT said:

Thought for 22s
Sweet—here are paste-ready files.

/home/eagles/dockerz/efast-copy/scripts/domains.map
text
Copy
Edit
# Domain/URL migrations for eagles sites
# Format: OLD => NEW
# Tip: Order from most-specific to least-specific to avoid double-changes.

# --- Canonicalize scheme to HTTPS (www)
http://www.eagles.edu.vn => https://www.eagles.edu.vn
http://www.thuvien.eagles.edu.vn => https://www.thuvien.eagles.edu.vn

# --- Canonicalize scheme to HTTPS (no-www)
http://eagles.edu.vn => https://eagles.edu.vn
http://thuvien.eagles.edu.vn => https://thuvien.eagles.edu.vn

# --- Optional “remove www” canonicalization (uncomment if desired)
# https://www.eagles.edu.vn => https://eagles.edu.vn
# https://www.thuvien.eagles.edu.vn => https://thuvien.eagles.edu.vn

# --- Optional migrate thuvien subdomain to a new canonical (example)
# https://thuvien.eagles.edu.vn => https://library.eagles.edu.vn
# https://www.thuvien.eagles.edu.vn => https://library.eagles.edu.vn

# --- Handle scheme-less URLs (//host) if they appear in code
//www.eagles.edu.vn => https://www.eagles.edu.vn
//eagles.edu.vn => https://eagles.edu.vn
//www.thuvien.eagles.edu.vn => https://www.thuvien.eagles.edu.vn
//thuvien.eagles.edu.vn => https://thuvien.eagles.edu.vn

# --- (Optional) CDN/static hosts to HTTPS
# http://cdn.eagles.edu.vn => https://cdn.eagles.edu.vn
# http://static.eagles.edu.vn => https://static.eagles.edu.vn

# NOTE: Avoid naked token replacements like:
#   eagles.edu.vn => eagles.edu.vn
# unless you really intend substring-level changes across all contexts.
/home/eagles/dockerz/efast-copy/.editorconfig
ini
Copy
Edit
# Keep line-endings, charset, and indentation consistent across the repo
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

# Shell scripts
[*.sh]
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

# Makefile must use tabs
[Makefile]
indent_style = tab

# JSON / YAML / YML
[*.{json,yml,yaml}]
indent_size = 2

# HTML / CSS / JS / TS
[*.{html,htm,css,js,mjs,ts,tsx}]
indent_size = 2

# Markdown: keep trailing spaces (they mean hard line-breaks)
[*.md]
trim_trailing_whitespace = false