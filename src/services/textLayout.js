'use strict';

const templateConfig = require('../config/template');
const { ValidationError } = require('../utils/errors');

/**
 * Escape HTML special characters so user text cannot inject markup into the renderer DOM.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Clean, validate, and structure raw user announcement text.
 *
 * @param {string} rawText
 * @param {object} [options]
 * @param {number} [options.maxLength=1200]
 */
function prepareAnnouncementText(rawText, options = {}) {
  const maxLength = Number(options.maxLength || process.env.MAX_ANNOUNCEMENT_LENGTH || 1200);

  if (typeof rawText !== 'string') {
    throw new ValidationError(
      'Announcement input is not a string',
      'عذراً، يرجى إرسال نص الإعلان كرسالة نصية فقط.'
    );
  }

  // Normalize line breaks and strip unsafe control characters (keep \n and \t)
  const normalized = rawText
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    throw new ValidationError(
      'Empty announcement text after normalization',
      'النص المرسل فارغ. يرجى كتابة نص الإعلان وإرساله ليتم تصميمه فوراً.'
    );
  }

  // Count visible characters (excluding newlines)
  const charCount = [...normalized].length;
  if (charCount > maxLength) {
    throw new ValidationError(
      `Announcement length (${charCount}) exceeds maxLength (${maxLength})`,
      `النص المرسل طويل جداً (${charCount} حرفاً).\nالحد الأقصى المسموح به هو ${maxLength} حرفاً لضمان وضوح الخط وجودة التصميم.\n\nيرجى اختصار النص والمحاولة مرة أخرى.`
    );
  }

  // Split into paragraphs separated by blank lines (\n\n), keeping single \n inside paragraphs
  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    )
    .filter((lines) => lines.length > 0);

  const totalLines = rawParagraphs.reduce((sum, lines) => sum + lines.length, 0);
  const typo = templateConfig.panels.announcement.typography;

  // Choose base font weight dynamically based on announcement density:
  // - Short announcements: Bold (700)
  // - Standard announcements: Medium (500)
  // - Dense/long announcements: Regular (400) for crisp legibility at smaller sizes
  let bodyWeight = typo.preferredWeights.defaultWeight; // 500
  if (charCount <= typo.preferredWeights.shortThresholdChars && totalLines <= 3) {
    bodyWeight = typo.preferredWeights.shortWeight; // 700
  } else if (charCount > 360 || totalLines > 6) {
    bodyWeight = 400; // Tajawal Regular
  }

  // Detect optional short opening headline when multiple paragraphs/lines exist
  const hasDistinctHeadline =
    rawParagraphs.length >= 2 &&
    rawParagraphs[0].length === 1 &&
    [...rawParagraphs[0][0]].length <= 55;

  const paragraphsHtml = rawParagraphs
    .map((lines, idx) => {
      const cls = idx === 0 && hasDistinctHeadline ? 'para para-headline' : 'para';
      const inner = lines.map((line) => escapeHtml(line)).join('<br>');
      return `<p class="${cls}" dir="rtl">${inner}</p>`;
    })
    .join('');

  return {
    normalizedText: normalized,
    charCount,
    paragraphCount: rawParagraphs.length,
    lineCount: totalLines,
    bodyWeight,
    hasDistinctHeadline,
    paragraphsHtml,
  };
}

module.exports = {
  escapeHtml,
  prepareAnnouncementText,
};
