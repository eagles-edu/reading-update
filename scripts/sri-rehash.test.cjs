const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { rehashHtmlSource } = require("./sri-rehash.cjs");

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js";
const TONE_INTEGRITY =
  "sha384-NWoslxaf/3dYwQk+uGziDYJFdsjBpVlU1WpFRexuDFcIk/5PJpCbpVXia2Uikeix";

test("registers the approved Tone.js CDN integrity value", () => {
  const source = `<script src="${TONE_URL}"></script>`;
  const result = rehashHtmlSource(source, path.resolve("player-proof.html"), process.cwd());

  assert.equal(result.changes.length, 1);
  assert.ok(result.source.includes(`integrity="${TONE_INTEGRITY}"`));
  assert.equal(result.warnings.size, 0);
});

test("repairs a stale Tone.js CDN integrity value", () => {
  const source = `<script src="${TONE_URL}" integrity="sha384-stale"></script>`;
  const result = rehashHtmlSource(source, path.resolve("player-proof.html"), process.cwd());

  assert.equal(result.changes.length, 1);
  assert.ok(result.source.includes(`integrity="${TONE_INTEGRITY}"`));
  assert.doesNotMatch(result.source, /sha384-stale/);
});
