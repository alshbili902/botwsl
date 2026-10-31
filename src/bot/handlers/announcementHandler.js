'use strict';

const {
  generateAnnouncementImage,
  cleanupOutputFile,
} = require('../../services/imageRenderer');
const { prepareAnnouncementText } = require('../../services/textLayout');
const { ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const {
  MENU_BUTTONS,
  CALLBACK_ACTIONS,
  getMainMenuKeyboard,
  getPostGenerationInlineKeyboard,
} = require('../keyboards/menus');

const RESERVED_MENU_TEXTS = new Set(Object.values(MENU_BUTTONS));

/**
 * Register announcement creation, direct-text handling, inline actions,
 * and invalid message fallbacks.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {object} deps
 * @param {import('../state/userSessionStore').UserSessionStore} deps.sessionStore
 * @param {object} deps.settings
 * @param {Function} [deps.renderFn] - Optional override for testing
 */
function registerAnnouncementHandlers(bot, { sessionStore, settings, renderFn }) {
  const renderImage = renderFn || generateAnnouncementImage;

  async function processAndSendAnnouncement(ctx, textToRender) {
    const userId = ctx.from.id;
    let statusMessage = null;
    let rendered = null;

    // Fast synchronous validation before showing progress message
    prepareAnnouncementText(textToRender, {
      maxLength: settings.maxAnnouncementLength,
    });

    try {
      await ctx.sendChatAction('upload_photo').catch(() => {});
      statusMessage = await ctx
        .reply('⏳ جاري تصميم صورة الإعلان بجودة عالية...')
        .catch(() => null);

      rendered = await renderImage(textToRender, {
        maxLength: settings.maxAnnouncementLength,
      });

      sessionStore.setLastAnnouncement(userId, textToRender);

      await ctx.sendChatAction('upload_photo').catch(() => {});
      await ctx.replyWithPhoto(
        {
          source: rendered.outputPath,
          filename: `wasl-announcement-${Date.now()}.png`,
        },
        {
          caption: [
            '✅ تم إنشاء صورة الإعلان بنجاح.',
            `📅 ${rendered.dateTime.dayName} | ${rendered.dateTime.gregorianDate} – ${rendered.dateTime.hijriDate}`,
            `🕒 ${rendered.dateTime.timeFormatted}`,
          ].join('\n'),
          ...getPostGenerationInlineKeyboard(),
        }
      );
    } finally {
      if (statusMessage && ctx.chat) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, statusMessage.message_id)
          .catch(() => {});
      }
      if (rendered && rendered.outputPath) {
        await cleanupOutputFile(rendered.outputPath);
      }
    }
  }

  // Inline button: Create another announcement
  bot.action(CALLBACK_ACTIONS.NEW_ANNOUNCEMENT, async (ctx) => {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, true);
    await ctx.answerCbQuery().catch(() => {});
    await ctx.reply('✍️ تفضل بإرسال نص الإعلان الجديد الآن:', getMainMenuKeyboard());
  });

  // Inline button: Regenerate image with refreshed current Saudi date & time
  bot.action(CALLBACK_ACTIONS.REGENERATE_IMAGE, async (ctx) => {
    const session = sessionStore.get(ctx.from.id);
    if (!session.lastAnnouncementText) {
      sessionStore.setAwaitingAnnouncement(ctx.from.id, true);
      await ctx
        .answerCbQuery('لا يوجد نص سابق محفوظ، يرجى إرسال النص مجدداً.', {
          show_alert: false,
        })
        .catch(() => {});
      await ctx.reply('يرجى إرسال نص الإعلان ليتم تصميم الصورة فوراً:', getMainMenuKeyboard());
      return;
    }

    await ctx.answerCbQuery('جاري إعادة إنشاء الصورة بالوقت الحالي...').catch(() => {});
    logger.info({ userId: ctx.from.id }, 'Regenerating last announcement image');
    await processAndSendAnnouncement(ctx, session.lastAnnouncementText);
  });

  // Handle any text message (either after selecting "إنشاء إعلان جديد" OR sent directly!)
  bot.on('text', async (ctx) => {
    const incomingText = ctx.message && ctx.message.text ? ctx.message.text : '';

    // Ignore unknown slash commands gracefully
    if (incomingText.trim().startsWith('/')) {
      sessionStore.setAwaitingAnnouncement(ctx.from.id, false);
      await ctx.reply(
        'أمر غير معروف. يمكنك إرسال نص الإعلان مباشرة أو اختيار أحد الأزرار من القائمة الرئيسية.',
        getMainMenuKeyboard()
      );
      return;
    }

    if (RESERVED_MENU_TEXTS.has(incomingText.trim())) {
      return;
    }

    await processAndSendAnnouncement(ctx, incomingText);
  });

  // Handle non-text messages (photos, voice notes, stickers, files) gracefully
  bot.on('message', async (ctx) => {
    throw new ValidationError(
      `Unsupported non-text message received from userId=${ctx.from.id}`,
      'عذراً، يدعم البوت الرسائل النصية فقط.\nيرجى كتابة نص الإعلان وإرساله كرسالة نصية ليتم وضعه داخل قالب وصل الرسمي.'
    );
  });
}

module.exports = {
  registerAnnouncementHandlers,
};
