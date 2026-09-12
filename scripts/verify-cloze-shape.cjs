#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const glob = require("glob");

const ROOT = path.resolve(__dirname, "..");
const FAMILIES = [
  "begin1/cloze",
  "begin2/cloze",
  "begin3/cloze",
  "begin4/cloze",
  "begin5/cloze",
  "begin6/cloze",
];

const REQUIRED_PATTERNS = [
  { label: 'id="InstructionsDiv"', re: /id\s*=\s*"InstructionsDiv"/i },
  {
    label: 'data-cloze-instructions and empty #Instructions target',
    re: /<div\b(?=[^>]*\bid="InstructionsDiv")(?=[^>]*\bdata-cloze-instructions="[^"]+")[^>]*>\s*<div\b(?=[^>]*\bid="Instructions")[^>]*>\s*<\/div>\s*<\/div>/i,
  },
  { label: 'id="MainDiv"', re: /id\s*=\s*"MainDiv"/i },
  { label: 'id="ClozeDiv"', re: /id\s*=\s*"ClozeDiv"/i },
  { label: 'id="FeedbackDiv"', re: /id\s*=\s*"FeedbackDiv"/i },
  { label: 'id="FeedbackOKButton"', re: /id\s*=\s*"FeedbackOKButton"/i },
  { label: 'class="btn17Container"', re: /class\s*=\s*"btn17Container"/i },
  {
    label: 'class="btn-17" type="submit" form="Cloze" id="check"',
    re: /class\s*=\s*"btn-17"[\s\S]*?type\s*=\s*"submit"[\s\S]*?form\s*=\s*"Cloze"[\s\S]*?id\s*=\s*"check"/i,
  },
  {
    label: 'class="btn-17" type="button" id="hint"',
    re: /class\s*=\s*"btn-17"[\s\S]*?type\s*=\s*"button"[\s\S]*?id\s*=\s*"hint"/i,
  },
  { label: 'class="btn-74" type="button"', re: /class\s*=\s*"btn-74"[\s\S]*?type\s*=\s*"button"/i },
  { label: 'css/sis-cloze-submit.css', re: /css\/sis-cloze-submit\.css/i },
  { label: 'style/font-stack.css', re: /style\/font-stack\.css/i },
  { label: 'theme-selector.js', re: /theme-selector\.js/i },
  { label: 'story-theme.js', re: /story-theme\.js/i },
  { label: 'href="/reading/favicon.ico"', re: /href\s*=\s*"\/reading\/favicon\.ico"/i },
  { label: 'sis-cloze-submit.js', re: /sis-cloze-submit\.js/i },
];

const FORBIDDEN_SNIPPETS = [
  '<div class="TopNavBar"',
  '<div class="NavButtonBar"',
  '<div class="ClozeInstructions">',
];
const IGNORED_PATTERNS = ["**/*.copy.html", "**/*.legacy.html", "**/*.prototype.html"];

function listFiles(dir) {
  return glob.sync("*.html", {
    absolute: true,
    cwd: path.resolve(ROOT, dir),
    dot: true,
    ignore: IGNORED_PATTERNS,
  });
}

function main() {
  const failures = [];
  let count = 0;

  const runtimeScript = fs.readFileSync(path.resolve(ROOT, "js/sis-cloze-submit.js"), "utf8");
  if (!runtimeScript.includes("sis-cloze-instructions") || !/label\.textContent\s*=\s*"CLOZE"/.test(runtimeScript)) {
    failures.push({
      file: "js/sis-cloze-submit.js",
      missing: ["JavaScript-generated CLOZE instruction paragraph"],
      forbidden: [],
    });
  }

  for (const family of FAMILIES) {
    for (const file of listFiles(family)) {
      count += 1;
      const source = fs.readFileSync(file, "utf8");
      const missing = REQUIRED_PATTERNS.filter((pattern) => !pattern.re.test(source)).map(
        (pattern) => pattern.label
      );
      const filenameMatch = path.basename(file).match(/^b([1-6])cloze(\d{3})\.html$/i);
      const storyThemeScript = source.match(/<script\b[^>]*story-theme\.js[^>]*><\/script>/i);
      const actualStoryKey = storyThemeScript
        ? storyThemeScript[0].match(/\bdata-story-theme-key\s*=\s*["']([^"']+)["']/i)
        : null;
      const expectedStoryKey = filenameMatch
        ? `b${filenameMatch[1]}${filenameMatch[2]}.html`
        : "";
      if (!expectedStoryKey || !actualStoryKey || actualStoryKey[1] !== expectedStoryKey) {
        missing.push("matching data-story-theme-key for linked story");
      }
      const forbidden = FORBIDDEN_SNIPPETS.filter((snippet) => source.includes(snippet));
      if (missing.length > 0 || forbidden.length > 0) {
        failures.push({
          file: path.relative(ROOT, file),
          missing,
          forbidden,
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error("cloze shape check failed:");
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
    return;
  }

  console.log(`Checked ${count} cloze pages across ${FAMILIES.length} families: OK`);
}

main();
