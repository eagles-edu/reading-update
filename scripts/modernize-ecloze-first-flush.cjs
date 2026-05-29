#!/usr/bin/env node

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const glob = require("glob");
const { createBackupManager } = require("./write-backup.cjs");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE_SCRIPT = path.resolve(ROOT, "scripts/modernize-ecloze-sample.cjs");
const DEFAULT_SOURCE = path.resolve(ROOT, "easyread/ecloze/ecloze050.legacy.html");
const DEFAULT_TARGET = path.resolve(ROOT, "easyread/ecloze/ecloze050.prototype.html");
const DEFAULT_FAMILY_DIR = path.resolve(ROOT, "easyread/ecloze");
const backupManager = createBackupManager(ROOT, "modernize-ecloze-first-flush");

const STRUCTURAL_CODES = new Set(["close-order", "no-implicit-close", "element-permitted-content"]);
const TARGET_CODES = new Set(["heading-level", "input-missing-label"]);

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--source FILE] [--target FILE] [--bulk] [--apply]

First-flush ecloze workflow:
  1. copy a legacy page into the live easyread/ecloze directory
  2. lint the copy and classify failures
  3. stop on broken structural errors
  4. modernize only the established target shape: h1 + labeled gaps
  5. lint again
  6. optionally run the family modernizer in bulk

Options:
  --source FILE  Legacy source page. Defaults to easyread/ecloze/ecloze050.legacy.html.
  --target FILE  Prototype target page. Defaults to easyread/ecloze/ecloze050.prototype.html.
  --bulk         After the prototype is clean, run the family modernizer too.
  --apply        Write changes instead of dry-running.
  --help         Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    bulk: false,
    help: false,
    source: DEFAULT_SOURCE,
    target: DEFAULT_TARGET,
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
    if (arg === "--source") {
      i += 1;
      if (i >= argv.length) throw new Error("--source requires a path");
      args.source = path.resolve(ROOT, argv[i]);
      continue;
    }
    if (arg === "--target") {
      i += 1;
      if (i >= argv.length) throw new Error("--target requires a path");
      args.target = path.resolve(ROOT, argv[i]);
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

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    code: result.status == null ? 1 : result.status,
    error: result.error ? result.error.message : null,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
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

function classifyLint(output) {
  const found = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\b([a-z][a-z0-9-]+)\s*$/i);
    if (!match) continue;
    const code = match[1];
    if (STRUCTURAL_CODES.has(code) || TARGET_CODES.has(code)) {
      found.add(code);
    }
  }
  return found;
}

function copyIntoPrototype(source, target) {
  if (!fs.existsSync(source)) {
    throw new Error(`missing source file: ${path.relative(ROOT, source)}`);
  }
  if (fs.existsSync(target)) {
    backupManager.backupBeforeWrite(target);
  }
  fs.copyFileSync(source, target);
}

function listFamilyFiles() {
  return glob.sync("*.html", {
    absolute: true,
    cwd: DEFAULT_FAMILY_DIR,
    dot: true,
    ignore: ["**/*.copy.html", "**/*.legacy.html", "**/*.prototype.html"],
  });
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

  if (path.dirname(args.source) !== DEFAULT_FAMILY_DIR || path.dirname(args.target) !== DEFAULT_FAMILY_DIR) {
    console.error(`ERROR: source and target must both live in ${path.relative(ROOT, DEFAULT_FAMILY_DIR)}`);
    return 1;
  }

  copyIntoPrototype(args.source, args.target);
  console.log(`Prototype reset from ${path.relative(ROOT, args.source)} -> ${path.relative(ROOT, args.target)}`);

  const preflight = runCapture("npm", ["run", "html:check:file", "--", args.target]);
  const codes = classifyLint(preflight.output);
  const onlyTargetWarnings = [...codes].every((code) => TARGET_CODES.has(code));
  if (preflight.code !== 0 && !onlyTargetWarnings) {
    console.error("ERROR: broken structural lint must be fixed before prototype modernization.");
    return preflight.code;
  }

  const modernize = runStep("prototype modernize", process.execPath, [
    SAMPLE_SCRIPT,
    args.apply ? "--apply" : "--dry-run",
    args.target,
  ]);
  if (modernize !== 0) return modernize;

  const postflight = runStep("postflight lint", "npm", ["run", "html:check:file", "--", args.target]);
  if (postflight !== 0) return postflight;

  if (!args.bulk) {
    return 0;
  }

  const bulk = runStep("bulk family modernize", process.execPath, [
    path.resolve(ROOT, "scripts/modernize-ecloze-pages.cjs"),
    args.apply ? "--apply" : "--dry-run",
  ]);
  if (bulk !== 0) return bulk;

  const verify = runStep("family verify", "npm", ["run", "verify:ecloze"]);
  if (verify !== 0) return verify;

  return 0;
}

process.exitCode = main();
