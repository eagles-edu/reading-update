#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const defaultRoot = "/home/thuvien.eagles.edu.vn/public_html/turn4js/flip";
const root = path.resolve(process.argv[2] || defaultRoot);
const backupRoot = path.join(
  repositoryRoot,
  ".backups",
  `turn4js-flip-r2-preload-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const preloadSource = path.join(repositoryRoot, "deploy/flip-r2-preload.js");
const preloadTarget = path.join(root, "../lib/flip-r2-preload.js");

function walk(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, files);
    else if (entry.isFile() && /\.html?$/i.test(entry.name))
      files.push(absolutePath);
  }
}

if (!fs.statSync(root).isDirectory())
  throw new Error(`Missing flip root: ${root}`);
if (!fs.statSync(preloadSource).isFile())
  throw new Error(`Missing preload source: ${preloadSource}`);

const htmlFiles = [];
walk(root, htmlFiles);
const changedFiles = [];
for (const filePath of htmlFiles) {
  const original = fs.readFileSync(filePath, "utf8");
  const needsPreload =
    /['"]\/?js\/magazine\.js['"]/.test(original) &&
    !original.includes("flip-r2-preload.js");
  const hasJquery = /jquery(?:\.min(?:\.1\.7)?|[-.]\d[\w.-]*)?\.js/i.test(
    original,
  );
  const needsJquery =
    /jquery-ui-1\.8\.20\.custom\.min\.js/i.test(original) && !hasJquery;
  const needsLocalAssetPaths =
    original.includes("'/assets/js/turn.js'") ||
    original.includes("'/assets/js/turn.html4.min.js'") ||
    original.includes("'/assets/js/zoom.min.js'") ||
    original.includes("'/js/magazine.js'") ||
    original.includes("'/css/magazine.css'");
  if (!needsPreload && !needsJquery && !needsLocalAssetPaths) continue;

  let updated = original;
  if (needsPreload) {
    updated = updated.replace(
      /(['"]\/?js\/magazine\.js['"])(\s*,?)/g,
      "$1, '../../lib/flip-r2-preload.js'$2",
    );
  }
  if (needsJquery) {
    const jqueryUiScript =
      /(<script[^>]+src=["'][^"']*jquery-ui-1\.8\.20\.custom\.min\.js["'][^>]*>\s*<\/script>)/i;
    if (!jqueryUiScript.test(updated)) {
      throw new Error(`Cannot locate jQuery UI script in ${filePath}`);
    }
    updated = updated.replace(
      jqueryUiScript,
      '<script type="text/javascript" src="../../extras/jquery.min.1.7.js"></script>\n    $1',
    );
  }
  if (needsLocalAssetPaths) {
    updated = updated
      .replaceAll("'/assets/js/turn.js'", "'../../lib/turn.js'")
      .replaceAll(
        "'/assets/js/turn.html4.min.js'",
        "'../../lib/turn.html4.min.js'",
      )
      .replaceAll("'/assets/js/zoom.min.js'", "'../../lib/zoom.min.js'")
      .replaceAll("'/js/magazine.js'", "'js/magazine.js'")
      .replaceAll("'/css/magazine.css'", "'css/magazine.css'");
  }
  updated = updated.replace(
    /\s*<script[^>]+src=["']ajax\.googleapis\.com\/ajax\/libs\/jquery\/1\.4\.2\/jquery\.min\.js["'][^>]*>\s*<\/script>\s*/gi,
    "\n",
  );
  const relativePath = path.relative(root, filePath);
  const backupPath = path.join(backupRoot, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, updated);
  changedFiles.push(relativePath);
}

fs.mkdirSync(path.dirname(preloadTarget), { recursive: true });
fs.copyFileSync(preloadSource, preloadTarget);
process.stdout.write(
  `${JSON.stringify({ root, preloadTarget, changedFiles: changedFiles.length, backupRoot, files: changedFiles }, null, 2)}\n`,
);
