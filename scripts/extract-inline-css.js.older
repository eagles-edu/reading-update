#!/usr/bin/env node
/**
 * Inline CSS extractor -> stylesheet classes (per-dir).
 * - Processes .html/.htm in the **current directory only** (not subdirs)
 * - Leaves inline rules that contain `display: none`
 * - Writes/updates css/inline.css next to each HTML file (one per directory)
 * - Dry-run by default; use --apply to write changes
 * - Backs up all HTML/HTM in current dir to backup_inline_<ts>.zip before apply
 * - Logs to console + writes logs to inline_dry_run.log / inline_apply.log
 *
 * Requires: cheerio, archiver, glob@7
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cheerio = require('cheerio');

// ---------------- CLI ----------------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY = !APPLY;
const LOG_ONLY = args.includes('--log-only'); // won’t prompt (still dry unless --apply)

// CHANGE: clarify names. SAFE_WRITES is just the save mechanism (temp+rename). Not a class mode.
const SAFE_WRITES = true; // safe file writes (temp file + rename)

// CHANGE: explicit class mode label for the banner (we are using composite class names)
const CLASS_MODE = 'composite'; // options in future could be 'composite' or 'atomic-classes'

const RUN_DIR = process.cwd();

// ---- helpers: IO ----
function readFile(p) { return fs.readFileSync(p, 'utf8'); }
function writeFileAtomic(p, content) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function zipBackupHtml(dir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(dir, `backup_inline_${stamp}.zip`);
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(outPath));
    archive.on('error', reject);
    archive.pipe(output);
    fs.readdirSync(dir)
      .filter(f => /\.(html?|HTML?)$/.test(f))
      .forEach(f => archive.file(path.join(dir, f), { name: f }));
    archive.finalize();
  });
}

// ---------------- CSS value tokenization & class-name building ----------------

// Maps property to a short slug (kept simple; extend as needed)
const PROP_SLUG = {
  'line-height': 'lh',
  'text-indent': 'text-indent',
  'margin': 'mar',
  'padding': 'pad',
  'box-shadow': 'bsh',
  'font-weight': 'w',
  'color': 'c',
  'background-color': 'bgc',
  'background': 'bg',
  'border-radius': 'br',
  'letter-spacing': 'ls',
  'word-spacing': 'ws'
};

// strict sanitizer per your mapping (keep `_`; many chars drop; dot->pt; %->pct; &->amp; #->hash).
function sanitizeValueToken(raw) {
  const CHAR_MAP = {
    ' ': '-', '.': 'pt', '%': 'pct',
    '/': '', '\\': '', '+': '',
    '&': 'amp',
    '@': '', ':': '', ';': '', ',': '',
    '=': '', '|': '', '~': '', '^': '',
    '!': '', '?': '',
    '#': 'hash',
    '"': '', "'": '', '`': '',
    '(': '', ')': '', '[': '', ']': '',
    '{': '', '}': '', '<': '', '>': ''
  };

  let s = String(raw);

  // normalize whitespace to single spaces first
  s = s.trim().replace(/\s+/g, ' ');

  // map chars
  s = s.replace(/[\s.%/\\+&@:;,=|~^!?#"'`()\[\]{}<>]/g, ch => CHAR_MAP[ch] ?? '');

  // collapse dashes
  s = s.replace(/-+/g, '-');

  // leading minus → n (for numbers like -0.35 → n0pt35 later after dot mapping)
  if (s.startsWith('-')) s = 'n' + s.slice(1);

  // keep only [a-z0-9_-]; non-ascii → drop (we’ll map numbers/units separately)
  s = s.toLowerCase().replace(/[^a-z0-9_-]/g, '');

  // trim stray dashes
  s = s.replace(/^-+/, '').replace(/-+$/, '');
  return s;
}

// numeric/unit parser honoring your unit rules (., %, em/rem, px packing)
function parseNumberUnit(token) {
  // token examples: "12px", "0", "-0.35in", "1.2em", "150%"
  const m = String(token).trim().match(/^(-)?(\d+(?:\.\d+)?)([a-z%]*)$/i);
  if (!m) return { kind: 'other', raw: token };

  const negative = !!m[1];
  let num = m[2];
  let unit = (m[3] || '').toLowerCase();

  // dot → pt in number for class token
  num = num.replace('.', 'pt');

  // map units to your abbreviations:
  // px -> px, em -> m, rem -> rm, % -> pct, others unchanged
  if (unit === '%') unit = 'pct';
  else if (unit === 'em') unit = 'm';
  else if (unit === 'rem') unit = 'rm';
  // keep px/in/cm/mm/pt as written (pt here is CSS pt, different from dot mapping)

  return {
    kind: 'num',
    negative,
    num,  // already dot→pt
    unit  // mapped
  };
}

// join a shorthand list with “unit only on first if all same unit and not mixed”
// Applies to margin/padding/box-shadow values
function joinShorthandValues(values) {
  // Parse each token into {kind,num,unit,negative} or {kind:'other'}
  const parsed = values.map(v => parseNumberUnit(v));

  // Determine if all numeric tokens share same non-empty unit
  const numTokens = parsed.filter(p => p.kind === 'num');
  const units = new Set(numTokens.map(p => p.unit));
  const hasOnlyOneUnit = units.size === 1 && !units.has('');
  const allSameUnit = hasOnlyOneUnit;

  // If not all same unit, we must include unit on each numeric token
  const includeEachUnit = !allSameUnit;

  const parts = [];
  let firstUnitUsed = false;
  for (const p of parsed) {
    if (p.kind !== 'num') {
      // non-numeric token → sanitize (e.g., colors, keywords)
      parts.push(sanitizeValueToken(p.raw));
      continue;
    }
    const lead = p.negative ? 'n' : '';
    if (includeEachUnit) {
      parts.push(lead + p.num + (p.unit ? p.unit : ''));
    } else {
      // all numeric units same → include unit on first numeric only
      if (!firstUnitUsed) {
        parts.push(lead + p.num + p.unit); // first carries unit
        firstUnitUsed = true;
      } else {
        parts.push(lead + p.num); // subsequent omit unit
      }
    }
  }
  return parts.filter(Boolean).join('-');
}

function tokenizeValue(prop, value) {
  const val = String(value).trim();

  // leave display:none entirely (we filter earlier too)
  if (/^none$/i.test(val) && prop === 'display') return 'none';

  // split value on whitespace for shorthands we care about
  if (prop === 'margin' || prop === 'padding' || prop === 'box-shadow') {
    const parts = val.split(/\s+/);
    return joinShorthandValues(parts);
  }

  // single value: try numeric mapping first
  const parsed = parseNumberUnit(val);
  if (parsed.kind === 'num') {
    const lead = parsed.negative ? 'n' : '';
    return lead + parsed.num + (parsed.unit ? parsed.unit : '');
  }

  // fallback: sanitize (keep underscores, apply mapping)
  return sanitizeValueToken(val);
}

function propSlug(prop) {
  const p = prop.toLowerCase();
  return PROP_SLUG[p] || sanitizeValueToken(p);
}

function makeClassName(decls) {
  // decls: array of {prop,val}
  const tokens = decls.map(({ prop, val }) => {
    const p = propSlug(prop);
    const v = tokenizeValue(prop, val);
    return `${p}-${v}`;
  });

  const base = 'in-' + tokens.join('_'); // keep underscores between properties
  // suffix short hash for uniqueness within file
  const hash = shortHash(tokens.join('|'));
  let cls = `${base}__${hash}`;

  // class must not start with digit (we already prefixed with 'in-')
  return cls;
}

// naive short hash (stable for same token set)
function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

// ---------------- HTML processing ----------------

function parseStyleAttr(styleAttr) {
  const out = [];
  String(styleAttr).split(';').forEach(seg => {
    if (!seg.trim()) return;
    const m = seg.split(':');
    if (m.length < 2) return;
    const prop = m[0].trim().toLowerCase();
    const val = m.slice(1).join(':').trim();
    out.push({ prop, val });
  });
  return out;
}

function containsDisplayNone(styleAttr) {
  const decls = parseStyleAttr(styleAttr);
  return decls.some(d => d.prop === 'display' && /\bnone\b/i.test(d.val));
}

function normalizeDecls(styleAttr) {
  const decls = parseStyleAttr(styleAttr);
  // drop display:none entirely from extraction set (we won’t touch inline if it contains it)
  const kept = decls.filter(d => !(d.prop === 'display' && /\bnone\b/i.test(d.val)));
  return kept;
}

function ensureLink($, cssRelPath) {
  // add <link rel="stylesheet" href="css/inline.css"> if missing
  const has = $('link[rel="stylesheet"]').toArray().some(el => {
    const href = $(el).attr('href') || '';
    return href === cssRelPath;
  });
  if (!has) {
    // try to place into <head>, else prepend to body
    if ($('head').length) {
      $('head').append(`\n<link rel="stylesheet" href="${cssRelPath}">`);
    } else {
      $('body').prepend(`<link rel="stylesheet" href="${cssRelPath}">\n`);
    }
    return true;
  }
  return false;
}

// ---------------- Runner ----------------

(async function run() {
  const files = fs.readdirSync(RUN_DIR).filter(f => /\.(html?|HTML?)$/.test(f));
  const logLines = [];
  const changedFiles = new Set();
  let sumConversions = 0;
  let newClasses = 0;
  let errors = 0;

  if (!DRY) {
    try {
      const backupPath = await zipBackupHtml(RUN_DIR);
      console.log(`Backup created: ${path.basename(backupPath)}`);
    } catch (e) {
      console.error('Backup failed:', e.message);
      errors++;
    }
  }

  for (const fname of files) {
    const full = path.join(RUN_DIR, fname);
    let html;
    try {
      html = readFile(full);
    } catch (e) {
      errors++;
      logLines.push(`${full}\n  ! ERROR: ${e.message}`);
      continue;
    }
    const $ = cheerio.load(html, { decodeEntities: false });
    const perFileClasses = new Map(); // declKey -> className
    const perFileCSS = new Map();     // className -> CSS text
    let fileConversions = 0;
    let fileAddedLink = false;

    $('[style]').each((_, el) => {
      const $el = $(el);
      const styleAttr = $el.attr('style') || '';
      if (!styleAttr.trim()) return;

      // Leave inline styles that contain display:none
      if (containsDisplayNone(styleAttr)) return;

      const decls = normalizeDecls(styleAttr);
      if (decls.length === 0) return;

      // Make a canonical key for reuse within this file
      const declKey = decls.map(d => `${d.prop}:${d.val}`).sort().join(';');

      let cls = perFileClasses.get(declKey);
      if (!cls) {
        cls = makeClassName(decls);
        perFileClasses.set(declKey, cls);
        const cssBody = decls.map(d => `  ${d.prop}: ${d.val};`).join('\n');
        perFileCSS.set(cls, `.${cls} {\n${cssBody}\n}\n`);
        newClasses++;
      }

      // apply class, remove those style declarations (entire style attr if all extracted)
      const oldClass = $el.attr('class') || '';
      const classes = new Set(oldClass.split(/\s+/).filter(Boolean));
      classes.add(cls);
      $el.attr('class', Array.from(classes).join(' '));

      // remove extracted declarations from style attribute
      // Since we extracted all (except display:none handled earlier), drop style attr entirely.
      $el.removeAttr('style');

      fileConversions++;
    });

    if (fileConversions > 0) {
      // Ensure css/inline.css in same dir as file
      const cssDir = path.join(RUN_DIR, 'css');
      const cssRel = 'css/inline.css';
      ensureDir(cssDir);

      // Append/merge CSS (naive append; duplicates within this run already deduped)
      const cssPath = path.join(RUN_DIR, cssRel);
      const cssAppend = Array.from(perFileCSS.values()).join('\n');
      if (!DRY && cssAppend) {
        const existing = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
        const next = existing + (existing && !existing.endsWith('\n') ? '\n' : '') + cssAppend;
        SAFE_WRITES ? writeFileAtomic(cssPath, next) : fs.writeFileSync(cssPath, next, 'utf8'); // CHANGE: name
      }

      // Ensure link tag present
      const added = ensureLink($, cssRel);
      fileAddedLink = fileAddedLink || added;

      // Write HTML back
      const outHtml = $.html();
      if (!DRY) {
        SAFE_WRITES ? writeFileAtomic(full, outHtml) : fs.writeFileSync(full, outHtml, 'utf8'); // CHANGE: name
      }

      changedFiles.add(full);
      sumConversions += fileConversions;

      // Log section
      const classesList = Array.from(perFileCSS.keys()).map(c => `  + class: ${c}`).join('\n');
      logLines.push(`${full}\n${classesList}${fileAddedLink ? `\n  + added <link rel="stylesheet" href="css/inline.css">` : ''}`);
    }
  }

  // Stats
  const scanned = files.length;
  const changed = changedFiles.size;
  const avg = changed ? (sumConversions / changed).toFixed(2) : '0.00';
  const stats =
`Stats:
  Files (scanned): ${scanned}
  Files (changed): ${changed}
  Conversions (sum): ${sumConversions}
  New classes: ${newClasses}
  Avg changes/file (changed only): ${avg}
  Errors: ${errors}`;

  const banner = DRY ? 'DRY-RUN' : 'APPLY';
  // CHANGE: banner now shows class mode AND safe-write status (on/off)
  const header = `${banner} (${CLASS_MODE}; safe-writes:${SAFE_WRITES ? 'on' : 'off'}; current-dir)\n================================\n`;

  const logText = [header, ...logLines, '', stats, ''].join('\n');

  console.log(logText);

  const logName = DRY ? 'inline_dry_run.log' : 'inline_apply.log';
  try {
    fs.writeFileSync(path.join(RUN_DIR, logName), logText, 'utf8');
  } catch (e) {
    console.error('Failed to write log:', e.message);
  }

  if (DRY && !LOG_ONLY) {
    process.stdout.write('Apply changes? (y/N) ');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => {
      const yes = String(d).trim().toLowerCase() === 'y';
      if (yes) {
        console.log('Re-run with --apply to execute.');
      } else {
        console.log('Aborted (dry-run only).');
      }
      process.exit(0);
    });
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
