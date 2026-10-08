/* Kiểm thử bản live sau khi deploy (không đăng nhập, không ghi dữ liệu). Xem TEST_PLAN.md.
   Chạy: node test_live.js [URL]   (mặc định https://greysteeltask.netlify.app) */
const { chromium } = require('playwright');
const { launchOptions } = require('./test_fake_google');
const BASE = (process.argv[2] || 'https://greysteeltask.netlify.app').replace(/\/$/, '');

function assert(c, m) { if (!c) throw new Error('ASSERT FAILED: ' + m); }

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Ho_Chi_Minh' });
  // Chặn mọi lời gọi Google API: test live không được đụng dữ liệu thật
  await context.route('https://www.googleapis.com/**', r => r.abort());
  const results = [];
  const step = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' :: ' + e.message.split('\n')[0]); } };

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|refresh-token/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  await step('Trang chủ: hiện nút đăng nhập, không lỗi JS hay CSP', async () => {
    assert(await page.isVisible('#googleSignInBtn'), 'phải thấy nút Đăng nhập với Google');
    assert(errors.length === 0, 'lỗi: ' + errors.join(' | '));
  });

  await step('File logic Lịch thông minh: 200, đúng kiểu, đã nạp vào trang', async () => {
    for (const f of ['engine.js', 'datastore.js', 'calsync.js']) {
      const r = await context.request.get(`${BASE}/${f}`);
      assert(r.status() === 200, f + ' status ' + r.status());
      assert(/javascript/.test(r.headers()['content-type'] || ''), f + ' content-type ' + r.headers()['content-type']);
    }
    const ok = await page.evaluate(() => !!(window.GSEngine && window.GSData && window.GSCalSync));
    assert(ok, 'thiếu GSEngine / GSData / GSCalSync');
  });

  await step('Engine trên bản live: kịch bản 1 của spec cho đúng kết quả', async () => {
    const r = await page.evaluate(() => {
      const E = GSEngine, s = E.founderSeed(), ctx = { sleepRules: s.sleepRules, tzOffsetMin: 420 };
      const now = '2026-10-05T07:00:00+07:00';
      const blocks = E.generateWeekBlocks(s.templates, '2026-10-05', [], now, ctx);
      const p = E.propose(blocks, s.goals, { id: 'd1', durationMin: 60, priority: 5, mode: 'fixed_time', fixedStart: '2026-10-06T18:00:00+07:00' }, now, ctx);
      return { start: p.placement && p.placement.start, buffer: p.placement && p.placement.bufferUsed, moved: p.moved.length };
    });
    assert(r.start === '2026-10-06T18:00:00+07:00' && r.buffer && r.moved === 0, JSON.stringify(r));
  });

  await step('Dán lịch nhanh trên bản live: đọc đúng "16h-18h30: Học giải tích"', async () => {
    const r = await page.evaluate(() => GSEngine.parseQuickSchedule('Thứ 6\n16h-18h30: Học giải tích', { defaultDate: '2026-10-08', weekStart: '2026-10-05' }).items[0]);
    assert(r && r.date === '2026-10-09' && r.start === '16:00' && r.end === '18:30' && r.title === 'Học giải tích', JSON.stringify(r));
  });

  await step('Function trợ lý AI chặn người chưa đăng nhập', async () => {
    const r = await context.request.post(BASE + '/.netlify/functions/assistant', { data: { messages: [] } });
    assert(r.status() === 401, 'status ' + r.status());
  });

  await step('Netlify Function refresh-token vẫn chạy (401 no_session khi chưa đăng nhập)', async () => {
    const r = await context.request.get(BASE + '/.netlify/functions/refresh-token');
    assert(r.status() === 401, 'status ' + r.status());
    assert((await r.json()).error === 'no_session');
  });

  await step('Giao diện điện thoại không tràn ngang', async () => {
    const m = await context.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(BASE + '/', { waitUntil: 'networkidle' });
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 400, 'scrollWidth=' + w);
    await m.close();
  });

  console.log('\n===== KIỂM THỬ BẢN LIVE: ' + BASE + ' =====');
  results.forEach(x => console.log(x));
  const failed = results.filter(x => x.startsWith('FAIL')).length;
  console.log(failed ? `\n>>> ${failed} TEST THẤT BẠI` : `\n>>> TẤT CẢ ${results.length} TEST LIVE ĐỀU PASS`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
