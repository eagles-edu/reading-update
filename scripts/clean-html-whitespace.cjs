#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");
const parse5 = require("parse5");

const { createBackupManager } = require("./write-backup.cjs");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROTECTED_TAGS = new Set(["pre", "script", "style", "textarea"]);
const backupManager = createBackupManager(DEFAULT_ROOT, "clean-html-whitespace");

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--apply] [--root PATH] [FILE...]

Clean HTML source whitespace only:
  - remove trailing spaces and tabs from ordinary source lines
  - reduce consecutive ordinary blank lines to at most one
  - preserve whitespace inside pre, script, style, and textarea elements
  - preserve each file's existing line-ending style and encoding marker

Options:
  --apply     Write changes back to disk. The default is a dry-run.
  --root PATH Scan a different repository root.
  --help      Show this help.

Arguments:
  FILE...     Optional explicit HTML/HTM files to process instead of scanning a tree.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    root: DEFAULT_ROOT,
    files: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--root") {
      index += 1;
      if (index >= argv.length) {
        throw new Error("--root requires a path");
      }
      args.root = path.resolve(argv[index]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    args.files.push(path.resolve(arg));
  }

  return args;
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function validateHtmlFile(file, root) {
  const absolute = path.resolve(file);
  if (!isWithinRoot(root, absolute)) {
    throw new Error(`Refusing to process a file outside root: ${absolute}`);
  }
  if (!/\.(?:html|htm)$/i.test(absolute)) {
    throw new Error(`Refusing non-HTML file: ${absolute}`);
  }

  const entry = fs.lstatSync(absolute);
  if (!entry.isFile()) {
    throw new Error(`Refusing non-regular file: ${absolute}`);
  }
  return absolute;
}

function readTargets(args) {
  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    throw new Error(`Root is not a directory: ${args.root}`);
  }

  const candidates = args.files.length > 0
    ? args.files
    : glob.sync("**/*.{html,htm}", {
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

  return candidates
    .map((file) => validateHtmlFile(file, args.root))
    .sort((left, right) => left.localeCompare(right));
}

function collectProtectedRanges(source) {
  const ranges = [];
  const document = parse5.parse(source, { sourceCodeLocationInfo: true });

  const visit = (node) => {
    if (node.tagName && PROTECTED_TAGS.has(node.tagName) && node.sourceCodeLocation) {
      const location = node.sourceCodeLocation;
      const start = location.startTag?.endOffset ?? location.startOffset;
      const end = location.endTag?.startOffset ?? source.length;
      if (end > start) {
        ranges.push({ start, end });
      }
    }

    for (const child of node.childNodes ?? []) {
      visit(child);
    }
    for (const child of node.content?.childNodes ?? []) {
      visit(child);
    }
  };

  visit(document);
  return ranges.sort((left, right) => left.start - right.start);
}

function splitLines(source) {
  const lines = [];
  let start = 0;
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (character !== "\r" && character !== "\n") {
      index += 1;
      continue;
    }

    const endingLength = character === "\r" && source[index + 1] === "\n" ? 2 : 1;
    const contentEnd = index;
    lines.push({
      start,
      end: contentEnd,
      text: source.slice(start, contentEnd),
      ending: source.slice(contentEnd, contentEnd + endingLength),
    });
    index += endingLength;
    start = index;
  }

  if (start < source.length || lines.length === 0) {
    lines.push({
      start,
      end: source.length,
      text: source.slice(start),
      ending: "",
    });
  }

  return lines;
}

function overlapsProtectedRange(line, ranges) {
  return ranges.some((range) => line.start < range.end && line.end > range.start);
}

function normalizeHtmlWhitespace(source) {
  const ranges = collectProtectedRanges(source);
  const lines = splitLines(source);
  const output = [];
  let previousBlank = false;
  let trailingWhitespaceLines = 0;
  let blankLinesRemoved = 0;

  for (const line of lines) {
    if (overlapsProtectedRange(line, ranges)) {
      output.push(`${line.text}${line.ending}`);
      previousBlank = /^[ \t]*$/.test(line.text);
      continue;
    }

    const isBlank = /^[ \t]*$/.test(line.text);
    if (isBlank) {
      if (previousBlank) {
        blankLinesRemoved += 1;
        continue;
      }
      output.push(`${line.ending}`);
      previousBlank = true;
      if (line.text.length > 0) {
        trailingWhitespaceLines += 1;
      }
      continue;
    }

    const cleanedText = line.text.replace(/[ \t]+$/u, "");
    if (cleanedText !== line.text) {
      trailingWhitespaceLines += 1;
    }
    output.push(`${cleanedText}${line.ending}`);
    previousBlank = false;
  }

  return {
    source: output.join(""),
    trailingWhitespaceLines,
    blankLinesRemoved,
  };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      return 0;
    }
    args.root = path.resolve(args.root);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }

  let files;
  try {
    files = readTargets(args);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }

  let scanned = 0;
  let changed = 0;
  let trailingWhitespaceLines = 0;
  let blankLinesRemoved = 0;

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    const result = normalizeHtmlWhitespace(source);
    if (result.source === source) {
      continue;
    }

    changed += 1;
    trailingWhitespaceLines += result.trailingWhitespaceLines;
    blankLinesRemoved += result.blankLinesRemoved;
    console.log(`${path.relative(args.root, file)}\ttrailing-lines=${result.trailingWhitespaceLines}\tblank-lines-removed=${result.blankLinesRemoved}`);

    if (args.apply) {
      backupManager.backupBeforeWrite(file);
      fs.writeFileSync(file, result.source, "utf8");
    }
  }

  console.log();
  console.log(`Scanned: ${scanned}`);
  console.log(`Changed: ${changed}`);
  console.log(`Trailing-whitespace lines: ${trailingWhitespaceLines}`);
  console.log(`Blank lines removed: ${blankLinesRemoved}`);
  if (args.apply && changed > 0) {
    console.log(`Backup: ${backupManager.runRoot}`);
  }
  return 0;
}

module.exports = {
  collectProtectedRanges,
  normalizeHtmlWhitespace,
  splitLines,
};

if (require.main === module) {
  process.exitCode = main();
}
