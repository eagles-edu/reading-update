#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { createClient, readCredentialDocument } = require('./upload-r2-audio.cjs');

const repositoryRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const recoveredSources = [
  {
    sourcePath: 'begin2/audio/d/b2d00201.mp3',
    sourceUrl: 'https://www.eslfast.com/begin2/audio/d/b2d00201.mp3',
    pagePath: '/begin2/dict/b2d002.html',
    legacyReferences: ['../audio/d/b2d00201.mp3'],
  },
  {
    sourcePath: 'people/audio/d/pd05602.mp3',
    sourceUrl: 'https://www.eslfast.com/people/audio/d/pd05602.mp3',
    pagePath: '/people/dict/pdict056.html',
    legacyReferences: ['../audio/d/pd05602.mp3'],
  },
];

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

function digest(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        if (body.length === 0) return reject(new Error(`Empty audio response: ${url}`));
        resolve(body);
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error(`Timed out: ${url}`)));
    request.on('error', reject);
  });
}

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 5 || !/timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|EAI_AGAIN|HTTP (429|5\d\d)/i.test(String(error.message))) {
        throw error;
      }
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
      process.stderr.write(`retrying ${label} in ${delay}ms: ${error.message}\n`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function makeItem(source, body) {
  const sha256 = digest(body);
  const filename = path.posix.basename(source.sourcePath);
  const level = source.sourcePath.split('/')[0];
  const objectKey = `${level}/audio/d/${sha256.slice(0, 8)}/${filename}`;
  return {
    storyId: `recovered:${source.sourcePath}`,
    pagePath: source.pagePath,
    sourcePath: source.sourcePath,
    kind: 'recovered-live-audio',
    objectKey,
    url: `/reading/_audio/${objectKey}`,
    sha256,
    mime: 'audio/mpeg',
    preload: false,
    sourceUrl: source.sourceUrl,
    legacyReferences: source.legacyReferences,
  };
}

async function main() {
  const root = path.resolve(option('--root', repositoryRoot));
  const credentialsDocument = path.resolve(option('--credentials-doc', ''));
  if (!credentialsDocument) throw new Error('--credentials-doc is required');
  const envFile = path.resolve(option('--env-file', path.join(root, '.env')));
  const manifestPath = path.resolve(option('--manifest', path.join(root, 'poc/r2-read-audio-all.json')));
  const manifestOutput = path.resolve(option('--manifest-out', manifestPath));
  const apply = args.includes('--apply');
  loadEnvFile(envFile);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.items)) throw new Error(`Manifest has no items array: ${manifestPath}`);
  const existing = new Map(manifest.items.map((item) => [item.sourcePath, item]));
  const pending = recoveredSources.filter((source) => !existing.has(source.sourcePath));
  process.stdout.write(`inventory: ${recoveredSources.length} recovered live MP3 files, ${pending.length} not yet in manifest\n`);
  if (!apply) return;
  if (!process.env.R2_BUCKET || !process.env.R2_ENDPOINT_URL) throw new Error(`Missing R2_BUCKET or R2_ENDPOINT_URL in ${envFile}`);
  const client = createClient({
    bucket: process.env.R2_BUCKET,
    endpoint: new URL(process.env.R2_ENDPOINT_URL),
    region: process.env.R2_REGION || 'auto',
    ...readCredentialDocument(credentialsDocument),
  });
  const imported = [];
  for (const source of pending) {
    await sleep(750 + Math.floor(Math.random() * 1051));
    const body = await withRetry(() => download(source.sourceUrl), source.sourceUrl);
    const item = makeItem(source, body);
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
    process.stdout.write(`verified recovered ${imported.length}/${pending.length}\n`);
  }
  const combined = new Map(manifest.items.map((item) => [item.sourcePath, item]));
  for (const item of imported) combined.set(item.sourcePath, item);
  const resolvedPaths = new Set(imported.map((item) => item.sourcePath));
  const resolvedReferences = new Set(imported.flatMap((item) => item.legacyReferences));
  const missing = (manifest.missing || []).filter(
    (entry) => !resolvedPaths.has(entry.sourcePath) && !resolvedReferences.has(entry.reference)
  );
  const output = {
    ...manifest,
    items: [...combined.values()],
    missing,
  };
  fs.writeFileSync(manifestOutput, `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(JSON.stringify({ imported: imported.length, missing: missing.length, manifest: manifestOutput }, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
