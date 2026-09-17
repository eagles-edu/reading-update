const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("all exercise families use the shared instruction token", function () {
  const sharedCss = read("css/sis-hot-potatoes.css");
  const clozeCss = read("css/sis-cloze-submit.css");
  const clozeScript = read("js/sis-cloze-submit.js");
  const exerciseScript = read("js/sis-exercise-submit.js");
  const token =
    "body#TheBody #InstructionsDiv .sis-exercise-instructions {\n" +
    "  font-size: 1rem;\n" +
    "  font-weight: 400;\n" +
    "  line-height: 1.5;\n" +
    "  margin: 0;\n" +
    "  text-indent: 0;\n" +
    "}";

  assert.ok(sharedCss.includes(token));
  assert.equal(
    (sharedCss.match(/body#TheBody #InstructionsDiv \.sis-exercise-instructions \{/g) || [])
      .length,
    1,
  );
  assert.doesNotMatch(
    clozeCss,
    /body#TheBody #InstructionsDiv \.sis-exercise-instructions \{/,
  );
  assert.match(clozeScript, /paragraph\.className = "sis-exercise-instructions"/);
  assert.doesNotMatch(clozeScript, /sis-cloze-instructions/);
  assert.match(exerciseScript, /paragraph\.className = "sis-exercise-instructions"/);
});
