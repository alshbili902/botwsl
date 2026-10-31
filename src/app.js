'use strict';

const { loadSettings } = require('./config/settings');
const { loadAndVerifyAssets, shutdownRenderer } = require('./services/imageRenderer');
const { inspectTemplate } = require('./services/templateInspector');
const { createBot } = require('./bot/createBot');
const logger = require('./utils/logger');

let activeBot = null;
let isShuttingDown = false;

async function bootstrap() {
  logger.info('Starting WASL Telegram Announcement Generator Bot...');

  // 1. Validate required environment variables on startup
  const settings = loadSettings();
  logger.info(
    {
      timezone: settings.timezone,
      locale: settings.locale,
      authorizedUsersCount: settings.authorizedUserIds.size,
      maxAnnouncementLength: settings.maxAnnouncementLength,
    },
    'Environment configuration validated'
  );

  // 2. Verify permanent WASL template integrity, dimensions, and local Tajawal fonts
  await loadAndVerifyAssets();
  const inspection = await inspectTemplate();
  if (!inspection.isValid) {
    throw new Error(
      `Template safety verification failed: ${JSON.stringify(inspection.overlaps)}`
    );
  }
  logger.info(
    {
      width: inspection.width,
      height: inspection.height,
      sha256: inspection.sha256,
    },
    'Official WASL template and Tajawal fonts verified'
  );

  // 3. Initialize and launch Telegram bot using Long Polling (no webhook/domain required)
  const { bot } = createBot(settings);
  activeBot = bot;

  await bot.launch(
    {
      dropPendingUpdates: false,
    },
    () => {
      logger.info(
        {
          botUsername: bot.botInfo ? bot.botInfo.username : undefined,
          botId: bot.botInfo ? bot.botInfo.id : undefined,
        },
        'WASL Telegram Bot is online and listening via long polling'
      );
    }
  );
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Initiating graceful shutdown...');

  try {
    if (activeBot) {
      activeBot.stop(signal);
    }
  } catch (err) {
    logger.warn({ err }, 'Error while stopping Telegram bot');
  }

  try {
    await shutdownRenderer();
  } catch (err) {
    logger.warn({ err }, 'Error while closing headless Chromium renderer');
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
});

if (require.main === module) {
  bootstrap().catch(async (err) => {
    logger.error({ err }, 'Fatal startup failure');
    await shutdownRenderer().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  bootstrap,
};
