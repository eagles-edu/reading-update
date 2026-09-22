#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_ORIGIN = "https://www.eslfast.com";
const USER_AGENT = "efast-copy-begin6-sentence-recovery/1.0 (+https://www.eslfast.com/)";

function parseArgs(argv) {
  const args = {
    apply: false,
    fromStory: 1,
    toStory: 100,
    fromPart: 1,
    toPart: 8,
    concurrency: 4,
    delayMs: 300,
    timeoutMs: 30000,
    maxAttempts: 3,
    manifest: "docs/404/begin6-sentence-scrape-manifest.json",
  };
  const numeric = new Set([
    "--from-story",
    "--to-story",
    "--from-part",
    "--to-part",
    "--concurrency",
    "--delay-ms",
    "--timeout-ms",
    "--max-attempts",
  ]);
  const names = new Map([
    ["--from-story", "fromStory"],
    ["--to-story", "toStory"],
    ["--from-part", "fromPart"],
    ["--to-part", "toPart"],
    ["--concurrency", "concurrency"],
    ["--delay-ms", "delayMs"],
    ["--timeout-ms", "timeoutMs"],
    ["--max-attempts", "maxAttempts"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--manifest=")) {
      args.manifest = arg.slice("--manifest=".length);
      continue;
    }
    const match = /^(--[a-z-]+)=(\d+)$/.exec(arg);
    if (!match || !numeric.has(match[1])) throw new Error(`Unknown argument: ${arg}`);
    args[names.get(match[1])] = Number(match[2]);
  }

  if (args.fromStory < 1 || args.toStory > 100 || args.fromStory > args.toStory) {
    throw new Error("story range must be within 1..100 and start cannot exceed end");
  }
  if (args.fromPart < 1 || args.toPart > 8 || args.fromPart > args.toPart) {
    throw new Error("sentence-page range must be within 1..8 and start cannot exceed end");
  }
  if (args.concurrency < 1 || args.delayMs < 0 || args.timeoutMs < 1 || args.maxAttempts < 1) {
    throw new Error("concurrency, timeout, and attempts must be positive; delay cannot be negative");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/scrape-missing-begin6-sentence-pages.cjs [options]

Dry-run is the default. Use --apply to stage, validate, and write only missing pages.

Options:
  --apply                  Write missing pages after every requested page validates.
  --from-story=N           First story number, default 1.
  --to-story=N             Last story number, default 100.
  --from-part=N            First sentence page, default 1.
  --to-part=N              Last sentence page, default 8.
  --concurrency=N          Concurrent source requests, default 4.
  --delay-ms=N             Delay between request starts, default 300.
  --timeout-ms=N           Per-request timeout, default 30000.
  --max-attempts=N         Attempts per page, default 3.
  --manifest=PATH          Manifest path, default docs/404/begin6-sentence-scrape-manifest.json.
`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlEscape(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function localStoryTitle(story) {
  const storyNumber = String(story).padStart(3, "0");
  const pagePath = path.join(ROOT, "begin6", "sent", `b6mx${storyNumber}1.html`);
  if (!fs.existsSync(pagePath)) return "";
  const source = fs.readFileSync(pagePath, "utf8");
  const title = source.match(/<h[1-6]\b[^>]*\bclass=["'][^"']*\bExerciseTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  return title ? decodeHtmlText(title[1]).replace(/\s*\(\d+\)\s*$/, "").trim() : "";
}

function canonicalPageTitle(target, sourceTitle) {
  const storyTitle = localStoryTitle(target.story);
  if (storyTitle) return `${storyTitle} (${target.part})`;
  const fallback = decodeHtmlText(sourceTitle).replace(/\s*\(\d+\)\s*$/, "").trim();
  return `${fallback} (${target.part})`;
}

function repairPageTitle(source, title) {
  let repaired = source;
  const meta = /<meta\b(?=[^>]*\bname=(['"])DC:Title\1)[^>]*>/i;
  const metaTag = `<meta name="DC:Title" content="${htmlEscape(title)}">`;
  if (meta.test(repaired)) repaired = repaired.replace(meta, metaTag);
  else repaired = repaired.replace(/(<title\b[^>]*>)/i, `${metaTag}\n$1`);
  repaired = repaired.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i, `<title>\n${htmlEscape(title)}\n</title>`);
  const heading = /<h([1-6])\b([^>]*\bclass=(['"])[^'"]*\bExerciseTitle\b[^'"]*\3[^>]*)>[\s\S]*?<\/h\1\s*>/i;
  if (heading.test(repaired)) {
    repaired = repaired.replace(heading, (_match, level, attributes) => `<h${level}${attributes}>${htmlEscape(title)}</h${level}>`);
  }
  return repaired;
}

function targetFor(story, part) {
  const storyNumber = String(story).padStart(3, "0");
  return {
    story,
    part,
    sourceUrl: `${SOURCE_ORIGIN}/begin6/sent/b6mx${storyNumber}${part}.htm`,
    targetPath: path.join(ROOT, "begin6", "sent", `b6mx${storyNumber}${part}.html`),
  };
}

function targetInventory(args) {
  const targets = [];
  for (let story = args.fromStory; story <= args.toStory; story += 1) {
    for (let part = args.fromPart; part <= args.toPart; part += 1) {
      const target = targetFor(story, part);
      if (!fs.existsSync(target.targetPath)) targets.push(target);
    }
  }
  return targets;
}

function requestOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode || 0, body: Buffer.concat(chunks) }));
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.on("error", reject);
  });
}

async function fetchPage(target, args) {
  let lastError = null;
  for (let attempt = 1; attempt <= args.maxAttempts; attempt += 1) {
    try {
      const response = await requestOnce(target.sourceUrl, args.timeoutMs);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP ${response.statusCode}`);
      }
      const source = response.body.toString("utf8");
      const titleMatch = source.match(/<meta\s+name=(['"])DC:Title\1\s+content=(['"])([\s\S]*?)\2/i);
      if (!/<body\b/i.test(source) || !/var\s+Segments\s*=\s*new\s+Array/i.test(source) || !/Answers\[0\]\s*=\s*new\s+Array/i.test(source)) {
        throw new Error("response is not a complete sentence exercise page");
      }
      const sourceTitle = titleMatch ? decodeHtmlText(titleMatch[3]) : "";
      const title = canonicalPageTitle(target, sourceTitle);
      if (!new RegExp(`^${target.story}\\.`).test(title)) {
        throw new Error(`title does not identify story ${target.story}: ${title}`);
      }
      const repairedSource = repairPageTitle(source, title);
      return {
        ...target,
        title,
        titleRepaired: repairedSource !== source,
        bytes: response.body.length,
        sha256: sha256(Buffer.from(repairedSource, "utf8")),
        source: repairedSource,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt < args.maxAttempts) await sleep(1000 * attempt);
    }
  }
  throw new Error(`${target.sourceUrl}: ${lastError ? lastError.message : "request failed"}`);
}

async function fetchTargets(targets, args) {
  const results = [];
  const failures = [];
  let nextIndex = 0;
  let lastStart = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= targets.length) return;
      const target = targets[index];
      const wait = Math.max(0, args.delayMs - (Date.now() - lastStart));
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      try {
        const result = await fetchPage(target, args);
        results[index] = result;
        if ((index + 1) % 25 === 0 || index + 1 === targets.length) {
          console.log(`Fetched ${index + 1}/${targets.length}: ${target.sourceUrl}`);
        }
      } catch (error) {
        failures.push({ ...target, error: error.message });
        console.error(`FAILED ${target.sourceUrl}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, targets.length) }, worker));
  return { results: results.filter(Boolean), failures };
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeManifest(manifestPath, manifest) {
  const absolute = path.resolve(ROOT, manifestPath);
  ensureParent(absolute);
  fs.writeFileSync(absolute, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allRequested = [];
  for (let story = args.fromStory; story <= args.toStory; story += 1) {
    for (let part = args.fromPart; part <= args.toPart; part += 1) allRequested.push(targetFor(story, part));
  }
  const missing = targetInventory(args);
  const existing = allRequested.length - missing.length;
  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceOrigin: SOURCE_ORIGIN,
    range: { fromStory: args.fromStory, toStory: args.toStory, fromPart: args.fromPart, toPart: args.toPart },
    requested: allRequested.length,
    existingBeforeRun: existing,
    missingBeforeRun: missing.length,
    apply: args.apply,
    pages: [],
    failures: [],
  };

  console.log(`Requested pages: ${allRequested.length}`);
  console.log(`Already present: ${existing}`);
  console.log(`Missing pages: ${missing.length}`);
  if (!args.apply || missing.length === 0) {
    writeManifest(args.manifest, manifest);
    console.log(args.apply ? "Nothing to write." : "DRY-RUN: no pages fetched or changed.");
    return 0;
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "begin6-sentence-") );
  try {
    const fetched = await fetchTargets(missing, args);
    manifest.pages = fetched.results.map(({ source, ...page }) => page);
    manifest.failures = fetched.failures;
    if (fetched.failures.length > 0 || fetched.results.length !== missing.length) {
      throw new Error(`staging stopped: ${fetched.failures.length} page(s) failed validation`);
    }
    for (const page of fetched.results) {
      const stagedPath = path.join(staging, path.basename(page.targetPath));
      fs.writeFileSync(stagedPath, page.source);
    }
    for (const page of fetched.results) {
      if (fs.existsSync(page.targetPath)) throw new Error(`target appeared during staging: ${page.targetPath}`);
    }
    for (const page of fetched.results) {
      ensureParent(page.targetPath);
      fs.renameSync(path.join(staging, path.basename(page.targetPath)), page.targetPath);
    }
    manifest.written = fetched.results.length;
    writeManifest(args.manifest, manifest);
    console.log(`Wrote ${fetched.results.length} missing source pages.`);
    return 0;
  } catch (error) {
    manifest.error = error.message;
    writeManifest(args.manifest, manifest);
    console.error(error.message);
    return 1;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
