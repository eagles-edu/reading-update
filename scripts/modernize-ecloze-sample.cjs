#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");
const { rehashHtmlSource } = require("./sri-rehash.cjs");
const { createBackupManager } = require("./write-backup.cjs");

const ROOT = path.resolve(__dirname, "..");
const FONT_STACK_CSS = "style/font-stack.css";
const SIS_CSS = "css/sis-cloze-submit.css";
const SIS_JS = "js/sis-cloze-submit.js";
const THEME_JS = "js/theme-selector.js";
const DEFAULT_TARGET = path.resolve(ROOT, "scratch/ecloze-tuning/ecloze050.work.html");
const backupManager = createBackupManager(ROOT, "modernize-ecloze-sample");

function relAsset(file, assetRoot) {
  return path.relative(path.dirname(file), assetRoot).split(path.sep).join("/");
}

function ensureRootIconLink(source, file, iconHref) {
  const iconRe = /(<link\b[^>]*rel="icon"[^>]*href=")[^"]*(")/gi;
  if (iconRe.test(source)) {
    iconRe.lastIndex = 0;
    let iconChanged = false;
    const replaced = source.replace(iconRe, (match, prefix, suffix) => {
      iconChanged = true;
      return `${prefix}${iconHref}${suffix}`;
    });
    return {
      source: replaced,
      changed: iconChanged && replaced !== source,
    };
  }

  const insertions = [
    /<meta[^>]*name="keywords"[^>]*>\s*/i,
    /<meta[^>]*name="author"[^>]*>\s*/i,
    /<meta[^>]*name="viewport"[^>]*>\s*/i,
    /<meta[^>]*charset="utf-8"[^>]*>\s*/i,
  ];
  for (const matcher of insertions) {
    const index = source.search(matcher);
    if (index < 0) continue;
    const match = source.match(matcher);
    if (!match) continue;
    const start = index + match[0].length;
    return {
      source: `${source.slice(0, start)}<link rel="icon" href="${iconHref}">\n${source.slice(start)}`,
      changed: true,
    };
  }

  return { source, changed: false };
}

function parseArgs(argv) {
  const args = {
    apply: false,
    all: false,
    dir: null,
    files: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--dry-run") {
      args.apply = false;
    } else if (arg === "--all") {
      args.all = true;
    } else if (arg === "--dir") {
      i += 1;
      if (i >= argv.length) throw new Error("--dir requires a path");
      args.dir = path.resolve(ROOT, argv[i]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      args.files.push(path.resolve(ROOT, arg));
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--dry-run|--apply] [--dir PATH|FILE ...] [--all]

Modernize an ecloze sample using the representative-file rules only:
  - promote any ExerciseTitle h1-h6 to h1
  - add sr-only labels for every Gap input
  - normalize the shared head assets and SIS reporting bridge

Structural lint failures such as close-order, nesting, and implicit-close are broken code errors that must be fixed before modernization prototyping.

If no files are given, the scratch tuning copy is used.
`);
}

function modernize(source) {
  let next = source;
  const changes = [];

  const headingRe = /<h([1-6]) class="ExerciseTitle">([\s\S]*?)<\/h\1>/gi;
  let headingChanged = false;
  next = next.replace(headingRe, (match, level, content) => {
    headingChanged = true;
    return `<h1 class="ExerciseTitle">${content}</h1>`;
  });
  if (headingChanged) {
    changes.push("heading-level");
  }

  const gapRe = /<span class="GapSpan" id="GapSpan(\d+)"><input\b([^>]*\bid="Gap(\d+)"[^>]*)><\/span>/g;
  let gapChanged = false;
  next = next.replace(gapRe, (match, spanNum, inputAttrs, gapNum) => {
    if (String(spanNum) !== String(gapNum)) {
      return match;
    }
    gapChanged = true;
    const label = `<label class="sr-only" for="Gap${gapNum}">Blank ${Number(gapNum) + 1}</label>`;
    return `<span class="GapSpan" id="GapSpan${spanNum}">${label}<input${inputAttrs}></span>`;
  });
  if (gapChanged) changes.push("cloze-label");

  return { source: next, changes };
}

function ensureHeadAssets(source, file, digestCache) {
  let next = source;
  const changes = [];

  const cssHref = relAsset(file, path.resolve(ROOT, SIS_CSS));
  const fontStackHref = relAsset(file, path.resolve(ROOT, FONT_STACK_CSS));
  const themeJsHref = relAsset(file, path.resolve(ROOT, THEME_JS));
  const jsHref = relAsset(file, path.resolve(ROOT, SIS_JS));

  if (!/<meta[^>]*charset="utf-8"/i.test(next)) {
    next = next.replace(/<head>\s*/i, (match) => `${match}<meta charset="utf-8">\n`);
    changes.push("charset");
  }

  if (!/<meta[^>]*name="viewport"/i.test(next)) {
    next = next.replace(
      /<meta[^>]*charset="utf-8"[^>]*>\s*/i,
      (match) => `${match}<meta name="viewport" content="width=device-width, initial-scale=1">\n`
    );
    changes.push("viewport");
  }

  if (!/name="sis-cloze-prototype"/i.test(next)) {
    next = next.replace(
      /<meta[^>]*name="viewport"[^>]*>\s*/i,
      (match) => `${match}<meta name="sis-cloze-prototype" content="current">\n`
    );
    changes.push("prototype-meta");
  }

  if (!/sis-cloze-submit\.css/i.test(next)) {
    next = next.replace(
      /<\/style>\s*/i,
      `</style>\n<link rel="stylesheet" href="${cssHref}">\n\n`
    );
    changes.push("css");
  }

  const iconUpdate = ensureRootIconLink(next, file, "/favicon.ico");
  if (iconUpdate.changed) {
    next = iconUpdate.source;
    changes.push("icon");
  }

  if (!/font-stack\.css/i.test(next)) {
    next = next.replace(
      /<link\b[^>]*rel="icon"[^>]*>\s*/i,
      `<link rel="preload" href="${fontStackHref}" as="style">\n<link rel="stylesheet" href="${fontStackHref}">\n`
    );
    changes.push("font-stack");
  }

  if (!/theme-selector\.js/i.test(next)) {
    next = next.replace(
      /<link\b[^>]*rel="stylesheet"[^>]*font-stack\.css[^>]*>\s*/i,
      (match) => `${match}<link rel="preload" href="${themeJsHref}" as="script">\n<script src="${themeJsHref}"></script>\n`
    );
    changes.push("theme");
  }

  const jsTag = `<script defer src="${jsHref}"></script>`;
  const jsTagRe = new RegExp(`<script\\b[^>]*\\bsrc="${jsHref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`, "i");
  if (!jsTagRe.test(next)) {
    next = next.replace(/<\/head>/i, `${jsTag}\n\n</head>`);
    changes.push("sis-bridge");
  }

  const sriUpdate = rehashHtmlSource(next, file, ROOT, { digestCache });
  return {
    source: sriUpdate.source,
    changes: [...changes, ...sriUpdate.changes],
  };
}

function listFiles(args) {
  if (args.files.length > 0) return args.files;
  if (args.dir) {
    return glob.sync(path.join(args.dir, "**/*.html"), {
      absolute: true,
      dot: true,
      ignore: [
        "**/.git/**",
        "**/node_modules/**",
        "**/*.copy.html",
        "**/*.legacy.html",
        "**/*.prototype.html",
      ],
    });
  }
  return [DEFAULT_TARGET];
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

  const files = listFiles(args);
  let changed = 0;
  const digestCache = new Map();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const bodyUpdated = modernize(source);
    const headUpdated = ensureHeadAssets(bodyUpdated.source, file, digestCache);
    const combinedChanges = [...bodyUpdated.changes, ...headUpdated.changes];
    const finalSource = headUpdated.source;
    if (combinedChanges.length === 0) {
      console.log(`${path.relative(ROOT, file)}\tno changes`);
      continue;
    }
    changed += 1;
    console.log(`${path.relative(ROOT, file)}\t${combinedChanges.join(", ")}`);
    if (args.apply && finalSource !== source) {
      backupManager.backupBeforeWrite(file);
      fs.writeFileSync(file, finalSource);
    }
  }

  console.log(`Changed: ${changed}`);
  return 0;
}

process.exitCode = main();
