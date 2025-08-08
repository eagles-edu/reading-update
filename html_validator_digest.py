#!/usr/bin/env python3
"""
HTML Validation Error Digest Script

- Recursively runs Nu HTML Checker (vnu.jar)
- Writes raw, filtered (digest), and ignored logs
"""

import os
import subprocess
import sys

# Constants
RAW_LOG = "html-errors.raw.log"
FILTERED_LOG = "html-errors.filtered.log"
IGNORED_LOG = "html-errors.ignored.log"
SUPPRESS_PATTERNS = [
    "controlslist",
    "Saw “<?”",
    "XML processing instruction in HTML"
]

def run_validator(target_path, jar_path="vnu.jar"):
    cmd = [
        "java", "-jar", jar_path,
        "--errors-only", "--exit-zero-always", "--skip-non-html",
        "--format", "gnu", target_path
    ]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            check=False, text=True
        )
    except FileNotFoundError:
        raise RuntimeError("Java not found. Ensure Java is installed and in your PATH.")
    return result.stdout

def filter_output(raw_text):
    kept_lines = []
    suppressed_lines = []

    for line in raw_text.splitlines():
        if any(pat in line for pat in SUPPRESS_PATTERNS):
            suppressed_lines.append(line)
        else:
            kept_lines.append(line)

    return kept_lines, suppressed_lines

def summarize_ignored(suppressed_lines):
    summary = [f"Ignored {len(suppressed_lines)} suppressed line(s) matching:"]
    for pat in SUPPRESS_PATTERNS:
        count = sum(1 for line in suppressed_lines if pat in line)
        summary.append(f" - '{pat}': {count} line(s)")
    return "\n".join(summary)

def parse_validator_output(lines):
    error_map = {}
    for line in lines:
        if ": error: " in line:
            location_part, message = line.split(": error: ", 1)
        elif ": warning: " in line:
            location_part, message = line.split(": warning: ", 1)
        else:
            continue
        file_path = location_part.split(":", 1)[0]
        message = message.strip()
        if not message:
            continue
        error_map.setdefault(message, set()).add(file_path)
    return error_map

def format_error_digest(error_map):
    if not error_map:
        return "No errors found."
    sorted_errors = sorted(error_map.items(), key=lambda x: (-len(x[1]), x[0].lower()))
    output = []
    for message, files in sorted_errors:
        output.append(f"### {message} ({len(files)} file{'s' if len(files) != 1 else ''})")
        for f in sorted(files):
            output.append(f"- {f}")
        output.append("")
    return "\n".join(output)

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Validate HTML and produce a digest of grouped errors.")
    parser.add_argument("path", nargs="?", default=None,
                        help="Directory or file to validate. Defaults to script's directory.")
    parser.add_argument("--jar", dest="jar_path", default="vnu.jar",
                        help="Path to vnu.jar (default: ./vnu.jar)")
    parser.add_argument("--log", dest="log_mode", action="store_true",
                        help="Read from a raw log file instead of running validator.")
    args = parser.parse_args()

    if args.path is None:
        target_path = os.path.dirname(os.path.abspath(__file__))
    else:
        target_path = args.path

    if not os.path.exists(target_path):
        sys.exit(f"❌ Error: Path '{target_path}' not found.")

    try:
        if args.log_mode:
            with open(target_path, "r", encoding="utf-8", errors="ignore") as f:
                raw_text = f.read()
        else:
            if not os.path.exists(args.jar_path):
                sys.exit(f"❌ Error: vnu.jar not found at '{args.jar_path}'")
            raw_text = run_validator(target_path, args.jar_path)
            with open(RAW_LOG, "w", encoding="utf-8") as f:
                f.write(raw_text)
    except Exception as e:
        sys.exit(f"❌ Failed to process: {e}")

    kept_lines, suppressed_lines = filter_output(raw_text)

    # ⛔️ Write ignored lines and summary
    with open(IGNORED_LOG, "w", encoding="utf-8") as f:
        f.write(summarize_ignored(suppressed_lines) + "\n")
        if suppressed_lines:
            f.write("\n--- Suppressed lines ---\n")
            f.write("\n".join(suppressed_lines) + "\n")

    # ✅ Parse and write the great digest to html-errors.filtered.log
    error_map = parse_validator_output(kept_lines)
    digest = format_error_digest(error_map)

    with open(FILTERED_LOG, "w", encoding="utf-8") as f:
        f.write(digest.strip() + "\n")

    # ✅ Still print digest to stdout
    print(digest)

if __name__ == "__main__":
    main()
