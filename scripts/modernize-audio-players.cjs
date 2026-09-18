#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const glob = require('glob');

const { createBackupManager } = require('./write-backup.cjs');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const MAX_SAFE_APPLY_PAGES = 50;
const STORY_PATHS = [
  'eslread/ss',
  'easyread/es',
  'essays/e',
  'kidsenglish/ke',
  'kidsenglish2/ke2',
  'kidsenglish3/ke3',
  'people/p',
  'supereasy/se',
];
const ASSET_MARKER_RE = /(?:\r?\n)?[ \t]*<!--[ \t]*EAGLES AUDIO PLAYER ASSETS START[ \t]*-->[\s\S]*?<!--[ \t]*EAGLES AUDIO PLAYER ASSETS END[ \t]*-->[ \t]*(?:\r?\n)?/i;

function printUsage() {
  console.log(`Usage: ${path.basename(process.argv[1])} [options]

Add the shared Eagles audio player to static story and dictation pages.
The default mode is a dry run. Existing audio source URLs are preserved.

Options:
  --dry-run       Report changes without writing files (default).
  --apply         Write changes after the safety checks pass.
  --allow-bulk    Allow --apply to change more than ${MAX_SAFE_APPLY_PAGES} pages.
  --family NAME   stories, dictation, or all. Default: all.
  --root PATH     Scan a different repository root.
  --include PATH  Restrict scanning to a repository-relative path. Repeatable.
  --help          Show this help.
`);
}

function parseArgs(argv) {
  const args = { allowBulk: false, apply: false, family: 'all', include: [], root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--allow-bulk') args.allowBulk = true;
    else if (arg === '--family') {
      index += 1;
      if (!['stories', 'dictation', 'all'].includes(argv[index])) throw new Error('--family must be stories, dictation, or all');
      args.family = argv[index];
    } else if (arg === '--root') {
      index += 1;
      if (!argv[index]) throw new Error('--root requires a path');
      args.root = path.resolve(argv[index]);
    } else if (arg === '--include') {
      index += 1;
      if (!argv[index]) throw new Error('--include requires a path');
      args.include.push(argv[index].replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''));
    } else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return args;
}

function normalizedRelative(file, root) {
  return path.relative(root, file).split(path.sep).join('/');
}

function isIncludedFile(relativeFile, includePaths) {
  if (includePaths.length === 0) return true;
  return includePaths.some((includePath) => relativeFile === includePath || relativeFile.startsWith(`${includePath}/`));
}

function isStoryFile(relativeFile) {
  return STORY_PATHS.some((prefix) => relativeFile.toLowerCase().startsWith(`${prefix}/`)) ||
    /^begin\d+\/b\d+\/b\d{4}\.html?$/i.test(relativeFile);
}

function isDictationFile(relativeFile) {
  return /^begin\d+\/dict\/[^/]+\.html?$/i.test(relativeFile);
}

function isTargetFile(relativeFile, family) {
  const story = isStoryFile(relativeFile);
  const dictation = isDictationFile(relativeFile);
  return family === 'stories' ? story : family === 'dictation' ? dictation : story || dictation;
}

function lineEnding(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function replaceOutsideComments(source, replacement) {
  return source.split(/(<!--[\s\S]*?-->)/g).map((part, index) => index % 2 === 1 ? part : replacement(part)).join('');
}

function setAudioAttributes(tag) {
  let updated = tag;
  const marker = /\sdata-eagles-audio\s*=\s*(["'])[^"']*\1/i;
  if (marker.test(updated)) updated = updated.replace(marker, ' data-eagles-audio="v1"');
  else updated = updated.replace(/\s*\/?>$/, (end) => ` data-eagles-audio="v1"${end}`);

  const crossOrigin = /\scrossorigin(?:\s*=\s*(?:["'][^"']*["']|[^\s>]+))?/i;
  if (crossOrigin.test(updated)) updated = updated.replace(crossOrigin, ' crossorigin="anonymous"');
  else updated = updated.replace(/\s*\/?>$/, (end) => ` crossorigin="anonymous"${end}`);
  return updated;
}

function hashFile(file) {
  return `sha384-${crypto.createHash('sha384').update(fs.readFileSync(file)).digest('base64')}`;
}

function assetBlock(file, root, ending) {
  const cssFile = path.join(root, 'player-proof.css');
  const jsFile = path.join(root, 'player-proof.js');
  if (!fs.existsSync(cssFile) || !fs.existsSync(jsFile)) throw new Error('player-proof.css and player-proof.js must exist at the repository root');
  const cssHref = path.relative(path.dirname(file), cssFile).split(path.sep).join('/');
  const jsHref = path.relative(path.dirname(file), jsFile).split(path.sep).join('/');
  return [
    '<!-- EAGLES AUDIO PLAYER ASSETS START -->',
    `<link rel="stylesheet" href="${cssHref}" integrity="${hashFile(cssFile)}">`,
    `<script src="${jsHref}" integrity="${hashFile(jsFile)}" defer></script>`,
    '<!-- EAGLES AUDIO PLAYER ASSETS END -->',
  ].join(ending) + ending;
}

function transformHtml(source, file, root) {
  const sourceWithoutComments = source.replace(/<!--[\s\S]*?-->/g, ' ');
  const audioMatches = [...sourceWithoutComments.matchAll(/<audio\b[^>]*>/gi)];
  if (audioMatches.length === 0) return { source, changes: [], blocked: null };
  if (!/<\/head\s*>/i.test(source)) return { source, changes: [], blocked: 'missing </head>' };

  let next = replaceOutsideComments(source, (part) => part.replace(/<audio\b[^>]*>/gi, setAudioAttributes));
  const ending = lineEnding(source);
  const sourceWithoutAssets = next.replace(ASSET_MARKER_RE, '');
  next = sourceWithoutAssets;
  const block = ending + assetBlock(file, root, ending);
  next = next.replace(/<\/head\s*>/i, `${block}</head>`);

  const changes = [];
  if (next !== source) {
    if (next !== sourceWithoutAssets) changes.push('shared player assets');
    if (audioMatches.some((match) => setAudioAttributes(match[0]) !== match[0])) changes.push('audio markers');
  }
  return { source: next, changes, blocked: null };
}

function collectFiles(root, family, includePaths) {
  return glob.sync('**/*.html', {
    absolute: true,
    cwd: root,
    dot: true,
    ignore: ['**/.git/**', '**/.backups/**', '**/node_modules/**', '**/.playwright-cli/**', '**/*.BAK'],
  }).filter((file) => {
    const relativeFile = normalizedRelative(file, root);
    return isIncludedFile(relativeFile, includePaths) && isTargetFile(relativeFile, family);
  });
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage();
    return 2;
  }
  if (args.help) {
    printUsage();
    return 0;
  }

  const files = collectFiles(args.root, args.family, args.include);
  const plans = [];
  const blocked = [];
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Family: ${args.family}`);
  console.log(`Root: ${args.root}`);
  console.log(`Files: ${files.length}`);
  console.log();

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const result = transformHtml(source, file, args.root);
    if (result.blocked) {
      blocked.push({ file, reason: result.blocked });
      continue;
    }
    if (result.changes.length > 0) plans.push({ file, source, ...result });
  }

  if (args.apply && plans.length > MAX_SAFE_APPLY_PAGES && !args.allowBulk) {
    console.error(`REFUSED: ${plans.length} pages would change; use --allow-bulk after reviewing the dry run.`);
    return 3;
  }

  const backupManager = args.apply ? createBackupManager(args.root, 'modernize-audio-players') : null;
  for (const plan of plans) {
    console.log(`${normalizedRelative(plan.file, args.root)}\t${plan.changes.join(', ')}`);
    if (args.apply) {
      backupManager.backupBeforeWrite(plan.file);
      fs.writeFileSync(plan.file, plan.source);
    }
  }
  for (const item of blocked) console.error(`${normalizedRelative(item.file, args.root)}\tBLOCKED: ${item.reason}`);
  console.log();
  console.log(`Scanned: ${files.length}`);
  console.log(`Changed: ${plans.length}`);
  console.log(`Blocked: ${blocked.length}`);
  if (args.apply && plans.length > 0) console.log(`Backup: ${backupManager.runRoot}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  assetBlock,
  isTargetFile,
  parseArgs,
  transformHtml,
};
