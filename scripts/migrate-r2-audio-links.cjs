#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const defaultRoot = process.cwd();
const args = process.argv.slice(2);
let root = defaultRoot;
let manifestPath = path.join(defaultRoot, 'audio-manifest.json');
let backupRoot = '';
let apply = false;

function takeValue(option) {
  const index = args.indexOf(option);
  if (index < 0 || !args[index + 1]) {
    throw new Error(`${option} requires a value`);
  }
  return args[index + 1];
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node migrate-r2-audio-links.cjs [--apply] [--root PATH] [--manifest PATH] [--backup-dir PATH]\n'
  );
  process.exit(0);
}
if (args.includes('--apply')) {
  apply = true;
}
if (args.includes('--root')) {
  root = path.resolve(takeValue('--root'));
}
if (args.includes('--manifest')) {
  manifestPath = path.resolve(takeValue('--manifest'));
}
if (args.includes('--backup-dir')) {
  backupRoot = path.resolve(takeValue('--backup-dir'));
}

root = path.resolve(root);
if (!backupRoot) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  backupRoot = path.join(root, '.backups', `r2-audio-migration-${timestamp}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.items)) {
  throw new Error(`Manifest has no items array: ${manifestPath}`);
}

const sourceMap = new Map();
const urlMap = new Map();
for (const item of manifest.items) {
  if (!item || typeof item.sourcePath !== 'string' || typeof item.url !== 'string') {
    throw new Error('Each manifest item requires sourcePath and url');
  }
  if (!item.url.startsWith('/reading/_audio/')) {
    throw new Error(`Manifest URL is not an audio proxy URL: ${item.url}`);
  }
  if (sourceMap.has(item.sourcePath)) {
    throw new Error(`Duplicate manifest sourcePath: ${item.sourcePath}`);
  }
  if (urlMap.has(item.url)) {
    throw new Error(`Duplicate manifest URL: ${item.url}`);
  }
  sourceMap.set(item.sourcePath, item);
  urlMap.set(item.url, item);
}

const excludedDirectories = new Set([
  '.backups',
  '.git',
  '.playwright-cli',
  '.sto',
  'node_modules',
  'vendor',
]);
const sourceRoots = new Set(
  manifest.items.map((item) => item.sourcePath.split('/')[0]).filter(Boolean)
);

function collectHtml(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        collectHtml(path.join(directory, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
}

const htmlFiles = [];
for (const sourceRoot of sourceRoots) {
  const directory = path.join(root, sourceRoot);
  if (fs.existsSync(directory)) {
    collectHtml(directory, htmlFiles);
  }
}
if (sourceMap.has('audio/')) {
  collectHtml(root, htmlFiles);
}

const audioSourcePattern = /(\bsrc\s*=\s*)(["'])([^"']+?\.mp3(?:[?#][^"']*)?)(\2)/gi;
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeAudioPreloadLink(html, url) {
  const escapedUrl = escapeRegExp(url);
  const pattern = new RegExp(
    `\\s*<link\\b(?=[^>]*\\brel=["']preload["'])(?=[^>]*\\bas=["']audio["'])(?=[^>]*\\bhref=["']${escapedUrl}["'])[^>]*>\\s*`,
    'gi'
  );
  return html.replace(pattern, '\n');
}

let changedFiles = 0;
let changedLinks = 0;
let preloadElementsChanged = 0;
let unmatchedLinks = 0;

for (const filePath of htmlFiles.sort()) {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  const original = fs.readFileSync(filePath, 'utf8');
  let fileLinksChanged = 0;
  let filePreloadsChanged = 0;
  const preloadItems = new Map();
  let updated = original.replace(
    audioSourcePattern,
    (fullMatch, prefix, quote, rawSource, closingQuote) => {
      const sourceWithoutQuery = rawSource.replace(/[?#].*$/, '');
      if (
        !sourceWithoutQuery.includes('/audio/') ||
        /^(?:[a-z]+:|\/\/|data:|blob:)/i.test(sourceWithoutQuery)
      ) {
        return fullMatch;
      }

      if (sourceWithoutQuery.startsWith('/reading/_audio/')) {
        const item = urlMap.get(sourceWithoutQuery);
        if (item?.preload === true) {
          preloadItems.set(item.url, item);
        }
        return fullMatch;
      }

      const sourcePath = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), sourceWithoutQuery)
      );
      const item = sourceMap.get(sourcePath);
      if (!item) {
        unmatchedLinks += 1;
        return fullMatch;
      }
      fileLinksChanged += 1;
      changedLinks += 1;
      if (item.preload === true) {
        preloadItems.set(item.url, item);
      }
      return `${prefix}${quote}${item.url}${closingQuote}`;
    }
  );

  for (const item of preloadItems.values()) {
    updated = removeAudioPreloadLink(updated, item.url);
  }
  if (preloadItems.size > 0) {
    updated = updated.replace(/<audio\b[^>]*>/gi, (audioTag) => {
      const item = [...preloadItems.values()].find((candidate) => audioTag.includes(candidate.url));
      if (!item || /\bpreload\s*=/i.test(audioTag)) {
        return audioTag;
      }
      filePreloadsChanged += 1;
      preloadElementsChanged += 1;
      return audioTag.replace(/<audio\b/i, '<audio preload="auto"');
    });
  }

  if (updated === original) {
    continue;
  }

  changedFiles += 1;
  process.stdout.write(
    `${apply ? 'updating' : 'would update'} ${relativePath} (${fileLinksChanged} link${fileLinksChanged === 1 ? '' : 's'}, ${filePreloadsChanged} preload${filePreloadsChanged === 1 ? '' : 's'})\n`
  );
  if (!apply) {
    continue;
  }

  const backupPath = path.join(backupRoot, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(backupPath)) {
    throw new Error(`Refusing to overwrite backup: ${backupPath}`);
  }
  fs.copyFileSync(filePath, backupPath);
  const mode = fs.statSync(filePath).mode & 0o777;
  const temporaryPath = `${filePath}.r2-audio-${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, updated, { encoding: 'utf8', mode });
  fs.chmodSync(temporaryPath, mode);
  fs.renameSync(temporaryPath, filePath);
}

process.stdout.write(
  `${apply ? 'applied' : 'dry-run'}: ${changedFiles} files, ${changedLinks} links, ${preloadElementsChanged} preloads; unmatched local audio links: ${unmatchedLinks}\n`
);
if (apply && changedFiles > 0) {
  process.stdout.write(`backups: ${backupRoot}\n`);
}
