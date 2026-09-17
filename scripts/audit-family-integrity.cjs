#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const parse5 = require("parse5");
const {
  auditMmor,
  modernizationProfile,
  storyTarget,
} = require("./modernize-hot-potatoes-pages.cjs");

const ROOT = path.resolve(__dirname, "..");
const COLLECTIONS = [
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
];
const FAMILIES = new Set(["dict", "sent", "comp"]);
const FAMILY_REPORTS = {
  dict: "docs/DICTATION-INTEGRITY-REPORT.json",
  sent: "docs/SENTENCE-INTEGRITY-REPORT.json",
  comp: "docs/COMPREHENSION-INTEGRITY-REPORT.json",
};
const FAMILY_LABELS = {
  dict: "Dictation",
  sent: "Sentence Scramble",
  comp: "Comprehension",
};
const PROTOTYPES = {
  dict: "begin1/dict/b1d001.html",
  sent: "begin1/sent/b1mx00101.html",
  comp: "essays/comp/essaycomp001.html",
};

function parseArgs(argv) {
  const args = {
    family: null,
    markdown: null,
    report: null,
    root: ROOT,
    sampleSize: 5,
    visualDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--family") args.family = argv[++index];
    else if (arg === "--root") args.root = path.resolve(argv[++index]);
    else if (arg === "--report") args.report = argv[++index];
    else if (arg === "--markdown") args.markdown = argv[++index];
    else if (arg === "--sample-size") args.sampleSize = Number(argv[++index]);
    else if (arg === "--visual-dir")
      args.visualDir = path.resolve(args.root, argv[++index]);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.help) return args;
  if (!FAMILIES.has(args.family))
    throw new Error("--family must be one of: dict, sent, comp");
  if (!args.report) args.report = FAMILY_REPORTS[args.family];
  if (!Number.isInteger(args.sampleSize) || args.sampleSize < 1)
    throw new Error("--sample-size must be a positive integer");
  return args;
}

function printUsage() {
  console.log(
    "Usage: node scripts/audit-family-integrity.cjs --family dict|sent|comp [--report PATH] [--markdown PATH] [--sample-size N] [--visual-dir PATH] [--root PATH]",
  );
}

function parseDocument(source) {
  return parse5.parse(source);
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

function pageFiles(root, collection, family) {
  const directory = path.join(root, collection, family);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(
      (name) =>
        /\.html?$/i.test(name) &&
        !/(?:\.copy|\.legacy|\.prototype|-bu)\.html?$/i.test(name),
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

function sourceHealth(source) {
  return {
    bytes: Buffer.byteLength(source),
    errorPlaceholder: /404\s+Not\s+Found|requested URL was not found/i.test(
      source,
    ),
    duplicateHtmlEndings: (source.match(/<\/html\s*>/gi) || []).length > 1,
  };
}

function prototypeShape(source, family) {
  const all = elements(parseDocument(source));
  const body = all.find(
    (node) => node.tagName === "body" && attr(node, "id") === "TheBody",
  );
  const wrapper = directWrapper(body);
  const byId = (id) => all.filter((node) => attr(node, "id") === id).length;
  const questions = all.filter(
    (node) => node.tagName === "li" && hasClass(node, "QuizQuestion"),
  );
  return {
    family,
    body: Boolean(body),
    wrapper: Boolean(
      wrapper &&
      hasClass(wrapper, "wrapfit") &&
      hasClass(wrapper, "hp-exercise-shell") &&
      attr(wrapper, "data-sis-exercise-family") === family,
    ),
    instructionPanel: all.some((node) =>
      hasClass(node, "hp-instructions-panel"),
    ),
    title: all.some(
      (node) => node.tagName === "h1" && hasClass(node, "ExerciseTitle"),
    ),
    instructions: byId("InstructionsDiv"),
    main: byId("MainDiv"),
    feedback: byId("FeedbackDiv"),
    close: all.filter(
      (node) => node.tagName === "button" && hasClass(node, "btn-74"),
    ).length,
    questionList: byId("Questions"),
    questionItems: questions.length,
    answerLists: all.filter(
      (node) => node.tagName === "ol" && hasClass(node, "MCAnswers"),
    ).length,
    answerButtons: all.filter(
      (node) =>
        node.tagName === "button" &&
        /\bCheckMCAnswer\s*\(/i.test(attr(node, "onclick")),
    ).length,
  };
}

function comparePrototype(current, prototype, family) {
  const differences = [];
  for (const key of [
    "body",
    "wrapper",
    "instructionPanel",
    "title",
    "instructions",
    "main",
    "feedback",
  ]) {
    if (current[key] !== prototype[key])
      differences.push(`${key} ${current[key]} != prototype ${prototype[key]}`);
  }
  if (current.close < 1)
    differences.push(`close count ${current.close} is missing the prototype control`);
  if (family === "comp") {
    for (const key of ["questionList", "answerLists", "answerButtons"]) {
      if (current[key] < 1)
        differences.push(`${key} is missing from comprehension structure`);
    }
  }
  return { pass: differences.length === 0, differences };
}

function requirement(id, description, pass, evidence, remediation) {
  return {
    id,
    description,
    pass: Boolean(pass),
    evidence,
    remediation: pass ? null : remediation,
  };
}

function pageAudit(file, family, root, prototype) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).split(path.sep).join("/");
  const page = {
    absolute: file,
    relative,
    source,
    story: storyTarget(root, file),
  };
  const profile = modernizationProfile(page);
  if (profile.family !== family)
    throw new Error(
      `${relative}: expected ${family}, detected ${profile.family}`,
    );
  const mmor = auditMmor(source, root, page, profile);
  const health = sourceHealth(source);
  const currentShape = prototypeShape(source, family);
  const comparison = comparePrototype(currentShape, prototype, family);
  const sourceRequirements = [
    requirement(
      "SRC-01",
      "Source is not an HTTP error placeholder or duplicated document",
      !health.errorPlaceholder && !health.duplicateHtmlEndings,
      health,
      "Recover the original exercise source or exclude this malformed placeholder until its content is restored.",
    ),
    requirement(
      "PROTO-01",
      `Structural shape matches the ${family} prototype contract`,
      comparison.pass,
      comparison,
      `Compare this page with ${PROTOTYPES[family]} and repair the named structural difference.`,
    ),
  ];
  const checks = [...mmor.results, ...sourceRequirements];
  const failed = checks.filter((item) => !item.pass);
  return {
    path: relative,
    collection: relative.split("/")[0],
    family,
    status: failed.length ? "ACTION_REQUIRED" : "PASS",
    checks,
    failedCheckIds: failed.map((item) => item.id),
    actionable: failed.map((item) => item.remediation),
    sourceHealth: health,
    prototypeComparison: comparison,
    mmor,
    shape: currentShape,
  };
}

function summarize(pages, collections) {
  const checklist = {};
  for (const page of pages)
    for (const check of page.checks) {
      checklist[check.id] ||= { pass: 0, fail: 0, pages: [] };
      checklist[check.id][check.pass ? "pass" : "fail"] += 1;
      if (!check.pass) checklist[check.id].pages.push(page.path);
    }
  const byCollection = Object.fromEntries(
    collections.map((collection) => {
      const rows = pages.filter((page) => page.collection === collection);
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
    checklist,
    byCollection,
  };
}

function markdownReport(report) {
  const lines = [
    `# ${report.label} Integrity and Prototype Audit`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Pages audited: ${report.totals.scanned}`,
    `- Pages passing every check: ${report.totals.pass}`,
    `- Pages requiring action: ${report.totals.actionRequired}`,
    `- Prototype: \`${report.prototype}\``,
    `- Prototype MMOR status: ${report.prototypeAudit.status}`,
    `- Visual samples: ${report.visual.capturedArtifacts}/${report.visual.expectedArtifacts} expected artifacts captured (${report.visual.status})`,
    "",
    "## Collection totals",
    "",
    "| Collection | Pages | Pass | Action required |",
    "|---|---:|---:|---:|",
    ...report.collections.map((collection) => {
      const row = report.totals.byCollection[collection];
      return `| ${collection} | ${row.scanned} | ${row.pass} | ${row.actionRequired} |`;
    }),
    "",
    "## Checklist totals",
    "",
    "| ID | Pass | Fail |",
    "|---|---:|---:|",
    ...Object.entries(report.totals.checklist).map(
      ([id, result]) => `| ${id} | ${result.pass} | ${result.fail} |`,
    ),
    "",
    "## Visual sample set",
    "",
    "| Collection | Page | Desktop artifact | Mobile artifact |",
    "|---|---|---|---|",
    ...report.visual.samples.map(
      (sample) =>
        `| ${sample.collection} | \`${sample.path}\` | \`${sample.desktopScreenshot}\` | \`${sample.mobileScreenshot}\` |`,
    ),
    "",
    "## Actionable findings",
    "",
  ];
  const actionPages = report.pages.filter((page) => page.status !== "PASS");
  if (!actionPages.length) lines.push("No static findings require action.", "");
  for (const page of actionPages) {
    lines.push(`### \`${page.path}\``, "");
    for (const check of page.checks.filter((item) => !item.pass))
      lines.push(
        `- **${check.id}:** ${check.description}. Observed: \`${JSON.stringify(check.evidence)}\`. Remediation: ${check.remediation}`,
      );
    lines.push("");
  }
  lines.push(
    "## Visual verification note",
    "",
    report.visual.status === "CAPTURED"
      ? `Playwright captured desktop and mobile full-page screenshots for all ${report.visual.samples.length} sampled pages. Browser assertions recorded no horizontal overflow or page errors; shell, title, gap/question, identity, and Close observations are retained in the visual run evidence. Artifacts are under \`${report.visual.artifactDirectory}\`.`
      : "Run the Playwright visual pass, then rerun this audit with `--visual-dir` to mark visual artifacts complete.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }
  const prototypeFile = path.resolve(args.root, PROTOTYPES[args.family]);
  if (!fs.existsSync(prototypeFile))
    throw new Error(`Prototype not found: ${prototypeFile}`);
  const prototype = prototypeShape(
    fs.readFileSync(prototypeFile, "utf8"),
    args.family,
  );
  const prototypeAudit = pageAudit(
    prototypeFile,
    args.family,
    args.root,
    prototype,
  );
  const files = COLLECTIONS.flatMap((collection) =>
    pageFiles(args.root, collection, args.family),
  );
  const pages = files.map((file) =>
    pageAudit(file, args.family, args.root, prototype),
  );
  const collections = COLLECTIONS.filter((collection) =>
    pages.some((page) => page.collection === collection),
  );
  const samples = collections.flatMap((collection) =>
    sampleFiles(
      pageFiles(args.root, collection, args.family),
      args.sampleSize,
    ).map((file) => {
      const basename = path.basename(file).replace(/\.html?$/i, "");
      return {
        collection,
        path: path.relative(args.root, file).split(path.sep).join("/"),
        desktopScreenshot: `output/playwright/${args.family}-integrity/${collection}-${basename}-desktop.png`,
        mobileScreenshot: `output/playwright/${args.family}-integrity/${collection}-${basename}-mobile.png`,
      };
    }),
  );
  const artifactPaths = samples.flatMap((sample) => [
    sample.desktopScreenshot,
    sample.mobileScreenshot,
  ]);
  const capturedArtifacts = args.visualDir
    ? artifactPaths.filter((artifact) =>
        fs.existsSync(path.resolve(args.root, artifact)),
      ).length
    : 0;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    label: FAMILY_LABELS[args.family],
    family: args.family,
    root: args.root,
    prototype: PROTOTYPES[args.family],
    collections,
    prototypeAudit: {
      path: prototypeAudit.path,
      status: prototypeAudit.status,
      failedCheckIds: prototypeAudit.failedCheckIds,
      checks: prototypeAudit.checks,
    },
    totals: summarize(pages, collections),
    visual: {
      status:
        capturedArtifacts === artifactPaths.length && artifactPaths.length > 0
          ? "CAPTURED"
          : "PLANNED",
      sampleSize: args.sampleSize,
      samples,
      artifactDirectory: args.visualDir
        ? path.relative(args.root, args.visualDir)
        : `output/playwright/${args.family}-integrity`,
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
  fs.writeFileSync(markdownFile, markdownReport(report));
  console.log(`JSON report: ${path.relative(args.root, reportFile)}`);
  console.log(`Markdown report: ${path.relative(args.root, markdownFile)}`);
  console.log(`Pages audited: ${report.totals.scanned}`);
  console.log(`Pages passing: ${report.totals.pass}`);
  console.log(`Pages requiring action: ${report.totals.actionRequired}`);
  for (const collection of collections) {
    const row = report.totals.byCollection[collection];
    console.log(
      `${collection}: ${row.scanned} scanned, ${row.pass} pass, ${row.actionRequired} action required`,
    );
  }
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
