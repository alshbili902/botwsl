'use strict';

const logger = require('../../utils/logger');
const { AuthorizationError } = require('../../utils/errors');

/**
 * Telegram User ID Authorization Middleware.
 * Grants access exclusively to user IDs listed in AUTHORIZED_USER_IDS.
 *
 * @param {Set<number>} authorizedUserIds
 */
function createAuthMiddleware(authorizedUserIds) {
  return async function authMiddleware(ctx, next) {
    const userId = ctx.from && Number(ctx.from.id);

    if (!userId || !authorizedUserIds.has(userId)) {
      const authErr = new AuthorizationError(userId || 'unknown');
      logger.warn(
        {
          userId: userId || null,
          username: (ctx.from && ctx.from.username) || null,
          updateType: ctx.updateType,
        },
        'Blocked unauthorized Telegram access attempt'
      );

      if (ctx.callbackQuery) {
        await ctx
          .answerCbQuery('عذراً، هذا البوت خاص وغير مصرح لك باستخدامه.', { show_alert: true })
          .catch(() => {});
        return;
      }

      if (ctx.chat) {
        await ctx.reply(authErr.userMessage).catch((err) => {
          logger.error({ err, userId }, 'Failed to send unauthorized notice');
        });
      }
      return;
    }

    return next();
  };
}

module.exports = {
  createAuthMiddleware,
};
