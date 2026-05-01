# Inline CSS Extractor
---
![node](https://img.shields.io/badge/runtime-Node.js%2016%2B-43853d?logo=node.js&logoColor=white)
![Linux](https://img.shields.io/badge/platform-Linux-blue?logo=linux)
![macOS](https://img.shields.io/badge/platform-macOS-blue?logo=apple)
![WSL2](https://img.shields.io/badge/platform-WSL2-blue?logo=windows)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Overview

**Inline CSS Extractor** converts inline `style` attributes in HTML into **stylesheet classes** and appends them to `css/inline.css` (one CSS file per directory). It runs **only on the current directory**, is **dry-run by default**, creates a **ZIP backup before writing**, and produces a clear, reviewable log.

- **Per-directory CSS** (`./css/inline.css`)
- **Dry-run first**, then safe apply with backup
- **Atomic writes** (temp file → rename)
- **Skips** inline rules that include `display: none`
- **Digest logs** for dry-run & apply

---

## Table of Contents
[Inline CSS Extractor](#inline-css-extractor)
1. [Inline CSS Extractor](#inline-css-extractor)
   1. [Overview](#overview)
   2. [Table of Contents](#table-of-contents)
   3. [Important](#important)
      1. [Scope \& file locations](#scope--file-locations)
      2. [What is intentionally _not_ changed](#what-is-intentionally-not-changed)
   4. [Program's Purpose](#programs-purpose)
   5. [Features](#features)
   6. [Requirements](#requirements)
   7. [Install](#install)
      1. [Optional add an npm script](#optional-add-an-npm-script)
      2. [Paths \& working dir](#paths--working-dir)
   8. [Quick start](#quick-start)
      1. [1) Dry-run (default)](#1-dry-run-default)
      2. [2) Apply changes (with ZIP backup)](#2-apply-changes-with-zip-backup)
      3. [3) CI-style preview (no prompt)](#3-ci-style-preview-no-prompt)
   9. [Help banner](#help-banner)
   10. [How it works](#how-it-works)
       1. [Class naming scheme](#class-naming-scheme)
       2. [Shorthand value packing](#shorthand-value-packing)
       3. [Deduplication and idempotency\*](#deduplication-and-idempotency)
   11. [Sample digest (dry-run)](#sample-digest-dry-run)
   12. [Command-line flags \& defaults](#command-line-flags--defaults)
   13. [Best-practice workflow](#best-practice-workflow)
   14. [Troubleshooting](#troubleshooting)
   15. [Limitations \& notes](#limitations--notes)
   16. [License](#license)

---

## Important
### Scope & file locations
- Operates on `*.html` / `*.htm` files **in the current working directory only**.
  _It does **not** recurse into subdirectories._
- Outputs/updates stylesheet at **`./css/inline.css`** (creating `./css/` if missing).
- Ensures a `<link rel="stylesheet" href="css/inline.css">` is present (in `<head>` if available; otherwise prepended to `<body>`).
- Writes logs to `./inline_dry_run.log` or `./inline_apply.log`.
- On `--apply`, creates `./backup_inline_<ISO-timestamp>.zip` containing all HTML/HTM files in the current directory.

### What is intentionally _not_ changed
- Any element whose inline `style` contains **`display: none`** is **left untouched** (the entire `style` attribute is preserved).

---

## Program's Purpose
Move styling from inline attributes to CSS classes in a safe, reviewable, and repeatable way—useful when modernizing legacy HTML, improving maintainability, and reducing duplication.

## Features
- **Dry-run by default**: inspect changes safely.
- **ZIP backup** before apply.
- **Atomic writes** for HTML/CSS.
- **Readable logs**: banner → per-file classes → stats.
- **Per-directory CSS** to keep things local to each page folder.

## Requirements
- **Node.js 16+** (Node 18+/20+ recommended).
- Packages: `cheerio`, `archiver`.
  ```bash
  npm i cheerio archiver
  ```

## Install
Place the script in your project (e.g., `./scripts/inline-css-extractor.js`) and make it executable:
```bash
chmod +x ./scripts/inline-css-extractor.js
```
### Optional add an npm script
Add this block to your project’s **`package.json`**:

```json
{
  "scripts": {
    "inline-css:dry": "node ./scripts/inline-css-extractor.js",
    "inline-css:apply": "node ./scripts/inline-css-extractor.js --apply"
  }
}
```

**How to run via npm script:**
- ```npm run inline-css:dry```      # preview (no changes)
- ```npm run inlines:apply```    # apply changes (with backup)


**Run passing extra flags via npm script:**
- ```npm run inline-css:dry -- --log-only```
  - use  **--**  to pass flags through npm to your script


**Explanation**: What the `npm scripts` snippet does via npm script:

1. inline-css:dry
  - runs the extractor in dry-run mode (the default).
- Use it to preview changes; it won’t modify files.

2. inline-css:apply
-runs the extractor with --apply, which:
- creates the ZIP backup,
- writes/updates to css/inline.css in same directory as html files it edits
- updates the HTM files (then adds the <link> if needed).

**How to run**
- npm run inline-css:dry      # preview (no changes)
- npm run inlines:apply    # apply changes (with backup)

**Run passing extra flags**
- npm run inline-css:dry -- --log-only
- use **--** to pass flags through npm to your script


### Paths & working dir

> The path ./scripts/inline-css-extractor.js is relative to your package.json. Adjust it if your file lives elsewhere.

The extractor operates on the current working directory only.
- e.g., If your HTML is in public/, either ```cd public``` before running or wrap the script:

```json
{
  "scripts": {
    "inline-css:dry": "cd public && node ../scripts/inline-css-extractor.js"
  }
}
```

## Quick start

### 1) Dry-run (default)
```bash
# Run from the target directory (runs on current dir only)
node ./scripts/inline-css-extractor.js
# …or if executable:
./scripts/inline-css-extractor.js
```

### 2) Apply changes (with ZIP backup)
```bash
node ./scripts/inline-css-extractor.js --apply
```

### 3) CI-style preview (no prompt)
```bash
node ./scripts/inline-css-extractor.js --log-only
```

## Help banner
```bash
node ./scripts/inline-css-extractor.js --help
# or
node ./scripts/inline-css-extractor.js -h
```
**Output:**
```text
Usage: inline-css-extractor.js [--apply] [--log-only] [--help|-h]

Inline CSS extractor -> stylesheet classes (per-dir).
Processes only *.html / *.htm in the current working directory.

Options:
  --apply       Apply changes (creates backup ZIP first, then writes HTML/CSS)
  --log-only    Dry-run without interactive prompt (still no writes unless --apply)
  -h, --help    Show this help and exit

Behavior:
  - Leaves inline styles containing "display: none" untouched
  - Extracts other inline styles into classes, removes the style attribute
  - Appends/creates ./css/inline.css (per current directory)
  - Ensures <link rel="stylesheet" href="css/inline.css"> exists
  - Safe writes (temp file + rename) for HTML and CSS
  - Backups (on --apply): backup_inline_<ISO-timestamp>.zip in current directory
  - Logs: inline_dry_run.log (dry) or inline_apply.log (apply)

Examples:
  inline-css-extractor.js                 # dry-run with prompt
  inline-css-extractor.js --log-only      # dry-run no prompt (CI-friendly)
  inline-css-extractor.js --apply         # apply changes (writes files after backup)

Exit codes:
  0 on success; 1 on unexpected error.
```

## How it works
1. **Parse HTML** via Cheerio, scanning elements with a `style` attribute.
2. **Skip** any element whose inline style contains `display: none`.
3. **Normalize declarations** and generate a **composite class name** from property/value tokens.
4. **Attach class** to the element; **remove** the `style` attribute.
5. **Append CSS** for new classes to `./css/inline.css` (created if missing).
6. **Ensure link tag** to `css/inline.css` exists in the HTML.
7. **Log** classes per file and final stats to `inline_*.log`.

### Class naming scheme

- Base form:
   <br><br>
  ```txt
  .in-<prop1>-<val1>_<prop2>-<val2>__<hash>
  ```
- **Property slugs** (subset):
  `line-height: lh`, `text-indent: text-indent`, `margin: mar`, `padding: pad`, `box-shadow: bsh`,
  `font-weight: w`, `color: c`, `background-color: bgc`, `background: bg`, `border-radius: br`,
  `letter-spacing: ls`, `word-spacing: ws`.
  <br><br>
- **Value tokenization (highlights)**:
  - Numbers: `.` → `pt` (e.g., `1.5em` → `1pt5m`), negatives prefixed with `n` (e.g., `-0.35in` → `n0pt35in`).
  - Units: `%` → `pct`, `em` → `m`, `rem` → `rm`, `px/in/cm/mm/pt` unchanged.
  - Non-alphanumerics sanitized; spaces → `-`. Underscores are preserved.
- **Mode:** composite (multiple `prop-val` tokens joined by `_`) with a short stable `__hash` suffix.

### Shorthand value packing
For `margin`, `padding`, and `box-shadow`:
- If **all numeric values share the same unit**, the **first** token carries the unit and the rest **omit** it (`10px 20px` → `10px-20`).
- If units **differ or include unitless values**, every numeric token retains its unit.

### Deduplication and idempotency<sup>*</sup>
- **Per-file de-dup** within a single run: identical declaration sets on the same file share a class.
- **Across files:** classes are generated independently; the script **naively appends** CSS. It does **not** diff against pre-existing `inline.css`, so repeated applies can accumulate duplicates if HTML still references the same inline styles.


<sup>*</sup>Idempotency, in the context of computer systems, refers to the property of an operation where applying it multiple times has the same effect as applying it once.

## Sample digest (dry-run)
```text
DRY-RUN (composite; safe-writes:on; current-dir)
================================

/var/www/site/page.html
  + class: in-color-333_bgc-fff_pad-10px-20__2k4v1h
  + class: in-w-700_lh-1pt4__9r3q8c
  + added <link rel="stylesheet" href="css/inline.css">

/var/www/site/about.htm
  + class: in-text-indent-2m_ls-0pt5__b1f92p

Stats:
  Files (scanned): 3
  Files (changed): 2
  Conversions (sum): 7
  New classes: 3
  Avg changes/file (changed only): 3.50
  Errors: 0
```

## Command-line flags & defaults

| Flag           | Arg | Purpose                                                        | Default       |
|----------------|-----|----------------------------------------------------------------|---------------|
| `--apply`      | —   | Execute changes (creates ZIP backup, writes HTML & CSS).       | Off (dry-run) |
| `--log-only`   | —   | Dry-run without interactive prompt (useful in CI).             | Off           |
| `-h`, `--help` | —   | Show help and exit.                                            | —             |

**Behavioral defaults (compiled in):**
- **Scope:** current directory only.
- **Output CSS:** `./css/inline.css`.
- **Skip rule:** leave inline styles containing `display: none`.
- **Safe writes:** on (temp + rename).
- **Logs:** `inline_dry_run.log` (dry), `inline_apply.log` (apply).
- **Backup:** `backup_inline_<timestamp>.zip` (apply only).

## Best-practice workflow
1. **Navigate** to the target folder (the one containing your HTML files).
2. **Run a dry-run** and review the log:
   ```bash
   node ./scripts/inline-css-extractor.js --log-only
   less ./inline_dry_run.log
   ```
3. **Commit or stash** your working tree (optional but recommended).
4. **Apply with backup**:
   ```bash
   node ./scripts/inline-css-extractor.js --apply
   ```
5. **Verify pages** in a browser and review `./css/inline.css`.

## Troubleshooting
- **“Backup failed” in apply mode**
  Ensure the process can write to the current directory and that no antivirus/FS policy blocks ZIP creation.
- **“No HTML files changed (dry-run)” but you expected changes**
  Confirm your inline rules don’t include `display: none` (those are skipped), and that you’re in the correct directory.
- **Duplicate class blocks in `css/inline.css` after multiple runs**
  Expected: the app appends naively. If this becomes noisy, de-dupe with a CSS post-processor once you’re done extracting.
- **Cheerio / archiver not found**
  Install dependencies: `npm i cheerio archiver`.
- **Restoring files**
  Unzip `backup_inline_<timestamp>.zip` in the same directory to revert the HTML files to their pre-apply state.

## Limitations & notes
- **No subdirectory traversal.** To process a tree, run the tool per folder (or wrap it in a small shell loop).
- **Selective skipping is all-or-nothing** for a given element: if `display: none` appears anywhere in the style, the element’s entire inline style is left in place.
- **No awareness of pre-existing CSS**: the tool doesn’t diff or merge with handcrafted styles.
- **Per-file class reuse only**: identical inline declarations in different files will generate separate class definitions (same or similar names) and each will be appended.

## License
MIT License. See `LICENSE` for details. Enjoy! 😊
