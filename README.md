# EagleEye Domain Name Updater

---
![bash](https://img.shields.io/badge/shell-bash%204%2B-4EAA25?logo=gnu-bash&logoColor=white)
![Linux](https://img.shields.io/badge/platform-Linux-blue?logo=linux)
![macOS](https://img.shields.io/badge/platform-macOS-blue?logo=apple)
![WSL2](https://img.shields.io/badge/platform-WSL2-blue?logo=windows)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Overview

**EagleEye Domain Name Updater** scans a codebase for **hard‑coded domains/URLs**
and can **safely  back-up (.bak) and rewrite** them using a simple mapping file.
It’s fast, memory‑friendly, and produces a clear digest of what changed.

- **Bulk scan** across large trees
- **Safe rewrite** using a **map file**
- **Auto backup** changed files for safe back-up (.bak) undoing changes
- **Forgiving parser** (ignores blank lines, comments, extra spaces)
- **Digest log**: grouped, human‑readable report
- Simple CLI designed **for novices and power users**

---

## Table of Contents

1. [EagleEye Domain Name Updater](#eagleeye-domain-name-updater)
   1. [Overview](#overview)
   2. [Table of Contents](#table-of-contents)
   3. [$\\color{Red}{\\textsf{|}}$ Important $\\color{Red}{\\textsf{|}}$](#colorredtextsf-important-colorredtextsf)
      1. [Paths \& map format](#paths--map-format)
   4. [Program's Purpose](#programs-purpose)
   5. [Features](#features)
   6. [Requirements](#requirements)
   7. [Install (Ubuntu 22.04 + CyberPanel/OLSWS layout)](#install-ubuntu-2204--cyberpanelolsws-layout)
      1. [Example `domains.map`](#example-domainsmap)
   8. [Quick start (Ubuntu 22.04 paths)](#quick-start-ubuntu-2204-paths)
      1. [1) Dry-run (default)](#1-dry-run-default)
      2. [2) Apply changes (with per-file backups)](#2-apply-changes-with-per-file-backups)
      3. [3) One-off run with **inline** pairs (no map file)](#3-one-off-run-with-inline-pairs-no-map-file)
   9. [Sample digest (dry-run)](#sample-digest-dry-run)
   10. [Troubleshooting](#troubleshooting)

---

## $\color{Red}{\textsf{|}}$ Important $\color{Red}{\textsf{|}}$

### Paths & map format
>
- **Paths in all examples use Ubuntu 22.04 + CyberPanel/OpenLiteSpeed defaults:**

> `/home/user/<domain>/public_html` is the webroot.
>
> ### $\color{Red}{\textsf{|}}$ Your webroot may differ  $\color{Red}{\textsf{|}}$
>

- **$\color{Red} {\textsf{WARNING}}$**
**Examples:**
- **cPanel**: `/home/user/public_html`,
>
- **Plesk**: `/var/www/vhosts/<domain>/httpdocs`,
- **Debian/Apache**: `/var/www/html`.<br><br>**Point** `-r` flag to **your** webroot.
>

> **NOTE: Mapping format used below:**
>
> - `old => new`.

The tool also accepts

- `old new` (whitespace),
- `old,new`, and
- `old|new`.

## Program's Purpose

**Find and fix stale domains during rebrands/migrations**
(e.g., `http://example-old.com` → `https://example-new.com`).

- Update large web projects (HTML/CSS/JS/PHP/templating/etc.) without loading entire trees into memory.
- Produce a dry-run report for code review before touching files.
- When you execute, it escapes safely and can keep per-file backups.

## Features

- **Dry-run by default** (zero changes until you pass `-e`).
- Full digest log (dry-run & executed): banner → stats → per-file hits → every occurrence.
- Forgiving map formats & inline comments.
- Inline (`-i`) or file-based (`-m`) mappings.
- Memory-friendly: single read per file for all pairs.
- Safe replacements: literal matching, escaping, and backups (`-b .bak`).

## Requirements

- Linux or macOS (on macOS use GNU `find`).
- `bash` 4+, `awk`, `perl`.
- Read/write permissions for target files.

## Install (Ubuntu 22.04 + CyberPanel/OLSWS layout)

Place script and optional map alongside each other:

```
/home/user/example.net/scripts/eagleeye-domain-updater.sh
/home/user/example.net/scripts/domains.map
```

Make executable:

```bash
chmod +x /home/user/example.net/scripts/eagleeye-domain-updater.sh
```

### Example `domains.map`

**Preferred format:** `old => new` (spaces optional). Comments with `#` allowed.

```
# Primary domain
>
example-old.com            => example-new.com
> www.example-old.com        => www.example-new.com
http://example-old.com     => https://example-new.com

# Secondary domain set
example2-old.com           => example2-new.com
www.example2-old.com       => www.example2-new.com
http://example2-old.com    => https://example2-new.com

# Subdomain migration
subdomain-old.example.com  => subdomain-new.example.com

# TLD shifts (if applicable)
example.net                => example.com
example2.net               => example2.com
```

Also supported (mix-and-match if you prefer):

```
example-old.com,https://example-new.com
example2-old.com | https://example2-new.com
subdomain-old.example.com   subdomain-new.example.com
```

## Quick start (Ubuntu 22.04 paths)

### 1) Dry-run (default)

```bash
/home/user/example.net/scripts/eagleeye-domain-updater.sh \
  -r /home/user/example.net/public_html \
  -m /home/user/example.net/scripts/domains.map \
  -E '\.(php|html?|js|css)$' \
  -x vendor -x node_modules \
  -l /home/user/example.net/scripts/domain-update.digest.log
```

### 2) Apply changes (with per-file backups)

```bash
/home/user/example.net/scripts/eagleeye-domain-updater.sh \
  -r /home/user/example.net/public_html \
  -m /home/user/example.net/scripts/domains.map \
  -E '\.(php|html?|js|css)$' \
  -e -b .bak \
  -l /home/user/example.net/scripts/domain-update.digest.log
```

### 3) One-off run with **inline** pairs (no map file)

```bash
/home/user/example.net/scripts/eagleeye-domain-updater.sh \
  -r /home/user/example.net/public_html \
  -i "example-old.com=>example-new.com,example2-old.com=>example2-new.com,subdomain-old.example.com=>subdomain-new.example.com"
```

**Priority:** `-i` (inline) overrides `-m` (file).
**Safety:** Dry-run is default. `-e` applies changes; `-n` forces dry-run if both are present.

## Sample digest (dry-run)

> ```
> # domain-update.digest.log — 2025-08-11 14:32:07
MODE: DRY-RUN
ROOT: /home/user/example.net/public_html
MAP:
  example-old.com            => example-new.com
  <www.example-old.com>        => <www.example-new.com>
  example2-old.com           => example2-new.com
  subdomain-old.example.com  => subdomain-new.example.com
  example.net                => example.com
  example2.net               => example2.com
EXCLUDES: .git, .vscode, node_modules, vendor, dist, build, .cache, .undo, .next, coverage, tmp, logs
EXT-REGEX: \.(php|html?|js|css)$
BACKUP: none

SCAN STATS:
  Files scanned: 143
  Files matched: 87
  Replacements (preview): 236

FILES:
  [php] /home/user/example.net/public_html/templates/sj_onepage/index.php
    12  <https://www.example-old.com>    → <https://www.example-new.com>
    48  //example-old.com               → //example-new.com
  [css] /home/user/example.net/public_html/assets/fonts/fontxz.css
    1   <https://example2-old.com>       → <https://example2-new.com>

SUMMARY: No files changed (dry-run). Re-run with -e to apply, or add -b .bak to keep backups.

```

## Command-line flags & defaults

| Flag | Arg         | Purpose                                                                                                  | Default                                                                                       |
|------|-------------|----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| `-r` | `<root>`    | Root directory to scan (point this to **your webroot**; examples use `/home/user/<domain>/public_html`). | `-`                                                                                           |
| `-m` | `<mapfile>` | Path to mapping file. Uses `scripts/domains.map` if present; otherwise none.                             | Automatically looks beside the script, then in `scripts/`.                                    |
| `-i` | `<inline>`  | Inline map pairs, comma-separated (e.g., `"old=>new,old2=>new2"`).                                       | `None`                                                                                        |
| `-l` | `<logfile>` | Digest output file.                                                                                      | `scripts/domain-update.digest.log`                                                            |
| `-e` | —           | Execute replacements (not just dry-run).                                                                 | Off (dry-run by default)                                                                      |
| `-n` | —           | Force dry-run (overrides `-e`).                                                                          | On by default                                                                                 |
| `-x` | `<dirname>` | Exclude a directory name (**repeatable**).                                                               | `.git, .vscode, node_modules, vendor, dist, build, .cache, .undo, .next, coverage, tmp, logs` |
| `-E` | `<regex>`   | Regex for file extensions to scan.                                                                       | `html?`                                                                                       |
| `-b` | `<ext>`     | Keep a per-file backup using this extension (e.g., `.bak`).                                              | `None`                                                                                        |
| `-h` | —           | Help.                                                                                                    | —                                                                                             |

## Best-practice workflow

1. **Stage or branch**, then run a **dry-run** and review the digest:

   ```bash
   /home/user/example.net/scripts/eagleeye-domain-updater.sh \
     -r /home/user/example.net/public_html \
     -m /home/user/example.net/scripts/domains.map \
     -l /home/user/example.net/scripts/domain-update.digest.log
   less /home/user/example.net/scripts/domain-update.digest.log
   ```

1. Tighten scope with `-E` and `-x` if needed.
2. Execute with backups:

   ```bash
   /home/user/example.net/scripts/eagleeye-domain-updater.sh \
     -r /home/user/example.net/public_html \
     -m /home/user/example.net/scripts/domains.map \
     -e -b .bak
   ```

## Troubleshooting

- **“No mapping entries loaded”** → Provide `-m` or `-i`, or create `scripts/domains.map`.
- **OOM / “Killed”** → Narrow scope with `-r`, a tighter `-E`, and more `-x` excludes.
- **Wrong paths** → Ensure `-r` points at your **actual webroot** (varies by OS/hosting/web server).
