#!/usr/bin/env node
/* eslint-disable no-undef */
/* eslint-env node */ // CHANGE: declare Node environment so require/process are defined to ESLint

/**
 * Inline CSS extractor -> stylesheet classes.
 *
 * Modes & scope:
 * - Default: processes .html/.htm in the **current directory only** (not subdirs)
 * - New: --recursive/-r to process working dir and all subdirs
 *
 * CSS output (per your confirmation):
 * - Filename: css/<dir-name>_new.css
 *   - --onecss/-o (default when --recursive): single CSS in the working dir:
 *       css/<working-dir-name>_new.css
 *   - --manycss/-m: per-directory CSS files:
 *       <each-dir>/css/<that-dir-name>_new.css
 *
 * Backups (per your confirmation):
 * - Naming for any archive: (<dir name>_<YYYY-MM-DD>_<HHmmss><TZ>_bkup.zip)
 * - Default when applying:
 *   - --recursive with --onecss: ONE ZIP in working dir for all changing files
 *   - --recursive with --manycss: per-directory ZIPs in each changed directory
 *   - non-recursive: ONE ZIP in working dir
 * - Disable with --NOBACKUP (dangerous)
 *
 * Behavior:
 * - Dry-run by default; use -A/--Apply to write changes
 * - Skips inline rules that contain `display: none`
 * - Safe writes (temp+rename)
 * - Logs to console + writes logs to inline_dry_run.log / inline_apply.log in working dir
 *
 * Requires: cheerio, archiver
 */

const fs = require( 'fs' );
const path = require( 'path' );
const archiver = require( 'archiver' );
const cheerio = require( 'cheerio' );

// ---------------- CLI ----------------
// CHANGE: new flags and parsing
const args = process.argv.slice( 2 );
const has = ( short, long ) => args.includes( short ) || args.includes( long );

const APPLY = has( '-A', '--Apply' );
const EXPLICIT_DRY = has( '-d', '--dryrun' );
let DRY = !APPLY; // default dry unless Apply
if ( APPLY ) DRY = false;
else if ( EXPLICIT_DRY ) DRY = true;

const LOG_ONLY = has( '-l', '--log-only' );      // no prompt (read-only unless Apply)
const HELP = has( '-h', '--help' );              // help banner
const RECURSIVE = has( '-r', '--recursive' );    // process subdirs too
const MANYCSS = has( '-m', '--manycss' );        // per-dir css
const ONECSS = has( '-o', '--onecss' ) || ( !MANYCSS ); // default when recursive (and harmless otherwise)
const BACKUP_OFF = args.includes( '--NOBACKUP' );     // dangerous: opt-out


// explicit on (default when Apply)

const SAFE_WRITES = true; // safe file writes (temp file + rename)
const CLASS_MODE = 'composite';
const RUN_DIR = process.cwd();

if ( HELP ) {
  const bin = path.basename( process.argv[ 1 ] || 'inline-css-extractor.js' );
  console.log( buildHelpText( bin ) );
  process.exit( 0 );
}

// ---------------- Helpers: IO ----------------
function readFile( p ) { return fs.readFileSync( p, 'utf8' ); }
function writeFileAtomic( p, content ) {
  const tmp = p + '.tmp';
  fs.writeFileSync( tmp, content, 'utf8' );
  fs.renameSync( tmp, p );
}
function ensureDir( p ) {
  if ( !fs.existsSync( p ) ) fs.mkdirSync( p, { recursive: true } );
}
function isoStampParts( d = new Date() ) {
  // YYYY-MM-DD_HHMMss<TZoffset> e.g., 2025-08-15_103205+0700
  const pad = n => String( n ).padStart( 2, '0' );
  const offMin = d.getTimezoneOffset(); // minutes west of UTC
  const sign = offMin <= 0 ? '+' : '-';
  const abs = Math.abs( offMin );
  const hh = pad( Math.floor( abs / 60 ) );
  const mm = pad( abs % 60 );
  const tz = `${sign}${hh}${mm}`;
  return {
    date: `${d.getFullYear()}-${pad( d.getMonth() + 1 )}-${pad( d.getDate() )}`,
    time: `${pad( d.getHours() )}${pad( d.getMinutes() )}${pad( d.getSeconds() )}`,
    tz
  };
}
function dirDisplayName( p ) {
  return path.basename( p || RUN_DIR );
}
function backupNameForDir( dirPath ) {
  const { date, time, tz } = isoStampParts();
  const base = dirDisplayName( dirPath );
  return `${base}_${date}_${time}${tz}_bkup.zip`;
}
function zipFiles( outZipPath, filesAbsPaths ) {
  return new Promise( ( resolve, reject ) => {
    const output = fs.createWriteStream( outZipPath );
    const archive = archiver( 'zip', { zlib: { level: 9 } } );
    output.on( 'close', () => resolve( outZipPath ) );
    archive.on( 'error', reject );
    archive.pipe( output );
    for ( const f of filesAbsPaths ) {
      // archive file under its basename so per-dir zips are portable
      archive.file( f, { name: path.basename( f ) } );
    }
    archive.finalize();
  } );
}
function toPosix( p ) {
  return p.split( path.sep ).join( '/' );
}
function relHref( fromFileDir, toCssAbsPath ) {
  const rel = path.relative( fromFileDir, toCssAbsPath );
  return toPosix( rel );
}

// ---------------- CSS value tokenization & class-name building (unchanged) ----------------
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

function sanitizeValueToken( raw ) {
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
  let s = String( raw );
  s = s.trim().replace( /\s+/g, ' ' );
  s = s.replace( /[\s.%/\\+&@:;,=|~^!?#"'`()[\]{}<>]/g, ch => CHAR_MAP[ ch ] ?? '' );
  s = s.replace( /-+/g, '-' );
  if ( s.startsWith( '-' ) ) s = 'n' + s.slice( 1 );
  s = s.toLowerCase().replace( /[^a-z0-9_-]/g, '' );
  s = s.replace( /^-+/, '' ).replace( /-+$/, '' );
  return s;
}

function parseNumberUnit( token ) {
  const m = String( token ).trim().match( /^(-)?(\d+(?:\.\d+)?)([a-z%]*)$/i );
  if ( !m ) return { kind: 'other', raw: token };
  const negative = !!m[ 1 ];
  let num = m[ 2 ];
  let unit = ( m[ 3 ] || '' ).toLowerCase();
  num = num.replace( '.', 'pt' );
  if ( unit === '%' ) unit = 'pct';
  else if ( unit === 'em' ) unit = 'm';
  else if ( unit === 'rem' ) unit = 'rm';
  return { kind: 'num', negative, num, unit };
}

function joinShorthandValues( values ) {
  const parsed = values.map( v => parseNumberUnit( v ) );
  const numTokens = parsed.filter( p => p.kind === 'num' );
  const units = new Set( numTokens.map( p => p.unit ) );
  const allSameUnit = ( units.size === 1 && !units.has( '' ) );
  const includeEachUnit = !allSameUnit;

  const parts = [];
  let firstUnitUsed = false;
  for ( const p of parsed ) {
    if ( p.kind !== 'num' ) { parts.push( sanitizeValueToken( p.raw ) ); continue; }
    const lead = p.negative ? 'n' : '';
    if ( includeEachUnit ) {
      parts.push( lead + p.num + ( p.unit ? p.unit : '' ) );
    } else {
      if ( !firstUnitUsed ) { parts.push( lead + p.num + p.unit ); firstUnitUsed = true; }
      else { parts.push( lead + p.num ); }
    }
  }
  return parts.filter( Boolean ).join( '-' );
}

function tokenizeValue( prop, value ) {
  const val = String( value ).trim();
  if ( /^none$/i.test( val ) && prop === 'display' ) return 'none';
  if ( prop === 'margin' || prop === 'padding' || prop === 'box-shadow' ) {
    const parts = val.split( /\s+/ );
    return joinShorthandValues( parts );
  }
  const parsed = parseNumberUnit( val );
  if ( parsed.kind === 'num' ) {
    const lead = parsed.negative ? 'n' : '';
    return lead + parsed.num + ( parsed.unit ? parsed.unit : '' );
  }
  return sanitizeValueToken( val );
}

function propSlug( prop ) {
  const p = prop.toLowerCase();
  return PROP_SLUG[ p ] || sanitizeValueToken( p );
}

function shortHash( s ) {
  let h = 0;
  for ( let i = 0; i < s.length; i++ ) h = ( h * 31 + s.charCodeAt( i ) ) >>> 0;
  return h.toString( 36 ).slice( 0, 6 );
}

function makeClassName( decls ) {
  const tokens = decls.map( ( { prop, val } ) => `${propSlug( prop )}-${tokenizeValue( prop, val )}` );
  const base = 'in-' + tokens.join( '_' );
  const hash = shortHash( tokens.join( '|' ) );
  return `${base}__${hash}`;
}

// ---------------- HTML processing (mostly unchanged) ----------------
function parseStyleAttr( styleAttr ) {
  const out = [];
  String( styleAttr ).split( ';' ).forEach( seg => {
    if ( !seg.trim() ) return;
    const m = seg.split( ':' );
    if ( m.length < 2 ) return;
    const prop = m[ 0 ].trim().toLowerCase();
    const val = m.slice( 1 ).join( ':' ).trim();
    out.push( { prop, val } );
  } );
  return out;
}
function containsDisplayNone( styleAttr ) {
  const decls = parseStyleAttr( styleAttr );
  return decls.some( d => d.prop === 'display' && /\bnone\b/i.test( d.val ) );
}
function normalizeDecls( styleAttr ) {
  const decls = parseStyleAttr( styleAttr );
  return decls.filter( d => !( d.prop === 'display' && /\bnone\b/i.test( d.val ) ) );
}
function ensureLink( $, href ) {
  const has = $( 'link[rel="stylesheet"]' ).toArray().some( el => {
    const v = ( $( el ).attr( 'href' ) || '' ).trim();
    return v === href;
  } );
  if ( !has ) {
    if ( $( 'head' ).length ) $( 'head' ).append( `\n<link rel="stylesheet" href="${href}">` );
    else $( 'body' ).prepend( `<link rel="stylesheet" href="${href}">\n` );
    return true;
  }
  return false;
}

// ---------------- Discovery ----------------
// CHANGE: recursive walk when requested
function listHtmlFiles( startDir, recursive ) {
  const out = [];
  function walk( dir ) {
    const entries = fs.readdirSync( dir, { withFileTypes: true } );
    for ( const ent of entries ) {
      const full = path.join( dir, ent.name );
      if ( ent.isDirectory() ) {
        if ( recursive ) walk( full );
      } else if ( /\.(html?|HTML?)$/.test( ent.name ) ) {
        out.push( full );
      }
    }
  }
  walk( startDir );
  return out;
}

// ---------------- Plan pass & apply ----------------
// We'll perform a plan pass to know which files will change, enabling correct backup behavior.
( async function run() {
  // banner lines & stats
  const bannerMode = DRY ? 'DRY-RUN' : 'APPLY';
  const header = `${bannerMode} (${CLASS_MODE}; safe-writes:${SAFE_WRITES ? 'on' : 'off'}; ${RECURSIVE ? 'recursive' : 'current-dir'})\n================================\n`;

  // collect target files
  const files = listHtmlFiles( RUN_DIR, RECURSIVE );
  const plan = []; // { file, dir, cssTargetAbs, cssHref, outHtml, classesAdded[], addedLink, cssAppend }
  const logLines = [];
  let sumConversions = 0;
  let newClasses = 0;
  let errors = 0;
  const changedFiles = new Set();
  const changedByDir = new Map(); // dir -> Set(files)

  // PHASE 1: Plan (no writes)
  for ( const full of files ) {
    let html;
    try { html = readFile( full ); }
    catch ( e ) { errors++; logLines.push( `${full}\n  ! ERROR: ${e.message}` ); continue; }

    const dir = path.dirname( full );
    const workDirName = dirDisplayName( RUN_DIR );
    const thisDirName = dirDisplayName( dir );

    // compute CSS target and href per flags
    let cssTargetAbs, cssHref;
    if ( RECURSIVE && ONECSS ) {
      cssTargetAbs = path.join( RUN_DIR, 'css', `${workDirName}_new.css` );
      cssHref = relHref( dir, cssTargetAbs );
    } else if ( RECURSIVE && MANYCSS ) {
      cssTargetAbs = path.join( dir, 'css', `${thisDirName}_new.css` );
      cssHref = toPosix( path.join( 'css', `${thisDirName}_new.css` ) );
    } else {
      // non-recursive: behaves like single dir run; CSS in working dir
      cssTargetAbs = path.join( RUN_DIR, 'css', `${workDirName}_new.css` );
      cssHref = toPosix( path.join( 'css', `${workDirName}_new.css` ) );
    }

    const $ = cheerio.load( html, { decodeEntities: false } );
    const perFileClasses = new Map();
    const perFileCSS = new Map();
    let fileConversions = 0;
    let fileAddedLink = false;

    $( '[style]' ).each( ( _, el ) => {
      const $el = $( el );
      const styleAttr = $el.attr( 'style' ) || '';
      if ( !styleAttr.trim() ) return;
      if ( containsDisplayNone( styleAttr ) ) return;

      const decls = normalizeDecls( styleAttr );
      if ( decls.length === 0 ) return;

      const declKey = decls.map( d => `${d.prop}:${d.val}` ).sort().join( ';' );
      let cls = perFileClasses.get( declKey );
      if ( !cls ) {
        cls = makeClassName( decls );
        perFileClasses.set( declKey, cls );
        const cssBody = decls.map( d => `  ${d.prop}: ${d.val};` ).join( '\n' );
        perFileCSS.set( cls, `.${cls} {\n${cssBody}\n}\n` );
        newClasses++;
      }

      const oldClass = $el.attr( 'class' ) || '';
      const classes = new Set( oldClass.split( /\s+/ ).filter( Boolean ) );
      classes.add( cls );
      $el.attr( 'class', Array.from( classes ).join( ' ' ) );
      $el.removeAttr( 'style' );
      fileConversions++;
    } );

    // Ensure link
    if ( fileConversions > 0 ) {
      const added = ensureLink( $, cssHref );
      fileAddedLink = fileAddedLink || added;
    }

    if ( fileConversions > 0 ) {
      const outHtml = $.html();
      const cssAppend = Array.from( perFileCSS.values() ).join( '\n' );
      plan.push( { file: full, dir, cssTargetAbs, cssHref, outHtml, classesAdded: Array.from( perFileCSS.keys() ), addedLink: fileAddedLink, cssAppend } );
      changedFiles.add( full );
      ( sumConversions += fileConversions );
      if ( !changedByDir.has( dir ) ) changedByDir.set( dir, new Set() );
      changedByDir.get( dir ).add( full );

      const classesList = Array.from( perFileCSS.keys() ).map( c => `  + class: ${c}` ).join( '\n' );
      const linkLine = fileAddedLink ? `\n  + added <link rel="stylesheet" href="${cssHref}">` : '';
      logLines.push( `${full}\n${classesList}${linkLine}` );
    }
  }

  // Backups decision
  const changedList = Array.from( changedFiles.values() );
  const backupEnabled = APPLY && !BACKUP_OFF; // default on when applying
  const performedBackups = [];

  if ( APPLY && backupEnabled && changedList.length > 0 ) {
    try {
      if ( RECURSIVE && MANYCSS ) {
        // per-directory zips
        for ( const [ dir, filesSet ] of changedByDir.entries() ) {
          const outZip = path.join( dir, backupNameForDir( dir ) );
          await zipFiles( outZip, Array.from( filesSet ) );
          performedBackups.push( outZip );
        }
      } else {
        // one zip in RUN_DIR (both onecss-recursive and non-recursive)
        const outZip = path.join( RUN_DIR, backupNameForDir( RUN_DIR ) );
        await zipFiles( outZip, changedList );
        performedBackups.push( outZip );
      }
      // report backups
      for ( const z of performedBackups ) console.log( `Backup created: ${path.basename( z )}` );
    } catch ( e ) {
      console.error( 'Backup failed:', e.message );
      errors++;
    }
  }

  // PHASE 2: Write (if Apply)
  if ( APPLY ) {
    // Write CSS appends first
    for ( const item of plan ) {
      if ( !item.cssAppend ) continue;
      const cssPath = item.cssTargetAbs;
      const cssDir = path.dirname( cssPath );
      ensureDir( cssDir );
      const existing = fs.existsSync( cssPath ) ? fs.readFileSync( cssPath, 'utf8' ) : '';
      const next = existing + ( existing && !existing.endsWith( '\n' ) ? '\n' : '' ) + item.cssAppend;
      SAFE_WRITES ? writeFileAtomic( cssPath, next ) : fs.writeFileSync( cssPath, next, 'utf8' );
    }
    // Then write HTML
    for ( const item of plan ) {
      SAFE_WRITES ? writeFileAtomic( item.file, item.outHtml ) : fs.writeFileSync( item.file, item.outHtml, 'utf8' );
    }
  }

  // Stats
  const filesLen = files.length;
  const changed = changedFiles.size;
  const avg = changed ? ( sumConversions / changed ).toFixed( 2 ) : '0.00';
  const stats =
    `Stats:
  Files (scanned): ${filesLen}
  Files (changed): ${changed}
  Conversions (sum): ${sumConversions}
  New classes: ${newClasses}
  Avg changes/file (changed only): ${avg}
  Errors: ${errors}`;

  const logText = [ header, ...logLines, '', stats, '' ].join( '\n' );
  console.log( logText );

  const logName = DRY ? 'inline_dry_run.log' : 'inline_apply.log';
  try { fs.writeFileSync( path.join( RUN_DIR, logName ), logText, 'utf8' ); }
  catch ( e ) { console.error( 'Failed to write log:', e.message ); }

  if ( DRY && !LOG_ONLY ) {
    process.stdout.write( 'Apply changes? (y/N) ' );
    process.stdin.setEncoding( 'utf8' );
    process.stdin.once( 'data', ( d ) => {
      const yes = String( d ).trim().toLowerCase() === 'y';
      if ( yes ) console.log( 'Re-run with --Apply (-A) to execute.' );
      else console.log( 'Aborted (dry-run only).' );
      process.exit( 0 );
    } );
  }
} )().catch( err => { console.error( err ); process.exit( 1 ); } );

// ---------------- Help text ----------------
// CHANGE: updated help with new flags and examples
function buildHelpText( binName ) {
  const RUN_DIR = process.cwd();
  const path = require( 'path' );
  const workDirName = path.basename( RUN_DIR );
  return `Usage: ${binName} [options]

Inline CSS extractor -> stylesheet classes.
Processes *.html / *.htm in the current directory by default.
Use --recursive to include subdirectories.

Modes:
  -d, --dryrun        Dry-run (preview only; logs written). (Default)
  -A, --Apply         Apply changes (writes CSS/HTML).

Backups (when applying):
  -b, --backup        Ensure backups ON (default when applying).
  --NOBACKUP          DANGER: disable backups.
  Naming: (<dir name>_<YYYY-MM-DD>_<HHmmss><TZ>_bkup.zip)
    onecss-recursive or non-recursive: one ZIP in working dir
    manycss-recursive: per-directory ZIPs

Recursion & CSS placement:
  -r, --recursive     Process working dir and all subdirs.
  -o, --onecss        (Default with -r) Single CSS at ./css/${workDirName}_new.css
  -m, --manycss       Per-directory CSS at ./<dir>/css/<dir-name>_new.css

Other:
  -l, --log-only      Suppress interactive prompt in dry-run.
  -h, --help          Show this help and exit.

Behavior:
  - Leaves inline styles containing "display: none" untouched
  - Extracts other inline styles into classes; removes the style attribute
  - CSS filename: css/<dir-name>_new.css (per rules above)
  - Ensures <link rel="stylesheet" href="<relative css path>"> exists
  - Safe writes (temp file + rename)

Examples:
  ${binName} -d
  ${binName} -A
  ${binName} -A -r -o
  ${binName} -A -r -m

Exit codes:
  0 on success; 1 on unexpected error.`;
}
