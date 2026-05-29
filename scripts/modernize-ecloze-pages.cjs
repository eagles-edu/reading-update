#!/usr/bin/env node

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, "..");
const CORE_SCRIPT = path.resolve(SCRIPT_DIR, "modernize-cloze-pages.cjs");
const REPRESENTATIVE_FILE = path.resolve(ROOT, "representatives/easyread-ecloze/ecloze050.html");

function runStep(label, command, args) {
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
  if (!fs.existsSync(REPRESENTATIVE_FILE)) {
    console.error(`ERROR: representative file missing: ${path.relative(ROOT, REPRESENTATIVE_FILE)}`);
    return 1;
  }

  const beforeHtml = runStep("preflight html:check:file", "npm", ["run", "html:check:file", "--", REPRESENTATIVE_FILE]);
  if (beforeHtml !== 0) return beforeHtml;

  const coreArgs = [
    CORE_SCRIPT,
    "--cloze-dir",
    "easyread/ecloze",
    "--icon",
    "/favicon.ico",
    ...process.argv.slice(2),
  ];
  const core = spawnSync(process.execPath, coreArgs, {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (core.error) {
    console.error(`ERROR (modernize): ${core.error.message}`);
    return 1;
  }
  const coreStatus = core.status == null ? 1 : core.status;
  if (coreStatus !== 0) return coreStatus;

  const afterHtml = runStep("postflight html:check:file", "npm", ["run", "html:check:file", "--", REPRESENTATIVE_FILE]);
  if (afterHtml !== 0) return afterHtml;

  const afterVerify = runStep("postflight verify:ecloze", "npm", ["run", "verify:ecloze"]);
  if (afterVerify !== 0) return afterVerify;

  return 0;
}

process.exitCode = main();
