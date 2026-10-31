'use strict';

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Official WASL Template Configuration
 *
 * All coordinates and dimensions in this file were measured pixel-by-pixel
 * directly from the permanent template asset (`IMG_8500.jpeg` -> `wasl-template.jpeg`).
 *
 * Original Dimensions: 571px × 1024px
 */
const TEMPLATE_WIDTH = 571;
const TEMPLATE_HEIGHT = 1024;

/**
 * Helper to attach normalized [0..1] coordinates alongside exact pixel coordinates.
 */
function withNormalized(rect) {
  return Object.freeze({
    ...rect,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    normalized: Object.freeze({
      x: Number((rect.x / TEMPLATE_WIDTH).toFixed(6)),
      y: Number((rect.y / TEMPLATE_HEIGHT).toFixed(6)),
      width: Number((rect.width / TEMPLATE_WIDTH).toFixed(6)),
      height: Number((rect.height / TEMPLATE_HEIGHT).toFixed(6)),
    }),
  });
}

const templateConfig = Object.freeze({
  assetPath: path.join(PROJECT_ROOT, 'assets', 'templates', 'wasl-template.jpeg'),
  expectedSha256: 'fce204ecab9d838eb5f6886a313c478fe1114c6c0cd81785797285a32eada152',

  dimensions: Object.freeze({
    width: TEMPLATE_WIDTH,
    height: TEMPLATE_HEIGHT,
    aspectRatio: TEMPLATE_WIDTH / TEMPLATE_HEIGHT,
  }),

  fonts: Object.freeze({
    family: 'Tajawal',
    files: Object.freeze({
      regular: path.join(PROJECT_ROOT, 'assets', 'fonts', 'Tajawal-Regular.ttf'),
      medium: path.join(PROJECT_ROOT, 'assets', 'fonts', 'Tajawal-Medium.ttf'),
      bold: path.join(PROJECT_ROOT, 'assets', 'fonts', 'Tajawal-Bold.ttf'),
    }),
  }),

  /**
   * Protected template regions that MUST NEVER be covered or altered.
   */
  protectedRegions: Object.freeze({
    headerBrandAndBell: withNormalized({ x: 0, y: 0, width: 571, height: 433 }),
    megaphoneBaseAndSkyline: withNormalized({ x: 39, y: 433, width: 492, height: 105 }),
    dateLabelText: withNormalized({ x: 120, y: 775, width: 79, height: 38 }),
    dateCalendarIcon: withNormalized({ x: 55, y: 823, width: 39, height: 40 }),
    timeLabelText: withNormalized({ x: 373, y: 775, width: 77, height: 28 }),
    timeClockIcon: withNormalized({ x: 309, y: 825, width: 39, height: 38 }),
    fixedFooterContact: withNormalized({ x: 39, y: 903, width: 492, height: 101 }),
  }),

  /**
   * Measured panels and their safe internal text rendering bounds.
   */
  panels: Object.freeze({
    /**
     * A. Main Central Announcement Glass Panel
     * Outer border peaks: X=[39..531], Y=[433..745]
     * Top 105px (Y=433..538) contains the 3D megaphone pedestal & skyline horizon.
     * Clean frosted glass text zone: X=[60..511] (centered at X=285.5), Y=[540..731].
     */
    announcement: Object.freeze({
      outer: withNormalized({ x: 39, y: 433, width: 492, height: 312 }),
      padding: Object.freeze({ top: 107, right: 20, bottom: 14, left: 21 }),
      safeArea: withNormalized({ x: 60, y: 540, width: 451, height: 191 }),
      typography: Object.freeze({
        maxFontSize: 28,
        minFontSize: 13,
        preferredWeights: Object.freeze({
          shortThresholdChars: 90,
          shortWeight: 700,
          defaultWeight: 500,
        }),
        lineHeightRatio: 1.52,
        paragraphGapRatio: 0.42,
        color: '#FFFFFF',
        textShadow: '0 1px 4px rgba(6, 22, 58, 0.65)',
      }),
    }),

    /**
     * B. Left Bottom Date Panel ("التاريخ")
     * Outer border peaks: X=[39..278], Y=[763..875]
     * Existing label "التاريخ": X=[120..199], Y=[775..813]
     * Existing calendar icon: X=[55..94], Y=[823..863]
     * Safe dynamic zone sits right of calendar icon and optically centered under "التاريخ".
     */
    date: Object.freeze({
      outer: withNormalized({ x: 39, y: 763, width: 239, height: 112 }),
      padding: Object.freeze({ top: 50, right: 26, bottom: 5, left: 57 }),
      safeArea: withNormalized({ x: 96, y: 813, width: 156, height: 57 }),
      dayNameArea: withNormalized({ x: 96, y: 813, width: 156, height: 19 }),
      datesArea: withNormalized({ x: 96, y: 832, width: 156, height: 38 }),
      typography: Object.freeze({
        dayNameFontSize: 14.5,
        dayNameMinFontSize: 12,
        dayNameWeight: 700,
        dateFontSize: 13.5,
        dateMinFontSize: 10.5,
        dateWeight: 500,
        lineHeight: 1.32,
        color: '#FFFFFF',
        dayNameColor: '#EAF6FF',
        textShadow: '0 1px 3px rgba(5, 20, 54, 0.7)',
      }),
    }),

    /**
     * C. Right Bottom Time Panel ("الوقت")
     * Outer border peaks: X=[293..531], Y=[763..875]
     * Existing label "الوقت": X=[373..450], Y=[775..803]
     * Existing clock icon: X=[309..348], Y=[825..863]
     * Safe dynamic zone sits right of clock icon and optically centered under "الوقت".
     */
    time: Object.freeze({
      outer: withNormalized({ x: 293, y: 763, width: 238, height: 112 }),
      padding: Object.freeze({ top: 50, right: 33, bottom: 6, left: 57 }),
      safeArea: withNormalized({ x: 350, y: 813, width: 148, height: 56 }),
      typography: Object.freeze({
        fontSize: 22,
        minFontSize: 15,
        weight: 700,
        lineHeight: 1.2,
        color: '#FFFFFF',
        periodColor: '#DDF0FF',
        textShadow: '0 1px 3px rgba(5, 20, 54, 0.7)',
      }),
    }),
  }),
});

module.exports = templateConfig;
