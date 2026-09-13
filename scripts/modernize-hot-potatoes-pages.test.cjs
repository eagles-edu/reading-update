const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  extractHeadStyleBlocks,
  normalizePage,
  normalizeStyleValue,
  scanTargets,
  storyTarget,
} = require("./modernize-hot-potatoes-pages.cjs");

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
});
