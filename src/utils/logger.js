'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const appLogStream = pino.destination({
  dest: path.join(LOG_DIR, 'app.log'),
  mkdir: true,
  sync: false,
});

const errorLogStream = pino.destination({
  dest: path.join(LOG_DIR, 'error.log'),
  mkdir: true,
  sync: false,
});

const streams = [
  { stream: process.stdout, level: process.env.LOG_LEVEL || 'info' },
  { stream: appLogStream, level: process.env.LOG_LEVEL || 'info' },
  { stream: errorLogStream, level: 'error' },
];

/**
 * Redact any accidental token/secret appearances in structured objects or URLs.
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  let cleaned = value.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot[REDACTED_TOKEN]');
  if (process.env.BOT_TOKEN && process.env.BOT_TOKEN.length > 8) {
    cleaned = cleaned.split(process.env.BOT_TOKEN).join('[REDACTED_TOKEN]');
  }
  return cleaned;
}

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'botToken',
        'token',
        'BOT_TOKEN',
        'headers.authorization',
        'err.config.headers',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level(label) {
        return { level: label };
      },
      log(obj) {
        const out = { ...obj };
        if (out.err && out.err instanceof Error) {
          out.err = {
            type: out.err.name,
            code: out.err.code,
            message: sanitizeString(out.err.message),
            stack: sanitizeString(out.err.stack),
          };
        }
        if (typeof out.msg === 'string') {
          out.msg = sanitizeString(out.msg);
        }
        return out;
      },
    },
  },
  pino.multistream(streams)
);

module.exports = logger;
