'use strict';

const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');
const { getMainMenuKeyboard } = require('../keyboards/menus');

/**
 * Convert technical or application errors into safe Arabic user responses
 * while logging full technical diagnostics separately.
 */
async function handleBotError(err, ctx) {
  const userId = ctx && ctx.from ? ctx.from.id : null;

  if (err instanceof AppError) {
    logger.warn(
      {
        err,
        code: err.code,
        userId,
        updateType: ctx ? ctx.updateType : null,
      },
      'Handled application error during Telegram update'
    );
  } else {
    logger.error(
      {
        err,
        userId,
        updateType: ctx ? ctx.updateType : null,
      },
      'Unhandled error during Telegram update'
    );
  }

  if (!ctx) return;

  if (ctx.callbackQuery) {
    await ctx.answerCbQuery().catch(() => {});
  }

  const arabicMessage =
    err instanceof AppError && err.userMessage
      ? err.userMessage
      : 'عذراً، حدث خطأ غير متوقع أثناء تنفيذ العملية. يرجى المحاولة مرة أخرى بعد قليل.';

  if (ctx.chat) {
    await ctx
      .reply(arabicMessage, getMainMenuKeyboard())
      .catch((replyErr) => {
        logger.error({ err: replyErr, userId }, 'Failed to send error message to Telegram user');
      });
  }
}

/**
 * Middleware wrapper to ensure async handler exceptions are caught cleanly.
 */
function createErrorMiddleware() {
  return async function errorMiddleware(ctx, next) {
    try {
      await next();
    } catch (err) {
      await handleBotError(err, ctx);
    }
  };
}

module.exports = {
  handleBotError,
  createErrorMiddleware,
};
