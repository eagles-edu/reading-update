const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectHtmlTargets,
  readHtmlTargets,
} = require("./sri-rehash-watch.cjs");

test("does not scan generated HTML under tmp", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sri-watch-ignore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, "tmp", "begin6"), { recursive: true });
  fs.mkdirSync(path.join(root, "pages"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tmp", "begin6", "generated.html"),
    "<html></html>",
  );
  fs.writeFileSync(path.join(root, "pages", "tracked.html"), "<html></html>");

  assert.deepEqual(readHtmlTargets(root), [
    path.join(root, "pages", "tracked.html"),
  ]);
});

test("batches changed asset references while reading each HTML page once", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sri-watch-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pageOne = path.join(root, "pages", "one.html");
  const pageTwo = path.join(root, "pages", "two.html");
  const pageThree = path.join(root, "pages", "three.html");
  const tonePage = path.join(root, "pages", "tone.html");
  for (const page of [pageOne, pageTwo, pageThree, tonePage]) {
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
  fs.writeFileSync(
    tonePage,
    '<script src="https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js"></script>',
  );

  const files = [pageOne, pageTwo, pageThree, tonePage];
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

  assert.deepEqual([...targets].sort(), [pageOne, pageTwo, tonePage].sort());
  assert.deepEqual(
    [...reads.entries()].sort(([a], [b]) => a.localeCompare(b)),
    files.map((file) => [file, 1]).sort(([a], [b]) => a.localeCompare(b)),
  );
});
