#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");
const ECLoze_DIR = path.join(ROOT, "easyread", "ecloze");
const REQUIRED_SNIPPETS = [
  'id="InstructionsDiv"',
  'id="MainDiv"',
  'id="ClozeDiv"',
  'id="FeedbackDiv"',
  'id="FeedbackOKButton"',
  'class="btn17Container"',
  'class="btn-17" type="submit" form="Cloze" id="check"',
  'class="btn-17" type="button" id="hint"',
  'class="btn-74" type="button"',
  'css/sis-cloze-submit.css',
  'style/font-stack.css',
  'theme-selector.js',
  'href="/favicon.ico"',
  'sis-cloze-submit.js',
];

const FORBIDDEN_SNIPPETS = [
  'TopNavBar',
  'NavButtonBar',
];

const files = glob.sync("*.html", {
  absolute: true,
  cwd: ECLoze_DIR,
  dot: true,
  ignore: ["**/*.copy.html", "**/*.legacy.html", "**/*.prototype.html"],
});
const failures = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const missing = REQUIRED_SNIPPETS.filter((snippet) => !source.includes(snippet));
  const forbidden = FORBIDDEN_SNIPPETS.filter((snippet) => source.includes(snippet));
  if (missing.length > 0 || forbidden.length > 0) {
    failures.push({
      file: path.relative(ROOT, file),
      missing,
      forbidden,
    });
  }
}

if (failures.length > 0) {
  console.error("easyread/ecloze shape check failed:");
  for (const failure of failures) {
    const parts = [];
    if (failure.missing.length > 0) {
      parts.push(`missing ${failure.missing.join(", ")}`);
    }
    if (failure.forbidden.length > 0) {
      parts.push(`forbidden ${failure.forbidden.join(", ")}`);
    }
    console.error(`- ${failure.file}: ${parts.join("; ")}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} easyread/ecloze pages: OK`);
}
