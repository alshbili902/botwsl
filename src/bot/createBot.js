'use strict';

const { Telegraf } = require('telegraf');
const {
  applyTelegramNetworkFixes,
  ipv4KeepAliveAgent,
} = require('../utils/telegramMediaFix');
const { UserSessionStore } = require('./state/userSessionStore');
const { createAuthMiddleware } = require('./middleware/auth');
const { createErrorMiddleware, handleBotError } = require('./middleware/errorMiddleware');
const { registerMenuHandlers } = require('./handlers/menuHandler');
const { registerAnnouncementHandlers } = require('./handlers/announcementHandler');

/**
 * Create and wire the WASL Telegraf bot instance.
 *
 * @param {object} settings - Validated settings from loadSettings()
 * @param {object} [options]
 * @param {Function} [options.renderFn] - Optional custom renderer for tests
 * @param {object} [options.telegrafOptions] - Optional Telegraf constructor options
 */
function createBot(settings, options = {}) {
  applyTelegramNetworkFixes();

  const bot = new Telegraf(settings.botToken, {
    telegram: {
      agent: ipv4KeepAliveAgent,
    },
    ...options.telegrafOptions,
  });
  const sessionStore = new UserSessionStore();

  // 1. Error safety boundary around the entire middleware chain
  bot.use(createErrorMiddleware());

  // 2. Private Telegram User ID authorization gate
  bot.use(createAuthMiddleware(settings.authorizedUserIds));

  // 3. Menu & command handlers (/start, preview, usage, info)
  registerMenuHandlers(bot, { sessionStore, settings });

  // 4. Announcement creation, direct text, inline actions, and invalid message fallback
  registerAnnouncementHandlers(bot, {
    sessionStore,
    settings,
    renderFn: options.renderFn,
  });

  // 5. Global Telegraf catch safety net
  bot.catch((err, ctx) => handleBotError(err, ctx));

  return { bot, sessionStore };
}

module.exports = {
  createBot,
};
