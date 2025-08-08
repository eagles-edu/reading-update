#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/scan_dead_css.py

Usage:
    python scan_dead_css.py /path/to/your/site

Dependencies:
    pip install beautifulsoup4 cssutils
"""
import sys
import re
from pathlib import Path
from bs4 import BeautifulSoup
from bs4.element import Tag
import cssutils

# suppress cssutils warnings for modern CSS functions
cssutils.log.setLevel('ERROR')
# to filter specific function warnings, uncomment and customize below:
# import logging
# class ModernCSSFilter(logging.Filter):
#     def filter(self, record):
#         msg = record.getMessage()
#         return not any(kw in msg for kw in ["clamp(", "calc(", "var("])
# handler = logging.StreamHandler()
# handler.addFilter(ModernCSSFilter())
# cssutils.log.addHandler(handler)

def find_html_files(root: str) -> list[Path]:
    """
    Recursively find all HTML files under the given root directory.
    """
    return list(Path(root).rglob("*.html"))

def extract_used_classes(html_text: str) -> list[tuple[str, int, int]]:
    """
    Returns a list of tuples (class_name, line, col) for every
    occurrence of class="..." in the HTML text.
    """
    usages: list[tuple[str, int, int]] = []
    for lineno, line in enumerate(html_text.splitlines(), start=1):
        for m in re.finditer(r'class\s*=\s*"([^"]+)"', line):
            col = m.start(1) + 1
            for cls in m.group(1).split():
                usages.append((cls, lineno, col))
    return usages

def extract_inline_styles(html_text: str) -> list[tuple[str, int, int]]:
    """
    Returns a list of tuples (style_content, line, col) for every
    occurrence of style="..." in the HTML text.
    """
    styles: list[tuple[str, int, int]] = []
    for lineno, line in enumerate(html_text.splitlines(), start=1):
        for m in re.finditer(r'style\s*=\s*"([^"]+)"', line):
            col = m.start(1) + 1
            styles.append((m.group(1), lineno, col))
    return styles

def load_css_sources(soup: BeautifulSoup, base_path: Path) -> dict[str, str]:
    """
    Loads CSS from <style> tags and linked stylesheets.
    Returns mapping: {source_label: css_text}.
    """
    sources: dict[str, str] = {}
    # inline <style> blocks
    for st in soup.find_all("style"):
        if not isinstance(st, Tag):
            continue
        text = st.get_text() or ""
        sources.setdefault("on-page", "")
        sources["on-page"] += text
    # linked stylesheets
    for link in soup.find_all("link", rel="stylesheet"):
        if not isinstance(link, Tag):
            continue
        href = link.get("href")
        # skip non-string, empty, or absolute URLs
        if not isinstance(href, str) or not href or href.startswith(("http://", "https://", "//")):
            print(f"[warn] Skipped stylesheet with invalid href in {base_path}: {repr(href)}")
            continue
        css_path = (base_path.parent / href).resolve()
        if css_path.is_file():
            sources[href] = css_path.read_text(encoding="utf-8", errors="ignore")
    return sources

def parse_defined_classes(css_text: str) -> set[str]:
    """
    Parses CSS text and returns a set of defined class selectors.
    """
    defined: set[str] = set()
    sheet = cssutils.parseString(css_text)
    for rule in sheet:
        if rule.type == rule.STYLE_RULE:
            for selector in rule.selectorList:
                for m in re.finditer(r'\.([A-Za-z0-9_-]+)', selector.selectorText):
                    defined.add(m.group(1))
    return defined

def main(root: str) -> None:
    """
    Scan HTML files for dead classes and inline styles, then write
    dead_classes.log and inline_styles.log (overwritten each run).
    """
    usage_map: dict[Path, list[tuple[str, int, int]]] = {}
    defs_in_file: dict[Path, set[str]] = {}
    css_sources_in_file: dict[Path, list[str]] = {}
    inline_styles_map: dict[Path, list[tuple[str, int, int]]] = {}

    for html_path in find_html_files(root):
        text = html_path.read_text(encoding="utf-8", errors="ignore")
        soup = BeautifulSoup(text, "html.parser")

        usage_map[html_path] = extract_used_classes(text)
        inline_styles_map[html_path] = extract_inline_styles(text)

        sources = load_css_sources(soup, html_path)
        css_sources_in_file[html_path] = list(sources.keys())
        defined: set[str] = set()
        for css_text in sources.values():
            defined |= parse_defined_classes(css_text)
        defs_in_file[html_path] = defined

    # identify dead classes
    dead: dict[str, list[tuple[Path, int, int]]] = {}
    for html, uses in usage_map.items():
        for cls, ln, col in uses:
            if cls not in defs_in_file.get(html, set()):
                dead.setdefault(cls, []).append((html, ln, col))

    # write dead_classes.log
    dead_log = Path("dead_classes.log")
    with dead_log.open("w", encoding="utf-8") as out:
        for cls, occurrences in sorted(dead.items()):
            out.write(f"=== MISSING CLASS: .{cls} ===\n")
            file_groups: dict[Path, list[tuple[int, int]]] = {}
            for html, ln, col in occurrences:
                file_groups.setdefault(html, []).append((ln, col))
            for html, locs in file_groups.items():
                first_ln, first_col = min(locs, key=lambda x: x[0])
                out.write(f"{html.resolve()}:{first_ln}:{first_col}\n")
                out.write("Checked CSS sources:\n")
                for src in css_sources_in_file.get(html, []):
                    out.write(f"  • {src}\n")
                out.write("Usages:\n")
                for ln, col in locs:
                    out.write(f"  - line {ln}, col {col}\n")
                out.write("\n")

    # write inline_styles.log
    inline_log = Path("inline_styles.log")
    with inline_log.open("w", encoding="utf-8") as out:
        for html, styles in inline_styles_map.items():
            if not styles:
                continue
            first_ln, first_col = min(styles, key=lambda x: x[1])[1:]
            # header
            out.write("=== INLINE STYLES IN ===\n")
            # clickable full path
            out.write(f"{html.resolve()}:{first_ln}:{first_col}\n")
            out.write("Usages:\n")
            for style, ln, col in styles:
                out.write(f"  - line {ln}, col {col}: {style}\n")
            out.write("\n")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python scan_dead_css.py /path/to/site")
        sys.exit(1)
    main(sys.argv[1])
