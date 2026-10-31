'use strict';

class AppError extends Error {
  /**
   * @param {string} message - Internal technical message for logs
   * @param {object} options
   * @param {string} options.code - Machine-readable error code
   * @param {string} options.userMessage - Safe Arabic message for the Telegram user
   * @param {Error} [options.cause] - Underlying error cause
   */
  constructor(message, { code = 'APP_ERROR', userMessage, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.userMessage =
      userMessage ||
      'عذراً، حدث خطأ غير متوقع أثناء معالجة طلبك. يرجى المحاولة مرة أخرى بعد قليل.';
  }
}

class ValidationError extends AppError {
  constructor(message, userMessage) {
    super(message, {
      code: 'VALIDATION_ERROR',
      userMessage:
        userMessage || 'النص المرسل غير صالح. يرجى إرسال نص إعلان واضح والمحاولة مرة أخرى.',
    });
  }
}

class TextOverflowError extends AppError {
  constructor(message, userMessage) {
    super(message, {
      code: 'TEXT_OVERFLOW_ERROR',
      userMessage:
        userMessage ||
        'النص طويل جداً ولا يمكن احتواؤه داخل مساحة الإعلان بشكل واضح ومقروء.\n\nيرجى اختصار النص أو تقليل عدد الأسطر ثم المحاولة مرة أخرى.',
    });
  }
}

class TemplateAssetError extends AppError {
  constructor(message, userMessage, cause) {
    super(message, {
      code: 'TEMPLATE_ASSET_ERROR',
      userMessage:
        userMessage ||
        'عذراً، تعذر الوصول إلى ملفات القالب أو الخطوط الرسمية في الخادم. يرجى مراجعة مسؤول النظام.',
      cause,
    });
  }
}

class DateConversionError extends AppError {
  constructor(message, cause) {
    super(message, {
      code: 'DATE_CONVERSION_ERROR',
      userMessage: 'عذراً، حدث خطأ أثناء احتساب التاريخ الهجري والميلادي بتوقيت الرياض.',
      cause,
    });
  }
}

class RenderError extends AppError {
  constructor(message, cause, userMessage) {
    super(message, {
      code: 'RENDER_ERROR',
      userMessage:
        userMessage ||
        'عذراً، تعذر إنشاء صورة الإعلان حالياً. يرجى المحاولة مجدداً خلال لحظات.',
      cause,
    });
  }
}

class AuthorizationError extends AppError {
  constructor(userId) {
    super(`Unauthorized Telegram access attempt by userId=${userId}`, {
      code: 'UNAUTHORIZED_ACCESS',
      userMessage:
        'مرحباً بك في بوت وصل للخدمات الإلكترونية (WASL).\nعذراً، هذا البوت مخصص للاستخدام الخاص والمصرح به فقط.',
    });
  }
}

module.exports = {
  AppError,
  ValidationError,
  TextOverflowError,
  TemplateAssetError,
  DateConversionError,
  RenderError,
  AuthorizationError,
};
