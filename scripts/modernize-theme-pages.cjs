#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const { rehashHtmlSource } = require("./sri-rehash.cjs");
const { createBackupManager } = require("./write-backup.cjs");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const THEME_JS = "js/theme-selector.js";
const STORY_THEME_JS = "js/story-theme.js";
const FONT_STACK_CSS = "style/font-stack.css";
const STORY_CSS = "style/style.css";
const SCOPED_STORY_PATHS = [
  "eslread/ss",
  "easyread/es",
  "essays/e",
  "kidsenglish/ke",
  "kidsenglish2/ke2",
  "kidsenglish3/ke3",
  "people/p",
  "supereasy/se",
];

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH] [--include PATH]

Modernize theme-toggle pages and story pages.

Story pages use the shared story stylesheet for the background system,
typography, responsive text and container widths, and horizontal rules, with
the shared font stack loaded first. The story bootstrap selects and preloads
each page's background and paper texture before the story stylesheet is parsed.

Options:
  --dry-run   Report what would change without writing files. This is the default.
  --apply     Write changes back to disk.
  --root PATH Scan a different repository root.
  --include PATH
              Restrict scanning to a repository-relative file or directory path.
  --help      Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    include: [],
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
    if (arg === "--include") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--include requires a path");
      }
      args.include.push(
        argv[i].replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, ""),
      );
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineEnding(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
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

function isStoryPage(source, file, root) {
  const relativeFile = path.relative(root, file).split(path.sep).join("/");
  const storyPath = /^begin\d+\/b\d+\/b\d{4}\.html$/i.test(relativeFile);
  const notFoundPage = /404\s+Not\s+Found/i.test(source);
  const scopedStoryFile =
    SCOPED_STORY_PATHS.some((storyPathPrefix) =>
      relativeFile.toLowerCase().startsWith(`${storyPathPrefix}/`),
    ) &&
    /<audio\b/i.test(source);
  return (
    /\bstory-page\b/i.test(source) ||
    (storyPath && !notFoundPage) ||
    (scopedStoryFile && !notFoundPage)
  );
}

function isIncludedFile(file, root, includePaths) {
  if (includePaths.length === 0) return true;
  const relativeFile = path.relative(root, file).split(path.sep).join("/");
  return includePaths.some(
    (includePath) =>
      relativeFile === includePath || relativeFile.startsWith(`${includePath}/`),
  );
}

function addClassToTagAt(source, tag, index, className) {
  const classAttribute = tag.match(/(\bclass\s*=\s*["'])([^"']*)(["'])/i);
  if (classAttribute) {
    const classes = classAttribute[2].trim().split(/\s+/).filter(Boolean);
    if (classes.includes(className)) return { source, changed: false };
    const updatedTag = tag.replace(
      classAttribute[0],
      `${classAttribute[1]}${classAttribute[2].trim()} ${className}${classAttribute[3]}`,
    );
    return {
      source: `${source.slice(0, index)}${updatedTag}${source.slice(index + tag.length)}`,
      changed: true,
    };
  }

  const updatedTag = `${tag.slice(0, -1)} class="${className}">`;
  return {
    source: `${source.slice(0, index)}${updatedTag}${source.slice(index + tag.length)}`,
    changed: true,
  };
}

function addClassToTag(source, matcher, className) {
  const match = source.match(matcher);
  if (!match) return { source, changed: false };
  return addClassToTagAt(source, match[0], match.index, className);
}

function addClassToFirstBodyDiv(source, className) {
  const match = source.match(/<body\b[^>]*>[\s\S]*?(<div\b[^>]*>)/i);
  if (!match) return { source, changed: false };
  const tag = match[1];
  const index = match.index + match[0].lastIndexOf(tag);
  return addClassToTagAt(source, tag, index, className);
}

function removeContainerStyle(source) {
  const match = source.match(
    /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bwrapfit\b[^"']*\bstory-column\b[^"']*["'])[^>]*>/i,
  );
  if (!match) return { source, changed: false };

  const styleAttribute = match[0].match(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!styleAttribute) return { source, changed: false };

  const declarations = styleAttribute[2]
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  const containerProperties = /^(?:width|margin)(?:-(?:top|right|bottom|left))?$/i;
  if (declarations.length === 0 || declarations.some((declaration) => {
    const property = declaration.split(":", 1)[0].trim();
    return !containerProperties.test(property);
  })) {
    return { source, changed: false };
  }

  const updatedTag = match[0].replace(styleAttribute[0], "");
  const index = match.index;
  return {
    source: `${source.slice(0, index)}${updatedTag}${source.slice(index + match[0].length)}`,
    changed: true,
  };
}

function ensureStoryShell(source) {
  const changes = [];
  let next = source;

  const body = addClassToTag(next, /<body\b[^>]*>/i, "story-page");
  next = body.source;
  if (body.changed) changes.push("story-body");

  const knownWrapperRe = /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\b(?:wrapfit|wrapit)\b[^"']*["'])[^>]*>/i;
  let wrapper = knownWrapperRe.test(next)
    ? addClassToTag(next, knownWrapperRe, "wrapfit")
    : addClassToFirstBodyDiv(next, "wrapfit");
  next = wrapper.source;
  if (wrapper.changed) changes.push("story-wrapper");

  const column = addClassToTag(
    next,
    /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bwrapfit\b[^"']*["'])[^>]*>/i,
    "story-column",
  );
  next = column.source;
  if (column.changed) changes.push("story-column");

  const containerStyle = removeContainerStyle(next);
  next = containerStyle.source;
  if (containerStyle.changed) changes.push("story-wrapper-style");

  return { source: next, changes };
}

function ensureStoryBootstrap(source, file, root) {
  const eol = lineEnding(source);
  const storyHref = relAsset(file, path.resolve(root, STORY_THEME_JS));
  const cssHref = relAsset(file, path.resolve(root, STORY_CSS));
  const storyHrefPattern = escapeRegExp(storyHref);
  const cssHrefPattern = escapeRegExp(cssHref);
  const scriptRe = new RegExp(
    `<script\\b(?=[^>]*\\bsrc=["']${storyHrefPattern}["'])[^>]*><\\/script>`,
    "i",
  );
  const stylesheetRe = new RegExp(
    `<link\\b(?=[^>]*\\bhref=["']${cssHrefPattern}["'])[^>]*>`,
    "i",
  );
  const scriptMatch = source.match(scriptRe);
  const stylesheetMatch = source.match(stylesheetRe);

  if (!stylesheetMatch) return { source, changes: ["story-stylesheet-missing"] };

  const normalizedScript = scriptMatch
    ? scriptMatch[0].replace(/\sdefer(?=\s|>)/i, "")
    : `<script src="${storyHref}"></script>`;
  const scriptIndex = scriptMatch ? scriptMatch.index : -1;
  const stylesheetIndex = stylesheetMatch.index;
  if (scriptMatch && scriptIndex < stylesheetIndex && normalizedScript === scriptMatch[0]) {
    return { source, changes: [] };
  }

  let next = scriptMatch ? source.replace(scriptMatch[0], "") : source;
  const refreshedStylesheetMatch = next.match(stylesheetRe);
  if (!refreshedStylesheetMatch) return { source, changes: ["story-stylesheet-missing"] };
  const lineStart = next.lastIndexOf("\n", refreshedStylesheetMatch.index) + 1;
  const linePrefix = next.slice(lineStart, refreshedStylesheetMatch.index);
  const indent = /^[ \t]*$/.test(linePrefix) ? linePrefix : "";
  const scriptLine = `${indent}${normalizedScript}`;
  const insertionIndex = refreshedStylesheetMatch.index;
  next = `${next.slice(0, insertionIndex)}${scriptLine}${eol}${next.slice(insertionIndex)}`;

  return {
    source: next,
    changes: [scriptMatch ? "story-theme-order" : "story-theme-js"],
  };
}

function ensureStoryFontStack(source, file, root) {
  const eol = lineEnding(source);
  const fontHref = relAsset(file, path.resolve(root, FONT_STACK_CSS));
  const fontHrefPattern = escapeRegExp(fontHref);
  const stylesheetRe = new RegExp(
    `<link\\b(?=[^>]*\\bhref=["']${fontHrefPattern}["'])[^>]*>`,
    "i",
  );
  const preloadRe = new RegExp(
    `<link\\b(?=[^>]*\\brel=["']preload["'])(?=[^>]*\\bas=["']style["'])(?=[^>]*\\bhref=["']${fontHrefPattern}["'])[^>]*>`,
    "i",
  );
  const stylesheetMatch = source.match(stylesheetRe);
  const preloadMatch = source.match(preloadRe);
  if (stylesheetMatch && preloadMatch) return { source, changes: [] };

  const anchor = stylesheetMatch || source.match(
    new RegExp(
      `<link\\b(?=[^>]*\\bhref=["']${escapeRegExp(relAsset(file, path.resolve(root, STORY_CSS)))}["'])[^>]*>`,
      "i",
    ),
  );
  if (!anchor) return { source, changes: ["story-font-stack-missing-anchor"] };

  const lineStart = source.lastIndexOf("\n", anchor.index) + 1;
  const linePrefix = source.slice(lineStart, anchor.index);
  const indent = /^[ \t]*$/.test(linePrefix) ? linePrefix : "";
  const preload = preloadMatch
    ? ""
    : `${indent}<link rel="preload" href="${fontHref}" as="style">${eol}`;
  const stylesheet = stylesheetMatch
    ? ""
    : `${indent}<link rel="stylesheet" href="${fontHref}">${eol}`;
  const insertion = `${preload}${stylesheet}`;
  const insertionIndex = anchor.index;
  const next = `${source.slice(0, insertionIndex)}${insertion}${source.slice(insertionIndex)}`;

  return {
    source: next,
    changes: ["story-font-stack"],
  };
}

function updateStoryPage(source, file, root) {
  const font = ensureStoryFontStack(source, file, root);
  const shell = ensureStoryShell(font.source);
  const bootstrap = ensureStoryBootstrap(shell.source, file, root);
  return {
    source: bootstrap.source,
    changes: [...font.changes, ...shell.changes, ...bootstrap.changes],
  };
}

function updateHtml(source, file, root) {
  const changes = [];
  let next = source;

  if (isStoryPage(next, file, root)) {
    const story = updateStoryPage(next, file, root);
    next = story.source;
    changes.push(...story.changes);
  }

  if (shouldModernize(next) && !/theme-selector\.js/i.test(next)) {
    const themeHref = relAsset(file, path.resolve(root, THEME_JS));
    const linkBlock = `<link rel="preload" href="${themeHref}" as="script">\n<script src="${themeHref}"></script>\n`;
    const iconRe = /<link\b[^>]*(?:rel="icon"|rel="shortcut icon")[^>]*>\s*/i;

    const injected = injectAfterFirst(next, iconRe, `${linkBlock}`);
    next = injected.source;
    if (injected.changed) {
      changes.push("theme-js");
    }
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

  const backupManager = createBackupManager(args.root, "modernize-theme-pages");

  const files = glob
    .sync("**/*.html", {
      absolute: true,
      cwd: args.root,
      dot: true,
      ignore: [
        "**/.git/**",
        "**/.backups/**",
        "**/node_modules/**",
        "**/.playwright-cli/**",
        "**/.sto/**",
        "**/*.BAK",
      ],
    })
    .filter((file) => isIncludedFile(file, args.root, args.include));

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
      backupManager.backupBeforeWrite(file);
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
