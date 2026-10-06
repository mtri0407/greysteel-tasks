const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 8951;
const CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';

// Trạng thái giả lập phía "server"
let sessionCookieIssued = false;   // đã đăng nhập lần đầu chưa (mô phỏng cookie httpOnly)
let driveFile = null;              // nội dung file dữ liệu trên Drive
let calendarEvents = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Giả lập Netlify Function: refresh-token
  if (url.pathname === '/.netlify/functions/refresh-token') {
    if (!sessionCookieIssued) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'no_session' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, access_token: 'AT_REFRESHED', expires_in: 3600 }));
  }
  // Giả lập Netlify Function: logout
  if (url.pathname === '/.netlify/functions/logout') {
    sessionCookieIssued = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  // Giả lập auth-callback: Google redirect về đây rồi quay lại app với #at=...
  if (url.pathname === '/.netlify/functions/auth-callback') {
    sessionCookieIssued = true;
    res.writeHead(302, { Location: `http://localhost:${PORT}/#at=AT_FIRST&exp=3600` });
    return res.end();
  }
  if (url.pathname === '/icon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'icon.svg')));
  }
  if (url.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'manifest.json')));
  }
  // index.html với CLIENT_ID đã điền sẵn
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html.replace('GOOGLE_CLIENT_ID: ""', `GOOGLE_CLIENT_ID: "${CLIENT_ID}"`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  // 401 từ /refresh-token khi chưa đăng nhập là hành vi đúng (chưa có phiên), không tính là lỗi
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('ERR_') && !t.includes('401')) errors.push('CONSOLE: ' + t);
  });

  // Chặn Google OAuth thật: giả lập người dùng đồng ý rồi Google redirect về auth-callback
  await page.route('https://accounts.google.com/o/oauth2/v2/auth**', route => {
    route.fulfill({ status: 302, headers: { Location: `http://localhost:${PORT}/.netlify/functions/auth-callback?code=good&state=x` }, body: '' });
  });
  await page.route('https://www.googleapis.com/oauth2/v3/userinfo', route => {
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ email: 'demo@gmail.com', name: 'Minh Tri', picture: '' }) });
  });
  await page.route('https://www.googleapis.com/drive/v3/files**', route => {
    const req = route.request(), url = req.url();
    if (req.method() === 'GET' && url.includes('spaces=appDataFolder')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ files: driveFile ? [{ id: 'f1', name: 'greysteel-tasks-data.json' }] : [] }) });
    }
    if (req.method() === 'GET' && url.includes('alt=media')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: driveFile || '{}' });
    }
    route.continue();
  });
  await page.route('https://www.googleapis.com/upload/drive/v3/files**', route => {
    const req = route.request();
    const body = req.postData() || '{}';
    if (req.method() === 'POST') {
      const m = body.match(/\{"tasks[\s\S]*\}/);
      driveFile = m ? m[0] : '{}';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'f1' }) });
    }
    driveFile = body;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'f1' }) });
  });
  await page.route('https://www.googleapis.com/calendar/v3/calendars/primary/events**', route => {
    const m = route.request().method();
    if (m === 'POST') { calendarEvents++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'evt' + calendarEvents }) }); }
    if (m === 'PATCH') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'evt1' }) });
    route.fulfill({ status: 200, body: '' });
  });

  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push('OK   ' + name); }
    catch (e) { results.push('FAIL ' + name + ' :: ' + e.message); }
  };

  // === 1. Màn hình đăng nhập ===
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(500);
  await step('Hiện màn hình đăng nhập khi chưa có phiên', async () => {
    assert(await page.isVisible('#authScreen'), 'authScreen phải hiện');
    assert(!(await page.isVisible('#appRoot')), 'appRoot phải ẩn');
  });
  await page.screenshot({ path: 'p_auth.png' });

  // === 2. Đăng nhập ===
  await page.click('#googleSignInBtn');
  await page.waitForTimeout(1200);
  await step('Đăng nhập thành công, vào được app', async () => {
    assert(await page.isVisible('#appRoot'), 'appRoot phải hiện sau đăng nhập');
    const url = page.url();
    assert(!url.includes('#at='), 'access_token phải được xoá khỏi URL sau khi dùng');
  });
  await page.screenshot({ path: 'p_home.png' });

  // === 3. Tải lại trang: KHÔNG được bắt đăng nhập lại (điểm mấu chốt user phàn nàn) ===
  await page.reload();
  await page.waitForTimeout(1200);
  await step('Tải lại trang vẫn giữ đăng nhập (silent refresh)', async () => {
    assert(await page.isVisible('#appRoot'), 'phải vào thẳng app, không hiện màn hình đăng nhập');
    assert(!(await page.isVisible('#authScreen')), 'authScreen phải ẩn');
  });

  // === 4. Trạng thái 3 mức của task ===
  await page.click('.navbtn:has-text("Danh sách việc")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("+ Thêm việc")');
  await page.fill('#f-title', 'Ôn ngữ pháp');
  await page.fill('#f-date', '2026-08-20');
  await page.click('#mSave');
  await page.waitForTimeout(500);
  await step('Tạo task và chuyển sang Đang làm', async () => {
    await page.click('.navbtn:has-text("Ma trận ưu tiên")');
    await page.waitForTimeout(300);
    const btn = page.locator('.taskcard button:has-text("Bắt đầu làm")').first();
    assert(await btn.count() > 0, 'phải có nút "Bắt đầu làm"');
    await btn.click();
    await page.waitForTimeout(400);
    assert(await page.locator('.taskcard.doing').count() > 0, 'task phải có trạng thái đang làm');
    assert(await page.locator('.tag-doing').count() > 0, 'phải có nhãn Đang làm');
  });
  await page.screenshot({ path: 'p_doing.png' });

  await step('Chuyển tiếp sang Hoàn thành', async () => {
    await page.locator('.taskcard button:has-text("Hoàn thành")').first().click();
    await page.waitForTimeout(400);
    assert(await page.locator('.taskcard.done').count() > 0, 'task phải chuyển sang hoàn thành');
  });

  // === 5. Lộ trình mục tiêu: tạo goal ===
  await page.click('.navbtn:has-text("Lộ trình mục tiêu")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'p_planner_empty.png' });
  await step('Tạo mục tiêu IELTS 7.0 với 3 giai đoạn', async () => {
    await page.click('button:has-text("+ Tạo mục tiêu mới")');
    await page.fill('#g-title', 'Đạt IELTS 7.0');
    await page.selectOption('#g-area', 'study');
    await page.selectOption('#g-unitpreset', 'band');
    await page.fill('#g-start', '3');
    await page.fill('#g-target', '7');
    await page.fill('#g-startdate', '2026-08-01');
    await page.fill('#g-targetdate', '2027-08-01');
    await page.fill('#g-phases', '3');
    await page.click('#mSave');
    await page.waitForTimeout(600);
    assert(await page.locator('.goal-card').count() === 1, 'phải có 1 thẻ mục tiêu');
  });
  await page.screenshot({ path: 'p_goal_list.png' });

  // === 6. Mở lộ trình, kiểm tra sườn 3 phase ===
  await step('Sườn 3 giai đoạn được dựng tự động với kỳ vọng nội suy', async () => {
    await page.click('button:has-text("Mở lộ trình")');
    await page.waitForTimeout(500);
    const n = await page.locator('.phase-card').count();
    assert(n === 3, 'phải có 3 giai đoạn, thực tế: ' + n);
    const text = await page.locator('.phase-card').first().innerText();
    assert(/4\.33|4\.3/.test(text), 'kỳ vọng phase 1 phải được nội suy (~4.33), thấy: ' + text.slice(0, 200));
  });
  await page.screenshot({ path: 'p_goal_detail.png' });

  // === 7. Ghi nhật ký ===
  await step('Ghi nhật ký và thấy nỗ lực tăng lên', async () => {
    await page.locator('button:has-text("Mở chi tiết & ghi nhật ký")').first().click();
    await page.waitForTimeout(500);
    await page.click('button:has-text("+ Ghi nhật ký hôm nay")');
    await page.fill('#lg-amount', '8');
    await page.fill('#lg-note', 'Học 8 giờ ngữ pháp');
    await page.click('#mSave');
    await page.waitForTimeout(700);
    const body = await page.innerText('body');
    assert(body.includes('Học 8 giờ ngữ pháp'), 'nhật ký phải hiện trong danh sách');
  });
  await page.screenshot({ path: 'p_phase_detail.png' });

  await step('Nhật ký tự tạo Task liên kết', async () => {
    await page.click('.navbtn:has-text("Danh sách việc")');
    await page.waitForTimeout(400);
    const body = await page.innerText('body');
    assert(body.includes('[Đạt IELTS 7.0]'), 'phải có task sinh ra từ nhật ký');
  });

  // === 8. Tổng kết giai đoạn + gợi ý điều chỉnh ===
  await step('Tổng kết phase với kết quả thấp hơn kỳ vọng sinh ra gợi ý giảm mục tiêu', async () => {
    await page.click('.navbtn:has-text("Lộ trình mục tiêu")');
    await page.waitForTimeout(400);
    await page.click('button:has-text("Mở lộ trình")');
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Tổng kết giai đoạn")').first().click();
    await page.waitForTimeout(400);
    await page.fill('#rt-actual', '4');   // thấp hơn kỳ vọng 4.33
    await page.waitForTimeout(400);
    const box = await page.innerText('#rt-analysis');
    assert(/Chưa đạt kỳ vọng/.test(box), 'phải nhận định chưa đạt kỳ vọng, thấy: ' + box.slice(0, 200));
    assert(await page.locator('#rt-apply').count() > 0, 'phải có nút áp dụng gợi ý');
  });
  await page.screenshot({ path: 'p_retro.png' });

  await step('Áp dụng gợi ý cập nhật được kỳ vọng phase sau', async () => {
    await page.click('#rt-apply');
    await page.waitForTimeout(500);
    const t = await page.innerText('#rt-apply');
    assert(t.includes('Đã áp dụng'), 'nút phải đổi trạng thái');
    await page.click('#mSave');
    await page.waitForTimeout(600);
  });

  await step('Kết quả thực tế hiện trong thẻ giai đoạn', async () => {
    const text = (await page.locator('.phase-card').first().innerText()).toLowerCase();
    assert(text.includes('thực tế'), 'phải có ô Thực tế');
    assert(text.includes('đã tổng kết'), 'phải đánh dấu đã tổng kết');
    assert(/\b4\b/.test(text), 'phải hiện giá trị thực tế 4');
  });
  await page.screenshot({ path: 'p_goal_after_retro.png' });

  // === 9. Dark mode + trang chủ hiện goal ===
  await step('Trang chủ hiện mục tiêu đang theo đuổi', async () => {
    await page.click('.navbtn:has-text("Trang chủ")');
    await page.waitForTimeout(400);
    const body = await page.innerText('body');
    assert(body.includes('Mục tiêu đang theo đuổi'), 'trang chủ phải có mục tiêu');
  });
  await page.screenshot({ path: 'p_home_goals.png' });

  await step('Dark mode hoạt động', async () => {
    await page.click('#themeToggle');
    await page.waitForTimeout(400);
    const theme = await page.getAttribute('body', 'data-theme');
    assert(theme === 'dark', 'phải chuyển sang dark');
  });
  await page.screenshot({ path: 'p_dark.png' });

  // === 10. Dữ liệu được lưu lên Drive và đọc lại được ===
  await step('Dữ liệu goals được lưu vào Drive', async () => {
    assert(driveFile, 'phải có file trên Drive');
    const parsed = JSON.parse(driveFile);
    assert(Array.isArray(parsed.goals) && parsed.goals.length === 1, 'phải lưu 1 goal');
    assert(parsed.goals[0].phases.length === 3, 'phải lưu 3 phase');
    assert(parsed.goals[0].phases[0].logs.length === 1, 'phải lưu nhật ký');
  });

  await step('Tải lại trang đọc lại đúng dữ liệu từ Drive', async () => {
    await page.reload();
    await page.waitForTimeout(1400);
    await page.click('.navbtn:has-text("Lộ trình mục tiêu")');
    await page.waitForTimeout(500);
    const body = await page.innerText('body');
    assert(body.includes('Đạt IELTS 7.0'), 'goal phải còn sau khi tải lại');
  });

  // === 11. Đăng xuất ===
  await step('Đăng xuất quay về màn hình đăng nhập', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(700);
    assert(await page.isVisible('#authScreen'), 'phải quay lại màn đăng nhập');
  });

  // === 12. Responsive mobile ===
  await step('Giao diện mobile không vỡ', async () => {
    const m = await context.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(`http://localhost:${PORT}/`);
    await m.waitForTimeout(600);
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    assert(w <= 400, 'không được tràn ngang trên mobile, scrollWidth=' + w);
    await m.screenshot({ path: 'p_mobile_auth.png' });
    await m.close();
  });


  // Buoc 11 da dang xuat nen mock server khong con phien; bat lai de cac test sau dang nhap duoc
  sessionCookieIssued = true;

  // === 13. Tao viec tu o ngay tren Lich (truoc day bi mat trang) ===
  await step('Tạo việc bằng cách bấm vào ngày trên Lịch', async () => {
    const p2 = await context.newPage();
    await p2.goto(`http://localhost:${PORT}/`);
    await p2.waitForTimeout(1500);
    await p2.click('.navbtn:has-text("Lịch")');
    await p2.waitForTimeout(600);
    const before = await p2.evaluate(() => state.tasks.length);
    await p2.locator('.cal-day').nth(14).click();
    await p2.waitForTimeout(500);
    const heading = await p2.innerText('#modalBody h2');
    assert(/Thêm việc mới/.test(heading), 'phải là "Thêm việc mới", thấy: ' + heading);
    await p2.fill('#modalBody #f-title', 'Việc tạo từ lịch');
    await p2.click('#modalBody #mSave');
    await p2.waitForTimeout(900);
    const after = await p2.evaluate(() => state.tasks.length);
    assert(after === before + 1, 'phải tạo thêm 1 việc, trước=' + before + ' sau=' + after);
    await p2.close();
  });

  // === 14. Tieu de co dau nhay kep khong bi cat khi sua ===
  await step('Tên việc có dấu nháy kép không bị cắt khi mở Sửa', async () => {
    const p3 = await context.newPage();
    await p3.goto(`http://localhost:${PORT}/`);
    await p3.waitForTimeout(1500);
    await p3.click('.navbtn:has-text("Danh sách việc")');
    await p3.waitForTimeout(500);
    await p3.click('button:has-text("+ Thêm việc")');
    const tricky = 'Đi họp "khẩn" <script>';
    await p3.fill('#modalBody #f-title', tricky);
    await p3.click('#modalBody #mSave');
    await p3.waitForTimeout(900);
    await p3.locator('tr', { hasText: 'Đi họp' }).locator('button:has-text("Sửa")').first().click();
    await p3.waitForTimeout(500);
    const val = await p3.inputValue('#modalBody #f-title');
    assert(val === tricky, 'giá trị phải nguyên vẹn, thấy: ' + val);
    await p3.close();
  });

  // === 15. Khong mat du lieu khi Drive loi tam thoi ===
  await step('Drive lỗi khi đọc thì KHOÁ ghi, không ghi đè dữ liệu cũ', async () => {
    const p5 = await context.newPage();
    await p5.route('https://www.googleapis.com/drive/v3/files**', route => {
      const req = route.request();
      if (req.method() === 'GET' && req.url().includes('spaces=appDataFolder')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ files: [{ id: 'f1', name: 'greysteel-tasks-data.json' }] }) });
      }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'boom' } }) });
    });
    let uploadCalled = false;
    await p5.route('https://www.googleapis.com/upload/drive/v3/files**', route => {
      uploadCalled = true;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'f1' }) });
    });
    await p5.goto(`http://localhost:${PORT}/`);
    await p5.waitForTimeout(1800);
    const loaded = await p5.evaluate(() => state.dataLoaded);
    assert(loaded === false, 'dataLoaded phải là false khi đọc lỗi');
    await p5.click('.navbtn:has-text("Danh sách việc")');
    await p5.waitForTimeout(400);
    await p5.click('button:has-text("+ Thêm việc")');
    await p5.fill('#modalBody #f-title', 'Không được ghi đè');
    await p5.click('#modalBody #mSave');
    await p5.waitForTimeout(1400);
    assert(uploadCalled === false, 'KHÔNG được ghi lên Drive khi chưa đọc được dữ liệu cũ');
    await p5.close();
  });

  // === 16. Mang chap chon khong lam mat phien dang nhap ===
  await step('Lỗi mạng tạm thời KHÔNG đăng xuất người dùng', async () => {
    const p6 = await context.newPage();
    let refreshHits = 0;
    await p6.route('**/.netlify/functions/refresh-token', route => {
      refreshHits++;
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'upstream' }) });
    });
    let logoutCalled = false;
    await p6.route('**/.netlify/functions/logout', route => { logoutCalled = true; route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
    await p6.goto(`http://localhost:${PORT}/`);
    await p6.waitForTimeout(4000);
    assert(refreshHits >= 2, 'phải thử lại nhiều lần khi lỗi tạm thời, thấy ' + refreshHits);
    assert(logoutCalled === false, 'KHÔNG được gọi logout (thu hồi phiên) chỉ vì lỗi mạng tạm thời');
    await p6.close();
  });

  // === 17. Hop thoai xac nhan xoa thay cho confirm() ===
  await step('Xoá dùng hộp thoại riêng, không dùng confirm() của trình duyệt', async () => {
    const p7 = await context.newPage();
    let nativeConfirmUsed = false;
    p7.on('dialog', async d => { nativeConfirmUsed = true; await d.dismiss(); });
    await p7.goto(`http://localhost:${PORT}/`);
    await p7.waitForTimeout(1500);
    await p7.click('.navbtn:has-text("Danh sách việc")');
    await p7.waitForTimeout(500);
    const del = p7.locator('table button:has-text("Xoá")').first();
    if (await del.count() > 0) {
      await del.click();
      await p7.waitForTimeout(500);
      assert(nativeConfirmUsed === false, 'không được dùng confirm() mặc định');
      assert(await p7.isVisible('#modalBg'), 'phải hiện hộp thoại xác nhận của app');
      const txt = await p7.innerText('#modalBody');
      assert(/Xác nhận/.test(txt), 'hộp thoại phải có tiêu đề Xác nhận');
    }
    await p7.close();
  });

  console.log('\n===== KẾT QUẢ =====');
  results.forEach(r => console.log(r));
  console.log('\nLỗi JS:', errors.length ? JSON.stringify(errors, null, 2) : 'không có');
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed === 0 ? '\n>>> TẤT CẢ TEST ĐỀU PASS' : `\n>>> ${failed} TEST THẤT BẠI`);

  await browser.close();
  server.close();
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
