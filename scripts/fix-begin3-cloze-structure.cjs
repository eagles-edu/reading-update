#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const { createBackupManager } = require("./write-backup.cjs");

const ROOT = path.resolve(__dirname, "..");
const BEGIN3_DIR = path.join(ROOT, "begin3", "cloze");
const backupManager = createBackupManager(ROOT, "fix-begin3-cloze-structure");

function main() {
  const files = glob.sync("*.html", {
    absolute: true,
    cwd: BEGIN3_DIR,
    dot: true,
  });

  let changed = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const next = source.replace(
      /\n\s*<\/div>\n\s*<div class="Feedback" id="FeedbackDiv">/g,
      "\n\n<div class=\"Feedback\" id=\"FeedbackDiv\">"
    );

    if (next !== source) {
      backupManager.backupBeforeWrite(file);
      fs.writeFileSync(file, next);
      changed += 1;
      console.log(path.relative(ROOT, file));
    }
  }

  console.log(`Changed: ${changed}`);
}

process.exitCode = main();
