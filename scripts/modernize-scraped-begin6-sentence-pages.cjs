#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SENTENCE_DIR = path.join(ROOT, "begin6", "sent");
const TEMPLATE_PATH = path.join(SENTENCE_DIR, "b6mx0691.html");

function parseArgs(argv) {
  const args = { apply: false };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/modernize-scraped-begin6-sentence-pages.cjs [--apply]");
      console.log("Dry-run is the default. --apply replaces only unmodernized Begin 6 sentence pages.");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function sourcePages() {
  return fs.readdirSync(SENTENCE_DIR)
    .filter((name) => /^b6mx\d{4}\.html$/i.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(SENTENCE_DIR, name), "utf8");
      return !/HOT POTATOES MODERNIZATION VERSION:/i.test(source);
    })
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function parsePageName(name) {
  const match = /^b6mx(\d{3})(\d)\.html$/i.exec(name);
  if (!match) throw new Error(`Unexpected Begin 6 sentence filename: ${name}`);
  return { story: Number(match[1]), part: Number(match[2]) };
}

function decodeText(value) {
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

function parseQuestion(source, file) {
  const titleMatch = source.match(/<meta\s+name=(['"])DC:Title\1\s+content=(['"])([\s\S]*?)\2/i);
  const punctuationMatch = source.match(/var\s+Punctuation\s*=\s*'([^']*)';/);
  const openersMatch = source.match(/var\s+Openers\s*=\s*'([^']*)';/);
  const answerMatch = source.match(/Answers\[0\]\s*=\s*new Array\(([^)]+)\)/);
  const segments = Array.from(source.matchAll(/Segments\[(\d+)\]\[0\]\s*=\s*'([^']*)';\s*Segments\[\1\]\[1\]\s*=\s*(\d+);/g), (match) => ({
    index: Number(match[1]),
    text: match[2],
    id: Number(match[3]),
  }));
  if (!titleMatch || !punctuationMatch || !openersMatch || !answerMatch || segments.length === 0) {
    throw new Error(`${file}: missing title, punctuation, answer, or segment data`);
  }
  return {
    title: decodeText(titleMatch[3]),
    punctuation: punctuationMatch[1],
    openers: openersMatch[1],
    answer: answerMatch[1],
    segments,
  };
}

function segmentBlock(segments) {
  return "var Segments = new Array();\n" + segments.map((segment) => [
    `Segments[${segment.index}] = new Array();`,
    `Segments[${segment.index}][0] = '${segment.text}';`,
    `Segments[${segment.index}][1] = ${segment.id};`,
    `Segments[${segment.index}][2] = 0;`,
  ].join("\n")).join("\n") + "\n\nvar GuessSequence = new Array();";
}

function navigationButton(story, page, direction) {
  const targetPage = direction === "previous" ? page - 1 : page + 1;
  const target = `b6mx${String(story).padStart(3, "0")}${targetPage}.html`;
  if (direction === "previous") {
    return `<button class="NavButton hp-button btn-17" type="button" onclick="location='${target}'; return false;" aria-label="Previous" data-hp-tooltip="Open the previous exercise. This is ${page} of 8." aria-description="Open the previous exercise. This is ${page} of 8.">Previous</button>`;
  }
  return `<button class="NavButton hp-button btn-17" type="button" onclick="location='${target}'; return false;">Next (${page} of 8)</button>`;
}

function navigationMarkup(story, page) {
  const buttons = [];
  if (page > 1) buttons.push(navigationButton(story, page, "previous"));
  if (page < 8) buttons.push(navigationButton(story, page, "next"));
  return buttons.join("\n");
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`template is missing ${label}`);
  return source.replace(pattern, replacement);
}

function replaceNavigation(source, id, markup) {
  return replaceRequired(
    source,
    new RegExp(`(<div class="NavButtonBar" id="${id}">)[\\s\\S]*?(</div>)`),
    `$1\n${markup}\n\n$2`,
    `${id} navigation`,
  );
}

function convert(source, question, page) {
  let result = source;
  result = result.replace(/69\. Moving into the Dorm \(1\)/g, htmlEscape(question.title));
  result = result.replace(/b6069\.html/g, `b6${String(page.story).padStart(3, "0")}.html`);
  result = result.replace(/story=begin6\/b6\/b6069\.html/g, `story=begin6/b6/b6${String(page.story).padStart(3, "0")}.html`);
  result = replaceRequired(result, /var Punctuation = '[^']*';/, `var Punctuation = '${question.punctuation}';`, "punctuation");
  result = replaceRequired(result, /var Openers = '[^']*';/, `var Openers = '${question.openers}';`, "openers");
  result = replaceRequired(result, /var Segments = new Array\(\);[\s\S]*?var GuessSequence = new Array\(\);/, segmentBlock(question.segments), "segments");
  result = replaceRequired(result, /var Answers = new Array\(\);\s*Answers\[0\] = new Array\([^)]*\);/, `var Answers = new Array();\nAnswers[0] = new Array(${question.answer});`, "answer sequence");
  result = replaceNavigation(result, "TopNavBar", navigationMarkup(page.story, page.part));
  result = replaceNavigation(result, "BottomNavBar", navigationMarkup(page.story, page.part));
  if (!result.includes(`<h1 class="ExerciseTitle">${htmlEscape(question.title)}</h1>`)) {
    throw new Error(`converted title missing for b6mx${String(page.story).padStart(3, "0")}${page.part}`);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const pages = sourcePages();
  const converted = [];
  const failures = [];
  for (const file of pages) {
    const absolute = path.join(SENTENCE_DIR, file);
    const source = fs.readFileSync(absolute, "utf8");
    try {
      const page = parsePageName(file);
      const question = parseQuestion(source, file);
      const result = convert(template, question, page);
      converted.push({ file, absolute, source, result });
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
    }
  }
  console.log(`Unmodernized source pages: ${pages.length}`);
  console.log(`Converted successfully: ${converted.length}`);
  console.log(`Conversion failures: ${failures.length}`);
  for (const failure of failures.slice(0, 20)) console.error(failure);
  if (failures.length > 0) return 2;
  if (!args.apply) {
    console.log("DRY-RUN: no files changed.");
    return 0;
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "begin6-sentence-modern-") );
  try {
    for (const page of converted) {
      fs.writeFileSync(path.join(staging, page.file), page.result);
    }
    for (const page of converted) {
      fs.renameSync(path.join(staging, page.file), page.absolute);
    }
    const manifest = converted.map((page) => ({
      file: path.relative(ROOT, page.absolute),
      sourceSha256: sha256(page.source),
      modernSha256: sha256(page.result),
    }));
    fs.writeFileSync(path.join(ROOT, "docs/404/begin6-sentence-modernization-manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), pages: manifest }, null, 2)}\n`);
    console.log(`Modernized ${converted.length} Begin 6 sentence pages.`);
    return 0;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

process.exitCode = main();
