#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const parse5 = require("parse5");

const { createBackupManager } = require("./write-backup.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const FONT_STACK_PATH = path.join("style", "font-stack.css");
const SITE_STYLE_PATH = path.join("style", "style.css");
const EXERCISE_LAYOUT_PATH = path.join("css", "sis-exercise-layout.css");
const EXERCISE_UI_STYLE_PATH = path.join("css", "sis-cloze-submit.css");
const STORY_THEME_SCRIPT_PATH = path.join("js", "story-theme.js");
const EXERCISE_SUBMIT_SCRIPT_PATH = path.join("js", "sis-exercise-submit.js");
const XML_DECLARATION_RE = /^\uFEFF?[\t \r\n]*<\?xml\b[^?]*\?>[\t ]*(?:\r?\n)?/i;
const CHARSET_META_RE = /<meta\b(?=[^>]*\bcharset\s*=)[^>]*>/gi;
const CONTENT_TYPE_META_RE = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?content-type\b)[^>]*>/gi;
const VIEWPORT_META_RE = /<meta\b(?=[^>]*\bname\s*=\s*["']viewport["'])[^>]*>/gi;
const FAMILY_LABELS = Object.freeze({ dict: "dictation", sent: "sentence" });

function printUsage(family) {
  console.log(
    `Usage: node ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH]

Normalize responsive metadata and shared exercise layout for the B1-B6 ${FAMILY_LABELS[family]} pages.

Options:
  --dry-run   Report changes without writing files. This is the default.
  --apply     Back up and write the normalized pages.
  --root PATH Scan a different repository root.
  --help      Show this help.
`
  );
}

function parseArgs(argv) {
  const args = { apply: false, root: DEFAULT_ROOT, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.apply = false;
      continue;
    }
    if (arg === "--root") {
      index += 1;
      if (index >= argv.length) throw new Error("--root requires a path");
      args.root = path.resolve(argv[index]);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function integrityFor(file) {
  const contents = fs.readFileSync(file);
  return `sha384-${crypto.createHash("sha384").update(contents).digest("base64")}`;
}

function normalizePathSeparators(value) {
  return value.split(path.sep).join("/");
}

function relativeAssetHref(file, root, relativeAssetPath) {
  const asset = path.resolve(root, relativeAssetPath);
  return normalizePathSeparators(path.relative(path.dirname(file), asset));
}

function parseTagAttributes(tag) {
  const attributes = new Map();
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const tagNameEnd = tag.indexOf(" ");
  const searchFrom = tagNameEnd < 0 ? tag.indexOf(">") : tagNameEnd;
  const source = tag.slice(Math.max(0, searchFrom));

  for (const match of source.matchAll(attributePattern)) {
    const name = match[1].toLowerCase();
    if (name === "/" || name === ">") continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function hasLink(content, rel, hrefSuffix) {
  const wantedRel = rel.toLowerCase();
  return [...content.matchAll(/<link\b[^>]*>/gi)].some(([tag]) => {
    const attrs = parseTagAttributes(tag);
    const relTokens = (attrs.get("rel") || "").toLowerCase().split(/\s+/);
    const href = attrs.get("href") || "";
    return relTokens.includes(wantedRel) && href.endsWith(hrefSuffix);
  });
}

function hasScript(content, srcSuffix) {
  return [...content.matchAll(/<script\b[^>]*>/gi)].some(([tag]) => {
    const attrs = parseTagAttributes(tag);
    return (attrs.get("src") || "").endsWith(srcSuffix);
  });
}

function linkMarkup({ rel, href, integrity, as }) {
  const asAttribute = as ? ` as="${as}"` : "";
  return `<link rel="${rel}" href="${href}"${asAttribute} integrity="${integrity}">`;
}

function scriptMarkup({ src, integrity, attributes = "" }) {
  return `<script src="${src}" integrity="${integrity}"${attributes}></script>`;
}

function normalizeRevealedAnswerClass(source) {
  let changed = 0;
  const next = source.replace(
    /(A\.setAttribute\(\s*)(['"])class\2(\s*,\s*)(['"])Answer\4(\s*\))/g,
    (match, prefix, classQuote, separator, valueQuote, suffix) => {
      changed += 1;
      return `${prefix}${classQuote}class${classQuote}${separator}${valueQuote}Answer correct${valueQuote}${suffix}`;
    }
  );
  return { source: next, changed };
}

function normalizeKnownSentenceStylesheet(content, options) {
  const { family, file, root, siteStyleIntegrity } = options;
  const relativeFile = path.relative(root, file);
  const targetFile = path.join("begin6", "sent", "b6mx0011.html");
  if (family !== "sent" || relativeFile !== targetFile) return { content, changed: false };

  const correctedHref = relativeAssetHref(file, root, SITE_STYLE_PATH);
  let changed = false;
  const normalized = content.replace(/<link\b[^>]*>/gi, (tag) => {
    const attributes = parseTagAttributes(tag);
    if (attributes.get("href") !== "../style/style.css") return tag;
    changed = true;
    return linkMarkup({
      rel: "stylesheet",
      href: correctedHref,
      integrity: siteStyleIntegrity,
    });
  });
  return { content: normalized, changed };
}

function matchingStoryFilename(family, level, file) {
  const basename = path.basename(file);
  if (family === "dict" && level === 6 && basename === "1. The Hairstyle Change.html") {
    return "b6001.html";
  }
  const key = sequenceKey(family, level, basename);
  if (!key) return "";
  return `b${level}${String(key.story).padStart(3, "0")}.html`;
}

function normalizeExerciseHtml(source, options) {
  const {
    file,
    root,
    fontIntegrity,
    layoutIntegrity,
    uiStyleIntegrity,
    storyThemeIntegrity,
    submitScriptIntegrity,
    family,
    level,
  } = options;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const changes = [];
  let next = source.replace(XML_DECLARATION_RE, "");
  if (next !== source) changes.push("remove XML declaration");

  const headMatch = next.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!headMatch) throw new Error(`HTML head is missing in ${file}`);

  const head = headMatch[0];
  const openTag = head.match(/^<head\b[^>]*>/i)?.[0];
  const closeTag = head.match(/<\/head\s*>$/i)?.[0];
  if (!openTag || !closeTag) throw new Error(`Could not isolate the HTML head in ${file}`);

  let content = head.slice(openTag.length, head.length - closeTag.length);
  const styleReference = normalizeKnownSentenceStylesheet(content, options);
  content = styleReference.content;
  if (styleReference.changed) changes.push("repair broken shared stylesheet reference");

  const originalCharsetCount = [...content.matchAll(CHARSET_META_RE)].length;
  const originalContentTypeCount = [...content.matchAll(CONTENT_TYPE_META_RE)].length;
  const originalViewportCount = [...content.matchAll(VIEWPORT_META_RE)].length;
  const metadataAtStart = /^\s*<meta\s+charset=["']utf-8["'][^>]*>\s*<meta\s+name=["']viewport["'][^>]*>/i.test(
    content
  );
  content = content.replace(CHARSET_META_RE, "");
  content = content.replace(CONTENT_TYPE_META_RE, "");
  content = content.replace(VIEWPORT_META_RE, "");

  const fontHref = relativeAssetHref(file, root, FONT_STACK_PATH);
  const layoutHref = relativeAssetHref(file, root, EXERCISE_LAYOUT_PATH);
  const addedFontLinks = [];
  if (!hasLink(content, "preload", "font-stack.css")) {
    addedFontLinks.push(
      linkMarkup({ rel: "preload", href: fontHref, as: "style", integrity: fontIntegrity })
    );
  }
  if (!hasLink(content, "stylesheet", "font-stack.css")) {
    addedFontLinks.push(
      linkMarkup({ rel: "stylesheet", href: fontHref, integrity: fontIntegrity })
    );
  }

  let headContent = `${newline}\t<meta charset="utf-8">${newline}\t<meta name="viewport" content="width=device-width, initial-scale=1">`;
  if (addedFontLinks.length > 0) {
    headContent += `${newline}\t${addedFontLinks.join(`${newline}\t`)}`;
    changes.push("normalize font stack links");
  }
  const beforeBlankLineCleanup = content;
  content = content.replace(/^[\t ]+\r?$/gm, "");
  if (content !== beforeBlankLineCleanup) changes.push("remove whitespace-only head lines");
  content = content.replace(/^[\t \r\n]+|[\t \r\n]+$/g, "");
  if (content) headContent += `${newline}\t${content}`;

  if (!hasLink(content, "stylesheet", "sis-exercise-layout.css")) {
    const layoutLinks = [
      linkMarkup({
        rel: "preload",
        href: layoutHref,
        as: "style",
        integrity: layoutIntegrity,
      }),
      linkMarkup({ rel: "stylesheet", href: layoutHref, integrity: layoutIntegrity }),
    ];
    headContent += `${newline}\t${layoutLinks.join(`${newline}\t`)}`;
    changes.push("add shared responsive layout");
  }

  if (family === "dict" || family === "sent") {
    const uiStyleHref = relativeAssetHref(file, root, EXERCISE_UI_STYLE_PATH);
    if (!hasLink(content, "stylesheet", "sis-cloze-submit.css")) {
      const uiStyleLinks = [
        linkMarkup({
          rel: "preload",
          href: uiStyleHref,
          as: "style",
          integrity: uiStyleIntegrity,
        }),
        linkMarkup({ rel: "stylesheet", href: uiStyleHref, integrity: uiStyleIntegrity }),
      ];
      headContent += `${newline}\t${uiStyleLinks.join(`${newline}\t`)}`;
      changes.push("add shared cloze exercise styling");
    }

    const storyFilename = matchingStoryFilename(family, level, file);
    if (!storyFilename) throw new Error(`Could not map ${file} to a story background`);
    if (!hasScript(content, "story-theme.js")) {
      const storyThemeHref = relativeAssetHref(file, root, STORY_THEME_SCRIPT_PATH);
      headContent += `${newline}\t${scriptMarkup({
        src: storyThemeHref,
        integrity: storyThemeIntegrity,
        attributes: ` data-story-theme-key="${storyFilename}"`,
      })}`;
      changes.push("match the linked story background");
    }

    if (!hasScript(content, "sis-exercise-submit.js")) {
      const submitScriptHref = relativeAssetHref(file, root, EXERCISE_SUBMIT_SCRIPT_PATH);
      headContent += `${newline}\t${scriptMarkup({
        src: submitScriptHref,
        integrity: submitScriptIntegrity,
        attributes: ` defer data-sis-exercise-family="${family}"`,
      })}`;
      changes.push("add SIS identity and result submission");
    }
  }

  if (originalCharsetCount !== 1 || originalContentTypeCount > 0) {
    changes.push("normalize charset metadata");
  }
  if (originalViewportCount !== 1) changes.push("normalize viewport metadata");
  if (!metadataAtStart) changes.push("normalize head metadata placement");

  const replacementHead = `${openTag}${headContent}${newline}${closeTag}`;
  next = `${next.slice(0, headMatch.index)}${replacementHead}${next.slice(headMatch.index + head.length)}`;
  if (family === "dict") {
    const answerClass = normalizeRevealedAnswerClass(next);
    next = answerClass.source;
    if (answerClass.changed) changes.push("mark revealed correct answers");
  }
  return { source: next, changes: [...new Set(changes)] };
}

function walkNodes(node, output = []) {
  output.push(node);
  for (const child of node.childNodes || []) walkNodes(child, output);
  if (node.content) walkNodes(node.content, output);
  return output;
}

function nodeAttribute(node, name) {
  return (node.attrs || []).find((attribute) => attribute.name === name)?.value || "";
}

function nodeText(node) {
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes || []).map(nodeText).join("");
}

function pageProfile(source) {
  const nodes = walkNodes(parse5.parse(source));
  const elements = nodes.filter((node) => node.tagName);
  const count = (tagName) => elements.filter((node) => node.tagName === tagName).length;
  const titleNode = elements.find((node) => node.tagName === "title");
  const ids = elements.map((node) => nodeAttribute(node, "id")).filter(Boolean);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  return {
    audio: count("audio"),
    buttons: count("button"),
    duplicateIds: duplicates,
    forms: count("form"),
    inputs: count("input"),
    tables: count("table"),
    textareas: count("textarea"),
    title: titleNode ? nodeText(titleNode).replace(/\s+/g, " ").trim() : "",
    viewportCount: elements.filter(
      (node) => node.tagName === "meta" && nodeAttribute(node, "name").toLowerCase() === "viewport"
    ).length,
    charsetCount: elements.filter(
      (node) => node.tagName === "meta" && (node.attrs || []).some((attribute) => attribute.name === "charset")
    ).length,
    hasFontStack: /font-stack\.css/i.test(source),
    hasXmlDeclaration: XML_DECLARATION_RE.test(source),
  };
}

function targetFiles(root, family) {
  const files = [];
  const excludedBackups = [];
  const excludedNonExercises = [];
  const unexpected = [];
  const missingDirectories = [];

  for (let level = 1; level <= 6; level += 1) {
    const relativeDirectory = path.join(`begin${level}`, family);
    const directory = path.resolve(root, relativeDirectory);
    if (!fs.existsSync(directory)) {
      missingDirectories.push(relativeDirectory);
      continue;
    }

    const htmlNames = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.html?$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const name of htmlNames) {
      const absolute = path.join(directory, name);
      if (family === "dict" && level === 1 && /^b1d\d+-bu\.html$/i.test(name)) {
        excludedBackups.push(path.relative(root, absolute));
        continue;
      }

      const standardPattern =
        family === "dict"
          ? new RegExp(`^b${level}d\\d+\\.html$`, "i")
          : level <= 3
            ? new RegExp(`^b${level}mx\\d{5}\\.html$`, "i")
            : new RegExp(`^b${level}mx\\d{4}\\.html$`, "i");
      const specialDictationPage =
        family === "dict" &&
        level === 6 &&
        name === "1. The Hairstyle Change.html";

      if (standardPattern.test(name) || specialDictationPage) {
        const relative = path.relative(root, absolute);
        const source = fs.readFileSync(absolute, "utf8");
        const hasExerciseShell =
          /<body\b[^>]*\bid=["']TheBody["']/i.test(source) &&
          /\bid=["']InstructionsDiv["']/i.test(source) &&
          /\bid=["']MainDiv["']/i.test(source);
        if (!hasExerciseShell) {
          excludedNonExercises.push(relative);
          continue;
        }
        files.push({ absolute, level, relative, special: specialDictationPage });
      } else {
        unexpected.push(path.relative(root, absolute));
      }
    }
  }

  return { excludedBackups, excludedNonExercises, files, missingDirectories, unexpected };
}

function sequenceKey(family, level, fileName) {
  const stem = path.basename(fileName, path.extname(fileName));
  if (family === "dict") {
    const match = stem.match(new RegExp(`^b${level}d(\\d+)$`, "i"));
    return match ? { story: Number(match[1]), part: 0 } : null;
  }

  const pattern =
    level <= 3
      ? new RegExp(`^b${level}mx(\\d{3})(\\d{2})$`, "i")
      : new RegExp(`^b${level}mx(\\d{3})(\\d)$`, "i");
  const match = stem.match(pattern);
  return match ? { story: Number(match[1]), part: Number(match[2]) } : null;
}

function findSequenceGaps(files, family) {
  const byLevel = new Map();
  for (const file of files) {
    if (file.special) continue;
    const key = sequenceKey(family, file.level, path.basename(file.absolute));
    if (!key) continue;
    if (!byLevel.has(file.level)) byLevel.set(file.level, new Map());
    const stories = byLevel.get(file.level);
    if (!stories.has(key.story)) stories.set(key.story, new Set());
    stories.get(key.story).add(key.part);
  }

  const gapsByLevel = new Map();
  for (const [level, stories] of byLevel) {
    const numbers = [...stories.keys()].sort((left, right) => left - right);
    const gaps = [];
    const minimumStory = numbers[0];
    const maximumStory = numbers.at(-1);
    const expectedParts = family === "sent" ? (level === 6 ? 8 : 5) : 0;

    for (let story = minimumStory; story <= maximumStory; story += 1) {
      const parts = stories.get(story) || new Set();
      if (family === "dict") {
        if (!stories.has(story)) gaps.push(`${story}`);
        continue;
      }
      for (let part = 1; part <= expectedParts; part += 1) {
        if (!parts.has(part)) gaps.push(`${story}.${part}`);
      }
    }

    gapsByLevel.set(level, gaps);
  }

  return gapsByLevel;
}

function formatSamples(values, limit = 12) {
  const shown = values.slice(0, limit).join(", ");
  return values.length > limit ? `${shown}, … (${values.length - limit} more)` : shown;
}

function reportPrescan(family, inventory, plans) {
  const label = FAMILY_LABELS[family];
  console.log(`Prescan: B1-B6 ${label} HTML`);
  console.log(`Target pages: ${plans.length}`);
  if (inventory.excludedBackups.length) {
    console.log(
      `Excluded saved copies (${inventory.excludedBackups.length}): ${formatSamples(inventory.excludedBackups)}`
    );
  }
  if (inventory.excludedNonExercises.length) {
    console.log(
      `Excluded non-exercise HTML (${inventory.excludedNonExercises.length}): ${formatSamples(inventory.excludedNonExercises)}`
    );
  }
  if (inventory.missingDirectories.length) {
    console.log(`Missing directories: ${inventory.missingDirectories.join(", ")}`);
  }
  if (inventory.unexpected.length) {
    console.log(`Unrecognized HTML files (not changed): ${inventory.unexpected.join(", ")}`);
  }

  const groups = new Map();
  const missingViewport = [];
  const xmlPages = [];
  const noFontStack = [];
  const duplicateIds = [];
  const noTitle = [];
  const specialPages = [];
  for (const plan of plans) {
    const profile = plan.profile;
    const signature = `audio=${profile.audio}, textarea=${profile.textareas}, input=${profile.inputs}, buttons=${profile.buttons}, tables=${profile.tables}, forms=${profile.forms}`;
    const key = `${plan.level}|${signature}`;
    const group = groups.get(key) || { count: 0, example: plan.relative };
    group.count += 1;
    groups.set(key, group);
    if (profile.viewportCount !== 1) missingViewport.push(plan.relative);
    if (profile.hasXmlDeclaration) xmlPages.push(plan.relative);
    if (!profile.hasFontStack) noFontStack.push(plan.relative);
    if (profile.duplicateIds.length) duplicateIds.push(`${plan.relative} (${profile.duplicateIds.join(", ")})`);
    if (!profile.title) noTitle.push(plan.relative);
    if (plan.special) specialPages.push(plan);
  }

  console.log("Page shapes:");
  for (const [key, group] of groups) {
    const [level, signature] = key.split("|");
    console.log(`  B${level}: ${group.count} pages; ${signature}; example ${group.example}`);
  }

  const gapsByLevel = findSequenceGaps(inventory.files, family);
  for (const [level, gaps] of gapsByLevel) {
    if (gaps.length) console.log(`Sequence gaps B${level} (${gaps.length}): ${formatSamples(gaps)}`);
  }
  console.log(`Pages needing a single viewport meta (${missingViewport.length}).`);
  console.log(`Pages with XML declarations (${xmlPages.length}).`);
  if (noFontStack.length) {
    console.log(`Missing shared font stack (${noFontStack.length}): ${formatSamples(noFontStack)}`);
  }
  if (duplicateIds.length) {
    console.log(`Pages with duplicate IDs (${duplicateIds.length}): ${formatSamples(duplicateIds)}`);
  }
  if (noTitle.length) console.log(`Pages missing a title (${noTitle.length}): ${formatSamples(noTitle)}`);
  for (const page of specialPages) {
    console.log(
      `B6 dictation exception: ${page.relative}; ${page.profile.audio} audio items, ${page.profile.textareas} textareas, ${page.profile.forms} forms, and local assets/auth scripts outside the standard dictation shell.`
    );
  }
}

function backupAndWrite(file, source, backupManager) {
  backupManager.backupBeforeWrite(file);
  const siblingBackup = `${file}.BAK`;
  if (!fs.existsSync(siblingBackup)) {
    fs.copyFileSync(file, siblingBackup, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(file, source, "utf8");
}

function main(family, argv = process.argv.slice(2)) {
  if (!Object.hasOwn(FAMILY_LABELS, family)) {
    console.error(`ERROR: unsupported exercise family: ${family}`);
    return 2;
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage(family);
    return 2;
  }
  if (args.help) {
    printUsage(family);
    return 0;
  }

  const fontFile = path.resolve(args.root, FONT_STACK_PATH);
  const siteStyleFile = path.resolve(args.root, SITE_STYLE_PATH);
  const layoutFile = path.resolve(args.root, EXERCISE_LAYOUT_PATH);
  const uiStyleFile = path.resolve(args.root, EXERCISE_UI_STYLE_PATH);
  const storyThemeFile = path.resolve(args.root, STORY_THEME_SCRIPT_PATH);
  const submitScriptFile = path.resolve(args.root, EXERCISE_SUBMIT_SCRIPT_PATH);
  if (
    !fs.existsSync(fontFile) ||
    !fs.existsSync(siteStyleFile) ||
    !fs.existsSync(layoutFile) ||
    !fs.existsSync(uiStyleFile) ||
    !fs.existsSync(storyThemeFile) ||
    !fs.existsSync(submitScriptFile)
  ) {
    const missingFile = [fontFile, siteStyleFile, layoutFile, uiStyleFile, storyThemeFile, submitScriptFile].find(
      (file) => !fs.existsSync(file)
    );
    console.error(`ERROR: required shared stylesheet is missing: ${missingFile}`);
    return 2;
  }

  const inventory = targetFiles(args.root, family);
  if (inventory.missingDirectories.length || inventory.unexpected.length) {
    console.error("ERROR: family inventory is incomplete or contains unrecognized HTML; refusing to write any page.");
    if (inventory.missingDirectories.length) {
      console.error(`Missing directories: ${inventory.missingDirectories.join(", ")}`);
    }
    if (inventory.unexpected.length) {
      console.error(`Unrecognized HTML: ${inventory.unexpected.join(", ")}`);
    }
    return 2;
  }

  const fontIntegrity = integrityFor(fontFile);
  const siteStyleIntegrity = integrityFor(siteStyleFile);
  const layoutIntegrity = integrityFor(layoutFile);
  const uiStyleIntegrity = integrityFor(uiStyleFile);
  const storyThemeIntegrity = integrityFor(storyThemeFile);
  const submitScriptIntegrity = integrityFor(submitScriptFile);
  const plans = [];
  const failures = [];
  for (const target of inventory.files) {
    try {
      const source = fs.readFileSync(target.absolute, "utf8");
      const profile = pageProfile(source);
      const normalized = normalizeExerciseHtml(source, {
        file: target.absolute,
        root: args.root,
        fontIntegrity,
        siteStyleIntegrity,
        layoutIntegrity,
        uiStyleIntegrity,
        storyThemeIntegrity,
        submitScriptIntegrity,
        family,
        level: target.level,
      });
      plans.push({ ...target, profile, source, updated: normalized.source, changes: normalized.changes });
    } catch (error) {
      failures.push(`${target.relative}: ${error.message}`);
    }
  }

  reportPrescan(family, inventory, plans);
  if (failures.length) {
    console.error(`ERROR: ${failures.length} page(s) failed preflight; no files were changed.`);
    for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
    return 2;
  }

  const changed = plans.filter((plan) => plan.updated !== plan.source);
  const categoryCounts = new Map();
  const levelCounts = new Map();
  for (const plan of changed) {
    const levelCount = levelCounts.get(plan.level) || 0;
    levelCounts.set(plan.level, levelCount + 1);
    for (const change of plan.changes) categoryCounts.set(change, (categoryCounts.get(change) || 0) + 1);
  }

  console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Would change: ${changed.length} of ${plans.length} pages`);
  for (const [level, count] of levelCounts) console.log(`  B${level}: ${count}`);
  for (const [category, count] of categoryCounts) console.log(`  ${category}: ${count}`);
  if (changed.length) {
    console.log("Samples:");
    for (const plan of changed.slice(0, 8)) {
      console.log(`  ${plan.relative}: ${plan.changes.join(", ")}`);
    }
  }

  if (!args.apply || changed.length === 0) return 0;

  const backupManager = createBackupManager(args.root, `modernize-${family}-pages`);
  try {
    for (const plan of changed) backupAndWrite(plan.absolute, plan.updated, backupManager);
  } catch (error) {
    console.error(`ERROR: write stopped after a backup or filesystem failure: ${error.message}`);
    return 1;
  }

  console.log(`Updated ${changed.length} pages. Backups: ${backupManager.runRoot}`);
  return 0;
}

module.exports = {
  findSequenceGaps,
  main,
  normalizeKnownSentenceStylesheet,
  normalizeExerciseHtml,
  matchingStoryFilename,
  normalizeRevealedAnswerClass,
  pageProfile,
  parseArgs,
  targetFiles,
};
