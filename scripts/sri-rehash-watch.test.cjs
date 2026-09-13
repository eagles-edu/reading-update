const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { collectHtmlTargets } = require("./sri-rehash-watch.cjs");

test("batches changed asset references while reading each HTML page once", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sri-watch-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pageOne = path.join(root, "pages", "one.html");
  const pageTwo = path.join(root, "pages", "two.html");
  const pageThree = path.join(root, "pages", "three.html");
  for (const page of [pageOne, pageTwo, pageThree]) {
    fs.mkdirSync(path.dirname(page), { recursive: true });
  }

  fs.writeFileSync(
    pageOne,
    '<link rel="stylesheet" href="../css/shared.css"><script src="../js/shared.js"></script>',
  );
  fs.writeFileSync(pageTwo, '<link rel="stylesheet" href="/css/shared.css">');
  fs.writeFileSync(
    pageThree,
    '<link rel="stylesheet" href="https://example.test/shared.css"><script src="../js/other.js"></script>',
  );

  const files = [pageOne, pageTwo, pageThree];
  const reads = new Map();
  const readFile = (file, encoding) => {
    reads.set(file, (reads.get(file) ?? 0) + 1);
    return fs.readFileSync(file, encoding);
  };
  const targets = collectHtmlTargets(
    root,
    [path.join(root, "css", "shared.css"), path.join(root, "js", "shared.js")],
    files,
    readFile,
  );

  assert.deepEqual([...targets].sort(), [pageOne, pageTwo].sort());
  assert.deepEqual(
    [...reads.entries()].sort(([a], [b]) => a.localeCompare(b)),
    files.map((file) => [file, 1]).sort(([a], [b]) => a.localeCompare(b)),
  );
});
