#!/usr/bin/env python3
"""Build a strict graded-reading rsync manifest from the markdown source."""

from __future__ import annotations

import argparse
import fnmatch
import os
from pathlib import Path
from typing import Iterable


SECTION_ORDER = ("include", "centralize", "local", "exclude")


def parse_manifest(manifest_path: Path) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {name: [] for name in SECTION_ORDER}
    in_block = False
    current = None

    for raw_line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line == "```text":
            in_block = True
            current = None
            continue
        if in_block and line == "```":
            break
        if not in_block or not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            key = line[1:-1].strip().lower()
            if key not in sections:
                raise ValueError(f"unknown manifest section: {key}")
            current = key
            continue
        if current is None:
            continue
        sections[current].append(line)

    return sections


class Excluder:
    def __init__(self, patterns: Iterable[str]) -> None:
        self.dir_names: set[str] = set()
        self.exact_paths: set[str] = set()
        self.exact_names: set[str] = set()
        self.glob_patterns: list[str] = []

        for raw in patterns:
            item = raw.strip()
            if not item:
                continue
            if item.endswith("/"):
                self.dir_names.add(item.rstrip("/"))
            elif any(ch in item for ch in "*?["):
                self.glob_patterns.append(item)
            else:
                self.exact_paths.add(item)
                self.exact_names.add(Path(item).name)

    def _dir_excluded(self, rel_path: str) -> bool:
        parts = rel_path.split("/")
        return any(part in self.dir_names for part in parts)

    def _glob_excluded(self, rel_path: str) -> bool:
        base = Path(rel_path).name
        for pattern in self.glob_patterns:
            if fnmatch.fnmatch(rel_path, pattern) or fnmatch.fnmatch(base, pattern):
                return True
        return False

    def excluded(self, rel_path: str) -> bool:
        rel = rel_path.replace(os.sep, "/").lstrip("./")
        base = Path(rel).name
        return (
            rel in self.exact_paths
            or base in self.exact_names
            or self._dir_excluded(rel)
            or self._glob_excluded(rel)
        )


def existing_paths(source_root: Path, items: Iterable[str]) -> list[str]:
    result: list[str] = []
    for item in items:
        if (source_root / item).exists():
            result.append(item)
    return result


def collect_root_files(source_root: Path, roots: Iterable[str], excluder: Excluder) -> set[str]:
    manifest: set[str] = set()
    for root in roots:
        abs_root = source_root / root
        if not abs_root.is_dir():
            continue
        for entry in abs_root.iterdir():
            if entry.is_file():
                rel = entry.relative_to(source_root).as_posix()
                if not excluder.excluded(rel):
                    manifest.add(rel)
    return manifest


def collect_tree(source_root: Path, item: str, excluder: Excluder) -> set[str]:
    manifest: set[str] = set()
    abs_item = source_root / item
    if abs_item.is_file():
        rel = abs_item.relative_to(source_root).as_posix()
        if not excluder.excluded(rel):
            manifest.add(rel)
        return manifest
    if not abs_item.is_dir():
        return manifest

    for dirpath, dirnames, filenames in os.walk(abs_item):
        dir_rel = Path(dirpath).relative_to(source_root).as_posix()
        dirnames[:] = [
            d for d in dirnames
            if not excluder.excluded(f"{dir_rel}/{d}" if dir_rel != "." else d)
        ]
        for filename in filenames:
            rel = Path(dirpath, filename).relative_to(source_root).as_posix()
            if not excluder.excluded(rel):
                manifest.add(rel)
    return manifest


def build_manifest(source_root: Path, sections: dict[str, list[str]]) -> tuple[list[str], list[str], list[str], list[str]]:
    include_roots = existing_paths(source_root, sections["include"])
    shared_items = existing_paths(source_root, sections["centralize"])
    local_items = existing_paths(source_root, sections["local"])
    excluder = Excluder(sections["exclude"])

    manifest: set[str] = set()
    manifest |= collect_root_files(source_root, include_roots, excluder)
    for item in shared_items + local_items:
        manifest |= collect_tree(source_root, item, excluder)

    return include_roots, shared_items, local_items, sorted(manifest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-doc", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--manifest-file", required=True)
    args = parser.parse_args()

    source_root = Path(args.source).resolve()
    target_root = args.target.rstrip("/")
    manifest_path = Path(args.manifest_doc).resolve()
    output_path = Path(args.manifest_file).resolve()

    sections = parse_manifest(manifest_path)
    roots, shared, local, manifest = build_manifest(source_root, sections)

    output_path.write_bytes("\0".join(manifest).encode("utf-8"))

    print(f"manifest-count\t{len(manifest)}")
    print(f"manifest-doc\t{manifest_path}")
    print(f"roots\t{' '.join(roots)}")
    print(f"shared\t{' '.join(shared)}")
    print(f"local\t{' '.join(local)}")
    print(f"target\t{target_root}")
    print(f"manifest\t{output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
