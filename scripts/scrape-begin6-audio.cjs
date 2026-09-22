#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const cheerio = require("cheerio");

const ROOT = path.resolve(__dirname, "..");
const USER_AGENT = "efast-copy-begin6-audio-recovery/1.0 (+https://www.eslfast.com/)";
const GATEWAY_PREFIX = "/reading/_audio/begin6/audio/";

function parseArgs(argv) {
  const result = {
    apply: false,
    family: "all",
    sourceOrigin: "https://www.eslfast.com",
    minDelayMs: 1200,
    maxDelayMs: 3200,
    retryBaseMs: 2500,
    maxAttempts: 4,
    timeoutMs: 60000,
    concurrency: 1,
    manifestPath: "docs/404/begin6-audio-manifest.json",
    logPath: "docs/404/begin6-audio.log",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      result.apply = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const [, name, value] = match;
    if (name === "--family") {
      if (!["all", "stories", "dictation"].includes(value)) {
        throw new Error("--family must be all, stories, or dictation");
      }
      result.family = value;
      continue;
    }
    if (name === "--source-origin") {
      result.sourceOrigin = value.replace(/\/$/, "");
      new URL(result.sourceOrigin);
      continue;
    }
    const numberOptions = new Map([
      ["--min-delay-ms", "minDelayMs"],
      ["--max-delay-ms", "maxDelayMs"],
      ["--retry-base-ms", "retryBaseMs"],
      ["--max-attempts", "maxAttempts"],
      ["--timeout-ms", "timeoutMs"],
      ["--concurrency", "concurrency"],
    ]);
    if (numberOptions.has(name)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
      }
      result[numberOptions.get(name)] = parsed;
      continue;
    }
    const pathOptions = new Map([
      ["--manifest", "manifestPath"],
      ["--log", "logPath"],
    ]);
    if (pathOptions.has(name) && value.length > 0) {
      result[pathOptions.get(name)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (result.minDelayMs > result.maxDelayMs) {
    throw new Error("--min-delay-ms cannot exceed --max-delay-ms");
  }
  if (result.maxAttempts < 1) throw new Error("--max-attempts must be at least 1");
  if (result.concurrency < 1) throw new Error("--concurrency must be at least 1");
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/scrape-begin6-audio.cjs [options]

Inventory is the default. Network downloads and writes require --apply.

Options:
  --apply                  Download and write every referenced MP3
  --dry-run                Inventory only (default)
  --family=NAME            all, stories, or dictation (default: all)
  --source-origin=URL      Source host (default: https://www.eslfast.com)
  --min-delay-ms=N         Minimum delay between source requests (default: 1200)
  --max-delay-ms=N         Maximum delay between source requests (default: 3200)
  --retry-base-ms=N        Retry backoff base (default: 2500)
  --max-attempts=N         Attempts per source URL (default: 4)
  --timeout-ms=N           Source request timeout (default: 60000)
  --concurrency=N          Simultaneous downloads (default: 1)
  --manifest=PATH          Manifest path (default: docs/404/begin6-audio-manifest.json)
  --log=PATH               Request log path (default: docs/404/begin6-audio.log)
`);
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function pageFiles(family) {
  const files = [];
  const directories = family === "stories" || family === "all" ? ["begin6/b6"] : [];
  if (family === "dictation" || family === "all") directories.push("begin6/dict");

  for (const directory of directories) {
    const absoluteDirectory = path.join(ROOT, directory);
    for (const name of fs.readdirSync(absoluteDirectory).sort()) {
      const isStory = directory === "begin6/b6" && /^b6\d{3}\.html?$/i.test(name);
      const isDictation = directory === "begin6/dict" && /^b6d\d{3}\.html?$/i.test(name);
      if (isStory || isDictation) files.push(path.join(absoluteDirectory, name));
    }
  }
  return files;
}

function extractGatewayPath(value) {
  let url;
  try {
    url = new URL(value, "https://local.invalid");
  } catch {
    return null;
  }
  if (!url.pathname.startsWith(GATEWAY_PREFIX) || !/\.mp3$/i.test(url.pathname)) return null;
  return url.pathname;
}

function sourcePathFromGateway(gatewayPath) {
  const rest = gatewayPath.slice(GATEWAY_PREFIX.length).split("/");
  if (rest.length === 2 && /^[a-f0-9]{8}$/i.test(rest[0])) {
    return `/begin6/audio/${rest[1]}`;
  }
  if (rest.length === 3 && rest[0] === "d" && /^[a-f0-9]{8}$/i.test(rest[1])) {
    return `/begin6/audio/d/${rest[2]}`;
  }
  throw new Error(`Unsupported Begin6 audio gateway path: ${gatewayPath}`);
}

function expectedShaPrefix(gatewayPath) {
  const rest = gatewayPath.slice(GATEWAY_PREFIX.length).split("/");
  const hash = rest[0] === "d" ? rest[1] : rest[0];
  if (!/^[a-f0-9]{8}$/i.test(hash)) throw new Error(`Missing eight-character SHA-256 prefix: ${gatewayPath}`);
  return hash.toLowerCase();
}

function targetPath(gatewayPath) {
  const relativePath = gatewayPath.slice("/reading/_audio/".length);
  const parts = relativePath.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe target path: ${gatewayPath}`);
  }
  return path.join(ROOT, ...parts);
}

function collectRecords(family) {
  const recordsByGatewayPath = new Map();
  for (const file of pageFiles(family)) {
    const html = fs.readFileSync(file, "utf8");
    const $ = cheerio.load(html);
    $("audio[src], audio source[src]").each((_, element) => {
      const gatewayPath = extractGatewayPath($(element).attr("src"));
      if (!gatewayPath) return;
      const sourcePath = sourcePathFromGateway(gatewayPath);
      const record = recordsByGatewayPath.get(gatewayPath) || {
        gatewayPath,
        sourcePath,
        sourceUrl: null,
        targetPath: targetPath(gatewayPath),
        expectedShaPrefix: expectedShaPrefix(gatewayPath),
        pages: [],
      };
      const page = relative(ROOT, file);
      if (!record.pages.includes(page)) record.pages.push(page);
      recordsByGatewayPath.set(gatewayPath, record);
    });
  }

  const records = [...recordsByGatewayPath.values()].sort((left, right) => left.gatewayPath.localeCompare(right.gatewayPath));
  for (const record of records) record.sourceUrl = new URL(record.sourcePath, config.sourceOrigin).href;
  return records;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomInteger(minimum, maximum) {
  if (minimum === maximum) return minimum;
  return minimum + crypto.randomInt(maximum - minimum + 1);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function requestOnce(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 4) {
          response.resume();
          requestOnce(new URL(location, url).href, redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks) }));
      },
    );
    request.setTimeout(config.timeoutMs, () => request.destroy(new Error(`timeout after ${config.timeoutMs}ms`)));
    request.on("error", reject);
  });
}

async function fetchRecord(record, lastRequestAt) {
  const elapsed = Date.now() - lastRequestAt.value;
  const delay = randomInteger(config.minDelayMs, config.maxDelayMs);
  const waitFor = Math.max(0, delay - elapsed);
  if (waitFor > 0) await sleep(waitFor);
  lastRequestAt.value = Date.now();

  let lastError = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const response = await requestOnce(record.sourceUrl);
      if (response.status >= 200 && response.status < 300) {
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        if (!contentType.includes("audio/mpeg") && !contentType.includes("audio/mp3") && !contentType.includes("application/octet-stream")) {
          throw new Error(`unexpected content type ${contentType || "missing"}`);
        }
        if (response.body.length < 64) throw new Error(`body too small (${response.body.length} bytes)`);
        const digest = sha256(response.body);
        if (!digest.startsWith(record.expectedShaPrefix)) {
          throw new Error(`SHA-256 ${digest} does not start with ${record.expectedShaPrefix}`);
        }
        return {
          attempts: attempt,
          bytes: response.body.length,
          digest,
          body: response.body,
          contentType,
        };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < config.maxAttempts) {
      await sleep(config.retryBaseMs * 2 ** (attempt - 1) + randomInteger(0, config.retryBaseMs));
    }
  }
  throw new Error(`${record.sourceUrl}: ${lastError?.message || "request failed"}`);
}

function inspectLocal(record) {
  if (!fs.existsSync(record.targetPath)) return { state: "missing" };
  const body = fs.readFileSync(record.targetPath);
  const digest = sha256(body);
  return {
    state: digest.startsWith(record.expectedShaPrefix) ? "verified" : "wrong-hash",
    bytes: body.length,
    digest,
  };
}

function writeAtomically(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.part`);
  fs.writeFileSync(temporary, body, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

function writeJson(file, value) {
  const body = `${JSON.stringify(value, null, 2)}${os.EOL}`;
  writeAtomically(file, Buffer.from(body, "utf8"));
}

function writeLog(file, entries) {
  const body = entries.map((entry) => JSON.stringify(entry)).join(os.EOL) + (entries.length ? os.EOL : "");
  writeAtomically(file, Buffer.from(body, "utf8"));
}

function summarize(records) {
  const stories = records.filter((record) => record.gatewayPath.startsWith("/reading/_audio/begin6/audio/") && !record.gatewayPath.startsWith("/reading/_audio/begin6/audio/d/")).length;
  const dictation = records.length - stories;
  return { total: records.length, stories, dictation };
}

let config;

async function main(argv = process.argv.slice(2)) {
  try {
    config = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printHelp();
    return 2;
  }

  const records = collectRecords(config.family);
  const summary = summarize(records);
  const manifestFile = path.join(ROOT, config.manifestPath);
  const logFile = path.join(ROOT, config.logPath);
  const events = [];
  const local = records.map((record) => ({ ...record, local: inspectLocal(record) }));

  console.log(`Mode: ${config.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Family: ${config.family}`);
  console.log(`Pages: ${pageFiles(config.family).length}`);
  console.log(`Audio references: ${summary.total} (${summary.stories} story, ${summary.dictation} dictation)`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Already verified locally: ${local.filter((record) => record.local.state === "verified").length}`);
  console.log(`Missing locally: ${local.filter((record) => record.local.state === "missing").length}`);
  console.log(`Wrong hash locally: ${local.filter((record) => record.local.state === "wrong-hash").length}`);

  if (!config.apply) {
    writeJson(manifestFile, {
      generatedAt: new Date().toISOString(),
      mode: "dry-run",
      sourceOrigin: config.sourceOrigin,
      summary,
      records: local.map(({ body, ...record }) => record),
    });
    console.log(`Inventory manifest: ${relative(ROOT, manifestFile)}`);
    return 0;
  }

  const lastRequestAt = { value: 0 };
  const results = [];
  let nextIndex = 0;
  let failed = false;
  async function worker() {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= local.length) return;
      const record = local[index];
      if (record.local.state === "verified") {
        results.push({ ...record, result: "already-verified", bytes: record.local.bytes, digest: record.local.digest });
        console.log(`[${index + 1}/${local.length}] verified ${record.gatewayPath}`);
        continue;
      }
      try {
        const fetched = await fetchRecord(record, lastRequestAt);
        writeAtomically(record.targetPath, fetched.body);
        const after = inspectLocal(record);
        if (after.state !== "verified") throw new Error(`post-write verification failed for ${record.targetPath}`);
        results.push({ ...record, result: record.local.state === "missing" ? "downloaded" : "repaired", bytes: fetched.bytes, digest: fetched.digest, attempts: fetched.attempts });
        events.push({ at: new Date().toISOString(), event: "downloaded", sourceUrl: record.sourceUrl, target: relative(ROOT, record.targetPath), bytes: fetched.bytes, digest: fetched.digest, attempts: fetched.attempts });
        console.log(`[${index + 1}/${local.length}] ${record.local.state === "missing" ? "downloaded" : "repaired"} ${record.gatewayPath} (${fetched.bytes} bytes)`);
      } catch (error) {
        failed = true;
        results.push({ ...record, result: "failed", error: error.message });
        events.push({ at: new Date().toISOString(), event: "failed", sourceUrl: record.sourceUrl, target: relative(ROOT, record.targetPath), error: error.message });
        console.error(`[${index + 1}/${local.length}] FAILED ${record.gatewayPath}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.concurrency, local.length) }, () => worker()));
  if (failed) {
    writeJson(manifestFile, {
      generatedAt: new Date().toISOString(),
      mode: "apply-incomplete",
      sourceOrigin: config.sourceOrigin,
      summary,
      completed: results.length,
      records: results.map(({ body, ...item }) => item),
    });
    writeLog(logFile, events);
    return 1;
  }

  writeJson(manifestFile, {
    generatedAt: new Date().toISOString(),
    mode: "apply-complete",
    sourceOrigin: config.sourceOrigin,
    summary,
    completed: results.length,
    records: results.map(({ body, ...record }) => record),
  });
  writeLog(logFile, events);
  console.log(`Manifest: ${relative(ROOT, manifestFile)}`);
  console.log(`Log: ${relative(ROOT, logFile)}`);
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  collectRecords,
  expectedShaPrefix,
  sourcePathFromGateway,
  targetPath,
};
