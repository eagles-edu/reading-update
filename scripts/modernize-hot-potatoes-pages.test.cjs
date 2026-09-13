const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectAssetState } = require("./sri-rehash-watch.cjs");

const {
  applyPagePlans,
  applySafetyError,
  extractHeadStyleBlocks,
  MAX_SAFE_APPLY_PAGES,
  normalizeFeedbackPage,
  normalizePage,
  normalizeStyleValue,
  parseArgs,
  scanTargets,
  storyTarget,
} = require("./modernize-hot-potatoes-pages.cjs");

test("bulk page applies fail closed unless an explicit scoped override is supplied", () => {
  assert.equal(applySafetyError({ allowBulk: false, scopes: [] }, MAX_SAFE_APPLY_PAGES), null);
  assert.match(
    applySafetyError({ allowBulk: false, scopes: ["begin1"] }, MAX_SAFE_APPLY_PAGES + 1),
    /safe limit is 50/,
  );
  assert.match(
    applySafetyError({ allowBulk: true, scopes: [] }, MAX_SAFE_APPLY_PAGES + 1),
    /explicit --scope/,
  );
  assert.equal(applySafetyError({ allowBulk: true, scopes: ["begin1"] }, MAX_SAFE_APPLY_PAGES + 1), null);
  assert.throws(() => parseArgs(["--allow-bulk"]), /requires at least one explicit --scope/);
  assert.deepEqual(parseArgs(["--allow-bulk", "--scope", "begin1"]).scopes, ["begin1"]);
});

test("apply refuses a batch over the limit before creating backups or changing files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-bulk-gate-"));
  let backupCalls = 0;
  try {
    const plans = Array.from({ length: MAX_SAFE_APPLY_PAGES + 1 }, (_, index) => {
      const relative = `begin1/dict/page-${index}.html`;
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `original-${index}`);
      return { absolute, relative, source: `original-${index}`, updated: `updated-${index}` };
    });

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
    for (const plan of plans) assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.source);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("apply verifies every backup before writing any page", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-backup-check-"));
  const backupRoot = path.join(root, "backup");
  try {
    const plans = ["one", "two"].map((name) => {
      const relative = `begin1/dict/${name}.html`;
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `original-${name}`);
      return { absolute, relative, source: `original-${name}`, updated: `updated-${name}` };
    });
    const backupManager = {
      runRoot: backupRoot,
      backupBeforeWrite(file) {
        const relative = path.relative(root, file);
        const target = path.join(backupRoot, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file, target);
        if (relative.endsWith("two.html")) fs.writeFileSync(target, "wrong backup");
      },
    };

    assert.throws(
      () => applyPagePlans(plans, { allowBulk: false, apply: true, root, scopes: ["begin1"] }, backupManager),
      /two\.html: backup verification failed/,
    );
    for (const plan of plans) assert.equal(fs.readFileSync(plan.absolute, "utf8"), plan.source);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("apply writes changed pages only after byte-identical backups are ready", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-safe-apply-"));
  const backupRoot = path.join(root, "backup");
  try {
    const plans = ["one", "two"].map((name) => {
      const relative = `begin1/dict/${name}.html`;
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, `original-${name}`);
      return { absolute, relative, source: `original-${name}`, updated: `updated-${name}` };
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
      assert.equal(fs.readFileSync(path.join(backupRoot, plan.relative), "utf8"), plan.source);
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-stale-plan-"));
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

test("cloze Check and Hint keep focus rings but disable effects that paint outside their bounds", () => {
  const root = path.resolve(__dirname, "..");
  const css = fs.readFileSync(path.join(root, "css/sis-cloze-submit.css"), "utf8");
  const clozeControlRule = css.match(
    /body#TheBody \.sis-cloze-shell \.sis-exercise-controls button\.hp-button\.btn-17::before,[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(clozeControlRule, "cloze controls need a scoped pseudo-element rule");
  assert.match(clozeControlRule, /animation:\s*none/);
  assert.match(clozeControlRule, /box-shadow:\s*none/);
  assert.match(clozeControlRule, /content:\s*none/);
  assert.match(
    css,
    /body#TheBody \.sis-cloze-shell \.sis-exercise-controls button\.hp-button\.btn-17,\s*body#TheBody \.sis-cloze-shell \.sis-exercise-controls input\.hp-button\.btn-17\s*\{[^}]*overflow:\s*visible/s,
  );
  assert.doesNotMatch(
    css,
    /body#TheBody \.sis-cloze-shell \.sis-exercise-controls button\.hp-button\.btn-17\s*\{[^}]*overflow:\s*hidden/s,
  );
});

test("the SRI watcher tracks shared CSS, JavaScript, and theme assets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-sri-watch-"));
  try {
    for (const [relative, contents] of [
      ["css/sis-hot-potatoes.css", ".exercise { color: blue; }"],
      ["js/hot-potatoes-ui.js", "document.documentElement.dataset.ready = 'true';"],
      ["style/font-stack.css", ":root { color-scheme: light; }"],
    ]) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }

    assert.deepEqual(
      [...collectAssetState(root).keys()].sort(),
      ["css/sis-hot-potatoes.css", "js/hot-potatoes-ui.js", "style/font-stack.css"],
    );
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test("inline display and visibility declarations map to shared classes", () => {
  assert.deepEqual(normalizeStyleValue("display: none;"), ["hp-display-none"]);
  assert.deepEqual(normalizeStyleValue("visibility: hidden;"), ["hp-visibility-hidden"]);
  assert.throws(() => normalizeStyleValue("color: red;"), /unsupported inline style/);
});

test("story themes select predeclared CSS assets without writing inline styles", () => {
  const root = path.resolve(__dirname, "..");
  const themeScript = fs.readFileSync(path.join(root, "js/story-theme.js"), "utf8");
  const themeSelector = fs.readFileSync(path.join(root, "js/theme-selector.js"), "utf8");
  const storyCss = fs.readFileSync(path.join(root, "style/style.css"), "utf8");
  const fontCss = fs.readFileSync(path.join(root, "style/font-stack.css"), "utf8");
  const exerciseCss = fs.readFileSync(path.join(root, "css/sis-hot-potatoes.css"), "utf8");

  assert.doesNotMatch(themeScript, /\.style\.(?:setProperty|background)/);
  assert.doesNotMatch(themeScript, /dk-rusttan_grunge\.webp\.fw\.png/);
  assert.doesNotMatch(themeSelector, /\.style\./);
  assert.match(fontCss, /:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
  assert.match(fontCss, /:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
  assert.match(themeScript, /setAttribute\("data-story-background"/);
  assert.match(themeScript, /setAttribute\("data-story-paper"/);
  for (const css of [storyCss, exerciseCss]) {
    assert.doesNotMatch(css, /dk-rusttan_grunge\.webp\.fw\.png/);
    assert.match(css, /html\[data-story-background="green_dust_scratch\.jpg"\]/);
    assert.match(css, /html\[data-story-paper="ep_naturalwhite\.webp"\]/);
  }
});

test("story mapping resolves B1 and non-Begin story exercise names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-story-map-"));
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
      assert.equal(storyTarget(root, path.join(root, exercise)).relative, expected);
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hot-potatoes-feedback-scope-"));
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
    const first = normalizeFeedbackPage(scanned.pages[0], { ...assets, file: target, root });
    const second = normalizeFeedbackPage({ ...scanned.pages[0], source: first.source }, { ...assets, file: target, root });

    assert.equal(first.source, second.source);
    assert.match(first.source, /src="\.\.\/js\/hot-potatoes-feedback\.js" integrity="sha384-feedback-ui"/);
    assert.match(first.source, /href="\.\.\/css\/hot-potatoes-feedback\.css" integrity="sha384-feedback-css"/);
    assert.doesNotMatch(first.source, /sis-hot-potatoes\.css|hot-potatoes-ui\.js|story-theme\.js/);
    assert.match(first.source, /<style>div\.Feedback \{ background: #c0c0c0; \}<\/style>/);
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
  const assets = {
    cssIntegrity: "sha384-css",
    feedbackCssIntegrity: "sha384-feedback-css",
    feedbackUiIntegrity: "sha384-feedback-ui",
    storyIntegrity: "sha384-story",
    uiIntegrity: "sha384-ui",
  };
  const first = normalizePage(page, { ...assets, root });
  const second = normalizePage({ ...page, source: first.source }, { ...assets, root });

  assert.equal(first.source, second.source);
  assert.deepEqual(extractHeadStyleBlocks(first.source), styleBlocksBefore);
  assert.doesNotMatch(first.source, /\sstyle\s*=/i);
  assert.match(first.source, /HPSetDisplay\(question, "none"\)/);
  assert.match(first.source, /HPGetDisplay\(question\)/);
  assert.match(first.source, /class="QuizQuestion hp-display-none"/);
  assert.match(first.source, /id="Q_0_Guess" aria-label="Your answer for question 1"/);
  assert.match(first.source, /class="FuncButton hp-button btn-17"/);
  assert.match(first.source, /<div id="GuessDiv" class="StdDiv hp-display-none"><\/div>/);
  assert.match(first.source, /<div class="hp-instructions-panel"><div class="Titles"><h1 class="ExerciseTitle">Dictation<\/h1><\/div>\s*<div id="InstructionsDiv">Type what you hear\.<\/div><\/div>/);
  assert.match(first.source, /<button[^>]*data-hp-close[^>]*aria-label="Close"[^>]*data-hp-tooltip="Close this exercise\."[^>]*aria-description="Close this exercise\."[^>]*> CLOSE <span><\/span><span><\/span><span><\/span><span><\/span><\/button>/);
  assert.match(first.source, /class="btn-74 hp-button"[^>]*data-hp-close/);
  assert.equal(first.counters.closeLinks, 1);
  assert.equal(first.counters.closeButtons, 2);
  assert.equal(first.counters.horizontalRules, 1);
  assert.equal(first.counters.emptyFeedbackPanelsHidden, 1);
  assert.equal(first.counters.titleHeadingsNormalized, 1);
  assert.equal(first.counters.titlePanelsWrapped, 1);
  assert.equal(first.counters.animatedButtons, 3);
  assert.doesNotMatch(first.source, /<hr\b/i);
  assert.doesNotMatch(first.source, /href="JavaScript:window\.close\(\)"/i);
  assert.doesNotMatch(first.source, /onmouseover="FuncBtnOver/);
  assert.doesNotMatch(first.source, /onfocus="FuncBtnOver/);
  assert.doesNotMatch(first.source, /onmouseout="NavBtnOut/);
  assert.match(first.source, /function FuncBtnOut\(\) \{\}/);
  assert.match(first.source, /function NavBtnOut\(\) \{\}/);
  assert.doesNotMatch(first.source, /Btn\.className\s*=/);
  assert.match(first.source, /aria-label="All" data-hp-tooltip="Show all questions at once\." aria-description="Show all questions at once\."\s*>All<\/button>/);
  assert.match(first.source, /aria-label="One" data-hp-tooltip="Show one question at a time\." aria-description="Show one question at a time\."\s*>One<\/button>/);
  assert.match(first.source, /aria-label="Answers" data-hp-tooltip="Reveal the correct answer\. Revealed answers count as incorrect\." aria-description="Reveal the correct answer\. Revealed answers count as incorrect\."\s*>Answers<\/button>/);
  assert.match(first.source, /aria-label="Next" data-hp-tooltip="Open the next exercise\. This is 1 of 5\." aria-description="Open the next exercise\. This is 1 of 5\."\s*>Next<\/button>/);
  assert.match(first.source, /data-story-title-url="\.\.\/b1\/b1001\.html"/);
  assert.match(first.source, /href="\.\.\/\.\.\/css\/sis-hot-potatoes\.css"/);
  assert.match(first.source, /src="\.\.\/\.\.\/js\/hot-potatoes-feedback\.js" integrity="sha384-feedback-ui"/);
  assert.match(first.source, /href="\.\.\/\.\.\/css\/hot-potatoes-feedback\.css" integrity="sha384-feedback-css"/);
});
