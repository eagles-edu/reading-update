const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeExerciseHtml } = require("./exercise-page-modernizer.cjs");

const options = {
  file: "/repo/begin1/sent/b1mx00101.html",
  root: "/repo",
  fontIntegrity: "sha384-font-stack",
  siteStyleIntegrity: "sha384-site-style",
  layoutIntegrity: "sha384-exercise-layout",
};

test("normalizes charset and duplicate viewports and adds ordered shared styles", () => {
  const source = [
    '<?xml version="1.0"?>',
    "<!DOCTYPE html>",
    '<html lang="en"><head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
    '<meta name="viewport" content="width=device-width">',
    '<meta name="viewport" content="initial-scale=1">',
    "    ",
    "<style>body { width: fit-content; }</style>",
    "<script>window.exerciseReady = true;</script>",
    "</head><body><main>keep body</main></body></html>",
  ].join("\n");

  const result = normalizeExerciseHtml(source, options);
  assert.equal((result.source.match(/<meta\b[^>]*charset=/gi) || []).length, 1);
  assert.equal((result.source.match(/<meta\b[^>]*name="viewport"/gi) || []).length, 1);
  assert.match(result.source, /<meta charset="utf-8">/);
  assert.match(result.source, /href="\.\.\/\.\.\/style\/font-stack\.css"[^>]*integrity="sha384-font-stack"/);
  assert.match(result.source, /href="\.\.\/\.\.\/css\/sis-exercise-layout\.css"[^>]*integrity="sha384-exercise-layout"/);
  assert.ok(result.source.indexOf("</style>") < result.source.indexOf("sis-exercise-layout.css"));
  assert.match(result.source, /<main>keep body<\/main>/);
  assert.doesNotMatch(result.source, /<\?xml\b|http-equiv="Content-Type"/i);
  assert.doesNotMatch(result.source, /^[\t ]+$/m);
});

test("is idempotent after the first normalization", () => {
  const source = "<!doctype html><html><head><meta charset='UTF-8'></head><body></body></html>";
  const first = normalizeExerciseHtml(source, options);
  const second = normalizeExerciseHtml(first.source, options);
  assert.equal(second.source, first.source);
});

test("adds the font stack when an exercise lacks the shared link", () => {
  const source = "<!doctype html><html><head><title>Sentences</title></head><body></body></html>";
  const result = normalizeExerciseHtml(source, options);
  assert.match(result.source, /rel="preload" href="\.\.\/\.\.\/style\/font-stack\.css"/);
  assert.match(result.source, /rel="stylesheet" href="\.\.\/\.\.\/style\/font-stack\.css"/);
});

test("marks only revealed dictation answer spans as correct", () => {
  const source = '<!doctype html><html><head></head><body>A.setAttribute("class", "Answer");</body></html>';
  const result = normalizeExerciseHtml(source, { ...options, family: "dict" });
  assert.match(result.source, /A\.setAttribute\("class", "Answer correct"\)/);
  const repeated = normalizeExerciseHtml(result.source, { ...options, family: "dict" });
  assert.equal(repeated.source, result.source);
});

test("repairs the known B6 sentence stylesheet path and supplies its SRI", () => {
  const source = '<!doctype html><html><head><link rel="stylesheet" href="../style/style.css"></head><body></body></html>';
  const result = normalizeExerciseHtml(source, {
    ...options,
    file: "/repo/begin6/sent/b6mx0011.html",
    family: "sent",
  });
  assert.match(result.source, /href="\.\.\/\.\.\/style\/style\.css" integrity="sha384-site-style"/);
  assert.doesNotMatch(result.source, /href="\.\.\/style\/style\.css"/);
});

test("fails closed when the document has no head", () => {
  assert.throws(() => normalizeExerciseHtml("<!doctype html><html><body></body></html>", options), /head is missing/);
});
