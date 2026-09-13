const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { ensureStoryBootstrap } = require("./modernize-theme-pages.cjs");

const ROOT = path.resolve(__dirname, "..");
const STORY_PAGE = path.join(ROOT, "begin1", "b1", "b1001.html");

test("story theme bootstrap runs before the first render-blocking stylesheet", () => {
  const source = [
    "<head>",
    '<link rel="preload" href="../../style/font-stack.css" as="style">',
    '<link rel="stylesheet" href="../../style/font-stack.css">',
    '<script src="../../js/story-theme.js" integrity="sha384-test" async defer></script>',
    '<link rel="stylesheet" href="../../style/style.css">',
    "</head>",
  ].join("\n");

  const result = ensureStoryBootstrap(source, STORY_PAGE, ROOT);
  const stylesheetIndex = result.source.indexOf(
    '<link rel="stylesheet" href="../../style/font-stack.css">',
  );
  const bootstrapIndex = result.source.indexOf(
    '<script src="../../js/story-theme.js" integrity="sha384-test"></script>',
  );

  assert.deepEqual(result.changes, ["story-theme-order"]);
  assert.ok(bootstrapIndex >= 0);
  assert.ok(bootstrapIndex < stylesheetIndex);
  assert.equal((result.source.match(/story-theme\.js/g) || []).length, 1);
  assert.deepEqual(
    ensureStoryBootstrap(result.source, STORY_PAGE, ROOT).changes,
    [],
  );
});

test("missing story theme bootstrap is inserted before the first stylesheet", () => {
  const source = [
    "<head>",
    '<link rel="preload" href="../../style/font-stack.css" as="style">',
    '<link rel="stylesheet" href="../../style/font-stack.css">',
    '<link rel="stylesheet" href="../../style/style.css">',
    "</head>",
  ].join("\n");

  const result = ensureStoryBootstrap(source, STORY_PAGE, ROOT);
  const stylesheetIndex = result.source.indexOf(
    '<link rel="stylesheet" href="../../style/font-stack.css">',
  );
  const bootstrapIndex = result.source.indexOf(
    '<script src="../../js/story-theme.js"></script>',
  );

  assert.deepEqual(result.changes, ["story-theme-js"]);
  assert.ok(bootstrapIndex >= 0);
  assert.ok(bootstrapIndex < stylesheetIndex);
});
