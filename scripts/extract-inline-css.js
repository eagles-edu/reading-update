#!/usr/bin/env node
/**
 * Bulk inline CSS → stylesheet (per-folder) with dry-run, logs, backup, prompts.
 *
 * Defaults:
 *   - Scope: current directory only (HTML/HTM files). Use --recursive for subfolders.
 *   - Skip extracting inline styles that match any skip pattern (default: /display:\s*none/i).
 *   - Generate one class per unique inline style block (composite), with descriptive slug + short hash.
 *   - Write extracted CSS to css/inline.css in the same folder as each HTML file.
 *   - Dry-run first (no changes), print + write logs. Then prompt before applying.
 *   - On apply, zip all HTML files in scope before writing changes.
 *
 * CLI:
 *   --recursive         Walk subdirectories
 *   --atomic            Generate atomic classes (one per declaration) instead of composite classes
 *   --skip="regex|..."  Extra skip patterns (pipe-separated). Default adds /display:\s*none/i
 *   --apply             Apply without interactive prompt (still does a dry-run log first)
 *   --dry-run           Force dry-run (default)
 *
 * Logs:
 *   logs/inline-extract-YYYYMMDD-HHMMSS.dryrun.log
 *   logs/inline-extract-YYYYMMDD-HHMMSS.apply.log
 *
 * Backup (on apply):
 *   backups/inline-css-backup-YYYYMMDD-HHMMSS.zip
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const glob = require('glob');
const cheerio = require('cheerio');
const archiver = require('archiver');

const CWD = process.cwd();
const args = process.argv.slice(2);

// ==== Flags ====
const RECURSIVE = args.includes('--recursive');
const ATOMIC = args.includes('--atomic');
const FORCE_APPLY = args.includes('--apply');
const FORCE_DRYRUN = args.includes('--dry-run');

// ==== Skip patterns (display:none by default) ====
const userSkipArg = args.find(a => a.startsWith('--skip='));
const SKIP_REGEXES = [
  /display\s*:\s*none/i,
];
if (userSkipArg) {
  // --skip="regex|regex2"
  const raw = userSkipArg.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
  raw.split('|').map(s => s.trim()).filter(Boolean).forEach(pat => {
    try {
      SKIP_REGEXES.push(new RegExp(pat, 'i'));
    } catch (e) {
      console.warn(`WARN: Bad --skip pattern ignored: ${pat}`);
    }
  });
}

// ==== Discovery ====
const GLOB = RECURSIVE ? '**/*.htm?(l)' : '*.htm?(l)';
const GLOB_IGNORE = ['**/node_modules/**', '**/.git/**'];

// ==== Output & logs ====
const TS = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const LOG_DIR = path.join(CWD, 'logs');
const BK_DIR  = path.join(CWD, 'backups');
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(BK_DIR, { recursive: true });

const DRYRUN_LOG = path.join(LOG_DIR, `inline-extract-${TS}.dryrun.log`);
const APPLY_LOG  = path.join(LOG_DIR, `inline-extract-${TS}.apply.log`);

// ==== Helpers ====
function hash(text, len = 6) {
  return crypto.createHash('md5').update(String(text)).digest('hex').slice(0, len);
}
function normDecls(styleText) {
  // Clean weird cases like "margin; 0 auto" → "margin: 0 auto"
  let txt = String(styleText || '').trim();
  // unify whitespace, kill trailing semicolons
  txt = txt.replace(/\s+/g, ' ').replace(/;+\s*$/, '');

  // split by ;, parse prop:value
  const raw = txt.split(';').map(s => s.trim()).filter(Boolean);
  const decls = [];
  for (let d of raw) {
    let idx = d.indexOf(':');
    if (idx === -1) {
      const semi = d.indexOf(';');
      if (semi !== -1) idx = semi;
    }
    if (idx === -1) continue;
    const prop = d.slice(0, idx).trim().toLowerCase();
    const val  = d.slice(idx + 1).trim();
    if (prop && val) decls.push({ prop, val });
  }
  decls.sort((a,b) => a.prop.localeCompare(b.prop));
  return decls;
}
function shouldSkip(styleText) {
  if (!styleText) return false;
  return SKIP_REGEXES.some(r => r.test(styleText));
}
function tokenizeValue(val) {
  let v = val.toLowerCase().trim();
  v = v.replace(/#/g, '').replace(/\s+/g, '-');
  v = v.replace(/px/g, '');
  v = v.replace(/\(.*?\)/g, '');
  v = v.replace(/[^a-z0-9%.-]+/g, '');
  v = v.replace(/\bauto\b/g, 'a');
  v = v.replace(/\bbold\b/g, 'bold');
  v = v.replace(/\bnormal\b/g, 'n');
  return v || 'v';
}
function shortProp(prop) {
  const map = {
    'margin': 'mar',
    'margin-left': 'ml',
    'margin-right': 'mr',
    'margin-top': 'mt',
    'margin-bottom': 'mb',
    'padding': 'pad',
    'padding-left': 'pl',
    'padding-right': 'pr',
    'padding-top': 'pt',
    'padding-bottom': 'pb',
    'font-weight': 'w',
    'font-size': 'fs',
    'line-height': 'lh',
    'color': 'c',
    'background': 'bg',
    'background-color': 'bgc',
    'text-align': 'ta',
    'display': 'd',
    'width': 'wth',
    'height': 'hgt',
    'max-width': 'maxw',
    'min-width': 'minw',
    'max-height': 'maxh',
    'min-height': 'minh',
    'border': 'bd',
    'border-radius': 'rad',
    'letter-spacing': 'ls',
    'word-spacing': 'ws',
  };
  return map[prop] || prop.replace(/[^a-z0-9]+/g, '-');
}
function compositeSlug(decls, maxPieces = 4) {
  const parts = [];
  for (const {prop, val} of decls.slice(0, maxPieces)) {
    const p = shortProp(prop);
    if (p === 'w' && /^bold$/i.test(val)) {
      parts.push('w-bold');
    } else if (p === 'w' && /^\d+$/.test(val)) {
      parts.push(`w${val}`);
    } else if (p === 'mar' && /^0\s*a(uto)?$/i.test(tokenizeValue(val))) {
      parts.push('mar-0-a');
    } else if (p === 'pad') {
      parts.push(`pad-${tokenizeValue(val).replace(/-/g, '-')}`);
    } else if (p === 'c') {
      parts.push(`c-${tokenizeValue(val)}`);
    } else {
      parts.push(`${p}-${tokenizeValue(val)}`);
    }
  }
  const base = parts.join('_').replace(/_{2,}/g, '_').slice(0, 48);
  return base || 'style';
}
function ensureHeadLink($, href) {
  const have = $(`link[rel="stylesheet"][href="${href}"]`).length > 0;
  if (have) return false;
  const linkEl = `<link rel="stylesheet" href="${href}">`;
  if ($('head').length) $('head').append('\n' + linkEl + '\n');
  else $('html').prepend('\n<head>\n' + linkEl + '\n</head>\n');
  return true;
}
function toCssRule(className, decls) {
  const body = decls.map(d => `${d.prop}: ${d.val};`).join(' ');
  return `.in-${className} { ${body} }`;
}
function atomicClassForDecl(prop, val) {
  const p = shortProp(prop);
  const v = tokenizeValue(val);
  let slug = `${p}-${v}`.replace(/^-+/, '');
  slug = slug.slice(0, 80);
  return slug || 'decl';
}
function compositeClassForDecls(decls) {
  const key = decls.map(d => `${d.prop}:${d.val}`).join(';');
  const slug = compositeSlug(decls);
  const h = hash(key, 6);
  let name = `${slug}__${h}`.replace(/^-+/, '');
  name = name.slice(0, 96);
  return name || `style__${h}`;
}

// Per-folder CSS registry
class FolderCss {
  constructor(folderPath) {
    this.folderPath = folderPath;
    this.classes = new Map(); // key -> { name, decls }
    this.atomic = new Map();  // "prop:val" -> className
  }
  addComposite(decls) {
    const key = decls.map(d => `${d.prop}:${d.val}`).join(';');
    if (this.classes.has(key)) return this.classes.get(key).name;
    const name = compositeClassForDecls(decls);
    this.classes.set(key, { name, decls });
    return name;
  }
  addAtomic(prop, val) {
    const key = `${prop}:${val}`;
    if (this.atomic.has(key)) return this.atomic.get(key);
    const name = atomicClassForDecl(prop, val);
    this.atomic.set(key, name);
    return name;
  }
  cssPathFor(filePath) {
    const dir = path.dirname(filePath);
    const cssDir = path.join(dir, 'css');
    return { cssDir, cssFile: path.join(cssDir, 'inline.css') };
  }
  writeCssForFile(filePath) {
    const { cssDir, cssFile } = this.cssPathFor(filePath);
    fs.mkdirSync(cssDir, { recursive: true });
    const lines = [];
    // Composite first
    for (const { name, decls } of this.classes.values()) {
      lines.push(toCssRule(name, decls));
    }
    // Then atomic
    for (const [key, cls] of this.atomic.entries()) {
      const [prop, val] = key.split(':');
      lines.push(toCssRule(cls, [{ prop, val }]));
    }
    const text = lines.join('\n') + (lines.length ? '\n' : '');
    fs.writeFileSync(cssFile, text, 'utf8');
    return cssFile;
  }
}

// ==== Scan ====
function findHtmlFiles() {
  return glob.sync(GLOB, { cwd: CWD, ignore: GLOB_IGNORE, nodir: true })
    .map(f => path.join(CWD, f))
    .filter(f => /\.html?$/i.test(f));
}

function buildDryRun(files) {
  const byFile = new Map();
  const folders = new Map();
  const errors = [];
  let totalChanges = 0;
  let totalNewClasses = 0;

  for (const file of files) {
    let html;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (e) {
      errors.push({ file, error: `read failed: ${e.message}` });
      continue;
    }
    const $ = cheerio.load(html, { decodeEntities: false });
    const changes = [];
    const dir = path.dirname(file);
    if (!folders.has(dir)) folders.set(dir, new FolderCss(dir));
    const folderCss = folders.get(dir);

    $('[style]').each((idx, el) => {
      const $el = $(el);
      const styleText = $el.attr('style') || '';
      if (!styleText.trim()) return;

      if (shouldSkip(styleText)) return;

      const decls = normDecls(styleText);
      if (!decls.length) return;

      if (ATOMIC) {
        const classNames = [];
        for (const {prop, val} of decls) {
          const cls = folderCss.addAtomic(prop, val);
          classNames.push(`in-${cls}`);
        }
        changes.push({
          type: 'atomic',
          classNames,
          removed: decls.map(d => `${d.prop}: ${d.val}`).join('; '),
        });
        totalChanges += decls.length;
      } else {
        const cls = folderCss.addComposite(decls);
        changes.push({
          type: 'composite',
          className: `in-${cls}`,
          removed: decls.map(d => `${d.prop}: ${d.val}`).join('; '),
        });
        totalChanges += 1;
      }
    });

    let injected = false;
    if (changes.length > 0) {
      injected = !$(`link[rel="stylesheet"][href="css/inline.css"]`).length;
    }

    byFile.set(file, { changes, injectedLink: injected });
  }

  for (const f of folders.values()) {
    totalNewClasses += f.classes.size + f.atomic.size;
  }

  const totalFiles = files.length;
  const changedFiles = Array.from(byFile.values()).filter(v => v.changes.length > 0).length;
  const avgChanges = changedFiles ? (totalChanges / changedFiles) : 0;

  return {
    byFile, folders, errors,
    totals: {
      totalFiles, changedFiles, totalChanges, avgChanges, totalNewClasses
    }
  };
}

function renderLog(title, data) {
  const lines = [];
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push('');

  for (const [file, { changes, injectedLink }] of data.byFile.entries()) {
    if (changes.length === 0) continue;
    lines.push(file);
    for (const ch of changes) {
      if (ch.type === 'atomic') {
        lines.push(`  + classes: ${ch.classNames.join(' ')}`);
        lines.push(`    - removed: ${ch.removed}`);
      } else {
        lines.push(`  + class: ${ch.className}`);
        lines.push(`    - removed: ${ch.removed}`);
      }
    }
    if (injectedLink) lines.push(`  + will add <link rel="stylesheet" href="css/inline.css">`);
    lines.push('');
  }

  if (data.errors.length) {
    lines.push('Errors:');
    for (const e of data.errors) lines.push(`  ! ${e.file} :: ${e.error}`);
    lines.push('');
  }

  const t = data.totals;
  lines.push('Stats:');
  lines.push(`  Files (scanned): ${t.totalFiles}`);
  lines.push(`  Files (changed): ${t.changedFiles}`);
  lines.push(`  Conversions (sum): ${t.totalChanges}`);
  lines.push(`  New classes: ${t.totalNewClasses}`);
  lines.push(`  Avg changes/file (changed only): ${t.avgChanges.toFixed(2)}`);
  lines.push('');
  return lines.join('\n');
}

function writeFileSafe(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

function zipHtmlBackup(files, outZip) {
  return new Promise((resolve, reject) => {
    try {
      const output = fs.createWriteStream(outZip);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('warning', err => {
        console.warn('Backup warning:', err.message);
      });
      archive.on('error', err => reject(err));

      archive.pipe(output);
      for (const f of files) {
        try {
          const rel = path.relative(CWD, f);
          archive.file(f, { name: rel });
        } catch (e) { /* continue */ }
      }
      archive.finalize();
    } catch (e) {
      reject(e);
    }
  });
}

async function applyChanges(dry) {
  const backupZip = path.join(BK_DIR, `inline-css-backup-${TS}.zip`);
  const files = Array.from(dry.byFile.keys());
  await zipHtmlBackup(files, backupZip).catch(err => {
    throw new Error(`Backup failed: ${err.message}`);
  });

  const errors = [];
  let wroteFiles = 0;

  for (const [file, { changes, injectedLink }] of dry.byFile.entries()) {
    if (changes.length === 0) continue;

    let html;
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (e) {
      errors.push({ file, error: `read failed: ${e.message}` });
      continue;
    }
    const $ = cheerio.load(html, { decodeEntities: false });

    $('[style]').each((idx, el) => {
      const $el = $(el);
      const styleText = $el.attr('style') || '';
      if (!styleText.trim()) return;
      if (shouldSkip(styleText)) return;

      const decls = normDecls(styleText);
      if (!decls.length) return;

      if (ATOMIC) {
        const classNames = [];
        for (const {prop, val} of decls) {
          const folderCss = dry.folders.get(path.dirname(file));
          const cls = folderCss.addAtomic(prop, val);
          classNames.push(`in-${cls}`);
        }
        const existing = ($el.attr('class') || '').trim();
        const set = new Set(existing ? existing.split(/\s+/) : []);
        for (const c of classNames) set.add(c);
        $el.attr('class', Array.from(set).join(' ').trim());
        $el.removeAttr('style');
      } else {
        const folderCss = dry.folders.get(path.dirname(file));
        const cls = folderCss.addComposite(decls);
        const existing = ($el.attr('class') || '').trim();
        const set = new Set(existing ? existing.split(/\s+/) : []);
        set.add(`in-${cls}`);
        $el.attr('class', Array.from(set).join(' ').trim());
        $el.removeAttr('style');
      }
    });

    if (injectedLink) ensureHeadLink($, 'css/inline.css');

    try {
      fs.writeFileSync(file, $.html(), 'utf8');
      wroteFiles++;
    } catch (e) {
      errors.push({ file, error: `write failed: ${e.message}` });
    }

    try {
      const folderCss = dry.folders.get(path.dirname(file));
      folderCss.writeCssForFile(file);
    } catch (e) {
      errors.push({ file, error: `write css failed: ${e.message}` });
    }
  }

  return { wroteFiles, errors, backupZip };
}

function promptYesNo(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, ans => {
      rl.close();
      resolve(/^y(es)?$/i.test((ans || '').trim()));
    });
  });
}

(async function main() {
  const files = findHtmlFiles();
  const dry = buildDryRun(files);

  const title = `DRY-RUN (${ATOMIC ? 'atomic' : 'composite'}; ${RECURSIVE ? 'recursive' : 'current-dir'})`;
  const dryText = renderLog(title, dry);
  console.log(dryText);
  writeFileSafe(DRYRUN_LOG, dryText);

  if (FORCE_DRYRUN) {
    console.log(`Dry-run log written: ${path.relative(CWD, DRYRUN_LOG)}`);
    return;
  }

  let proceed = FORCE_APPLY;
  if (!proceed) {
    proceed = await promptYesNo('Apply changes? (y/N) ');
  }
  if (!proceed) {
    console.log('Aborted. No changes applied.');
    return;
  }

  try {
    const res = await applyChanges(dry);
    const t = dry.totals;
    const lines = [];
    lines.push(`APPLY (${ATOMIC ? 'atomic' : 'composite'}; ${RECURSIVE ? 'recursive' : 'current-dir'})`);
    lines.push('='.repeat(64));
    lines.push('');
    lines.push(`Backup: ${path.relative(CWD, res.backupZip)}`);
    lines.push('');
    lines.push(`Files (scanned): ${t.totalFiles}`);
    lines.push(`Files (changed): ${t.changedFiles}`);
    lines.push(`Files (written): ${res.wroteFiles}`);
    lines.push(`Conversions (sum): ${t.totalChanges}`);
    lines.push(`New classes: ${t.totalNewClasses}`);
    lines.push(`Avg changes/file (changed only): ${t.avgChanges.toFixed(2)}`);
    lines.push('');
    if (dry.errors.length || res.errors.length) {
      lines.push('Errors:');
      [...dry.errors, ...res.errors].forEach(e => {
        lines.push(`  ! ${e.file} :: ${e.error}`);
      });
      lines.push('');
    }
    const applyText = lines.join('\n');
    console.log(applyText);
    writeFileSafe(APPLY_LOG, applyText);

    console.log('Done ✓');
  } catch (e) {
    console.error('FAILED during apply:', e.message);
  }
})();
