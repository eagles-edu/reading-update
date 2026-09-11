#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

function usage() {
  process.stdout.write(
    'Usage: node scripts/upload-r2-flip-images.cjs --credentials-doc PATH [options]\n' +
      'Options:\n' +
      '  --root PATH             Flip site root (default: /home/thuvien.eagles.edu.vn/public_html/turn4js/flip)\n' +
      '  --env-file PATH         Non-secret R2 config file (default: ROOT/.env of this repository)\n' +
      '  --bucket NAME           R2 bucket (default: flip-image)\n' +
      '  --prefix PATH           Object-key prefix (default: turn4js/flip)\n' +
      '  --manifest-out PATH     Output manifest path (default: poc/r2-flip-image-manifest.json)\n' +
      '  --concurrency NUMBER    Concurrent transfers (default: 4)\n' +
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
  const writePermission = /read,\s*write,\s*and\s*list\s+objects/i;
  const permissionStart = document.search(writePermission);
  if (permissionStart < 0) {
    throw new Error('Credential document does not declare R2 object write permission');
  }

  const writeSection = document.slice(permissionStart);
  const accessKeyMatch = writeSection.match(
    /Access Key ID[\s\S]{0,5000}?(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i
  );
  const secretKeyMatch = writeSection.match(
    /Secret Access Key[\s\S]{0,5000}?(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i
  );
  if (!accessKeyMatch || !secretKeyMatch) {
    throw new Error('Credential document is missing the write-capable S3 credentials');
  }

  return {
    accessKeyId: accessKeyMatch[0].match(/[0-9a-f]{32}/i)[0],
    secretAccessKey: secretKeyMatch[0].match(/[0-9a-f]{64}/i)[0],
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

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const type = types[extension];
  if (!type) throw new Error(`Unsupported image type: ${filePath}`);
  return type;
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

  function request(method, objectKey, body = null, contentType = null) {
    const payloadHash = body === null ? sha256(Buffer.alloc(0)) : sha256(body);
    const signed = signedRequest(method, objectKey, payloadHash);
    const headers = { ...signed.headers };
    if (body !== null) {
      headers['content-type'] = contentType;
      headers['cache-control'] = 'public, max-age=86400';
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

function walk(directory, relativeDirectory, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, relativePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const pathParts = relativePath.split('/');
    if (pathParts[0] === 'docs' || pathParts.length !== 3 || pathParts[1] !== 'pages') continue;
    const fileName = pathParts[2];
    if (!/^\d+(?:-large)?\.(?:avif|gif|jpe?g|png|webp)$/i.test(fileName)) continue;
    const stat = fs.statSync(absolutePath);
    files.push({ absolutePath, relativePath, bytes: stat.size, mime: mimeType(absolutePath) });
  }
}

function inventory(root, prefix) {
  const files = [];
  walk(root, '', files);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true }));
  return files.map((file) => ({
    ...file,
    objectKey: path.posix.join(prefix, file.relativePath),
  }));
}

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..');
  const root = path.resolve(option('--root', '/home/thuvien.eagles.edu.vn/public_html/turn4js/flip'));
  const credentialsDocument = path.resolve(option('--credentials-doc', ''));
  const envFile = path.resolve(option('--env-file', path.join(repositoryRoot, '.env')));
  const bucket = option('--bucket', 'flip-image');
  const prefix = option('--prefix', 'turn4js/flip').replace(/^\/+|\/+$/g, '');
  const manifestOutput = path.resolve(
    option('--manifest-out', path.join(repositoryRoot, 'poc/r2-flip-image-manifest.json'))
  );
  const concurrency = Number(option('--concurrency', '4'));
  const dryRun = args.includes('--dry-run');

  if (!credentialsDocument) throw new Error('--credentials-doc is required');
  if (!fs.statSync(root).isDirectory()) throw new Error(`Flip root does not exist: ${root}`);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('--concurrency must be an integer from 1 through 8');
  }

  loadEnvFile(envFile);
  const endpointValue = process.env.R2_ENDPOINT_URL;
  if (!endpointValue) throw new Error(`Missing R2_ENDPOINT_URL in ${envFile}`);
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== 'https:') throw new Error('R2_ENDPOINT_URL must use https');

  const items = inventory(root, prefix);
  if (items.length === 0) throw new Error('No numeric page or large image files found');
  const totals = items.reduce(
    (summary, item) => {
      summary.files += 1;
      summary.bytes += item.bytes;
      if (item.relativePath.endsWith('-large.jpg') || item.relativePath.endsWith('-large.jpeg') || item.relativePath.endsWith('-large.png') || item.relativePath.endsWith('-large.webp') || item.relativePath.endsWith('-large.gif') || item.relativePath.endsWith('-large.avif')) {
        summary.largeFiles += 1;
        summary.largeBytes += item.bytes;
      } else {
        summary.baseFiles += 1;
        summary.baseBytes += item.bytes;
      }
      return summary;
    },
    { files: 0, bytes: 0, largeFiles: 0, largeBytes: 0, baseFiles: 0, baseBytes: 0 }
  );
  process.stdout.write(`${JSON.stringify({ bucket, prefix, root, ...totals }, null, 2)}\n`);
  if (dryRun) return;

  const credentials = readCredentialDocument(credentialsDocument);
  const client = createClient({
    bucket,
    endpoint,
    region: process.env.R2_REGION || 'auto',
    ...credentials,
  });

  let nextIndex = 0;
  let uploaded = 0;
  let reused = 0;
  let verified = 0;
  const manifestItems = [];

  async function retryRequest(operation, label) {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === 4) break;
        const delay = attempt * 2000;
        process.stderr.write(`retrying ${label} after attempt ${attempt} in ${delay}ms\n`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  async function processItem() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      const body = fs.readFileSync(item.absolutePath);
      const digest = sha256(body);
      const head = await retryRequest(
        () => client.request('HEAD', item.objectKey),
        `HEAD ${item.relativePath}`
      );
      let matches = head.status === 200 && Number(head.headers['content-length']) === body.length;
      if (matches) {
        const current = await retryRequest(
          () => client.request('GET', item.objectKey),
          `GET ${item.relativePath}`
        );
        matches = current.status === 200 && current.body.equals(body);
      }
      if (!matches) {
        const put = await retryRequest(
          () => client.request('PUT', item.objectKey, body, item.mime),
          `PUT ${item.relativePath}`
        );
        if (put.status < 200 || put.status >= 300) {
          throw new Error(`Upload failed for ${item.relativePath}: HTTP ${put.status}`);
        }
        uploaded += 1;
      } else {
        reused += 1;
      }
      const current = await retryRequest(
        () => client.request('GET', item.objectKey),
        `GET ${item.relativePath}`
      );
      if (current.status !== 200 || !current.body.equals(body)) {
        throw new Error(`Byte verification failed for ${item.relativePath}: HTTP ${current.status}`);
      }
      verified += 1;
      manifestItems.push({
        sourcePath: item.relativePath,
        objectKey: item.objectKey,
        bytes: item.bytes,
        mime: item.mime,
        sha256: digest,
      });
      if (verified % 25 === 0 || verified === items.length) {
        process.stdout.write(`verified ${verified}/${items.length}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => processItem()));
  manifestItems.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, undefined, { numeric: true }));
  fs.mkdirSync(path.dirname(manifestOutput), { recursive: true });
  fs.writeFileSync(
    manifestOutput,
    `${JSON.stringify({ schemaVersion: 1, bucket, prefix, root, totals, items: manifestItems }, null, 2)}\n`
  );
  process.stdout.write(`${JSON.stringify({ uploaded, reused, verified, manifest: manifestOutput }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
