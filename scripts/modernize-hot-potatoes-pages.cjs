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
    `Usage: node ${path.basename(process.argv[1])} [--dry-run|--apply] [--scope NAME] [--root PATH]

Modernize identified Hot Potatoes HTML pages.

Options:
  --dry-run   Report planned changes without writing files (default).
  --apply     Back up and write the shared assets and normalized pages.
  --scope     Restrict the scan to one configured content root; repeatable.
  --root PATH Scan a different repository root.
  --help      Show this help.
`,
  );
}

function parseArgs(argv) {
  const args = { apply: false, help: false, root: DEFAULT_ROOT, scopes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--root") {
      index += 1;
      if (index >= argv.length) throw new Error("--root requires a path");
      args.root = path.resolve(argv[index]);
    } else if (arg === "--scope") {
      index += 1;
      if (index >= argv.length) throw new Error("--scope requires a content root name");
      const scope = argv[index];
      if (!ROOTS.includes(scope)) {
        throw new Error(`--scope must be one of: ${ROOTS.join(", ")}`);
      }
      if (!args.scopes.includes(scope)) args.scopes.push(scope);
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

function scanTargets(root, roots = ROOTS) {
  const pages = [];
  const ambiguous = [];
  const skippedBackups = [];
  for (const relativeDirectory of roots) {
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
  const stats = { buttonFunctions: 0, reads: 0, writes: 0 };
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  const legacyButtonFunction = /\bfunction\s+(?:Func|Nav)Btn(?:Over|Out|Down)\s*\(/i;
  let match;

  while ((match = scripts.exec(source))) {
    const attributes = match[1];
    const content = match[2];
    if (
      /\bsrc\s*=/i.test(attributes) ||
      (!/\.\s*style\s*\.\s*(?:display|visibility)\b/i.test(content) && !legacyButtonFunction.test(content))
    ) {
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

      if (
        node.type === "FunctionDeclaration" &&
        /^(?:Func|Nav)Btn(?:Over|Out|Down)$/i.test(node.id?.name || "")
      ) {
        localPatches.push({
          end: node.end,
          start: node.start,
          value: `function ${node.id.name}() {}`,
        });
        stats.buttonFunctions += 1;
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
  if (new RegExp(`\\s${name}(?:\\s*=|\\s|/?>)`, "i").test(tag)) return tag;
  return tag.replace(/(\s*\/?\s*>)$/, (closing) =>
    ` ${name}="${escapeAttribute(value)}"${closing}`,
  );
}

function removeAttribute(tag, name) {
  const attribute = new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  return tag.replace(attribute, "");
}

function ensureCloseButtonSpans(content) {
  const spans = (content.match(/<span\b/gi) || []).length;
  return content + "<span></span>".repeat(Math.max(0, 4 - spans));
}

function removeLegacyButtonHandlers(tag) {
  const eventAttributes = /\s+(onfocus|onblur|onmouseover|onmouseout|onmousedown|onmouseup)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  return tag.replace(eventAttributes, (attribute, _name, doubleQuoted, singleQuoted, unquoted) => {
    const value = String(doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
    return /^(?:Func|Nav)Btn(?:Over|Out|Down)\s*\(\s*this\s*\)\s*;?$/i.test(value) ? "" : attribute;
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
  const onclick = readTagAttribute(next, "onclick");
  const isWindowClose = /\bwindow\.close\s*\(\s*\)/i.test(onclick);
  const hasCloseMarker = /\sdata-hp-close(?:\s*=|\s|>)/i.test(next);
  const isCloseButton = isWindowClose || hasCloseMarker;
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
    if (isCloseButton) {
      classes.push("btn-74");
      if (isWindowClose) next = removeAttribute(next, "onclick");
      next = addAttribute(next, "data-hp-close", "");
      next = replaceAttribute(next, "aria-label", "Close");
      next = replaceAttribute(next, "data-hp-tooltip", "Close this exercise.");
      next = replaceAttribute(next, "aria-description", "Close this exercise.");
      if (isWindowClose || !classesBeforeButtons.includes("btn-74") || !hasCloseMarker) {
        counters.closeButtons += 1;
      }
    } else if (classesBeforeButtons.some((name) => /^FuncButton(?:Up|Down)?$/i.test(name))) {
      classes.push("btn-17");
      if (!classesBeforeButtons.includes("btn-17")) counters.animatedButtons += 1;
    }
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
  const counters = {
    answerFields: 0,
    adsMoved: 0,
    animatedButtons: 0,
    buttons: 0,
    closeButtons: 0,
    closeLinks: 0,
    emptyFeedbackPanelsHidden: 0,
    horizontalRules: 0,
    legacyHandlers: 0,
    styleAttributes: 0,
    titleHeadingsNormalized: 0,
    titlePanelsWrapped: 0,
  };
  const protectedOrTag = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>|<button\b[^>]*>[\s\S]*?<\/button\s*>|<![^>]*>|<\/?[A-Za-z][^<>]*>/gi;
  let next = source.replace(protectedOrTag, (token) => {
    if (/^<hr\b/i.test(token)) {
      counters.horizontalRules += 1;
      return "";
    }
    if (/^<a\b/i.test(token)) {
      const openTag = token.match(/^<a\b[^>]*>/i)?.[0];
      const closeTarget = readTagAttribute(openTag || "", "href");
      if (!/^\s*javascript\s*:\s*window\.close\s*\(\s*\)\s*;?\s*$/i.test(closeTarget)) {
        return token;
      }

      const preservedAttributes = (openTag || "")
        .replace(/^<a\b/i, "")
        .replace(/>$/, "")
        .replace(
          /\s+(?:href|target|rel|download|ping|hreflang|referrerpolicy|on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
          "",
        );
      const contentStart = openTag.length;
      const closingTag = token.match(/<\/a\s*>$/i)?.[0] || "</a>";
      const contentEnd = token.length - closingTag.length;
      const content = token.slice(contentStart, contentEnd);
      const buttonTag = transformOpenTag(
        `<button${preservedAttributes} type="button" data-hp-close>`,
        file,
        counters,
      );
      counters.closeLinks += 1;
      return `${buttonTag}${ensureCloseButtonSpans(content)}</button>`;
    }
    if (/^<button\b/i.test(token)) {
      const openTag = token.match(/^<button\b[^>]*>/i)?.[0];
      const closingTag = token.match(/<\/button\s*>$/i)?.[0] || "</button>";
      const contentStart = openTag.length;
      const contentEnd = token.length - closingTag.length;
      const originalClose =
        /\sdata-hp-close(?:\s*=|\s|>)/i.test(openTag) ||
        /\bwindow\.close\s*\(\s*\)/i.test(readTagAttribute(openTag, "onclick"));
      const buttonTag = transformOpenTag(openTag, file, counters);
      const content = token.slice(contentStart, contentEnd);
      return `${buttonTag}${originalClose ? ensureCloseButtonSpans(content) : content}${closingTag}`;
    }
    if (/^<textarea\b/i.test(token)) {
      const openingEnd = token.indexOf(">") + 1;
      return `${transformOpenTag(token.slice(0, openingEnd), file, counters)}${token.slice(openingEnd)}`;
    }
    if (/^<!--|^<script\b|^<style\b|^<!/i.test(token)) return token;
    return transformOpenTag(token, file, counters);
  });
  next = hideEmptyGuessDivs(next, file, counters);
  next = normalizeExerciseTitleHeadings(next, file, counters);
  next = wrapTitleWithInstructions(next, file, counters);
  return { source: next, counters };
}

function hideEmptyGuessDivs(source, file, counters) {
  const openings = [...source.matchAll(/<div\b(?=[^>]*\bid\s*=\s*(["'])GuessDiv\1)[^>]*>/gi)];
  if (!openings.length) return source;
  if (openings.length !== 1) throw new Error(`${file}: multiple GuessDiv panels are ambiguous`);

  const opening = openings[0];
  const end = findMatchingDivEnd(source, opening);
  if (end < 0) throw new Error(`${file}: cannot safely locate the GuessDiv boundary`);
  const block = source.slice(opening.index, end);
  const closing = /<\/div\s*>$/i.exec(block);
  if (!closing) throw new Error(`${file}: cannot locate the GuessDiv closing tag`);
  const contentStart = opening.index + opening[0].length;
  const contentEnd = end - closing[0].length;
  const content = source.slice(contentStart, contentEnd);
  if (!/^(?:\s|<!--[\s\S]*?-->)*$/.test(content)) return source;

  const nextOpening = addClasses(opening[0], ["hp-display-none"]);
  const cleanContent = content.replace(/<!--[\s\S]*?-->|[\t\r\n\f ]+/g, (token) =>
    token.startsWith("<!--") ? token : "",
  );
  if (nextOpening !== opening[0] || cleanContent !== content) counters.emptyFeedbackPanelsHidden += 1;
  return `${source.slice(0, opening.index)}${nextOpening}${cleanContent}${source.slice(contentEnd)}`;
}

function normalizeExerciseTitleHeadings(source, file, counters) {
  const protectedMarkup = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const visible = source.replace(protectedMarkup, (token) => " ".repeat(token.length));
  const openingPattern = /<h([2-6])\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bExerciseTitle\b[^"']*\2)[^>]*>/gi;
  const edits = [];

  for (const opening of visible.matchAll(openingPattern)) {
    const level = opening[1];
    const closingPattern = new RegExp(`</h${level}\\s*>`, "gi");
    closingPattern.lastIndex = opening.index + opening[0].length;
    const closing = closingPattern.exec(visible);
    if (!closing) throw new Error(`${file}: exercise title heading has no matching close tag`);
    edits.push({ index: opening.index, originalLength: opening[0].length, value: opening[0].replace(/^<h[2-6]/i, "<h1") });
    edits.push({ index: closing.index, originalLength: closing[0].length, value: "</h1>" });
  }

  for (const edit of edits.sort((left, right) => right.index - left.index)) {
    source = `${source.slice(0, edit.index)}${edit.value}${source.slice(edit.index + edit.originalLength)}`;
  }
  counters.titleHeadingsNormalized += edits.length / 2;
  return source;
}

function findMatchingDivEnd(source, openingMatch) {
  const tags = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?div\b[^>]*>/gi;
  tags.lastIndex = openingMatch.index + openingMatch[0].length;
  let depth = 1;
  let match;
  while ((match = tags.exec(source))) {
    if (match[0].startsWith("<!--") || /^<(?:script|style)\b/i.test(match[0])) continue;
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

function wrapTitleWithInstructions(source, file, counters) {
  const titlePattern = /<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bTitles\b[^"']*\1)[^>]*>/gi;
  const instructionPattern = /<div\b(?=[^>]*\bid\s*=\s*(["'])InstructionsDiv\1)[^>]*>/gi;
  const titles = [...source.matchAll(titlePattern)];
  const instructions = [...source.matchAll(instructionPattern)];

  if (titles.length !== 1 || instructions.length !== 1) {
    throw new Error(
      `${file}: expected one title and one instruction panel; found ${titles.length} title and ${instructions.length} instruction panels`,
    );
  }

  const title = titles[0];
  const instruction = instructions[0];
  const titleEnd = findMatchingDivEnd(source, title);
  const instructionEnd = findMatchingDivEnd(source, instruction);
  if (titleEnd < 0 || instructionEnd < 0 || titleEnd > instruction.index || instructionEnd <= instruction.index) {
    throw new Error(`${file}: cannot safely locate the title and instruction panel boundaries`);
  }

  const wrapperPattern = /<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bhp-instructions-panel\b[^"']*\1)[^>]*>/gi;
  const existingWrappers = [...source.matchAll(wrapperPattern)];
  if (existingWrappers.length > 1) {
    throw new Error(`${file}: multiple instruction panel wrappers are ambiguous`);
  }
  if (existingWrappers.length === 1) {
    const wrapper = existingWrappers[0];
    const wrapperEnd = findMatchingDivEnd(source, wrapper);
    if (
      wrapperEnd >= 0 &&
      wrapper.index < title.index &&
      wrapper.index < instruction.index &&
      wrapperEnd >= instructionEnd
    ) {
      counters.titlePanelsWrapped += 1;
      return source;
    }
    throw new Error(`${file}: existing instruction panel wrapper does not contain its title and instructions`);
  }

  const between = source.slice(titleEnd, instruction.index);
  const movedAds = [];
  const cleanBetween = between.replace(
    /(?:\s*<!--[\t \r\n]*ResponsiveIndex[^>]*-->[\t \r\n]*)?<ins\b(?=[^>]*\bdata-ad-(?:client|slot)\s*=)[^>]*>[\s\S]*?<\/ins\s*>/gi,
    (ad) => {
      movedAds.push(ad);
      return "";
    },
  );
  if (!/^(?:\s|<!--[\s\S]*?-->)*$/.test(cleanBetween)) {
    throw new Error(`${file}: title and instructions are separated by unmatched markup`);
  }

  counters.adsMoved += movedAds.length;
  counters.titlePanelsWrapped += 1;
  return `${source.slice(0, title.index)}${movedAds.join("")}<div class="hp-instructions-panel">${source.slice(title.index, titleEnd)}${cleanBetween}${source.slice(instruction.index, instructionEnd)}</div>${source.slice(instructionEnd)}`;
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

function replaceAttribute(tag, name, value) {
  const attribute = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  if (!attribute.test(tag)) return addAttribute(tag, name, value);
  return tag.replace(attribute, ` ${name}="${escapeAttribute(value)}"`);
}

function buttonLabelDetails(rawLabel, openingTag) {
  const label = String(rawLabel)
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  const click = readTagAttribute(openingTag, "onclick");

  if (/^show\s+all(?:\s+questions)?$/i.test(label)) {
    return { label: "All", tooltip: "Show all questions at once." };
  }
  if (/^show\s+(?:questions\s+)?one(?:\s+by\s+one)?$/i.test(label)) {
    return { label: "One", tooltip: "Show one question at a time." };
  }
  if (/^show\s+answers?$/i.test(label) || /^answers?$/i.test(label)) {
    return { label: "Answers", tooltip: "Reveal the correct answer. Revealed answers count as incorrect." };
  }
  if (/^check$/i.test(label)) return { label: "Check", tooltip: "Check your answer." };
  if (/^hint$/i.test(label)) return { label: "Hint", tooltip: "Reveal the next clue." };
  if (/^undo$/i.test(label)) return { label: "Undo", tooltip: "Undo your last change." };
  if (/^(?:restart|reset)$/i.test(label)) return { label: "Restart", tooltip: "Start this exercise again." };
  if (/^(?:<=|&lt;=|prev(?:ious)?)$/i.test(label)) {
    return { label: "Previous", tooltip: /ChangeQ\s*\(\s*-1/i.test(click) ? "Show the previous question." : "Open the previous exercise." };
  }
  if (/^(?:=>|=&gt;|next)$/i.test(label)) {
    return { label: "Next", tooltip: /ChangeQ\s*\(\s*1/i.test(click) ? "Show the next question." : "Open the next exercise." };
  }
  const progressNext = /^(\d+)\s+of\s+(\d+)\s+next$/i.exec(label);
  if (progressNext) {
    return {
      label: "Next",
      tooltip: `Open the next exercise. This is ${progressNext[1]} of ${progressNext[2]}.`,
    };
  }
  if (/^close$/i.test(label)) return { label: "Close", tooltip: "Close this exercise." };
  if (/^ok$/i.test(label)) return { label: "OK", tooltip: "Close this message." };
  return null;
}

function normalizeButtonLabels(source) {
  let next = source.replace(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi, (whole, attributes, content) => {
    const originalTag = `<button${attributes}>`;
    const openingTag = readTagAttribute(originalTag, "type").trim()
      ? originalTag
      : replaceAttribute(originalTag, "type", "button");
    if (/<[a-z!/][^>]*>/i.test(content)) return `${openingTag}${content}</button>`;
    const details = buttonLabelDetails(content, openingTag);
    if (!details) return whole;
    const currentLabel = content.replace(/\s+/g, " ").trim();
    const existingLabel = readTagAttribute(openingTag, "aria-label").trim();
    const existingTooltip = readTagAttribute(openingTag, "data-hp-tooltip").trim();
    const tooltip = currentLabel === details.label && existingLabel === details.label && existingTooltip
      ? existingTooltip
      : details.tooltip;
    let nextTag = replaceAttribute(openingTag, "aria-label", details.label);
    nextTag = replaceAttribute(nextTag, "data-hp-tooltip", tooltip);
    nextTag = replaceAttribute(nextTag, "aria-description", tooltip);
    return `${nextTag}${details.label}</button>`;
  });
  next = next.replace(/<input\b[^>]*>/gi, (tag) => {
    const inputType = readTagAttribute(tag, "type").toLowerCase();
    if (!["button", "submit", "reset"].includes(inputType)) return tag;
    const value = readTagAttribute(tag, "value");
    const details = buttonLabelDetails(value, tag);
    if (!details) return tag;
    const existingLabel = readTagAttribute(tag, "aria-label").trim();
    const existingTooltip = readTagAttribute(tag, "data-hp-tooltip").trim();
    const tooltip = value.replace(/\s+/g, " ").trim() === details.label && existingLabel === details.label && existingTooltip
      ? existingTooltip
      : details.tooltip;
    let normalized = replaceAttribute(tag, "value", details.label);
    normalized = replaceAttribute(normalized, "aria-label", details.label);
    normalized = replaceAttribute(normalized, "data-hp-tooltip", tooltip);
    return replaceAttribute(normalized, "aria-description", tooltip);
  });
  next = next
    .replace(/(ShowAllQuestionsCaption\s*=\s*["'])Show all(?: questions)?(["'])/gi, "$1All$2")
    .replace(/(ShowOneByOneCaption\s*=\s*["'])Show (?:questions )?one(?: by one)?(["'])/gi, "$1One$2");
  return next;
}

function normalizePage(page, options) {
  const { root, cssIntegrity, uiIntegrity, storyIntegrity } = options;
  const originalStyles = extractHeadStyleBlocks(page.source);
  const runtime = collectRuntimePatches(page.source, { file: page.relative });
  let source = applyPatches(page.source, runtime.patches);
  const markup = transformMarkup(source, page.relative);
  source = normalizeButtonLabels(markup.source);
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
      result.adsMoved += plan.result.counters.adsMoved;
      result.answerFields += plan.result.counters.answerFields;
      result.animatedButtons += plan.result.counters.animatedButtons;
      result.styleAttributes += plan.result.counters.styleAttributes;
      result.buttons += plan.result.counters.buttons;
      result.closeButtons += plan.result.counters.closeButtons;
      result.closeLinks += plan.result.counters.closeLinks;
      result.emptyFeedbackPanelsHidden += plan.result.counters.emptyFeedbackPanelsHidden;
      result.horizontalRules += plan.result.counters.horizontalRules;
      result.legacyHandlers += plan.result.counters.legacyHandlers;
      result.runtimeButtonFunctions += plan.result.stats.buttonFunctions;
      result.runtimeReads += plan.result.stats.reads;
      result.runtimeWrites += plan.result.stats.writes;
      result.titleHeadingsNormalized += plan.result.counters.titleHeadingsNormalized;
      result.titlePanelsWrapped += plan.result.counters.titlePanelsWrapped;
      return result;
    },
    {
      adsMoved: 0,
      answerFields: 0,
      animatedButtons: 0,
      buttons: 0,
      closeButtons: 0,
      closeLinks: 0,
      emptyFeedbackPanelsHidden: 0,
      horizontalRules: 0,
      legacyHandlers: 0,
      runtimeButtonFunctions: 0,
      runtimeReads: 0,
      runtimeWrites: 0,
      styleAttributes: 0,
      titleHeadingsNormalized: 0,
      titlePanelsWrapped: 0,
    },
  );

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Hot Potatoes pages: ${inventory.pages.length}`);
  console.log(`Pages with companion stories: ${inventory.pages.filter((page) => page.story).length}`);
  console.log(`Unmapped companion stories: ${inventory.unmapped.length}`);
  console.log(`Ambiguous Hot Potatoes files: ${inventory.ambiguous.length}`);
  console.log(`Interstitial ad slots moved before instruction panels: ${totals.adsMoved}`);
  if (inventory.skippedBackups.length) console.log(`Saved -bu copies excluded: ${inventory.skippedBackups.length}`);
  console.log(`Would change: ${changed.length} pages`);
  console.log(`Inline style attributes: ${totals.styleAttributes}`);
  console.log(`ShortAnswer fields given accessible names: ${totals.answerFields}`);
  console.log(`Buttons normalized: ${totals.buttons}`);
  console.log(`Animated functional buttons normalized: ${totals.animatedButtons}`);
  console.log(`Special Close buttons normalized: ${totals.closeButtons}`);
  console.log(`JavaScript Close links migrated to buttons: ${totals.closeLinks}`);
  console.log(`Empty feedback panels hidden until feedback: ${totals.emptyFeedbackPanelsHidden}`);
  console.log(`Horizontal rules removed: ${totals.horizontalRules}`);
  console.log(`Title heading levels normalized to h1: ${totals.titleHeadingsNormalized}`);
  console.log(`Titles moved into instruction panels: ${totals.titlePanelsWrapped}`);
  console.log(`Legacy hover handlers removed: ${totals.legacyHandlers}`);
  console.log(`Legacy runtime button-state functions neutralized: ${totals.runtimeButtonFunctions}`);
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

  const scanned = scanTargets(args.root, args.scopes.length ? args.scopes : ROOTS);
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
