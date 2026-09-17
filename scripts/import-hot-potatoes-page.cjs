#!/usr/bin/env node

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const { createBackupManager } = require("./write-backup.cjs");

const ROOT = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage: node import-hot-potatoes-page.cjs --source FILE --target FILE [--apply]

Import a recovered Hot Potatoes source page into an existing repository target.

  --source FILE  Complete recovered source page.
  --target FILE  Existing repository page to replace.
  --apply        Back up the target and write the source; otherwise dry-run.
`);
}

function parseArgs(argv) {
  const args = { apply: false, source: null, target: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--source" || arg === "--target") {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a path`);
      args[arg.slice(2)] = path.resolve(ROOT, argv[index]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!args.help && (!args.source || !args.target)) {
    throw new Error("--source and --target are required");
  }
  return args;
}

function sha384(contents) {
  return crypto.createHash("sha384").update(contents).digest("hex");
}

function assertSafePaths(source, target) {
  if (source === target) throw new Error("source and target must be different files");
  if (!fs.statSync(source).isFile()) throw new Error(`source is not a regular file: ${path.relative(ROOT, source)}`);
  if (!fs.existsSync(target)) throw new Error(`target does not exist: ${path.relative(ROOT, target)}`);
  if (!fs.statSync(target).isFile()) throw new Error(`target is not a regular file: ${path.relative(ROOT, target)}`);
  const contents = fs.readFileSync(source, "utf8");
  if (!/<body\b[^>]*\bid\s*=\s*["']TheBody["']/i.test(contents)) {
    throw new Error("source does not contain body#TheBody");
  }
  if (!/<div\b[^>]*\bid\s*=\s*["']ClozeDiv["']/i.test(contents)) {
    throw new Error("source does not contain #ClozeDiv");
  }
}

function removeElementBlocks(source, openingPattern) {
  let output = source;
  let opening;
  while ((opening = openingPattern.exec(output))) {
    const elementName = opening[0].match(/^<([a-z][\w:-]*)\b/i)?.[1];
    if (!elementName) throw new Error("captured markup sanitizer found an invalid element boundary");
    const tags = new RegExp(`<!--[\\s\\S]*?-->|</?${elementName}\\b[^>]*>`, "gi");
    tags.lastIndex = opening.index + opening[0].length;
    let depth = 1;
    let token;
    let end = -1;
    while ((token = tags.exec(output))) {
      if (token[0].startsWith("<!--")) continue;
      if (token[0].startsWith("</")) depth -= 1;
      else if (!token[0].endsWith("/ >") && !token[0].endsWith("/>") && !token[0].endsWith(" />")) depth += 1;
      if (depth === 0) {
        end = tags.lastIndex;
        break;
      }
    }
    if (end < 0) throw new Error(`captured markup sanitizer cannot close ${elementName}`);
    output = `${output.slice(0, opening.index)}${output.slice(end)}`;
    openingPattern.lastIndex = 0;
  }
  return output;
}

function sanitizeCapturedExercise(source) {
  let output = source;
  output = output.replace(/^\s*< !--\s*$/m, "// Legacy HTML comment marker was malformed in the recovered source.");
  output = output.replace(/\sstyle\s*=\s*(["'])overflow:\s*hidden;\1/i, "");
  output = output.replace(/\sstyle\s*=\s*(["'])max-width:\s*900px;\s*width:\s*100%;\s*margin:\s*0px\s+auto;\s*height:\s*auto\s*!important;\1/i, "");
  output = output.replace(/\sstyle\s*=\s*(["'])font-size:\s*1\.2rem;\s*height:\s*auto\s*!important;\1/i, "");
  output = output.replace(/\sstyle\s*=\s*(["'])height:\s*auto\s*!important;\1/gi, "");
  output = removeElementBlocks(
    output,
    /<div\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:ads-top|fc-message-root)\b[^"']*\1)[^>]*>/gi,
  );
  output = removeElementBlocks(output, /<ins\b[^>]*>/gi);
  output = output.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "");
  output = output.replace(/\s*<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1)[^>]*>/gi, "");
  output = output.replace(/\s*<link\b(?=[^>]*\b(?:href|src)\s*=\s*(["'])[^"']*_files\/)[^>]*>/gi, "");
  output = output.replace(/\s*<script\b(?=[^>]*\bsrc\s*=\s*(["'])[^"']*_files\/)[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  output = output.replace(/(<body\b[^>]*>\s*)<div\s*>/i, '$1<div class="wrapit">');
  return output.replace(/[\t ]+$/gm, "");
}

function writeAtomically(target, contents) {
  const temporary = `${target}.import-${process.pid}-${Date.now()}`;
  const mode = fs.statSync(target).mode;
  try {
    fs.writeFileSync(temporary, contents, { mode });
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
    throw error;
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      usage();
      return 0;
    }
    assertSafePaths(args.source, args.target);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    usage();
    return 2;
  }

  const sourceRelative = path.relative(ROOT, args.source);
  const targetRelative = path.relative(ROOT, args.target);
  const recovered = sanitizeCapturedExercise(fs.readFileSync(args.source, "utf8"));
  console.log(`Source: ${sourceRelative} (${recovered.length} sanitized bytes, sha384=${sha384(recovered)})`);
  const targetContents = fs.readFileSync(args.target, "utf8");
  console.log(`Target: ${targetRelative} (${targetContents.length} bytes, sha384=${sha384(targetContents)})`);
  if (!args.apply) {
    console.log("DRY-RUN: target was not changed.");
    return 0;
  }

  const backupManager = createBackupManager(ROOT, "import-hot-potatoes-page");
  backupManager.backupBeforeWrite(args.target);
  writeAtomically(args.target, recovered);
  console.log(`Imported ${sourceRelative} -> ${targetRelative}`);
  console.log(`Backup: ${backupManager.runRoot}`);
  return 0;
}

process.exitCode = main();
