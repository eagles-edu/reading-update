#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const { createBackupManager } = require("./write-backup.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const ROOTS = Object.freeze([
  "begin1",
  "begin2",
  "begin3",
  "begin4",
  "begin5",
  "begin6",
  "easyread",
  "eslread",
  "essays",
  "kidsenglish",
  "kidsenglish2",
  "kidsenglish3",
  "people",
  "supereasy",
]);
const SHARED_CSS = "css/sis-hot-potatoes.css";
const SHARED_UI = "js/hot-potatoes-ui.js";
const STORY_THEME = "js/story-theme.js";
const STYLE_CLASS = Object.freeze({
  "display:none": "hp-display-none",
  "display:block": "hp-display-block",
  "display:inline": "hp-display-inline",
  "visibility:hidden": "hp-visibility-hidden",
  "visibility:visible": "hp-visibility-visible",
});
const MANAGED_ASSETS_RE = /(?:\r?\n)?[ \t]*<!--[ \t]*HOT POTATOES MODERNIZATION ASSETS START[ \t]*-->[\s\S]*?<!--[ \t]*HOT POTATOES MODERNIZATION ASSETS END[ \t]*-->[ \t]*(?:\r?\n)?/i;
const MANAGED_STYLES_RE = /(?:\r?\n)?[ \t]*<!--[ \t]*HOT POTATOES MODERNIZATION STYLES START[ \t]*-->[\s\S]*?<!--[ \t]*HOT POTATOES MODERNIZATION STYLES END[ \t]*-->[ \t]*(?:\r?\n)?/i;

function usage() {
  console.log(
    `Usage: node ${path.basename(process.argv[1])} [--dry-run|--apply] [--root PATH]

Modernize identified Hot Potatoes HTML pages.

Options:
  --dry-run   Report planned changes without writing files (default).
  --apply     Back up and write the shared assets and normalized pages.
  --root PATH Scan a different repository root.
  --help      Show this help.
`,
  );
}

function parseArgs(argv) {
  const args = { apply: false, help: false, root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--root") {
      index += 1;
      if (index >= argv.length) throw new Error("--root requires a path");
      args.root = path.resolve(argv[index]);
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function integrityFor(file) {
  const contents = fs.readFileSync(file);
  return `sha384-${crypto.createHash("sha384").update(contents).digest("base64")}`;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function relativeHref(fromFile, toFile) {
  const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join("/");
  return relative
    .split("/")
    .map((segment) => (segment === ".." || segment === "." ? segment : encodeURIComponent(segment)))
    .join("/");
}

function walkHtml(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkHtml(absolute, output);
      continue;
    }
    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
    output.push(absolute);
  }
  return output;
}

function hasHotPotatoesFingerprint(source) {
  const hasBody = /<body\b[^>]*\bid\s*=\s*["']TheBody["']/i.test(source);
  const hasLegacyControl = /\bFuncButton\b/i.test(source);
  const hasAuthorMetadata = /created with hot potatoes|keywords[^>]*hot potatoes/i.test(source);
  return hasAuthorMetadata || (hasBody && hasLegacyControl);
}

function hasAmbiguousHotPotatoesMetadata(source) {
  return (
    /created with hot potatoes|keywords[^>]*hot potatoes/i.test(source) &&
    !/<body\b[^>]*\bid\s*=\s*["']TheBody["']/i.test(source)
  );
}

function storyTarget(root, file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const [section, family] = relative.split("/");
  const stem = path.basename(file, path.extname(file));
  let storyRelative = "";
  let match;

  if (/^begin[1-6]$/.test(section)) {
    const level = section.slice(-1);
    if (level === "6" && family === "dict" && stem === "1. The Hairstyle Change") {
      storyRelative = `begin6/b6/b6001.html`;
    } else if (
      (match = stem.match(new RegExp(`^b${level}d(\\d+)(?:-[a-z0-9]+)?$`, "i"))) ||
      (match = stem.match(new RegExp(`^b${level}(?:cloze|c)(\\d+)$`, "i")))
    ) {
      storyRelative = `${section}/b${level}/b${level}${match[1].slice(-3).padStart(3, "0")}.html`;
    } else if ((match = stem.match(new RegExp(`^b${level}mx(\\d{3})\\d{1,2}$`, "i")))) {
      storyRelative = `${section}/b${level}/b${level}${match[1]}.html`;
    }
  } else if (section === "easyread") {
    match = stem.match(/^(?:er_d|ecloze|ecross|emx)(\d+)/i);
    if (match) storyRelative = `easyread/es/easy${match[1].slice(0, 3).padStart(3, "0")}.html`;
  } else if (section === "eslread") {
    match = stem.match(/^(?:d|cloze|comp)(\d+)/i);
    if (match) storyRelative = `eslread/ss/s${match[1].padStart(3, "0")}.html`;
  } else if (section === "essays") {
    match = stem.match(/^(?:aigdict|aigcloze|essaycomp|comp)(\d+)/i);
    if (match) storyRelative = `essays/e/essay${match[1].padStart(3, "0")}.html`;
  } else if (section === "kidsenglish") {
    match = stem.match(/^(?:ked|kecloze|kemx)(\d+)/i);
    if (match) storyRelative = `kidsenglish/ke/ke${match[1].slice(0, 3).padStart(3, "0")}.html`;
  } else if (section === "kidsenglish2") {
    match = stem.match(/^k2d(\d+)/i);
    if (match) storyRelative = `kidsenglish2/ke2/ke2${match[1].slice(-3).padStart(3, "0")}.html`;
    else if ((match = stem.match(/^(?:kecloze|kemx)2(\d{3})/i))) {
      storyRelative = `kidsenglish2/ke2/ke2${match[1]}.html`;
    }
  } else if (section === "kidsenglish3") {
    match = stem.match(/^k3d(\d+)/i);
    if (match) storyRelative = `kidsenglish3/ke3/ke3${match[1].slice(-3).padStart(3, "0")}.html`;
    else if ((match = stem.match(/^(?:kecloze|kemx)3(\d{3})/i))) {
      storyRelative = `kidsenglish3/ke3/ke3${match[1]}.html`;
    }
  } else if (section === "people") {
    match = stem.match(/^(?:pdict|apcloze|pcomp)(\d+)/i);
    if (match) storyRelative = `people/p/people${match[1].padStart(3, "0")}.html`;
  } else if (section === "supereasy") {
    match = stem.match(/^(?:se_d|secloze|semx)(\d+)/i);
    if (match) storyRelative = `supereasy/se/supereasy${match[1].slice(0, 3).padStart(3, "0")}.html`;
  }

  if (!storyRelative) return null;
  const storyAbsolute = path.resolve(root, storyRelative);
  if (!fs.existsSync(storyAbsolute)) return null;
  return {
    absolute: storyAbsolute,
    key: path.basename(storyAbsolute),
    relative: storyRelative,
  };
}

function scanTargets(root) {
  const pages = [];
  const ambiguous = [];
  const skippedBackups = [];
  for (const relativeDirectory of ROOTS) {
    const absoluteDirectory = path.resolve(root, relativeDirectory);
    for (const absolute of walkHtml(absoluteDirectory)) {
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (/-bu\.html?$/i.test(absolute)) {
        skippedBackups.push(relative);
        continue;
      }
      const source = fs.readFileSync(absolute, "utf8");
      if (hasAmbiguousHotPotatoesMetadata(source)) {
        ambiguous.push(`${relative}: Hot Potatoes metadata without body#TheBody`);
        continue;
      }
      if (!hasHotPotatoesFingerprint(source)) continue;
      if (!/<body\b[^>]*\bid\s*=\s*["']TheBody["']/i.test(source)) {
        ambiguous.push(`${relative}: missing body#TheBody`);
        continue;
      }
      const story = storyTarget(root, absolute);
      pages.push({ absolute, relative, story, source });
    }
  }
  return { ambiguous, pages, skippedBackups };
}

function cssMember(node) {
  if (!node || node.type !== "MemberExpression") return null;
  const property = node.computed
    ? node.property && node.property.type === "Literal"
      ? node.property.value
      : null
    : node.property && node.property.name;
  if (property !== "display" && property !== "visibility") return null;
  const style = node.object;
  if (!style || style.type !== "MemberExpression") return null;
  const styleName = style.computed
    ? style.property && style.property.type === "Literal"
      ? style.property.value
      : null
    : style.property && style.property.name;
  if (styleName !== "style") return null;
  return { property, receiver: style.object };
}

function collectRuntimePatches(source, options = {}) {
  const { file = "<input>" } = options;
  const patches = [];
  const stats = { reads: 0, writes: 0 };
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;

  while ((match = scripts.exec(source))) {
    const attributes = match[1];
    const content = match[2];
    if (/\bsrc\s*=/i.test(attributes) || !/\.\s*style\s*\.\s*(?:display|visibility)\b/i.test(content)) {
      continue;
    }
    let ast;
    try {
      ast = acorn.parse(content, {
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        ecmaVersion: "latest",
        sourceType: "script",
      });
    } catch (error) {
      throw new Error(`${file}: cannot parse inline Hot Potatoes script: ${error.message}`, {
        cause: error,
      });
    }

    const scriptOpenEnd = match[0].indexOf(">") + 1;
    const contentStart = match.index + scriptOpenEnd;
    const localPatches = [];

    function visit(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }

      if (node.type === "AssignmentExpression") {
        const target = cssMember(node.left);
        if (target) {
          if (node.operator !== "=") {
            throw new Error(`${file}: unsupported ${target.property} assignment operator ${node.operator}`);
          }
          if (node.right.type !== "Literal" || typeof node.right.value !== "string") {
            throw new Error(`${file}: unsupported non-string ${target.property} state assignment`);
          }
          const allowed =
            target.property === "display"
              ? ["", "none", "block", "inline"]
              : ["", "hidden", "visible"];
          if (!allowed.includes(node.right.value.toLowerCase())) {
            throw new Error(`${file}: unsupported ${target.property} state ${JSON.stringify(node.right.value)}`);
          }
          const receiver = content.slice(target.receiver.start, target.receiver.end);
          localPatches.push({
            end: node.end,
            start: node.start,
            value: `HPSet${target.property === "display" ? "Display" : "Visibility"}(${receiver}, ${JSON.stringify(node.right.value)})`,
          });
          stats.writes += 1;
          return;
        }
      }

      if (node.type === "UpdateExpression") {
        const target = cssMember(node.argument);
        if (target) throw new Error(`${file}: unsupported ++/-- runtime ${target.property} state`);
      }

      if (node.type === "UnaryExpression" && node.operator === "delete") {
        const target = cssMember(node.argument);
        if (target) throw new Error(`${file}: unsupported delete of runtime ${target.property} state`);
      }

      if (node.type === "MemberExpression") {
        const target = cssMember(node);
        if (target) {
          const receiver = content.slice(target.receiver.start, target.receiver.end);
          localPatches.push({
            end: node.end,
            start: node.start,
            value: `HPGet${target.property === "display" ? "Display" : "Visibility"}(${receiver})`,
          });
          stats.reads += 1;
          return;
        }
      }

      for (const key of Object.keys(node)) {
        if (key === "start" || key === "end" || key === "loc") continue;
        visit(node[key]);
      }
    }

    visit(ast);
    for (const patch of localPatches) {
      patches.push({
        end: contentStart + patch.end,
        start: contentStart + patch.start,
        value: patch.value,
      });
    }
  }

  return { patches, stats };
}

function applyPatches(source, patches) {
  let next = source;
  for (const patch of [...patches].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, patch.start)}${patch.value}${next.slice(patch.end)}`;
  }
  return next;
}

function normalizeStyleValue(value, file) {
  const declarations = String(value)
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  const classes = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator < 1) throw new Error(`${file}: unsupported inline style ${JSON.stringify(value)}`);
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim().toLowerCase();
    const className = STYLE_CLASS[`${property}:${propertyValue}`];
    if (!className) throw new Error(`${file}: unsupported inline style ${JSON.stringify(value)}`);
    classes.push(className);
  }
  return classes;
}

function readTagAttribute(tag, wantedName) {
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) {
    if (match[1].toLowerCase() === wantedName.toLowerCase()) {
      return match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return "";
}

function addClasses(tag, classes) {
  const requested = [...new Set(classes.filter(Boolean))];
  if (!requested.length) return tag;
  const classMatch = tag.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const existing = classMatch[2] ?? classMatch[3] ?? "";
    const combined = [...new Set(`${existing} ${requested.join(" ")}`.trim().split(/\s+/))].join(" ");
    return tag.replace(classMatch[0], ` class="${escapeAttribute(combined)}"`);
  }
  return tag.replace(/\s*\/?>$/, (closing) => ` class="${requested.join(" ")}"${closing}`);
}

function addAttribute(tag, name, value) {
  if (new RegExp(`\\s${name}\\s*=`, "i").test(tag)) return tag;
  return tag.replace(/(\s*\/?\s*>)$/, (closing) =>
    ` ${name}="${escapeAttribute(value)}"${closing}`,
  );
}

function removeLegacyButtonHandlers(tag) {
  const eventAttributes = /\s+(onfocus|onblur|onmouseover|onmouseout|onmousedown|onmouseup)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  return tag.replace(eventAttributes, (attribute, _name, doubleQuoted, singleQuoted, unquoted) => {
    const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
    return /^FuncBtn(?:Over|Out|Down)\s*\(\s*this\s*\)\s*;?$/i.test(value) ? "" : attribute;
  });
}

function transformOpenTag(tag, file, counters) {
  if (/^<\//.test(tag) || /^<!/.test(tag) || /^<\?/.test(tag)) return tag;
  const nameMatch = tag.match(/^<([a-z][\w:-]*)\b/i);
  if (!nameMatch) return tag;
  const tagName = nameMatch[1].toLowerCase();
  const classes = [];
  let next = tag;
  const styles = [...tag.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)];
  for (const style of styles) {
    const styleValue = style[1] ?? style[2] ?? style[3] ?? "";
    classes.push(...normalizeStyleValue(styleValue, file));
    counters.styleAttributes += 1;
  }
  if (styles.length) {
    next = next.replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  const classesBeforeButtons = readTagAttribute(next, "class").split(/\s+/);
  const isShortAnswerField = tagName === "textarea" && classesBeforeButtons.includes("ShortAnswerBox");
  const hasAccessibleName = ["aria-label", "aria-labelledby", "title"].some((attribute) =>
    readTagAttribute(next, attribute).trim(),
  );
  if (isShortAnswerField && !hasAccessibleName) {
    const questionMatch = /^Q_(\d+)_Guess$/i.exec(readTagAttribute(next, "id"));
    const label = questionMatch
      ? `Your answer for question ${Number(questionMatch[1]) + 1}`
      : "Your answer";
    next = addAttribute(next, "aria-label", label);
    counters.answerFields += 1;
  }

  const inputType = readTagAttribute(next, "type").toLowerCase();
  const isButton = tagName === "button" || (tagName === "input" && ["button", "submit", "reset"].includes(inputType));
  if (isButton) {
    classes.push("hp-button");
    counters.buttons += 1;
    const before = next;
    next = removeLegacyButtonHandlers(next);
    counters.legacyHandlers += (before.match(/\son(?:focus|blur|mouseover|mouseout|mousedown|mouseup)\s*=/gi) || []).length -
      (next.match(/\son(?:focus|blur|mouseover|mouseout|mousedown|mouseup)\s*=/gi) || []).length;
  }
  if (classes.length) next = addClasses(next, classes);
  return next;
}

function transformMarkup(source, file) {
  const counters = { answerFields: 0, buttons: 0, legacyHandlers: 0, styleAttributes: 0 };
  const protectedOrTag = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<![^>]*>|<\/?[A-Za-z][^<>]*>/gi;
  const next = source.replace(protectedOrTag, (token) => {
    if (/^<textarea\b/i.test(token)) {
      const openingEnd = token.indexOf(">") + 1;
      return `${transformOpenTag(token.slice(0, openingEnd), file, counters)}${token.slice(openingEnd)}`;
    }
    if (/^<!--|^<script\b|^<style\b|^<!/i.test(token)) return token;
    return transformOpenTag(token, file, counters);
  });
  return { source: next, counters };
}

function removeManagedScriptTags(source) {
  return source.replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (tag, attributes) => {
    const src = readTagAttribute(`<script ${attributes}>`, "src");
    return /(?:^|\/)story-theme\.js(?:\?|$)/i.test(src) || /(?:^|\/)hot-potatoes-ui\.js(?:\?|$)/i.test(src)
      ? ""
      : tag;
  });
}

function injectAssets(source, options) {
  const { file, root, cssIntegrity, uiIntegrity, storyIntegrity, story } = options;
  const headMatch = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!headMatch) throw new Error(`${path.relative(root, file)}: missing head element`);
  const openTag = headMatch[0].match(/^<head\b[^>]*>/i)?.[0];
  const closeTag = headMatch[0].match(/<\/head\s*>$/i)?.[0];
  if (!openTag || !closeTag) throw new Error(`${path.relative(root, file)}: cannot isolate head element`);

  let headContent = headMatch[0].slice(openTag.length, headMatch[0].length - closeTag.length);
  headContent = headContent.replace(MANAGED_ASSETS_RE, "");
  headContent = headContent.replace(MANAGED_STYLES_RE, "");
  headContent = headContent.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = readTagAttribute(tag, "href");
    return href.endsWith("sis-hot-potatoes.css") ? "" : tag;
  });

  const themeHref = relativeHref(file, path.resolve(root, STORY_THEME));
  const uiHref = relativeHref(file, path.resolve(root, SHARED_UI));
  const cssHref = relativeHref(file, path.resolve(root, SHARED_CSS));
  const storyUrl = relativeHref(file, story.absolute);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const assetBlock = [
    "<!-- HOT POTATOES MODERNIZATION ASSETS START -->",
    `<script src="${themeHref}" integrity="${storyIntegrity}" data-story-theme-key="${escapeAttribute(story.key)}" data-story-title-url="${escapeAttribute(storyUrl)}"></script>`,
    `<script src="${uiHref}" integrity="${uiIntegrity}"></script>`,
    "<!-- HOT POTATOES MODERNIZATION ASSETS END -->",
  ].join(newline);
  const styleBlock = [
    "<!-- HOT POTATOES MODERNIZATION STYLES START -->",
    `<link rel="preload" href="${cssHref}" as="style" integrity="${cssIntegrity}">`,
    `<link rel="stylesheet" href="${cssHref}" integrity="${cssIntegrity}">`,
    "<!-- HOT POTATOES MODERNIZATION STYLES END -->",
  ].join(newline);

  const metaMatches = [...headContent.matchAll(/<meta\b[^>]*>/gi)];
  let insertionPoint = 0;
  for (const match of metaMatches) {
    if (/\bcharset\s*=|\bname\s*=\s*["']viewport["']/i.test(match[0])) {
      insertionPoint = match.index + match[0].length;
    }
  }
  const before = headContent.slice(0, insertionPoint).replace(/[\t \r\n]*$/, "");
  const after = headContent.slice(insertionPoint).replace(/^[\t \r\n]*/, "");
  headContent = `${before}${newline}${assetBlock}${newline}${after}`.replace(/[\t \r\n]*$/, "");
  headContent = `${headContent.replace(/[\t \r\n]*$/, "")}${newline}${styleBlock}${newline}`;

  const replacementHead = `${openTag}${headContent}${closeTag}`;
  return `${source.slice(0, headMatch.index)}${replacementHead}${source.slice(headMatch.index + headMatch[0].length)}`;
}

function extractHeadStyleBlocks(source) {
  const head = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] || "";
  return [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)].map(([block]) => block);
}

function normalizePage(page, options) {
  const { root, cssIntegrity, uiIntegrity, storyIntegrity } = options;
  const originalStyles = extractHeadStyleBlocks(page.source);
  const runtime = collectRuntimePatches(page.source, { file: page.relative });
  let source = applyPatches(page.source, runtime.patches);
  const markup = transformMarkup(source, page.relative);
  source = markup.source
    .replace(/Show all questions/gi, "Show all")
    .replace(/Show questions one by one/gi, "Show one")
    .replace(/Show Answer\b/gi, "Show answers");
  source = removeManagedScriptTags(source);
  source = injectAssets(source, {
    cssIntegrity,
    file: page.absolute,
    root,
    story: page.story,
    storyIntegrity,
    uiIntegrity,
  });

  const normalizedStyles = extractHeadStyleBlocks(source);
  if (
    originalStyles.length !== normalizedStyles.length ||
    originalStyles.some((style, index) => style !== normalizedStyles[index])
  ) {
    throw new Error(`${page.relative}: the migration changed an existing head style block`);
  }
  if (/\sstyle\s*=/i.test(source)) {
    throw new Error(`${page.relative}: inline style attribute remained after migration`);
  }

  return {
    counters: markup.counters,
    source,
    stats: runtime.stats,
  };
}

function collectAssetInfo(root) {
  const files = {
    css: path.resolve(root, SHARED_CSS),
    story: path.resolve(root, STORY_THEME),
    ui: path.resolve(root, SHARED_UI),
  };
  const missing = Object.entries(files).filter(([, file]) => !fs.existsSync(file));
  if (missing.length) throw new Error(`Missing shared asset: ${missing.map(([key]) => key).join(", ")}`);
  return {
    cssIntegrity: integrityFor(files.css),
    storyIntegrity: integrityFor(files.story),
    uiIntegrity: integrityFor(files.ui),
  };
}

function summarize(plans, inventory, apply) {
  const changed = plans.filter((plan) => plan.updated !== plan.source);
  const totals = changed.reduce(
    (result, plan) => {
      result.answerFields += plan.result.counters.answerFields;
      result.styleAttributes += plan.result.counters.styleAttributes;
      result.buttons += plan.result.counters.buttons;
      result.legacyHandlers += plan.result.counters.legacyHandlers;
      result.runtimeReads += plan.result.stats.reads;
      result.runtimeWrites += plan.result.stats.writes;
      return result;
    },
    { answerFields: 0, buttons: 0, legacyHandlers: 0, runtimeReads: 0, runtimeWrites: 0, styleAttributes: 0 },
  );

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Hot Potatoes pages: ${inventory.pages.length}`);
  console.log(`Pages with companion stories: ${inventory.pages.filter((page) => page.story).length}`);
  console.log(`Unmapped companion stories: ${inventory.unmapped.length}`);
  console.log(`Ambiguous Hot Potatoes files: ${inventory.ambiguous.length}`);
  if (inventory.skippedBackups.length) console.log(`Saved -bu copies excluded: ${inventory.skippedBackups.length}`);
  console.log(`Would change: ${changed.length} pages`);
  console.log(`Inline style attributes: ${totals.styleAttributes}`);
  console.log(`ShortAnswer fields given accessible names: ${totals.answerFields}`);
  console.log(`Buttons normalized: ${totals.buttons}`);
  console.log(`Legacy hover handlers removed: ${totals.legacyHandlers}`);
  console.log(`Runtime visibility reads migrated: ${totals.runtimeReads}`);
  console.log(`Runtime visibility writes migrated: ${totals.runtimeWrites}`);
  for (const item of inventory.unmapped.slice(0, 24)) console.log(`  Unmapped story: ${item}`);
  for (const item of inventory.ambiguous.slice(0, 24)) console.log(`  Ambiguous: ${item}`);
  if (changed.length) {
    console.log("Changed page samples:");
    for (const plan of changed.slice(0, 8)) console.log(`  ${plan.relative}`);
  }
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    usage();
    return 2;
  }
  if (args.help) {
    usage();
    return 0;
  }

  let shared;
  try {
    shared = collectAssetInfo(args.root);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }

  const scanned = scanTargets(args.root);
  const inventory = {
    ...scanned,
    unmapped: scanned.pages.filter((page) => !page.story).map((page) => page.relative),
  };
  const plans = [];
  const failures = [];
  for (const page of inventory.pages) {
    if (!page.story) continue;
    try {
      const result = normalizePage(page, { ...shared, root: args.root });
      plans.push({ ...page, result, source: page.source, updated: result.source });
    } catch (error) {
      failures.push(error.message);
    }
  }

  summarize(plans, inventory, args.apply);
  if (inventory.ambiguous.length || inventory.unmapped.length || failures.length) {
    console.error("ERROR: coverage or transformation preflight is incomplete; no pages were changed.");
    for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
    if (failures.length > 40) console.error(`  … ${failures.length - 40} more transformation errors`);
    return 2;
  }
  if (!args.apply) return 0;

  const changed = plans.filter((plan) => plan.updated !== plan.source);
  if (!changed.length) {
    console.log("No page changes are needed.");
    return 0;
  }

  const backupManager = createBackupManager(args.root, "modernize-hot-potatoes");
  try {
    for (const plan of changed) backupManager.backupBeforeWrite(plan.absolute);
    for (const plan of changed) fs.writeFileSync(plan.absolute, plan.updated, "utf8");
  } catch (error) {
    console.error(`ERROR: page write failed after backups were created at ${backupManager.runRoot}: ${error.message}`);
    return 2;
  }

  console.log(`Applied ${changed.length} page changes. Backups: ${backupManager.runRoot}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  collectRuntimePatches,
  extractHeadStyleBlocks,
  main,
  normalizePage,
  normalizeStyleValue,
  scanTargets,
  storyTarget,
  transformMarkup,
};
