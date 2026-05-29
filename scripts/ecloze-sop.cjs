#!/usr/bin/env node

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE_SCRIPT = path.resolve(ROOT, "scripts/modernize-ecloze-sample.cjs");
const FAMILY_SCRIPT = path.resolve(ROOT, "scripts/modernize-ecloze-pages.cjs");
const DEFAULT_COPY = path.resolve(ROOT, "easyread/ecloze/ecloze050.copy.html");
const DEFAULT_FAMILY_DIR = path.resolve(ROOT, "easyread/ecloze");

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--copy FILE] [--family-dir DIR] [--bulk] [--apply]

Codified ecloze SOP:
  1. lint the in-tree working copy
  2. fix broken structure first: close-order, nesting, implicit-close, and similar HTML errors are real code defects
  3. modernize the copy with the representative rules only after it is structurally sound (h1 + labeled gaps)
  4. lint the copy again
  5. optionally apply the proven rules in bulk to easyread/ecloze

Options:
  --copy FILE      Working copy to modernize. Defaults to easyread/ecloze/ecloze050.copy.html.
  --family-dir DIR Live cloze directory to modernize in bulk. Defaults to easyread/ecloze.
  --bulk           Run the family modernizer after the copy passes lint.
  --apply          Write changes instead of dry-running.
  --help           Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    bulk: false,
    copy: DEFAULT_COPY,
    familyDir: DEFAULT_FAMILY_DIR,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--bulk") {
      args.bulk = true;
      continue;
    }
    if (arg === "--copy") {
      i += 1;
      if (i >= argv.length) throw new Error("--copy requires a path");
      args.copy = path.resolve(ROOT, argv[i]);
      continue;
    }
    if (arg === "--family-dir") {
      i += 1;
      if (i >= argv.length) throw new Error("--family-dir requires a path");
      args.familyDir = path.resolve(ROOT, argv[i]);
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

function runStep(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`ERROR (${label}): ${result.error.message}`);
    return 1;
  }
  return result.status == null ? 1 : result.status;
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

  if (!fs.existsSync(args.copy)) {
    console.error(`ERROR: missing working copy: ${path.relative(ROOT, args.copy)}`);
    return 1;
  }

  if (path.dirname(args.copy) !== args.familyDir) {
    console.error(
      `ERROR: working copy must live in ${path.relative(ROOT, args.familyDir)}`
    );
    return 1;
  }

  console.log(
    "NOTE: fix broken structure first; then normalize the established mobile-first shell, shared CSS, SIS reporting bridge, h1 headings, and labeled gaps."
  );

  const beforeLint = runStep("preflight lint", "npm", ["run", "html:check:file", "--", args.copy]);
  if (beforeLint !== 0) return beforeLint;

  const modernizeArgs = [SAMPLE_SCRIPT, args.apply ? "--apply" : "--dry-run", args.copy];
  const modernizeCopy = runStep("modernize copy", process.execPath, modernizeArgs);
  if (modernizeCopy !== 0) return modernizeCopy;

  const afterLint = runStep("postflight lint", "npm", ["run", "html:check:file", "--", args.copy]);
  if (afterLint !== 0) return afterLint;

  if (!args.bulk) {
    return 0;
  }

  if (path.resolve(args.familyDir) !== DEFAULT_FAMILY_DIR) {
    console.error(
      `ERROR: bulk modernization is currently fixed to ${path.relative(ROOT, DEFAULT_FAMILY_DIR)}`
    );
    return 1;
  }

  const familyArgs = [FAMILY_SCRIPT, args.apply ? "--apply" : "--dry-run"];
  const family = runStep("bulk family modernize", process.execPath, familyArgs);
  if (family !== 0) return family;

  const familyLint = runStep("family verify", "npm", ["run", "verify:ecloze"]);
  if (familyLint !== 0) return familyLint;

  return 0;
}

process.exitCode = main();
