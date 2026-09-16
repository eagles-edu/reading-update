const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeHtmlWhitespace } = require("./clean-html-whitespace.cjs");

test("cleans trailing spaces and keeps at most one ordinary blank line", () => {
  const source = "<!doctype html>\r\n\r\n\r\n<div>ok</div>  \r\n\r\n\r\n\r\n";
  const result = normalizeHtmlWhitespace(source);

  assert.equal(result.source, "<!doctype html>\r\n\r\n<div>ok</div>\r\n\r\n");
  assert.equal(result.trailingWhitespaceLines, 1);
  assert.equal(result.blankLinesRemoved, 3);
});

test("preserves whitespace-sensitive element contents", () => {
  const source = [
    "<pre>  keep  \n\n\n</pre>  ",
    "<script>const value = `  keep  \\n\n\n`;  </script>  ",
    "<style>  keep  \n\n\n</style>  ",
    "<textarea>  keep  \n\n\n</textarea>  ",
    "",
  ].join("\n");
  const result = normalizeHtmlWhitespace(source);

  const expected = [
    "<pre>  keep  \n\n\n</pre>",
    "<script>const value = `  keep  \\n\n\n`;  </script>  ",
    "<style>  keep  \n\n\n</style>",
    "<textarea>  keep  \n\n\n</textarea>",
    "",
  ].join("\n");
  assert.equal(result.source, expected);
  assert.equal(result.blankLinesRemoved, 0);
});

test("preserves mixed line endings", () => {
  const source = "<div>one</div>  \n\n<div>two</div>  \r\n\r\n<div>three</div>  \r";
  const result = normalizeHtmlWhitespace(source);

  assert.equal(result.source, "<div>one</div>\n\n<div>two</div>\r\n\r\n<div>three</div>\r");
});
