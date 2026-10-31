'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const templateConfig = require('../../config/template');
const { getSaudiDateTime } = require('../../services/dateService');
const { TemplateAssetError } = require('../../utils/errors');
const {
  MENU_BUTTONS,
  CALLBACK_ACTIONS,
  getMainMenuKeyboard,
} = require('../keyboards/menus');

/**
 * Register main menu commands, reply keyboard handlers, and template preview.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {object} deps
 * @param {import('../state/userSessionStore').UserSessionStore} deps.sessionStore
 * @param {object} deps.settings
 */
function registerMenuHandlers(bot, { sessionStore, settings }) {
  async function sendWelcomeMenu(ctx) {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, false);
    const welcomeText = [
      'أهلاً بك في البوت الرسمي لـ *وصل للخدمات الإلكترونية – WASL* ✨',
      '',
      'أرسل نص الإعلان أو الخبر مباشرة في أي وقت، أو اختر من القائمة أدناه لتصميم صورة الإعلان الرسمية جاهزة للنشر على حالة واتساب ومنصات التواصل الاجتماعي.',
    ].join('\n');

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(),
    });
  }

  bot.start(sendWelcomeMenu);

  bot.hears(MENU_BUTTONS.CREATE_ANNOUNCEMENT, async (ctx) => {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, true);
    await ctx.reply(
      [
        '✍️ *يرجى إرسال نص الإعلان الآن:*',
        '',
        '• يمكنك كتابة سطر واحد أو عدة فقرات.',
        '• يدعم البوت النصوص العربية مع الكلمات الإنجليزية والأرقام.',
        `• الحد الأقصى للنص: ${settings.maxAnnouncementLength} حرف.`,
      ].join('\n'),
      {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard(),
      }
    );
  });

  bot.hears(MENU_BUTTONS.PREVIEW_TEMPLATE, async (ctx) => {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, false);

    try {
      await fsp.access(templateConfig.assetPath, fs.constants.R_OK);
    } catch (err) {
      throw new TemplateAssetError(
        `Template preview file inaccessible: ${templateConfig.assetPath}`,
        'عذراً، تعذر العثور على القالب الرسمي على الخادم.',
        err
      );
    }

    await ctx.sendChatAction('upload_photo').catch(() => {});
    await ctx.replyWithPhoto(
      { source: templateConfig.assetPath, filename: 'wasl-official-template.jpeg' },
      {
        caption: '🖼️ القالب الرسمي المعتمد لـ وصل للخدمات الإلكترونية (بدون أي تعديل).',
        ...getMainMenuKeyboard(),
      }
    );
  });

  bot.hears(MENU_BUTTONS.HOW_TO_USE, async (ctx) => {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, false);
    const guideText = [
      '📖 *طريقة استخدام بوت وصل للإعلانات:*',
      '',
      '1️⃣ *الإرسال المباشر:* أرسل نص الإعلان مباشرة في المحادثة في أي وقت دون الحاجة للدخول إلى القوائم.',
      '2️⃣ *من القائمة:* اضغط على *"إنشاء إعلان جديد"* ثم أرسل النص.',
      '3️⃣ *الضبط التلقائي:* يقوم البوت تلقائياً بضبط حجم الخط وتوسيط النص داخل اللوحة الزجاجية الرئيسية، وإضافة اليوم والتاريخ الميلادي والهجري والوقت الحالي بتوقيت الرياض.',
      '4️⃣ *إعادة الإنشاء:* بعد استلام الصورة، يمكنك الضغط على *"إعادة إنشاء الصورة"* لتوليد نسخة جديدة بتوقيت اللحظة الحالية.',
    ].join('\n');

    await ctx.reply(guideText, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(),
    });
  });

  bot.hears(MENU_BUTTONS.BOT_INFO, async (ctx) => {
    sessionStore.setAwaitingAnnouncement(ctx.from.id, false);
    const nowInfo = getSaudiDateTime({
      timezone: settings.timezone,
      locale: settings.locale,
    });

    const infoText = [
      'ℹ️ *معلومات البوت:*',
      '',
      '• *العلامة التجارية:* وصل للخدمات الإلكترونية – WASL',
      '• *الوظيفة:* توليد صور الإعلانات والأخبار الرسمية بجودة عالية (PNG)',
      `• *أبعاد القالب الأصلية:* ${templateConfig.dimensions.width}×${templateConfig.dimensions.height} بكسل`,
      '• *الخط المعتمد:* Tajawal (Regular / Medium / Bold)',
      `• *المنطقة الزمنية:* ${settings.timezone}`,
      `• *التاريخ الحالي:* ${nowInfo.dayName} – ${nowInfo.gregorianDate} | ${nowInfo.hijriDate}`,
      `• *الوقت الحالي:* ${nowInfo.timeFormatted}`,
      `• *الحد الأقصى لطول الإعلان:* ${settings.maxAnnouncementLength} حرف`,
    ].join('\n');

    await ctx.reply(infoText, {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard(),
    });
  });

  bot.action(CALLBACK_ACTIONS.BACK_TO_MAIN_MENU, async (ctx) => {
    await ctx.answerCbQuery('تمت العودة للقائمة الرئيسية').catch(() => {});
    await sendWelcomeMenu(ctx);
  });
}

module.exports = {
  registerMenuHandlers,
};
