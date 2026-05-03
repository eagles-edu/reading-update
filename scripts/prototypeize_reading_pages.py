#!/usr/bin/env python3
"""Convert reading-level index pages to the begin1 tabbed prototype.

This preserves the begin1 shell/styles and swaps in each directory's own
story content, tab labels, and redirect aliases.
"""

from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from textwrap import indent


REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = REPO_ROOT / "begin1" / "index.html"

TARGET_DIRS = [
    "begin2",
    "begin3",
    "begin4",
    "begin5",
    "begin6",
    "kidsenglish",
    "kidsenglish2",
    "kidsenglish3",
    "supereasy",
    "easyread",
    "essays",
    "easydialogs",
    "eslread",
    "people",
]


def strip_number_prefix(text: str) -> str:
    text = html.unescape(text).strip()
    return re.sub(r"^\d+\.\s*", "", text).strip()


def extract_text(pattern: str, text: str, *, flags: int = re.S) -> str:
    match = re.search(pattern, text, flags)
    if not match:
        raise ValueError(f"could not find pattern: {pattern}")
    return re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()


def extract_title(text: str) -> str:
    return extract_text(r"<title>(.*?)</title>", text)


def extract_h1(text: str) -> str:
    return extract_text(r"<h1[^>]*>\s*(.*?)\s*</h1>", text)


class StoryListParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.div_stack: list[bool] = []
        self.in_boxlist = False
        self.in_anchor = False
        self.collect_tail = False
        self.current_href: str | None = None
        self.current_text: list[str] = []
        self.links: list[tuple[str, str]] = []
        self._captured_first_boxlist = False

    def handle_starttag(self, tag: str, attrs):
        if tag == "div":
            cls = dict(attrs).get("class", "")
            is_boxlist = "boxlist" in cls and not self._captured_first_boxlist
            self.div_stack.append(is_boxlist)
            if is_boxlist:
                self.in_boxlist = True
        elif self.in_boxlist and tag == "a":
            if self.current_href or self.current_text:
                self._finalize_link()
            self.in_anchor = True
            self.collect_tail = False
            self.current_href = dict(attrs).get("href", "")
            self.current_text = []

    def handle_endtag(self, tag: str):
        if tag == "a" and self.in_anchor:
            self.in_anchor = False
            self.collect_tail = True
        elif tag in {"br", "li", "p", "td"} and self.in_boxlist:
            self._finalize_link()
        elif tag == "div" and self.div_stack:
            was_boxlist = self.div_stack.pop()
            if was_boxlist:
                self._finalize_link()
                self._captured_first_boxlist = True
            self.in_boxlist = any(self.div_stack)

    def handle_data(self, data: str):
        if self.in_boxlist and (self.in_anchor or self.collect_tail):
            self.current_text.append(data)

    def _finalize_link(self) -> None:
        if not self.current_href and not self.current_text:
            self.in_anchor = False
            self.collect_tail = False
            return
        text = strip_number_prefix("".join(self.current_text))
        text = re.sub(r"\s+", " ", text).strip()
        if self.current_href and text:
            self.links.append((self.current_href, text))
        self.in_anchor = False
        self.collect_tail = False
        self.current_href = None
        self.current_text = []


def extract_story_links(path: Path) -> list[tuple[str, str]]:
    parser = StoryListParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return [(href, re.sub(r"\s+", " ", strip_number_prefix(title)).strip()) for href, title in parser.links]


def split_title(title: str) -> str:
    return title.split(":", 1)[-1].strip()


def derive_labels(titles: list[str]) -> list[str]:
    if len(titles) == 1:
        return titles
    if len(set(titles)) > 1:
        return titles
    return [f"Part {idx}" for idx in range(1, len(titles) + 1)]


def build_tabs(page_specs: list[dict]) -> tuple[str, str, str, str]:
    buttons: list[str] = []
    panels: list[str] = []
    story_sets: list[str] = []
    stats: list[str] = []

    start_number = 1
    for idx, spec in enumerate(page_specs, start=1):
        tab_id = f"stories-{idx}"
        button_id = f"tab-{tab_id}"
        count = len(spec["items"])
        end_number = start_number + count - 1
        label = html.escape(spec["label"])

        buttons.append(
            f"""              <button
                id="{button_id}"
                class="tab-button"
                type="button"
                role="tab"
                aria-selected="{str(idx == 1).lower()}"
                aria-controls="{tab_id}"
                tabindex="{0 if idx == 1 else -1}"
                data-tab-target="{tab_id}"
              >
                <span class="tab-button__label">{label}</span>
                <span class="tab-button__range">{start_number} - {end_number}</span>
              </button>"""
        )

        panels.append(
            f"""              <section
                id="{tab_id}"
                class="tab-panel"
                role="tabpanel"
                aria-labelledby="{button_id}"
                data-start="{start_number}"
                {'hidden' if idx != 1 else ''}
              >
                <div class="story-grid" data-story-grid></div>
              </section>""".replace("\n                \n", "\n")
        )

        items_js = ",\n".join(
            f"            [{json.dumps(href)}, {json.dumps(title)}]"
            for href, title in spec["items"]
        )
        story_sets.append(f'          "{tab_id}": [\n{items_js}\n          ]')
        stats.append(
            f"""            <div class="stat-chip">
              <strong data-count-target="{count}">0</strong>
              <span>{label}</span>
            </div>"""
        )
        start_number = end_number + 1

    total = start_number - 1
    stats.append(
        f"""            <div class="stat-chip">
              <strong data-count-target="{total}">0</strong>
              <span>Total stories</span>
            </div>"""
    )
    stats.append(
        """            <div class="stat-chip stat-counter">
              <strong
                data-visit-count
                data-count-target="0"
                aria-live="polite"
              >--</strong>
              <span>Visits</span>
            </div>"""
    )

    return (
        "\n".join(buttons),
        "\n".join(panels),
        "{\n" + ",\n".join(story_sets) + "\n        }",
        "\n".join(stats),
    )


def main() -> int:
    for dir_name in TARGET_DIRS:
        dir_path = REPO_ROOT / dir_name
        if not dir_path.is_dir():
            continue

        page_files = sorted(dir_path.glob("index*.html"), key=lambda p: p.name)
        if not page_files:
            continue

        index_html = page_files[0].read_text(encoding="utf-8")
        if "tabbed-shell" in index_html and "storySets" in index_html:
            continue

        page_specs: list[dict] = []
        titles: list[str] = []
        for page_path in page_files:
            text = page_path.read_text(encoding="utf-8")
            title = extract_title(text)
            h1 = extract_h1(text)
            items = extract_story_links(page_path)
            page_specs.append(
                {
                    "path": page_path,
                    "title": title,
                    "h1": h1,
                    "title_body": split_title(title),
                    "items": items,
                }
            )
            titles.append(split_title(title))

        labels = derive_labels(titles)
        for spec, label in zip(page_specs, labels, strict=True):
            spec["label"] = label

        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        hero_title = page_specs[0]["h1"]
        page_title = page_specs[0]["h1"]
        description = (
            f"{hero_title} in a tabbed reading index with the same Eagles theme "
            "and a cleaner, animated layout."
        )

        buttons, panels, story_sets, stats = build_tabs(page_specs)

        updated = template
        updated = re.sub(
            r'content="My Reader: Stories 1 in a single tabbed reading index with the same Eagles theme and a cleaner, animated layout\."',
            f'content="{html.escape(description, quote=True)}"',
            updated,
        )
        updated = re.sub(
            r"<title>My Reader: Stories 1</title>",
            f"<title>{html.escape(page_title)}</title>",
            updated,
        )
        updated = re.sub(
            r"<span class=\"eyebrow\">Two tabs\. One reading path\.</span>",
            "<span class=\"eyebrow\">Tabbed reading path.</span>",
            updated,
        )
        updated = re.sub(
            r"<h1>My Reader: Stories 1</h1>",
            f"<h1>{html.escape(hero_title)}</h1>",
            updated,
        )
        updated = re.sub(
            r"<p class=\"hero-copy\">.*?</p>",
            (
                "<p class=\"hero-copy\">\n"
                "            The reading list stays compact in tabs while keeping the "
                "original Eagles theme and navigation.\n"
                "          </p>"
            ),
            updated,
            flags=re.S,
        )
        updated = re.sub(
            r"<div class=\"hero-stats\">.*?</div>\s*</div>\s*</section>",
            f"<div class=\"hero-stats\">\n{stats}\n          </div>\n        </div>\n      </section>",
            updated,
            flags=re.S,
        )
        updated = re.sub(
            r"<div class=\"tab-list\"[\s\S]*?<div class=\"tab-panels\">[\s\S]*?</div>\s*</div>\s*</div>\s*</section>",
            f"""<div class="tab-list"
              role="tablist"
              aria-labelledby="stories-shell-title"
              aria-orientation="horizontal"
            >
{buttons}
            </div>

            <div class="tab-panels">
{panels}
            </div>
          </div>
        </div>
      </section>""",
            updated,
            flags=re.S,
        )
        updated = re.sub(
            r"const storySets = \{[\s\S]*?\n        \};",
            lambda _: f"const storySets = {story_sets};",
            updated,
            flags=re.S,
        )
        updated = re.sub(
            r'const initialTab = storySets\[location\.hash\.slice\(1\)\]\n          \? location\.hash\.slice\(1\)\n          : "stories-1";',
            'const initialTab = storySets[location.hash.slice(1)]\n          ? location.hash.slice(1)\n          : "stories-1";',
            updated,
        )
        updated = re.sub(r"</main>\s*</main>", "</main>", updated)

        page_files[0].write_text(updated, encoding="utf-8")

        for idx, page_path in enumerate(page_files[1:], start=2):
            redirect_target = f"./index.html#stories-{idx}"
            redirect_title = page_specs[idx - 1]["title"]
            escaped_redirect_title = html.escape(redirect_title)
            page_path.write_text(
                f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="refresh"
      content="0; url={redirect_target}"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escaped_redirect_title}</title>
    <script>
      location.replace("{redirect_target}");
    </script>
  </head>
  <body>
    <p>
      Redirecting to
      <a href="{redirect_target}">{escaped_redirect_title}</a>.
    </p>
  </body>
</html>
""",
                encoding="utf-8",
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
