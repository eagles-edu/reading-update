#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const cheerio = require("cheerio");

const ROOT = path.resolve(__dirname, "..");
const INDEX_URLS = [
  "https://www.eslfast.com/begin6/",
  "https://www.eslfast.com/begin6/index2.htm",
  "https://www.eslfast.com/begin6/index3.htm",
  "https://www.eslfast.com/begin6/index4.htm",
];
const INDEX_SNAPSHOTS = [
  "docs/404/view-source_https___www.eslfast.com_begin6_.html",
  "docs/404/view-source_https___www.eslfast.com_begin6_index2.htm",
  "docs/404/view-source_https___www.eslfast.com_begin6_index3.htm",
  "docs/404/view-source_https___www.eslfast.com_begin6_index4.htm",
];
const USER_AGENT = "efast-copy-begin6-recovery/1.0 (+https://www.eslfast.com/)";

const config = parseArgs(process.argv.slice(2));
const logs = [];
let lastRequestAt = 0;

function parseArgs(args) {
  const result = {
    apply: false,
    textFrom: 59,
    textTo: 100,
    audioFrom: 1,
    audioTo: 100,
    minDelayMs: 1200,
    maxDelayMs: 3200,
    retryBaseMs: 2500,
    maxAttempts: 4,
    timeoutMs: 45000,
    logPath: "docs/404/begin6-scrape.log",
    manifestPath: "docs/404/begin6-scrape-manifest.json",
    treePath: "docs/404/begin6-link-tree.md",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
    if (!match) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const [, name, value] = match;
    const numericNames = new Set([
      "--text-from",
      "--text-to",
      "--audio-from",
      "--audio-to",
      "--min-delay-ms",
      "--max-delay-ms",
      "--retry-base-ms",
      "--max-attempts",
      "--timeout-ms",
    ]);
    if (numericNames.has(name)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
      }
      result[toCamel(name)] = parsed;
      continue;
    }
    const pathNames = new Map([
      ["--log", "logPath"],
      ["--manifest", "manifestPath"],
      ["--tree", "treePath"],
    ]);
    if (pathNames.has(name) && value.length > 0) {
      result[pathNames.get(name)] = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (result.minDelayMs > result.maxDelayMs) {
    throw new Error("--min-delay-ms cannot exceed --max-delay-ms");
  }
  if (result.textFrom > result.textTo || result.audioFrom > result.audioTo) {
    throw new Error("range start cannot exceed range end");
  }
  return result;
}

function toCamel(option) {
  return option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function printHelp() {
  console.log(`Usage: node scripts/scrape-begin6.cjs [options]

Dry-run is the default. Writes require --apply.

Options:
  --apply                  Write missing story HTML, audio, manifest, tree, and log
  --text-from=N            First story number to backfill as HTML (default: 59)
  --text-to=N              Last story number to backfill as HTML (default: 100)
  --audio-from=N           First story number whose audio is required (default: 1)
  --audio-to=N             Last story number whose audio is required (default: 100)
  --min-delay-ms=N         Minimum randomized delay between requests (default: 1200)
  --max-delay-ms=N         Maximum randomized delay between requests (default: 3200)
  --retry-base-ms=N        First retry backoff delay (default: 2500)
  --max-attempts=N         Maximum attempts per URL (default: 4)
  --timeout-ms=N           Per-request timeout (default: 45000)
  --log=PATH               Request log path
  --manifest=PATH          Scrape manifest path
  --tree=PATH              Link-tree report path
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
  if (minimum === maximum) return minimum;
  return minimum + crypto.randomInt(maximum - minimum + 1);
}

async function waitBeforeRequest(url) {
  const randomDelay = randomInteger(config.minDelayMs, config.maxDelayMs);
  const elapsed = Date.now() - lastRequestAt;
  const waitFor = Math.max(0, randomDelay - elapsed);
  if (waitFor > 0) {
    log("delay", { url, waitMs: waitFor });
    await sleep(waitFor);
  }
  lastRequestAt = Date.now();
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,audio/mpeg,*/*;q=0.5",
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body,
          });
        });
      },
    );
    request.setTimeout(config.timeoutMs, () => {
      request.destroy(new Error(`timeout after ${config.timeoutMs}ms`));
    });
    request.on("error", reject);
  });
}

async function requestWithRetry(url, kind) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    await waitBeforeRequest(url);
    log("request", { kind, url, attempt });
    try {
      const response = await requestOnce(url);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        log("response", {
          kind,
          url,
          attempt,
          status: response.statusCode,
          bytes: response.body.length,
        });
        return { ...response, attempts: attempt };
      }
      lastError = new Error(`HTTP ${response.statusCode}`);
      log("retryable-response", { kind, url, attempt, status: response.statusCode });
    } catch (error) {
      lastError = error;
      log("retryable-error", { kind, url, attempt, message: error.message });
    }
    if (attempt < config.maxAttempts) {
      const backoff = config.retryBaseMs * 2 ** (attempt - 1) + randomInteger(0, config.retryBaseMs);
      log("backoff", { kind, url, attempt, waitMs: backoff });
      await sleep(backoff);
    }
  }
  throw new Error(`${kind} failed after ${config.maxAttempts} attempts: ${url}: ${lastError?.message || "unknown error"}`);
}

function extractBegin6StoryUrls(html, pageUrl) {
  const $ = cheerio.load(html);
  const stories = new Map();
  $("a[href]").each((_, anchor) => {
    const href = $(anchor).attr("href");
    if (!href) return;
    let absolute;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      return;
    }
    const match = /^\/begin6\/b6\/b6(\d{3})\.htm$/i.exec(absolute.pathname);
    if (!match) return;
    const number = Number(match[1]);
    stories.set(number, `https://www.eslfast.com${absolute.pathname}`);
  });
  return stories;
}

function extractSnapshotStoryUrls() {
  const stories = new Map();
  INDEX_SNAPSHOTS.forEach((relativePath) => {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) return;
    const html = fs.readFileSync(filePath, "utf8");
    const matches = html.matchAll(/https:\/\/www\.eslfast\.com\/begin6\/b6\/b6(\d{3})\.htm/g);
    for (const match of matches) {
      stories.set(Number(match[1]), match[0]);
    }
  });
  return stories;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractParagraphText($, paragraph) {
  const spans = $(paragraph).find("span").toArray();
  if (spans.length > 0) {
    return normalizeText(spans.map((span) => $(span).text()).join(" "));
  }
  return normalizeText($(paragraph).text());
}

function parseStoryPage(html, storyUrl, number) {
  const $ = cheerio.load(html);
  const title = normalizeText($("h1").first().text());
  const audioSource = $("audio source[src]").first().attr("src") || $("audio[src]").first().attr("src");
  if (!title) throw new Error(`story ${number}: missing h1`);
  if (!audioSource) throw new Error(`story ${number}: missing audio source`);
  const audioUrl = new URL(audioSource, storyUrl).href;
  const audioPath = new URL(audioUrl).pathname;
  if (!/^\/begin6\/audio\/[^/]+\.mp3$/i.test(audioPath)) {
    throw new Error(`story ${number}: audio source escaped begin6/audio: ${audioUrl}`);
  }

  let paragraphs = $(".contain p").toArray().map((paragraph) => extractParagraphText($, paragraph)).filter(Boolean);
  if (paragraphs.length === 0) {
    paragraphs = $("p.timed.vocab").toArray().map((paragraph) => extractParagraphText($, paragraph)).filter(Boolean);
  }
  if (paragraphs.length === 0) throw new Error(`story ${number}: no story paragraphs`);

  const localLinks = [];
  $("a[href], img[src], audio[src], audio source[src], link[href], script[src]").each((_, element) => {
    const attribute = $(element).is("img, audio, audio source, script") ? "src" : "href";
    const value = $(element).attr(attribute);
    if (!value) return;
    let absolute;
    try {
      absolute = new URL(value, storyUrl);
    } catch {
      return;
    }
    if (absolute.origin === "https://www.eslfast.com" && absolute.pathname.startsWith("/begin6/")) {
      localLinks.push({ path: absolute.pathname, kind: attribute === "href" ? "href" : "src" });
    }
  });

  return {
    number,
    storyUrl,
    title,
    paragraphs,
    audioUrl,
    audioPath,
    localLinks,
    htmlSha256: sha256(Buffer.from(html, "utf8")),
  };
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isNotFoundPage(filePath) {
  if (!fs.existsSync(filePath)) return true;
  const html = fs.readFileSync(filePath, "utf8");
  return /<title>\s*404 Not Found\s*<\/title>/i.test(html) || /requested URL was not found/i.test(html);
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

function renderStoryPage(story) {
  const previous = story.number > 1 ? `b6${String(story.number - 1).padStart(3, "0")}.html` : null;
  const next = story.number < 100 ? `b6${String(story.number + 1).padStart(3, "0")}.html` : null;
  const paragraphs = story.paragraphs.map((paragraph) => `\n<p class="textres12">${htmlEscape(paragraph)}</p>`).join("\n");
  const previousLink = previous
    ? `<a href="${previous}"><img src="../../images/blue-arrow-304924_50-left.png" width="50" height="50" alt="Previous"></a>`
    : "";
  const nextLink = next
    ? `<a href="${next}"><img src="../../images/blue-arrow-304924_50-right.png" width="50" height="50" alt="Next"></a>`
    : "";
  const separators = [previousLink, `<a href="../index.html">MENU</a>`, nextLink].filter(Boolean).join("\n&nbsp;&nbsp;&nbsp;\n");
  return `<!DOCTYPE html>

<html lang="en">

<!-- Recovered from ${story.storyUrl} and normalized to the local story/theme shell. -->
<head>
<meta charset="utf-8">
<link rel="preload" href="../../style/font-stack.css" as="style" integrity="sha384-vUruqAnVDOvPl9cKsjkKIwbhwldrr4SyS1jTJvuhaqKeTlMF/MRcJ39//nKy7MhS">
<script src="../../js/story-theme.js" integrity="sha384-8VAqiIrvm0upO+8Nkxle4qQ0pcWFb1/TxOLqexMoqaS4uuFA1o4tOvOc72iWfgbJ"></script>
<link rel="stylesheet" href="../../style/font-stack.css" integrity="sha384-vUruqAnVDOvPl9cKsjkKIwbhwldrr4SyS1jTJvuhaqKeTlMF/MRcJ39//nKy7MhS">
<link rel="stylesheet" href="../../style/style.css" integrity="sha384-UFQv8JyLUMsYw1kuUeUpd0UUFynqCPe56/e/+/bgT6DMRKieBLJr9WOswNcbJ7iZ">
<link rel="icon" href="/reading/favicon.ico">
<meta name="keywords" content="English for children, Easy Reading, ESL/EFL reading for beginners, EFL, English as a Second Language, short stories, listening, dictation">
<meta name="classification" content="education, language, English as a Second Language (ESL), ESL">
<title>${htmlEscape(story.title)}</title>
</head>

<body class="story-page"><div class="wrapfit story-column">

<h1>${htmlEscape(story.title)}</h1><br>

<div class="cenmar">
<audio id="audio" src="../audio/${path.basename(story.audioPath)}" controls></audio>
</div>

<br>
${paragraphs}

<div class="cenmar textres20 fw500 tm01-5em">
    <hr>

${separators}

</div></div></body>

<!-- Recovered from ${story.storyUrl} and normalized to the local story/theme shell. -->
</html>
`;
}

function localPathForLivePath(livePath) {
  if (livePath === "/begin6/" || livePath === "/begin6/index.htm") return path.join(ROOT, "begin6", "index.html");
  let relative = livePath.replace(/^\/begin6\//, "");
  if (/\.htm$/i.test(relative)) relative = relative.replace(/\.htm$/i, ".html");
  return path.join(ROOT, "begin6", relative);
}

function collectLink(tree, item, sourceUrl) {
  const current = tree.get(item.path) || { path: item.path, kinds: new Set(), sources: new Set() };
  current.kinds.add(item.kind);
  current.sources.add(sourceUrl);
  tree.set(item.path, current);
}

function addLinksFromHtml(tree, html, sourceUrl) {
  const $ = cheerio.load(html);
  $("a[href], img[src], audio[src], audio source[src], link[href], script[src]").each((_, element) => {
    const isSrc = $(element).is("img, audio, audio source, script");
    const attribute = isSrc ? "src" : "href";
    const value = $(element).attr(attribute);
    if (!value) return;
    let absolute;
    try {
      absolute = new URL(value, sourceUrl);
    } catch {
      return;
    }
    if (absolute.origin !== "https://www.eslfast.com" || !absolute.pathname.startsWith("/begin6/")) return;
    collectLink(tree, { path: absolute.pathname, kind: isSrc ? "src" : "href" }, sourceUrl);
  });
}

function localStatus(livePath) {
  const local = localPathForLivePath(livePath);
  return {
    local,
    status: fs.existsSync(local) && fs.statSync(local).size > 0 ? "present" : "missing",
  };
}

function treeLines(paths) {
  const root = { children: new Map(), entries: [] };
  for (const entry of paths) {
    const segments = entry.path.replace(/^\//, "").split("/");
    let node = root;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        node.entries.push({ segment, entry });
        return;
      }
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), entries: [] });
      node = node.children.get(segment);
    });
  }
  const lines = ["- `/`"];
  function render(node, prefix) {
    const childNames = [...node.children.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const name of childNames) {
      lines.push(`${prefix}- \`${name}/\``);
      render(node.children.get(name), `${prefix}  `);
    }
    const entries = [...node.entries].sort((a, b) => a.segment.localeCompare(b.segment, undefined, { numeric: true }));
    for (const { segment, entry } of entries) {
      const marker = entry.status === "present" ? "present" : "MISSING";
      lines.push(`${prefix}- \`${segment}\` — ${marker}; ${[...entry.kinds].sort().join(", ")}; local: \`${path.relative(ROOT, entry.local)}\``);
    }
  }
  render(root, "  ");
  return lines;
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
  log("start", { apply: config.apply, textRange: [config.textFrom, config.textTo], audioRange: [config.audioFrom, config.audioTo] });
  const liveIndexHtml = [];
  const stories = new Map();
  const liveStoryNumbers = new Set();
  for (let index = 0; index < INDEX_URLS.length; index += 1) {
    const url = INDEX_URLS[index];
    try {
      const response = await requestWithRetry(url, "index");
      const html = response.body.toString("utf8");
      liveIndexHtml.push({ url, html });
      for (const [number, storyUrl] of extractBegin6StoryUrls(html, url)) {
        liveStoryNumbers.add(number);
        stories.set(number, storyUrl);
      }
    } catch (error) {
      log("index-failed", { url, message: error.message });
    }
  }

  const snapshotStories = extractSnapshotStoryUrls();
  for (const [number, storyUrl] of snapshotStories) {
    if (!stories.has(number)) stories.set(number, storyUrl);
  }
  const expectedNumbers = Array.from({ length: 100 }, (_, index) => index + 1);
  const missingNumbers = expectedNumbers.filter((number) => !stories.has(number));
  if (missingNumbers.length > 0) {
    throw new Error(`story index did not yield all 100 links; missing: ${missingNumbers.join(", ")}`);
  }
  log("index-complete", { liveIndexPages: liveIndexHtml.length, storyLinks: stories.size, snapshotFallbackCount: expectedNumbers.filter((number) => !liveStoryNumbers.has(number)).length });

  const tree = new Map();
  const storyRecords = [];
  for (const page of liveIndexHtml) addLinksFromHtml(tree, page.html, page.url);
  for (const number of expectedNumbers) {
    const storyUrl = stories.get(number);
    let response;
    try {
      response = await requestWithRetry(storyUrl, "story");
    } catch (error) {
      log("story-failed", { number, url: storyUrl, message: error.message });
      throw error;
    }
    const html = response.body.toString("utf8");
    addLinksFromHtml(tree, html, storyUrl);
    const story = parseStoryPage(html, storyUrl, number);
    const audioFile = path.join(ROOT, story.audioPath.replace(/^\//, ""));
    const storyFile = path.join(ROOT, "begin6", "b6", `b6${String(number).padStart(3, "0")}.html`);
    const storyNeedsWrite = number >= config.textFrom && number <= config.textTo && isNotFoundPage(storyFile);
    const audioPresent = fs.existsSync(audioFile) && fs.statSync(audioFile).size > 0;
    const record = {
      number,
      storyUrl,
      title: story.title,
      paragraphs: story.paragraphs.length,
      audioUrl: story.audioUrl,
      audioPath: story.audioPath,
      storyHtmlSha256: story.htmlSha256,
      localStoryPath: path.relative(ROOT, storyFile),
      storyAction: storyNeedsWrite ? (config.apply ? "written" : "planned-write") : "preserved-existing",
      localAudioPath: path.relative(ROOT, audioFile),
      audioAction: audioPresent ? "preserved-existing" : (config.apply ? "pending-download" : "planned-download"),
      storyAttempts: response.attempts,
    };

    if (storyNeedsWrite && config.apply) {
      writeAtomic(storyFile, renderStoryPage(story));
      log("story-written", { number, path: path.relative(ROOT, storyFile), paragraphs: story.paragraphs.length });
      record.storyAction = "written";
    }

    if (number >= config.audioFrom && number <= config.audioTo && !audioPresent) {
      if (config.apply) {
        const audioResponse = await requestWithRetry(story.audioUrl, "audio");
        if (audioResponse.body.length < 64) throw new Error(`audio ${number}: response is unexpectedly small`);
        writeAtomic(audioFile, audioResponse.body);
        record.audioAction = "downloaded";
        record.audioAttempts = audioResponse.attempts;
        record.audioSha256 = sha256(audioResponse.body);
        record.audioBytes = audioResponse.body.length;
        log("audio-written", { number, path: path.relative(ROOT, audioFile), bytes: audioResponse.body.length });
      }
    }
    if (number % 10 === 0 || number === 1 || number === 100) log("story-progress", { number, completed: number, total: 100 });
    if (!config.apply && number >= config.audioFrom && number <= config.audioTo && !audioPresent) record.audioAction = "planned-download";
    storyRecords.push(record);
  }

  const manifestStories = expectedNumbers.map((number) => stories.get(number));
  const discovered = [...tree.values()].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  const withStatus = discovered.map((entry) => ({
    path: entry.path,
    kinds: [...entry.kinds].sort(),
    sources: [...entry.sources].sort(),
    ...localStatus(entry.path),
  }));
  const localMissing = withStatus.filter((entry) => entry.status === "missing");
  const treeMarkdown = [
    "# Begin6 live HTML link tree",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "The tree is derived from the four live index pages and all 100 live story HTML pages. `href` and resource `src` paths under `/begin6/` are included. `.htm` live paths are mapped to the repository's `.html` convention for the local-status check.",
    "",
    `- Story pages discovered: ${stories.size}`,
    `- Local paths discovered: ${withStatus.length}`,
    `- Local paths present: ${withStatus.length - localMissing.length}`,
    `- Local paths missing: ${localMissing.length}`,
    "",
    "## Tree",
    "",
    ...treeLines(withStatus),
    "",
    "## Missing local paths",
    "",
    ...(localMissing.length > 0 ? localMissing.map((entry) => `- \`${entry.path}\` → \`${path.relative(ROOT, entry.local)}\``) : ["- None"]),
    "",
  ].join("\n");

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "https://www.eslfast.com/begin6/",
    indexUrls: INDEX_URLS,
    storyCount: stories.size,
    storyUrls: manifestStories,
    storyRecords,
    discoveredLinks: withStatus,
    requestLog: logs,
    config,
  };
  if (config.apply) {
    writeAtomic(path.join(ROOT, config.logPath), `${logs.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    writeAtomic(path.join(ROOT, config.manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    writeAtomic(path.join(ROOT, config.treePath), treeMarkdown);
    log("reports-written", { log: config.logPath, manifest: config.manifestPath, tree: config.treePath });
  } else {
    log("dry-run", { wouldWrite: [config.logPath, config.manifestPath, config.treePath] });
  }

  const summary = {
    stories: stories.size,
    localPaths: withStatus.length,
    missingLocalPaths: localMissing.length,
    plannedOrWrittenStoryPages: storyRecords.filter((record) => record.storyAction === "written" || record.storyAction === "planned-write").length,
    missingAudioAfterRun: expectedNumbers.filter((number) => {
      if (number < config.audioFrom || number > config.audioTo) return false;
      const record = storyRecords.find((candidate) => candidate.number === number);
      return !record || record.audioAction === "pending-download" || record.audioAction === "planned-download";
    }).length,
  };
  log("complete", summary);
  if (config.apply) {
    writeAtomic(path.join(ROOT, config.logPath), `${logs.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  }
}

main().catch((error) => {
  log("fatal", { message: error.message });
  process.exitCode = 1;
});
