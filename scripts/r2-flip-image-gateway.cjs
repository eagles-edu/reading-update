#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const routePrefix = '/turn4js/flip/_image/';
const emptyPayloadHash = crypto.createHash('sha256').update('').digest('hex');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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

loadEnvFile(path.join(repositoryRoot, '.env'));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const bucket = process.env.R2_FLIP_BUCKET || requiredEnv('R2_BUCKET');
const region = process.env.R2_REGION || 'auto';
const endpoint = new URL(requiredEnv('R2_ENDPOINT_URL'));
const credentialsDocument = process.env.R2_FLIP_CREDENTIALS_DOC;
const manifestPath = path.resolve(
  process.env.R2_FLIP_IMAGE_MANIFEST || path.join(repositoryRoot, 'poc/r2-flip-image-manifest.json')
);
const port = Number(process.env.R2_FLIP_IMAGE_PORT || 8790);

if (endpoint.protocol !== 'https:') throw new Error('R2_ENDPOINT_URL must use https');
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('R2_FLIP_IMAGE_PORT must be a valid TCP port');
}

function readReadOnlyCredentials(filePath, tokenLabel) {
  const document = fs.readFileSync(filePath, 'utf8');
  const tokenStart = document.indexOf(tokenLabel);
  if (tokenStart < 0) throw new Error(`Credential document is missing ${tokenLabel}`);
  const nextToken = document.indexOf('Create Account API Token', tokenStart + tokenLabel.length);
  const section = document.slice(tokenStart, nextToken < 0 ? document.length : nextToken);
  if (!/read\s+and\s+list\s+objects/i.test(section)) {
    throw new Error(`${tokenLabel} is not a read/list credential`);
  }
  const accessKeyMatch = section.match(
    /Access Key ID[\s\S]{0,5000}?(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i
  );
  const secretKeyMatch = section.match(
    /Secret Access Key[\s\S]{0,5000}?(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i
  );
  if (!accessKeyMatch || !secretKeyMatch) {
    throw new Error(`${tokenLabel} is missing S3 credentials`);
  }
  return {
    accessKeyId: accessKeyMatch[0].match(/[0-9a-f]{32}/i)[0],
    secretAccessKey: secretKeyMatch[0].match(/[0-9a-f]{64}/i)[0],
  };
}

const credentials = credentialsDocument
  ? readReadOnlyCredentials(
      credentialsDocument,
      process.env.R2_FLIP_TOKEN_LABEL || 'R2 flip-image read-only key'
    )
  : {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    };
const { accessKeyId, secretAccessKey } = credentials;

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(manifest.items)) throw new Error(`Manifest has no items array: ${manifestPath}`);

const assetsByKey = new Map();
for (const item of manifest.items) {
  if (!item || typeof item.objectKey !== 'string' || typeof item.sourcePath !== 'string') {
    throw new Error('Manifest item is missing objectKey or sourcePath');
  }
  if (!/^turn4js\/flip\/[^/]+\/pages\/\d+(?:-large)?\.(?:avif|gif|jpe?g|png|webp)$/i.test(item.objectKey)) {
    throw new Error(`Manifest objectKey is outside the flip image schema: ${item.objectKey}`);
  }
  if (assetsByKey.has(item.objectKey)) throw new Error(`Duplicate manifest objectKey: ${item.objectKey}`);
  assetsByKey.set(item.objectKey, item);
  const requestAlias = item.objectKey.replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, '.jpg');
  if (!assetsByKey.has(requestAlias)) assetsByKey.set(requestAlias, item);
}

function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeObjectKey(objectKey) {
  return objectKey.split('/').map(encodeSegment).join('/');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function signingKey(secret, date) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

function signedRequest(method, objectKey, requestHeaders) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const host = endpoint.host;
  const canonicalUri = `${endpoint.pathname.replace(/\/$/, '')}/${encodeSegment(bucket)}/${encodeObjectKey(objectKey)}`;
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${emptyPayloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join('\n');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    `${canonicalHeaders}\n`,
    signedHeaders,
    emptyPayloadHash,
  ].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signature = hmac(signingKey(secretAccessKey, date), stringToSign, 'hex');
  return {
    path: canonicalUri,
    headers: {
      host,
      'x-amz-content-sha256': emptyPayloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...requestHeaders,
    },
  };
}

function sendError(response, statusCode, message) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(`${message}\n`);
}

function forwardImage(request, response, item) {
  const requestHeaders = {};
  for (const headerName of ['range', 'if-none-match', 'if-modified-since', 'if-range']) {
    const value = request.headers[headerName];
    if (value) requestHeaders[headerName] = value;
  }
  const signed = signedRequest(request.method, item.objectKey, requestHeaders);
  const upstream = https.request(
    {
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      method: request.method,
      path: signed.path,
      headers: signed.headers,
    },
    (upstreamResponse) => {
      const statusCode = upstreamResponse.statusCode || 502;
      const responseHeaders = {
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-type': item.mime || 'application/octet-stream',
      };
      for (const headerName of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstreamResponse.headers[headerName];
        if (value !== undefined) responseHeaders[headerName] = value;
      }
      if (statusCode >= 400 && statusCode !== 416) {
        upstreamResponse.resume();
        sendError(response, statusCode === 403 ? 502 : statusCode, 'Image object unavailable');
        return;
      }
      response.writeHead(statusCode, responseHeaders);
      if (request.method === 'HEAD' || statusCode === 304) {
        upstreamResponse.resume();
        response.end();
        return;
      }
      upstreamResponse.pipe(response);
    }
  );
  upstream.on('error', () => {
    if (!response.headersSent) sendError(response, 502, 'Image service unavailable');
    else response.destroy();
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {
    if (!response.writableFinished) upstream.destroy();
  });
  upstream.end();
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendError(response, 405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  } catch {
    sendError(response, 400, 'Invalid request');
    return;
  }
  if (!pathname.startsWith(routePrefix)) {
    sendError(response, 404, 'Not found');
    return;
  }
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice(routePrefix.length));
  } catch {
    sendError(response, 400, 'Invalid image path');
    return;
  }
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    sendError(response, 400, 'Invalid image path');
    return;
  }
  const objectKey = `turn4js/flip/${relativePath}`;
  const item = assetsByKey.get(objectKey);
  if (!item) {
    sendError(response, 404, 'Image object not found');
    return;
  }
  forwardImage(request, response, item);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`R2 flip image gateway listening on 127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
