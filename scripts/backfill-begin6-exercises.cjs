#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { spawnSync } = require("node:child_process");
const cheerio = require("cheerio");

const ROOT = path.resolve(__dirname, "..");
const SITEMAP_URL = "https://www.eslfast.com/sitemap.xml";
const USER_AGENT = "efast-copy-begin6-exercise-recovery/1.0 (+https://www.eslfast.com/)";
const FAMILIES = new Set(["w6", "cloze", "sent", "dict"]);
const DEFAULTS = Object.freeze({
  apply: false,
  minDelayMs: 1200,
  maxDelayMs: 3200,
  retryBaseMs: 2500,
  maxAttempts: 4,
  timeoutMs: 45000,
  logPath: "docs/404/begin6-exercises-scrape.log",
  manifestPath: "docs/404/begin6-exercises-manifest.json",
});

const config = parseArgs(process.argv.slice(2));
const logs = [];
let lastRequestAt = 0;

function parseArgs(argv) {
  const args = { ...DEFAULTS };
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
    const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    const [, name, value] = match;
    const numeric = new Set(["--min-delay-ms", "--max-delay-ms", "--retry-base-ms", "--max-attempts", "--timeout-ms"]);
    if (numeric.has(name)) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
      args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = number;
      continue;
    }
    const paths = new Map([
      ["--log", "logPath"],
      ["--manifest", "manifestPath"],
    ]);
    if (paths.has(name) && value) {
      args[paths.get(name)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.minDelayMs > args.maxDelayMs) throw new Error("minimum delay exceeds maximum delay");
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-begin6-exercises.cjs [options]

Dry-run is the default. Writes require --apply.

  --apply                  Write missing exercises and dictation audio
  --min-delay-ms=N         Minimum randomized request delay (default: 1200)
  --max-delay-ms=N         Maximum randomized request delay (default: 3200)
  --retry-base-ms=N        Exponential retry base delay (default: 2500)
  --max-attempts=N         Maximum attempts per URL (default: 4)
  --timeout-ms=N           Per-request timeout (default: 45000)
  --log=PATH               Request log path
  --manifest=PATH          Manifest path
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
        Accept: "text/html,application/xhtml+xml,audio/mpeg,application/xml,*/*;q=0.5",
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

function localTarget(livePath) {
  const relative = livePath.replace(/^\/begin6\//, "").replace(/\.htm$/i, ".html");
  return path.join(ROOT, "begin6", relative);
}

function isUsableFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) return false;
  const source = fs.readFileSync(filePath, "utf8");
  return !/<title>\s*404 Not Found\s*<\/title>/i.test(source) && !/requested URL was not found/i.test(source);
}

function isUsableVocabularyFile(filePath) {
  if (!isUsableFile(filePath)) return false;
  const $ = cheerio.load(fs.readFileSync(filePath, "utf8"));
  return Boolean($("h1").first().text().trim()) && $("a[href^='http']").toArray().every((anchor) => $(anchor).text().trim());
}

function extractExerciseUrls(sitemapHtml) {
  const urls = new Map();
  for (const match of sitemapHtml.matchAll(/<loc>\s*(https:\/\/www\.eslfast\.com\/begin6\/(w6|cloze|sent|dict)\/[^<]+?\.htm)\s*<\/loc>/gi)) {
    const liveUrl = match[1];
    const livePath = new URL(liveUrl).pathname;
    urls.set(livePath, { liveUrl, family: match[2].toLowerCase(), livePath });
  }
  return [...urls.values()].sort((a, b) => a.livePath.localeCompare(b.livePath, undefined, { numeric: true }));
}

function exerciseKey(livePath) {
  const normalized = livePath.toLowerCase();
  const family = normalized.split("/")[2];
  const file = path.basename(normalized);
  const patterns = {
    w6: /^b6w0*(\d+)\.htm$/,
    cloze: /^b6cloze0*(\d+)\.htm$/,
    sent: /^b6mx0*(\d+)1\.htm$/,
    dict: /^b6d0*(\d+)\.htm$/,
  };
  const match = patterns[family]?.exec(file);
  return match ? `${family}:${Number(match[1])}` : null;
}

function extractManifestExerciseUrls() {
  const manifestPath = path.join(ROOT, "docs/404/begin6-scrape-manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return (manifest.discoveredLinks || [])
    .map((entry) => entry.path)
    .filter((livePath) => /^\/begin6\/(w6|cloze|sent|dict)\/[^/]+\.htm$/i.test(livePath))
    .map((livePath) => {
      const family = livePath.split("/")[2].toLowerCase();
      return {
        liveUrl: `https://www.eslfast.com${livePath}`,
        family,
        livePath,
        source: "story-linked-manifest",
      };
    });
}

function mergeExerciseUrls(sitemapExercises, manifestExercises) {
  const merged = new Map();
  for (const exercise of sitemapExercises) {
    const key = exerciseKey(exercise.livePath);
    if (key) merged.set(key, { ...exercise, source: "sitemap" });
  }
  for (const exercise of manifestExercises) {
    const key = exerciseKey(exercise.livePath);
    if (key && !merged.has(key)) merged.set(key, exercise);
  }
  return [...merged.values()].sort((a, b) => a.livePath.localeCompare(b.livePath, undefined, { numeric: true }));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function renderVocabulary(source, liveUrl) {
  const $ = cheerio.load(source);
  const storyNumber = Number(new URL(liveUrl).pathname.match(/b6w0*(\d+)\.htm$/i)?.[1] || 0);
  const storyFile = storyNumber > 0 ? path.join(ROOT, "begin6", "b6", `b6${String(storyNumber).padStart(3, "0")}.html`) : null;
  const storyTitle = storyFile && fs.existsSync(storyFile) ? cheerio.load(fs.readFileSync(storyFile, "utf8"))("title").first().text() : "";
  const title = [$("h2").first().text(), $("title").first().text(), storyTitle]
    .map((value) => value.replace(/\s+/g, " ").trim().replace(/^Vocabulary:\s*/i, "").trim())
    .find(Boolean) || "";
  const words = $("a[href]").toArray()
    .map((anchor) => {
      const href = $(anchor).attr("href") || "";
      const linkedWord = $(anchor).find(".contan").text().trim() || $(anchor).text().trim();
      const slug = href.match(/\/dictionary\/(?:[^/]+\/)*([^/?#]+)$/i)?.[1] || "";
      const fallbackWord = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
      return { href, word: linkedWord || fallbackWord };
    })
    .filter((entry) => entry.word && /^https?:\/\//i.test(entry.href) && !/google\.com/i.test(entry.href));
  if (!title || words.length === 0) throw new Error(`vocabulary page has no title/words: ${liveUrl}`);
  const links = words.map((entry) => `<a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.word)}</a><br>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<!-- Recovered from ${liveUrl} and normalized to the local vocabulary shell. -->
<head>
<meta charset="utf-8">
<link rel="preload" href="../../style/font-stack.css" as="style" integrity="sha384-vUruqAnVDOvPl9cKsjkKIwbhwldrr4SyS1jTJvuhaqKeTlMF/MRcJ39//nKy7MhS">
<link rel="stylesheet" href="../../style/font-stack.css" integrity="sha384-vUruqAnVDOvPl9cKsjkKIwbhwldrr4SyS1jTJvuhaqKeTlMF/MRcJ39//nKy7MhS">
<link rel="stylesheet" href="../../style/style.css" integrity="sha384-UFQv8JyLUMsYw1kuUeUpd0UUFynqCPe56/e/+/bgT6DMRKieBLJr9WOswNcbJ7iZ">
<link rel="icon" href="/reading/favicon.ico">
<title>Vocabulary: ${escapeHtml(title)}</title>
</head>
<body><div class="wrapfit">
<h1>${escapeHtml(title)}</h1><br>
<table><tr><td class="w23 top"></td><td class="w160 top textres12"><blockquote>
${links}
</blockquote><hr><div class="cenmar"><a href="#" onclick="history.back(); return false;"><b>Back</b></a></div>
</td></tr></table>
<br><br></div></body>
<!-- Recovered from ${liveUrl} and normalized to the local vocabulary shell. -->
</html>
`;
}

function normalizeHotPotatoesSource(source) {
  return source
    .replace(/((?:href|location)\s*=\s*['"][^'"]*?)\.htm(['"])/gi, "$1.html$2")
    .replace(/((?:href|location)\s*=\s*['"][^'"]*?)\.html?(['"])/gi, "$1.html$2")
    .replace(/[\t ]+$/gm, "");
}

function validateSource(source, family, liveUrl) {
  if (!/<html\b/i.test(source) || !/<body\b/i.test(source)) throw new Error(`${family} page has no HTML body: ${liveUrl}`);
  if (!/<title\b/i.test(source)) throw new Error(`${family} page has no title: ${liveUrl}`);
  if (family !== "w6" && !/id\s*=\s*["']TheBody["']/i.test(source)) throw new Error(`${family} page has no body#TheBody: ${liveUrl}`);
}

function collectDictAudio(localFiles) {
  const audio = new Map();
  for (const filePath of localFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const $ = cheerio.load(source);
    $("audio source[src], audio[src]").each((_, element) => {
      const value = $(element).attr("src");
      if (!value) return;
      let absolute;
      try {
        absolute = new URL(value, "https://www.eslfast.com/begin6/dict/");
      } catch {
        return;
      }
      if (absolute.origin === "https://www.eslfast.com" && /^\/begin6\/audio\/d\/[^/]+\.mp3$/i.test(absolute.pathname)) {
        audio.set(absolute.pathname, absolute.href);
      }
    });
  }
  return [...audio.values()].sort();
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

async function main() {
  log("start", { apply: config.apply, sitemap: SITEMAP_URL });
  const sitemap = await fetchWithRetry(SITEMAP_URL, "sitemap");
  const sitemapExercises = extractExerciseUrls(sitemap.body.toString("utf8"));
  const manifestExercises = extractManifestExerciseUrls();
  const exercises = mergeExerciseUrls(sitemapExercises, manifestExercises);
  const counts = Object.fromEntries([...FAMILIES].map((family) => [family, exercises.filter((exercise) => exercise.family === family).length]));
  if (exercises.length !== 400 || Object.values(counts).some((count) => count !== 100)) {
    throw new Error(`expected 400 Begin6 exercise URLs, got ${JSON.stringify(counts)}`);
  }
  log("exercise-index-complete", {
    total: exercises.length,
    counts,
    sitemapTotal: sitemapExercises.length,
    storyLinkedTotal: manifestExercises.length,
    storyLinkedAdditions: exercises.filter((exercise) => exercise.source === "story-linked-manifest").length,
  });

  const records = [];
  for (const exercise of exercises) {
    const target = localTarget(exercise.livePath);
    const existing = exercise.family === "w6" ? isUsableVocabularyFile(target) : isUsableFile(target);
    const record = {
      family: exercise.family,
      liveUrl: exercise.liveUrl,
      livePath: exercise.livePath,
      localPath: path.relative(ROOT, target),
      action: existing ? "preserved-existing" : (config.apply ? "written" : "planned-write"),
    };
    if (!existing) {
      const response = await fetchWithRetry(exercise.liveUrl, "exercise");
      const raw = response.body.toString("utf8");
      validateSource(raw, exercise.family, exercise.liveUrl);
      const normalized = exercise.family === "w6" ? renderVocabulary(raw, exercise.liveUrl) : normalizeHotPotatoesSource(raw);
      record.sourceBytes = raw.length;
      record.sourceSha256 = sha256(response.body);
      record.outputBytes = Buffer.byteLength(normalized);
      record.attempts = response.attempts;
      if (config.apply) writeAtomic(target, normalized);
      log("exercise-written", { family: exercise.family, path: record.localPath, bytes: record.outputBytes });
    }
    records.push(record);
  }

  const dictFiles = fs.existsSync(path.join(ROOT, "begin6", "dict"))
    ? fs.readdirSync(path.join(ROOT, "begin6", "dict"))
      .filter((name) => name.endsWith(".html") && !name.endsWith(".BAK"))
      .map((name) => path.join(ROOT, "begin6", "dict", name))
    : [];
  const dictAudioUrls = collectDictAudio(dictFiles);
  const audioRecords = [];
  for (const audioUrl of dictAudioUrls) {
    const livePath = new URL(audioUrl).pathname;
    const target = path.join(ROOT, livePath.replace(/^\//, ""));
    const existing = fs.existsSync(target) && fs.statSync(target).size > 0;
    const record = { liveUrl: audioUrl, livePath, localPath: path.relative(ROOT, target), action: existing ? "preserved-existing" : (config.apply ? "downloaded" : "planned-download") };
    if (!existing && config.apply) {
      const response = await fetchWithRetry(audioUrl, "dict-audio");
      if (response.body.length < 64) throw new Error(`dict audio unexpectedly small: ${audioUrl}`);
      writeAtomic(target, response.body);
      record.bytes = response.body.length;
      record.sha256 = sha256(response.body);
      record.attempts = response.attempts;
      log("dict-audio-written", { path: record.localPath, bytes: response.body.length });
    }
    audioRecords.push(record);
  }

  let modernizer = null;
  if (config.apply) {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "modernize-hot-potatoes-pages.cjs"),
      "--apply",
      "--scope",
      "begin6",
      "--allow-bulk",
      "--report",
      path.join(ROOT, "docs/404/begin6-exercise-modernizer.json"),
    ], { cwd: ROOT, encoding: "utf8", stdio: "inherit" });
    modernizer = { status: result.status, signal: result.signal || null };
    if (result.status !== 0) throw new Error(`Hot Potatoes modernizer failed with status ${result.status}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: SITEMAP_URL,
    exerciseCounts: counts,
    exercises: records,
    dictAudioCount: audioRecords.length,
    dictAudio: audioRecords,
    modernizer,
    config,
    requestLog: logs,
  };
  if (config.apply) {
    writeAtomic(path.join(ROOT, config.manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    log("reports-written", { manifest: config.manifestPath, log: config.logPath });
  } else {
    log("dry-run", { wouldWrite: [config.manifestPath, config.logPath] });
  }
  log("complete", {
    exercises: exercises.length,
    missingBeforeRun: records.filter((record) => record.action !== "preserved-existing").length,
    dictAudio: audioRecords.length,
    dictAudioMissingBeforeRun: audioRecords.filter((record) => record.action !== "preserved-existing").length,
  });
  if (config.apply) writeAtomic(path.join(ROOT, config.logPath), `${logs.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

main().catch((error) => {
  log("fatal", { message: error.message });
  process.exitCode = 1;
});
