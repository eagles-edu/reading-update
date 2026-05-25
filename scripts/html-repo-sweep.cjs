#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const glob = require('glob');
const parse5 = require('parse5');

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const FLASH_PLAYER_RE =
  /\s*<script>\s*var so = new SWFObject\(\s*"playerSingle\.swf"\s*,\s*"mymovie"\s*,\s*"192"\s*,\s*"67"\s*,\s*"7"\s*,\s*"#FFFFFF"\s*\);\s*so\.addVariable\("autoPlay"\s*,\s*"no"\s*\);\s*so\.addVariable\("soundPath"\s*,\s*"[^"]+"\s*\);\s*so\.write\("flashPlayer"\);\s*<\/script>\s*(?:<br\s*\/?>\s*)?/gi;

const GOOGLE_AD_RE =
  /\s*if\s*\(\s*\(\s*res\.memb_status\s*==\s*1\s*\)\s*\)\s*\{\s*\$\(\s*'div\[class\^="ads-"\]'\s*\)\.remove\(\);\s*setTimeout\(\s*function\s*\(\s*\)\s*\{\s*\$\(\s*'\.google-auto-placed'\s*\)\.hide\(\);\s*\$\(\s*'\.google-auto-placed'\s*\)\.remove\(\);\s*\$\(\s*'\.adsbygoogle'\s*\)\.remove\(\);\s*\},\s*1000\s*\);\s*\}\s*/gi;

const SCRIPT_DIR = __dirname;
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [--apply] [--root PATH]

Normalize HTML files only:
  - normalize doctypes to <!DOCTYPE html>
  - strip XHTML-style slashes from void elements

Options:
  --apply     Write changes back to disk.
  --root PATH Scan a different repository root.
  --help      Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    root: DEFAULT_ROOT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--root') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('--root requires a path');
      }
      args.root = path.resolve(argv[i]);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function collectEdits(source) {
  const edits = [];
  const document = parse5.parse(source, { sourceCodeLocationInfo: true });

  const visit = (node) => {
    if (node.nodeName === '#documentType' && node.sourceCodeLocation) {
      const { startOffset, endOffset } = node.sourceCodeLocation;
      const raw = source.slice(startOffset, endOffset);
      const normalized = raw.replace(/^<!doctype/i, '<!DOCTYPE');
      if (normalized !== raw) {
        edits.push({
          kind: 'doctype',
          start: startOffset,
          end: endOffset,
          replacement: normalized,
        });
      }
    }

    if (
      node.tagName &&
      VOID_TAGS.has(node.tagName) &&
      node.sourceCodeLocation?.startTag
    ) {
      const { startOffset, endOffset } = node.sourceCodeLocation.startTag;
      const raw = source.slice(startOffset, endOffset);
      if (raw.trimEnd().endsWith('/>')) {
        edits.push({
          kind: 'void',
          start: startOffset,
          end: endOffset,
          replacement: raw.replace(/\s*\/>\s*$/, '>'),
        });
      }
    }

    if (node.childNodes) {
      for (const child of node.childNodes) {
        visit(child);
      }
    }

    if (node.content?.childNodes) {
      for (const child of node.content.childNodes) {
        visit(child);
      }
    }
  };

  visit(document);

  for (const match of source.matchAll(FLASH_PLAYER_RE)) {
    edits.push({
      kind: 'flash-player',
      start: match.index,
      end: match.index + match[0].length,
      replacement: '',
    });
  }

  for (const match of source.matchAll(GOOGLE_AD_RE)) {
    edits.push({
      kind: 'google-ads',
      start: match.index,
      end: match.index + match[0].length,
      replacement: '',
    });
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  return edits;
}

function applyEdits(source, edits) {
  let next = source;
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
  }
  return next;
}

function stripTrailingWhitespace(source) {
  return source.replace(/[ \t]+$/gm, '');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }

  if (args.help) {
    printUsage();
    return 0;
  }

  const files = glob.sync('**/*.{html,htm}', {
    absolute: true,
    cwd: args.root,
    dot: true,
    ignore: [
      '**/.git/**',
      '**/node_modules/**',
      '**/.playwright-cli/**',
      '**/.sto/**',
    ],
  });

  let scanned = 0;
  let changed = 0;
  let doctypeChanges = 0;
  let voidChanges = 0;
  let flashPlayerChanges = 0;
  let googleAdChanges = 0;

  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    scanned += 1;
    const source = fs.readFileSync(file, 'utf8');
    const edits = collectEdits(source);

    if (edits.length === 0) {
      continue;
    }

    changed += 1;
    doctypeChanges += edits.filter((edit) => edit.kind === 'doctype').length;
    voidChanges += edits.filter((edit) => edit.kind === 'void').length;
    flashPlayerChanges += edits.filter((edit) => edit.kind === 'flash-player').length;
    googleAdChanges += edits.filter((edit) => edit.kind === 'google-ads').length;

    console.log(`${path.relative(args.root, file)}\t${edits.length} change(s)`);

    if (args.apply) {
      const updated = stripTrailingWhitespace(applyEdits(source, edits));
      if (updated !== source) {
        fs.writeFileSync(file, updated);
      }
    }
  }

  console.log();
  console.log(`Scanned: ${scanned}`);
  console.log(`Changed: ${changed}`);
  console.log(`Doctype fixes: ${doctypeChanges}`);
  console.log(`Void-tag fixes: ${voidChanges}`);
  console.log(`Flash-player removals: ${flashPlayerChanges}`);
  console.log(`Google-ad removals: ${googleAdChanges}`);
  return 0;
}

process.exitCode = main();
