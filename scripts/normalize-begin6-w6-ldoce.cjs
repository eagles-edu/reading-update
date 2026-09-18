#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const targetDir = path.join(repoRoot, 'begin6', 'w6');
const apply = process.argv.includes('--apply');
const backupRoot = path.join(
  '/home/eagles/efast-bu',
  `normalize-begin6-w6-ldoce-${new Date().toISOString().replace(/[:.]/g, '-')}`
);

const supportedDictionaryHosts = new Set([
  'www.ldoceonline.com',
  'www.merriam-webster.com',
  'www.dictionary.com',
  'dictionary.com'
]);

function readHtmlFiles() {
  return fs.readdirSync(targetDir)
    .filter((name) => name.endsWith('.html'))
    .sort()
    .map((name) => path.join(targetDir, name));
}

function normalizeVocabularyLinks(html) {
  let replacements = 0;
  const normalized = html.replace(/href="(https?:\/\/[^"]+)"/gi, (whole, rawHref) => {
    const href = rawHref.trim();
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      return whole;
    }

    if (!supportedDictionaryHosts.has(parsed.hostname.toLowerCase())) {
      return whole;
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const sourceDictionaryIndex = pathParts.findIndex((part) => part === 'dictionary' || part === 'browse');
    if (sourceDictionaryIndex === -1 || !pathParts[sourceDictionaryIndex + 1]) {
      return whole;
    }

    const slug = pathParts.slice(sourceDictionaryIndex + 1).join('/');
    const target = `https://www.ldoceonline.com/dictionary/${slug}${parsed.search}${parsed.hash}`;
    if (target === rawHref) {
      return whole;
    }

    replacements += 1;
    return `href="${target}"`;
  });

  return { normalized, replacements };
}

function writeBackup(filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  const backupPath = path.join(backupRoot, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
}

const files = readHtmlFiles();
const results = [];
let totalReplacements = 0;

for (const filePath of files) {
  const original = fs.readFileSync(filePath, 'utf8');
  const { normalized, replacements } = normalizeVocabularyLinks(original);
  if (replacements === 0) {
    continue;
  }

  results.push({
    file: path.relative(repoRoot, filePath),
    replacements
  });
  totalReplacements += replacements;

  if (apply) {
    writeBackup(filePath);
    fs.writeFileSync(filePath, normalized, 'utf8');
  }
}

const report = {
  mode: apply ? 'apply' : 'dry-run',
  target: path.relative(repoRoot, targetDir),
  scannedFiles: files.length,
  changedFiles: results.length,
  replacements: totalReplacements,
  backupRoot: apply ? backupRoot : null,
  files: results
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
