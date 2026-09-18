#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "docs/404/begin6-scrape-manifest.json");
const TREE_PATH = path.join(ROOT, "docs/404/begin6-link-tree.md");

function localPathForEntry(entry) {
  if (entry.local) return entry.local;
  const relative = entry.path.replace(/^\/begin6\//, "begin6/").replace(/\.htm$/i, ".html");
  return path.join(ROOT, relative);
}

function refreshStatus(entry) {
  const local = localPathForEntry(entry);
  return {
    ...entry,
    local,
    status: fs.existsSync(local) && fs.statSync(local).isFile() && fs.statSync(local).size > 0 ? "present" : "missing",
  };
}

function treeLines(entries) {
  const root = { children: new Map(), entries: [] };
  for (const entry of entries) {
    const segments = entry.path.replace(/^\//, "").split("/");
    let node = root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        node.entries.push({ segment, entry });
        return;
      }
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), entries: [] });
      node = node.children.get(segment);
    });
  }
  const lines = ["- `/`"];
  function render(node, prefix) {
    const childNames = [...node.children.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of childNames) {
      lines.push(`${prefix}- \`${name}/\``);
      render(node.children.get(name), `${prefix}  `);
    }
    const files = [...node.entries].sort((a, b) => a.segment.localeCompare(b.segment, undefined, { numeric: true }));
    for (const { segment, entry } of files) {
      const marker = entry.status === "present" ? "present" : "MISSING";
      lines.push(`${prefix}- \`${segment}\` — ${marker}; ${(entry.kinds || []).join(", ")}; local: \`${path.relative(ROOT, entry.local)}\``);
    }
  }
  render(root, "  ");
  return lines;
}

function writeAtomic(filePath, contents) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const entries = (manifest.discoveredLinks || []).map(refreshStatus);
const missing = entries.filter((entry) => entry.status === "missing");
const tree = [
  "# Begin6 live HTML link tree",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "The tree is derived from the four live index pages and all 100 live story HTML pages. `href` and resource `src` paths under `/begin6/` are included. `.htm` live paths are mapped to the repository's `.html` convention for the local-status check.",
  "",
  `- Story pages discovered: ${manifest.storyCount}`,
  `- Local paths discovered: ${entries.length}`,
  `- Local paths present: ${entries.length - missing.length}`,
  `- Local paths missing: ${missing.length}`,
  "",
  "## Tree",
  "",
  ...treeLines(entries),
  "",
  "## Missing local paths",
  "",
  ...(missing.length ? missing.map((entry) => `- \`${entry.path}\` → \`${path.relative(ROOT, entry.local)}\``) : ["- None"]),
  "",
].join("\n");

manifest.generatedAt = new Date().toISOString();
manifest.discoveredLinks = entries;
writeAtomic(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
writeAtomic(TREE_PATH, tree);
console.log(JSON.stringify({ entries: entries.length, present: entries.length - missing.length, missing: missing.length }));
