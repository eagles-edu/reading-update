#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
let root = process.cwd();
let backupRoot = "";
let assetOrigin = "https://eagles.io.vn";
let apply = false;

function takeValue(option) {
  const index = args.indexOf(option);
  if (index < 0 || !args[index + 1]) {
    throw new Error(`${option} requires a value`);
  }
  return args[index + 1];
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "Usage: node scripts/migrate-r2-asset-host.cjs [--apply] [--root PATH] [--asset-origin ORIGIN] [--backup-dir PATH]\n",
  );
  process.exit(0);
}
if (args.includes("--apply")) apply = true;
if (args.includes("--root")) root = path.resolve(takeValue("--root"));
if (args.includes("--asset-origin"))
  assetOrigin = takeValue("--asset-origin").replace(/\/$/, "");
if (args.includes("--backup-dir"))
  backupRoot = path.resolve(takeValue("--backup-dir"));

root = path.resolve(root);
if (!fs.statSync(root).isDirectory())
  throw new Error(`Missing root directory: ${root}`);

let originUrl;
try {
  originUrl = new URL(assetOrigin);
} catch {
  throw new Error(`Invalid asset origin: ${assetOrigin}`);
}
if (
  originUrl.protocol !== "https:" ||
  originUrl.pathname !== "/" ||
  originUrl.search ||
  originUrl.hash
) {
  throw new Error(
    "Asset origin must be an HTTPS origin without a path, query, or fragment",
  );
}
assetOrigin = originUrl.origin;

if (!backupRoot) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  backupRoot = path.join(root, ".backups", `r2-asset-host-${timestamp}`);
}

const excludedDirectories = new Set([
  ".backups",
  ".git",
  ".playwright-cli",
  ".sto",
  "node_modules",
  "vendor",
]);

function collectHtml(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name))
        collectHtml(absolutePath, files);
    } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }
}

const htmlFiles = [];
collectHtml(root, htmlFiles);
const routePattern = /(["'])\/(reading\/_audio|turn4js\/flip\/_image)\//g;
let changedFiles = 0;
let changedLinks = 0;

for (const filePath of htmlFiles.sort()) {
  const original = fs.readFileSync(filePath, "utf8");
  let fileLinks = 0;
  const updated = original.replace(routePattern, (match, quote, route) => {
    fileLinks += 1;
    changedLinks += 1;
    return `${quote}${assetOrigin}/${route}/`;
  });
  if (updated === original) continue;

  changedFiles += 1;
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");
  process.stdout.write(
    `${apply ? "updating" : "would update"} ${relativePath} (${fileLinks} link${fileLinks === 1 ? "" : "s"})\n`,
  );
  if (!apply) continue;

  const backupPath = path.join(backupRoot, relativePath);
  if (fs.existsSync(backupPath))
    throw new Error(`Refusing to overwrite backup: ${backupPath}`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(filePath, backupPath);
  const mode = fs.statSync(filePath).mode & 0o777;
  const temporaryPath = `${filePath}.r2-asset-host-${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, updated, { encoding: "utf8", mode });
  fs.chmodSync(temporaryPath, mode);
  fs.renameSync(temporaryPath, filePath);
}

process.stdout.write(
  `${apply ? "applied" : "dry-run"}: ${changedFiles} files, ${changedLinks} links\n`,
);
if (apply && changedFiles > 0) process.stdout.write(`backups: ${backupRoot}\n`);
