#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const { rehashHtmlSource } = require("./sri-rehash.cjs");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const THEME_JS = "js/theme-selector.js";

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH]

Inject the shared theme bootstrap into repo HTML pages.

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

function shouldModernize(source) {
  return /const\s+storageKey\s*=\s*"theme";/.test(source) || /data-theme-toggle/.test(source);
}

function updateHtml(source, file, root) {
  const changes = [];
  let next = source;

  if (!shouldModernize(next) || /theme-selector\.js/i.test(next)) {
    return { source: next, changes };
  }

  const themeHref = relAsset(file, path.resolve(root, THEME_JS));
  const linkBlock = `<link rel="preload" href="${themeHref}" as="script">\n<script src="${themeHref}"></script>\n`;
  const iconRe = /<link\b[^>]*(?:rel="icon"|rel="shortcut icon")[^>]*>\s*/i;

  const injected = injectAfterFirst(next, iconRe, `${linkBlock}`);
  next = injected.source;
  if (injected.changed) {
    changes.push("theme-js");
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

  const files = glob.sync("**/*.html", {
    absolute: true,
    cwd: args.root,
    dot: true,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/.playwright-cli/**",
      "**/.sto/**",
      "**/*.BAK",
    ],
  });

  let scanned = 0;
  let changed = 0;
  const categoryCounts = new Map();
  const digestCache = new Map();

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    const updated = updateHtml(source, file, args.root);
    if (updated.changes.length === 0) continue;

    let nextSource = updated.source;
    const sriUpdate = rehashHtmlSource(nextSource, file, args.root, { digestCache });
    if (sriUpdate.changes.length > 0) {
      nextSource = sriUpdate.source;
      updated.changes.push(...sriUpdate.changes);
    }

    changed += 1;
    for (const change of updated.changes) {
      categoryCounts.set(change, (categoryCounts.get(change) || 0) + 1);
    }

    console.log(`${path.relative(args.root, file)}\t${updated.changes.join(", ")}`);

    if (args.apply && nextSource !== source) {
      fs.writeFileSync(file, nextSource);
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
