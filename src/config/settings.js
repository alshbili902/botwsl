'use strict';

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

/**
 * Parse comma-separated Telegram numeric user IDs into an immutable Set<number>.
 *
 * @param {string} rawIds
 * @returns {Set<number>}
 */
function parseAuthorizedUserIds(rawIds) {
  if (!rawIds || typeof rawIds !== 'string') {
    return new Set();
  }

  const ids = new Set();
  const parts = rawIds
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(
        `Invalid Telegram User ID "${part}" in AUTHORIZED_USER_IDS. Expected numeric IDs separated by commas.`
      );
    }
    const numericId = Number(part);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new Error(`Out-of-range Telegram User ID "${part}" in AUTHORIZED_USER_IDS.`);
    }
    ids.add(numericId);
  }

  return ids;
}

/**
 * Validate timezone identifier via Intl.DateTimeFormat.
 */
function validateTimezone(tz) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (_err) {
    throw new Error(`Invalid TIMEZONE "${tz}". Expected a valid IANA timezone such as Asia/Riyadh.`);
  }
}

/**
 * Load and validate application configuration from environment variables.
 *
 * @param {object} [envOverride] - Optional env object for unit testing
 * @param {object} [options]
 * @param {boolean} [options.requireBotSecrets=true] - Enforce BOT_TOKEN and AUTHORIZED_USER_IDS
 */
function loadSettings(envOverride = process.env, { requireBotSecrets = true } = {}) {
  const botToken = (envOverride.BOT_TOKEN || '').trim();
  const authorizedUserIds = parseAuthorizedUserIds(envOverride.AUTHORIZED_USER_IDS || '');
  const timezone = validateTimezone((envOverride.TIMEZONE || 'Asia/Riyadh').trim());
  const locale = (envOverride.LOCALE || 'ar-SA').trim();

  const rawMaxLen = envOverride.MAX_ANNOUNCEMENT_LENGTH
    ? Number(envOverride.MAX_ANNOUNCEMENT_LENGTH)
    : 1200;

  if (!Number.isInteger(rawMaxLen) || rawMaxLen < 20 || rawMaxLen > 5000) {
    throw new Error(
      `Invalid MAX_ANNOUNCEMENT_LENGTH "${envOverride.MAX_ANNOUNCEMENT_LENGTH}". Must be an integer between 20 and 5000.`
    );
  }

  if (requireBotSecrets) {
    if (!botToken) {
      throw new Error(
        'Missing required environment variable BOT_TOKEN. Please configure it in your .env file.'
      );
    }
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
      throw new Error(
        'Invalid BOT_TOKEN format. Expected a valid Telegram BotFather token.'
      );
    }
    if (authorizedUserIds.size === 0) {
      throw new Error(
        'Missing or empty AUTHORIZED_USER_IDS. At least one numeric Telegram user ID is required for private access.'
      );
    }
  }

  return Object.freeze({
    botToken,
    authorizedUserIds,
    timezone,
    locale,
    maxAnnouncementLength: rawMaxLen,
    logLevel: (envOverride.LOG_LEVEL || 'info').trim(),
    nodeEnv: (envOverride.NODE_ENV || 'production').trim(),
  });
}

module.exports = {
  loadSettings,
  parseAuthorizedUserIds,
  validateTimezone,
};
