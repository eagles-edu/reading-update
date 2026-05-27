#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const glob = require("glob");
const parse5 = require("parse5");

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_ALGO = "sha384";
const HASHABLE_REL_VALUES = new Set(["stylesheet", "preload"]);
const PRELOAD_AS_VALUES = new Set(["style", "script"]);

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--apply] [--verify] [--algo NAME] [--root PATH] [FILE...]

Rehash Subresource Integrity for local HTML-linked CSS and JS assets.

The script scans HTML/HTM files, computes integrity values for local
subresources, and updates or verifies the matching <link> and <script> tags.

Options:
  --apply      Write changes back to disk.
  --verify     Fail if any computed integrity value does not match the HTML.
  --algo NAME  Hash algorithm to use. Defaults to sha384.
  --root PATH  Scan a different repository root.
  --help       Show this help.

Arguments:
  FILE...      Optional explicit HTML/HTM files to process instead of scanning a tree.
`);
}

function parseArgs(argv) {
  const args = {
    algo: DEFAULT_ALGO,
    apply: false,
    files: [],
    root: DEFAULT_ROOT,
    verify: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--verify") {
      args.verify = true;
      continue;
    }
    if (arg === "--algo") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--algo requires a value");
      }
      args.algo = argv[i].trim().toLowerCase();
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
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    args.files.push(path.resolve(arg));
  }

  return args;
}

function readTargets(args) {
  if (args.files.length > 0) {
    return args.files;
  }

  return glob.sync("**/*.{html,htm}", {
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
}

function splitHref(href) {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  let cutIndex = href.length;

  if (queryIndex >= 0) {
    cutIndex = Math.min(cutIndex, queryIndex);
  }
  if (hashIndex >= 0) {
    cutIndex = Math.min(cutIndex, hashIndex);
  }

  return {
    pathPart: href.slice(0, cutIndex),
    suffix: href.slice(cutIndex),
  };
}

function isHashableHref(href) {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("#")
  ) {
    return false;
  }
  return true;
}

function resolveAssetPath(file, root, href) {
  if (!isHashableHref(href)) {
    return null;
  }

  const { pathPart } = splitHref(href);
  if (!pathPart) {
    return null;
  }

  const assetPath = pathPart.startsWith("/")
    ? path.resolve(root, `.${pathPart}`)
    : path.resolve(path.dirname(file), pathPart);

  const relative = path.relative(root, assetPath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    assetPath === root
  ) {
    return null;
  }

  return assetPath;
}

function relValuesFromNode(node) {
  const relAttr = node.attrs?.find((attr) => attr.name.toLowerCase() === "rel");
  if (!relAttr) return [];
  return relAttr.value
    .split(/\s+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getAttrValue(node, name) {
  const attr = node.attrs?.find((candidate) => candidate.name.toLowerCase() === name);
  return attr ? attr.value : null;
}

function setOrReplaceAttr(rawTag, name, value) {
  const attrRe = new RegExp(
    String.raw`(\s${name}\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)`,
    "i"
  );
  if (attrRe.test(rawTag)) {
    return rawTag.replace(attrRe, `$1"${value}"`);
  }

  return rawTag.replace(/(\s*\/?>\s*)$/, (tail) => ` ${name}="${value}"${tail}`);
}

function makeIntegrityValue(algo, digest) {
  return `${algo}-${digest}`;
}

function shouldHashNode(node) {
  if (!node.tagName || !node.sourceCodeLocation?.startTag) {
    return false;
  }

  if (node.tagName === "script") {
    return Boolean(getAttrValue(node, "src"));
  }

  if (node.tagName !== "link") {
    return false;
  }

  const relValues = relValuesFromNode(node);
  if (!relValues.some((value) => HASHABLE_REL_VALUES.has(value))) {
    return false;
  }

  if (relValues.includes("preload")) {
    const asValue = (getAttrValue(node, "as") || "").trim().toLowerCase();
    if (!PRELOAD_AS_VALUES.has(asValue)) {
      return false;
    }
  }

  return Boolean(getAttrValue(node, "href"));
}

function collectEdits(source, file, root, algo, digestCache, warnings) {
  const edits = [];
  const document = parse5.parse(source, { sourceCodeLocationInfo: true });

  const visit = (node) => {
    if (shouldHashNode(node)) {
      const startTag = node.sourceCodeLocation.startTag;
      const rawTag = source.slice(startTag.startOffset, startTag.endOffset);
      const href = getAttrValue(node, "src") || getAttrValue(node, "href");
      const assetPath = resolveAssetPath(file, root, href);

      if (!assetPath) {
        warnings.add(`Skipped non-local resource in ${path.relative(root, file)}: ${href}`);
      } else if (!fs.existsSync(assetPath)) {
        warnings.add(`Missing asset for ${path.relative(root, file)}: ${href}`);
      } else {
        const cacheKey = `${algo}:${assetPath}`;
        let integrityValue = digestCache.get(cacheKey);
        if (!integrityValue) {
          const assetBytes = fs.readFileSync(assetPath);
          const digest = crypto.createHash(algo).update(assetBytes).digest("base64");
          integrityValue = makeIntegrityValue(algo, digest);
          digestCache.set(cacheKey, integrityValue);
        }

        const nextTag = setOrReplaceAttr(rawTag, "integrity", integrityValue);
        if (nextTag !== rawTag) {
          edits.push({
            end: startTag.endOffset,
            replacement: nextTag,
            start: startTag.startOffset,
          });
        }
      }
    }

    if (node.childNodes) {
      for (const child of node.childNodes) {
        visit(child);
      }
    }

    if (node.content?.childNodes) {
      for (const child of node.content.childNodes) {
        visit(child);
      }
    }
  };

  visit(document);
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  return edits;
}

function applyEdits(source, edits) {
  let next = source;
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
  }
  return next;
}

function stripTrailingWhitespace(source) {
  return source.replace(/[ \t]+$/gm, "");
}

function rehashHtmlSource(source, file, root, options = {}) {
  const algo = options.algo || DEFAULT_ALGO;
  const digestCache = options.digestCache || new Map();
  const warnings = options.warnings || new Set();
  const edits = collectEdits(source, file, root, algo, digestCache, warnings);

  if (edits.length === 0) {
    return { source, changes: [], warnings };
  }

  return {
    source: stripTrailingWhitespace(applyEdits(source, edits)),
    changes: edits.map(() => "integrity"),
    warnings,
  };
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

  if (args.apply && args.verify) {
    console.error("ERROR: --apply and --verify are mutually exclusive");
    return 2;
  }

  const files = readTargets(args);
  const digestCache = new Map();
  const warnings = new Set();

  let scanned = 0;
  let changed = 0;
  let integrityUpdates = 0;
  let failed = false;

  console.log(`Mode: ${args.apply ? "APPLY" : args.verify ? "VERIFY" : "DRY-RUN"}`);
  console.log(`Algo: ${args.algo}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, "utf8");
    const updated = rehashHtmlSource(source, file, args.root, {
      algo: args.algo,
      digestCache,
      warnings,
    });

    if (updated.changes.length === 0) {
      continue;
    }

    changed += 1;
    integrityUpdates += updated.changes.length;

    console.log(`${path.relative(args.root, file)}\t${updated.changes.length} integrity update(s)`);

    if (args.apply) {
      if (updated.source !== source) {
        fs.writeFileSync(file, updated.source);
      }
    } else if (args.verify) {
      failed = true;
    }
  }

  if (warnings.size > 0) {
    console.log();
    for (const warning of warnings) {
      console.log(`WARN: ${warning}`);
    }
  }

  console.log();
  console.log(`Scanned: ${scanned}`);
  console.log(`Changed: ${changed}`);
  console.log(`Integrity updates: ${integrityUpdates}`);

  if (args.verify && failed) {
    return 1;
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  rehashHtmlSource,
};
