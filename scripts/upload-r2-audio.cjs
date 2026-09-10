#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

function usage() {
  process.stdout.write(
    'Usage: node scripts/upload-r2-audio.cjs --credentials-doc PATH [options]\n' +
      'Options:\n' +
      '  --root PATH             Repository root (default: current directory)\n' +
      '  --env-file PATH         Non-secret R2 config file (default: ROOT/.env)\n' +
    '  --existing-manifest PATH Existing manifest for already migrated pages\n' +
    '  --manifest-out PATH     Output manifest path (default: ROOT/audio-manifest.json)\n' +
    '  --levels LIST           Comma-separated levels, e.g. b1,b2,b3,b4,b5\n' +
    '  --roots LIST            Comma-separated collection roots, e.g. easyread,essays,people\n' +
    '  --include-root-audio    Include MP3 files in ROOT/audio\n' +
    '  --include-dictation     Include HTML references to each level audio/d directory\n' +
      '  --start NUMBER          First story number (default: 1)\n' +
      '  --end NUMBER            Last story number (default: 85)\n' +
      '  --dry-run               Inventory only; do not contact R2 or write a manifest\n'
  );
}

const args = process.argv.slice(2);
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
  if (!fs.existsSync(filePath)) throw new Error(`Missing env file: ${filePath}`);
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

function readCredentialDocument(filePath) {
  const document = fs.readFileSync(filePath, 'utf8');
  if (!/read,\s*write,\s*and\s*list\s+objects/i.test(document)) {
    throw new Error('Credential document does not declare R2 object write permission');
  }

  function extract(label, pattern) {
    const start = document.indexOf(label);
    if (start < 0) throw new Error(`Credential document is missing ${label}`);
    const match = document.slice(start, start + 5000).match(pattern);
    if (!match) throw new Error(`Credential document has no value after ${label}`);
    return match[0];
  }

  return {
    accessKeyId: extract(
      'Access Key ID',
      /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i
    ),
    secretAccessKey: extract(
      'Secret Access Key',
      /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i
    ),
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function createClient({ bucket, endpoint, region, accessKeyId, secretAccessKey }) {
  function objectPath(objectKey) {
    return `${endpoint.pathname.replace(/\/$/, '')}/${encodeSegment(bucket)}/${objectKey
      .split('/')
      .map(encodeSegment)
      .join('/')}`;
  }

  function signedRequest(method, objectKey, payloadHash) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const host = endpoint.host;
    const canonicalHeaders = [
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n');
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [
      method,
      objectPath(objectKey),
      '',
      `${canonicalHeaders}\n`,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const scope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256(Buffer.from(canonicalRequest)),
    ].join('\n');
    const dateKey = hmac(`AWS4${secretAccessKey}`, date);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = hmac(signingKey, stringToSign, 'hex');

    return {
      path: objectPath(objectKey),
      headers: {
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    };
  }

  function request(method, objectKey, body = null) {
    const payloadHash = body === null ? sha256(Buffer.alloc(0)) : sha256(body);
    const signed = signedRequest(method, objectKey, payloadHash);
    const headers = { ...signed.headers };
    if (body !== null) {
      headers['content-type'] = 'audio/mpeg';
      headers['content-length'] = body.length;
    }

    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port || 443,
          method,
          path: signed.path,
          headers,
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      request.setTimeout(120000, () =>
        request.destroy(new Error(`R2 request timed out: ${method} ${objectKey}`))
      );
      request.on('error', reject);
      if (body !== null) request.write(body);
      request.end();
    });
  }

  return { request };
}

function inventoryStories(root, levels, start, end, existingManifest) {
  const items = [];
  const missing = [];

  for (const level of levels) {
    const levelNumber = Number(level.slice(1));
    const storyDirectory = path.join(root, `begin${levelNumber}`, level);
    const pageNames = fs
      .readdirSync(storyDirectory)
      .filter((name) => new RegExp(`^${level}\\d+\\.html$`, 'i').test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    for (const pageName of pageNames) {
      const id = path.basename(pageName, '.html');
      const storyNumber = Number(id.slice(level.length));
      if (levels.length === 1 && (storyNumber < start || storyNumber > end)) continue;
      const pagePath = path.posix.join(`begin${levelNumber}`, level, pageName);
      const html = fs.readFileSync(path.join(root, pagePath), 'utf8');
      const match = html.match(
        /<audio\b[^>]*\bsrc\s*=\s*["']([^"']+\.mp3(?:[?#][^"']*)?)/i
      );
      if (!match) {
        missing.push({
          storyId: id,
          pagePath: `/${pagePath}`,
          reference: null,
          reason: 'no-audio-element',
        });
        continue;
      }

      const rawReference = match[1];
      if (rawReference.includes('#.mp3')) {
        missing.push({
          storyId: id,
          pagePath: `/${pagePath}`,
          reference: rawReference,
        });
        continue;
      }

      const cleanReference = rawReference.split(/[?#]/, 1)[0];
      let objectKey;
      let sourcePath;
      if (cleanReference.startsWith('/reading/_audio/')) {
        objectKey = cleanReference.slice('/reading/_audio/'.length);
        sourcePath = path.posix.join(
          `begin${levelNumber}`,
          'audio',
          path.posix.basename(objectKey)
        );
      } else if (cleanReference.startsWith('../audio/')) {
        sourcePath = path.posix.normalize(
          path.posix.join(path.posix.dirname(pagePath), cleanReference)
        );
      } else {
        throw new Error(`Unsupported MP3 reference ${rawReference} in ${pagePath}`);
      }

      const absoluteSourcePath = path.join(root, sourcePath);
      const existing = existingManifest?.get(id);
      if (!fs.existsSync(absoluteSourcePath)) {
        if (!existing || !cleanReference.startsWith('/reading/_audio/')) {
          throw new Error(`Missing source ${sourcePath} for ${id}`);
        }
        items.push({
          item: {
            ...existing,
            storyId: id,
            pagePath: `/${pagePath}`,
            sourcePath,
            objectKey,
            url: `/reading/_audio/${objectKey}`,
          },
          body: null,
        });
        continue;
      }
      const body = fs.readFileSync(absoluteSourcePath);
      const digest = sha256(body);
      if (existing?.sha256 && existing.sha256 !== digest) {
        throw new Error(`Local source hash differs from existing manifest for ${id}`);
      }
      objectKey =
        objectKey ||
        `${level}/audio/${digest.slice(0, 8)}/${path.posix.basename(sourcePath)}`;

      items.push({
        item: {
          storyId: id,
          pagePath: `/${pagePath}`,
          sourcePath,
          kind: 'story',
          objectKey,
          url: `/reading/_audio/${objectKey}`,
          sha256: digest,
          mime: 'audio/mpeg',
          preload: existing?.preload === true,
        },
        body,
      });
    }
  }

  return { items, missing };
}

function collectHtmlFiles(root, levelNumber) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        files.push(filePath);
      }
    }
  }
  visit(path.join(root, `begin${levelNumber}`));
  return files.sort();
}

function inventoryDictation(root, levels, existingManifest) {
  const itemsBySource = new Map();
  const missing = [];

  for (const level of levels) {
    const levelNumber = Number(level.slice(1));
    for (const absolutePagePath of collectHtmlFiles(root, levelNumber)) {
      const pagePath = path.relative(root, absolutePagePath).split(path.sep).join('/');
      const html = fs.readFileSync(absolutePagePath, 'utf8');
      const references = [
        ...html.matchAll(
          /(?:src|href)\s*=\s*["']([^"']+\.mp3(?:[?#][^"']*)?)/gi
        ),
      ];

      for (const match of references) {
        const rawReference = match[1];
        const cleanReference = rawReference.split(/[?#]/, 1)[0];
        let objectKey;
        let sourcePath;
        if (cleanReference.startsWith('/reading/_audio/')) {
          objectKey = cleanReference.slice('/reading/_audio/'.length);
          if (!objectKey.startsWith(`${level}/audio/d/`)) continue;
          sourcePath = path.posix.join(
            `begin${levelNumber}`,
            'audio',
            'd',
            path.posix.basename(objectKey)
          );
        } else if (cleanReference.includes('/audio/d/')) {
          sourcePath = path.posix.normalize(
            path.posix.join(path.posix.dirname(pagePath), cleanReference)
          );
          if (!sourcePath.startsWith(`begin${levelNumber}/audio/d/`)) continue;
        } else {
          continue;
        }

        if (itemsBySource.has(sourcePath)) continue;
        const assetId = `${level}:${path.posix.basename(sourcePath)}`;
        const existing = existingManifest?.get(assetId);
        const absoluteSourcePath = path.join(root, sourcePath);
        if (!fs.existsSync(absoluteSourcePath)) {
          if (!existing || !objectKey) {
            missing.push({
              assetId,
              pagePath: `/${pagePath}`,
              sourcePath,
              reference: rawReference,
              reason: 'missing-source',
            });
            continue;
          }
          itemsBySource.set(sourcePath, {
            item: {
              ...existing,
              storyId: assetId,
              pagePath: `/${pagePath}`,
              sourcePath,
              objectKey,
              url: `/reading/_audio/${objectKey}`,
            },
            body: null,
          });
          continue;
        }

        const body = fs.readFileSync(absoluteSourcePath);
        const digest = sha256(body);
        if (existing?.sha256 && existing.sha256 !== digest) {
          throw new Error(`Local source hash differs from existing manifest for ${assetId}`);
        }
        objectKey =
          objectKey ||
          `${level}/audio/d/${digest.slice(0, 8)}/${path.posix.basename(sourcePath)}`;
        itemsBySource.set(sourcePath, {
          item: {
            storyId: assetId,
            pagePath: `/${pagePath}`,
            sourcePath,
            kind: 'dictation',
            objectKey,
            url: `/reading/_audio/${objectKey}`,
            sha256: digest,
            mime: 'audio/mpeg',
            preload: false,
          },
          body,
        });
      }
    }
  }

  return { items: [...itemsBySource.values()], missing };
}

function collectRootHtmlFiles(root, collection) {
  const files = [];
  const collectionRoot = path.join(root, collection);

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        files.push(filePath);
      }
    }
  }

  visit(collectionRoot);
  return files.sort();
}

function inventoryCollections(root, collections, existingBySource) {
  const itemsBySource = new Map();
  const missingBySource = new Map();

  for (const collection of collections) {
    const audioPrefix = `${collection}/audio/`;
    for (const absolutePagePath of collectRootHtmlFiles(root, collection)) {
      const pagePath = path.relative(root, absolutePagePath).split(path.sep).join('/');
      const html = fs.readFileSync(absolutePagePath, 'utf8');
      const references = [
        ...html.matchAll(/\bsrc\s*=\s*["']([^"']+\.mp3(?:[?#][^"']*)?)/gi),
      ];

      for (const match of references) {
        const rawReference = match[1];
        const cleanReference = rawReference.split(/[?#]/, 1)[0];
        if (
          cleanReference.startsWith('/reading/_audio/') ||
          /^(?:[a-z]+:|\/\/|data:|blob:)/i.test(cleanReference)
        ) {
          continue;
        }

        const sourcePath = path.posix.normalize(
          path.posix.join(path.posix.dirname(pagePath), cleanReference)
        );
        if (
          !sourcePath.startsWith(audioPrefix) ||
          sourcePath.split('/').includes('..')
        ) {
          continue;
        }
        if (itemsBySource.has(sourcePath) || missingBySource.has(sourcePath)) {
          continue;
        }

        const existing = existingBySource.get(sourcePath);
        const absoluteSourcePath = path.join(root, sourcePath);
        if (!fs.existsSync(absoluteSourcePath)) {
          if (existing?.objectKey && existing?.sha256) {
            itemsBySource.set(sourcePath, {
              item: {
                ...existing,
                pagePath: `/${pagePath}`,
                sourcePath,
                objectKey: existing.objectKey,
                url: `/reading/_audio/${existing.objectKey}`,
              },
              body: null,
            });
          } else {
            missingBySource.set(sourcePath, {
              collection,
              pagePath: `/${pagePath}`,
              sourcePath,
              reference: rawReference,
              reason: 'missing-source',
            });
          }
          continue;
        }

        const body = fs.readFileSync(absoluteSourcePath);
        const digest = sha256(body);
        if (existing?.sha256 && existing.sha256 !== digest) {
          throw new Error(`Local source hash differs from existing manifest for ${sourcePath}`);
        }

        const relativeAudioPath = sourcePath.slice(audioPrefix.length);
        const parsedAudioPath = path.posix.parse(relativeAudioPath);
        const relativeDirectory = parsedAudioPath.dir
          ? `${parsedAudioPath.dir}/`
          : '';
        const objectKey =
          existing?.objectKey ||
          `${collection}/audio/${relativeDirectory}${digest.slice(0, 8)}/${parsedAudioPath.base}`;

        itemsBySource.set(sourcePath, {
          item: {
            storyId: `${collection}:${sourcePath}`,
            pagePath: `/${pagePath}`,
            sourcePath,
            kind: 'collection-audio',
            objectKey,
            url: `/reading/_audio/${objectKey}`,
            sha256: digest,
            mime: 'audio/mpeg',
            preload: existing?.preload === true,
          },
          body,
        });
      }
    }

    const audioDirectory = path.join(root, collection, 'audio');
    const audioFiles = [];
    function collectAudioFiles(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          collectAudioFiles(filePath);
        } else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
          audioFiles.push(filePath);
        }
      }
    }
    collectAudioFiles(audioDirectory);

    for (const absoluteSourcePath of audioFiles.sort()) {
      const sourcePath = path.relative(root, absoluteSourcePath).split(path.sep).join('/');
      if (itemsBySource.has(sourcePath)) continue;

      const existing = existingBySource.get(sourcePath);
      const body = fs.readFileSync(absoluteSourcePath);
      const digest = sha256(body);
      if (existing?.sha256 && existing.sha256 !== digest) {
        throw new Error(`Local source hash differs from existing manifest for ${sourcePath}`);
      }

      const relativeAudioPath = sourcePath.slice(audioPrefix.length);
      const parsedAudioPath = path.posix.parse(relativeAudioPath);
      const relativeDirectory = parsedAudioPath.dir
        ? `${parsedAudioPath.dir}/`
        : '';
      const objectKey =
        existing?.objectKey ||
        `${collection}/audio/${relativeDirectory}${digest.slice(0, 8)}/${parsedAudioPath.base}`;

      itemsBySource.set(sourcePath, {
        item: {
          storyId: `${collection}:${sourcePath}`,
          pagePath: null,
          sourcePath,
          kind: 'collection-audio',
          objectKey,
          url: `/reading/_audio/${objectKey}`,
          sha256: digest,
          mime: 'audio/mpeg',
          preload: existing?.preload === true,
        },
        body,
      });
    }
  }

  return {
    items: [...itemsBySource.values()],
    missing: [...missingBySource.values()],
  };
}

function inventoryRootAudio(root, existingBySource) {
  const items = [];
  const audioDirectory = path.join(root, 'audio');
  const audioFiles = [];

  function collectAudioFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        collectAudioFiles(filePath);
      } else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
        audioFiles.push(filePath);
      }
    }
  }

  collectAudioFiles(audioDirectory);
  for (const absoluteSourcePath of audioFiles.sort()) {
    const sourcePath = path.relative(root, absoluteSourcePath).split(path.sep).join('/');
    const existing = existingBySource.get(sourcePath);
    const body = fs.readFileSync(absoluteSourcePath);
    const digest = sha256(body);
    if (existing?.sha256 && existing.sha256 !== digest) {
      throw new Error(`Local source hash differs from existing manifest for ${sourcePath}`);
    }

    const relativeAudioPath = sourcePath.slice('audio/'.length);
    const parsedAudioPath = path.posix.parse(relativeAudioPath);
    const relativeDirectory = parsedAudioPath.dir
      ? `${parsedAudioPath.dir}/`
      : '';
    const objectKey =
      existing?.objectKey ||
      `root-audio/audio/${relativeDirectory}${digest.slice(0, 8)}/${parsedAudioPath.base}`;

    items.push({
      item: {
        storyId: `root-audio:${sourcePath}`,
        pagePath: null,
        sourcePath,
        kind: 'collection-audio',
        objectKey,
        url: `/reading/_audio/${objectKey}`,
        sha256: digest,
        mime: 'audio/mpeg',
        preload: existing?.preload === true,
      },
      body,
    });
  }

  return { items, missing: [] };
}

async function main() {
  const root = path.resolve(option('--root', process.cwd()));
  const credentialsDocument = path.resolve(option('--credentials-doc', ''));
  if (!credentialsDocument) throw new Error('--credentials-doc is required');
  const envFile = path.resolve(option('--env-file', path.join(root, '.env')));
  const existingManifestPath = path.resolve(
    option('--existing-manifest', path.join(root, 'poc/r2-read-audio-b1-b1001-b1010.json'))
  );
  const manifestOutput = path.resolve(
    option('--manifest-out', path.join(root, 'audio-manifest.json'))
  );
  const levelsOption = args.includes('--levels') ? option('--levels', '') : '';
  const rootsOption = args.includes('--roots') ? option('--roots', '') : '';
  const levels = (levelsOption || (!rootsOption ? 'b1' : ''))
    .split(',')
    .map((level) => level.trim().toLowerCase())
    .filter(Boolean);
  const roots = rootsOption
    .split(',')
    .map((rootName) => rootName.trim().toLowerCase())
    .filter(Boolean);
  const includeRootAudio = args.includes('--include-root-audio');
  const start = Number(option('--start', '1'));
  const end = Number(option('--end', '85'));
  const dryRun = args.includes('--dry-run');
  const includeDictation = args.includes('--include-dictation');

  if (new Set(levels).size !== levels.length || levels.some((level) => !/^b[1-9]\d*$/.test(level))) {
    throw new Error('--levels must contain unique values such as b1 through b85');
  }
  if (
    new Set(roots).size !== roots.length ||
    roots.some((rootName) => !/^[a-z][a-z0-9_-]{0,63}$/.test(rootName))
  ) {
    throw new Error('--roots must contain unique safe collection directory names');
  }
  if (levels.length === 0 && roots.length === 0) {
    throw new Error('Provide --levels, --roots, or both');
  }
  for (const collection of roots) {
    const collectionPath = path.join(root, collection);
    if (!fs.existsSync(collectionPath) || !fs.statSync(collectionPath).isDirectory()) {
      throw new Error(`Collection root does not exist: ${collection}`);
    }
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error('Story range must be positive integers with start <= end');
  }
  if (levels.length > 1 && (args.includes('--start') || args.includes('--end'))) {
    throw new Error('--start and --end can only be used with one level');
  }
  loadEnvFile(envFile);
  for (const name of ['R2_BUCKET', 'R2_ENDPOINT_URL']) {
    if (!process.env[name]) throw new Error(`Missing ${name} in ${envFile}`);
  }
  const endpoint = new URL(process.env.R2_ENDPOINT_URL);
  if (endpoint.protocol !== 'https:') throw new Error('R2_ENDPOINT_URL must use https');

  let existingManifest;
  let existingItems = [];
  const existingBySource = new Map();
  if (fs.existsSync(existingManifestPath)) {
    const parsed = JSON.parse(fs.readFileSync(existingManifestPath, 'utf8'));
    if (!Array.isArray(parsed.items)) throw new Error(`Invalid existing manifest: ${existingManifestPath}`);
    existingItems = parsed.items;
    for (const item of parsed.items) {
      if (typeof item?.sourcePath === 'string') existingBySource.set(item.sourcePath, item);
    }
    existingManifest = new Map(parsed.items.map((item) => [item.storyId, item]));
  }

  const storyInventory = levels.length > 0
    ? inventoryStories(root, levels, start, end, existingManifest)
    : { items: [], missing: [] };
  const dictationInventory = includeDictation
    ? inventoryDictation(root, levels, existingManifest)
    : { items: [], missing: [] };
  const collectionInventory = roots.length > 0
    ? inventoryCollections(root, roots, existingBySource)
    : { items: [], missing: [] };
  const rootAudioInventory = includeRootAudio
    ? inventoryRootAudio(root, existingBySource)
    : { items: [], missing: [] };
  const items = [
    ...storyInventory.items,
    ...dictationInventory.items,
    ...collectionInventory.items,
    ...rootAudioInventory.items,
  ];
  const missing = [...storyInventory.missing, ...dictationInventory.missing];
  missing.push(...collectionInventory.missing);
  missing.push(...rootAudioInventory.missing);
  if (items.length === 0) throw new Error('No migratable MP3 files found');
  process.stdout.write(
    `inventory: ${storyInventory.items.length} story MP3 files, ${dictationInventory.items.length} dictation MP3 files, ${collectionInventory.items.length} collection MP3 files, ${rootAudioInventory.items.length} root audio MP3 files, ${missing.length} missing reference(s)\n`
  );
  if (dryRun) return;

  const credentials = readCredentialDocument(credentialsDocument);
  const client = createClient({
    bucket: process.env.R2_BUCKET,
    endpoint,
    region: process.env.R2_REGION || 'auto',
    ...credentials,
  });
  let uploaded = 0;
  let reused = 0;
  let completed = 0;
  let nextIndex = 0;
  const configuredConcurrency = Number(process.env.R2_UPLOAD_CONCURRENCY || 8);
  const concurrency = Math.min(
    8,
    items.length,
    Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
      ? configuredConcurrency
      : 8
  );

  async function processItem(index) {
    const { item, body } = items[index];
    if (body === null) {
      const current = await client.request('GET', item.objectKey);
      const matches =
        current.status === 200 && sha256(current.body) === item.sha256;
      if (!matches) {
        throw new Error(`Existing R2 verification failed for ${item.storyId}`);
      }
      reused += 1;
    } else {
      const head = await client.request('HEAD', item.objectKey);
      let matches =
        head.status === 200 && Number(head.headers['content-length']) === body.length;
      if (matches) {
        const current = await client.request('GET', item.objectKey);
        matches = current.status === 200 && current.body.equals(body);
      }
      if (!matches) {
        const put = await client.request('PUT', item.objectKey, body);
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`Upload failed for ${item.storyId}: HTTP ${put.status}`);
        }
        uploaded += 1;
      } else {
        reused += 1;
      }
      const verified = await client.request('GET', item.objectKey);
      if (verified.status !== 200 || !verified.body.equals(body)) {
        throw new Error(`Byte verification failed for ${item.storyId}: HTTP ${verified.status}`);
      }
    }
    completed += 1;
    if (completed % 10 === 0 || completed === items.length) {
      process.stdout.write(`verified ${completed}/${items.length}\n`);
    }
  }

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await processItem(index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const combinedBySource = new Map(
    existingItems.map((item) => [item.sourcePath, item])
  );
  for (const { item } of items) {
    combinedBySource.set(item.sourcePath, item);
  }
  const manifest = {
    schemaVersion: 1,
    bucket: process.env.R2_BUCKET,
    collections: [...levels, ...roots],
    includesDictation: includeDictation || existingItems.some((item) => item.kind === 'dictation'),
    items: [...combinedBySource.values()],
    missing,
  };
  fs.writeFileSync(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ uploaded, reused, verified: items.length, missing, manifest: manifestOutput }, null, 2)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
