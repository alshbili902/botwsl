'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const templateConfig = require('../src/config/template');
const { loadSettings } = require('../src/config/settings');
const { getSaudiDateTime } = require('../src/services/dateService');
const { prepareAnnouncementText } = require('../src/services/textLayout');
const {
  generateAnnouncementImage,
  cleanupOutputFile,
  shutdownRenderer,
} = require('../src/services/imageRenderer');
const {
  inspectTemplate,
  verifyUntouchedPixels,
} = require('../src/services/templateInspector');
const { createBot } = require('../src/bot/createBot');
const { MENU_BUTTONS, CALLBACK_ACTIONS } = require('../src/bot/keyboards/menus');
const {
  ValidationError,
  TextOverflowError,
} = require('../src/utils/errors');

const saveSamplesIdx = process.argv.indexOf('--save-samples');
const SAMPLES_DIR =
  saveSamplesIdx !== -1 && process.argv[saveSamplesIdx + 1]
    ? path.resolve(process.argv[saveSamplesIdx + 1])
    : null;

const results = [];

async function runCase(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, passed: true, ms });
    console.log(`  [PASS] ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ name, passed: false, ms, error: err });
    console.error(`  [FAIL] ${name} (${ms}ms): ${err.message}`);
  }
}

async function saveOrClean(rendered, sampleFileName) {
  if (SAMPLES_DIR && sampleFileName) {
    await fsp.mkdir(SAMPLES_DIR, { recursive: true });
    await fsp.copyFile(rendered.outputPath, path.join(SAMPLES_DIR, sampleFileName));
  }
  await cleanupOutputFile(rendered.outputPath);
}

/**
 * Helper to assert PNG output format, exact dimensions (571x1024), and 100% untouched template pixels.
 */
async function assertStrictOutputIntegrity(rendered) {
  const meta = await sharp(rendered.buffer).metadata();
  assert.strictEqual(meta.format, 'png', 'Expected PNG output format');
  assert.strictEqual(meta.width, 571, 'Expected exact width 571px');
  assert.strictEqual(meta.height, 1024, 'Expected exact height 1024px');

  const pixelReport = await verifyUntouchedPixels(rendered.buffer);
  assert.strictEqual(pixelReport.dimensionsMatch, true, 'Dimensions must match template');
  assert.strictEqual(
    pixelReport.changedOutsideSafeAreas,
    0,
    `Expected 0 changed pixels outside safe areas, got ${pixelReport.changedOutsideSafeAreas}`
  );
  assert.ok(
    pixelReport.changedInsideSafeAreas > 500,
    'Expected dynamic text pixels to be rendered inside safe areas'
  );
}

(async () => {
  console.log('\n======================================================');
  console.log('  WASL Telegram Bot – Full Quality Assurance Suite');
  console.log('======================================================\n');

  const initialTemplateHash = crypto
    .createHash('sha256')
    .update(await fsp.readFile(templateConfig.assetPath))
    .digest('hex');

  // 1. Short Arabic announcement
  await runCase('1. Short Arabic announcement (Bold large typography)', async () => {
    const rendered = await generateAnnouncementImage(
      'نعلن عن توفر خدمة إصدار وتجديد السجلات التجارية فوراً عبر منصة وصل.'
    );
    assert.ok(rendered.layout.fontSize >= 24, `Expected large font >=24px, got ${rendered.layout.fontSize}`);
    assert.strictEqual(rendered.layout.bodyWeight, 700, 'Short announcement should use Bold (700)');
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '01_short_arabic.png');
  });

  // 2. Medium Arabic announcement
  await runCase('2. Medium Arabic announcement', async () => {
    const rendered = await generateAnnouncementImage(
      'عملاءنا الكرام، نود إشعاركم بأن فريق وصل للخدمات الإلكترونية يستقبل جميع طلبات التقديم والمتابعة للجهات الحكومية والمنصات الرقمية طوال أيام الأسبوع بسرعة ودقة عالية.'
    );
    assert.ok(rendered.layout.fontSize >= 18 && rendered.layout.fontSize <= 28);
    assert.strictEqual(rendered.layout.bodyWeight, 500);
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '02_medium_arabic.png');
  });

  // 3. Long Arabic announcement
  await runCase('3. Long Arabic announcement (Auto font-size scaling)', async () => {
    const longText =
      'تعلن مؤسسة وصل للخدمات الإلكترونية عن إطلاق باقة الأعمال الشاملة للشركات والمؤسسات والأفراد، والتي تتضمن إدارة الحسابات الحكومية، توثيق العقود الإلكترونية، تحديث البيانات، متابعة الطلبات عبر المنصات الرسمية، وتقديم الدعم الفني والاستشاري المتكامل على مدار الساعة بأيدي نخبة من المختصين لضمان إنجاز أعمالكم بأعلى معايير الجودة والموثوقية دون الحاجة لمراجعة المكاتب.';
    const rendered = await generateAnnouncementImage(longText);
    assert.ok(
      rendered.layout.fontSize >= 13 && rendered.layout.fontSize <= 21,
      `Expected scaled font size in [13..21], got ${rendered.layout.fontSize}`
    );
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '03_long_arabic.png');
  });

  // 4. Multiple paragraphs
  await runCase('4. Multiple paragraphs with opening headline', async () => {
    const multiPara = [
      'إعلان هام لعملاء وصل',
      '',
      'تم تفعيل خدمة إنجاز المعاملات الفورية عن بُعد لجميع مناطق المملكة.',
      '',
      'للطلب والاستفسار تواصلوا معنا مباشرة عبر الواتساب الموضح أدناه.',
    ].join('\n');
    const rendered = await generateAnnouncementImage(multiPara);
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '04_multi_paragraphs.png');
  });

  // 5. Arabic with English words
  await runCase('5. Mixed Arabic and English words (BiDi shaping)', async () => {
    const mixed =
      'خدمة VIP الجديدة من WASL Digital تدعم منصات Absher و Qiwa و Mudad لإنجاز أعمالكم الرقمية خلال دقائق!';
    const rendered = await generateAnnouncementImage(mixed);
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '05_arabic_english_mixed.png');
  });

  // 6. Arabic punctuation and numbers
  await runCase('6. Arabic punctuation, percentages, and numbers', async () => {
    const punctNums =
      'خصم خاص بنسبة 25% لأول 50 عميلاً خلال عام 2026م! هل لديك استفسار؟ تواصل معنا من الساعة 8:00 صباحاً حتى 11:30 مساءً (خدمة فورية 100%).';
    const rendered = await generateAnnouncementImage(punctNums);
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '06_punctuation_and_numbers.png');
  });

  // 7. Short date and longer Hijri date formatting
  await runCase('7. Short date vs longest Hijri month formatting ("جمادى الآخرة")', async () => {
    // Short date: 1 May -> 1 مايو / محرم
    const shortDt = getSaudiDateTime({ now: '2026-06-16T10:05:00+03:00' });
    assert.ok(shortDt.gregorianDate.includes('يونيو'));
    assert.ok(shortDt.hijriDate.includes('محرم'));

    // Longer Hijri month: Jumada al-Akhirah (جمادى الآخرة) & PM time
    const longHijriInstant = '2026-12-08T23:45:00+03:00';
    const longDt = getSaudiDateTime({ now: longHijriInstant });
    assert.ok(
      longDt.hijriDate.includes('جمادى الآخرة'),
      `Expected جمادى الآخرة, got ${longDt.hijriDate}`
    );

    const rendered = await generateAnnouncementImage(
      'اختبار تنسيق التواريخ الهجرية والميلادية الطويلة داخل لوحة التاريخ والوقت بدقة تامة.',
      { now: longHijriInstant }
    );
    await assertStrictOutputIntegrity(rendered);
    await saveOrClean(rendered, '07_long_hijri_and_pm_time.png');
  });

  // 8 & 9. Correct current Saudi time, weekday, and midnight/month transitions under UTC
  await runCase('8 & 9. Saudi time (Asia/Riyadh), weekday, and midnight consistency', async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const beforeMidnight = getSaudiDateTime({ now: '2026-10-30T23:59:59+03:00' });
      assert.strictEqual(beforeMidnight.dayName, 'الجمعة');
      assert.strictEqual(beforeMidnight.gregorianDate, '30 أكتوبر 2026');
      assert.strictEqual(beforeMidnight.hijriDate, '19 جمادى الأولى 1448');
      assert.strictEqual(beforeMidnight.timeFormatted, '11:59 مساءً');

      const afterMidnight = getSaudiDateTime({ now: '2026-10-31T00:00:01+03:00' });
      assert.strictEqual(afterMidnight.dayName, 'السبت');
      assert.strictEqual(afterMidnight.gregorianDate, '31 أكتوبر 2026');
      assert.strictEqual(afterMidnight.hijriDate, '20 جمادى الأولى 1448');
      assert.strictEqual(afterMidnight.timeFormatted, '12:00 صباحاً');

      const noonRiyadh = getSaudiDateTime({ now: '2026-10-31T12:30:00+03:00' });
      assert.strictEqual(noonRiyadh.timeFormatted, '12:30 مساءً');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  // 10 & 11. Text fitting inside all 3 panels + Original template file immutability
  await runCase('10 & 11. Panel boundary non-overlap & original template SHA-256 preservation', async () => {
    const report = await inspectTemplate();
    assert.strictEqual(report.isValid, true, 'Template inspection must pass with 0 overlaps');
    assert.strictEqual(report.overlaps.length, 0);

    const currentHash = crypto
      .createHash('sha256')
      .update(await fsp.readFile(templateConfig.assetPath))
      .digest('hex');
    assert.strictEqual(
      currentHash,
      initialTemplateHash,
      'Original template file on disk must never be altered'
    );
  });

  // Error handling checks: Empty & Overflowing announcements & Env validation
  await runCase('11b. Validation of empty, oversized, and overflowing announcements', async () => {
    assert.throws(() => prepareAnnouncementText('   \n\t  '), ValidationError);
    assert.throws(() => prepareAnnouncementText('أ'.repeat(1205), { maxLength: 1200 }), ValidationError);

    // 25 explicit lines cannot fit at minFontSize=13px -> must throw TextOverflowError cleanly
    const tooManyLines = Array.from({ length: 22 }, (_, i) => `سطر تجريبي رقم ${i + 1}`).join('\n');
    await assert.rejects(
      () => generateAnnouncementImage(tooManyLines),
      (err) => err instanceof TextOverflowError
    );

    assert.throws(
      () => loadSettings({ BOT_TOKEN: '', AUTHORIZED_USER_IDS: '12345' }),
      /Missing required environment variable BOT_TOKEN/
    );
  });

  // 12 & 13. Telegram Bot Integration: Unauthorized user block + Consecutive authorized workflow
  await runCase('12 & 13. Telegram authorization gate & multiple consecutive announcements', async () => {
    const apiCalls = [];
    const testSettings = loadSettings({
      BOT_TOKEN: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi',
      AUTHORIZED_USER_IDS: '777001,777002',
      TIMEZONE: 'Asia/Riyadh',
      LOCALE: 'ar-SA',
      MAX_ANNOUNCEMENT_LENGTH: '1200',
    });

    const { bot } = createBot(testSettings);
    bot.botInfo = {
      id: 123456789,
      is_bot: true,
      first_name: 'WASL Bot',
      username: 'wasl_test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    };

    // Intercept outgoing Telegram API calls on Telegram.prototype so all Context instances created
    // inside bot.handleUpdate() run offline against the real renderer without network calls
    const telegramProto = Object.getPrototypeOf(bot.telegram);
    const originalCallApi = telegramProto.callApi;
    telegramProto.callApi = async function mockedCallApi(method, payload) {
      apiCalls.push({ method, payload });
      if (method === 'sendMessage') {
        return { message_id: apiCalls.length + 100, chat: { id: payload.chat_id, type: 'private' } };
      }
      if (method === 'sendPhoto') {
        if (payload.photo && payload.photo.source && typeof payload.photo.source === 'string') {
          assert.ok(fs.existsSync(payload.photo.source), 'Photo file must exist when sent to Telegram');
        }
        return { message_id: apiCalls.length + 200, chat: { id: payload.chat_id, type: 'private' } };
      }
      return true;
    };

    try {

    // A) Unauthorized user (id=999999) sends text -> MUST be blocked and NOT render an image
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 999999, type: 'private' },
        from: { id: 999999, is_bot: false, first_name: 'Intruder' },
        text: 'اختبار اختراق غير مصرح',
      },
    });

    assert.strictEqual(apiCalls.length, 1);
    assert.strictEqual(apiCalls[0].method, 'sendMessage');
    assert.ok(apiCalls[0].payload.text.includes('مخصص للاستخدام الخاص'));

    // B) Authorized user (id=777001) sends 3 consecutive announcements + Regenerate action
    apiCalls.length = 0;
    for (let i = 1; i <= 3; i += 1) {
      await bot.handleUpdate({
        update_id: 10 + i,
        message: {
          message_id: 20 + i,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777001, type: 'private' },
          from: { id: 777001, is_bot: false, first_name: 'Owner' },
          text: `إعلان متتالي رقم ${i} من منصة وصل للخدمات الإلكترونية.`,
        },
      });
    }

    const photoCalls = apiCalls.filter((c) => c.method === 'sendPhoto');
    assert.strictEqual(photoCalls.length, 3, 'Expected 3 consecutive sendPhoto deliveries');

    // Verify temporary files in output/ were cleaned up after delivery!
    const leftoverFiles = (await fsp.readdir(path.resolve(__dirname, '..', 'output'))).filter(
      (f) => f.endsWith('.png')
    );
    assert.strictEqual(leftoverFiles.length, 0, 'All temporary PNG files must be cleaned up after delivery');

    // Test Preview Template button ("معاينة القالب")
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 20,
      message: {
        message_id: 40,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777001, type: 'private' },
        from: { id: 777001, is_bot: false, first_name: 'Owner' },
        text: MENU_BUTTONS.PREVIEW_TEMPLATE,
      },
    });
    const previewCall = apiCalls.find((c) => c.method === 'sendPhoto');
    assert.ok(previewCall, 'Expected preview template to call sendPhoto');
    assert.strictEqual(previewCall.payload.photo.source, templateConfig.assetPath);

    // Test Regenerate inline button ("إعادة إنشاء الصورة")
    apiCalls.length = 0;
    await bot.handleUpdate({
      update_id: 21,
      callback_query: {
        id: 'cbq-1',
        from: { id: 777001, is_bot: false, first_name: 'Owner' },
        message: {
          message_id: 50,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777001, type: 'private' },
        },
        chat_instance: 'ci-1',
        data: CALLBACK_ACTIONS.REGENERATE_IMAGE,
      },
    });
    assert.ok(
      apiCalls.some((c) => c.method === 'sendPhoto'),
      'Expected regenerate button to deliver freshly rendered image'
    );
    } finally {
      telegramProto.callApi = originalCallApi;
    }
  });

  // 14 & 15. Concurrent image-generation requests + PNG quality & dimensions verification
  await runCase('14 & 15. Concurrent parallel renders without state mixing + PNG quality check', async () => {
    const prompts = [
      'إعلان متزامن أول: خدمات التوثيق الإلكتروني السريع.',
      'إعلان متزامن ثانٍ: تحديث البيانات وإصدار التراخيص الفورية.',
      'إعلان متزامن ثالث: دعم فني متكامل عبر WASL على مدار 24 ساعة.',
      'إعلان متزامن رابع: عروض خاصة لقطاع الأعمال والمنشآت الصغيرة.',
      'إعلان متزامن خامس: تواصلوا معنا الآن لإنجاز معاملاتكم بكل يسر.',
    ];

    const outputs = await Promise.all(
      prompts.map((text, idx) =>
        generateAnnouncementImage(text, {
          now: new Date(Date.UTC(2026, 9, 31, 1, 40 + idx, 0)),
        })
      )
    );

    const uniquePaths = new Set(outputs.map((o) => o.outputPath));
    assert.strictEqual(uniquePaths.size, prompts.length, 'Every concurrent render must have a unique filename');

    // Ensure distinct renders produce distinct image buffers (no cross-talk) & exact 571x1024 PNGs
    const hashes = new Set();
    for (const out of outputs) {
      await assertStrictOutputIntegrity(out);
      hashes.add(crypto.createHash('sha256').update(out.buffer).digest('hex'));
      await cleanupOutputFile(out.outputPath);
    }
    assert.strictEqual(hashes.size, prompts.length, 'Concurrent renders must not mix text or buffers');
  });

  await shutdownRenderer();

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n------------------------------------------------------');
  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
