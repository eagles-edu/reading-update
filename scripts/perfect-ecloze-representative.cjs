#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SAMPLE_SCRIPT = path.resolve(__dirname, "modernize-ecloze-sample.cjs");
const FILE = path.resolve(ROOT, "representatives/easyread-ecloze/ecloze050.html");

function main() {
  const result = spawnSync(process.execPath, [SAMPLE_SCRIPT, "--apply", FILE], {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`ERROR: ${result.error.message}`);
    return 1;
  }

  return result.status == null ? 1 : result.status;
}

process.exitCode = main();
