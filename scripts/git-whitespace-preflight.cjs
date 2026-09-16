#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createBackupManager } = require("./write-backup.cjs");

const BLOCKED_PATH_PREFIXES = ["tmp"];

function usage() {
  return `Usage: ${path.basename(process.argv[1])} [options]

Find and repair whitespace rejected by Git's cached diff check.
The default mode is a dry-run and only examines Git-changed paths.
It removes trailing spaces and tabs, spaces before indentation tabs,
collapses every contiguous blank-line run to one line, and removes blank
lines at EOF.

Options:
  --apply            Write repairs after creating and verifying a backup.
  --dry-run          Report repairs without writing files (default).
  --root PATH       Repository root; defaults to the current repository.
  --include PATH    Limit the check to a repository-relative path; repeatable.
  --help             Show this help.

Typical pre-commit sequence:
  npm run git:whitespace:dry
  npm run git:whitespace:apply
  npm run git:apply:all
`;
}

function parseArgs(argv) {
  const args = {
    apply: false,
    root: process.cwd(),
    includes: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.apply = false;
      continue;
    }
    if (arg === "--root") {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("-")) {
        throw new Error("--root requires a path.");
      }
      args.root = path.resolve(argv[index]);
      continue;
    }
    if (arg === "--include") {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("-")) {
        throw new Error("--include requires a path.");
      }
      args.includes.push(normalizeInclude(argv[index]));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function normalizeInclude(value) {
  if (value.includes("\\")) {
    throw new Error(`Use forward slashes in include paths: ${value}`);
  }
  const normalized = value.replace(/\/+$/u, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new Error(`Include path must be repository-relative: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(
      `Include path cannot contain empty, ".", or ".." segments: ${value}`,
    );
  }
  if (isBlockedPath(normalized)) {
    throw new Error(
      `The repository path is blocked from whitespace cleanup: ${value}`,
    );
  }
  return normalized;
}

function isBlockedPath(relative) {
  return BLOCKED_PATH_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || "").trim();
    throw new Error(
      detail
        ? `git ${args[0]} failed: ${detail}`
        : `git ${args[0]} failed (exit ${result.status})`,
    );
  }
  return result;
}

function findRepositoryRoot(requestedRoot) {
  const candidate = path.resolve(requestedRoot);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`Root is not a directory: ${candidate}`);
  }
  return runGit(candidate, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function verifyIncludes(root, includes) {
  for (const include of includes) {
    const target = path.resolve(root, ...include.split("/"));
    if (!isWithinRoot(root, target)) {
      throw new Error(`Include path escapes the repository: ${include}`);
    }
  }
}

function parseStatus(root) {
  const result = runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  const warning = String(result.stderr || "").trim();
  if (warning) {
    console.error(`Git status warning: ${warning}`);
  }
  if (!result.stdout) return [];
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      if (record.length < 4 || record[2] !== " ") {
        throw new Error("Could not parse Git status output safely.");
      }
      return { code: record.slice(0, 2), relative: record.slice(3) };
    });
}

function isIncluded(relative, includes) {
  if (isBlockedPath(relative)) return false;
  return (
    includes.length === 0 ||
    includes.some(
      (include) => relative === include || relative.startsWith(`${include}/`),
    )
  );
}

function splitLines(source) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== 0x0a && source[index] !== 0x0d) continue;
    const endingLength =
      source[index] === 0x0d && source[index + 1] === 0x0a ? 2 : 1;
    lines.push({
      content: source.subarray(start, index),
      ending: source.subarray(index, index + endingLength),
    });
    start = index + endingLength;
    index += endingLength - 1;
  }
  if (start < source.length || lines.length === 0) {
    lines.push({ content: source.subarray(start), ending: Buffer.alloc(0) });
  }
  return lines;
}

function removeTrailingWhitespace(content) {
  let contentEnd = content.length;
  while (
    contentEnd > 0 &&
    (content[contentEnd - 1] === 0x20 || content[contentEnd - 1] === 0x09)
  ) {
    contentEnd -= 1;
  }
  return {
    content: content.subarray(0, contentEnd),
    changed: contentEnd !== content.length,
  };
}

function normalizeIndent(content) {
  let indentLength = 0;
  while (
    indentLength < content.length &&
    (content[indentLength] === 0x20 || content[indentLength] === 0x09)
  ) {
    indentLength += 1;
  }
  if (indentLength === 0) {
    return { content, changed: false };
  }

  const indent = content.subarray(0, indentLength);
  const normalized = [];
  let changed = false;
  for (let index = 0; index < indent.length; index += 1) {
    const byte = indent[index];
    const hasLaterTab = indent.subarray(index + 1).includes(0x09);
    if (byte === 0x20 && hasLaterTab) {
      changed = true;
      continue;
    }
    normalized.push(byte);
  }
  if (!changed) return { content, changed: false };
  return {
    content: Buffer.concat([
      Buffer.from(normalized),
      content.subarray(indentLength),
    ]),
    changed: true,
  };
}

function isBlankLine(content) {
  for (const byte of content) {
    if (byte !== 0x0d && byte !== 0x20 && byte !== 0x09) return false;
  }
  return true;
}

function normalizeWhitespace(source) {
  const original = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const lines = splitLines(original);
  let trailingWhitespaceLines = 0;
  let spaceBeforeTabLines = 0;
  let blankLinesCollapsed = 0;
  const normalizedLines = lines.map((line) => {
    const trailing = removeTrailingWhitespace(line.content);
    const indent = normalizeIndent(trailing.content);
    if (trailing.changed) trailingWhitespaceLines += 1;
    if (indent.changed) spaceBeforeTabLines += 1;
    return {
      content: indent.content,
      ending: line.ending,
    };
  });

  const collapsedLines = [];
  let previousBlank = false;
  for (const line of normalizedLines) {
    const blank = isBlankLine(line.content);
    if (blank && previousBlank) {
      blankLinesCollapsed += 1;
      continue;
    }
    collapsedLines.push(line);
    previousBlank = blank;
  }

  let end = collapsedLines.length;
  while (end > 0 && isBlankLine(collapsedLines[end - 1].content)) end -= 1;
  const blankLinesAtEof = collapsedLines.length - end;
  const kept = collapsedLines.slice(0, end);
  const updated = Buffer.concat(
    kept.map((line) => Buffer.concat([line.content, line.ending])),
  );
  return {
    source: updated,
    trailingWhitespaceLines,
    spaceBeforeTabLines,
    blankLinesCollapsed,
    blankLinesAtEof,
  };
}

function isBinary(source) {
  return source.includes(0x00);
}

function inspectTargets(root, records, includes) {
  const plans = [];
  const skipped = [];
  for (const record of records) {
    if (!isIncluded(record.relative, includes)) continue;
    if (record.code.includes("D")) {
      skipped.push({ relative: record.relative, reason: "deleted" });
      continue;
    }
    const absolute = path.resolve(root, record.relative);
    if (!isWithinRoot(root, absolute)) {
      throw new Error(
        `Git returned a path outside the repository: ${record.relative}`,
      );
    }
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      throw new Error(`Cannot inspect ${record.relative}: ${error.message}`, {
        cause: error,
      });
    }
    if (!stat.isFile()) {
      skipped.push({ relative: record.relative, reason: "not a regular file" });
      continue;
    }
    const source = fs.readFileSync(absolute);
    if (isBinary(source)) {
      skipped.push({ relative: record.relative, reason: "binary" });
      continue;
    }
    const result = normalizeWhitespace(source);
    if (result.source.equals(source)) continue;
    plans.push({
      absolute,
      relative: record.relative,
      source,
      mode: stat.mode,
      result,
    });
  }
  return { plans, skipped };
}

function backupPath(backupRoot, relative) {
  const target = path.resolve(backupRoot, relative);
  if (!isWithinRoot(backupRoot, target)) {
    throw new Error(`Backup path escapes the backup root: ${relative}`);
  }
  return target;
}

function writeAtomically(file, source, mode, sequence) {
  const temporary = `${file}.git-whitespace-${process.pid}-${sequence}.tmp`;
  try {
    fs.writeFileSync(temporary, source, { mode: mode & 0o7777 });
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function applyPlans(root, plans) {
  const backupManager = createBackupManager(root, "git-whitespace-preflight");
  for (const plan of plans) backupManager.backupBeforeWrite(plan.absolute);
  for (const plan of plans) {
    const backup = backupPath(backupManager.runRoot, plan.relative);
    const backedUp = fs.readFileSync(backup);
    if (!backedUp.equals(plan.source)) {
      throw new Error(`${plan.relative}: backup verification failed.`);
    }
  }

  for (const plan of plans) {
    const current = fs.readFileSync(plan.absolute);
    if (!current.equals(plan.source)) {
      throw new Error(
        `${plan.relative}: changed while the preflight was running; no repairs were written after the backup phase.`,
      );
    }
  }

  const written = [];
  try {
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      writeAtomically(plan.absolute, plan.result.source, plan.mode, index);
      written.push(plan);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (let index = written.length - 1; index >= 0; index -= 1) {
      const plan = written[index];
      try {
        const backup = backupPath(backupManager.runRoot, plan.relative);
        writeAtomically(
          plan.absolute,
          fs.readFileSync(backup),
          plan.mode,
          `rollback-${index}`,
        );
      } catch (rollbackError) {
        rollbackErrors.push(`${plan.relative}: ${rollbackError.message}`);
      }
    }
    const rollbackDetail = rollbackErrors.length
      ? ` Rollback errors: ${rollbackErrors.join("; ")}.`
      : " Previously written files were restored from the verified backup.";
    throw new Error(
      `${error.message}${rollbackDetail} Backup: ${backupManager.runRoot}`,
      { cause: error },
    );
  }
  return backupManager.runRoot;
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return 0;
    }
    const root = findRepositoryRoot(args.root);
    verifyIncludes(root, args.includes);
    const records = parseStatus(root);
    const { plans, skipped } = inspectTargets(root, records, args.includes);

    console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`Repository: ${root}`);
    console.log(
      `Changed paths inspected: ${records.filter((record) => isIncluded(record.relative, args.includes)).length}`,
    );
    console.log(`Whitespace repairs: ${plans.length}`);
    for (const plan of plans) {
      const { result } = plan;
      console.log(
        `${plan.relative}\ttrailing-lines=${result.trailingWhitespaceLines}\tspace-before-tab-lines=${result.spaceBeforeTabLines}\tblank-lines-collapsed=${result.blankLinesCollapsed}\tblank-lines-at-eof=${result.blankLinesAtEof}`,
      );
    }
    if (skipped.length) {
      console.log(`Skipped: ${skipped.length}`);
      for (const item of skipped)
        console.log(`  ${item.relative}\t${item.reason}`);
    }
    if (args.apply && plans.length) {
      const backup = applyPlans(root, plans);
      console.log(`Applied ${plans.length} repair(s). Backup: ${backup}`);
    } else if (!plans.length) {
      console.log("No Git whitespace repairs needed.");
    } else {
      console.log("Dry-run only. Re-run with --apply to write the repairs.");
    }
    return 0;
  } catch (error) {
    console.error(`git-whitespace-preflight: ${error.message}`);
    return 2;
  }
}

module.exports = {
  isBinary,
  normalizeInclude,
  normalizeWhitespace,
  parseArgs,
  splitLines,
};

if (require.main === module) process.exitCode = main();
