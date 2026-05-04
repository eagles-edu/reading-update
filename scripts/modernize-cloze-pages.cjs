#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const CLOZE_GLOB = "begin1/cloze/*.html";
const VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
const FONT_STACK_CSS = "style/font-stack.css";
const THEME_JS = "js/theme-selector.js";
const CLOZE_CSS = "css/sis-cloze-submit.css";
const CLOZE_JS = "js/sis-cloze-submit.js";
const PROTOTYPE_META = '<meta name="sis-cloze-prototype" content="current">';

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH]

Modernize the begin1 cloze pages in a bulk, mobile-first pass.

Options:
  --dry-run   Report what would change without writing files. This is the default.
  --apply     Write changes back to disk.
  --root PATH Scan a different repository root.
  --help      Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    root: DEFAULT_ROOT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.apply = false;
      continue;
    }
    if (arg === "--root") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--root requires a path");
      }
      args.root = path.resolve(argv[i]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function relAsset(file, assetRoot) {
  return path.relative(path.dirname(file), assetRoot).split(path.sep).join("/");
}

function injectAfterFirst(source, matcher, insertion) {
  const index = source.search(matcher);
  if (index < 0) return { source, changed: false };
  const match = source.match(matcher);
  if (!match) return { source, changed: false };
  const start = index + match[0].length;
  return {
    source: `${source.slice(0, start)}${insertion}${source.slice(start)}`,
    changed: true,
  };
}

function updateHead(source, file, root) {
  const changes = [];
  let next = source;

  const cssHref = relAsset(file, path.resolve(root, CLOZE_CSS));
  const fontStackHref = relAsset(file, path.resolve(root, FONT_STACK_CSS));
  const themeJsHref = relAsset(file, path.resolve(root, THEME_JS));
  const jsHref = relAsset(file, path.resolve(root, CLOZE_JS));
  const iconHref = relAsset(file, path.resolve(root, "favicon.ico"));

  if (!/<meta[^>]*name="viewport"/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<meta[^>]*charset="utf-8"[^>]*>\s*/i,
      `${VIEWPORT_TAG}\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("viewport");
  }

  if (!/name="sis-cloze-prototype"/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<meta[^>]*name="viewport"[^>]*>\s*/i,
      `${PROTOTYPE_META}\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("prototype-meta");
  }

  if (!/sis-cloze-submit\.css/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<\/style>\s*/i,
      `<link rel="stylesheet" href="${cssHref}">\n\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("css");
  }

  if (!/font-stack\.css/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<link\b[^>]*rel="icon"[^>]*>\s*/i,
      `<link rel="preload" href="${fontStackHref}" as="style">\n<link rel="stylesheet" href="${fontStackHref}">\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("font-stack");
  }

  if (!/theme-selector\.js/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<link\b[^>]*rel="stylesheet"[^>]*font-stack\.css[^>]*>\s*/i,
      `<link rel="preload" href="${themeJsHref}" as="script">\n<script src="${themeJsHref}"></script>\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("theme");
  }

  if (!/sis-cloze-submit\.js/i.test(next)) {
    const injected = injectAfterFirst(
      next,
      /<\/head>/i,
      `<script defer src="${jsHref}"></script>\n\n`
    );
    next = injected.source;
    if (injected.changed) changes.push("js");
  }

  const schemaRe = /\s*<link\b[^>]*rel="schema\.DC"[^>]*>\s*/i;
  if (schemaRe.test(next)) {
    next = next.replace(schemaRe, "\n");
    changes.push("schema");
  }

  const dcMetaRe = /\s*<meta\b[^>]*name="DC:[^"]*"[^>]*>\s*/gi;
  if (dcMetaRe.test(next)) {
    dcMetaRe.lastIndex = 0;
    next = next.replace(dcMetaRe, "\n");
    changes.push("dc-meta");
  }

  const iconRe = /(<link\b[^>]*rel="icon"[^>]*href=")[^"]*(")/gi;
  if (iconRe.test(next)) {
    iconRe.lastIndex = 0;
    let iconChanged = false;
    const replaced = next.replace(iconRe, (match, prefix, suffix) => {
      iconChanged = true;
      return `${prefix}${iconHref}${suffix}`;
    });
    if (iconChanged && replaced !== next) {
      next = replaced;
      changes.push("icon");
    }
  }

  const ieBlockRe =
    /\s*\/\* Hack to hide a nested Quicktime player from IE, which can't handle it\. \*\/\s*\* html object\.MediaPlayerNotForIE \{\s*display: none;\s*\}\s*/i;
  if (ieBlockRe.test(next)) {
    next = next.replace(ieBlockRe, "\n");
    changes.push("legacy-ie");
  }

  return { source: next, changes };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  const files = glob.sync(CLOZE_GLOB, {
    absolute: true,
    cwd: args.root,
    dot: true,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/.playwright-cli/**",
      "**/.sto/**",
    ],
  });

  let scanned = 0;
  let changed = 0;
  const categoryCounts = new Map();

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    const updated = updateHead(source, file, args.root);

    if (updated.changes.length === 0) continue;

    changed += 1;
    for (const change of updated.changes) {
      categoryCounts.set(change, (categoryCounts.get(change) || 0) + 1);
    }

    console.log(`${path.relative(args.root, file)}\t${updated.changes.join(", ")}`);

    if (args.apply && updated.source !== source) {
      fs.writeFileSync(file, updated.source);
    }
  }

  console.log();
  console.log(`Scanned: ${scanned}`);
  console.log(`Changed: ${changed}`);
  for (const [category, count] of categoryCounts.entries()) {
    console.log(`${category}: ${count}`);
  }
  return 0;
}

process.exitCode = main();
