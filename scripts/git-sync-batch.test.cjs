"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const {
  lastPushedMessage,
  selectCommitMessage,
} = require("./git-sync-batch.cjs");

const script = path.join(__dirname, "git-sync-batch.cjs");
const temporaryRoots = [];

after(() => {
  for (const root of temporaryRoots)
    fs.rmSync(root, { recursive: true, force: true });
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-batch-"));
  temporaryRoots.push(root);
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "--quiet", "--bare", remote]);
  execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Batch Sync Test"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "batch-sync@example.invalid",
  ]);
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repo, "add", "--", "README.md"]);
  execFileSync("git", ["-C", repo, "commit", "--quiet", "-m", "fixture"]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remote]);
  execFileSync("git", [
    "-C",
    repo,
    "push",
    "--quiet",
    "--set-upstream",
    "origin",
    "main",
  ]);
  return { root, repo, remote };
}

function runScript(repo, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
  }).trim();
}

test("all dry-run lists thousands of paths without requiring a message or changing Git", () => {
  const { repo } = makeFixture();
  fs.mkdirSync(path.join(repo, "bulk"));
  for (let i = 0; i < 1001; i += 1) {
    fs.writeFileSync(
      path.join(repo, "bulk", `file-${String(i).padStart(4, "0")}.txt`),
      `entry ${i}\n`,
    );
  }
  const originalHead = git(repo, "rev-parse", "HEAD");
  const result = runScript(repo, ["--all"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Selected paths: 1001 \(1001 untracked\)/);
  assert.match(result.stdout, /file-1000\.txt/);
  assert.match(result.stdout, /Dry run only/);
  assert.equal(git(repo, "rev-parse", "HEAD"), originalHead);
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "");
  assert.equal(
    git(repo, "ls-remote", "origin", "refs/heads/main").split(/\s+/)[0],
    originalHead,
  );
});

test("apply stages in batches, commits only included paths, and verifies the push", () => {
  const { repo, remote } = makeFixture();
  fs.mkdirSync(path.join(repo, "bulk"));
  fs.mkdirSync(path.join(repo, "outside"));
  for (let i = 0; i < 1001; i += 1) {
    fs.writeFileSync(
      path.join(repo, "bulk", `file-${String(i).padStart(4, "0")}.txt`),
      `entry ${i}\n`,
    );
  }
  fs.writeFileSync(
    path.join(repo, "outside", "keep.txt"),
    "leave uncommitted\n",
  );

  const result = runScript(repo, [
    "--include",
    "bulk",
    "--message",
    "Add bulk fixture",
    "--push",
    "--apply",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Staged 1001 path\(s\) in 6 batch\(es\)/);
  assert.match(result.stdout, /Verified origin\/main at [0-9a-f]{40}/);
  const commit = git(repo, "rev-parse", "HEAD");
  const committedPaths = git(
    repo,
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "HEAD",
  ).split("\n");
  assert.equal(committedPaths.length, 1001);
  assert.ok(committedPaths.every((entry) => entry.startsWith("bulk/")));
  assert.equal(
    git(repo, "ls-remote", "origin", "refs/heads/main").split(/\s+/)[0],
    commit,
  );
  assert.equal(
    git(repo, "status", "--porcelain", "--untracked-files=all").trim(),
    "?? outside/keep.txt",
  );
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "");
  assert.ok(fs.existsSync(remote));
});

test("refuses to run when the index is already staged", () => {
  const { repo } = makeFixture();
  fs.writeFileSync(path.join(repo, "staged.txt"), "staged\n");
  execFileSync("git", ["-C", repo, "add", "--", "staged.txt"]);
  const result = runScript(repo, ["--all", "--message", "Should refuse"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index already has staged changes/);
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "staged.txt");
});

test("literal include paths do not interpret Git pathspec syntax", () => {
  const { repo } = makeFixture();
  fs.writeFileSync(path.join(repo, ":literal[1].txt"), "literal path\n");
  fs.writeFileSync(path.join(repo, "literal1.txt"), "out of scope\n");
  const result = runScript(repo, [
    "--include",
    ":literal[1].txt",
    "--message",
    "Add literal file",
    "--apply",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"),
    ":literal[1].txt",
  );
  assert.equal(git(repo, "status", "--porcelain").trim(), "?? literal1.txt");
});

test("unstages selected files when the staged whitespace check fails", () => {
  const { repo } = makeFixture();
  const originalHead = git(repo, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "bad.txt"), "trailing whitespace  \n");
  const result = runScript(repo, [
    "--include",
    "bad.txt",
    "--message",
    "Must not commit",
    "--apply",
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(git(repo, "rev-parse", "HEAD"), originalHead);
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "");
  assert.equal(
    git(repo, "status", "--porcelain", "--untracked-files=all").trim(),
    "?? bad.txt",
  );
});

test("interactive apply refuses non-terminal input before changing Git", () => {
  const { repo } = makeFixture();
  const originalHead = git(repo, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(repo, "pending.txt"), "pending\n");
  const result = runScript(repo, [
    "--all",
    "--apply",
    "--push",
    "--prompt-message",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires a terminal/);
  assert.equal(git(repo, "rev-parse", "HEAD"), originalHead);
  assert.equal(git(repo, "diff", "--cached", "--name-only"), "");
  assert.equal(
    git(repo, "status", "--porcelain", "--untracked-files=all").trim(),
    "?? pending.txt",
  );
});

test("prompt defaults to the latest commit pushed to the upstream", () => {
  const { repo } = makeFixture();
  execFileSync("git", [
    "-C",
    repo,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "Last message pushed",
  ]);
  execFileSync("git", ["-C", repo, "push", "--quiet", "origin", "main"]);
  execFileSync("git", ["-C", repo, "fetch", "--quiet", "origin"]);

  const defaultMessage = lastPushedMessage(repo, {
    remote: "origin",
    branch: "main",
  });
  assert.equal(defaultMessage, "Last message pushed");
  assert.equal(selectCommitMessage("", defaultMessage), "Last message pushed");
  assert.equal(
    selectCommitMessage("Custom commit", defaultMessage),
    "Custom commit",
  );
});
