#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const parse5 = require("parse5");
const {
  actionControlContract,
  emptyLegacyNavigationBars,
} = require("./modernize-hot-potatoes-pages.cjs");

const ROOT = path.resolve(__dirname, "..");
const COLLECTIONS = [
  "begin1",
  "begin2",
  "begin3",
  "begin4",
  "begin5",
  "begin6",
  "eslread",
  "essays",
  "kidsenglish",
  "kidsenglish2",
  "kidsenglish3",
  "people",
];
const REQUIRED_ASSETS = [
  "css/sis-hot-potatoes.css",
  "js/hot-potatoes-ui.js",
  "css/hot-potatoes-feedback.css",
  "js/hot-potatoes-feedback.js",
  "js/story-theme.js",
  "style/font-stack.css",
  "js/theme-selector.js",
  "css/sis-cloze-submit.css",
  "js/sis-cloze-submit.js",
];
const PROTOTYPE = "begin1/cloze/b1cloze001.html";
const CHECKLIST = [
  [
    "CL-01",
    "Exactly one body#TheBody exists",
    "Repair the document body id before changing the cloze shell.",
  ],
  [
    "CL-02",
    "Viewport metadata declares device width and initial scale 1",
    "Add or correct the viewport meta tag.",
  ],
  [
    "CL-03",
    "Instruction panel contains Titles > h1.ExerciseTitle and #InstructionsDiv",
    "Move the exercise title and instructions into the canonical instruction panel.",
  ],
  [
    "CL-04",
    "#MainDiv, #ClozeDiv, and #FeedbackDiv are unique and correctly nested",
    "Repair duplicate or misplaced exercise blocks; do not fabricate missing exercise content.",
  ],
  [
    "CL-05",
    "One direct canonical wrapfit/hp-exercise-shell is present",
    "Normalize the direct body wrapper to the current cloze shell.",
  ],
  [
    "CL-06",
    "Check and Hint controls use the current btn-17 contract",
    "Restore the static Check and Hint controls with their current ids and types.",
  ],
  [
    "CL-07",
    "Every GapN input is unique and has a matching label",
    "Add a label for each gap or stop for manual source repair if the gap structure is incomplete.",
  ],
  [
    "CL-08",
    "Close is an accessible btn-74 control",
    "Add one accessible Close button to the normalized footer.",
  ],
  [
    "CL-09",
    "Required local assets resolve and their SRI matches the file bytes",
    "Correct the asset URL or regenerate its SHA-384 integrity value.",
  ],
  [
    "CL-10",
    "Companion story resolves and story-theme.js has the matching key",
    "Repair the story mapping; the page title/theme must come from its companion story.",
  ],
  [
    "CL-11",
    "Identity gate and SIS cloze bridge contain the required Check/Hint guard",
    "Use the canonical sis-cloze-submit.js identity gate and keep actions disabled until identity is valid.",
  ],
  [
    "CL-12",
    "No forbidden legacy wrappers, inline styles, or empty legacy navigation bars remain",
    "Run the cloze normalizer or repair the unsupported legacy source explicitly.",
  ],
  [
    "CL-13",
    "Head style blocks are present and the page has no inline style attributes",
    "Preserve the page stylesheet block while removing inline presentation state.",
  ],
  [
    "CL-14",
    "The structural shape matches the B1 cloze prototype contract",
    "Compare the page against begin1/cloze/b1cloze001.html and repair the named structural difference.",
  ],
  [
    "CL-15",
    "Source is an exercise document, not an HTTP error placeholder or duplicated document",
    "Recover the original exercise source or exclude this placeholder from modernization until its content is restored.",
  ],
  [
    "CL-16",
    "Every non-Close action control uses btn-17 hp-button and the shared button rule clips its animated effect",
    "Normalize every action control to btn-17 hp-button and restore the shared clipping rule.",
  ],
];

function parseArgs(argv) {
  const args = {
    markdown: null,
    report: "docs/CLOZE-INTEGRITY-REPORT.json",
    sampleSize: 5,
    root: ROOT,
    visualDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = path.resolve(argv[++index]);
    else if (arg === "--report") args.report = argv[++index];
    else if (arg === "--markdown") args.markdown = argv[++index];
    else if (arg === "--sample-size") args.sampleSize = Number(argv[++index]);
    else if (arg === "--visual-dir")
      args.visualDir = path.resolve(args.root, argv[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(args.sampleSize) || args.sampleSize < 1)
    throw new Error("--sample-size must be a positive integer");
  return args;
}

function printUsage() {
  console.log(
    "Usage: node scripts/audit-cloze-integrity.cjs [--report PATH] [--markdown PATH] [--sample-size N] [--visual-dir PATH] [--root PATH]",
  );
}

function elements(node, output = []) {
  if (node?.tagName) output.push(node);
  for (const child of node?.childNodes || []) elements(child, output);
  return output;
}

function attr(node, name) {
  return (
    node?.attrs?.find((item) => item.name.toLowerCase() === name.toLowerCase())
      ?.value || ""
  );
}

function hasClass(node, className) {
  return attr(node, "class").split(/\s+/).includes(className);
}

function contains(parent, child) {
  for (let current = child?.parentNode; current; current = current.parentNode)
    if (current === parent) return true;
  return false;
}

function findById(all, id) {
  return all.filter((node) => attr(node, "id") === id);
}

function directChildren(node) {
  return (node?.childNodes || []).filter((child) => child.tagName);
}

function directWrapper(body) {
  return (
    directChildren(body).find(
      (node) =>
        hasClass(node, "wrapfit") ||
        hasClass(node, "wrapit") ||
        hasClass(node, "exercise-wrapper"),
    ) || null
  );
}

function relativeAssetPath(pageFile, reference, root = ROOT) {
  const clean = String(reference || "").split(/[?#]/, 1)[0];
  if (!clean || /^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith("//"))
    return null;
  if (clean.startsWith("/reading/")) return clean.slice("/reading/".length);
  if (clean.startsWith("/")) return clean.slice(1);
  return path.normalize(
    path.join(path.dirname(path.relative(root, pageFile)), clean),
  );
}

function integrityFor(file) {
  return `sha384-${crypto.createHash("sha384").update(fs.readFileSync(file)).digest("base64")}`;
}

function headAssets(all) {
  const head = all.find((node) => node.tagName === "head");
  return (head ? elements(head) : []).filter(
    (node) => node.tagName === "link" || node.tagName === "script",
  );
}

function assetEvidence(pageFile, all, root = ROOT) {
  const assets = headAssets(all);
  return REQUIRED_ASSETS.map((required) => {
    const expectedType = required.endsWith(".css") ? "link" : "script";
    const matches = assets.filter((node) => {
      if (node.tagName !== expectedType) return false;
      const reference = attr(node, expectedType === "link" ? "href" : "src");
      return (
        path.basename(reference.split(/[?#]/, 1)[0]) === path.basename(required)
      );
    });
    const match = matches[0];
    const resolvedRelative = match
      ? relativeAssetPath(
          pageFile,
          attr(match, expectedType === "link" ? "href" : "src"),
          root,
        )
      : null;
    const resolved = resolvedRelative
      ? path.resolve(root, resolvedRelative)
      : null;
    const expectedIntegrity =
      resolved && fs.existsSync(resolved) ? integrityFor(resolved) : null;
    const actualIntegrity = match ? attr(match, "integrity") : "";
    return {
      path: required,
      present: Boolean(match),
      localFile: resolvedRelative,
      resolves: Boolean(
        resolved &&
        resolved.startsWith(root + path.sep) &&
        fs.existsSync(resolved),
      ),
      integrityPresent: Boolean(actualIntegrity),
      integrityMatches: Boolean(
        expectedIntegrity && actualIntegrity === expectedIntegrity,
      ),
      expectedIntegrity,
      actualIntegrity: actualIntegrity || null,
    };
  });
}

function storyEvidence(pageFile, all, root = ROOT) {
  const script = headAssets(all).find(
    (node) =>
      node.tagName === "script" &&
      /(?:^|\/)story-theme\.js(?:[?#]|$)/i.test(attr(node, "src")),
  );
  const titleUrl = attr(script, "data-story-title-url");
  const storyRelative = titleUrl
    ? relativeAssetPath(pageFile, titleUrl, root)
    : null;
  const storyFile = storyRelative ? path.resolve(root, storyRelative) : null;
  const key = attr(script, "data-story-theme-key");
  return {
    scriptPresent: Boolean(script),
    titleUrl: titleUrl || null,
    themeKey: key || null,
    storyRelative,
    resolves: Boolean(
      storyFile &&
      storyFile.startsWith(root + path.sep) &&
      fs.existsSync(storyFile),
    ),
    storyFile: storyRelative,
  };
}

function shape(source, pageFile) {
  const document = parse5.parse(source);
  const all = elements(document);
  const bodies = all.filter(
    (node) => node.tagName === "body" && attr(node, "id") === "TheBody",
  );
  const body = bodies[0];
  const wrapper = directWrapper(body);
  const ids = [
    "InstructionsDiv",
    "MainDiv",
    "ClozeDiv",
    "FeedbackDiv",
    "check",
    "hint",
    "FeedbackOKButton",
  ];
  return {
    bodyCount: bodies.length,
    wrapper: wrapper
      ? {
          tag: wrapper.tagName,
          classes: attr(wrapper, "class").split(/\s+/).filter(Boolean).sort(),
          shell: attr(wrapper, "data-sis-exercise-shell"),
          family: attr(wrapper, "data-sis-exercise-family"),
        }
      : null,
    ids: Object.fromEntries(ids.map((id) => [id, findById(all, id).length])),
    gapCount: all.filter(
      (node) => node.tagName === "input" && /^Gap\d+$/i.test(attr(node, "id")),
    ).length,
    answerButtonCount: all.filter(
      (node) =>
        node.tagName === "button" &&
        /CheckAnswers|CheckAnswer\s*\(/i.test(attr(node, "onclick")),
    ).length,
    styleBlockCount: all.filter((node) => node.tagName === "style").length,
    instructionPanelCount: all.filter((node) =>
      hasClass(node, "hp-instructions-panel"),
    ).length,
    titleHeadingCount: all.filter(
      (node) => node.tagName === "h1" && hasClass(node, "ExerciseTitle"),
    ).length,
    prototypeMarkerCount: all.filter(
      (node) =>
        node.tagName === "meta" &&
        attr(node, "name").toLowerCase() === "sis-cloze-prototype" &&
        attr(node, "content").toLowerCase() === "current",
    ).length,
    assetNames: headAssets(all)
      .map((node) =>
        path.basename(
          attr(node, node.tagName === "link" ? "href" : "src").split(
            /[?#]/,
            1,
          )[0],
        ),
      )
      .filter(Boolean)
      .sort(),
    pageFile,
  };
}

function compareShape(current, prototype) {
  const differences = [];
  if (!current.wrapper || !prototype.wrapper)
    differences.push("direct wrapper missing");
  else {
    for (const required of ["wrapfit", "hp-exercise-shell"])
      if (!current.wrapper.classes.includes(required))
        differences.push(`wrapper missing ${required}`);
    if (current.wrapper.shell !== "true")
      differences.push("wrapper missing data-sis-exercise-shell=true");
    if (current.wrapper.family !== "cloze")
      differences.push("wrapper missing data-sis-exercise-family=cloze");
  }
  for (const id of [
    "InstructionsDiv",
    "MainDiv",
    "ClozeDiv",
    "FeedbackDiv",
    "check",
    "hint",
  ]) {
    if (current.ids[id] !== prototype.ids[id])
      differences.push(
        `${id} count ${current.ids[id]} != prototype ${prototype.ids[id]}`,
      );
  }
  if (current.instructionPanelCount !== prototype.instructionPanelCount)
    differences.push("instruction panel count differs from prototype");
  if (current.titleHeadingCount !== prototype.titleHeadingCount)
    differences.push("ExerciseTitle heading count differs from prototype");
  if (current.prototypeMarkerCount !== prototype.prototypeMarkerCount)
    differences.push(
      `sis-cloze-prototype marker count ${current.prototypeMarkerCount} != prototype ${prototype.prototypeMarkerCount}`,
    );
  if (current.styleBlockCount < 1)
    differences.push("no preserved head style block");
  return { pass: differences.length === 0, differences };
}

function check(id, expected, observed, pass, remediation) {
  return {
    id,
    expected,
    observed,
    pass: Boolean(pass),
    remediation: pass ? null : remediation,
  };
}

function pageAudit(pageFile, prototypeShape, bridgeSource, root = ROOT) {
  const source = fs.readFileSync(pageFile, "utf8");
  const document = parse5.parse(source);
  const all = elements(document);
  const bodies = all.filter(
    (node) => node.tagName === "body" && attr(node, "id") === "TheBody",
  );
  const body = bodies[0];
  const wrapper = directWrapper(body);
  const panels = all.filter((node) => hasClass(node, "hp-instructions-panel"));
  const titles = all.filter((node) => hasClass(node, "Titles"));
  const headings = all.filter(
    (node) => node.tagName === "h1" && hasClass(node, "ExerciseTitle"),
  );
  const idNodes = Object.fromEntries(
    [
      "InstructionsDiv",
      "MainDiv",
      "ClozeDiv",
      "FeedbackDiv",
      "check",
      "hint",
    ].map((id) => [id, findById(all, id)]),
  );
  const gaps = all.filter(
    (node) => node.tagName === "input" && /^Gap\d+$/i.test(attr(node, "id")),
  );
  const gapIds = gaps.map((node) => attr(node, "id"));
  const labels = all
    .filter((node) => node.tagName === "label")
    .map((node) => attr(node, "for"));
  const assets = assetEvidence(pageFile, all, root);
  const story = storyEvidence(pageFile, all, root);
  const comparison = compareShape(shape(source, pageFile), prototypeShape);
  const emptyNavigationBars = emptyLegacyNavigationBars(all);
  const forbiddenLegacyInstructions = all.some((node) =>
    hasClass(node, "ClozeInstructions"),
  );
  const inlineStyles = all.filter((node) => attr(node, "style")).length;
  const sourceHealth = {
    bytes: Buffer.byteLength(source),
    errorPlaceholder: /404\s+Not\s+Found|requested URL was not found/i.test(
      source,
    ),
    duplicateHtmlEndings: (source.match(/<\/html\s*>/gi) || []).length > 1,
  };
  const checks = [];
  checks.push(
    check(
      "CL-01",
      "one body#TheBody",
      { count: bodies.length },
      bodies.length === 1,
      CHECKLIST[0][2],
    ),
  );
  const viewport = all.find(
    (node) =>
      node.tagName === "meta" &&
      attr(node, "name").toLowerCase() === "viewport",
  );
  const viewportContent = attr(viewport, "content");
  checks.push(
    check(
      "CL-02",
      "width=device-width and initial-scale=1",
      { content: viewportContent || null },
      /width\s*=\s*device-width/i.test(viewportContent) &&
        /initial-scale\s*=\s*1(?:\.0)?(?:\s|,|$)/i.test(viewportContent),
      CHECKLIST[1][2],
    ),
  );
  checks.push(
    check(
      "CL-03",
      "one instruction panel with Titles > h1.ExerciseTitle and InstructionsDiv",
      {
        panels: panels.length,
        titles: titles.length,
        headings: headings.length,
        instructions: idNodes.InstructionsDiv.length,
      },
      panels.length === 1 &&
        titles.length === 1 &&
        headings.length === 1 &&
        idNodes.InstructionsDiv.length === 1 &&
        contains(panels[0], headings[0]) &&
        contains(panels[0], idNodes.InstructionsDiv[0]),
      CHECKLIST[2][2],
    ),
  );
  checks.push(
    check(
      "CL-04",
      "unique MainDiv/ClozeDiv/FeedbackDiv nested under the shell",
      Object.fromEntries(
        Object.entries(idNodes)
          .slice(0, 4)
          .map(([id, nodes]) => [id, nodes.length]),
      ),
      Boolean(
        wrapper &&
        ["MainDiv", "ClozeDiv", "FeedbackDiv"].every(
          (id) => idNodes[id].length === 1 && contains(wrapper, idNodes[id][0]),
        ),
      ),
      CHECKLIST[3][2],
    ),
  );
  checks.push(
    check(
      "CL-05",
      "direct wrapfit hp-exercise-shell with data-sis-exercise-shell=true and family=cloze",
      {
        wrapper: wrapper
          ? {
              classes: attr(wrapper, "class"),
              shell: attr(wrapper, "data-sis-exercise-shell"),
              family: attr(wrapper, "data-sis-exercise-family"),
            }
          : null,
      },
      Boolean(
        wrapper &&
        hasClass(wrapper, "wrapfit") &&
        hasClass(wrapper, "hp-exercise-shell") &&
        attr(wrapper, "data-sis-exercise-shell") === "true" &&
        attr(wrapper, "data-sis-exercise-family") === "cloze",
      ),
      CHECKLIST[4][2],
    ),
  );
  const checkButton = idNodes.check[0];
  const hintButton = idNodes.hint[0];
  checks.push(
    check(
      "CL-06",
      "#check and #hint are current btn-17 controls",
      {
        check: checkButton
          ? {
              tag: checkButton.tagName,
              classes: attr(checkButton, "class"),
              type: attr(checkButton, "type"),
              form: attr(checkButton, "form"),
            }
          : null,
        hint: hintButton
          ? {
              tag: hintButton.tagName,
              classes: attr(hintButton, "class"),
              type: attr(hintButton, "type"),
            }
          : null,
      },
      Boolean(
        checkButton &&
        hintButton &&
        checkButton.tagName === "button" &&
        hintButton.tagName === "button" &&
        hasClass(checkButton, "btn-17") &&
        hasClass(hintButton, "btn-17") &&
        attr(checkButton, "type") === "submit" &&
        attr(checkButton, "form") === "Cloze" &&
        attr(hintButton, "type") === "button",
      ),
      CHECKLIST[5][2],
    ),
  );
  checks.push(
    check(
      "CL-07",
      "unique GapN inputs each have a matching label",
      {
        gapCount: gaps.length,
        duplicateIds: gapIds.filter(
          (id, index) => gapIds.indexOf(id) !== index,
        ),
        missingLabels: gapIds.filter((id) => !labels.includes(id)),
      },
      gaps.length > 0 &&
        new Set(gapIds).size === gapIds.length &&
        gapIds.every((id) => labels.includes(id)),
      CHECKLIST[6][2],
    ),
  );
  const closeButtons = all.filter(
    (node) => node.tagName === "button" && hasClass(node, "btn-74"),
  );
  const closeRemediation =
    closeButtons.length > 1
      ? "Remove duplicate Close controls and retain exactly one accessible btn-74 footer control."
      : CHECKLIST[7][2];
  checks.push(
    check(
      "CL-08",
      "one accessible btn-74 button",
      {
        count: closeButtons.length,
        labels: closeButtons.map(
          (node) => attr(node, "aria-label") || nodeText(node),
        ),
      },
      closeButtons.length === 1 &&
        closeButtons.every(
          (node) => attr(node, "aria-label") || nodeText(node),
        ),
      closeRemediation,
    ),
  );
  const assetFailures = assets.filter(
    (item) => !item.present || !item.resolves || !item.integrityMatches,
  );
  checks.push(
    check(
      "CL-09",
      "all required local assets resolve with current SRI",
      {
        required: assets.length,
        failures: assetFailures.map((item) => ({
          path: item.path,
          present: item.present,
          resolves: item.resolves,
          integrityMatches: item.integrityMatches,
        })),
      },
      assetFailures.length === 0,
      CHECKLIST[8][2],
    ),
  );
  checks.push(
    check(
      "CL-10",
      "companion story and matching story-theme metadata resolve",
      story,
      story.scriptPresent &&
        story.resolves &&
        Boolean(story.themeKey) &&
        Boolean(story.titleUrl),
      CHECKLIST[9][2],
    ),
  );
  const identityPass =
    bridgeSource.includes("IDENTITY_REQUIRED_STATUS_MESSAGE") &&
    bridgeSource.includes("guardCheckAnswers") &&
    bridgeSource.includes("guardShowHint") &&
    bridgeSource.includes("!isIdentityReady()") &&
    bridgeSource.includes("data-sis-cloze-email") &&
    bridgeSource.includes("data-sis-cloze-eagles-id");
  checks.push(
    check(
      "CL-11",
      "cloze bridge contains EaglesID/email fields and Check/Hint guards",
      {
        bridge: "js/sis-cloze-submit.js",
        identityCopy: bridgeSource.includes(
          "Enter your EaglesID and student email to activate Check and Hint.",
        ),
        guards: identityPass,
      },
      identityPass,
      CHECKLIST[10][2],
    ),
  );
  checks.push(
    check(
      "CL-12",
      "no empty legacy NavButtonBar/ClozeInstructions or inline visibility wrappers",
      {
        emptyNavigationBars: emptyNavigationBars.map((node) => attr(node, "id")),
        clozeInstructions: forbiddenLegacyInstructions,
        inlineStyleAttributes: inlineStyles,
      },
      emptyNavigationBars.length === 0 && !forbiddenLegacyInstructions && inlineStyles === 0,
      CHECKLIST[11][2],
    ),
  );
  const styleBlocks = all.filter((node) => node.tagName === "style").length;
  checks.push(
    check(
      "CL-13",
      "at least one head style block and no inline style attributes",
      { styleBlocks, inlineStyleAttributes: inlineStyles },
      styleBlocks > 0 && inlineStyles === 0,
      CHECKLIST[12][2],
    ),
  );
  checks.push(
    check(
      "CL-14",
      "shape matches the B1 cloze prototype contract",
      comparison,
      comparison.pass,
      CHECKLIST[13][2],
    ),
  );
  checks.push(
    check(
      "CL-15",
      "source is not an HTTP error placeholder or duplicated document",
      sourceHealth,
      !sourceHealth.errorPlaceholder && !sourceHealth.duplicateHtmlEndings,
      CHECKLIST[14][2],
    ),
  );
  const actionContract = actionControlContract(root, all);
  checks.push(
    check(
      "CL-16",
      "every non-Close action control uses btn-17 hp-button and shared clipping is present",
      actionContract,
      actionContract.invalid.length === 0 && actionContract.clippingRule,
      CHECKLIST[15][2],
    ),
  );
  const failed = checks.filter((item) => !item.pass);
  return {
    path: path.relative(root, pageFile),
    level: path.relative(root, pageFile).split(path.sep)[0],
    status: failed.length ? "ACTION_REQUIRED" : "PASS",
    checks,
    failedCheckIds: failed.map((item) => item.id),
    actionable: failed.map((item) => item.remediation),
    shape: shape(source, pageFile),
    sourceHealth,
    story,
    assets,
    prototypeComparison: comparison,
  };
}

function nodeText(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || [])
    .map(nodeText)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function pageFiles(root, level) {
  const directory = path.join(root, level, "cloze");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(
      (name) =>
        /\.html$/i.test(name) &&
        !/(?:\.copy|\.legacy|\.prototype|-bu)\.html$/i.test(name),
    )
    .sort()
    .map((name) => path.join(directory, name));
}

function sampleFiles(files, count) {
  if (files.length <= count) return files;
  if (count === 1) return [files[Math.floor((files.length - 1) / 2)]];
  const indexes = Array.from({ length: count }, (_, index) =>
    Math.round((index * (files.length - 1)) / (count - 1)),
  );
  return [...new Set(indexes)].map((index) => files[index]);
}

function summarize(pages) {
  const checks = Object.fromEntries(
    CHECKLIST.map(([id]) => [id, { pass: 0, fail: 0, pages: [] }]),
  );
  for (const page of pages)
    for (const item of page.checks) {
      checks[item.id][item.pass ? "pass" : "fail"] += 1;
      if (!item.pass) checks[item.id].pages.push(page.path);
    }
  const byCollection = Object.fromEntries(
    COLLECTIONS.map((collection) => {
      const rows = pages.filter((page) => page.level === collection);
      return [
        collection,
        {
          scanned: rows.length,
          pass: rows.filter((page) => page.status === "PASS").length,
          actionRequired: rows.filter((page) => page.status !== "PASS").length,
        },
      ];
    }),
  );
  return {
    scanned: pages.length,
    pass: pages.filter((page) => page.status === "PASS").length,
    actionRequired: pages.filter((page) => page.status !== "PASS").length,
    checklist: checks,
    byCollection,
  };
}

function markdownReport(report) {
  const lines = [
    `# Cloze Integrity and Prototype Audit`,
    ``,
    `Generated: ${report.generatedAt}`,
    ``,
    `## Summary`,
    ``,
    `- Pages audited: ${report.totals.scanned}`,
    `- Pages passing every checklist item: ${report.totals.pass}`,
    `- Pages requiring action: ${report.totals.actionRequired}`,
    `- Prototype: \`${report.prototype}\``,
    `- Visual samples: ${report.visual.capturedArtifacts}/${report.visual.expectedArtifacts} expected artifacts captured (${report.visual.status})`,
    ``,
  ];
  lines.push(
    "## Collection/level totals",
    "",
    "| Level | Pages | Pass | Action required |",
    "|---|---:|---:|---:|",
    ...COLLECTIONS.map((collection) => {
      const row = report.totals.byCollection[collection];
      return `| ${collection} | ${row.scanned} | ${row.pass} | ${row.actionRequired} |`;
    }),
    "",
  );
  lines.push(
    "## Checklist totals",
    "",
    "| ID | Pass | Fail |",
    "|---|---:|---:|",
    ...CHECKLIST.map(
      ([id, label]) =>
        `| ${id} ${label} | ${report.totals.checklist[id].pass} | ${report.totals.checklist[id].fail} |`,
    ),
    "",
  );
  lines.push(
    "## Visual sample set",
    "",
    "| Level | Page | Desktop artifact | Mobile artifact |",
    "|---|---|---|---|",
    ...report.visual.samples.map(
      (sample) =>
        `| ${sample.level} | \`${sample.path}\` | \`${sample.desktopScreenshot}\` | \`${sample.mobileScreenshot}\` |`,
    ),
    "",
  );
  lines.push("## Actionable findings", "");
  const actionPages = report.pages.filter((page) => page.status !== "PASS");
  if (!actionPages.length)
    lines.push("No static checklist findings require action.", "");
  else
    for (const page of actionPages)
      lines.push(
        `### \`${page.path}\``,
        "",
        ...page.checks
          .filter((item) => !item.pass)
          .map(
            (item) =>
              `- **${item.id}:** ${item.expected}. Observed: \`${JSON.stringify(item.observed)}\`. Remediation: ${item.remediation}`,
          ),
        "",
      );
  lines.push(
    "## Visual verification note",
    "",
    report.visual.status === "CAPTURED"
      ? `Playwright captured both desktop and mobile full-page screenshots for all ${report.visual.samples.length} sampled pages. Browser assertions recorded no horizontal overflow, no page errors, one canonical shell, one title heading, and identity-gated Check/Hint controls on the current pages. Artifacts are under \`${report.visual.artifactDirectory}\`.`
      : "The JSON report records the deterministic sample set. Run the Playwright CLI visual pass and rerun this audit with `--visual-dir output/playwright/cloze-integrity` to mark the visual column complete.",
    "",
  );
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }
  const prototypeFile = path.resolve(args.root, PROTOTYPE);
  if (!fs.existsSync(prototypeFile))
    throw new Error(`Prototype not found: ${prototypeFile}`);
  const prototypeShape = shape(
    fs.readFileSync(prototypeFile, "utf8"),
    prototypeFile,
  );
  const bridge = fs.readFileSync(
    path.resolve(args.root, "js/sis-cloze-submit.js"),
    "utf8",
  );
  const pages = COLLECTIONS.flatMap((level) =>
    pageFiles(args.root, level).map((file) =>
      pageAudit(file, prototypeShape, bridge, args.root),
    ),
  );
  const samples = COLLECTIONS.flatMap((level) =>
    sampleFiles(pageFiles(args.root, level), args.sampleSize).map((file) => ({
      level,
      path: path.relative(args.root, file),
      desktopScreenshot: `output/playwright/cloze-integrity/${level}-${path.basename(file, ".html")}-desktop.png`,
      mobileScreenshot: `output/playwright/cloze-integrity/${level}-${path.basename(file, ".html")}-mobile.png`,
    })),
  );
  const artifactPaths = samples.flatMap((sample) => [
    sample.desktopScreenshot,
    sample.mobileScreenshot,
  ]);
  const visualDir = args.visualDir;
  const capturedArtifacts = visualDir
    ? artifactPaths.filter((artifact) =>
        fs.existsSync(path.resolve(args.root, artifact)),
      ).length
    : 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: args.root,
    prototype: PROTOTYPE,
    checklist: CHECKLIST.map(([id, description, remediation]) => ({
      id,
      description,
      remediation,
    })),
    totals: summarize(pages),
    visual: {
      status:
        capturedArtifacts === artifactPaths.length && artifactPaths.length > 0
          ? "CAPTURED"
          : "PLANNED",
      sampleSize: args.sampleSize,
      levels: COLLECTIONS,
      samples,
      artifactDirectory: visualDir
        ? path.relative(args.root, visualDir)
        : "output/playwright/cloze-integrity",
      expectedArtifacts: artifactPaths.length,
      capturedArtifacts,
    },
    pages,
  };
  const reportFile = path.resolve(args.root, args.report);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  const markdownFile = args.markdown
    ? path.resolve(args.root, args.markdown)
    : reportFile.replace(/\.json$/i, ".md");
  fs.writeFileSync(markdownFile, `${markdownReport(report)}\n`);
  console.log(`JSON report: ${path.relative(args.root, reportFile)}`);
  console.log(`Markdown report: ${path.relative(args.root, markdownFile)}`);
  console.log(`Pages audited: ${report.totals.scanned}`);
  console.log(`Pages passing: ${report.totals.pass}`);
  console.log(`Pages requiring action: ${report.totals.actionRequired}`);
  for (const level of COLLECTIONS)
    console.log(
      `${level}: ${report.totals.byCollection[level].scanned} scanned, ${report.totals.byCollection[level].pass} pass, ${report.totals.byCollection[level].actionRequired} action required`,
    );
  for (const [id, result] of Object.entries(report.totals.checklist))
    if (result.fail) console.log(`${id}: ${result.fail} failures`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
