'use strict';

const { Markup } = require('telegraf');

const MENU_BUTTONS = Object.freeze({
  CREATE_ANNOUNCEMENT: 'إنشاء إعلان جديد',
  PREVIEW_TEMPLATE: 'معاينة القالب',
  HOW_TO_USE: 'طريقة الاستخدام',
  BOT_INFO: 'معلومات البوت',
});

const CALLBACK_ACTIONS = Object.freeze({
  NEW_ANNOUNCEMENT: 'wasl:new_announcement',
  REGENERATE_IMAGE: 'wasl:regenerate_image',
  BACK_TO_MAIN_MENU: 'wasl:back_to_menu',
});

/**
 * Main persistent Arabic reply keyboard.
 */
function getMainMenuKeyboard() {
  return Markup.keyboard([
    [MENU_BUTTONS.CREATE_ANNOUNCEMENT, MENU_BUTTONS.PREVIEW_TEMPLATE],
    [MENU_BUTTONS.HOW_TO_USE, MENU_BUTTONS.BOT_INFO],
  ]).resize();
}

/**
 * Inline keyboard shown under every generated announcement image.
 */
function getPostGenerationInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('إنشاء إعلان آخر', CALLBACK_ACTIONS.NEW_ANNOUNCEMENT)],
    [Markup.button.callback('إعادة إنشاء الصورة', CALLBACK_ACTIONS.REGENERATE_IMAGE)],
    [Markup.button.callback('العودة للقائمة الرئيسية', CALLBACK_ACTIONS.BACK_TO_MAIN_MENU)],
  ]);
}

module.exports = {
  MENU_BUTTONS,
  CALLBACK_ACTIONS,
  getMainMenuKeyboard,
  getPostGenerationInlineKeyboard,
};
