#!/usr/bin/env python3
"""
HTML Validation Error Digest Script

- Runs Nu HTML Checker (vnu.jar)
- Extracts raw, suppressed, and grouped digest logs
- Suppressed errors are written to html-errors.suppressed.log
- Digest excludes suppressed messages and includes line:column info

Usage:
  python3 html_validator_digest.py
"""

import os
import re
import subprocess
from pathlib import Path
from collections import defaultdict

# === Constants ===
ROOT_DIR = Path(__file__).resolve().parent
VN_STATIC_PATH = "/home/eagles/tools/vnu.jar"
VNU_JAR = (ROOT_DIR / "vnu.jar") if (ROOT_DIR / "vnu.jar").exists() else Path(VN_STATIC_PATH)

RAW_LOG = ROOT_DIR / "html-errors.raw.log"
SUPPRESSED_LOG = ROOT_DIR / "html-errors.suppressed.log"
DIGEST_LOG = ROOT_DIR / "html-errors.digest.log"

SUPPRESS_PATTERNS = [
    "controlslist",
    "XML processing instruction in HTML",
    "Saw “<?”"
]

# === Run HTML Validator ===
def run_validator():
    print("🔍 Running Nu HTML Checker...")
    with RAW_LOG.open("w", encoding="utf-8") as raw_out:
        find_proc = subprocess.Popen(
            ["find", ".", "-path", "./undo", "-prune", "-o", "-type", "f", "-iname", "*.html", "-print0"],
            stdout=subprocess.PIPE
        )
        try:
            subprocess.run(
                ["xargs", "-0", "java", "-jar", str(VNU_JAR), "--skip-non-html", "--format", "text", "--errors-only"],
                stdin=find_proc.stdout,
                stdout=raw_out,
                stderr=subprocess.STDOUT,
                check=True
            )
        except subprocess.CalledProcessError as e:
            print(f"⚠️ Validator finished with non-zero exit (code {e.returncode}). Errors were logged to {RAW_LOG}.")

# === Extract and write suppressed ===
def extract_suppressed_and_filter():
    print("🪄 Filtering suppressed messages and building digest map...")
    error_map = defaultdict(lambda: defaultdict(list))  # {error: {file: [Line X:Y, ...]}}
    suppressed_lines = []

    with RAW_LOG.open("r", encoding="utf-8") as f:
        lines = list(f)
        i = 0
        while i < len(lines) - 1:
            error_match = re.match(r'^Error: (.+)', lines[i].strip())
            location_match = re.match(
                r'^From line (\d+), column (\d+);.*file:(.+)$', lines[i + 1].strip())

            if error_match and location_match:
                error_msg = error_match.group(1).strip()
                line_num = location_match.group(1)
                col_num = location_match.group(2)
                file_path = location_match.group(3).strip()
                i += 2  # Advance past this error+location

                if any(p in error_msg for p in SUPPRESS_PATTERNS):
                    suppressed_lines.extend([lines[i - 2], lines[i - 1]])
                    continue

                location = f"Line {line_num}:{col_num}"
                error_map[error_msg][file_path].append(location)
            else:
                i += 1  # Advance to next line

    # Write suppressed
    with SUPPRESSED_LOG.open("w", encoding="utf-8") as suppress_out:
        for line in suppressed_lines:
            suppress_out.write(line)

    # Write digest
    print("📊 Generating digest log...")
    with DIGEST_LOG.open("w", encoding="utf-8") as out:
        for error, files in sorted(error_map.items()):
            out.write(f"### {error} ({len(files)} {'file' if len(files) == 1 else 'files'})\n")
            for file, locations in sorted(files.items()):
                out.write(f"- {file}\n")
                for loc in sorted(set(locations)):
                    out.write(f"  - {loc}\n")
            out.write("\n")

# === Main ===
def main():
    if not VNU_JAR.exists():
        print(f"❌ Error: vnu.jar not found at expected path: {VNU_JAR}")
        exit(1)

    run_validator()
    extract_suppressed_and_filter()
    print("✅ Done.")

if __name__ == "__main__":
    main()
