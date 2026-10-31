'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const templateConfig = require('../config/template');
const {
  generateAnnouncementImage,
  shutdownRenderer,
} = require('./imageRenderer');

/**
 * Check if two rectangles [x, y, width, height] overlap by any positive area.
 */
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Inspect the permanent WASL template asset and validate all configured coordinates
 * and non-overlap safety invariants.
 */
async function inspectTemplate() {
  if (!fs.existsSync(templateConfig.assetPath)) {
    throw new Error(`Template asset missing at ${templateConfig.assetPath}`);
  }

  const fileBuffer = await fsp.readFile(templateConfig.assetPath);
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const metadata = await sharp(fileBuffer).metadata();

  const safeZones = [
    { name: 'announcement.safeArea', rect: templateConfig.panels.announcement.safeArea },
    { name: 'date.dayNameArea', rect: templateConfig.panels.date.dayNameArea },
    { name: 'date.datesArea', rect: templateConfig.panels.date.datesArea },
    { name: 'time.safeArea', rect: templateConfig.panels.time.safeArea },
  ];

  const overlaps = [];
  for (const [protName, protRect] of Object.entries(templateConfig.protectedRegions)) {
    for (const zone of safeZones) {
      if (rectsOverlap(zone.rect, protRect)) {
        overlaps.push(`${zone.name} overlaps protected region ${protName}`);
      }
    }
  }

  return {
    assetPath: templateConfig.assetPath,
    fileBytes: fileBuffer.length,
    sha256,
    sha256MatchesExpected: sha256 === templateConfig.expectedSha256,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    hasIccProfile: Boolean(metadata.icc),
    panels: templateConfig.panels,
    protectedRegions: templateConfig.protectedRegions,
    overlaps,
    isValid:
      metadata.width === templateConfig.dimensions.width &&
      metadata.height === templateConfig.dimensions.height &&
      sha256 === templateConfig.expectedSha256 &&
      overlaps.length === 0,
  };
}

/**
 * Build an SVG boundary overlay for temporary pre-production coordinate inspection ONLY.
 * Never used in production announcements.
 */
function buildInspectionSvgOverlay() {
  const { width, height } = templateConfig.dimensions;
  const { announcement, date, time } = templateConfig.panels;
  const prot = templateConfig.protectedRegions;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <!-- Detected Outer Panel Boundaries (Cyan Dashed) -->
      <rect x="${announcement.outer.x}" y="${announcement.outer.y}" width="${announcement.outer.width}" height="${announcement.outer.height}"
            fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-dasharray="6,4" />
      <rect x="${date.outer.x}" y="${date.outer.y}" width="${date.outer.width}" height="${date.outer.height}"
            fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-dasharray="6,4" />
      <rect x="${time.outer.x}" y="${time.outer.y}" width="${time.outer.width}" height="${time.outer.height}"
            fill="none" stroke="#00E5FF" stroke-width="1.5" stroke-dasharray="6,4" />

      <!-- Protected Elements That Must Not Be Covered (Red/Orange) -->
      <rect x="${prot.megaphoneBaseAndSkyline.x}" y="${prot.megaphoneBaseAndSkyline.y}" width="${prot.megaphoneBaseAndSkyline.width}" height="${prot.megaphoneBaseAndSkyline.height}"
            fill="rgba(255,82,82,0.12)" stroke="#FF5252" stroke-width="1" stroke-dasharray="3,3" />
      <rect x="${prot.dateLabelText.x}" y="${prot.dateLabelText.y}" width="${prot.dateLabelText.width}" height="${prot.dateLabelText.height}"
            fill="none" stroke="#FFAB40" stroke-width="1.2" />
      <rect x="${prot.dateCalendarIcon.x}" y="${prot.dateCalendarIcon.y}" width="${prot.dateCalendarIcon.width}" height="${prot.dateCalendarIcon.height}"
            fill="none" stroke="#FFAB40" stroke-width="1.2" />
      <rect x="${prot.timeLabelText.x}" y="${prot.timeLabelText.y}" width="${prot.timeLabelText.width}" height="${prot.timeLabelText.height}"
            fill="none" stroke="#FFAB40" stroke-width="1.2" />
      <rect x="${prot.timeClockIcon.x}" y="${prot.timeClockIcon.y}" width="${prot.timeClockIcon.width}" height="${prot.timeClockIcon.height}"
            fill="none" stroke="#FFAB40" stroke-width="1.2" />
      <rect x="${prot.fixedFooterContact.x}" y="${prot.fixedFooterContact.y}" width="${prot.fixedFooterContact.width}" height="${prot.fixedFooterContact.height}"
            fill="none" stroke="#FF5252" stroke-width="1.5" stroke-dasharray="4,4" />

      <!-- Safe Internal Text Areas (Bright Green) -->
      <rect x="${announcement.safeArea.x}" y="${announcement.safeArea.y}" width="${announcement.safeArea.width}" height="${announcement.safeArea.height}"
            fill="rgba(0,230,118,0.10)" stroke="#00E676" stroke-width="1.5" />
      <rect x="${date.dayNameArea.x}" y="${date.dayNameArea.y}" width="${date.dayNameArea.width}" height="${date.dayNameArea.height}"
            fill="rgba(0,230,118,0.10)" stroke="#00E676" stroke-width="1.2" />
      <rect x="${date.datesArea.x}" y="${date.datesArea.y}" width="${date.datesArea.width}" height="${date.datesArea.height}"
            fill="rgba(105,240,174,0.10)" stroke="#69F0AE" stroke-width="1.2" />
      <rect x="${time.safeArea.x}" y="${time.safeArea.y}" width="${time.safeArea.width}" height="${time.safeArea.height}"
            fill="rgba(0,230,118,0.10)" stroke="#00E676" stroke-width="1.5" />
    </svg>`,
    'utf8'
  );
}

/**
 * Generate a temporary coordinate-inspection preview (sample rendered announcement +
 * diagnostic boundary overlay) to verify alignment visually.
 */
async function generateCoordinatePreview(previewOutputPath, cleanSampleOutputPath) {
  const sampleText =
    'يسر منصة وصل للخدمات الإلكترونية (WASL) إعلامكم بتوفر خدمة إنجاز المعاملات الحكومية والتجارية على مدار الساعة بكل سرعة وموثوقية.';

  const rendered = await generateAnnouncementImage(sampleText, {
    outputPath: cleanSampleOutputPath,
  });

  const svgOverlay = buildInspectionSvgOverlay();
  await sharp(rendered.buffer)
    .keepIccProfile()
    .composite([{ input: svgOverlay, left: 0, top: 0 }])
    .png()
    .toFile(previewOutputPath);

  return {
    cleanSampleOutputPath,
    previewOutputPath,
    rendered,
  };
}

/**
 * Compare a generated announcement PNG pixel-by-pixel against the original WASL template
 * to prove that ZERO pixels outside the designated dynamic safe text rectangles were modified.
 */
async function verifyUntouchedPixels(generatedImageBufferOrPath) {
  const origRaw = await sharp(templateConfig.assetPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const genRaw = await sharp(generatedImageBufferOrPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    origRaw.info.width !== genRaw.info.width ||
    origRaw.info.height !== genRaw.info.height
  ) {
    return {
      dimensionsMatch: false,
      changedOutsideSafeAreas: -1,
      changedInsideSafeAreas: 0,
    };
  }

  const zones = [
    templateConfig.panels.announcement.safeArea,
    templateConfig.panels.date.dayNameArea,
    templateConfig.panels.date.datesArea,
    templateConfig.panels.time.safeArea,
  ];

  function isInsideAnySafeZone(x, y) {
    for (const z of zones) {
      if (x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height) {
        return true;
      }
    }
    return false;
  }

  const { width, height, channels } = origRaw.info;
  let changedOutsideSafeAreas = 0;
  let changedInsideSafeAreas = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * channels;
      const diff =
        origRaw.data[idx] !== genRaw.data[idx] ||
        origRaw.data[idx + 1] !== genRaw.data[idx + 1] ||
        origRaw.data[idx + 2] !== genRaw.data[idx + 2];

      if (diff) {
        if (isInsideAnySafeZone(x, y)) {
          changedInsideSafeAreas += 1;
        } else {
          changedOutsideSafeAreas += 1;
        }
      }
    }
  }

  return {
    dimensionsMatch: true,
    width,
    height,
    changedOutsideSafeAreas,
    changedInsideSafeAreas,
    preservedStrictly: changedOutsideSafeAreas === 0 && changedInsideSafeAreas > 0,
  };
}

if (require.main === module) {
  (async () => {
    try {
      const report = await inspectTemplate();
      console.log('=== WASL Template Inspection Report ===');
      console.log(JSON.stringify(report, null, 2));

      const outArg = process.argv[2];
      if (outArg) {
        const previewPath = path.resolve(outArg, 'coordinate_inspection_preview.png');
        const cleanPath = path.resolve(outArg, 'clean_sample_preview.png');
        const res = await generateCoordinatePreview(previewPath, cleanPath);
        const pixelCheck = await verifyUntouchedPixels(res.cleanSampleOutputPath);
        console.log('=== Pixel Preservation Verification ===');
        console.log(JSON.stringify(pixelCheck, null, 2));
      }
    } catch (err) {
      console.error('Inspection failed:', err);
      process.exitCode = 1;
    } finally {
      await shutdownRenderer();
    }
  })();
}

module.exports = {
  inspectTemplate,
  generateCoordinatePreview,
  verifyUntouchedPixels,
};
