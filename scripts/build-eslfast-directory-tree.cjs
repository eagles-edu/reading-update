#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const cheerio = require("cheerio");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://www.eslfast.com";
const USER_AGENT = "efast-copy-eslfast-directory/1.0 (+https://www.eslfast.com/)";
const DEFAULTS = Object.freeze({
  apply: true,
  minDelayMs: 1200,
  maxDelayMs: 3200,
  retryBaseMs: 2500,
  maxAttempts: 4,
  timeoutMs: 45000,
  treePath: "docs/404/eslfast-directory-tree.md",
  manifestPath: "docs/404/eslfast-directory-manifest.json",
  logPath: "docs/404/eslfast-directory-scrape.log",
});

const config = parseArgs(process.argv.slice(2));
const logs = [];
let lastRequestAt = 0;

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  const numeric = new Set(["--min-delay-ms", "--max-delay-ms", "--retry-base-ms", "--max-attempts", "--timeout-ms"]);
  const paths = new Map([
    ["--tree", "treePath"],
    ["--manifest", "manifestPath"],
    ["--log", "logPath"],
  ]);
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const [, name, value] = match;
    if (numeric.has(name)) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
      args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = number;
    } else if (paths.has(name) && value) {
      args[paths.get(name)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.minDelayMs > args.maxDelayMs) throw new Error("minimum delay exceeds maximum delay");
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/build-eslfast-directory-tree.cjs [options]

Fetches robots.txt, the live sitemap, and the canonical home page, then writes
a complete sitemap-derived directory tree. The tree is written by default.

  --min-delay-ms=N         Minimum request delay (default: 1200)
  --max-delay-ms=N         Maximum request delay (default: 3200)
  --retry-base-ms=N        Exponential retry base delay (default: 2500)
  --max-attempts=N         Maximum attempts per URL (default: 4)
  --timeout-ms=N           Per-request timeout (default: 45000)
  --tree=PATH              Markdown tree path
  --manifest=PATH          JSON manifest path
  --log=PATH               JSONL request log path
`);
}

function log(event, details = {}) {
  const entry = { at: new Date().toISOString(), event, ...details };
  logs.push(entry);
  console.log(JSON.stringify(entry));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomInteger(minimum, maximum) {
  return minimum === maximum ? minimum : minimum + crypto.randomInt(maximum - minimum + 1);
}

async function waitBeforeRequest(url) {
  const targetDelay = randomInteger(config.minDelayMs, config.maxDelayMs);
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = Math.max(0, targetDelay - elapsed);
  if (waitMs > 0) {
    log("delay", { url, waitMs });
    await sleep(waitMs);
  }
  lastRequestAt = Date.now();
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "text/plain,text/html,application/xml,*/*;q=0.5",
        "User-Agent": USER_AGENT,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(config.timeoutMs, () => request.destroy(new Error(`timeout after ${config.timeoutMs}ms`)));
    request.on("error", reject);
  });
}

async function fetchWithRetry(url, kind) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    await waitBeforeRequest(url);
    log("request", { kind, url, attempt });
    try {
      const response = await requestOnce(url);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        log("response", { kind, url, attempt, status: response.statusCode, bytes: response.body.length });
        return { ...response, attempts: attempt };
      }
      lastError = new Error(`HTTP ${response.statusCode}`);
      log("retryable-response", { kind, url, attempt, status: response.statusCode });
    } catch (error) {
      lastError = error;
      log("retryable-error", { kind, url, attempt, message: error.message });
    }
    if (attempt < config.maxAttempts) {
      const waitMs = config.retryBaseMs * 2 ** (attempt - 1) + randomInteger(0, config.retryBaseMs);
      log("backoff", { kind, url, attempt, waitMs });
      await sleep(waitMs);
    }
  }
  throw new Error(`${kind} failed after ${config.maxAttempts} attempts: ${url}: ${lastError?.message || "unknown error"}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].trim())
    .filter((value) => {
      try {
        return new URL(value).origin === ORIGIN;
      } catch {
        return false;
      }
    });
}

function extractSitemapDirective(robotsText) {
  const match = robotsText.match(/^\s*Sitemap:\s*(\S+)\s*$/im);
  return match ? match[1] : null;
}

function treeNode() {
  return { files: new Map(), directories: new Map() };
}

function addToTree(root, url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  let node = root;
  if (segments.length === 0) {
    node.files.set("/", url);
    return;
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!node.directories.has(segment)) node.directories.set(segment, treeNode());
    node = node.directories.get(segment);
  }
  node.files.set(segments.at(-1), url);
}

function markdownLabel(value) {
  return value.replace(/[\\`*_[\]{}<>]/g, "\\$&");
}

function renderTree(node, prefix = "") {
  const entries = [
    ...[...node.directories.entries()].map(([name, child]) => ({ type: "directory", name, child })),
    ...[...node.files.entries()].map(([name, url]) => ({ type: "file", name, url })),
  ].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.type.localeCompare(b.type));
  const lines = [];
  entries.forEach((entry, index) => {
    const last = index === entries.length - 1;
    const branch = last ? "└──" : "├──";
    if (entry.type === "directory") {
      lines.push(`${prefix}${branch} ${markdownLabel(entry.name)}/`);
      lines.push(...renderTree(entry.child, `${prefix}${last ? "    " : "│   "}`));
    } else {
      lines.push(`${prefix}${branch} [${markdownLabel(entry.name)}](${entry.url})`);
    }
  });
  return lines;
}

function countByRoot(urls) {
  const counts = new Map();
  for (const url of urls) {
    const first = new URL(url).pathname.split("/").filter(Boolean)[0] || "/";
    counts.set(first, (counts.get(first) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeAtomic(filePath, contents) {
  ensureParent(filePath);
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

function renderReport({ robotsText, sitemapUrl, sitemapUrls, homeHtml, attempts }) {
  const root = treeNode();
  for (const url of sitemapUrls) addToTree(root, url);
  const counts = countByRoot(sitemapUrls);
  const title = cheerio.load(homeHtml)("title").first().text().replace(/\s+/g, " ").trim();
  const lines = [
    "# www.eslfast.com directory tree",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This is the complete same-origin URL directory advertised by the live XML sitemap. It includes every sitemap URL, including pages that are not currently present in the local checkout. It is not a claim that unindexed files or private server endpoints were enumerated.",
    "",
    `Canonical home page title: ${title || "(no title found)"}`,
    `Sitemap: ${sitemapUrl}`,
    `Sitemap URL count: ${sitemapUrls.length}`,
    `Sitemap URL-list SHA-256: ${sha256(Buffer.from(sitemapUrls.join("\n"), "utf8"))}`,
    "",
    "## Top-level counts",
    "",
    "| Path | URLs |",
    "| --- | ---: |",
    ...Object.entries(counts).map(([name, count]) => `| \`${name === "/" ? "/" : `/${name}`}\` | ${count} |`),
    "",
    "## Robots and source checks",
    "",
    `- Sitemap directive: \`${extractSitemapDirective(robotsText) || "not found"}\``,
    `- Requests completed: ${attempts.length}`,
    "",
    "## Complete tree",
    "",
    ".",
    ...renderTree(root),
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const robotsUrl = `${ORIGIN}/robots.txt`;
  const sitemapUrl = `${ORIGIN}/sitemap.xml`;
  const homeUrl = `${ORIGIN}/index.htm`;
  log("start", { origin: ORIGIN, sitemap: sitemapUrl });
  const robots = await fetchWithRetry(robotsUrl, "robots");
  const sitemap = await fetchWithRetry(sitemapUrl, "sitemap");
  const home = await fetchWithRetry(homeUrl, "home");
  const sitemapUrls = [...new Set(extractLocs(sitemap.body.toString("utf8")))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (sitemapUrls.length === 0) throw new Error("live sitemap contained no same-origin URLs");
  const tree = renderReport({
    robotsText: robots.body.toString("utf8"),
    sitemapUrl,
    sitemapUrls,
    homeHtml: home.body.toString("utf8"),
    attempts: [robots, sitemap, home],
  });
  const manifest = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    scope: "same-origin URLs listed in the live XML sitemap",
    robotsUrl,
    sitemapUrl,
    homeUrl,
    robotsSha256: sha256(robots.body),
    sitemapSha256: sha256(sitemap.body),
    sitemapUrlCount: sitemapUrls.length,
    topLevelCounts: countByRoot(sitemapUrls),
    urls: sitemapUrls,
    config,
    requestLog: logs,
  };
  writeAtomic(path.join(ROOT, config.treePath), tree);
  writeAtomic(path.join(ROOT, config.manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
  writeAtomic(path.join(ROOT, config.logPath), `${logs.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  log("reports-written", { tree: config.treePath, manifest: config.manifestPath, log: config.logPath, sitemapUrlCount: sitemapUrls.length });
  log("complete", { sitemapUrlCount: sitemapUrls.length, topLevelCounts: manifest.topLevelCounts });
}

main().catch((error) => {
  log("fatal", { message: error.message });
  process.exitCode = 1;
});
