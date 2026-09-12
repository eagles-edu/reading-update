#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createInterface } = require("node:readline/promises");
const { spawnSync } = require("node:child_process");

const MAX_PATHS_PER_BATCH = 200;
const MAX_ARGUMENT_BYTES_PER_BATCH = 16 * 1024;
const PREVIEW_PATH_LIMIT = 40;

function usage() {
  return [
    "Safely stage, commit, and optionally push an explicit set of worktree changes.",
    "",
    "Usage:",
    "  npm run git:sync -- --include <path> [--include <path> ...] --message <text>",
    "  npm run git:sync -- --all [--message <text>]",
    "",
    "Options:",
    "  --include <path>  Include one literal file or directory (repeatable).",
    "  --all              Include every changed or untracked path in the repository.",
    "  --message <text>   Commit message; required with --apply unless --prompt-message is used.",
    "  --prompt-message   Ask for a commit message interactively before applying.",
    "  --apply            Stage and commit. Without this, the command is a dry run.",
    "  --push             Push the new commit to the configured upstream (requires --apply).",
    "  --help             Show this help.",
    "",
    "Example:",
    "  npm run git:sync -- --include begin1",
    "  npm run git:sync -- --include begin1 --push --apply --prompt-message",
  ].join("\n");
}

function parseArguments(argv) {
  const options = {
    includes: [],
    all: false,
    apply: false,
    push: false,
    message: "",
    promptMessage: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--push") {
      options.push = true;
    } else if (arg === "--prompt-message") {
      options.promptMessage = true;
    } else if (arg === "--include" || arg === "--message") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      i += 1;
      if (arg === "--include") options.includes.push(value);
      if (arg === "--message") options.message = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.help) return options;
  const hasIncludes = options.includes.length > 0;
  if (options.all === hasIncludes) {
    throw new Error(
      "Choose exactly one scope: --all or one or more --include paths.",
    );
  }
  if (options.message && options.promptMessage)
    throw new Error("Choose either --message or --prompt-message, not both.");
  if (options.apply && !options.message.trim() && !options.promptMessage)
    throw new Error("Use --message or --prompt-message when applying changes.");
  if (options.promptMessage && !options.apply)
    throw new Error("--prompt-message requires --apply.");
  if (options.push && !options.apply)
    throw new Error("--push requires --apply.");
  options.includes = options.includes.map(normalizeInclude);
  return options;
}

function normalizeInclude(value) {
  if (value.includes("\\"))
    throw new Error(`Use forward slashes in include paths: ${value}`);
  const normalized = value.replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(
      `Include path must be a repository-relative file or directory: ${value}`,
    );
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(
      `Include path cannot contain empty, ".", or ".." segments: ${value}`,
    );
  }
  return normalized;
}

function invokeGit(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: options.encoding === "buffer" ? null : "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error)
    throw new Error(`Could not run git ${args[0]}: ${result.error.message}`);
  const accepted = options.accept || [0];
  if (!accepted.includes(result.status)) {
    const detail = options.sensitive
      ? ` (exit ${result.status})`
      : formatGitError(result.stderr, result.status);
    throw new Error(`git ${args[0]} failed${detail}`);
  }
  if (options.returnStatus) return result.status;
  return result.stdout;
}

function formatGitError(stderr, status) {
  const message = String(stderr || "").trim();
  return message ? `: ${message}` : ` (exit ${status})`;
}

function gitText(root, args, options = {}) {
  return invokeGit(root, args, options).trimEnd();
}

function gitNulList(root, args) {
  const output = invokeGit(root, args, { encoding: "buffer" });
  if (!output.length) return [];
  const entries = output.toString("utf8").split("\0");
  if (entries.at(-1) === "") entries.pop();
  return entries;
}

function findRepositoryRoot(requestedRoot) {
  const absoluteRoot = path.resolve(requestedRoot);
  if (
    !fs.existsSync(absoluteRoot) ||
    !fs.statSync(absoluteRoot).isDirectory()
  ) {
    throw new Error(`Repository directory does not exist: ${absoluteRoot}`);
  }
  return gitText(absoluteRoot, ["rev-parse", "--show-toplevel"]);
}

function parseStatus(root) {
  const records = gitNulList(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  return records.map((record) => {
    if (record.length < 4 || record[2] !== " ")
      throw new Error("Could not parse Git status output safely.");
    return { code: record.slice(0, 2), path: record.slice(3) };
  });
}

function isIncluded(filePath, includes) {
  return includes.some(
    (include) => filePath === include || filePath.startsWith(`${include}/`),
  );
}

function verifyIncludes(root, includes) {
  for (const include of includes) {
    const resolved = path.resolve(root, ...include.split("/"));
    const relative = path.relative(root, resolved);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`Include path escapes the repository: ${include}`);
    }
  }
}

function indexIsClean(root) {
  const status = invokeGit(root, ["diff", "--cached", "--quiet"], {
    accept: [0, 1],
    returnStatus: true,
  });
  if (status !== 0)
    throw new Error(
      "The Git index already has staged changes; commit or unstage them before using git:sync.",
    );
}

function assertNoUnmergedPaths(root) {
  const unmerged = gitNulList(root, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z",
  ]);
  if (unmerged.length)
    throw new Error(
      `Resolve unmerged paths before using git:sync (${unmerged.length} path(s)).`,
    );
}

function assertNoGitOperationInProgress(root) {
  const gitPaths = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ];
  const active = gitPaths.filter((name) => {
    const value = gitText(root, ["rev-parse", "--git-path", name]);
    return fs.existsSync(path.resolve(root, value));
  });
  if (active.length)
    throw new Error(
      `Git operation in progress (${active.join(", ")}); finish or abort it first.`,
    );
}

function currentBranch(root) {
  const branch = gitText(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    accept: [0, 1],
  });
  if (!branch)
    throw new Error(
      "Detached HEAD is not supported; check out a branch first.",
    );
  return branch;
}

function resolveUpstream(root) {
  const upstream = gitText(
    root,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { accept: [0, 128] },
  );
  if (!upstream)
    throw new Error(
      "The current branch has no configured upstream; configure one before using --push.",
    );
  const separator = upstream.indexOf("/");
  if (separator <= 0 || separator === upstream.length - 1) {
    throw new Error(
      `Cannot resolve the upstream remote and branch from: ${upstream}`,
    );
  }
  return {
    name: upstream,
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function assertNoOperationConflict(root) {
  assertNoGitOperationInProgress(root);
  assertNoUnmergedPaths(root);
  indexIsClean(root);
}

function planPaths(records, options) {
  const selected = records.filter(
    ({ path: filePath }) =>
      options.all || isIncluded(filePath, options.includes),
  );
  if (!selected.length)
    throw new Error("No changed or untracked paths match the requested scope.");
  return selected.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

function pathStatusLabel(code) {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  return "modified";
}

function printPlan(records, options, branch, upstream) {
  const counts = new Map();
  const groups = new Map();
  for (const record of records) {
    const label = pathStatusLabel(record.code);
    counts.set(label, (counts.get(label) || 0) + 1);
    const group = record.path.split("/")[0];
    groups.set(group, (groups.get(group) || 0) + 1);
  }

  const scope = options.all
    ? "all worktree changes"
    : options.includes.join(", ");
  console.log(`Scope: ${scope}`);
  console.log(`Branch: ${branch}${upstream ? ` -> ${upstream.name}` : ""}`);
  console.log(
    `Commit: ${options.message || (options.promptMessage ? "(will prompt before applying)" : "(not needed for dry run)")}`,
  );
  console.log(
    `Selected paths: ${records.length} (${[...counts].map(([label, count]) => `${count} ${label}`).join(", ")})`,
  );
  const sortedGroups = [...groups].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(
    `Top-level groups: ${sortedGroups
      .slice(0, 20)
      .map(([name, count]) => `${name} (${count})`)
      .join(
        ", ",
      )}${sortedGroups.length > 20 ? `, ... ${sortedGroups.length - 20} more` : ""}`,
  );
  console.log("Paths:");
  const shownPaths = options.all
    ? records
    : records.slice(0, PREVIEW_PATH_LIMIT);
  for (const { code, path: filePath } of shownPaths) {
    console.log(`  ${code} ${filePath}`);
  }
  if (records.length > shownPaths.length)
    console.log(`  ... ${records.length - PREVIEW_PATH_LIMIT} more path(s)`);
  if (!options.apply) {
    console.log(
      "Dry run only. Add --apply to stage and commit. Add --push as well to push to the configured upstream.",
    );
  }
}

function makeBatches(paths) {
  const batches = [];
  let batch = [];
  let byteCount = 0;
  for (const filePath of paths) {
    const pathspec = `:(top,literal)${filePath}`;
    const size = Buffer.byteLength(pathspec, "utf8") + 1;
    if (
      batch.length &&
      (batch.length >= MAX_PATHS_PER_BATCH ||
        byteCount + size > MAX_ARGUMENT_BYTES_PER_BATCH)
    ) {
      batches.push(batch);
      batch = [];
      byteCount = 0;
    }
    batch.push(pathspec);
    byteCount += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function stagePaths(root, records) {
  const batches = makeBatches(records.map(({ path: filePath }) => filePath));
  for (const batch of batches) {
    invokeGit(root, ["add", "-A", "--", ...batch]);
  }
  return batches;
}

function stagedPaths(root) {
  return gitNulList(root, [
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
  ]).sort((a, b) => a.localeCompare(b, "en"));
}

function assertSamePaths(actual, expected, label) {
  const sortedExpected = [...expected].sort((a, b) => a.localeCompare(b, "en"));
  if (
    actual.length !== sortedExpected.length ||
    actual.some((value, index) => value !== sortedExpected[index])
  ) {
    const expectedSet = new Set(sortedExpected);
    const actualSet = new Set(actual);
    const unexpected = actual.filter((value) => !expectedSet.has(value));
    const missing = sortedExpected.filter((value) => !actualSet.has(value));
    throw new Error(
      `${label} differs from the reviewed path list (unexpected: ${unexpected.length}, missing: ${missing.length}).`,
    );
  }
}

function verifyStagedWorktree(root, records, baselineRecords) {
  const current = parseStatus(root);
  const expected = baselineRecords
    .map(({ path: filePath }) => filePath)
    .sort((a, b) => a.localeCompare(b, "en"));
  const actual = current
    .map(({ path: filePath }) => filePath)
    .sort((a, b) => a.localeCompare(b, "en"));
  assertSamePaths(actual, expected, "Worktree status");
  const selected = new Set(records.map(({ path: filePath }) => filePath));
  const baseline = new Map(
    baselineRecords.map(({ code, path: filePath }) => [filePath, code]),
  );
  const currentByPath = new Map(
    current.map(({ code, path: filePath }) => [filePath, code]),
  );
  const unstaged = records.filter(({ path: filePath }) => {
    const code = currentByPath.get(filePath);
    return !code || code[0] === " " || code[1] !== " ";
  });
  if (unstaged.length) {
    throw new Error(
      `Could not verify all selected paths were staged without concurrent edits (${unstaged.length} path(s)); refusing to commit.`,
    );
  }
  const changedOutsideScope = current.filter(
    ({ code, path: filePath }) =>
      !selected.has(filePath) && baseline.get(filePath) !== code,
  );
  if (changedOutsideScope.length) {
    throw new Error(
      `Detected concurrent out-of-scope changes (${changedOutsideScope.length} path(s)); refusing to commit.`,
    );
  }
}

function unstagePaths(root, records) {
  const staged = new Set(stagedPaths(root));
  const paths = records
    .map(({ path: filePath }) => filePath)
    .filter((filePath) => staged.has(filePath));
  for (const batch of makeBatches(paths)) {
    invokeGit(root, ["restore", "--staged", "--", ...batch], {
      accept: [0, 1],
    });
  }
}

function verifyCommitPaths(root, expected) {
  const actual = gitNulList(root, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "--no-renames",
    "-z",
    "HEAD",
  ]).sort((a, b) => a.localeCompare(b, "en"));
  assertSamePaths(actual, expected, "Commit contents");
}

function assertPushBaseIsCurrent(root, upstream, initialHead) {
  console.log(`Fetching upstream ${upstream.name} before commit...`);
  invokeGit(root, ["fetch", "--quiet", "--no-tags", upstream.remote], {
    sensitive: true,
  });
  const branchHead = gitText(root, ["rev-parse", "HEAD"]);
  if (branchHead !== initialHead)
    throw new Error(
      "HEAD changed while preparing the operation; rerun after reviewing the repository state.",
    );
  const upstreamHead = gitText(
    root,
    ["rev-parse", "--verify", `${upstream.remote}/${upstream.branch}`],
    { accept: [0, 128] },
  );
  if (!upstreamHead)
    throw new Error(`Fetched upstream ref is unavailable: ${upstream.name}`);
  if (upstreamHead !== initialHead) {
    throw new Error(
      `Local HEAD and ${upstream.name} are not identical; synchronize the branch before committing and pushing.`,
    );
  }
}

function pushAndVerify(root, upstream, commit) {
  console.log(`Pushing commit ${commit.slice(0, 12)} to ${upstream.name}...`);
  try {
    invokeGit(
      root,
      [
        "push",
        "--porcelain",
        upstream.remote,
        `HEAD:refs/heads/${upstream.branch}`,
      ],
      { sensitive: true },
    );
  } catch {
    throw new Error(
      `Commit ${commit} was created, but push failed. Resolve the push issue and push this commit normally.`,
    );
  }
  const output = gitText(
    root,
    ["ls-remote", "--heads", upstream.remote, `refs/heads/${upstream.branch}`],
    { sensitive: true },
  );
  const remoteHead = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .find(Boolean);
  if (remoteHead !== commit)
    throw new Error(
      `Push returned success, but remote verification did not match commit ${commit}.`,
    );
}

function lastPushedMessage(root, upstream) {
  let ref = "";
  if (upstream) {
    ref = `${upstream.remote}/${upstream.branch}`;
  } else {
    ref = gitText(
      root,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { accept: [0, 128] },
    );
  }
  if (!ref) return "";
  return gitText(root, ["log", "-1", "--format=%s", ref], {
    accept: [0, 128],
  });
}

function selectCommitMessage(answer, defaultMessage) {
  const message = answer.trim() || defaultMessage.trim();
  if (!message) throw new Error("Commit message cannot be empty.");
  return message;
}

async function promptForMessage(defaultMessage) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Interactive message prompt requires a terminal; rerun with --message <text> instead.",
    );
  }
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const prompt = defaultMessage
      ? `Commit message [${defaultMessage}]: `
      : "Commit message: ";
    return selectCommitMessage(await terminal.question(prompt), defaultMessage);
  } finally {
    terminal.close();
  }
}

async function run(options) {
  const root = findRepositoryRoot(process.cwd());
  verifyIncludes(root, options.includes);
  assertNoOperationConflict(root);
  const branch = currentBranch(root);
  const initialHead = gitText(root, ["rev-parse", "--verify", "HEAD"]);
  let upstream = null;
  if (options.push) upstream = resolveUpstream(root);

  const plannedRecords = planPaths(parseStatus(root), options);
  printPlan(plannedRecords, options, branch, upstream);
  if (!options.apply) return;

  if (options.push) assertPushBaseIsCurrent(root, upstream, initialHead);

  if (options.promptMessage) {
    const defaultMessage = lastPushedMessage(root, upstream);
    options.message = await promptForMessage(defaultMessage);
    console.log(`Using commit message: ${options.message}`);
  }

  const latestRecords = parseStatus(root);
  const latestPaths = latestRecords
    .map(({ path: filePath }) => filePath)
    .sort((a, b) => a.localeCompare(b, "en"));
  const plannedPaths = plannedRecords
    .map(({ path: filePath }) => filePath)
    .sort((a, b) => a.localeCompare(b, "en"));
  assertSamePaths(
    latestPaths.filter(
      (filePath) => options.all || isIncluded(filePath, options.includes),
    ),
    plannedPaths,
    "Changes since preview",
  );
  assertNoOperationConflict(root);

  let commitCreated = false;
  try {
    const batches = stagePaths(root, plannedRecords);
    console.log(
      `Staged ${plannedRecords.length} path(s) in ${batches.length} batch(es).`,
    );
    assertSamePaths(stagedPaths(root), plannedPaths, "Staged index");
    verifyStagedWorktree(root, plannedRecords, latestRecords);
    invokeGit(root, [
      "-c",
      "core.whitespace=cr-at-eol,blank-at-eol,blank-at-eof,space-before-tab",
      "diff",
      "--cached",
      "--check",
    ]);
    invokeGit(root, ["commit", "-m", options.message]);
    commitCreated = true;
  } catch (error) {
    if (!commitCreated) {
      try {
        unstagePaths(root, plannedRecords);
      } catch (rollbackError) {
        throw new Error(
          `${error.message} Automatic unstage failed: ${rollbackError.message}`,
        );
      }
    }
    throw error;
  }

  const commit = gitText(root, ["rev-parse", "HEAD"]);
  verifyCommitPaths(root, plannedPaths);
  const selectedSet = new Set(plannedPaths);
  const remaining = parseStatus(root);
  const leftoverSelected = remaining.filter(({ path: filePath }) =>
    selectedSet.has(filePath),
  );
  if (leftoverSelected.length) {
    throw new Error(
      `Commit ${commit} was created, but ${leftoverSelected.length} selected path(s) remain modified; review before pushing.`,
    );
  }
  console.log(`Created commit ${commit}.`);
  const remainingOutOfScope = remaining.filter(
    ({ path: filePath }) => !selectedSet.has(filePath),
  ).length;
  if (remainingOutOfScope)
    console.log(
      `Left ${remainingOutOfScope} out-of-scope worktree path(s) unchanged.`,
    );
  if (options.push) {
    pushAndVerify(root, upstream, commit);
    console.log(`Verified ${upstream.name} at ${commit}.`);
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    await run(options);
  } catch (error) {
    console.error(`git:sync: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = {
  lastPushedMessage,
  makeBatches,
  normalizeInclude,
  parseArguments,
  selectCommitMessage,
};
