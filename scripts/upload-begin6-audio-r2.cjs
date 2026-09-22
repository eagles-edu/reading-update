#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createClient } = require("./upload-r2-audio.cjs");

const ROOT = path.resolve(__dirname, "..");
const GATEWAY_PREFIX = "/reading/_audio/";

function usage() {
  console.log(`Usage: node scripts/upload-begin6-audio-r2.cjs [options]

The default mode inventories the local Begin6 audio manifest. R2 writes require --apply.

Options:
  --apply                  Upload and byte-verify all Begin6 audio objects
  --dry-run                Inventory only (default)
  --root=PATH              Repository root (default: current repository)
  --audio-manifest=PATH    Download manifest (default: docs/404/begin6-audio-manifest.json)
  --r2-manifest=PATH       Production gateway manifest (default: poc/r2-read-audio-all.json)
  --min-delay-ms=N         Delay between R2 operations (default: 500)
  --max-delay-ms=N         Delay between R2 operations (default: 1200)
  --retry-base-ms=N        Retry backoff base (default: 2000)
  --max-attempts=N         Attempts per object operation (default: 4)
  --help                   Show this help
`);
}

function parseArgs(argv) {
  const result = {
    apply: false,
    root: ROOT,
    audioManifest: "docs/404/begin6-audio-manifest.json",
    r2Manifest: "poc/r2-read-audio-all.json",
    minDelayMs: 500,
    maxDelayMs: 1200,
    retryBaseMs: 2000,
    maxAttempts: 4,
  };
  const pathOptions = new Map([
    ["--root", "root"],
    ["--audio-manifest", "audioManifest"],
    ["--r2-manifest", "r2Manifest"],
  ]);
  const numberOptions = new Map([
    ["--min-delay-ms", "minDelayMs"],
    ["--max-delay-ms", "maxDelayMs"],
    ["--retry-base-ms", "retryBaseMs"],
    ["--max-attempts", "maxAttempts"],
  ]);

  for (const argument of argv) {
    if (argument === "--apply") {
      result.apply = true;
      continue;
    }
    if (argument === "--dry-run") {
      result.apply = false;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    const match = /^(--[a-z-]+)=(.*)$/.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    const [, name, value] = match;
    if (pathOptions.has(name)) {
      if (!value) throw new Error(`${name} requires a value`);
      result[pathOptions.get(name)] = value;
      continue;
    }
    if (numberOptions.has(name)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
      result[numberOptions.get(name)] = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (result.minDelayMs > result.maxDelayMs) throw new Error("--min-delay-ms cannot exceed --max-delay-ms");
  if (result.maxAttempts < 1) throw new Error("--max-attempts must be at least 1");
  result.root = path.resolve(result.root);
  result.audioManifest = path.resolve(result.root, result.audioManifest);
  result.r2Manifest = path.resolve(result.root, result.r2Manifest);
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function sha256(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function randomInteger(minimum, maximum) {
  if (minimum === maximum) return minimum;
  return minimum + crypto.randomInt(maximum - minimum + 1);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeAtomically(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, body);
  fs.renameSync(temporary, filePath);
}

function validateObjectKey(objectKey) {
  if (!/^begin6\/audio(?:\/d)?\/[0-9a-f]{8}\/[A-Za-z0-9._-]+\.mp3$/i.test(objectKey)) {
    throw new Error(`Invalid Begin6 production object key: ${objectKey}`);
  }
}

function readItems(config) {
  if (!fs.existsSync(config.audioManifest)) throw new Error(`Missing audio manifest: ${config.audioManifest}`);
  const manifest = JSON.parse(fs.readFileSync(config.audioManifest, "utf8"));
  if (!Array.isArray(manifest.records)) throw new Error(`Audio manifest has no records array: ${config.audioManifest}`);
  const seen = new Set();
  const items = manifest.records.map((record) => {
    if (typeof record.gatewayPath !== "string" || !record.gatewayPath.startsWith(GATEWAY_PREFIX)) {
      throw new Error("Audio manifest contains an invalid gateway path");
    }
    const objectKey = record.gatewayPath.slice(GATEWAY_PREFIX.length);
    validateObjectKey(objectKey);
    if (seen.has(objectKey)) throw new Error(`Duplicate Begin6 object key: ${objectKey}`);
    seen.add(objectKey);
    const targetPath = path.join(config.root, ...objectKey.split("/"));
    const relativeTarget = path.relative(config.root, targetPath).split(path.sep).join("/");
    if (!relativeTarget || relativeTarget.startsWith("../") || path.isAbsolute(relativeTarget)) {
      throw new Error(`Unsafe local audio path: ${objectKey}`);
    }
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      throw new Error(`Missing verified local audio file: ${relativeTarget}`);
    }
    const body = fs.readFileSync(targetPath);
    const digest = sha256(body);
    if (record.digest && record.digest !== digest) throw new Error(`Local digest changed for ${relativeTarget}`);
    if (record.expectedShaPrefix && !digest.startsWith(record.expectedShaPrefix)) throw new Error(`Local hash prefix mismatch for ${relativeTarget}`);
    const dictation = objectKey.startsWith("begin6/audio/d/");
    const pagePath = Array.isArray(record.pages) && record.pages.length > 0 ? `/${record.pages[0]}` : null;
    return {
      item: {
        storyId: `begin6-audio:${objectKey}`,
        pagePath,
        sourcePath: relativeTarget,
        kind: dictation ? "dictation" : "story",
        objectKey,
        url: `${GATEWAY_PREFIX}${objectKey}`,
        sha256: digest,
        mime: "audio/mpeg",
        preload: !dictation,
      },
      body,
    };
  });
  return items;
}

function readProductionManifest(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing production R2 manifest: ${filePath}`);
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(manifest.items)) throw new Error(`Production manifest has no items array: ${filePath}`);
  return manifest;
}

function mergeManifest(existing, items) {
  const byKey = new Map();
  for (const item of existing.items) {
    if (byKey.has(item.objectKey)) throw new Error(`Duplicate object key already in production manifest: ${item.objectKey}`);
    byKey.set(item.objectKey, item);
  }
  for (const { item } of items) {
    const prior = byKey.get(item.objectKey);
    if (prior && prior.sha256 !== item.sha256) throw new Error(`Production manifest hash conflict: ${item.objectKey}`);
    if (!prior) byKey.set(item.objectKey, item);
  }
  return {
    ...existing,
    schemaVersion: existing.schemaVersion || 1,
    collections: [...new Set([...(existing.collections || []), "b6"])],
    includesDictation: true,
    items: [...byKey.values()],
  };
}

async function withRetry(operation, label, config) {
  let lastError;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === config.maxAttempts) break;
      const delay = config.retryBaseMs * 2 ** (attempt - 1) + randomInteger(0, config.retryBaseMs);
      console.error(`retrying ${label} after attempt ${attempt}/${config.maxAttempts} in ${delay}ms: ${error.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

async function uploadItem(client, entry, config, lastOperationAt) {
  const elapsed = Date.now() - lastOperationAt.value;
  const delay = randomInteger(config.minDelayMs, config.maxDelayMs);
  if (delay > elapsed) await sleep(delay - elapsed);
  lastOperationAt.value = Date.now();

  const { item, body } = entry;
  const head = await client.request("HEAD", item.objectKey);
  let matches = head.status === 200 && Number(head.headers["content-length"]) === body.length;
  if (matches) {
    const current = await client.request("GET", item.objectKey);
    matches = current.status === 200 && current.body.equals(body);
  }
  if (matches) return "reused";

  const put = await client.request("PUT", item.objectKey, body);
  if (put.status < 200 || put.status >= 300) throw new Error(`R2 upload failed HTTP ${put.status}`);
  const verified = await client.request("GET", item.objectKey);
  if (verified.status !== 200 || !verified.body.equals(body)) throw new Error(`R2 byte verification failed HTTP ${verified.status}`);
  return "uploaded";
}

async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    usage();
    return 2;
  }
  loadEnvFile(path.join(config.root, ".env"));
  for (const name of ["R2_BUCKET", "R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    if (!process.env[name]) throw new Error(`Missing ${name} in ${path.join(config.root, ".env")}`);
  }
  const endpoint = new URL(process.env.R2_ENDPOINT_URL);
  if (endpoint.protocol !== "https:") throw new Error("R2_ENDPOINT_URL must use https");

  const items = readItems(config);
  const existing = readProductionManifest(config.r2Manifest);
  const storyCount = items.filter(({ item }) => item.kind === "story").length;
  const dictationCount = items.length - storyCount;
  const existingBegin6 = existing.items.filter((item) => item.objectKey?.startsWith("begin6/audio/")).length;
  console.log(`Mode: ${config.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Begin6 objects: ${items.length} (${storyCount} story, ${dictationCount} dictation)`);
  console.log(`Already in production manifest: ${existingBegin6}`);
  console.log(`R2 bucket: ${process.env.R2_BUCKET}`);
  console.log(`R2 endpoint: ${endpoint.host}`);
  if (!config.apply) return 0;

  const client = createClient({
    bucket: process.env.R2_BUCKET,
    endpoint,
    region: process.env.R2_REGION || "auto",
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  });
  const lastOperationAt = { value: 0 };
  let uploaded = 0;
  let reused = 0;
  for (let index = 0; index < items.length; index += 1) {
    const entry = items[index];
    const outcome = await withRetry(() => uploadItem(client, entry, config, lastOperationAt), entry.item.objectKey, config);
    if (outcome === "uploaded") uploaded += 1;
    else reused += 1;
    console.log(`[${index + 1}/${items.length}] ${outcome} ${entry.item.objectKey}`);
  }

  const merged = mergeManifest(existing, items);
  const added = merged.items.length - existing.items.length;
  if (added === 0) {
    console.log(JSON.stringify({ uploaded, reused, verified: items.length, added, manifest: config.r2Manifest }, null, 2));
    return 0;
  }
  const backupPath = path.join(config.root, ".backups", `r2-read-audio-all-before-b6-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(config.r2Manifest, backupPath);
  writeAtomically(config.r2Manifest, Buffer.from(`${JSON.stringify(merged, null, 2)}${os.EOL}`, "utf8"));
  console.log(JSON.stringify({ uploaded, reused, verified: items.length, added, manifest: config.r2Manifest, backup: backupPath }, null, 2));
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { mergeManifest, readItems };
