const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectAssetState } = require("./sri-rehash-watch.cjs");

const {
  applyPagePlans,
  applySafetyError,
  CURRENT_MODERNIZATION_VERSION,
  collectAssetInfo,
  extractHeadStyleBlocks,
  MAX_SAFE_APPLY_PAGES,
  normalizeFeedbackPage,
  normalizePage,
  normalizeStyleValue,
  modernizationProfile,
  parseArgs,
  preflightBlockingReason,
  scanTargets,
  summarizePagePlans,
  storyTarget,
  transformMarkup,
  validatePageMmor,
  verifyPostConversionPage,
} = require("./modernize-hot-potatoes-pages.cjs");

test("page summaries separate original family gaps from file updates", () => {
  const plans = [
    {
      result: { family: "cloze", sourceRequirementGaps: [] },
      source: "current-cloze",
      updated: "current-cloze",
    },
    {
      result: { family: "dict", sourceRequirementGaps: ["selector .hp-instructions-panel"] },
      source: "legacy-dict",
      updated: "modern-dict",
    },
    {
      result: { family: "sent", sourceRequirementGaps: [] },
      source: "old-sri-sent",
      updated: "current-sri-sent",
    },
  ];

  const summary = summarizePagePlans(plans);
  assert.equal(summary.alreadyCompliant, 1);
  assert.equal(summary.fileUpdates, 2);
  assert.equal(summary.sourceRequirementGaps, 1);
  assert.deepEqual(summary.byFamily.get("cloze"), {
    alreadyCompliant: 1,
    fileUpdates: 0,
    sourceRequirementGaps: 0,
  });
  assert.deepEqual(summary.byFamily.get("dict"), {
    alreadyCompliant: 0,
    fileUpdates: 1,
    sourceRequirementGaps: 1,
  });
  assert.deepEqual(summary.byFamily.get("sent"), {
    alreadyCompliant: 0,
    fileUpdates: 1,
    sourceRequirementGaps: 0,
  });
});

test("bulk page applies fail closed unless an explicit scoped override is supplied", () => {
  assert.equal(
    applySafetyError({ allowBulk: false, scopes: [] }, MAX_SAFE_APPLY_PAGES),
    null,
  );
  assert.match(
    applySafetyError(
      { allowBulk: false, scopes: ["begin1"] },
      MAX_SAFE_APPLY_PAGES + 1,
    ),
    /safe limit is 50/,
  );
  assert.match(
    applySafetyError({ allowBulk: true, scopes: [] }, MAX_SAFE_APPLY_PAGES + 1),
    /explicit --scope/,
  );
  assert.equal(
    applySafetyError(
      { allowBulk: true, scopes: ["begin1"] },
      MAX_SAFE_APPLY_PAGES + 1,
    ),
    null,
  );
  assert.throws(
    () => parseArgs(["--allow-bulk"]),
    /requires at least one explicit --scope/,
  );
  assert.deepEqual(parseArgs(["--allow-bulk", "--scope", "begin1"]).scopes, [
    "begin1",
  ]);
  assert.equal(
    parseArgs(["--allow-blocked", "--scope", "begin2"]).allowBlocked,
    true,
  );
  assert.throws(
    () => parseArgs(["--allow-blocked"]),
    /requires at least one explicit --scope or --path/,
  );
  assert.match(
    preflightBlockingReason(
      { ambiguous: [], unmapped: [], failures: ["begin2/dict/b2d031.html: incomplete source"] },
      { allowBlocked: false },
    ),
    /transformation failed/,
  );
  assert.equal(
    preflightBlockingReason(
      { ambiguous: [], unmapped: [], failures: ["begin2/dict/b2d031.html: incomplete source"] },
      { allowBlocked: true },
    ),
    null,
  );
  assert.match(
    preflightBlockingReason(
      { ambiguous: ["begin2/dict/ambiguous.html"], unmapped: [], failures: [] },
      { allowBlocked: true },
    ),
    /ambiguous/,
  );
});

test("apply refuses a batch over the limit before creating backups or changing files", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-bulk-gate-"),
  );
  let backupCalls = 0;
  try {
    const plans = Array.from(
      { length: MAX_SAFE_APPLY_PAGES + 1 },
      (_, index) => {
        const relative = `begin1/dict/page-${index}.html`;
        const absolute = path.join(root, relative);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, `original-${index}`);
        return {
          absolute,
          relative,
          source: `original-${index}`,
          updated: `updated-${index}`,
        };
      },
    );

    assert.throws(
      () =>
        applyPagePlans(
          plans,
          { allowBulk: false, apply: true, root, scopes: ["begin1"] },
          {
            runRoot: path.join(root, "backup"),
            backupBeforeWrite() {
              backupCalls += 1;
            },
          },
        ),
      /Refusing to apply 51 changed pages/,
    );
    assert.equal(backupCalls, 0);
    for (const plan of plans)
      assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.source);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("apply verifies every backup before writing any page", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-backup-check-"),
  );
  const backupRoot = path.join(root, "backup");
  try {
    const plans = ["one", "two"].map((name) => {
      const relative = `begin1/dict/${name}.html`;
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `original-${name}`);
      return {
        absolute,
        relative,
        source: `original-${name}`,
        updated: `updated-${name}`,
      };
    });
    const backupManager = {
      runRoot: backupRoot,
      backupBeforeWrite(file) {
        const relative = path.relative(root, file);
        const target = path.join(backupRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
        if (relative.endsWith("two.html"))
          fs.writeFileSync(target, "wrong backup");
      },
    };

    assert.throws(
      () =>
        applyPagePlans(
          plans,
          { allowBulk: false, apply: true, root, scopes: ["begin1"] },
          backupManager,
        ),
      /two\.html: backup verification failed/,
    );
    for (const plan of plans)
      assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.source);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("apply writes changed pages only after byte-identical backups are ready", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-safe-apply-"),
  );
  const backupRoot = path.join(root, "backup");
  try {
    const plans = ["one", "two"].map((name) => {
      const relative = `begin1/dict/${name}.html`;
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `original-${name}`);
      return {
        absolute,
        relative,
        source: `original-${name}`,
        updated: `updated-${name}`,
      };
    });
    const backupManager = {
      runRoot: backupRoot,
      backupBeforeWrite(file) {
        const relative = path.relative(root, file);
        const target = path.join(backupRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
      },
    };

    const result = applyPagePlans(
      plans,
      { allowBulk: false, apply: true, root, scopes: ["begin1"] },
      backupManager,
    );
    assert.equal(result.changedCount, 2);
    for (const plan of plans) {
      assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.updated);
      assert.equal(
        fs.readFileSync(path.join(backupRoot, plan.relative), "utf8"),
        plan.source,
      );
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("a failed atomic replacement rolls back pages already written in the batch", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-apply-rollback-"),
  );
  const backupRoot = path.join(root, "backup");
  const plans = ["one", "two"].map((name) => {
    const relative = `begin1/dict/${name}.html`;
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `original-${name}`);
    return {
      absolute,
      relative,
      source: `original-${name}`,
      updated: `updated-${name}`,
    };
  });
  const backupManager = {
    runRoot: backupRoot,
    backupBeforeWrite(file) {
      const relative = path.relative(root, file);
      const target = path.join(backupRoot, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    },
  };
  const originalRename = fs.renameSync;
  let replacementCount = 0;

  fs.renameSync = function failSecondReplacement(...args) {
    replacementCount += 1;
    if (replacementCount === 2) throw new Error("injected replacement failure");
    return originalRename.apply(this, args);
  };
  try {
    assert.throws(
      () =>
        applyPagePlans(
          plans,
          { allowBulk: false, apply: true, root, scopes: ["begin1"] },
          backupManager,
        ),
      /Apply failed: injected replacement failure\. All pages written before the failure were restored/,
    );
  } finally {
    fs.renameSync = originalRename;
  }

  try {
    for (const plan of plans) {
      assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.source);
      assert.equal(
        fs.readFileSync(path.join(backupRoot, plan.relative), "utf8"),
        plan.source,
      );
    }
    assert.deepEqual(fs.readdirSync(path.dirname(plans[0].absolute)), [
      "one.html",
      "two.html",
    ]);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("apply rejects stale preflight content instead of overwriting current work", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-stale-plan-"),
  );
  let backupCalls = 0;
  try {
    const absolute = path.join(root, "begin1/dict/page.html");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, "new concurrent content");
    const plan = {
      absolute,
      relative: "begin1/dict/page.html",
      source: "old preflight content",
      updated: "modernized content",
    };

    assert.throws(
      () =>
        applyPagePlans(
          [plan],
          { allowBulk: false, apply: true, root, scopes: ["begin1"] },
          {
            runRoot: path.join(root, "backup"),
            backupBeforeWrite() {
              backupCalls += 1;
            },
          },
        ),
      /changed after preflight/,
    );
    assert.equal(backupCalls, 0);
    assert.equal(fs.readFileSync(absolute, "utf8"), "new concurrent content");
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("cloze action buttons clip pseudo-effects within their bounds", () => {
  const root = path.resolve(__dirname, "..");
  const css = fs.readFileSync(
    path.join(root, "css/sis-cloze-submit.css"),
    "utf8",
  );
  const clozeButtonRule = css.match(
    /body#TheBody\s+\.sis-exercise-content\s+\.sis-exercise-controls\s+button\.hp-button\.btn-17,\s*body#TheBody\s+\.sis-exercise-content\s+\.sis-exercise-controls\s+input\.hp-button\.btn-17\s*\{[^}]*\}/,
  )?.[0];

  assert.ok(clozeButtonRule, "cloze controls need a scoped button rule");
  assert.match(clozeButtonRule, /box-shadow:\s*none/);
  assert.match(clozeButtonRule, /overflow:\s*hidden/);

  const clozePseudoRule = css.match(
    /body#TheBody\s+\.sis-exercise-content\s+\.sis-exercise-controls\s+button\.hp-button\.btn-17::before,[\s\S]*?\s+\{[^}]*\}/,
  )?.[0];
  assert.ok(
    clozePseudoRule,
    "cloze controls need a scoped pseudo-element rule",
  );
  assert.match(clozePseudoRule, /animation:\s*none/);
  assert.match(clozePseudoRule, /box-shadow:\s*none/);
  assert.match(clozePseudoRule, /content:\s*none/);
  assert.match(
    css,
    /body#TheBody\s+\.sis-exercise-content\s+\.sis-exercise-controls\s+button\.hp-button\.btn-17,\s*body#TheBody\s+\.sis-exercise-content\s+\.sis-exercise-controls\s+input\.hp-button\.btn-17\s*\{[^}]*overflow:\s*hidden/s,
  );
});

test("the SRI watcher tracks shared CSS, JavaScript, and theme assets", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-sri-watch-"),
  );
  try {
    for (const [relative, contents] of [
      ["css/sis-hot-potatoes.css", ".exercise { color: blue; }"],
      [
        "js/hot-potatoes-ui.js",
        "document.documentElement.dataset.ready = 'true';",
      ],
      ["css/sis-cloze-submit.css", ".sis-exercise-content { display: grid; }"],
      ["css/sis-exercise-layout.css", ".sis-exercise-shell { display: grid; }"],
      ["js/sis-cloze-submit.js", "window.sisClozeReady = true;"],
      ["js/sis-exercise-submit.js", "window.sisExerciseReady = true;"],
      ["style/font-stack.css", ":root { color-scheme: light; }"],
    ]) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }

    assert.deepEqual([...collectAssetState(root).keys()].sort(), [
      "css/sis-cloze-submit.css",
      "css/sis-exercise-layout.css",
      "css/sis-hot-potatoes.css",
      "js/hot-potatoes-ui.js",
      "js/sis-cloze-submit.js",
      "js/sis-exercise-submit.js",
      "style/font-stack.css",
    ]);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("inline display and visibility declarations map to shared classes", () => {
  assert.deepEqual(normalizeStyleValue("display: none;"), ["hp-display-none"]);
  assert.deepEqual(normalizeStyleValue("visibility: hidden;"), [
    "hp-visibility-hidden",
  ]);
  assert.throws(
    () => normalizeStyleValue("color: red;"),
    /unsupported inline style/,
  );
});

test("story themes select predeclared CSS assets without writing inline styles", () => {
  const root = path.resolve(__dirname, "..");
  const themeScript = fs.readFileSync(
    path.join(root, "js/story-theme.js"),
    "utf8",
  );
  const themeSelector = fs.readFileSync(
    path.join(root, "js/theme-selector.js"),
    "utf8",
  );
  const storyCss = fs.readFileSync(path.join(root, "style/style.css"), "utf8");
  const fontCss = fs.readFileSync(
    path.join(root, "style/font-stack.css"),
    "utf8",
  );
  const exerciseCss = fs.readFileSync(
    path.join(root, "css/sis-hot-potatoes.css"),
    "utf8",
  );

  assert.doesNotMatch(themeScript, /\.style\.(?:setProperty|background)/);
  assert.doesNotMatch(themeScript, /dk-rusttan_grunge\.webp\.fw\.png/);
  assert.doesNotMatch(themeSelector, /\.style\./);
  assert.match(
    fontCss,
    /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/,
  );
  assert.match(
    fontCss,
    /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/,
  );
  assert.match(themeScript, /setAttribute\("data-story-background"/);
  assert.match(themeScript, /setAttribute\("data-story-paper"/);
  for (const css of [storyCss, exerciseCss]) {
    assert.doesNotMatch(css, /dk-rusttan_grunge\.webp\.fw\.png/);
    assert.match(
      css,
      /html\[data-story-background="green_dust_scratch\.jpg"\]/,
    );
    assert.match(css, /html\[data-story-paper="ep_naturalwhite\.webp"\]/);
  }
});

test("title text is normalized to the prototype h1, using the page title only when the panel is empty", () => {
  const emptyTitle = `<html><head><title>Scrambled Sentences B1 00205: 2. First Day of School</title></head><body><div class="Titles">\n\n</div><div id="InstructionsDiv">Instructions</div></body></html>`;
  const restored = transformMarkup(emptyTitle, "begin1/sent/b1mx00205.html");
  assert.match(
    restored.source,
    /<div class="Titles"><h1 class="ExerciseTitle">2\. First Day of School<\/h1><\/div>/,
  );
  assert.equal(restored.counters.titleHeadingsCreated, 1);

  const plainTitle = `<div class="Titles">72. What Is in a Magazine?</div><div id="InstructionsDiv">Instructions</div>`;
  const normalized = transformMarkup(plainTitle, "begin1/sent/b1mx07201.html");
  assert.match(
    normalized.source,
    /<div class="Titles"><h1 class="ExerciseTitle">72\. What Is in a Magazine\?<\/h1><\/div>/,
  );
  assert.equal(normalized.counters.titleHeadingsCreated, 1);
});

test("story mapping resolves B1 and non-Begin story exercise names", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-story-map-"),
  );
  try {
    const storyPaths = [
      "begin1/b1/b1001.html",
      "easyread/es/easy001.html",
      "eslread/ss/s001.html",
      "essays/e/essay001.html",
      "kidsenglish/ke/ke001.html",
      "kidsenglish2/ke2/ke2001.html",
      "kidsenglish3/ke3/ke3001.html",
      "people/p/people001.html",
      "supereasy/se/supereasy001.html",
    ];
    for (const relative of storyPaths) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "<h1>Story</h1>");
    }
    const cases = [
      ["begin1/dict/b1d001.html", "begin1/b1/b1001.html"],
      ["easyread/dict/er_d001.html", "easyread/es/easy001.html"],
      ["eslread/dict/d001.html", "eslread/ss/s001.html"],
      ["essays/dict/aigdict001.html", "essays/e/essay001.html"],
      ["kidsenglish/dict/ked001.html", "kidsenglish/ke/ke001.html"],
      ["kidsenglish2/dict/k2d001.html", "kidsenglish2/ke2/ke2001.html"],
      ["kidsenglish3/dict/k3d001.html", "kidsenglish3/ke3/ke3001.html"],
      ["people/dict/pdict001.html", "people/p/people001.html"],
      ["supereasy/dict/se_d001.html", "supereasy/se/supereasy001.html"],
    ];
    for (const [exercise, expected] of cases) {
      assert.equal(
        storyTarget(root, path.join(root, exercise)).relative,
        expected,
      );
    }
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("Hot Potatoes scans can be limited to one content root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-scope-"));
  try {
    for (const level of ["begin1", "begin2"]) {
      const page = path.join(root, level, "dict", `${level}-dict.html`);
      fs.mkdirSync(path.dirname(page), { recursive: true });
      fs.writeFileSync(
        page,
        '<html><body id="TheBody"><button class="FuncButton">Check</button></body></html>',
      );
    }

    assert.deepEqual(
      scanTargets(root, ["begin1"]).pages.map((page) => page.relative),
      ["begin1/dict/begin1-dict.html"],
    );
    assert.deepEqual(
      scanTargets(root, ["begin2"]).pages.map((page) => page.relative),
      ["begin2/dict/begin2-dict.html"],
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("writing exercises receive only the shared feedback assets", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "hot-potatoes-feedback-scope-"),
  );
  try {
    const target = path.join(root, "writing", "quiz.html");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="author" content="Created with Hot Potatoes"><title>Writing Quiz</title>
<style>div.Feedback { background: #c0c0c0; }</style></head>
<body><div class="Feedback" id="FeedbackDiv"><div id="FeedbackContent"></div></div></body></html>`;
    fs.writeFileSync(target, source);

    const scanned = scanTargets(root, ["writing"]);
    assert.equal(scanned.ambiguous.length, 0);
    assert.equal(scanned.pages.length, 1);
    assert.equal(scanned.pages[0].feedbackOnly, true);
    assert.equal(scanned.pages[0].story, null);

    const assets = {
      feedbackCssIntegrity: "sha384-feedback-css",
      feedbackUiIntegrity: "sha384-feedback-ui",
    };
    const first = normalizeFeedbackPage(scanned.pages[0], {
      ...assets,
      file: target,
      root,
    });
    const second = normalizeFeedbackPage(
      { ...scanned.pages[0], source: first.source },
      { ...assets, file: target, root },
    );

    assert.equal(first.source, second.source);
    assert.equal(first.versionChanged, true);
    assert.equal(first.family, "feedback");
    assert.equal(first.prototype, "shared-feedback-contract");
    assert.equal(second.versionChanged, false);
    assert.ok(
      first.source.includes(
        `HOT POTATOES MODERNIZATION VERSION: version=${CURRENT_MODERNIZATION_VERSION}; family=feedback; prototype=shared-feedback-contract; story=none`,
      ),
    );
    assert.match(
      first.source,
      /src="\.\.\/js\/hot-potatoes-feedback\.js" integrity="sha384-feedback-ui"/,
    );
    assert.match(
      first.source,
      /href="\.\.\/css\/hot-potatoes-feedback\.css" integrity="sha384-feedback-css"/,
    );
    assert.doesNotMatch(
      first.source,
      /sis-hot-potatoes\.css|hot-potatoes-ui\.js|story-theme\.js/,
    );
    assert.match(
      first.source,
      /<style>div\.Feedback \{ background: #c0c0c0; \}<\/style>/,
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("page migration preserves head style blocks and rewrites inline state and controls idempotently", () => {
  const root = path.resolve(".");
  const source = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body { background: #eee; } .QuizQuestion { color: #111; }</style>
<title>Dictation</title></head>
<body id="TheBody"><div class="wrapit">
<div class="Titles"><h2 class="ExerciseTitle">Dictation</h2></div>
<hr>
<div id="InstructionsDiv">Type what you hear.</div>
<div id="MainDiv"><button class="NavButton" type="button">1 of 5 Next</button>
<button class="FuncButton" type="button" onmouseover="FuncBtnOver(this)" onclick="ShowHideQuestions();">Show all
 questions</button>
<button class="FuncButton" onmouseout="NavBtnOut(this)" onclick="ShowHideQuestions();">Show questions one by
 one</button>
<button class="FuncButton" type="button" onfocus="FuncBtnOver(this)" onclick="ShowAnswers(0)">Show Answer</button>
<ol><li class="QuizQuestion" id="Q_0" style="display: none;"><textarea class="ShortAnswerBox" id="Q_0_Guess"></textarea></li></ol></div>
<div id="GuessDiv" class="StdDiv">

</div>
<div id="FeedbackDiv"><div id="FeedbackContent"></div></div>
<div class="cenmar"><a href="JavaScript:window.close()"> CLOSE </a><button class="btn-74" onclick="location='JavaScript:window.close() '; return false;"><span></span><span></span><span></span><span></span>Close</button></div></div>
<script>function Toggle() { var question = document.getElementById("Q_0"); question.style.display = "none"; if (question.style.display === "none") question.style.display = ""; }
function FuncBtnOut(Btn) { Btn.className = "FuncButton"; }
function NavBtnOut(Btn) { Btn.className = "NavButton"; }</script>
</body></html>`;
  const styleBlocksBefore = extractHeadStyleBlocks(source);
  const page = {
    absolute: path.join(root, "begin1/dict/b1d001.html"),
    relative: "begin1/dict/b1d001.html",
    source,
    story: {
      absolute: path.join(root, "begin1/b1/b1001.html"),
      key: "b1001.html",
      relative: "begin1/b1/b1001.html",
    },
  };
  const assets = { ...collectAssetInfo(root), root };
  const first = normalizePage(page, { ...assets, root });
  const second = normalizePage(
    { ...page, source: first.source },
    { ...assets, root },
  );

  assert.equal(first.source, second.source);
  assert.equal(first.versionChanged, true);
  assert.ok(
    first.source.includes(
      `HOT POTATOES MODERNIZATION VERSION: version=${CURRENT_MODERNIZATION_VERSION}; family=dict; prototype=begin1/dict/b1d001.html; story=begin1/b1/b1001.html`,
    ),
  );
  assert.deepEqual(extractHeadStyleBlocks(first.source), styleBlocksBefore);
  assert.doesNotMatch(first.source, /\sstyle\s*=/i);
  assert.match(first.source, /HPSetDisplay\(question, "none"\)/);
  assert.match(first.source, /HPGetDisplay\(question\)/);
  assert.match(first.source, /class="QuizQuestion hp-display-none"/);
  assert.match(
    first.source,
    /id="Q_0_Guess" aria-label="Your answer for question 1"/,
  );
  assert.match(first.source, /class="FuncButton hp-button btn-17"/);
  assert.match(
    first.source,
    /<div id="GuessDiv" class="StdDiv hp-display-none"><\/div>/,
  );
  assert.match(
    first.source,
    /<div class="hp-instructions-panel"><div class="Titles"><h1 class="ExerciseTitle">Dictation<\/h1><\/div>\s*<div id="InstructionsDiv">Type what you hear\.<\/div><\/div>/,
  );
  assert.match(
    first.source,
    /<button[^>]*data-hp-close[^>]*aria-label="Close"[^>]*data-hp-tooltip="Close this exercise\."[^>]*aria-description="Close this exercise\."[^>]*> CLOSE <span><\/span><span><\/span><span><\/span><span><\/span><\/button>/,
  );
  assert.match(first.source, /class="btn-74 hp-button"[^>]*data-hp-close/);
  assert.equal(first.counters.closeLinks, 1);
  assert.equal(first.counters.closeButtons, 2);
  assert.equal(first.counters.horizontalRules, 1);
  assert.equal(first.counters.emptyFeedbackPanelsHidden, 1);
  assert.equal(first.counters.titleHeadingsNormalized, 1);
  assert.equal(first.counters.titlePanelsWrapped, 1);
  assert.equal(first.counters.animatedButtons, 4);
  assert.doesNotMatch(first.source, /<hr\b/i);
  assert.doesNotMatch(first.source, /href="JavaScript:window\.close\(\)"/i);
  assert.doesNotMatch(first.source, /onmouseover="FuncBtnOver/);
  assert.doesNotMatch(first.source, /onfocus="FuncBtnOver/);
  assert.doesNotMatch(first.source, /onmouseout="NavBtnOut/);
  assert.match(first.source, /function FuncBtnOut\(\) \{\}/);
  assert.match(first.source, /function NavBtnOut\(\) \{\}/);
  assert.doesNotMatch(first.source, /Btn\.className\s*=/);
  assert.match(
    first.source,
    /aria-label="All" data-hp-tooltip="Show all questions at once\." aria-description="Show all questions at once\."\s*>All<\/button>/,
  );
  assert.match(
    first.source,
    /aria-label="One" data-hp-tooltip="Show one question at a time\." aria-description="Show one question at a time\."\s*>One<\/button>/,
  );
  assert.match(
    first.source,
    /aria-label="Answers" data-hp-tooltip="Reveal the correct answer\. Revealed answers count as incorrect\." aria-description="Reveal the correct answer\. Revealed answers count as incorrect\."\s*>Answers<\/button>/,
  );
  assert.match(
    first.source,
    /aria-label="Next" data-hp-tooltip="Open the next exercise\. This is 1 of 5\." aria-description="Open the next exercise\. This is 1 of 5\."\s*>Next<\/button>/,
  );
  assert.match(first.source, /data-story-title-url="\.\.\/b1\/b1001\.html"/);
  assert.match(first.source, /href="\.\.\/\.\.\/css\/sis-hot-potatoes\.css"/);
  assert.ok(first.source.includes(`href="../../css/sis-exercise-layout.css" integrity="${assets.exerciseLayoutCssIntegrity}"`));
  assert.ok(first.source.includes(`href="../../css/sis-cloze-submit.css" integrity="${assets.clozeSubmitCssIntegrity}"`));
  assert.ok(first.source.includes(`href="../../css/sis-exercise-family-layout.css" integrity="${assets.exerciseFamilyCssIntegrity}"`));
  assert.ok(first.source.includes(`src="../../js/sis-exercise-submit.js" integrity="${assets.exerciseSubmitJsIntegrity}" data-sis-exercise-family="dict"`));
  assert.ok(first.source.includes(`src="../../js/hot-potatoes-feedback.js" integrity="${assets.feedbackUiIntegrity}"`));
  assert.ok(first.source.includes(`href="../../css/hot-potatoes-feedback.css" integrity="${assets.feedbackCssIntegrity}"`));

  const previousVersionSource = first.source.replace(
    `HOT POTATOES MODERNIZATION VERSION: version=${CURRENT_MODERNIZATION_VERSION}`,
    "HOT POTATOES MODERNIZATION VERSION: version=2026-09-12.1",
  );
  const upgraded = normalizePage(
    { ...page, source: previousVersionSource },
    { ...assets, root },
  );
  assert.equal(upgraded.versionChanged, true);
  assert.equal(upgraded.source, first.source);

  const rechecked = normalizePage(
    { ...page, source: upgraded.source },
    { ...assets, root },
  );
  assert.equal(rechecked.versionChanged, false);
  assert.equal(rechecked.source, upgraded.source);

  const missingCurrentBridge = rechecked.source.replace(
    /<script defer src="\.\.\/\.\.\/js\/sis-exercise-submit\.js"[^>]*><\/script>/,
    "",
  );
  const repairedDespiteCurrentMarker = normalizePage(
    { ...page, source: missingCurrentBridge },
    { ...assets, root },
  );
  assert.notEqual(repairedDespiteCurrentMarker.source, missingCurrentBridge);
  assert.match(repairedDespiteCurrentMarker.source, /sis-exercise-submit\.js/);
  assert.equal(repairedDespiteCurrentMarker.versionChanged, false);
});

test("family normalization repairs the cloze wrapper and creates the expected action row", () => {
  const root = path.resolve(".");
  const absolute = path.join(root, "begin2/cloze/b2cloze001.html");
  const story = storyTarget(root, absolute);
  const page = {
    absolute,
    relative: "begin2/cloze/b2cloze001.html",
    source: `<!doctype html><html><head><meta charset="utf-8"><!-- <meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="sis-cloze-prototype" content="current"><label for="Gap0">Blank 1</label> -->
    <!-- HOT POTATOES MODERNIZATION VERSION: version=${CURRENT_MODERNIZATION_VERSION}; family=cloze; prototype=begin1/cloze/b1cloze001.html; story=${story.relative} -->
    <link rel="stylesheet" href="../../css/sis-cloze-submit.css" integrity="sha384-legacy">
<title>Cloze</title></head><body id="TheBody"><div class="wrapit"><div class="hp-instructions-panel"><div class="Titles"><h1 class="ExerciseTitle">Cloze</h1></div><div id="InstructionsDiv">Fill the blanks.</div></div><div id="MainDiv"><div id="ClozeDiv"><span class="GapSpan"><input class="GapBox" id="Gap0"></span><div class="btn17Container"></div></div></div><div id="FeedbackDiv"></div><button class="btn-74" type="button" data-hp-close>Close</button></div></body></html>`,
    story,
  };
  const assets = { ...collectAssetInfo(root), root };
  const normalized = normalizePage(page, assets);
  assert.equal(modernizationProfile(page).prototype, "begin1/cloze/b1cloze001.html");
  assert.equal(normalized.versionChanged, false);
  assert.deepEqual(normalized.sourceRequirementGaps, [
    "selector body#TheBody > .wrapfit",
    "selector body#TheBody > .hp-exercise-shell",
    "selector body#TheBody > [data-sis-exercise-shell]",
    "selector meta[name=viewport]",
    "selector meta[name=sis-cloze-prototype]",
    "labels for Gap0",
  ]);
  assert.match(normalized.source, /name="viewport" content="width=device-width, initial-scale=1\.0"/);
  assert.match(normalized.source, /name="sis-cloze-prototype" content="current"/);
  assert.match(normalized.source, /<label class="sr-only" for="Gap0">Blank 1<\/label><input[^>]*id="Gap0"/);
  assert.equal(normalized.counters.clozeGapLabels, 1);
  assert.match(normalized.source, /<div class="hp-exercise-shell wrapfit" data-sis-exercise-shell="true" data-sis-exercise-family="cloze">/);
  assert.match(normalized.source, /<div class="btn17Container"><\/div><\/div>/);
  assert.match(normalized.source, /js\/sis-cloze-submit\.js/);
  assert.doesNotMatch(normalized.source, /^[\t ]+$/m);
  assert.equal(normalizePage({ ...page, source: normalized.source }, assets).source, normalized.source);
  assert.equal(
    verifyPostConversionPage({ ...page, source: normalized.source }, assets).source,
    normalized.source,
  );
  const withoutGapFields = normalized.source.replace(
    /<span\b[^>]*class="GapSpan"[^>]*>[\s\S]*?<\/span>/i,
    "",
  );
  assert.throws(
    () => normalizePage({ ...page, source: withoutGapFields }, assets),
    /CL-05 At least one unique GapN input has a matching label/,
  );
  const withoutSubmissionScript = normalized.source.replace(
    /<script defer src="\.\.\/\.\.\/js\/sis-cloze-submit\.js"[^>]*><\/script>/,
    "",
  );
  assert.throws(
    () =>
      verifyPostConversionPage(
        { ...page, source: withoutSubmissionScript },
        assets,
      ),
    /post-conversion verification failed; repeat normalization still changes this cloze page/,
  );
});

test("post-conversion verification rejects dictation and sentence pages without the ID block prompt", () => {
  const sourceRoot = path.resolve(__dirname, "..");
  const families = [
    {
      family: "dict",
      prototype: "begin1/dict/b1d001.html",
      relative: "begin2/dict/b2d058.html",
    },
    {
      family: "sent",
      prototype: "begin1/sent/b1mx00101.html",
      relative: "begin2/sent/b2mx05801.html",
    },
  ];

  for (const fixture of families) {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `hot-potatoes-${fixture.family}-id-panel-`),
    );
    try {
      const prototypePath = path.join(root, fixture.prototype);
      fs.mkdirSync(path.dirname(prototypePath), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, fixture.prototype), prototypePath);
      const submissionScript = path.join(root, "js/sis-exercise-submit.js");
      fs.mkdirSync(path.dirname(submissionScript), { recursive: true });
      fs.writeFileSync(submissionScript, "window.sisExerciseReady = true;");

      const source = fs.readFileSync(prototypePath, "utf8");
      const profile = modernizationProfile({ relative: fixture.relative });
      assert.equal(profile.family, fixture.family);
      assert.throws(
        () =>
          validatePageMmor(source, root, profile, fixture.relative),
        /ID block post-conversion check failed; js\/sis-exercise-submit\.js must explain that EaglesID and student email activate Check and Hint/,
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  }
});

test("dictation and sentence normalization canonicalizes supported wrappers to direct wrapfit", () => {
  const root = path.resolve(".");
  const assets = { ...collectAssetInfo(root), root };
  const cases = [
    { family: "dict", relative: "begin1/dict/b1d001.html" },
    { family: "sent", relative: "begin1/sent/b1mx00101.html" },
  ];

  for (const fixture of cases) {
    const absolute = path.join(root, fixture.relative);
    const familyLabel = fixture.family === "dict" ? "Dictation" : "Sentence scramble";
    const sourceForWrapper = (className) => `<!doctype html><html><head><meta charset="utf-8"><title>${familyLabel}</title></head><body id="TheBody"><div class="${className}"><div class="Titles"><h2 class="ExerciseTitle">${familyLabel}</h2></div><div id="InstructionsDiv">Complete the exercise.</div><div id="MainDiv"><textarea class="ShortAnswerBox" id="Q_0_Guess"></textarea><button class="FuncButton" type="button" onclick="CheckAnswer(0)">Check</button><button class="FuncButton" type="button" onclick="ShowHint(0)">Hint</button></div><div id="FeedbackDiv"><div id="FeedbackContent"></div></div><button class="btn-74" type="button" data-hp-close>Close</button></div></body></html>`;
    const page = {
      absolute,
      relative: fixture.relative,
      source: sourceForWrapper("wrapfit"),
      story: storyTarget(root, absolute),
    };
    const profile = modernizationProfile(page);
    assert.equal(profile.family, fixture.family);
    const wrapperCases = [
      { className: "wrapfit", passes: true },
      { className: "wrapit", passes: true },
      { className: "wrapit wrapfit", passes: true },
      { className: "exercise-wrapper", passes: true },
      { className: "", passes: false },
      { className: "unknown-wrapper", passes: false },
    ];
    for (const fixtureCase of cases) {
      const source = sourceForWrapper(fixtureCase.className);
      if (!fixtureCase.passes) {
        assert.throws(
          () => normalizePage({ ...page, source }, assets),
          /WRAPPER PREFLIGHT blocked unknown or missing direct wrapper/,
          `${fixture.family} rejects ${fixtureCase.className || "missing"}`,
        );
        continue;
      }
      const normalized = normalizePage({ ...page, source }, assets);
      const wrapper = normalized.source.match(/<body\b[^>]*>\s*<div\b[^>]*>/i)?.[0] || "";
      assert.match(wrapper, /\bhp-exercise-shell\b/);
      assert.match(wrapper, /\bwrapfit\b/);
      assert.match(wrapper, /\bdata-sis-exercise-shell="true"/);
      assert.match(wrapper, new RegExp(`\bdata-sis-exercise-family="${fixture.family}"`));
      assert.doesNotMatch(normalized.source, /class="[^"]*\bwrapit\b/);
      assert.doesNotMatch(normalized.source, /class="[^"]*\bexercise-wrapper\b/);
      assert.equal(normalizePage({ ...page, source: normalized.source }, assets).source, normalized.source);
    }

    const original = sourceForWrapper("wrapfit");
    const currentSource = normalizePage({ ...page, source: original }, assets).source;
    const wrapperOpen = /(<body\b[^>]*>\s*<div\b[^>]*>)/i;
    const nested = currentSource.replace(wrapperOpen, "$1<div class=\"wrapfit\"></div>");
    assert.throws(() => normalizePage({ ...page, source: nested }, assets), /WRAPPER PREFLIGHT blocked nested wrappers/);
    const duplicate = currentSource.replace("</body>", "<div class=\"wrapfit hp-exercise-shell\" data-sis-exercise-shell=\"true\"></div></body>");
    assert.throws(() => normalizePage({ ...page, source: duplicate }, assets), /WRAPPER PREFLIGHT blocked duplicate direct wrappers/);
  }
});

test("dictation and sentence profiles add a missing Close control at the wrapper footer", () => {
  const root = path.resolve(".");
  const source = `<!doctype html><html><head><meta charset="utf-8"><title>Dictation</title></head><body id="TheBody"><div class="wrapit"><div class="Titles"><h2 class="ExerciseTitle">Dictation</h2></div><div id="InstructionsDiv">Listen and type.</div><div id="MainDiv"><textarea class="ShortAnswerBox" id="Q_0_Guess"></textarea></div><div id="FeedbackDiv"><div id="FeedbackContent"></div></div></div></body></html>`;
  const absolute = path.join(root, "begin1/dict/b1d001.html");
  const page = {
    absolute,
    relative: "begin1/dict/b1d001.html",
    source,
    story: storyTarget(root, absolute),
  };
  const assets = { ...collectAssetInfo(root), root };
  const normalized = normalizePage(page, assets);
  assert.match(normalized.source, /<div class="cenmar"><button class="hp-button btn-74"[^>]*data-hp-close/);
  assert.equal(normalized.counters.closeButtons, 1);
  assert.equal(normalizePage({ ...page, source: normalized.source }, assets).source, normalized.source);
});

test("dictation profile repairs the known outer cenmar shell only when its full exercise structure matches", () => {
  const root = path.resolve(".");
  const page = {
    absolute: path.join(root, "supereasy/dict/se_d039.html"),
    relative: "supereasy/dict/se_d039.html",
    source: `<!doctype html><html><head><meta charset="utf-8"><title>Dictation</title></head><body id="TheBody"><div class="cenmar"><div class="Titles"><h1 class="ExerciseTitle">Dictation</h1></div><div id="InstructionsDiv">Listen and type.</div><div id="MainDiv"><textarea class="ShortAnswerBox" id="Q_0_Guess"></textarea></div><div id="FeedbackDiv"></div><div class="cenmar"><button class="hp-button btn-74" type="button" data-hp-close=""><span></span><span></span><span></span><span></span>Close</button></div></div></body></html>`,
    story: storyTarget(root, path.join(root, "supereasy/dict/se_d039.html")),
  };
  const assets = { ...collectAssetInfo(root), root };

  const normalized = normalizePage(page, assets);
  assert.match(
    normalized.source,
    /<body id="TheBody"><div class="wrapfit hp-exercise-shell" data-sis-exercise-shell="true" data-sis-exercise-family="dict">/,
  );
  assert.match(normalized.source, /<div class="cenmar"><button[^>]*\bdata-hp-close/);
  assert.equal(normalized.counters.closeButtons, 0);
  assert.equal(normalizePage({ ...page, source: normalized.source }, assets).source, normalized.source);

  const incompleteShell = page.source.replace('<div id="FeedbackDiv"></div>', "");
  assert.throws(
    () => normalizePage({ ...page, source: incompleteShell }, assets),
    /SOURCE STRUCTURE BLOCKED; unsupported direct exercise wrapper/,
  );
});
