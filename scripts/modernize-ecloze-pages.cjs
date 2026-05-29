#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT_DIR = __dirname;
const CORE_SCRIPT = path.resolve(SCRIPT_DIR, "modernize-cloze-pages.cjs");
const DEFAULT_ARGS = ["--cloze-dir", "easyread/ecloze", "--icon", "/favicon.ico"];

const result = spawnSync(process.execPath, [CORE_SCRIPT, ...DEFAULT_ARGS, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`ERROR: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status == null ? 1 : result.status;
}
