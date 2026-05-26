#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const glob = require("glob");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CLOZE_DIR = "begin1/cloze";
const CACHE_RELATIVE_PATH = path.join(".cache", "modernize-cloze-pages.json");
const VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
const FONT_STACK_CSS = "style/font-stack.css";
const THEME_JS = "js/theme-selector.js";
const CLOZE_CSS = "css/sis-cloze-submit.css";
const CLOZE_JS = "js/sis-cloze-submit.js";
const PROTOTYPE_META = '<meta name="sis-cloze-prototype" content="current">';
const LEGACY_CHARSET_META =
  /\s*<meta[^>]*http-equiv="Content-Type"[^>]*content="text\/html;\s*charset=utf-8"[^>]*>\s*/i;

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH] [--cloze-dir PATH] [--prompt]

Modernize cloze pages in a bulk, mobile-first pass.

Options:
  --dry-run   Report what would change without writing files. This is the default.
  --apply     Write changes back to disk.
  --root PATH Scan a different repository root.
  --cloze-dir PATH
              Scan a different cloze directory under --root. Defaults to begin1/cloze.
  --prompt    Ask for root, cloze dir, file selection, and mode interactively before running.
  --help      Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    clozeDir: DEFAULT_CLOZE_DIR,
    clozeDirExplicit: false,
    root: DEFAULT_ROOT,
    rootExplicit: false,
    prompt: false,
    selection: "r",
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
      args.rootExplicit = true;
      continue;
    }
    if (arg === "--cloze-dir") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--cloze-dir requires a path");
      }
      args.clozeDir = argv[i];
      args.clozeDirExplicit = true;
      continue;
    }
    if (arg === "--prompt" || arg === "-p") {
      args.prompt = true;
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

function cacheFilePath(root) {
  return path.resolve(root, CACHE_RELATIVE_PATH);
}

function loadCache(root) {
  try {
    const contents = fs.readFileSync(cacheFilePath(root), "utf8");
    const parsed = JSON.parse(contents);
    if (parsed && typeof parsed.clozeDir === "string" && parsed.clozeDir.trim()) {
      return { clozeDir: parsed.clozeDir.trim() };
    }
  } catch {
    // Ignore missing or malformed cache data.
  }
  return {};
}

function saveCache(root, clozeDir) {
  const cachePath = cacheFilePath(root);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify({ clozeDir }, null, 2)}\n`);
}

async function promptForOptions(args) {
  if (!args.prompt) {
    return args;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    console.log("Modernize cloze pages");

    for (;;) {
      const rootAnswer = await rl.question(`Repository root (absolute path) [${args.root}]: `);
      const rootInput = rootAnswer.trim();
      if (!rootInput) {
        break;
      }
      if (!path.isAbsolute(rootInput)) {
        console.log("Please enter an absolute path, or press Enter to keep the default.");
        continue;
      }
      args.root = rootInput;
      break;
    }

    const cache = loadCache(args.root);
    if (!args.clozeDirExplicit && cache.clozeDir) {
      args.clozeDir = cache.clozeDir;
    }

    const clozeAnswer = await rl.question(`Cloze directory [${args.clozeDir}]: `);
    if (clozeAnswer.trim()) {
      args.clozeDir = clozeAnswer.trim();
    }

    const selectionDefault = args.selection === "a" ? "a" : "r";
    const selectionAnswer = await rl.question(
      `Files to convert [r=random 3 / a=all HTML in cloze dir] [${selectionDefault}]: `
    );
    const selection = selectionAnswer.trim().toLowerCase();
    if (selection === "a" || selection === "all") {
      args.selection = "a";
    } else if (selection === "r" || selection === "random" || selection === "random 3") {
      args.selection = "r";
    }

    const modeDefault = args.apply ? "apply" : "dry-run";
    const modeAnswer = await rl.question(`Mode [dry-run/apply] [${modeDefault}]: `);
    const mode = modeAnswer.trim().toLowerCase();
    if (mode === "apply") {
      args.apply = true;
    } else if (mode === "dry-run" || mode === "dry") {
      args.apply = false;
    }
  } finally {
    rl.close();
  }

  return args;
}

function pickRandomFiles(files, count) {
  const pool = [...files];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
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

function injectBeforeFirst(source, matcher, insertion) {
  const index = source.search(matcher);
  if (index < 0) return { source, changed: false };
  const match = source.match(matcher);
  if (!match) return { source, changed: false };
  const start = index;
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

  if (!/<meta[^>]*charset="utf-8"/i.test(next) && LEGACY_CHARSET_META.test(next)) {
    next = next.replace(LEGACY_CHARSET_META, "");
    next = next.replace(/<head>\s*/i, (match) => `${match}<meta charset="utf-8">\n`);
    changes.push("charset");
  }

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

  const jsTag = `<script defer src="${jsHref}"></script>`;
  const escapedJsTag = jsTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const misplacedJsRe = new RegExp(`</head>\\s*(${escapedJsTag})`, "i");
  const jsTagRe = new RegExp(escapedJsTag, "i");

  if (misplacedJsRe.test(next)) {
    next = next.replace(misplacedJsRe, `$1\n</head>`);
    changes.push("js");
  } else if (!jsTagRe.test(next)) {
    const injected = injectBeforeFirst(next, /<\/head>/i, `${jsTag}\n\n`);
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

  const fontFamilyRe = /^[ \t]*font-family:\s*var\(--font-(?:base|header)\);\s*\r?\n?/gm;
  if (fontFamilyRe.test(next)) {
    fontFamilyRe.lastIndex = 0;
    next = next.replace(fontFamilyRe, "");
    changes.push("font-family");
  }

  return { source: next, changes };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    args = await promptForOptions(args);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  const clozeDir = path.resolve(args.root, args.clozeDir);
  const allFiles = glob.sync(path.join(clozeDir, "*.html"), {
    absolute: true,
    dot: true,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/.playwright-cli/**",
      "**/.sto/**",
    ],
  });
  const files = args.selection === "a" ? allFiles : pickRandomFiles(allFiles, 3);

  let scanned = 0;
  let changed = 0;
  const categoryCounts = new Map();

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Root: ${args.root}`);
  console.log(`Cloze dir: ${clozeDir}`);
  console.log(`Selection: ${args.selection === "a" ? "all HTML in cloze dir" : "random 3 files"}`);
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

  saveCache(args.root, args.clozeDir);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
