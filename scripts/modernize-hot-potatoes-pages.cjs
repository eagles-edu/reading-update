#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");
const parse5 = require("parse5");
const { createBackupManager } = require("./write-backup.cjs");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const MAX_SAFE_APPLY_PAGES = 50;
const CURRENT_MODERNIZATION_VERSION = "2026-09-15.2";
const POST_CONVERSION_VERIFIED_FAMILIES = new Set(["cloze", "dict", "sent"]);
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
  "writing",
]);
const SHARED_CSS = "css/sis-hot-potatoes.css";
const SHARED_UI = "js/hot-potatoes-ui.js";
const FEEDBACK_CSS = "css/hot-potatoes-feedback.css";
const FEEDBACK_UI = "js/hot-potatoes-feedback.js";
const STORY_THEME = "js/story-theme.js";
const PAGE_PROFILES = Object.freeze({
  shared: Object.freeze({
    family: "shared",
    prototype: "begin1/cloze/b1cloze001.html",
    required: ["body#TheBody", "meta[name=viewport]", ".hp-instructions-panel", "h1.ExerciseTitle", "#InstructionsDiv", "#MainDiv", ".btn-74"],
    assets: [
      ["link", SHARED_CSS],
      ["script", SHARED_UI],
      ["link", FEEDBACK_CSS],
      ["script", FEEDBACK_UI],
      ["script", STORY_THEME],
    ],
  }),
  cloze: Object.freeze({
    family: "cloze",
    prototype: "begin1/cloze/b1cloze001.html",
    required: ["body#TheBody", "body#TheBody > .wrapfit", "body#TheBody > .hp-exercise-shell", "body#TheBody > [data-sis-exercise-shell]", "meta[name=viewport]", "meta[name=sis-cloze-prototype]", ".hp-instructions-panel", ".hp-instructions-panel > .Titles > h1.ExerciseTitle", "#InstructionsDiv", "#MainDiv", "#ClozeDiv", "#FeedbackDiv", ".btn17Container", ".btn-74", "input[id^=Gap]"],
    assets: [
      ["link", SHARED_CSS],
      ["script", SHARED_UI],
      ["link", FEEDBACK_CSS],
      ["script", FEEDBACK_UI],
      ["script", STORY_THEME],
      ["link", "css/sis-cloze-submit.css"],
      ["script", "js/sis-cloze-submit.js"],
    ],
  }),
  dict: Object.freeze({
    family: "dict",
    prototype: "begin1/dict/b1d001.html",
    required: ["body#TheBody", "body#TheBody > .wrapfit", "body#TheBody > .hp-exercise-shell", "body#TheBody > [data-sis-exercise-shell]", "meta[name=viewport]", ".hp-instructions-panel", ".hp-instructions-panel > .Titles > h1.ExerciseTitle", "#InstructionsDiv", "#MainDiv", "#FeedbackDiv", ".btn-74"],
    assets: [
      ["link", SHARED_CSS],
      ["script", SHARED_UI],
      ["link", FEEDBACK_CSS],
      ["script", FEEDBACK_UI],
      ["script", STORY_THEME],
      ["link", "css/sis-exercise-layout.css"],
      ["link", "css/sis-cloze-submit.css"],
      ["link", "css/sis-exercise-family-layout.css"],
      ["script", "js/sis-exercise-submit.js", "dict"],
    ],
  }),
  sent: Object.freeze({
    family: "sent",
    prototype: "begin1/sent/b1mx00101.html",
    required: ["body#TheBody", "body#TheBody > .wrapfit", "body#TheBody > .hp-exercise-shell", "body#TheBody > [data-sis-exercise-shell]", "meta[name=viewport]", ".hp-instructions-panel", ".hp-instructions-panel > .Titles > h1.ExerciseTitle", "#InstructionsDiv", "#MainDiv", "#FeedbackDiv", ".btn-74"],
    assets: [
      ["link", SHARED_CSS],
      ["script", SHARED_UI],
      ["link", FEEDBACK_CSS],
      ["script", FEEDBACK_UI],
      ["script", STORY_THEME],
      ["link", "css/sis-exercise-layout.css"],
      ["link", "css/sis-cloze-submit.css"],
      ["link", "css/sis-exercise-family-layout.css"],
      ["script", "js/sis-exercise-submit.js", "sent"],
    ],
  }),
});
const STYLE_CLASS = Object.freeze({
  "display:none": "hp-display-none",
  "display:block": "hp-display-block",
  "display:inline": "hp-display-inline",
  "visibility:hidden": "hp-visibility-hidden",
  "visibility:visible": "hp-visibility-visible",
});
const MANAGED_ASSETS_RE = /(?:\r?\n)?[ \t]*<!--[ \t]*HOT POTATOES MODERNIZATION ASSETS START[ \t]*-->[\s\S]*?<!--[ \t]*HOT POTATOES MODERNIZATION ASSETS END[ \t]*-->[ \t]*(?:\r?\n)?/i;
const MANAGED_STYLES_RE = /(?:\r?\n)?[ \t]*<!--[ \t]*HOT POTATOES MODERNIZATION STYLES START[ \t]*-->[\s\S]*?<!--[ \t]*HOT POTATOES MODERNIZATION STYLES END[ \t]*-->[ \t]*(?:\r?\n)?/i;
const MODERNIZATION_VERSION_RE = /[ \t]*<!--[ \t]*HOT POTATOES MODERNIZATION VERSION:[ \t]*([^\r\n]*?)[ \t]*-->[ \t]*(?:\r?\n)?/gi;
const SUBMISSION_ASSET_SOURCE_CACHE = new Map();
const REQUIRED_IDENTITY_PANEL_COPY =
  "Enter your EaglesID and student email to activate Check and Hint.";

function modernizationProfile(page) {
  if (page.feedbackOnly) {
    return {
      family: "feedback",
      prototype: "shared-feedback-contract",
      required: ["#FeedbackDiv", "#FeedbackContent"],
      assets: [["link", FEEDBACK_CSS], ["script", FEEDBACK_UI]],
    };
  }
  const segments = path.dirname(page.relative).split("/");
  const directory = segments.at(-1).toLowerCase();
  if (segments.some((segment) => /cloze/i.test(segment))) return PAGE_PROFILES.cloze;
  if (directory === "dict") return PAGE_PROFILES.dict;
  if (["sent", "emx", "kemx", "semx"].includes(directory)) return PAGE_PROFILES.sent;
  return PAGE_PROFILES.shared;
}

function modernizationVersionValue(profile, story) {
  const storyPath = story?.relative || "none";
  return `version=${CURRENT_MODERNIZATION_VERSION}; family=${profile.family}; prototype=${profile.prototype}; story=${storyPath}`;
}

function hasCurrentModernizationVersion(source, profile, story) {
  const markers = [...source.matchAll(MODERNIZATION_VERSION_RE)];
  return markers.length === 1 && markers[0][1].trim() === modernizationVersionValue(profile, story);
}

function modernizationVersionComment(profile, story) {
  return `<!-- HOT POTATOES MODERNIZATION VERSION: ${modernizationVersionValue(profile, story)} -->`;
}

function selectorPresent(source, selector) {
  source = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const metaName = /^meta\[name=([\w-]+)\]$/i.exec(selector);
  if (metaName) {
    const tags = source.match(/<meta\b[^>]*>/gi) || [];
    if (metaName[1].toLowerCase() === "viewport") {
      return tags.some((tag) =>
        readTagAttribute(tag, "name").toLowerCase() === "viewport" &&
        /width\s*=\s*device-width/i.test(readTagAttribute(tag, "content")) &&
        /initial-scale\s*=\s*1(?:\.0)?(?:\s|$|,)/i.test(readTagAttribute(tag, "content")),
      );
    }
    if (metaName[1].toLowerCase() === "sis-cloze-prototype") {
      return tags.some((tag) =>
        readTagAttribute(tag, "name").toLowerCase() === "sis-cloze-prototype" &&
        readTagAttribute(tag, "content").toLowerCase() === "current",
      );
    }
    return tags.some((tag) => readTagAttribute(tag, "name").toLowerCase() === metaName[1].toLowerCase());
  }
  if (selector === "body#TheBody") return /<body\b[^>]*\bid\s*=\s*(["'])TheBody\1/i.test(source);
  if (["body#TheBody > .wrapfit", "body#TheBody > .wrapit", "body#TheBody > .exercise-wrapper", "body#TheBody > .hp-exercise-shell", "body#TheBody > [data-sis-exercise-shell]"].includes(selector)) {
    const body = /<body\b[^>]*\bid\s*=\s*(["'])TheBody\1[^>]*>/i.exec(source);
    if (!body) return false;
    const tail = source.slice(body.index + body[0].length).replace(/^(?:\s+|<!--[\s\S]*?-->)+/, "");
    const wrapper = /^<div\b[^>]*>/i.exec(tail);
    if (!wrapper) return false;
    const classes = readTagAttribute(wrapper[0], "class").split(/\s+/);
    if (selector.endsWith(".wrapfit")) return classes.includes("wrapfit");
    if (selector.endsWith(".wrapit")) return classes.includes("wrapit");
    if (selector.endsWith(".hp-exercise-shell")) return classes.includes("hp-exercise-shell");
    if (selector.endsWith("[data-sis-exercise-shell]")) return /\sdata-sis-exercise-shell(?:\s*=|\s|>)/i.test(wrapper[0]);
    return classes.includes("exercise-wrapper");
  }
  if (selector === ".hp-instructions-panel > .Titles > h1.ExerciseTitle") {
    return /<div\b[^>]*class\s*=\s*(["'])[^"']*\bhp-instructions-panel\b[^"']*\1[^>]*>\s*<div\b[^>]*class\s*=\s*(["'])[^"']*\bTitles\b[^"']*\2[^>]*>\s*<h1\b[^>]*class\s*=\s*(["'])[^"']*\bExerciseTitle\b[^"']*\3/i.test(source);
  }
  if (selector === ".hp-instructions-panel") return /\bclass\s*=\s*(["'])[^"']*\bhp-instructions-panel\b[^"']*\1/i.test(source);
  if (selector === "h1.ExerciseTitle") return /<h1\b[^>]*\bclass\s*=\s*(["'])[^"']*\bExerciseTitle\b[^"']*\1/i.test(source);
  if (selector === ".btn17Container") return /\bclass\s*=\s*(["'])[^"']*\bbtn17Container\b[^"']*\1/i.test(source);
  if (selector === "input[id^=Gap]") return clozeGapInputIds(source).length > 0;
  if (selector === ".btn-74") return /\bclass\s*=\s*(["'])[^"']*\bbtn-74\b[^"']*\1/i.test(source);
  if (/^#[\w-]+$/.test(selector)) return new RegExp(`\\bid\\s*=\\s*(["'])${selector.slice(1)}\\1`, "i").test(source);
  return false;
}

function clozeGapInputIds(source) {
  const markup = source.replace(/<!--[\s\S]*?-->/g, "");
  const inputs = [...markup.matchAll(/<input\b[^>]*>/gi)];
  return [...new Set(inputs
    .map(([tag]) => readTagAttribute(tag, "id"))
    .filter((id) => /^Gap\d+$/i.test(id)))];
}

function missingClozeGapLabels(source) {
  const markup = source.replace(/<!--[\s\S]*?-->/g, "");
  return clozeGapInputIds(source).filter((id) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*(["'])${escapedId}\\1`, "i").test(markup);
  });
}

function sourceRequirementGaps(source, profile) {
  const requiredSelectors = [
    ...profile.required,
    ...(profile.postConversionRequired || []),
  ];
  const gaps = requiredSelectors
    .filter((selector) => !selectorPresent(source, selector))
    .map((selector) => `selector ${selector}`);
  if (profile.family === "cloze") {
    const unlabeled = missingClozeGapLabels(source);
    if (unlabeled.length) gaps.push(`labels for ${unlabeled.join(", ")}`);
  }
  return gaps;
}

function htmlElements(root, output = []) {
  if (!root || typeof root !== "object") return output;
  if (root.tagName) output.push(root);
  for (const child of root.childNodes || []) htmlElements(child, output);
  if (root.content) htmlElements(root.content, output);
  return output;
}

function htmlAttribute(node, name) {
  return node?.attrs?.find((attribute) => attribute.name === name.toLowerCase())?.value || "";
}

function htmlClasses(node) {
  return htmlAttribute(node, "class").split(/\s+/).filter(Boolean);
}

function nodeText(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(nodeText).join("");
}

function nodeContains(parent, target) {
  for (let current = target; current; current = current.parentNode) {
    if (current === parent) return true;
  }
  return false;
}

function parseUrlAttribute(value) {
  try {
    const url = new URL(value, "https://sis-local.invalid/");
    if (url.origin !== "https://sis-local.invalid") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function resolvePageAsset(root, pageFile, value) {
  let absolute;
  try {
    const pageRelative = path.relative(path.resolve(root), path.resolve(pageFile)).split(path.sep).join("/");
    const pageUrl = new URL(pageRelative, "https://sis-local.invalid/");
    const assetUrl = new URL(value, pageUrl);
    if (assetUrl.origin !== "https://sis-local.invalid") return null;
    absolute = path.resolve(root, "." + decodeURIComponent(assetUrl.pathname));
  } catch {
    return null;
  }
  const relative = path.relative(path.resolve(root), absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return absolute;
}

function requirement(id, description, passed, evidence) {
  return { id, description, pass: Boolean(passed), evidence };
}

function assetRequirement(source, root, page, type, assetPath, family, parsedElements = null) {
  const elements = parsedElements || htmlElements(parse5.parse(source));
  const head = elements.find((element) => element.tagName === "head");
  const expected = path.resolve(root, assetPath);
  const expectedIntegrity = fs.existsSync(expected) ? integrityFor(expected) : "";
  const tagName = type === "link" ? "link" : "script";
  const attrName = type === "link" ? "href" : "src";
  const candidates = elements.filter((element) => {
    if (element.tagName !== tagName || !nodeContains(head, element)) return false;
    if (type === "link" && !htmlAttribute(element, "rel").split(/\s+/).includes("stylesheet")) return false;
    return resolvePageAsset(root, page.absolute, htmlAttribute(element, attrName)) === expected;
  });
  const familyMatches = candidates.filter((element) => !family || htmlAttribute(element, "data-sis-exercise-family") === family);
  const valid = familyMatches.filter((element) => htmlAttribute(element, "integrity") === expectedIntegrity);
  const ok = Boolean(expectedIntegrity) && familyMatches.length === 1 && valid.length === 1;
  const observed = candidates.map((element) => ({
    url: htmlAttribute(element, attrName),
    family: htmlAttribute(element, "data-sis-exercise-family") || null,
    integrity: htmlAttribute(element, "integrity") || null,
  }));
  return requirement(
    `ASSET-${assetPath.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase()}`,
    `Local ${type} ${assetPath} resolves and has current SRI${family ? ` for ${family}` : ""}`,
    ok,
    { expectedIntegrity: expectedIntegrity || null, observed },
  );
}

function auditMmor(source, root, page, profile, options = {}) {
  const document = parse5.parse(source);
  const elements = htmlElements(document);
  const byId = new Map();
  for (const element of elements) {
    const id = htmlAttribute(element, "id");
    if (id) byId.set(id, [...(byId.get(id) || []), element]);
  }
  const bodies = elements.filter((element) => element.tagName === "body" && htmlAttribute(element, "id") === "TheBody");
  const body = bodies[0] || null;
  const bodyChildren = (body?.childNodes || []).filter((node) => node.tagName);
  const directWrapperCandidates = bodyChildren.filter((node) =>
    ["wrapfit", "wrapit", "exercise-wrapper"].some((className) => htmlClasses(node).includes(className)),
  );
  const wrapper = directWrapperCandidates.find((node) => htmlClasses(node).includes("wrapfit")) || null;
  const nestedWrapperCandidates = wrapper
    ? elements.filter((node) => node !== wrapper && nodeContains(wrapper, node) &&
      ["wrapfit", "wrapit", "exercise-wrapper"].some((className) => htmlClasses(node).includes(className)))
    : [];
  const instructionPanel = elements.find((element) => htmlClasses(element).includes("hp-instructions-panel"));
  const titles = instructionPanel && (instructionPanel.childNodes || []).find((node) => node.tagName && htmlClasses(node).includes("Titles"));
  const exerciseTitle = titles && (titles.childNodes || []).find((node) => node.tagName === "h1" && htmlClasses(node).includes("ExerciseTitle"));
  const instructions = byId.get("InstructionsDiv") || [];
  const main = byId.get("MainDiv") || [];
  const feedback = byId.get("FeedbackDiv") || [];
  const gapInputs = elements.filter((element) => element.tagName === "input" && /^Gap\d+$/i.test(htmlAttribute(element, "id")));
  const gapLabels = elements.filter((element) => element.tagName === "label").map((element) => htmlAttribute(element, "for"));
  const closeControls = elements.filter((element) =>
    element.tagName === "button" && htmlClasses(element).includes("btn-74") &&
    Object.hasOwn(element.attrs?.reduce((attrs, item) => ({ ...attrs, [item.name]: item.value }), {}) || {}, "data-hp-close"),
  );
  const story = page.story;
  const results = [];
  const push = (item) => results.push(item);

  push(requirement("SH-01", "body#TheBody exists exactly once", bodies.length === 1 && byId.get("TheBody")?.length === 1,
    { count: bodies.length, idCount: byId.get("TheBody")?.length || 0 }));
  const viewport = elements.find((element) => element.tagName === "meta" && htmlAttribute(element, "name").toLowerCase() === "viewport");
  const viewportContent = htmlAttribute(viewport, "content");
  push(requirement("SH-02", "Viewport declares device width and initial scale 1", /(?:^|,)\s*width\s*=\s*device-width(?:\s*,|$)/i.test(viewportContent) && /(?:^|,)\s*initial-scale\s*=\s*1(?:\.0)?(?:\s*,|$)/i.test(viewportContent),
    { content: viewportContent || null }));
  push(requirement("SH-03", "Instruction panel contains .Titles > h1.ExerciseTitle and #InstructionsDiv; #MainDiv is unique in the wrapper", Boolean(instructionPanel && titles && exerciseTitle && instructions.length === 1 && nodeContains(instructionPanel, instructions[0]) && main.length === 1 && wrapper && nodeContains(wrapper, main[0])),
    { instructionPanels: elements.filter((element) => htmlClasses(element).includes("hp-instructions-panel")).length, titleFound: Boolean(exerciseTitle), instructions: instructions.length, main: main.length }));
  const closeAccessible = closeControls.some((element) =>
    htmlAttribute(element, "type").toLowerCase() === "button" &&
    (htmlAttribute(element, "aria-label").trim() || htmlAttribute(element, "title").trim() || nodeText(element).trim()),
  );
  const sharedUiPath = path.resolve(root, SHARED_UI);
  if (!SUBMISSION_ASSET_SOURCE_CACHE.has(sharedUiPath)) {
    SUBMISSION_ASSET_SOURCE_CACHE.set(sharedUiPath, fs.existsSync(sharedUiPath) ? fs.readFileSync(sharedUiPath, "utf8") : "");
  }
  const sharedUiSource = SUBMISSION_ASSET_SOURCE_CACHE.get(sharedUiPath);
  const closeRuntime = sharedUiSource.includes('document.addEventListener("click", closeExerciseFromButton)') &&
    sharedUiSource.includes("[data-hp-close]");
  push(requirement("SH-04", "Close is an accessible btn-74 button handled by the shared Close runtime", closeAccessible && closeRuntime,
    { count: closeControls.length, accessible: closeAccessible, runtimeBound: closeRuntime }));

  const storyThemeScripts = elements.filter((element) => element.tagName === "script" && /(?:^|\/)story-theme\.js(?:[?#]|$)/i.test(htmlAttribute(element, "src")));
  const storyScript = storyThemeScripts.find((element) => resolvePageAsset(root, page.absolute, htmlAttribute(element, "data-story-title-url")) === story?.absolute);
  const storyThemePath = path.resolve(root, STORY_THEME);
  if (!SUBMISSION_ASSET_SOURCE_CACHE.has(storyThemePath)) {
    SUBMISSION_ASSET_SOURCE_CACHE.set(storyThemePath, fs.existsSync(storyThemePath) ? fs.readFileSync(storyThemePath, "utf8") : "");
  }
  const storyThemeSource = SUBMISSION_ASSET_SOURCE_CACHE.get(storyThemePath);
  const storyRuntime = storyThemeSource.includes("function readStoryTitle") &&
    storyThemeSource.includes("titleNode.textContent = title") &&
    storyThemeSource.includes('root.setAttribute("data-story-theme"');
  push(requirement("SH-05", "Companion story resolves and story-theme.js binds its title and theme at runtime", Boolean(story && fs.existsSync(story.absolute) && storyThemeScripts.length === 1 && storyScript && htmlAttribute(storyScript, "data-story-theme-key") === story.key && storyRuntime),
    { story: story?.relative || null, scriptCount: storyThemeScripts.length, titleUrl: htmlAttribute(storyScript, "data-story-title-url") || null, themeKey: htmlAttribute(storyScript, "data-story-theme-key") || null, runtimeBound: storyRuntime }));

  const assetChecks = [];
  for (const [type, assetPath, family] of profile.assets) {
    const item = assetRequirement(source, root, page, type, assetPath, family, elements);
    if (type === "link" && assetPath === "css/sis-cloze-submit.css") item.id = "ASSET-CLOZE-SUBMIT-CSS";
    if (type === "script" && assetPath === "js/sis-cloze-submit.js") item.id = "ASSET-CLOZE-SUBMIT-JS";
    if (type === "script" && assetPath === "js/sis-exercise-submit.js") item.id = `ASSET-EXERCISE-SUBMIT-${profile.family.toUpperCase()}`;
    assetChecks.push(item);
    push(item);
  }
  push(requirement("SH-06", "Every required shared and family asset resolves locally with its current SRI", assetChecks.every((item) => item.pass),
    { required: assetChecks.length, failed: assetChecks.filter((item) => !item.pass).map((item) => item.id) }));

  const identityAsset = profile.family === "cloze" ? "js/sis-cloze-submit.js" : "js/sis-exercise-submit.js";
  const absoluteIdentityAsset = path.resolve(root, identityAsset);
  if (!SUBMISSION_ASSET_SOURCE_CACHE.has(absoluteIdentityAsset)) {
    SUBMISSION_ASSET_SOURCE_CACHE.set(absoluteIdentityAsset, fs.existsSync(absoluteIdentityAsset) ? fs.readFileSync(absoluteIdentityAsset, "utf8") : "");
  }
  const identitySource = SUBMISSION_ASSET_SOURCE_CACHE.get(absoluteIdentityAsset);
  const eaglesIdMarker = profile.family === "cloze" ? "data-sis-cloze-eagles-id" : "data-sis-exercise-eagles-id";
  const emailMarker = profile.family === "cloze" ? "data-sis-cloze-email" : "data-sis-exercise-email";
  const identityCopy = identitySource.includes(REQUIRED_IDENTITY_PANEL_COPY);
  const identityFields = identitySource.includes(eaglesIdMarker) && identitySource.includes(emailMarker);
  const identityGuard = profile.family === "cloze"
    ? identitySource.includes("guardCheckAnswers") && identitySource.includes("guardShowHint") &&
      identitySource.includes("!isIdentityReady()") && identitySource.includes("!identityReady")
    : identitySource.includes('wrapAction("CheckAnswer"') && identitySource.includes('wrapAction("ShowHint"') &&
      identitySource.includes('wrapAction("CheckShortAnswer"') && identitySource.includes("if (!identityIsValid())") &&
      identitySource.includes("button.disabled = disabled");
  push(requirement("ID-01", "EaglesID and student email are required by runtime Check and Hint guards", identityCopy && identityFields && identityGuard,
    { asset: identityAsset, instructionFound: identityCopy, eaglesIdField: identitySource.includes(eaglesIdMarker), emailField: identitySource.includes(emailMarker), checkAndHintGuarded: identityGuard }));

  if (profile.family === "cloze") {
    const clozeDiv = byId.get("ClozeDiv") || [];
    const actionRows = elements.filter((element) => htmlClasses(element).includes("btn17Container"));
    const gapIds = gapInputs.map((element) => htmlAttribute(element, "id"));
    push(requirement("CL-01", "Direct body wrapper has .wrapfit and the cloze family marker", Boolean(wrapper && htmlAttribute(wrapper, "data-sis-exercise-family") === "cloze"),
      { wrapperTag: wrapper?.tagName || null, classes: wrapper ? htmlClasses(wrapper) : [], family: htmlAttribute(wrapper, "data-sis-exercise-family") || null }));
    push(requirement("CL-02", "sis-cloze-prototype marker is current", elements.some((element) => element.tagName === "meta" && htmlAttribute(element, "name").toLowerCase() === "sis-cloze-prototype" && htmlAttribute(element, "content").toLowerCase() === "current"), {}));
    push(requirement("CL-03", "Unique ClozeDiv and FeedbackDiv are inside MainDiv/wrapper", clozeDiv.length === 1 && feedback.length === 1 && main.length === 1 && nodeContains(main[0], clozeDiv[0]) && nodeContains(wrapper, feedback[0]),
      { clozeDiv: clozeDiv.length, feedbackDiv: feedback.length }));
    push(requirement("CL-04", "btn17Container is inside MainDiv", actionRows.length >= 1 && main.length === 1 && actionRows.some((row) => nodeContains(main[0], row)),
      { actionRows: actionRows.length }));
    push(requirement("CL-05", "At least one unique GapN input has a matching label", gapIds.length > 0 && new Set(gapIds).size === gapIds.length && gapIds.every((id) => gapLabels.includes(id)),
      { gaps: gapIds, missingLabels: gapIds.filter((id) => !gapLabels.includes(id)) }));
  } else if (["dict", "sent"].includes(profile.family)) {
    const textareas = elements.filter((element) => element.tagName === "textarea" &&
      (htmlClasses(element).includes("ShortAnswerBox") || /_Guess$/i.test(htmlAttribute(element, "id"))));
    const namedTextareas = textareas.filter((element) => {
      if (htmlAttribute(element, "aria-label").trim() || htmlAttribute(element, "title").trim()) return true;
      const labelledBy = htmlAttribute(element, "aria-labelledby").split(/\s+/).filter(Boolean);
      if (labelledBy.length && labelledBy.every((id) => byId.has(id))) return true;
      const fieldId = htmlAttribute(element, "id");
      return elements.some((candidate) => candidate.tagName === "label" && htmlAttribute(candidate, "for") === fieldId) ||
        (function hasLabelAncestor() { for (let parent = element.parentNode; parent; parent = parent.parentNode) if (parent.tagName === "label") return true; return false; })();
    });
    push(requirement(profile.family === "dict" ? "DI-01" : "SE-01", "Direct body wrapper is canonical .wrapfit with the correct family marker", Boolean(wrapper && htmlAttribute(wrapper, "data-sis-exercise-family") === profile.family),
      { wrapperTag: wrapper?.tagName || null, classes: wrapper ? htmlClasses(wrapper) : [], family: htmlAttribute(wrapper, "data-sis-exercise-family") || null }));
    push(requirement(profile.family === "dict" ? "DI-02" : "SE-02", "Instruction, main, and feedback IDs are unique and inside the exercise wrapper", Boolean(wrapper && [instructions, main, feedback].every((matches) => matches.length === 1 && nodeContains(wrapper, matches[0]))),
      { instructions: instructions.length, main: main.length, feedback: feedback.length }));
    push(requirement(profile.family === "dict" ? "DI-03" : "SE-03", "Every ShortAnswer textarea has an accessible name", namedTextareas.length === textareas.length,
      { total: textareas.length, named: namedTextareas.length }));
  }

  const wrapperPass = bodies.length === 1 && directWrapperCandidates.length === 1 && wrapper?.tagName === "div" &&
    htmlClasses(wrapper).includes("hp-exercise-shell") &&
    wrapper.attrs?.some((attribute) => attribute.name === "data-sis-exercise-shell") &&
    !htmlClasses(wrapper).includes("wrapit") &&
    !htmlClasses(wrapper).includes("exercise-wrapper") && nestedWrapperCandidates.length === 0;
  push(requirement("SH-10", "One direct canonical shell has .hp-exercise-shell, .wrapfit, and data-sis-exercise-shell; no legacy wrapper alias remains", wrapperPass,
    { directWrappers: directWrapperCandidates.map((node) => ({ tag: node.tagName, classes: htmlClasses(node), shell: node.attrs?.some((attribute) => attribute.name === "data-sis-exercise-shell") || false })), nestedWrappers: nestedWrapperCandidates.map((node) => ({ tag: node.tagName, classes: htmlClasses(node) })) }));

  const requiredIds = ["InstructionsDiv", "MainDiv", "FeedbackDiv", ...(profile.family === "cloze" ? ["ClozeDiv"] : [])];
  const idsUnique = requiredIds.every((id) => (byId.get(id) || []).length === 1);
  push(requirement("SH-09", "Required exercise IDs are unique", idsUnique,
    { ids: Object.fromEntries(requiredIds.map((id) => [id, byId.get(id)?.length || 0])) }));

  const styleAttributes = elements.filter((element) => Object.hasOwn(element.attrs?.reduce((attrs, item) => ({ ...attrs, [item.name]: item.value }), {}) || {}, "style")).length;
  const originalStyles = options.originalStyles || extractHeadStyleBlocks(source);
  const finalStyles = extractHeadStyleBlocks(source);
  const stylesPreserved = originalStyles.length === finalStyles.length && originalStyles.every((style, index) => style === finalStyles[index]);
  push(requirement("SH-08", "No inline style attributes remain and head style blocks are preserved", styleAttributes === 0 && stylesPreserved,
    { inlineStyleAttributes: styleAttributes, preservedStyleBlocks: finalStyles.length, stylesPreserved }));

  const legacyHandlerAttributes = elements.flatMap((element) => element.attrs || []).filter((attribute) =>
    /^on(?:focus|blur|mouseover|mouseout|mousedown|mouseup)$/i.test(attribute.name) &&
    /^(?:Func|Nav)Btn(?:Over|Out|Down)\s*\(/i.test(attribute.value.trim()),
  );
  const forbiddenRuntimePatterns = /\.\s*style\s*\.\s*(?:display|visibility)\s*(?:=|\+=|-=)/i;
  const uiVisibilityContract = sharedUiSource.includes("function HPSetDisplay") &&
    sharedUiSource.includes("function HPGetDisplay") &&
    sharedUiSource.includes("hp-display-none") &&
    sharedUiSource.includes("hp-visibility-hidden");
  const runtimePatternsNormalized = !forbiddenRuntimePatterns.test(source) && legacyHandlerAttributes.length === 0 && uiVisibilityContract;
  const feedbackRuntime = identitySource.includes('feedbackRegion.classList.add("hp-display-none")') &&
    identitySource.includes('feedbackRegion.classList.toggle("hp-display-none", isHidden)') &&
    identitySource.includes("new window.MutationObserver");
  const sentenceGuessVisibility = profile.family !== "sent" || (
    identitySource.includes('guess.classList.toggle(') &&
    identitySource.includes('"hp-display-none"') &&
    identitySource.includes("state.guessObserver.observe(guess")
  );
  push(requirement("SH-07", "Visibility uses shared classes, legacy handlers are removed, and empty feedback and sentence answer panels stay hidden", runtimePatternsNormalized && feedbackRuntime && sentenceGuessVisibility,
    { legacyVisibilityWritesRemain: !runtimePatternsNormalized, legacyHandlerCount: legacyHandlerAttributes.length, sharedVisibilityRuntime: uiVisibilityContract, emptyFeedbackHiddenByRuntime: feedbackRuntime, emptySentenceAnswerHiddenByRuntime: sentenceGuessVisibility }));

  if (new Set(results.map((item) => item.id)).size !== results.length) {
    throw new Error(page.relative + ": internal MMOR requirement IDs are not unique");
  }
  const allPassed = results.every((item) => item.pass);
  return { allPassed, results };
}

function directWrapperSnapshot(source) {
  const document = parse5.parse(source);
  const elements = htmlElements(document);
  const bodies = elements.filter((element) => element.tagName === "body" && htmlAttribute(element, "id") === "TheBody");
  const body = bodies[0] || null;
  const directChildren = (body?.childNodes || []).filter((node) => node.tagName);
  const wrapperChildren = directChildren.filter((node) =>
    htmlClasses(node).some((className) => ["wrapfit", "wrapit", "exercise-wrapper", "cenmar"].includes(className)),
  );
  const primary = wrapperChildren[0] || directChildren[0] || null;
  const nestedWrappers = elements.filter((node) =>
    body && node !== body && !directChildren.includes(node) && nodeContains(body, node) &&
    ["wrapfit", "wrapit", "exercise-wrapper"].some((className) => htmlClasses(node).includes(className)),
  );
  const firstIsCandidate = Boolean(directChildren[0] && wrapperChildren.includes(directChildren[0]));
  let classification = "unknown-direct-wrapper";
  if (bodies.length !== 1) classification = "missing-or-duplicate-body";
  else if (directChildren.length === 0) classification = "missing-wrapper";
  else if (wrapperChildren.length > 1) classification = "duplicate-direct-wrappers";
  else if (nestedWrappers.length > 0) classification = "nested-wrapper";
  else if (!firstIsCandidate) classification = "unknown-direct-wrapper";
  else if (htmlClasses(primary).includes("wrapfit") && htmlClasses(primary).includes("wrapit")) classification = "wrapfit-and-wrapit";
  else if (htmlClasses(primary).includes("wrapfit")) classification = "wrapfit";
  else if (htmlClasses(primary).includes("wrapit")) classification = "wrapit";
  else if (htmlClasses(primary).includes("exercise-wrapper")) classification = "prior-exercise-wrapper";
  else if (htmlClasses(primary).includes("cenmar")) classification = "legacy-cenmar-shell";
  return {
    bodyFound: bodies.length === 1,
    bodyCount: bodies.length,
    directElementCount: directChildren.length,
    wrapperCandidateCount: wrapperChildren.length,
    classification,
    directChildren: directChildren.map((node) => ({
      tag: node.tagName,
      id: htmlAttribute(node, "id") || null,
      classes: htmlClasses(node),
      family: htmlAttribute(node, "data-sis-exercise-family") || null,
    })),
    wrappers: wrapperChildren.map((node) => ({
      tag: node.tagName,
      id: htmlAttribute(node, "id") || null,
      classes: htmlClasses(node),
      family: htmlAttribute(node, "data-sis-exercise-family") || null,
    })),
    nestedWrappers: nestedWrappers.map((node) => ({
      tag: node.tagName,
      id: htmlAttribute(node, "id") || null,
      classes: htmlClasses(node),
      family: htmlAttribute(node, "data-sis-exercise-family") || null,
    })),
    tag: primary?.tagName || null,
    id: htmlAttribute(primary, "id") || null,
    classes: primary ? htmlClasses(primary) : [],
    family: htmlAttribute(primary, "data-sis-exercise-family") || null,
  };
}

function classifyPageChanges(source, updated) {
  const sourceVersion = [...source.matchAll(MODERNIZATION_VERSION_RE)].map((match) => match[1].trim());
  const updatedVersion = [...updated.matchAll(MODERNIZATION_VERSION_RE)].map((match) => match[1].trim());
  const sourceSri = [...source.matchAll(/\bintegrity\s*=\s*(["'])([^"']*)\1/gi)].map((match) => match[2]);
  const updatedSri = [...updated.matchAll(/\bintegrity\s*=\s*(["'])([^"']*)\1/gi)].map((match) => match[2]);
  const stripManagedMetadata = (value) => removeModernizationVersionMarkers(value).replace(/\s+integrity\s*=\s*(["'])[^"']*\1/gi, " integrity=\"__SRI__\"");
  const changed = source !== updated;
  const sriChanged = JSON.stringify(sourceSri) !== JSON.stringify(updatedSri);
  const versionChanged = JSON.stringify(sourceVersion) !== JSON.stringify(updatedVersion);
  const structuralChanged = stripManagedMetadata(source) !== stripManagedMetadata(updated);
  return {
    changed,
    structuralChanged,
    sriChanged,
    versionChanged,
    versionOnly: changed && !structuralChanged && !sriChanged && versionChanged,
    sriOnly: changed && !structuralChanged && sriChanged && !versionChanged,
  };
}

function assetPresent(source, type, assetPath, family) {
  const tagName = type === "link" ? "link" : "script";
  const attributeName = type === "link" ? "href" : "src";
  const head = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] || "";
  const activeHead = head.replace(/<!--[\s\S]*?-->/g, "");
  const tags = activeHead.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
  return tags.some((tag) => {
    const value = readTagAttribute(tag, attributeName).split(/[?#]/, 1)[0];
    if (value !== assetPath && !value.endsWith(`/${path.basename(assetPath)}`)) return false;
    if (family && readTagAttribute(tag, "data-sis-exercise-family") !== family) return false;
    return type !== "link" || /\brel\s*=\s*(["'])[^"']*\bstylesheet\b[^"']*\1/i.test(tag);
  });
}

function validatePageMmor(source, root, profile, relative, originalStyles = null) {
  const submissionAsset = profile.family === "cloze"
    ? "js/sis-cloze-submit.js"
    : profile.family === "dict" || profile.family === "sent"
      ? "js/sis-exercise-submit.js"
      : null;
  if (submissionAsset) {
    const absoluteAsset = path.resolve(root, submissionAsset);
    if (!SUBMISSION_ASSET_SOURCE_CACHE.has(absoluteAsset)) {
      SUBMISSION_ASSET_SOURCE_CACHE.set(
        absoluteAsset,
        fs.existsSync(absoluteAsset)
          ? fs.readFileSync(absoluteAsset, "utf8")
          : null,
      );
    }
    const assetSource = SUBMISSION_ASSET_SOURCE_CACHE.get(absoluteAsset);
    if (!assetSource || !assetSource.includes(REQUIRED_IDENTITY_PANEL_COPY)) {
      throw new Error(
        `${relative}: ID block post-conversion check failed; ${submissionAsset} must explain that EaglesID and student email activate Check and Hint.`,
      );
    }
  }
  if (POST_CONVERSION_VERIFIED_FAMILIES.has(profile.family)) {
    const absolute = path.resolve(root, relative);
    const page = { absolute, relative, story: storyTarget(root, absolute) };
    const audit = auditMmor(source, root, page, profile, { originalStyles: originalStyles || extractHeadStyleBlocks(source) });
    const failed = audit.results.filter((item) => !item.pass);
    if (failed.length) {
      const details = failed.map((item) => `${item.id} ${item.description}; observed=${JSON.stringify(item.evidence)}`);
      const error = new Error(`${relative}: MMOR failed for ${profile.family} (${details.join(" | ")})`);
      error.mmor = audit;
      throw error;
    }
    return audit;
  }

  const missingSelectors = sourceRequirementGaps(source, profile);
  const missingAssets = profile.assets.filter(([type, assetPath, family]) => !assetPresent(source, type, assetPath, family));
  if (missingSelectors.length || missingAssets.length) {
    const details = [...missingSelectors, ...missingAssets.map(([, assetPath]) => `asset ${assetPath}`)];
    throw new Error(`${relative}: SOURCE REQUIREMENTS BLOCKED (${details.join(", ")})`);
  }
  return null;
}

function removeModernizationVersionMarkers(source) {
  return source.replace(MODERNIZATION_VERSION_RE, "");
}

function compactHeadSpacing(source, newline) {
  const preserved = [];
  const placeholders = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (block) => {
    const token = `__HOT_POTATOES_HEAD_BLOCK_${preserved.length}__`;
    preserved.push(block);
    return token;
  });
  let normalized = placeholders.replace(/^[\t ]+$/gm, "");
  normalized = normalized.replace(/\r?\n(?:[\t ]*\r?\n){2,}/g, `${newline}${newline}`);
  normalized = normalized.replace(/(?:[\t ]*\r?\n){2,}(?=<!--[ \t]*HOT POTATOES MODERNIZATION STYLES START)/i, newline);
  for (let index = 0; index < preserved.length; index += 1) {
    normalized = normalized.replace(`__HOT_POTATOES_HEAD_BLOCK_${index}__`, preserved[index]);
  }
  return normalized;
}

function usage() {
  console.log(
    `Usage: node ${path.basename(process.argv[1])} [--dry-run|--apply] [--scope NAME] [--path PAGE] [--root PATH] [--report PATH]

Modernize identified Hot Potatoes HTML pages.

Options:
  --dry-run   Report planned changes without writing files (default).
  --apply     Verify backups, then write normalized pages (maximum ${MAX_SAFE_APPLY_PAGES} by default).
  --scope     Restrict the scan to one configured content root; repeatable.
  --path      Restrict the scan to one repository-relative HTML page; repeatable.
  --allow-bulk Permit more than ${MAX_SAFE_APPLY_PAGES} changed pages; requires explicit --scope.
  --allow-blocked Continue with verified pages when a page is blocked by a transformation failure. Ambiguous pages and unresolved stories still stop the run.
  --root PATH Scan a different repository root.
  --report PATH Write the complete per-page MMOR and wrapper-inventory report as JSON.
  --help      Show this help.
`,
  );
}

function parseArgs(argv) {
  const args = { allowBlocked: false, allowBulk: false, apply: false, help: false, paths: [], report: null, root: DEFAULT_ROOT, scopes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--allow-blocked") args.allowBlocked = true;
    else if (arg === "--allow-bulk") args.allowBulk = true;
    else if (arg === "--root") {
      index += 1;
      if (index >= argv.length) throw new Error("--root requires a path");
      args.root = path.resolve(argv[index]);
    } else if (arg === "--report") {
      index += 1;
      if (index >= argv.length) throw new Error("--report requires a path");
      args.report = argv[index];
    } else if (arg === "--scope") {
      index += 1;
      if (index >= argv.length) throw new Error("--scope requires a content root name");
      const scope = argv[index];
      if (!ROOTS.includes(scope)) {
        throw new Error(`--scope must be one of: ${ROOTS.join(", ")}`);
      }
      if (!args.scopes.includes(scope)) args.scopes.push(scope);
    } else if (arg === "--path") {
      index += 1;
      if (index >= argv.length) throw new Error("--path requires a repository-relative HTML page");
      const relative = argv[index].replace(/\\/g, "/");
      if (!/\.html?$/i.test(relative) || relative.startsWith("/") || relative.split("/").includes("..")) {
        throw new Error("--path must be a repository-relative .html or .htm page without .. segments");
      }
      if (!args.paths.includes(relative)) args.paths.push(relative);
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.allowBulk && !args.scopes.length) {
    throw new Error("--allow-bulk requires at least one explicit --scope");
  }
  if (args.allowBlocked && !args.scopes.length && !args.paths.length) {
    throw new Error("--allow-blocked requires at least one explicit --scope or --path");
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

function scanTargets(root, roots = ROOTS, paths = []) {
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
      if (relativeDirectory === "writing") {
        const hasFeedbackModal = /id\s*=\s*["']FeedbackDiv["']/i.test(source);
        const hasFeedbackContent = /id\s*=\s*["']FeedbackContent["']/i.test(source);
        if (!hasFeedbackModal && !hasFeedbackContent) continue;
        if (!hasFeedbackModal || !hasFeedbackContent) {
          ambiguous.push(`${relative}: feedback panel has no FeedbackContent element`);
          continue;
        }
        pages.push({ absolute, feedbackOnly: true, relative, source, story: null });
        continue;
      }
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
  if (!paths.length) return { ambiguous, pages, skippedBackups };
  const requested = new Set(paths);
  const selected = pages.filter((page) => requested.has(page.relative));
  const found = new Set(selected.map((page) => page.relative));
  for (const relative of requested) {
    if (!found.has(relative)) ambiguous.push(`${relative}: requested page is not a recognized Hot Potatoes exercise`);
  }
  return { ambiguous, pages: selected, skippedBackups };
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

function removeClasses(tag, classesToRemove) {
  const classMatch = tag.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (!classMatch) return tag;
  const remove = new Set(classesToRemove);
  const existing = (classMatch[2] ?? classMatch[3] ?? "")
    .split(/\s+/)
    .filter((className) => className && !remove.has(className));
  if (!existing.length) return tag.replace(classMatch[0], "");
  return tag.replace(classMatch[0], ` class="${escapeAttribute(existing.join(" "))}"`);
}

function setTagAttribute(tag, name, value) {
  if (new RegExp(`\\s${name}\\s*=`, "i").test(tag)) {
    return replaceAttribute(tag, name, value);
  }
  return addAttribute(tag, name, value);
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
    } else {
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
    clozeGapLabels: 0,
    emptyFeedbackPanelsHidden: 0,
    horizontalRules: 0,
    legacyHandlers: 0,
    styleAttributes: 0,
    titleHeadingsNormalized: 0,
    titleHeadingsCreated: 0,
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

function normalizeFamilyStructure(source, page, profile, counters) {
  if (!["cloze", "dict", "sent"].includes(profile.family)) return source;
  const inventory = directWrapperSnapshot(source);
  if (inventory.bodyCount !== 1) {
    throw new Error(page.relative + ": WRAPPER PREFLIGHT blocked; expected one body#TheBody, found " + inventory.bodyCount);
  }
  if (inventory.wrapperCandidateCount > 1) {
    throw new Error(page.relative + ": WRAPPER PREFLIGHT blocked duplicate direct wrappers: " + JSON.stringify(inventory.wrappers));
  }
  if (inventory.nestedWrappers.length) {
    throw new Error(page.relative + ": WRAPPER PREFLIGHT blocked nested wrappers: " + JSON.stringify(inventory.nestedWrappers));
  }
  const directWrapper = inventory.directChildren[0];
  const directWrapperClassList = directWrapper?.classes || [];
  const recognizedWrapper = directWrapper?.tag === "div" && (
    directWrapperClassList.includes("wrapfit") ||
    directWrapperClassList.includes("wrapit") ||
    (profile.family !== "cloze" && directWrapperClassList.includes("exercise-wrapper")) ||
    (directWrapperClassList.length === 1 && directWrapperClassList[0] === "cenmar")
  );
  if (!recognizedWrapper) {
    throw new Error(page.relative + ": WRAPPER PREFLIGHT blocked unknown or missing direct wrapper: " + JSON.stringify(inventory));
  }
  const body = /<body\b(?=[^>]*\bid\s*=\s*(["'])TheBody\1)[^>]*>/i.exec(source);
  if (!body) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; missing body#TheBody`);
  const bodyTail = source.slice(body.index + body[0].length);
  const leading = /^(?:(?:\s+)|(?:<!--[\s\S]*?-->))*/.exec(bodyTail)?.[0] || "";
  const directChild = /^<div\b[^>]*>/i.exec(bodyTail.slice(leading.length));
  if (!directChild) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; no direct exercise wrapper`);
  let wrapperOpening = directChild[0];
  let wrapperIndex = body.index + body[0].length + leading.length + directChild.index;
  let wrapperClasses = readTagAttribute(wrapperOpening, "class").split(/\s+/).filter(Boolean);

  if (!wrapperClasses.includes("wrapit") && !wrapperClasses.includes("wrapfit") &&
      !(profile.family !== "cloze" && wrapperClasses.includes("exercise-wrapper"))) {
    const wrapperMatch = { index: wrapperIndex, 0: wrapperOpening };
    const wrapperEnd = findMatchingDivEnd(source, wrapperMatch);
    if (wrapperEnd < 0) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; cannot locate direct exercise wrapper`);
    const wrapperMarkup = source.slice(wrapperIndex, wrapperEnd);
    const idCounts = ["InstructionsDiv", "MainDiv", "FeedbackDiv"].map((id) =>
      [...wrapperMarkup.matchAll(new RegExp(`\\bid\\s*=\\s*(["'])${id}\\1`, "gi"))].length,
    );
    const titleCount = [...wrapperMarkup.matchAll(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bTitles\b[^"']*\1)[^>]*>/gi)].length;
    const closeContainers = [...wrapperMarkup.matchAll(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bcenmar\b[^"']*\1)[^>]*>/gi)];
    const isKnownCenmarShell =
      wrapperClasses.length === 1 &&
      wrapperClasses[0] === "cenmar" &&
      idCounts.every((count) => count === 1) &&
      titleCount === 1 &&
      closeContainers.length === 2 &&
      closeContainers[0].index === 0 &&
      /<button\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bbtn-74\b[^"']*\1)[^>]*>/i.test(
        wrapperMarkup.slice(closeContainers[1].index),
      );
    if (!isKnownCenmarShell) {
      throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; unsupported direct exercise wrapper (${wrapperClasses.join(" ") || "no class"})`);
    }
    const normalizedOpening = wrapperOpening.replace(/\sclass\s*=\s*(["'])[^"']*\1/i, ' class="wrapfit"');
    source = `${source.slice(0, wrapperIndex)}${normalizedOpening}${source.slice(wrapperIndex + wrapperOpening.length)}`;
    wrapperOpening = normalizedOpening;
    wrapperClasses = readTagAttribute(wrapperOpening, "class").split(/\s+/).filter(Boolean);
  }

  let normalizedOpening = removeClasses(wrapperOpening, ["exercise-wrapper", "wrapit"]);
  normalizedOpening = addClasses(normalizedOpening, ["hp-exercise-shell", "wrapfit"]);
  normalizedOpening = setTagAttribute(normalizedOpening, "data-sis-exercise-shell", "true");
  normalizedOpening = setTagAttribute(normalizedOpening, "data-sis-exercise-family", profile.family);
  if (normalizedOpening !== wrapperOpening) {
    source = `${source.slice(0, wrapperIndex)}${normalizedOpening}${source.slice(wrapperIndex + wrapperOpening.length)}`;
    wrapperOpening = normalizedOpening;
  }
  wrapperClasses = readTagAttribute(wrapperOpening, "class").split(/\s+/).filter(Boolean);

  if (profile.family === "cloze") {
    const main = [...source.matchAll(/<div\b(?=[^>]*\bid\s*=\s*(["'])MainDiv\1)[^>]*>/gi)];
    if (main.length !== 1) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; expected one MainDiv, found ${main.length}`);
    const mainEnd = findMatchingDivEnd(source, main[0]);
    if (mainEnd < 0) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; cannot locate MainDiv end`);
    const mainMarkup = source.slice(main[0].index, mainEnd);
    if (!/\bclass\s*=\s*(["'])[^"']*\bbtn17Container\b[^"']*\1/i.test(mainMarkup)) {
      const closeLength = /<\/div\s*>$/i.exec(mainMarkup)?.[0].length || 0;
      source = `${source.slice(0, mainEnd - closeLength)}<div class="btn17Container"></div>${source.slice(mainEnd - closeLength)}`;
    }
    return source;
  }

  if (/\bclass\s*=\s*(["'])[^"']*\bbtn-74\b[^"']*\1/i.test(source)) return source;
  if (
    /<(?:a|button)\b[^>]*(?:href|onclick)\s*=\s*(["'])[^"']*window\.close/i.test(source) ||
    /<(?:a|button)\b[^>]*>\s*close\s*<\//i.test(source)
  ) {
    throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; legacy Close control is not safely recognizable`);
  }
  const wrapperMatch = { index: wrapperIndex, 0: wrapperOpening };
  const wrapperEnd = findMatchingDivEnd(source, wrapperMatch);
  if (wrapperEnd < 0) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; cannot locate exercise wrapper end`);
  const closeButton = '<button class="hp-button btn-74" type="button" data-hp-close="" aria-label="Close" data-hp-tooltip="Close this exercise." aria-description="Close this exercise."><span></span><span></span><span></span><span></span>Close</button>';
  const wrapperMarkup = source.slice(wrapperMatch.index, wrapperEnd);
  const closeContainers = [...wrapperMarkup.matchAll(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bcenmar\b[^"']*\1)[^>]*>/gi)];
  if (closeContainers.length > 1) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; multiple Close containers`);
  if (closeContainers.length === 1) {
    const closeContainer = { index: wrapperMatch.index + closeContainers[0].index, 0: closeContainers[0][0] };
    const closeEnd = findMatchingDivEnd(source, closeContainer);
    if (closeEnd < 0) throw new Error(`${page.relative}: SOURCE STRUCTURE BLOCKED; cannot locate Close container end`);
    const closeLength = /<\/div\s*>$/i.exec(source.slice(closeContainer.index, closeEnd))?.[0].length || 0;
    source = `${source.slice(0, closeEnd - closeLength)}${closeButton}${source.slice(closeEnd - closeLength)}`;
  } else {
    const wrapperLength = /<\/div\s*>$/i.exec(wrapperMarkup)?.[0].length || 0;
    source = `${source.slice(0, wrapperEnd - wrapperLength)}<div class="cenmar">${closeButton}</div>${source.slice(wrapperEnd - wrapperLength)}`;
  }
  counters.closeButtons += 1;
  return source;
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

  const titles = [...source.matchAll(/<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bTitles\b[^"']*\1)[^>]*>/gi)];
  if (titles.length !== 1) return source;
  const title = titles[0];
  if (/<h1\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bExerciseTitle\b[^"']*\1)/i.test(source.slice(title.index, findMatchingDivEnd(source, title)))) return source;
  const titleEnd = findMatchingDivEnd(source, title);
  if (titleEnd < 0) throw new Error(`${file}: cannot safely locate the title block boundary`);
  const closing = /<\/div\s*>$/i.exec(source.slice(title.index, titleEnd));
  if (!closing) throw new Error(`${file}: cannot locate the title block closing tag`);
  const contentStart = title.index + title[0].length;
  const contentEnd = titleEnd - closing[0].length;
  const content = source.slice(contentStart, contentEnd);
  const visibleContent = content.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (visibleContent && !/[<>]/.test(visibleContent)) {
    const text = decodeHtmlText(visibleContent);
    source = `${source.slice(0, contentStart)}<h1 class="ExerciseTitle">${escapeHtmlText(text)}</h1>${source.slice(contentEnd)}`;
    counters.titleHeadingsCreated += 1;
    return source;
  }
  if (visibleContent) return source;

  const documentTitle = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  if (!documentTitle) return source;
  const fallback = decodeHtmlText(documentTitle.replace(/<[^>]*>/g, "")).trim().split(/\s*:\s*/).slice(-1)[0];
  if (!fallback) return source;
  source = `${source.slice(0, contentStart)}<h1 class="ExerciseTitle">${escapeHtmlText(fallback)}</h1>${source.slice(contentEnd)}`;
  counters.titleHeadingsCreated += 1;
  return source;
}

function decodeHtmlText(value) {
  return String(value)
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([\da-f]{1,6});/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
    return /(?:^|\/)story-theme\.js(?:\?|$)/i.test(src) ||
      /(?:^|\/)hot-potatoes-ui\.js(?:\?|$)/i.test(src) ||
      /(?:^|\/)hot-potatoes-feedback\.js(?:\?|$)/i.test(src)
      ? ""
      : tag;
  });
}

function injectAssets(source, options) {
  const { file, root, cssIntegrity, feedbackCssIntegrity, feedbackUiIntegrity, uiIntegrity, storyIntegrity, story, profile } = options;
  const headMatch = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!headMatch) throw new Error(`${path.relative(root, file)}: missing head element`);
  const openTag = headMatch[0].match(/^<head\b[^>]*>/i)?.[0];
  const closeTag = headMatch[0].match(/<\/head\s*>$/i)?.[0];
  if (!openTag || !closeTag) throw new Error(`${path.relative(root, file)}: cannot isolate head element`);

  let headContent = headMatch[0].slice(openTag.length, headMatch[0].length - closeTag.length);
  headContent = headContent.replace(MANAGED_ASSETS_RE, "");
  headContent = headContent.replace(MANAGED_STYLES_RE, "");
  headContent = headContent.replace(MODERNIZATION_VERSION_RE, "");
  headContent = headContent.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = readTagAttribute(tag, "href");
    return href.endsWith("sis-hot-potatoes.css") || href.endsWith("hot-potatoes-feedback.css") || href.endsWith("potato.css") ? "" : tag;
  });
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  headContent = compactHeadSpacing(headContent, newline);

  const themeHref = relativeHref(file, path.resolve(root, STORY_THEME));
  const uiHref = relativeHref(file, path.resolve(root, SHARED_UI));
  const cssHref = relativeHref(file, path.resolve(root, SHARED_CSS));
  const feedbackUiHref = relativeHref(file, path.resolve(root, FEEDBACK_UI));
  const feedbackCssHref = relativeHref(file, path.resolve(root, FEEDBACK_CSS));
  const storyUrl = relativeHref(file, story.absolute);
  const assetBlock = [
    "<!-- HOT POTATOES MODERNIZATION ASSETS START -->",
    modernizationVersionComment(profile, story),
    `<script src="${themeHref}" integrity="${storyIntegrity}" data-story-theme-key="${escapeAttribute(story.key)}" data-story-title-url="${escapeAttribute(storyUrl)}"></script>`,
    `<script src="${uiHref}" integrity="${uiIntegrity}"></script>`,
    `<script src="${feedbackUiHref}" integrity="${feedbackUiIntegrity}"></script>`,
    "<!-- HOT POTATOES MODERNIZATION ASSETS END -->",
  ].join(newline);
  const styleBlock = [
    "<!-- HOT POTATOES MODERNIZATION STYLES START -->",
    `<link rel="preload" href="${cssHref}" as="style" integrity="${cssIntegrity}">`,
    `<link rel="stylesheet" href="${cssHref}" integrity="${cssIntegrity}">`,
    `<link rel="preload" href="${feedbackCssHref}" as="style" integrity="${feedbackCssIntegrity}">`,
    `<link rel="stylesheet" href="${feedbackCssHref}" integrity="${feedbackCssIntegrity}">`,
    "<!-- HOT POTATOES MODERNIZATION STYLES END -->",
  ].join(newline);

  const searchableHeadContent = headContent.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
  const metaMatches = [...searchableHeadContent.matchAll(/<meta\b[^>]*>/gi)];
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
  headContent = compactHeadSpacing(headContent, newline);

  const replacementHead = `${openTag}${headContent}${closeTag}`;
  return `${source.slice(0, headMatch.index)}${replacementHead}${source.slice(headMatch.index + headMatch[0].length)}`;
}

function normalizeFeedbackPage(page, options) {
  const { file, root, feedbackCssIntegrity, feedbackUiIntegrity } = options;
  const profile = modernizationProfile(page);
  let source = removeManagedScriptTags(page.source);
  const headMatch = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!headMatch) throw new Error(`${page.relative}: missing head element`);
  const openTag = headMatch[0].match(/^<head\b[^>]*>/i)?.[0];
  const closeTag = headMatch[0].match(/<\/head\s*>$/i)?.[0];
  if (!openTag || !closeTag) throw new Error(`${page.relative}: cannot isolate head element`);

  let headContent = headMatch[0].slice(openTag.length, headMatch[0].length - closeTag.length);
  headContent = headContent.replace(MANAGED_ASSETS_RE, "");
  headContent = headContent.replace(MANAGED_STYLES_RE, "");
  headContent = headContent.replace(MODERNIZATION_VERSION_RE, "");
  headContent = headContent.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = readTagAttribute(tag, "href");
    return href.endsWith("hot-potatoes-feedback.css") || href.endsWith("potato.css") ? "" : tag;
  });

  const feedbackUiHref = relativeHref(file, path.resolve(root, FEEDBACK_UI));
  const feedbackCssHref = relativeHref(file, path.resolve(root, FEEDBACK_CSS));
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const assetBlock = [
    "<!-- HOT POTATOES MODERNIZATION ASSETS START -->",
    modernizationVersionComment(profile, null),
    `<script src="${feedbackUiHref}" integrity="${feedbackUiIntegrity}"></script>`,
    "<!-- HOT POTATOES MODERNIZATION ASSETS END -->",
  ].join(newline);
  const styleBlock = [
    "<!-- HOT POTATOES MODERNIZATION STYLES START -->",
    `<link rel="preload" href="${feedbackCssHref}" as="style" integrity="${feedbackCssIntegrity}">`,
    `<link rel="stylesheet" href="${feedbackCssHref}" integrity="${feedbackCssIntegrity}">`,
    "<!-- HOT POTATOES MODERNIZATION STYLES END -->",
  ].join(newline);

  const searchableHeadContent = headContent.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
  const metaMatches = [...searchableHeadContent.matchAll(/<meta\b[^>]*>/gi)];
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
  headContent = compactHeadSpacing(headContent, newline);

  const replacementHead = `${openTag}${headContent}${closeTag}`;
  source = `${source.slice(0, headMatch.index)}${replacementHead}${source.slice(headMatch.index + headMatch[0].length)}`;
  validatePageMmor(source, root, profile, page.relative);
  return {
    counters: {
      adsMoved: 0,
      answerFields: 0,
      animatedButtons: 0,
      buttons: 0,
      closeButtons: 0,
      closeLinks: 0,
      clozeGapLabels: 0,
      emptyFeedbackPanelsHidden: 0,
      horizontalRules: 0,
      legacyHandlers: 0,
      styleAttributes: 0,
      titleHeadingsNormalized: 0,
      titleHeadingsCreated: 0,
      titlePanelsWrapped: 0,
    },
    versionChanged: !hasCurrentModernizationVersion(page.source, profile, null),
    source,
    stats: { buttonFunctions: 0, reads: 0, writes: 0 },
    family: profile.family,
    prototype: profile.prototype,
  };
}

function removeProfileAssetTags(source) {
  const knownAssetNames = new Set([
    "sis-cloze-submit.css",
    "sis-exercise-layout.css",
    "sis-exercise-family-layout.css",
    "sis-cloze-submit.js",
    "sis-exercise-submit.js",
  ]);
  return source.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, (head) => {
    const newline = head.includes("\r\n") ? "\r\n" : "\n";
    return head
      .replace(/<(?:link|script)\b[^>]*>(?:\s*<\/script\s*>)?/gi, (tag) => {
        const attribute = /^<link\b/i.test(tag) ? "href" : "src";
        const name = path.basename(readTagAttribute(tag, attribute).split(/[?#]/, 1)[0]);
        return knownAssetNames.has(name) ? "" : tag;
      })
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|\r?\n(?:[\t ]*\r?\n){2,}/gi, (match) =>
        /^<(?:script|style)\b/i.test(match) ? match : `${newline}${newline}`,
      );
  });
}

function injectProfileAssets(source, options) {
  const { file, root, profile } = options;
  const styles = profile.family === "cloze"
    ? [["css/sis-cloze-submit.css", options.clozeSubmitCssIntegrity]]
    : ["dict", "sent"].includes(profile.family)
      ? [
          ["css/sis-exercise-layout.css", options.exerciseLayoutCssIntegrity],
          ["css/sis-cloze-submit.css", options.clozeSubmitCssIntegrity],
          ["css/sis-exercise-family-layout.css", options.exerciseFamilyCssIntegrity],
        ]
      : [];
  const scripts = profile.family === "cloze"
    ? [["js/sis-cloze-submit.js", options.clozeSubmitJsIntegrity, "cloze"]]
    : ["dict", "sent"].includes(profile.family)
      ? [["js/sis-exercise-submit.js", options.exerciseSubmitJsIntegrity, profile.family]]
      : [];
  if (!styles.length && !scripts.length) return source;

  const headMatch = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!headMatch) throw new Error(`${path.relative(root, file)}: missing head element`);
  const openTag = headMatch[0].match(/^<head\b[^>]*>/i)?.[0];
  const closeTag = headMatch[0].match(/<\/head\s*>$/i)?.[0];
  if (!openTag || !closeTag) throw new Error(`${path.relative(root, file)}: cannot isolate head element`);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const strippedHead = removeProfileAssetTags(headMatch[0]);
  let headContent = strippedHead.slice(openTag.length, strippedHead.length - closeTag.length);

  const additions = [];
  for (const [assetPath, integrity] of styles) {
    if (!integrity) throw new Error(`Missing SRI for ${assetPath}`);
    const href = relativeHref(file, path.resolve(root, assetPath));
    additions.push(
      `<link rel="preload" href="${href}" as="style" integrity="${integrity}">`,
      `<link rel="stylesheet" href="${href}" integrity="${integrity}">`,
    );
  }
  for (const [assetPath, integrity, family] of scripts) {
    if (!integrity) throw new Error(`Missing SRI for ${assetPath}`);
    const href = relativeHref(file, path.resolve(root, assetPath));
    additions.push(
      `<script defer src="${href}" integrity="${integrity}" data-sis-exercise-family="${family}"></script>`,
    );
  }
  headContent = `${headContent.replace(/[\t \r\n]*$/, "")}${newline}${additions.join(newline)}${newline}`;
  headContent = compactHeadSpacing(headContent, newline);
  const replacementHead = `${openTag}${headContent}${closeTag}`;
  return `${source.slice(0, headMatch.index)}${replacementHead}${source.slice(headMatch.index + headMatch[0].length)}`;
}

function extractHeadStyleBlocks(source) {
  const head = source.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i)?.[0] || "";
  return [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)].map(([block]) => block);
}

function ensureHeadMeta(source, name, content, anchorName = "charset") {
  const canonical = `<meta name="${name}" content="${escapeAttribute(content)}">`;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const head = /<head\b[^>]*>[\s\S]*?<\/head\s*>/i.exec(source);
  if (!head) throw new Error(`Cannot add ${name} metadata without a head element`);
  const headSource = head[0];
  const searchableHead = headSource.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
  const metaTags = [...searchableHead.matchAll(/<meta\b[^>]*>/gi)];
  const existing = metaTags.find((match) => readTagAttribute(match[0], "name").toLowerCase() === name.toLowerCase());
  if (existing) {
    const start = head.index + existing.index;
    const end = start + existing[0].length;
    const suffix = source.slice(end);
    const replacement = readTagAttribute(existing[0], "content") === content ? existing[0] : canonical;
    const lineBreak = suffix && !/^(?:\r?\n|[\t ])/.test(suffix) ? newline : "";
    if (replacement === existing[0] && !lineBreak) return source;
    return `${source.slice(0, start)}${replacement}${lineBreak}${suffix}`;
  }

  const anchor = metaTags.find((match) =>
    anchorName === "charset"
      ? readTagAttribute(match[0], "charset").trim() !== ""
      : readTagAttribute(match[0], "name").toLowerCase() === anchorName.toLowerCase(),
  );
  const insertionPoint = anchor
    ? head.index + anchor.index + anchor[0].length
    : head.index + headSource.match(/^<head\b[^>]*>/i)[0].length;
  const suffix = source.slice(insertionPoint).replace(/^(?:\r?\n)+/, "");
  return `${source.slice(0, insertionPoint)}${newline}${canonical}${newline}${suffix}`;
}

function normalizeClozeGapLabels(source, counters) {
  return source.replace(/<!--[\s\S]*?-->|<span\b[^>]*>[\s\S]*?<\/span\s*>/gi, (token) => {
    if (/^<!--/.test(token) || !/\bclass\s*=\s*(["'])[^"']*\bGapSpan\b[^"']*\1/i.test(token)) return token;
    const opening = /^<span\b[^>]*>/i.exec(token)?.[0];
    const closing = /<\/span\s*>$/i.exec(token)?.[0];
    if (!opening || !closing) return token;
    const inner = token.slice(opening.length, token.length - closing.length);
    const input = /<input\b[^>]*\bid\s*=\s*(["'])Gap(\d+)\1[^>]*>/i.exec(inner);
    if (!input) return token;
    const id = `Gap${input[2]}`;
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*(["'])${escapedId}\\1`, "i").test(inner)) return token;
    const label = `<label class="sr-only" for="${id}">Blank ${Number(input[2]) + 1}</label>`;
    counters.clozeGapLabels += 1;
    const insertAt = input.index;
    return `${opening}${inner.slice(0, insertAt)}${label}${inner.slice(insertAt)}${closing}`;
  });
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
  const { root, cssIntegrity, feedbackCssIntegrity, feedbackUiIntegrity, uiIntegrity, storyIntegrity } = options;
  const profile = modernizationProfile(page);
  const originalStyles = extractHeadStyleBlocks(page.source);
  const sourceRequirementGapsBefore = sourceRequirementGaps(page.source, profile);
  const sourceMmor = POST_CONVERSION_VERIFIED_FAMILIES.has(profile.family)
    ? auditMmor(page.source, root, page, profile)
    : null;
  const runtime = collectRuntimePatches(page.source, { file: page.relative });
  let source = applyPatches(page.source, runtime.patches);
  const markup = transformMarkup(source, page.relative);
  source = ensureHeadMeta(markup.source, "viewport", "width=device-width, initial-scale=1.0");
  if (profile.family === "cloze") {
    source = ensureHeadMeta(source, "sis-cloze-prototype", "current", "viewport");
    source = normalizeClozeGapLabels(source, markup.counters);
  }
  source = normalizeButtonLabels(source);
  source = normalizeFamilyStructure(source, page, profile, markup.counters);
  source = removeManagedScriptTags(source);
  source = removeProfileAssetTags(source);
  source = injectAssets(source, {
    cssIntegrity,
    feedbackCssIntegrity,
    feedbackUiIntegrity,
    file: page.absolute,
    root,
    story: page.story,
    profile,
    storyIntegrity,
    uiIntegrity,
  });
  source = injectProfileAssets(source, { ...options, file: page.absolute, root, profile });
  source = ensureHeadMeta(source, "viewport", "width=device-width, initial-scale=1.0");
  if (profile.family === "cloze") source = ensureHeadMeta(source, "sis-cloze-prototype", "current", "viewport");
  const mmor = validatePageMmor(source, root, profile, page.relative, originalStyles);

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
    versionChanged: !hasCurrentModernizationVersion(page.source, profile, page.story),
    sourceRequirementGaps: sourceRequirementGapsBefore,
    mmor,
    sourceMmor,
    source,
    stats: runtime.stats,
    family: profile.family,
    prototype: profile.prototype,
  };
}

function verifyPostConversionPage(page, options) {
  const repeated = normalizePage(page, options);
  if (repeated.source !== page.source) {
    const profile = modernizationProfile(page);
    throw new Error(
      `${page.relative}: post-conversion verification failed; repeat normalization still changes this ${profile.family} page.`,
    );
  }
  return repeated;
}

function collectAssetInfo(root) {
  const files = {
    css: path.resolve(root, SHARED_CSS),
    feedbackCss: path.resolve(root, FEEDBACK_CSS),
    feedbackUi: path.resolve(root, FEEDBACK_UI),
    clozeSubmitCss: path.resolve(root, "css/sis-cloze-submit.css"),
    exerciseFamilyCss: path.resolve(root, "css/sis-exercise-family-layout.css"),
    exerciseLayoutCss: path.resolve(root, "css/sis-exercise-layout.css"),
    clozeSubmitJs: path.resolve(root, "js/sis-cloze-submit.js"),
    exerciseSubmitJs: path.resolve(root, "js/sis-exercise-submit.js"),
    story: path.resolve(root, STORY_THEME),
    ui: path.resolve(root, SHARED_UI),
  };
  const missing = Object.entries(files).filter(([, file]) => !fs.existsSync(file));
  if (missing.length) throw new Error(`Missing shared asset: ${missing.map(([key]) => key).join(", ")}`);
  return {
    cssIntegrity: integrityFor(files.css),
    feedbackCssIntegrity: integrityFor(files.feedbackCss),
    feedbackUiIntegrity: integrityFor(files.feedbackUi),
    clozeSubmitCssIntegrity: integrityFor(files.clozeSubmitCss),
    exerciseFamilyCssIntegrity: integrityFor(files.exerciseFamilyCss),
    exerciseLayoutCssIntegrity: integrityFor(files.exerciseLayoutCss),
    clozeSubmitJsIntegrity: integrityFor(files.clozeSubmitJs),
    exerciseSubmitJsIntegrity: integrityFor(files.exerciseSubmitJs),
    storyIntegrity: integrityFor(files.story),
    uiIntegrity: integrityFor(files.ui),
  };
}

function summarizePagePlans(plans) {
  const summary = {
    alreadyCompliant: 0,
    fileUpdates: 0,
    sourceRequirementGaps: 0,
    byFamily: new Map(),
  };
  for (const plan of plans) {
    const family = plan.result.family || "unknown";
    const familySummary = summary.byFamily.get(family) || {
      alreadyCompliant: 0,
      fileUpdates: 0,
      sourceRequirementGaps: 0,
    };
    const hasFileUpdate = plan.updated !== plan.source;
    const hasRequirementGaps = Boolean(plan.result.sourceRequirementGaps?.length);
    if (hasFileUpdate) {
      summary.fileUpdates += 1;
      familySummary.fileUpdates += 1;
    } else {
      summary.alreadyCompliant += 1;
      familySummary.alreadyCompliant += 1;
    }
    if (hasRequirementGaps) {
      summary.sourceRequirementGaps += 1;
      familySummary.sourceRequirementGaps += 1;
    }
    summary.byFamily.set(family, familySummary);
  }
  return summary;
}

function createModernizerReport(plans, inventory, args) {
  const planByRelative = new Map(plans.map((plan) => [plan.relative, plan]));
  const failureByRelative = new Map();
  for (const message of inventory.failures || []) {
    const separator = message.indexOf(": ");
    failureByRelative.set(separator < 0 ? message : message.slice(0, separator), message);
  }
  for (const relative of inventory.unmapped || []) failureByRelative.set(relative, `${relative}: companion story unresolved`);
  for (const message of inventory.ambiguous || []) {
    const separator = message.indexOf(": ");
    failureByRelative.set(separator < 0 ? message : message.slice(0, separator), message);
  }

  const rows = inventory.pages.map((page) => {
    const profile = modernizationProfile(page);
    const plan = planByRelative.get(page.relative);
    const failure = failureByRelative.get(page.relative) || null;
    const beforeAudit = POST_CONVERSION_VERIFIED_FAMILIES.has(profile.family)
      ? (plan?.result.sourceMmor || auditMmor(page.source, args.root, page, profile))
      : null;
    const afterAudit = plan?.result.mmor || null;
    const changes = plan ? classifyPageChanges(plan.source, plan.updated) : {
      changed: false,
      structuralChanged: false,
      sriChanged: false,
      versionChanged: false,
      versionOnly: false,
      sriOnly: false,
    };
    const beforeWrapper = directWrapperSnapshot(page.source);
    const afterWrapper = plan ? directWrapperSnapshot(plan.updated) : beforeWrapper;
    const failedRequirements = afterAudit?.results.filter((item) => !item.pass) || [];
    return {
      path: page.relative,
      family: profile.family,
      prototype: profile.prototype,
      story: page.story?.relative || null,
      status: failure ? "BLOCKED" : afterAudit?.allPassed ? (changes.changed ? "UPDATE" : "PASS") : "UNVERIFIED",
      failure,
      wrappers: { before: beforeWrapper, after: afterWrapper },
      changes,
      mmor: { before: beforeAudit?.results || null, after: afterAudit?.results || null },
      failedRequirements,
      remediation: failure || (failedRequirements.length ? failedRequirements.map((item) => `${item.id}: ${item.description}`).join("; ") : null),
    };
  });
  const plannedPaths = new Set(rows.map((row) => row.path));
  const unrepresentedBlocked = [...failureByRelative.entries()]
    .filter(([relative]) => !plannedPaths.has(relative))
    .map(([relative, reason]) => ({ path: relative, status: "BLOCKED", failure: reason, remediation: reason }));
  const allRows = [...rows, ...unrepresentedBlocked];
  const count = (predicate) => allRows.filter(predicate).length;
  const byFamily = {};
  for (const family of [...new Set(allRows.map((row) => row.family || "unknown"))].sort()) {
    const familyRows = allRows.filter((row) => (row.family || "unknown") === family);
    byFamily[family] = {
      scanned: familyRows.length,
      sourceCompliant: familyRows.filter((row) => row.mmor?.before && row.mmor.before.every((item) => item.pass)).length,
      normalizedCompliant: familyRows.filter((row) => row.mmor?.after && row.mmor.after.every((item) => item.pass)).length,
      structuralUpdates: familyRows.filter((row) => row.changes?.structuralChanged).length,
      sriOnlyUpdates: familyRows.filter((row) => row.changes?.sriOnly).length,
      versionOnlyUpdates: familyRows.filter((row) => row.changes?.versionOnly).length,
      blocked: familyRows.filter((row) => row.status === "BLOCKED").length,
    };
  }
  const wrapperVariants = new Map();
  for (const row of allRows) {
    const wrapper = row.wrappers?.before;
    if (!wrapper) continue;
    const key = `${wrapper.tag || "<none>"}|${wrapper.classes.join(" ") || "<no-class>"}`;
    wrapperVariants.set(key, (wrapperVariants.get(key) || 0) + 1);
  }
  const goodRows = allRows.filter((row) => row.mmor?.after?.every((item) => item.pass));
  const badRows = allRows.filter((row) => row.status === "BLOCKED" || row.failedRequirements?.length);
  const uglyRows = allRows.filter((row) => row.changes?.structuralChanged || row.changes?.sriOnly || row.changes?.versionOnly);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    runPolicy: {
      allowBlocked: args.allowBlocked,
      blockedFailuresExcluded: args.allowBlocked ? (inventory.failures || []).length : 0,
    },
    root: args.root,
    scopes: args.scopes.length ? args.scopes : ROOTS,
    paths: args.paths || [],
    modernizationVersion: CURRENT_MODERNIZATION_VERSION,
    totals: {
      scanned: inventory.pages.length,
      evaluated: plans.length,
      sourceCompliant: count((row) => row.mmor?.before && row.mmor.before.every((item) => item.pass)),
      normalizedCompliant: count((row) => row.mmor?.after && row.mmor.after.every((item) => item.pass)),
      structuralUpdates: count((row) => row.changes?.structuralChanged),
      sriOnlyUpdates: count((row) => row.changes?.sriOnly),
      versionOnlyUpdates: count((row) => row.changes?.versionOnly),
      unchanged: count((row) => row.status === "PASS"),
      blocked: count((row) => row.status === "BLOCKED"),
    },
    byFamily,
    findings: {
      good: { count: goodRows.length, pages: goodRows.map((row) => row.path) },
      bad: { count: badRows.length, pages: badRows.map((row) => ({ path: row.path, failure: row.failure, requirements: row.failedRequirements?.map((item) => item.id) || [] })) },
      ugly: { count: uglyRows.length, pages: uglyRows.map((row) => ({ path: row.path, changes: row.changes })) },
    },
    wrapperInventory: {
      variants: [...wrapperVariants.entries()].map(([classes, count]) => ({ classes, count })).sort((left, right) => right.count - left.count || left.classes.localeCompare(right.classes)),
      pages: rows.map((row) => ({ path: row.path, family: row.family, ...row.wrappers.before })),
    },
    pages: allRows,
    blockedFiles: [...(inventory.unmapped || []), ...(inventory.ambiguous || []), ...(inventory.failures || [])],
  };
}

function writeModernizerReport(report, root, reportPath) {
  if (!reportPath) return null;
  const destination = path.resolve(root, reportPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  fs.renameSync(temporary, destination);
  return destination;
}

function summarize(plans, inventory, apply, scopes) {
  const changed = plans.filter((plan) => plan.updated !== plan.source);
  const pageSummary = summarizePagePlans(plans);
  const changesByPage = new Map(changed.map((plan) => [plan.relative, classifyPageChanges(plan.source, plan.updated)]));
  const structuralChanged = changed.filter((plan) => changesByPage.get(plan.relative).structuralChanged);
  const sriOnlyChanged = changed.filter((plan) => changesByPage.get(plan.relative).sriOnly);
  const versionOnlyChanged = changed.filter((plan) => changesByPage.get(plan.relative).versionOnly);
  const versionUpgrades = plans.filter((plan) => plan.result.versionChanged).length;
  const pagesWithSourceRequirementGaps = plans.filter((plan) => plan.result.sourceRequirementGaps?.length).length;
  const sourceRequirementGapCounts = new Map();
  for (const plan of plans) {
    for (const gap of plan.result.sourceRequirementGaps || []) {
      sourceRequirementGapCounts.set(gap, (sourceRequirementGapCounts.get(gap) || 0) + 1);
    }
  }
  const alreadyCompliantCount = pageSummary.alreadyCompliant;
  const updateCount = pageSummary.fileUpdates;
  const sourceMmorCompliant = plans.filter((plan) => plan.result.sourceMmor?.allPassed).length;
  const normalizedMmorCompliant = plans.filter((plan) => plan.result.mmor?.allPassed).length;
  const blockedCount = inventory.unmapped.length + inventory.ambiguous.length + inventory.failures.length;
  const postConversionExpected = inventory.pages.filter((page) =>
    POST_CONVERSION_VERIFIED_FAMILIES.has(modernizationProfile(page).family),
  ).length;
  const postConversionPassed = plans.filter((plan) =>
    POST_CONVERSION_VERIFIED_FAMILIES.has(plan.result.family) &&
    plan.postConversionVerified,
  ).length;
  const blockedByFamily = new Map();
  const pagesByRelative = new Map(inventory.pages.map((page) => [page.relative, page]));
  for (const failure of inventory.failures) {
    const separator = failure.indexOf(": ");
    const relative = separator >= 0 ? failure.slice(0, separator) : "";
    const page = pagesByRelative.get(relative);
    const family = page ? modernizationProfile(page).family : "unknown";
    blockedByFamily.set(family, (blockedByFamily.get(family) || 0) + 1);
  }
  const totals = structuralChanged.reduce(
    (result, plan) => {
      result.adsMoved += plan.result.counters.adsMoved;
      result.answerFields += plan.result.counters.answerFields;
      result.animatedButtons += plan.result.counters.animatedButtons;
      result.styleAttributes += plan.result.counters.styleAttributes;
      result.buttons += plan.result.counters.buttons;
      result.closeButtons += plan.result.counters.closeButtons;
      result.closeLinks += plan.result.counters.closeLinks;
      result.clozeGapLabels += plan.result.counters.clozeGapLabels || 0;
      result.emptyFeedbackPanelsHidden += plan.result.counters.emptyFeedbackPanelsHidden;
      result.horizontalRules += plan.result.counters.horizontalRules;
      result.legacyHandlers += plan.result.counters.legacyHandlers;
      result.runtimeButtonFunctions += plan.result.stats.buttonFunctions;
      result.runtimeReads += plan.result.stats.reads;
      result.runtimeWrites += plan.result.stats.writes;
      result.titleHeadingsNormalized += plan.result.counters.titleHeadingsNormalized;
      result.titleHeadingsCreated += plan.result.counters.titleHeadingsCreated;
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
      clozeGapLabels: 0,
      emptyFeedbackPanelsHidden: 0,
      horizontalRules: 0,
      legacyHandlers: 0,
      runtimeButtonFunctions: 0,
      runtimeReads: 0,
      runtimeWrites: 0,
      styleAttributes: 0,
      titleHeadingsNormalized: 0,
      titleHeadingsCreated: 0,
      titlePanelsWrapped: 0,
    },
  );

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Scope: ${scopes.length ? scopes.join(", ") : `all configured roots (${ROOTS.join(", ")})`}`);
  console.log(`Hot Potatoes pages: ${inventory.pages.length}`);
  console.log(`Pages evaluated and normalized: ${plans.length}`);
  console.log(`Family structure selectors missing before normalization: ${pageSummary.sourceRequirementGaps}`);
  console.log(`Pages already compliant (no file changes): ${alreadyCompliantCount}`);
  console.log(`Pages requiring file updates: ${updateCount}`);
  console.log(`MMOR source pages compliant before normalization: ${sourceMmorCompliant}/${plans.filter((plan) => plan.result.sourceMmor).length}`);
  console.log(`Independent post-normalization MMOR checks passed: ${normalizedMmorCompliant}/${plans.filter((plan) => plan.result.mmor).length}`);
  console.log(`Idempotence checks passed: ${postConversionPassed}/${postConversionExpected}`);
  console.log(`Pages blocked from a complete run: ${blockedCount}`);
  console.log(`Good: ${normalizedMmorCompliant} pages pass the independent MMOR checks.`);
  console.log(`Bad: ${blockedCount} pages or mappings block this run.`);
  console.log(`Ugly: ${structuralChanged.length} structural updates, ${sriOnlyChanged.length} SRI-only updates, ${versionOnlyChanged.length} version-only updates.`);
  if (pageSummary.byFamily.size || blockedByFamily.size) {
    console.log("Page status by family:");
    const families = new Set([...pageSummary.byFamily.keys(), ...blockedByFamily.keys()]);
    for (const family of [...families].sort()) {
      const counts = pageSummary.byFamily.get(family) || {
        alreadyCompliant: 0,
        fileUpdates: 0,
        sourceRequirementGaps: 0,
      };
      const blocked = blockedByFamily.get(family) || 0;
      console.log(
        `  ${family}: already compliant ${counts.alreadyCompliant}, file updates ${counts.fileUpdates}, source gaps ${counts.sourceRequirementGaps}, blocked ${blocked}`,
      );
    }
  }
  console.log(`Pages with companion stories: ${inventory.pages.filter((page) => page.story).length}`);
  console.log(`Unmapped companion stories: ${inventory.unmapped.length}`);
  console.log(`Ambiguous Hot Potatoes files: ${inventory.ambiguous.length}`);
  console.log(`Current modernization version: ${CURRENT_MODERNIZATION_VERSION}`);
  console.log(`Pages carrying current version marker: ${plans.length - versionUpgrades}`);
  console.log(`Pages requiring version upgrade: ${versionUpgrades}`);
  console.log(`Pages missing canonical requirements before normalization: ${pagesWithSourceRequirementGaps}`);
  if (sourceRequirementGapCounts.size) {
    console.log("Missing canonical requirements before normalization:");
    for (const [gap, count] of [...sourceRequirementGapCounts].sort((left, right) => right[1] - left[1])) {
      console.log(`  ${count} pages: ${gap}`);
    }
  }
  console.log(`Pages requiring structural updates: ${structuralChanged.length}`);
  console.log(`Pages requiring SRI-only updates: ${sriOnlyChanged.length}`);
  console.log(`Pages requiring version-only updates: ${versionOnlyChanged.length}`);
  console.log(`Interstitial ad slots moved before instruction panels: ${totals.adsMoved}`);
  if (inventory.skippedBackups.length) console.log(`Saved -bu copies excluded: ${inventory.skippedBackups.length}`);
  console.log(`${apply ? "Pages to write" : "Pages that would change"}: ${changed.length}`);
  console.log(`Inline style attributes: ${totals.styleAttributes}`);
  console.log(`ShortAnswer fields given accessible names: ${totals.answerFields}`);
  console.log(`Buttons normalized: ${totals.buttons}`);
  console.log(`Animated functional buttons normalized: ${totals.animatedButtons}`);
  console.log(`Special Close buttons normalized: ${totals.closeButtons}`);
  console.log(`Cloze gap fields given accessible names: ${totals.clozeGapLabels}`);
  console.log(`JavaScript Close links migrated to buttons: ${totals.closeLinks}`);
  console.log(`Empty feedback panels hidden until feedback: ${totals.emptyFeedbackPanelsHidden}`);
  console.log(`Horizontal rules removed: ${totals.horizontalRules}`);
  console.log(`Title heading levels normalized to h1: ${totals.titleHeadingsNormalized}`);
  console.log(`Missing title headings safely restored from page text/title: ${totals.titleHeadingsCreated}`);
  console.log(`Titles moved into instruction panels: ${totals.titlePanelsWrapped}`);
  console.log(`Legacy hover handlers removed: ${totals.legacyHandlers}`);
  console.log(`Legacy runtime button-state functions neutralized: ${totals.runtimeButtonFunctions}`);
  console.log(`Runtime visibility reads migrated: ${totals.runtimeReads}`);
  console.log(`Runtime visibility writes migrated: ${totals.runtimeWrites}`);
  for (const item of inventory.unmapped.slice(0, 24)) console.log(`  Unmapped story: ${item}`);
  for (const item of inventory.ambiguous.slice(0, 24)) console.log(`  Ambiguous: ${item}`);
  if (changed.length) {
    console.log("Update samples (family -> prototype):");
    for (const plan of changed.slice(0, 8)) {
      console.log(`  ${plan.relative} -> ${plan.result.family} -> ${plan.result.prototype}`);
    }
  }
  const blocked = [
    ...inventory.unmapped.map((relative) => `${relative}: companion story unresolved`),
    ...inventory.ambiguous,
    ...inventory.failures,
  ];
  if (blocked.length) {
    const anomalyKinds = new Map();
    for (const item of blocked) {
      const separator = item.indexOf(": ");
      const reason = separator >= 0 ? item.slice(separator + 2) : item;
      anomalyKinds.set(reason, (anomalyKinds.get(reason) || 0) + 1);
    }
    console.log("Anomaly scan alerts (blocked from update):");
    console.log("Anomaly classes:");
    for (const [reason, count] of [...anomalyKinds].sort((left, right) => right[1] - left[1]).slice(0, 8)) {
      console.log(`  ${count} pages: ${reason}`);
    }
    for (const item of blocked.slice(0, 8)) console.log(`  ${item}`);
  }
}

function applySafetyError(args, changedPageCount) {
  if (changedPageCount <= MAX_SAFE_APPLY_PAGES) return null;
  if (args.allowBulk && args.scopes.length) return null;
  return `Refusing to apply ${changedPageCount} changed pages. The safe limit is ${MAX_SAFE_APPLY_PAGES}; rerun the dry-run for the intended scope, then pass --allow-bulk and one or more explicit --scope arguments to approve a larger batch.`;
}

function preflightBlockingReason(inventory, args) {
  if (inventory.ambiguous.length || inventory.unmapped.length) {
    return "coverage is incomplete because a page is ambiguous or its companion story is unresolved";
  }
  if (inventory.failures.length && !args.allowBlocked) {
    return "a page transformation failed";
  }
  return null;
}

function writeFileAtomically(file, contents) {
  const mode = fs.existsSync(file) ? fs.statSync(file).mode : 0o644;
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.modernize-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, contents, { mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Could not clean up temporary file ${temporary}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

function applyPagePlans(
  plans,
  args,
  backupManager = createBackupManager(args.root, "modernize-hot-potatoes"),
  verificationAssets = null,
) {
  const changed = plans.filter((plan) => plan.updated !== plan.source);
  const safetyError = applySafetyError(args, changed.length);
  if (safetyError) throw new Error(safetyError);
  if (!changed.length) return { changedCount: 0, runRoot: backupManager.runRoot };

  for (const plan of changed) {
    const current = fs.readFileSync(plan.absolute, "utf8");
    if (current !== plan.source) {
      throw new Error(`${plan.relative}: changed after preflight; refusing to overwrite concurrent work.`);
    }
  }

  for (const plan of changed) backupManager.backupBeforeWrite(plan.absolute);
  const backups = new Map();
  for (const plan of changed) {
    const backup = path.resolve(backupManager.runRoot, path.relative(args.root, plan.absolute));
    const original = fs.readFileSync(backup);
    if (!original.equals(Buffer.from(plan.source, "utf8"))) {
      throw new Error(`${plan.relative}: backup verification failed; no page was written.`);
    }
    backups.set(plan.absolute, original);
  }

  const staged = [];
  const committed = [];
  try {
    for (const plan of changed) {
      const mode = fs.statSync(plan.absolute).mode;
      const temporary = path.join(
        path.dirname(plan.absolute),
        `.${path.basename(plan.absolute)}.modernize-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`,
      );
      staged.push({ plan, temporary });
      fs.writeFileSync(temporary, plan.updated, { mode });
      fs.chmodSync(temporary, mode);
    }

    for (const entry of staged) {
      const current = fs.readFileSync(entry.plan.absolute, "utf8");
      if (current !== entry.plan.source) {
        throw new Error(`${entry.plan.relative}: changed during apply; refusing to overwrite concurrent work.`);
      }
      fs.renameSync(entry.temporary, entry.plan.absolute);
      committed.push(entry.plan);
    }
    for (const plan of changed) {
      const writtenSource = fs.readFileSync(plan.absolute, "utf8");
      if (writtenSource !== plan.updated) {
        throw new Error(`${plan.relative}: post-write verification failed.`);
      }
      if (plan.result && plan.result.family !== "feedback") {
        if (!verificationAssets) {
          throw new Error(
            `${plan.relative}: post-conversion verification assets are unavailable.`,
          );
        }
        verifyPostConversionPage(
          { ...plan, source: writtenSource },
          { ...verificationAssets, root: args.root },
        );
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const plan of committed.reverse()) {
      try {
        const current = fs.readFileSync(plan.absolute, "utf8");
        if (current !== plan.updated) {
          rollbackErrors.push(`${plan.relative}: changed after this apply wrote it; concurrent work was left untouched`);
          continue;
        }
        writeFileAtomically(plan.absolute, backups.get(plan.absolute));
      } catch (rollbackError) {
        rollbackErrors.push(`${plan.relative}: ${rollbackError.message}`);
      }
    }
    for (const entry of staged) fs.rmSync(entry.temporary, { force: true });
    const rollbackSummary = rollbackErrors.length
      ? ` Rollback needs attention: ${rollbackErrors.join("; ")}. Verified originals remain in ${backupManager.runRoot}.`
      : " All pages written before the failure were restored from verified backups.";
    throw new Error(`Apply failed: ${error.message}.${rollbackSummary}`, { cause: error });
  }

  return { changedCount: changed.length, runRoot: backupManager.runRoot };
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

  const scanned = scanTargets(args.root, args.scopes.length ? args.scopes : ROOTS, args.paths);
  const inventory = {
    ...scanned,
    unmapped: scanned.pages.filter((page) => !page.story && !page.feedbackOnly).map((page) => page.relative),
    failures: [],
  };
  const plans = [];
  const failures = [];
  for (const page of inventory.pages) {
    if (!page.story && !page.feedbackOnly) continue;
    try {
      const result = page.feedbackOnly
        ? normalizeFeedbackPage(page, { ...shared, file: page.absolute, root: args.root })
        : normalizePage(page, { ...shared, root: args.root });
      const postConversionVerified = POST_CONVERSION_VERIFIED_FAMILIES.has(
        result.family,
      );
      if (postConversionVerified) {
        verifyPostConversionPage(
          { ...page, source: result.source },
          { ...shared, root: args.root },
        );
      }
      plans.push({
        ...page,
        postConversionVerified,
        result,
        source: page.source,
        updated: result.source,
      });
    } catch (error) {
      failures.push(error.message);
    }
  }

  inventory.failures = failures;
  const report = createModernizerReport(plans, inventory, args);
  try {
    if (args.report) console.log(`MMOR report: ${writeModernizerReport(report, args.root, args.report)}`);
  } catch (error) {
    console.error(`ERROR: could not write MMOR report: ${error.message}`);
    return 2;
  }
  summarize(plans, inventory, args.apply, args.scopes);
  const preflightBlock = preflightBlockingReason(inventory, args);
  if (preflightBlock) {
    console.error("ERROR: coverage or transformation preflight is incomplete; no pages were changed.");
    for (const failure of failures) console.error(`  ${failure}`);
    return 2;
  }
  if (failures.length) {
    console.warn(`WARNING: --allow-blocked excluded ${failures.length} blocked page${failures.length === 1 ? "" : "s"}; they remain BLOCKED in the MMOR report and were not written.`);
    for (const failure of failures) console.warn(`  ${failure}`);
  }
  if (!args.apply) return 0;

  const changed = plans.filter((plan) => plan.updated !== plan.source);
  if (!changed.length) {
    console.log("No page changes are needed.");
    return 0;
  }

  const safetyError = applySafetyError(args, changed.length);
  if (safetyError) {
    console.error(`ERROR: ${safetyError}`);
    return 2;
  }

  try {
    const result = applyPagePlans(plans, args, undefined, shared);
    report.applyOutcome = { status: "written-and-verified", changedPages: result.changedCount, backupRoot: result.runRoot };
    if (args.report) writeModernizerReport(report, args.root, args.report);
    console.log(`Wrote ${result.changedCount} page updates. Verified backups: ${result.runRoot}`);
  } catch (error) {
    report.applyOutcome = { status: "failed-and-rolled-back-or-needs-review", error: error.message };
    if (args.report) writeModernizerReport(report, args.root, args.report);
    console.error(`ERROR: ${error.message}`);
    return 2;
  }

  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  auditMmor,
  applyPagePlans,
  applySafetyError,
  classifyPageChanges,
  CURRENT_MODERNIZATION_VERSION,
  collectAssetInfo,
  collectRuntimePatches,
  createModernizerReport,
  directWrapperSnapshot,
  extractHeadStyleBlocks,
  main,
  normalizeFeedbackPage,
  normalizePage,
  modernizationProfile,
  normalizeStyleValue,
  preflightBlockingReason,
  MAX_SAFE_APPLY_PAGES,
  parseArgs,
  scanTargets,
  summarizePagePlans,
  storyTarget,
  transformMarkup,
  validatePageMmor,
  verifyPostConversionPage,
  writeModernizerReport,
};
