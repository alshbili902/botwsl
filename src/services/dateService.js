'use strict';

const { DateTime } = require('luxon');
const umalquraRaw = require('@umalqura/core');
const { DateConversionError } = require('../utils/errors');

const umalqura = umalquraRaw.default || umalquraRaw;

const DEFAULT_TIMEZONE = 'Asia/Riyadh';
const DEFAULT_LOCALE = 'ar-SA';

/**
 * Convert Eastern Arabic digits (٠-٩) to Western Arabic numerals (0-9)
 * so numerals match the WASL template style consistently.
 */
function toWesternDigits(str) {
  return String(str).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * Compute consistent Saudi weekday, Gregorian date, Umm al-Qura Hijri date,
 * and 12-hour local time for a single exact moment in `Asia/Riyadh`.
 *
 * @param {object} [options]
 * @param {Date|number|string} [options.now] - Optional instant (defaults to current moment)
 * @param {string} [options.timezone='Asia/Riyadh']
 * @param {string} [options.locale='ar-SA']
 */
function getSaudiDateTime(options = {}) {
  const timezone = options.timezone || process.env.TIMEZONE || DEFAULT_TIMEZONE;
  const locale = options.locale || process.env.LOCALE || DEFAULT_LOCALE;
  const rawInput = options.now !== undefined ? options.now : new Date();

  try {
    let baseDt;
    if (rawInput instanceof Date) {
      baseDt = DateTime.fromJSDate(rawInput, { zone: timezone });
    } else if (typeof rawInput === 'number') {
      baseDt = DateTime.fromMillis(rawInput, { zone: timezone });
    } else if (typeof rawInput === 'string') {
      baseDt = DateTime.fromISO(rawInput, { zone: timezone });
    } else {
      throw new Error('Unsupported date input type');
    }

    if (!baseDt.isValid) {
      throw new Error(`Invalid Luxon DateTime: ${baseDt.invalidReason || 'unknown'}`);
    }

    const gregDt = baseDt.reconfigure({
      locale,
      outputCalendar: 'gregory',
      numberingSystem: 'latn',
    });

    const dayName = gregDt.toFormat('EEEE').trim();
    const gregorianDate = toWesternDigits(gregDt.toFormat('d MMMM yyyy')).trim();

    // Construct a local-noon Date using the exact wall-clock (year, month, day) in Asia/Riyadh
    // so Umm al-Qura conversion is 100% immune to the host OS timezone (e.g. UTC on AWS Ubuntu)
    // even at 00:00:01 Asia/Riyadh (21:00:01 UTC previous day).
    let hijriDate;
    try {
      const wallDate = new Date(baseDt.year, baseDt.month - 1, baseDt.day, 12, 0, 0);
      const uq = umalqura(wallDate);
      if (!uq || !uq.hy || !uq.hm || !uq.hd) {
        throw new Error('Umm al-Qura returned incomplete components');
      }
      const hijriMonthName = uq.format('MMMM', 'ar').trim();
      hijriDate = `${uq.hd} ${hijriMonthName} ${uq.hy}`;
    } catch (_uqErr) {
      // Reliable ICU Umm al-Qura fallback for dates outside @umalqura/core lookup table
      const intlHijri = new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, {
        timeZone: timezone,
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
        .format(baseDt.toJSDate())
        .replace(/\s*هـ\s*$/u, '')
        .trim();
      hijriDate = toWesternDigits(intlHijri);
    }

    const hour24 = baseDt.hour;
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const timeDigits = `${String(hour12).padStart(2, '0')}:${String(baseDt.minute).padStart(2, '0')}`;
    const period = hour24 < 12 ? 'صباحاً' : 'مساءً';
    const timeFormatted = `${timeDigits} ${period}`;

    return {
      dayName,
      gregorianDate,
      hijriDate,
      timeDigits,
      period,
      timeFormatted,
      isoTimestamp: baseDt.toISO(),
      timezone,
      locale,
    };
  } catch (err) {
    throw new DateConversionError(`Failed to compute Saudi date/time: ${err.message}`, err);
  }
}

module.exports = {
  getSaudiDateTime,
  toWesternDigits,
};
