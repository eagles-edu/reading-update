#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const {
  createClient,
  readCredentialDocument,
  sha256,
} = require('./upload-r2-audio.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const externalHost = 'www.rong-chang.com';
const externalPrefix = `${externalHost}/`;
const routePrefix = '/reading/_audio/';
const minimumDelay = Number(process.env.R2_EXTERNAL_MIN_DELAY_MS || 750);
const maximumDelay = Number(process.env.R2_EXTERNAL_MAX_DELAY_MS || 1800);
const maxAttempts = 5;

function usage() {
  process.stdout.write(
    'Usage: node scripts/import-r2-external-audio.cjs --credentials-doc PATH [options]\n' +
      'Options:\n' +
      '  --root PATH             Repository root (default: current directory)\n' +
      '  --env-file PATH         R2 config file (default: ROOT/.env)\n' +
      '  --manifest PATH         Existing R2 manifest (default: ROOT/poc/r2-read-audio-all.json)\n' +
      '  --manifest-out PATH     Output manifest (default: same as --manifest)\n' +
      '  --collection NAME       HTML collection to scan (default: easyread)\n' +
      '  --apply                 Fetch, upload, and write the manifest\n' +
      '  --dry-run               Inventory only (default)\n'
  );
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomDelay() {
  const low = Math.min(minimumDelay, maximumDelay);
  const high = Math.max(minimumDelay, maximumDelay);
  return low + Math.floor(Math.random() * (high - low + 1));
}

function isTransient(error) {
  return /timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|socket hang up|HTTP (429|5\d\d)/i.test(
    String(error?.message || error)
  );
}

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransient(error)) throw error;
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      process.stderr.write(`retrying ${label} after attempt ${attempt}/${maxAttempts} in ${delay}ms: ${error.message}\n`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function collectHtmlFiles(directory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectHtmlFiles(filePath, files);
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) files.push(filePath);
  }
}

function extractExternalReferences(root, collection) {
  const directory = path.join(root, collection);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Collection directory does not exist: ${directory}`);
  }
  const files = [];
  collectHtmlFiles(directory, files);
  const references = new Map();
  function addReference(rawReference, pagePath) {
    const marker = rawReference.indexOf(externalPrefix);
    let externalPath;
    let sourceUrl;
    if (marker >= 0) {
      externalPath = rawReference.slice(marker + externalPrefix.length).split(/[?#]/, 1)[0];
      sourceUrl = `https://${externalHost}/${externalPath}`;
    } else if (collection === 'supereasy') {
      const relativeMatch = rawReference.match(/^\.\.\/audio\/dict\/(nse\d+\.mp3)$/i);
      if (!relativeMatch) return;
      externalPath = `nse/audio/dict/${relativeMatch[1].toLowerCase()}`;
      sourceUrl = `https://${externalHost}/${externalPath}`;
    } else {
      return;
    }
    if (!externalPath || externalPath.includes('..')) return;
    const current = references.get(sourceUrl) || {
      sourceUrl,
      externalPath,
      collection,
      legacyReferences: new Set(),
      pagePaths: new Set(),
    };
    current.legacyReferences.add(rawReference);
    current.pagePaths.add(`/${pagePath}`);
    references.set(sourceUrl, current);
  }
  for (const filePath of files.sort()) {
    const pagePath = path.relative(root, filePath).split(path.sep).join('/');
    const html = fs.readFileSync(filePath, 'utf8');
    for (const match of html.matchAll(/\bsrc\s*=\s*(["'])([^"']+\.mp3(?:[?#][^"']*)?)\1/gi)) {
      addReference(match[2], pagePath);
    }
    for (const match of html.matchAll(/\bsoundFile\s*=\s*([^&"'\s>]+\.mp3(?:[?#][^&"'\s>]*)?)/gi)) {
      addReference(match[1], pagePath);
    }
  }
  return [...references.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
}

function download(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.1' } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        if (response.statusCode !== 200) {
          reject(new Error(`External audio HTTP ${response.statusCode}: ${url}`));
          return;
        }
        if (body.length === 0) {
          reject(new Error(`External audio was empty: ${url}`));
          return;
        }
        resolve(body);
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error(`External audio timed out: ${url}`)));
    request.on('error', reject);
  });
}

function makeItem(reference, body) {
  const digest = sha256(body);
  const filename = path.posix.basename(reference.externalPath);
  const collection = reference.collection || 'easyread';
  const objectKey = `${collection}/audio/dict/${digest.slice(0, 8)}/${filename}`;
  return {
    storyId: `external:${reference.sourceUrl}`,
    pagePath: [...reference.pagePaths][0] || null,
    sourcePath: `external/${externalHost}/${reference.externalPath}`,
    kind: 'external-audio',
    objectKey,
    url: `${routePrefix}${objectKey}`,
    sha256: digest,
    mime: 'audio/mpeg',
    preload: false,
    sourceUrl: reference.sourceUrl,
    legacyReferences: [...reference.legacyReferences].sort(),
  };
}

async function main() {
  const root = path.resolve(option('--root', repositoryRoot));
  const credentialsDocument = path.resolve(option('--credentials-doc', ''));
  if (!credentialsDocument) throw new Error('--credentials-doc is required');
  const envFile = path.resolve(option('--env-file', path.join(root, '.env')));
  const manifestPath = path.resolve(option('--manifest', path.join(root, 'poc/r2-read-audio-all.json')));
  const manifestOutput = path.resolve(option('--manifest-out', manifestPath));
  const collection = option('--collection', 'easyread');
  const apply = args.includes('--apply');
  loadEnvFile(envFile);
  if (!process.env.R2_BUCKET || !process.env.R2_ENDPOINT_URL) {
    throw new Error(`Missing R2_BUCKET or R2_ENDPOINT_URL in ${envFile}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.items)) throw new Error(`Manifest has no items array: ${manifestPath}`);
  const references = extractExternalReferences(root, collection);
  const existing = new Map(manifest.items.filter((item) => item?.sourceUrl).map((item) => [item.sourceUrl, item]));
  const pending = references.filter((reference) => !existing.has(reference.sourceUrl));
  process.stdout.write(`inventory: ${references.length} external MP3 references, ${pending.length} not yet in manifest\n`);
  if (!apply) return;

  const endpoint = new URL(process.env.R2_ENDPOINT_URL);
  const credentials = readCredentialDocument(credentialsDocument);
  const client = createClient({
    bucket: process.env.R2_BUCKET,
    endpoint,
    region: process.env.R2_REGION || 'auto',
    ...credentials,
  });
  const imported = [];
  const missing = Array.isArray(manifest.missing) ? [...manifest.missing] : [];
  const refreshedExisting = [];
  for (const reference of references) {
    const item = existing.get(reference.sourceUrl);
    if (!item) continue;
    refreshedExisting.push({
      ...item,
      pagePath: item.pagePath || [...reference.pagePaths][0] || null,
      legacyReferences: [...new Set([...(item.legacyReferences || []), ...reference.legacyReferences])].sort(),
    });
  }
  let nextIndex = 0;
  let completed = 0;
  const configuredConcurrency = Number(process.env.R2_EXTERNAL_CONCURRENCY || 2);
  const concurrency = Math.min(
    4,
    pending.length,
    Number.isInteger(configuredConcurrency) && configuredConcurrency > 0 ? configuredConcurrency : 2
  );

  async function processReference(reference) {
    await sleep(randomDelay());
    try {
      const body = await withRetry(() => download(reference.sourceUrl), reference.sourceUrl);
      const item = makeItem(reference, body);
      const head = await withRetry(() => client.request('HEAD', item.objectKey), item.objectKey);
      let matches = head.status === 200 && Number(head.headers['content-length']) === body.length;
      if (matches) {
        const current = await withRetry(() => client.request('GET', item.objectKey), item.objectKey);
        matches = current.status === 200 && current.body.equals(body);
      }
      if (!matches) {
        const put = await withRetry(() => client.request('PUT', item.objectKey, body), item.objectKey);
        if (put.status < 200 || put.status >= 300) throw new Error(`R2 upload failed HTTP ${put.status}: ${item.objectKey}`);
      }
      const verified = await withRetry(() => client.request('GET', item.objectKey), item.objectKey);
      if (verified.status !== 200 || !verified.body.equals(body)) throw new Error(`R2 byte verification failed: ${item.objectKey}`);
      imported.push(item);
    } catch (error) {
      missing.push({ sourceUrl: reference.sourceUrl, pagePaths: [...reference.pagePaths], reason: error.message });
      process.stderr.write(`missing external audio: ${reference.sourceUrl}: ${error.message}\n`);
    }
    completed += 1;
    if (completed % 10 === 0 || completed === pending.length) {
      process.stdout.write(`verified external ${completed}/${pending.length}\n`);
    }
  }

  async function worker() {
    while (nextIndex < pending.length) {
      const index = nextIndex;
      nextIndex += 1;
      await processReference(pending[index]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const combined = new Map(manifest.items.map((item) => [item.sourcePath, item]));
  for (const item of refreshedExisting) combined.set(item.sourcePath, item);
  for (const item of imported) combined.set(item.sourcePath, item);
  const importedReferences = new Set(imported.flatMap((item) => item.legacyReferences || []));
  const filteredMissing = missing.filter((entry) => !importedReferences.has(entry.reference));
  const output = {
    ...manifest,
    items: [...combined.values()],
    collections: [...new Set([...(manifest.collections || []), collection])],
    missing: filteredMissing,
  };
  fs.writeFileSync(manifestOutput, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ imported: imported.length, missing: filteredMissing.length, manifest: manifestOutput }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
