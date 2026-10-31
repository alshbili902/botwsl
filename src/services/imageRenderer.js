'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { chromium } = require('playwright');

const templateConfig = require('../config/template');
const { getSaudiDateTime } = require('./dateService');
const { escapeHtml, prepareAnnouncementText } = require('./textLayout');
const logger = require('../utils/logger');
const {
  TemplateAssetError,
  TextOverflowError,
  RenderError,
  AppError,
} = require('../utils/errors');

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output');
const MAX_CONCURRENT_RENDERS = 4;

let cachedAssets = null;
let sharedBrowser = null;
let browserLaunchPromise = null;
let activeRenders = 0;
const waitQueue = [];

/**
 * Acquire a concurrency slot so burst requests never exhaust server memory.
 */
function acquireSlot() {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(resolve);
  });
}

function releaseSlot() {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    next();
  } else {
    activeRenders = Math.max(0, activeRenders - 1);
  }
}

/**
 * Validate and cache the permanent template buffer and local Tajawal font @font-face CSS.
 * Never mutates the template file on disk.
 */
async function loadAndVerifyAssets() {
  if (cachedAssets) {
    return cachedAssets;
  }

  // 1. Verify official template file exists and matches exact dimensions & SHA-256
  let templateBuffer;
  try {
    await fsp.access(templateConfig.assetPath, fs.constants.R_OK);
    templateBuffer = await fsp.readFile(templateConfig.assetPath);
  } catch (err) {
    throw new TemplateAssetError(
      `Missing or unreadable official template at ${templateConfig.assetPath}`,
      'عذراً، ملف القالب الرسمي لـ وصل غير موجود على الخادم.',
      err
    );
  }

  const sha256 = crypto.createHash('sha256').update(templateBuffer).digest('hex');
  if (templateConfig.expectedSha256 && sha256 !== templateConfig.expectedSha256) {
    throw new TemplateAssetError(
      `Template integrity mismatch: expected SHA-256 ${templateConfig.expectedSha256}, got ${sha256}`,
      'عذراً، فشل التحقق من سلامة القالب الرسمي الأصلي.'
    );
  }

  const meta = await sharp(templateBuffer).metadata();
  if (
    meta.width !== templateConfig.dimensions.width ||
    meta.height !== templateConfig.dimensions.height
  ) {
    throw new TemplateAssetError(
      `Template dimensions mismatch: expected ${templateConfig.dimensions.width}x${templateConfig.dimensions.height}, got ${meta.width}x${meta.height}`,
      'عذراً، أبعاد ملف القالب الرسمي غير مطابقة للأبعاد المعتمدة.'
    );
  }

  // 2. Verify all three local Tajawal TTF font files and build @font-face CSS
  const fontSpecs = [
    { key: 'regular', weight: 400, filePath: templateConfig.fonts.files.regular },
    { key: 'medium', weight: 500, filePath: templateConfig.fonts.files.medium },
    { key: 'bold', weight: 700, filePath: templateConfig.fonts.files.bold },
  ];

  const fontFaceRules = [];
  for (const spec of fontSpecs) {
    let fontBuf;
    try {
      await fsp.access(spec.filePath, fs.constants.R_OK);
      fontBuf = await fsp.readFile(spec.filePath);
    } catch (err) {
      throw new TemplateAssetError(
        `Missing required Arabic font file: ${spec.filePath}`,
        'عذراً، ملفات خط Tajawal العربي غير مكتملة على الخادم.',
        err
      );
    }

    if (fontBuf.length < 1024) {
      throw new TemplateAssetError(
        `Corrupted or empty font file: ${spec.filePath} (${fontBuf.length} bytes)`,
        'عذراً، أحد ملفات خط Tajawal العربي تالف أو غير صالح.'
      );
    }

    const b64 = fontBuf.toString('base64');
    fontFaceRules.push(`
      @font-face {
        font-family: '${templateConfig.fonts.family}';
        src: url('data:font/ttf;base64,${b64}') format('truetype');
        font-weight: ${spec.weight};
        font-style: normal;
        font-display: block;
      }
    `);
  }

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });

  cachedAssets = Object.freeze({
    templateBuffer,
    templateSha256: sha256,
    width: meta.width,
    height: meta.height,
    fontFaceCss: fontFaceRules.join('\n'),
  });

  return cachedAssets;
}

/**
 * Launch or reuse the persistent headless Chromium instance.
 */
async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) {
    return sharedBrowser;
  }

  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }

  browserLaunchPromise = (async () => {
    try {
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      });

      browser.on('disconnected', () => {
        if (sharedBrowser === browser) {
          logger.warn('Headless Chromium disconnected unexpectedly; will relaunch on next render');
          sharedBrowser = null;
        }
      });

      sharedBrowser = browser;
      return browser;
    } catch (err) {
      throw new RenderError(
        `Failed to launch Playwright Chromium browser: ${err.message}`,
        err,
        'عذراً، تعذر تشغيل محرك معالجة النصوص العربية على الخادم.'
      );
    } finally {
      browserLaunchPromise = null;
    }
  })();

  return browserLaunchPromise;
}

/**
 * Prepare a clean isolated Playwright Page preloaded with local Tajawal @font-face styles.
 */
async function createRenderPage(browser, assets) {
  const context = await browser.newContext({
    viewport: {
      width: templateConfig.dimensions.width,
      height: templateConfig.dimensions.height,
    },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await page.setContent(
    `<!DOCTYPE html>
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <style>
          ${assets.fontFaceCss}
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          html, body {
            background: transparent !important;
            overflow: hidden;
            font-family: '${templateConfig.fonts.family}', sans-serif;
            -webkit-font-smoothing: antialiased;
            text-rendering: geometricPrecision;
            font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
          }
          #stage {
            position: absolute;
            top: 0;
            left: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            direction: rtl;
          }
        </style>
      </head>
      <body>
        <div id="stage"></div>
      </body>
    </html>`,
    { waitUntil: 'domcontentloaded' }
  );

  // Force all three font weights (400, 500, 700) to decode before measuring
  await page.evaluate(async (family) => {
    await Promise.all([
      document.fonts.load(`400 18px "${family}"`, 'وصل WASL 123'),
      document.fonts.load(`500 18px "${family}"`, 'وصل WASL 123'),
      document.fonts.load(`700 18px "${family}"`, 'وصل WASL 123'),
    ]);
    await document.fonts.ready;
  }, templateConfig.fonts.family);

  return { context, page };
}

/**
 * 1. Separate Rendering Function: Main Announcement Text Overlay
 */
async function renderAnnouncementOverlay(page, rawAnnouncementText, options = {}) {
  const prepared = prepareAnnouncementText(rawAnnouncementText, options);
  const panel = templateConfig.panels.announcement;
  const { safeArea, typography } = panel;

  const fitResult = await page.evaluate(
    ({ safeArea: area, typography: typo, prepared: prep }) => {
      const stage = document.getElementById('stage');
      stage.style.width = `${area.width}px`;
      stage.style.height = `${area.height}px`;
      stage.style.padding = '2px 4px';
      stage.style.color = typo.color;
      stage.style.textShadow = typo.textShadow;

      stage.innerHTML = `
        <style id="dynamic-style"></style>
        <div id="measure-box" style="width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          ${prep.paragraphsHtml}
        </div>
      `;

      const styleEl = document.getElementById('dynamic-style');
      const box = document.getElementById('measure-box');

      function applySize(sizePx) {
        const lineHeight = (sizePx * typo.lineHeightRatio).toFixed(2);
        const gapPx = (sizePx * typo.paragraphGapRatio).toFixed(2);
        const headlineSize = Math.min(typo.maxFontSize + 1, sizePx * 1.08).toFixed(2);
        styleEl.textContent = `
          #measure-box .para {
            width: 100%;
            font-size: ${sizePx}px;
            font-weight: ${prep.bodyWeight};
            line-height: ${lineHeight}px;
            margin-bottom: ${gapPx}px;
            direction: rtl;
            unicode-bidi: isolate;
            overflow-wrap: break-word;
            word-break: normal;
            text-align: center;
          }
          #measure-box .para:last-child {
            margin-bottom: 0;
          }
          #measure-box .para-headline {
            font-size: ${headlineSize}px;
            font-weight: 700;
            margin-bottom: ${(sizePx * 0.48).toFixed(2)}px;
          }
        `;
      }

      const maxAllowedHeight = area.height - 4;
      const maxAllowedWidth = area.width - 8;

      function fitsAt(sizePx) {
        applySize(sizePx);
        if (box.scrollHeight > maxAllowedHeight || box.scrollWidth > maxAllowedWidth) {
          return false;
        }
        const paras = box.querySelectorAll('.para');
        for (const p of paras) {
          if (p.scrollWidth > maxAllowedWidth + 1) {
            return false;
          }
        }
        return true;
      }

      if (!fitsAt(typo.minFontSize)) {
        return {
          fits: false,
          requiredHeight: box.scrollHeight,
          maxAllowedHeight,
        };
      }

      let low = typo.minFontSize;
      let high = typo.maxFontSize;
      let best = low;

      // Binary search at 0.25px resolution for optimal visual balance
      for (let i = 0; i < 16; i += 1) {
        const mid = Math.round(((low + high) / 2) * 4) / 4;
        if (fitsAt(mid)) {
          best = mid;
          low = mid + 0.25;
        } else {
          high = mid - 0.25;
        }
        if (low > high) break;
      }

      applySize(best);
      return {
        fits: true,
        fontSize: best,
        renderedHeight: box.scrollHeight,
      };
    },
    { safeArea, typography, prepared }
  );

  if (!fitResult.fits) {
    throw new TextOverflowError(
      `Announcement overflows safeArea at minFontSize=${typography.minFontSize}px (needed ${fitResult.requiredHeight}px > ${fitResult.maxAllowedHeight}px)`
    );
  }

  const buffer = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: {
      x: 0,
      y: 0,
      width: safeArea.width,
      height: safeArea.height,
    },
  });

  return {
    buffer,
    left: safeArea.x,
    top: safeArea.y,
    width: safeArea.width,
    height: safeArea.height,
    fontSize: fitResult.fontSize,
    bodyWeight: prepared.bodyWeight,
    charCount: prepared.charCount,
  };
}

/**
 * 2. Separate Rendering Function: Arabic Day Name Overlay ("السبت")
 */
async function renderDayNameOverlay(page, dayName) {
  const { dayNameArea, typography } = templateConfig.panels.date;
  const safeDay = escapeHtml(dayName);

  await page.evaluate(
    ({ area, typo, text }) => {
      const stage = document.getElementById('stage');
      stage.style.width = `${area.width}px`;
      stage.style.height = `${area.height}px`;
      stage.style.padding = '0 2px';
      stage.style.color = typo.dayNameColor;
      stage.style.textShadow = typo.textShadow;

      stage.innerHTML = `<div id="day-text" dir="rtl" style="white-space: nowrap; font-weight: ${typo.dayNameWeight}; line-height: 1.15;">${text}</div>`;
      const el = document.getElementById('day-text');

      let size = typo.dayNameFontSize;
      while (size >= typo.dayNameMinFontSize) {
        el.style.fontSize = `${size}px`;
        if (el.scrollWidth <= area.width - 4 && el.scrollHeight <= area.height + 2) {
          break;
        }
        size -= 0.5;
      }
    },
    { area: dayNameArea, typo: typography, text: safeDay }
  );

  const buffer = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: {
      x: 0,
      y: 0,
      width: dayNameArea.width,
      height: dayNameArea.height,
    },
  });

  return {
    buffer,
    left: dayNameArea.x,
    top: dayNameArea.y,
    width: dayNameArea.width,
    height: dayNameArea.height,
  };
}

/**
 * 3. Separate Rendering Function: Gregorian & Hijri Dates Overlay
 */
async function renderDateOverlay(page, { gregorianDate, hijriDate }) {
  const { datesArea, typography } = templateConfig.panels.date;
  const safeGreg = escapeHtml(gregorianDate);
  const safeHijri = escapeHtml(hijriDate);

  await page.evaluate(
    ({ area, typo, greg, hijri }) => {
      const stage = document.getElementById('stage');
      stage.style.width = `${area.width}px`;
      stage.style.height = `${area.height}px`;
      stage.style.padding = '0 2px';
      stage.style.color = typo.color;
      stage.style.textShadow = typo.textShadow;

      stage.innerHTML = `
        <div id="dates-wrap" style="width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;">
          <div class="date-line" dir="rtl" style="white-space: nowrap; font-weight: ${typo.dateWeight};">${greg}</div>
          <div class="date-line" dir="rtl" style="white-space: nowrap; font-weight: ${typo.dateWeight};">${hijri}</div>
        </div>
      `;

      const wrap = document.getElementById('dates-wrap');
      const lines = wrap.querySelectorAll('.date-line');

      let size = typo.dateFontSize;
      while (size >= typo.dateMinFontSize) {
        for (const l of lines) {
          l.style.fontSize = `${size}px`;
          l.style.lineHeight = `${(size * typo.lineHeight).toFixed(2)}px`;
        }
        const widest = Math.max(lines[0].scrollWidth, lines[1].scrollWidth);
        if (widest <= area.width - 4 && wrap.scrollHeight <= area.height + 2) {
          break;
        }
        size -= 0.25;
      }
    },
    { area: datesArea, typo: typography, greg: safeGreg, hijri: safeHijri }
  );

  const buffer = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: {
      x: 0,
      y: 0,
      width: datesArea.width,
      height: datesArea.height,
    },
  });

  return {
    buffer,
    left: datesArea.x,
    top: datesArea.y,
    width: datesArea.width,
    height: datesArea.height,
  };
}

/**
 * 4. Separate Rendering Function: Current Saudi Time Overlay ("04:52 صباحاً")
 */
async function renderTimeOverlay(page, { timeDigits, period }) {
  const { safeArea, typography } = templateConfig.panels.time;
  const safeDigits = escapeHtml(timeDigits);
  const safePeriod = escapeHtml(period);

  await page.evaluate(
    ({ area, typo, digits, ampm }) => {
      const stage = document.getElementById('stage');
      stage.style.width = `${area.width}px`;
      stage.style.height = `${area.height}px`;
      stage.style.padding = '0 4px';
      stage.style.color = typo.color;
      stage.style.textShadow = typo.textShadow;

      stage.innerHTML = `
        <div id="time-wrap" dir="rtl" style="display: flex; flex-direction: row; align-items: baseline; justify-content: center; gap: 6px; white-space: nowrap; font-weight: ${typo.weight};">
          <span id="time-digits" dir="ltr" style="letter-spacing: 0.4px;">${digits}</span>
          <span id="time-period" style="color: ${typo.periodColor}; font-weight: 500;">${ampm}</span>
        </div>
      `;

      const wrap = document.getElementById('time-wrap');
      const digitsEl = document.getElementById('time-digits');
      const periodEl = document.getElementById('time-period');

      let size = typo.fontSize;
      while (size >= typo.minFontSize) {
        digitsEl.style.fontSize = `${size}px`;
        periodEl.style.fontSize = `${Math.max(13, Math.round(size * 0.78))}px`;
        if (wrap.scrollWidth <= area.width - 6 && wrap.scrollHeight <= area.height - 2) {
          break;
        }
        size -= 0.5;
      }
    },
    { area: safeArea, typo: typography, digits: safeDigits, ampm: safePeriod }
  );

  const buffer = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: {
      x: 0,
      y: 0,
      width: safeArea.width,
      height: safeArea.height,
    },
  });

  return {
    buffer,
    left: safeArea.x,
    top: safeArea.y,
    width: safeArea.width,
    height: safeArea.height,
  };
}

/**
 * Main Rendering Pipeline:
 * 1. Loads untouched permanent WASL template buffer.
 * 2. Computes real-time Saudi date/time in Asia/Riyadh.
 * 3. Renders 4 transparent overlays via Playwright + local Tajawal fonts.
 * 4. Composites overlays onto the original template via Sharp (preserving dimensions & ICC).
 * 5. Exports final lossless PNG to a unique file path.
 *
 * @param {string} announcementText
 * @param {object} [options]
 * @param {Date|string|number} [options.now] - Optional timestamp override for deterministic tests
 * @param {number} [options.maxLength] - Optional max character limit
 * @param {string} [options.outputPath] - Optional explicit output path
 */
async function generateAnnouncementImage(announcementText, options = {}) {
  const startMs = Date.now();
  const assets = await loadAndVerifyAssets();
  const dateTime = getSaudiDateTime({ now: options.now });

  await acquireSlot();
  let context = null;

  try {
    const browser = await getBrowser();
    const session = await createRenderPage(browser, assets);
    context = session.context;
    const { page } = session;

    const announcementOverlay = await renderAnnouncementOverlay(page, announcementText, {
      maxLength: options.maxLength,
    });
    const dayNameOverlay = await renderDayNameOverlay(page, dateTime.dayName);
    const dateOverlay = await renderDateOverlay(page, {
      gregorianDate: dateTime.gregorianDate,
      hijriDate: dateTime.hijriDate,
    });
    const timeOverlay = await renderTimeOverlay(page, {
      timeDigits: dateTime.timeDigits,
      period: dateTime.period,
    });

    const uniqueId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const outputPath = options.outputPath || path.join(OUTPUT_DIR, `wasl-${uniqueId}.png`);
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    const finalBuffer = await sharp(assets.templateBuffer, { failOn: 'error' })
      .keepIccProfile()
      .composite([
        {
          input: announcementOverlay.buffer,
          left: announcementOverlay.left,
          top: announcementOverlay.top,
        },
        {
          input: dayNameOverlay.buffer,
          left: dayNameOverlay.left,
          top: dayNameOverlay.top,
        },
        {
          input: dateOverlay.buffer,
          left: dateOverlay.left,
          top: dateOverlay.top,
        },
        {
          input: timeOverlay.buffer,
          left: timeOverlay.left,
          top: timeOverlay.top,
        },
      ])
      .png({ compressionLevel: 6, adaptiveFiltering: true })
      .toBuffer();

    await fsp.writeFile(outputPath, finalBuffer);

    const outMeta = await sharp(finalBuffer).metadata();
    if (outMeta.width !== assets.width || outMeta.height !== assets.height) {
      throw new RenderError(
        `Output dimensions (${outMeta.width}x${outMeta.height}) deviated from template (${assets.width}x${assets.height})`
      );
    }

    const durationMs = Date.now() - startMs;
    logger.info(
      {
        durationMs,
        fontSize: announcementOverlay.fontSize,
        bodyWeight: announcementOverlay.bodyWeight,
        charCount: announcementOverlay.charCount,
        width: outMeta.width,
        height: outMeta.height,
      },
      'Generated WASL announcement PNG successfully'
    );

    return {
      outputPath,
      buffer: finalBuffer,
      width: outMeta.width,
      height: outMeta.height,
      dateTime,
      layout: {
        fontSize: announcementOverlay.fontSize,
        bodyWeight: announcementOverlay.bodyWeight,
        charCount: announcementOverlay.charCount,
      },
      overlays: {
        announcement: {
          left: announcementOverlay.left,
          top: announcementOverlay.top,
          width: announcementOverlay.width,
          height: announcementOverlay.height,
        },
        dayName: {
          left: dayNameOverlay.left,
          top: dayNameOverlay.top,
          width: dayNameOverlay.width,
          height: dayNameOverlay.height,
        },
        date: {
          left: dateOverlay.left,
          top: dateOverlay.top,
          width: dateOverlay.width,
          height: dateOverlay.height,
        },
        time: {
          left: timeOverlay.left,
          top: timeOverlay.top,
          width: timeOverlay.width,
          height: timeOverlay.height,
        },
      },
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new RenderError(`Image rendering failed: ${err.message}`, err);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    releaseSlot();
  }
}

/**
 * Safely delete a temporary generated image file after Telegram delivery.
 */
async function cleanupOutputFile(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, filePath }, 'Failed to clean up temporary output image');
    }
  }
}

/**
 * Gracefully close the shared headless Chromium browser on process shutdown.
 */
async function shutdownRenderer() {
  if (sharedBrowser) {
    const browser = sharedBrowser;
    sharedBrowser = null;
    await browser.close().catch(() => {});
  }
}

module.exports = {
  loadAndVerifyAssets,
  renderAnnouncementOverlay,
  renderDayNameOverlay,
  renderDateOverlay,
  renderTimeOverlay,
  generateAnnouncementImage,
  cleanupOutputFile,
  shutdownRenderer,
};
