'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const { Telegram, TelegramError } = require('telegraf');
const logger = require('./logger');

const CRLF = '\r\n';
const FORM_DATA_JSON_FIELDS = new Set([
  'results',
  'reply_markup',
  'mask_position',
  'shipping_options',
  'errors',
]);

const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
});

let isPatched = false;

const ipv4KeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  family: 4,
});

const ipv4FreshAgent = new https.Agent({
  keepAlive: false,
  family: 4,
});

function isMediaObject(val) {
  return (
    val !== null &&
    typeof val === 'object' &&
    !Buffer.isBuffer(val) &&
    (('source' in val && Boolean(val.source)) || ('url' in val && Boolean(val.url)))
  );
}

function payloadHasMedia(payload) {
  if (!payload || typeof payload !== 'object') return false;
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'link_preview_options' || value == null) continue;
    if (isMediaObject(value)) return true;
    if (Array.isArray(value) && value.some((item) => item && isMediaObject(item.media))) {
      return true;
    }
  }
  return false;
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function resolveMediaBuffer(media, fieldName) {
  let fileName = media.filename || `${fieldName}.png`;

  if (Buffer.isBuffer(media.source)) {
    return { buffer: media.source, fileName };
  }

  if (typeof media.source === 'string') {
    const resolvedPath = await fsp.realpath(media.source);
    fileName = media.filename || path.basename(resolvedPath);
    const buffer = await fsp.readFile(resolvedPath);
    return { buffer, fileName };
  }

  if (media.source && typeof media.source.pipe === 'function') {
    const buffer = await streamToBuffer(media.source);
    return { buffer, fileName };
  }

  throw new TypeError(`Unsupported media source for field "${fieldName}"`);
}

/**
 * Build a complete RFC 7578 multipart/form-data payload in memory as a single Buffer
 * with an exact Content-Length. Avoids Telegraf's legacy `sandwich-stream` which stalls
 * on Node.js 24+/26+.
 */
async function buildMultipartBuffer(payload) {
  const boundary = `----WaslBotBoundary${crypto.randomBytes(20).toString('hex')}`;
  const chunks = [];

  function pushTextPart(name, value) {
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}`;
    chunks.push(Buffer.from(header, 'utf8'));
    chunks.push(Buffer.from(String(value), 'utf8'));
    chunks.push(Buffer.from(CRLF, 'utf8'));
  }

  function pushBinaryPart(name, fileName, contentType, binaryBuffer) {
    const safeName = String(fileName).replace(/["\r\n]/g, '_');
    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"; filename="${safeName}"${CRLF}` +
      `Content-Type: ${contentType}${CRLF}${CRLF}`;
    chunks.push(Buffer.from(header, 'utf8'));
    chunks.push(binaryBuffer);
    chunks.push(Buffer.from(CRLF, 'utf8'));
  }

  for (const [key, rawVal] of Object.entries(payload)) {
    if (rawVal === undefined || rawVal === null) continue;

    let val = rawVal;
    if (FORM_DATA_JSON_FIELDS.has(key) && typeof val !== 'string') {
      val = JSON.stringify(val);
    }

    if (typeof val === 'string' || typeof val === 'boolean' || typeof val === 'number') {
      pushTextPart(key, val);
      continue;
    }

    if (isMediaObject(val) && val.source) {
      const { buffer, fileName } = await resolveMediaBuffer(val, key);
      const ext = path.extname(fileName).toLowerCase();
      const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
      pushBinaryPart(key, fileName, mime, buffer);
      continue;
    }

    // Fallback for any other structured object field
    pushTextPart(key, JSON.stringify(val));
  }

  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));
  const body = Buffer.concat(chunks);

  return {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
      connection: 'keep-alive',
    },
  };
}

function redactBotToken(err) {
  if (err && typeof err.message === 'string') {
    err.message = err.message.replace(/\/(bot|user)(\d+):[^/]+\//g, '/$1$2:[REDACTED]/');
  }
  if (err && typeof err.stack === 'string') {
    err.stack = err.stack.replace(/\/(bot|user)(\d+):[^/]+\//g, '/$1$2:[REDACTED]/');
  }
  return err;
}

function isTransientNetworkError(err) {
  if (!err) return false;
  const transientCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENETUNREACH',
  ]);
  if (err.code && transientCodes.has(err.code)) return true;
  if (typeof err.message === 'string' && /socket hang up|network timeout|ECONNRESET/i.test(err.message)) {
    return true;
  }
  return false;
}

function postBufferHttps(apiUrl, headers, body, agent, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      apiUrl,
      {
        method: 'POST',
        headers,
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        const resChunks = [];
        res.on('data', (chunk) => resChunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            rawText: Buffer.concat(resChunks).toString('utf8'),
          });
        });
      }
    );

    req.on('timeout', () => {
      const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      req.destroy(timeoutErr);
    });

    req.on('error', reject);
    req.end(body);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Patch Telegraf's ApiClient.prototype.callApi once so all multipart uploads use
 * contiguous Buffers with exact Content-Length, IPv4 routing, and automatic retry.
 */
function applyTelegramNetworkFixes() {
  if (isPatched) return;
  isPatched = true;

  const apiClientProto = Object.getPrototypeOf(Telegram.prototype);
  const originalCallApi = apiClientProto.callApi;

  apiClientProto.callApi = async function patchedCallApi(method, payload = {}, callOpts = {}) {
    // Ensure IPv4 agent is used on default Telegram client options
    if (this.options && this.options.apiRoot === 'https://api.telegram.org') {
      this.options.agent = ipv4KeepAliveAgent;
    }

    if (!payloadHasMedia(payload)) {
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          if (attempt > 1 && this.options) {
            this.options.agent = ipv4FreshAgent;
          }
          return await originalCallApi.call(this, method, payload, callOpts);
        } catch (err) {
          lastErr = redactBotToken(err);
          if (!isTransientNetworkError(err) || attempt === 3) {
            throw lastErr;
          }
          logger.warn({ method, attempt, code: err.code }, 'Retrying transient Telegram API error');
          await sleep(350 * attempt);
        }
      }
      throw lastErr;
    }

    // Media upload path: Buffer-based multipart with exact Content-Length & retry
    const { token, options } = this;
    if (!token) {
      throw new TelegramError({ error_code: 401, description: 'Bot Token is required' });
    }

    const { body, headers } = await buildMultipartBuffer({ method, ...payload });
    const apiUrl = new URL(
      `./${options.apiMode}${token}${options.testEnv ? '/test' : ''}/${method}`,
      options.apiRoot
    );

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await postBufferHttps(
          apiUrl,
          headers,
          body,
          attempt === 1 ? ipv4KeepAliveAgent : ipv4FreshAgent,
          60000
        );

        if (res.status >= 500) {
          if (attempt < 3) {
            logger.warn({ method, status: res.status, attempt }, 'Retrying Telegram 5xx media upload');
            await sleep(500 * attempt);
            continue;
          }
          throw new TelegramError(
            { error_code: res.status, description: res.statusText },
            { method, payload }
          );
        }

        const data = JSON.parse(res.rawText);
        if (!data.ok) {
          throw new TelegramError(data, { method, payload });
        }
        return data.result;
      } catch (err) {
        lastErr = redactBotToken(err);
        if (!isTransientNetworkError(err) || attempt === 3) {
          throw lastErr;
        }
        logger.warn(
          { method, attempt, code: err.code },
          'Transient network reset during media upload; retrying with fresh socket'
        );
        await sleep(500 * attempt);
      }
    }

    throw lastErr;
  };
}

module.exports = {
  applyTelegramNetworkFixes,
  buildMultipartBuffer,
  ipv4KeepAliveAgent,
};
