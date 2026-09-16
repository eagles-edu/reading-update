"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  isBinary,
  normalizeWhitespace,
  parseArgs,
} = require("./git-whitespace-preflight.cjs");

test("repairs trailing whitespace, spaces before tabs, and blank lines at EOF", () => {
  const source = Buffer.from(
    "<div>one  \r\n  \tconst value = 1;\t\r\ntext\n\n",
    "utf8",
  );
  const result = normalizeWhitespace(source);

  assert.equal(
    result.source.toString("utf8"),
    "<div>one\r\n\tconst value = 1;\r\ntext\n",
  );
  assert.equal(result.trailingWhitespaceLines, 2);
  assert.equal(result.spaceBeforeTabLines, 1);
  assert.equal(result.blankLinesAtEof, 1);
});

test("preserves line endings and files without a final newline", () => {
  const source = Buffer.from("one\r\ntwo  \rthree\t", "utf8");
  const result = normalizeWhitespace(source);

  assert.equal(result.source.toString("utf8"), "one\r\ntwo\rthree");
});

test("collapses every contiguous blank-line run to one line", () => {
  const source = Buffer.from("alpha\n\n\n\nbeta\n\n", "utf8");
  const result = normalizeWhitespace(source);

  assert.equal(result.source.toString("utf8"), "alpha\n\nbeta\n");
  assert.equal(result.blankLinesCollapsed, 2);
  assert.equal(result.blankLinesAtEof, 1);
});

test("does not rewrite binary content", () => {
  const source = Buffer.from([0x3c, 0x00, 0x3e]);
  assert.equal(isBinary(source), true);
});

test("defaults to dry-run, accepts repeated includes, and blocks tmp", () => {
  assert.throws(
    () => parseArgs(["--include", "tmp/loose"]),
    /blocked from whitespace cleanup/,
  );
  const args = parseArgs(["--include", "begin1", "--include", "easyread"]);
  assert.equal(args.apply, false);
  assert.deepEqual(args.includes, ["begin1", "easyread"]);
});
