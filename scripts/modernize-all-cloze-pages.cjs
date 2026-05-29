#!/usr/bin/env node

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FAMILY_SCRIPT = path.resolve(ROOT, "scripts/modernize-cloze-pages.cjs");
const FAMILIES = [
  "begin1/cloze",
  "begin2/cloze",
  "begin3/cloze",
  "begin4/cloze",
  "begin5/cloze",
  "begin6/cloze",
  "easyread/ecloze",
];

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

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
  };
}

function findRepresentative(dir) {
  const absoluteDir = path.resolve(ROOT, dir);
  const files = fs
    .readdirSync(absoluteDir)
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .sort();
  return files.length > 0 ? path.join(absoluteDir, files[0]) : null;
}

function assertInstructionsShell(file) {
  const source = fs.readFileSync(file, "utf8");
  if (/<div class="ClozeInstructions">/i.test(source)) {
    console.error(`ERROR: legacy ClozeInstructions still present in ${file}`);
    return 1;
  }

  const emptyInstructionsShellRe =
    /<div id="InstructionsDiv" class="StdDiv">\s*<div id="Instructions">\s*<\/div>\s*<\/div>/i;
  if (emptyInstructionsShellRe.test(source)) {
    console.error(`ERROR: empty InstructionsDiv in ${file}`);
    return 1;
  }

  const instructionsIndex = source.search(/<div id="InstructionsDiv" class="StdDiv">/i);
  const identityIndex = source.search(/<div id="IdentityDiv" class="StdDiv">/i);
  if (identityIndex !== -1 && instructionsIndex !== -1 && instructionsIndex > identityIndex) {
    console.error(`ERROR: InstructionsDiv appears after IdentityDiv in ${file}`);
    return 1;
  }

  return 0;
}

function runFinalVerify() {
  return runStep("verify all cloze families", "npm", ["run", "verify:cloze"]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  for (const family of FAMILIES) {
    const representative = findRepresentative(family);
    if (!representative) {
      console.error(`ERROR: no HTML files found in ${family}`);
      return 1;
    }

    const beforeLint = runStep(
      `preflight lint ${family}`,
      "npm",
      ["run", "html:check:file", "--", representative]
    );
    if (beforeLint !== 0) return beforeLint;

    const modernize = runStep(
      `modernize ${family}`,
      process.execPath,
      [
        FAMILY_SCRIPT,
        ...(args.apply ? ["--apply"] : ["--dry-run"]),
        "--all",
        "--cloze-dir",
        family,
        "--icon",
        "/favicon.ico",
      ]
    );
    if (modernize !== 0) return modernize;

    const afterLint = runStep(
      `postflight lint ${family}`,
      "npm",
      ["run", "html:check:file", "--", representative]
    );
    if (afterLint !== 0) return afterLint;

    const afterInstructions = assertInstructionsShell(representative);
    if (afterInstructions !== 0) return afterInstructions;

    if (family === "easyread/ecloze") {
      const verify = runStep("verify easyread/ecloze", "npm", ["run", "verify:ecloze"]);
      if (verify !== 0) return verify;
    }
  }

  const finalVerify = runFinalVerify();
  if (finalVerify !== 0) return finalVerify;

  return 0;
}

process.exitCode = main();
