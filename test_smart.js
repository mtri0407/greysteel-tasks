/* Test Playwright cho Lịch thông minh (Mốc 2, 3, 4) trên app thật, Google API giả lập.
   Đồng hồ trình duyệt cố định theo kịch bản của spec, múi giờ Asia/Ho_Chi_Minh.
   Chạy: node test_smart.js (cần playwright; xem HUONG_DAN.md) */
const { chromium } = require('playwright');
const { createFakeGoogle, createAppServer, launchOptions } = require('./test_fake_google');

const PORT = 8952;
const URL0 = `http://localhost:${PORT}/`;
const G = createFakeGoogle();
const { server, st: SRV } = createAppServer(PORT, { signedIn: true });

/* File dữ liệu bản cũ (chưa có schemaVersion), đúng định dạng app đang ghi trước Mốc 2 */
const OLD_FILE = JSON.stringify({
  tasks: [{ id: 'old-t1', title: 'Việc cũ phải còn', dueDate: '2026-10-10', quadrant: 2, status: 'todo', subtasks: [], calendarEventId: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }],
  people: [], notes: [{ id: 'n1', content: 'ghi chú cũ', category: 'chung' }],
  goals: [{ id: 'g-ielts', title: 'IELTS', area: 'study', unit: 'band', startValue: 5, targetValue: 7, startDate: '2026-08-01', targetDate: '2027-08-01', phases: [] }],
  profile: { name: 'Trí', avatarEmoji: '🍊' },
});
G.driveCreate('greysteel-tasks-data.json', OLD_FILE);

const at = s => new Date(s); // ISO có múi giờ
function assert(c, m) { if (!c) throw new Error('ASSERT FAILED: ' + m); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' });
  await G.install(context);
  await context.grantPermissions(['notifications'], { origin: URL0.slice(0, -1) });
  // Ghi lại Web Notification thay vì hiện thật
  await context.addInitScript(() => {
    window.__notes = [];
    window.Notification = class { constructor(t, o) { window.__notes.push({ title: t, body: o && o.body }); } static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } close() {} };
  });
  await context.clock.setFixedTime(at('2026-10-05T07:00:00+07:00'));

  const errors = [];
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push('OK   ' + name); }
    catch (e) { results.push('FAIL ' + name + ' :: ' + e.message.split('\n')[0]); }
  };
  const watch = p => { p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_|401|404|410|500|502|503/.test(m.text())) errors.push('CONSOLE: ' + m.text()); }); };
  const idle = async p => {
    for (let i = 0; i < 3; i++) {
      await p.evaluate(() => calQueue);
      await p.waitForFunction(() => !state.saving && !saveInFlight && !changelogFlushing && !calPulling, null, { timeout: 15000 });
      await p.waitForTimeout(400);
    }
  };
  const open = async (p) => {
    await p.goto(URL0);
    await p.waitForFunction(() => state.dataLoaded === true, null, { timeout: 15000 });
    await idle(p);
  };
  const nav = async (p, label) => { await p.click(`.navbtn:has-text("${label}")`); await p.waitForTimeout(250); };
  const closeAnyModal = async p => { if (await p.isVisible('#modalBg.show')) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); } };

  let page = await context.newPage(); watch(page);
  await open(page);

  /* ======================= MỐC 2: dữ liệu ======================= */
  await step('Mở file bản cũ bình thường, chưa ghi gì khi chưa thao tác', async () => {
    assert(await page.isVisible('#appRoot'), 'phải vào app');
    assert(await page.evaluate(() => state.tasks.some(t => t.id === 'old-t1')), 'việc cũ phải còn');
    // Mở app có thể ghi ngay (lưu syncToken của Calendar). Nếu đã ghi thì backup phải có trước.
    if (G.dataFile().version > 1) {
      const bk = G.drive.calls.findIndex(c => c.startsWith('POST /upload'));
      const w = G.drive.calls.findIndex(c => c.startsWith('PATCH /upload/drive/v3/files/f1'));
      assert(bk >= 0 && bk < w, 'ghi file chính trước khi có backup');
      assert(G.driveByName('greysteel-tasks-backup-v1-2026-10-05.json').content === OLD_FILE, 'backup nguyên văn');
    }
  });

  await step('Nạp lịch khung mẫu: backup bản cũ trước, rồi mới ghi bản đã migrate', async () => {
    await nav(page, 'Lịch thông minh');
    await page.click('[data-tab="templates"]');
    await page.click('#loadSeed');
    await page.click('#cf-yes');
    await idle(page);
    const bk = G.driveByName('greysteel-tasks-backup-v1-2026-10-05.json');
    assert(bk, 'phải có file backup');
    assert(bk.content === OLD_FILE, 'backup phải giữ nguyên văn file cũ');
    const backupIdx = G.drive.calls.findIndex(c => c.startsWith('POST /upload'));
    const firstPatch = G.drive.calls.findIndex(c => c.startsWith('PATCH /upload/drive/v3/files/f1'));
    assert(backupIdx >= 0 && backupIdx < firstPatch, 'backup phải được tạo trước lần ghi file chính');
    const d = G.data();
    assert(d.schemaVersion === 2, 'file phải lên schemaVersion 2');
    assert(d.tasks.some(t => t.id === 'old-t1' && t.title === 'Việc cũ phải còn'), 'không mất việc cũ');
    assert(d.notes[0].content === 'ghi chú cũ');
    assert(d.blockTemplates.length === 27, 'phải có 27 block mẫu, thấy ' + d.blockTemplates.length);
    const gpa = d.goals.find(g => g.title === 'GPA');
    assert(gpa && gpa.rank === 1 && gpa.timeBudgetMinPerWeek === 1080, 'mục tiêu GPA hạng 1, 18 giờ');
    assert(d.goals.find(g => g.id === 'g-ielts').rank === null, 'mục tiêu cũ có rank mặc định null');
    assert(d.settings.sleepRules.length === 2);
  });

  await step('Sinh block tuần: block lên Google Calendar có extendedProperties.private, colorId, lưu gcalEventId', async () => {
    // Kịch bản của spec dùng lịch mẫu chia block 50 phút: bật công tắc trong cài đặt trước khi sinh tuần
    await page.click('[data-tab="sleep"]');
    await page.check('#st-split'); await idle(page);
    await page.click('[data-tab="week"]');
    await page.click('#genWeek');
    await idle(page);
    const d = G.data();
    const blocks = d.blocks.filter(b => b.source === 'template');
    assert(blocks.length === 39, 'tuần mẫu có 39 block, thấy ' + blocks.length);
    const evs = G.appEvents();
    assert(evs.length === blocks.length, `mỗi block một sự kiện, thấy ${evs.length}/${blocks.length}`);
    const b = blocks.find(x => x.id === 'tpl-t6-hocsau-2026-10-09-1');
    assert(b.gcalEventId && b.gcalEtag, 'block phải lưu gcalEventId và etag');
    const ev = G.cal.events.get(b.gcalEventId);
    assert(ev.extendedProperties.private.gsBlockId === b.id && ev.extendedProperties.private.gsType === 'protected', 'dấu của app');
    assert(ev.colorId === '11', 'màu theo loại protected');
    assert(await page.locator('.blk').count() >= 39, 'giao diện tuần phải hiện block');
  });

  await step('Changelog ghi vào file riêng theo tháng (chỉ ghi thêm), hàng chờ được dọn', async () => {
    const f = G.driveByName('changelog-2026-10.json');
    assert(f, 'phải có changelog-2026-10.json');
    const entries = JSON.parse(f.content).entries;
    assert(entries.filter(e => e.cause === 'template').length === 39, 'mỗi block sinh từ mẫu có 1 dòng changelog');
    assert(G.data().changelogOutbox.length === 0, 'outbox đã được dọn sau khi ghi');
  });

  await step('Chống ghi đè hai thiết bị: Drive đổi version thì đọc lại, gộp theo id rồi mới lưu', async () => {
    const remote = G.data();
    remote.tasks.push({ id: 'from-B', title: 'Từ máy khác', status: 'todo', quadrant: 4, subtasks: [], updatedAt: '2026-10-05T00:30:00.000Z' });
    remote.notes[0].content = 'máy B sửa ghi chú';
    G.writeData(remote);
    // Máy này sửa thứ khác
    await page.evaluate(() => { addNote({ content: 'ghi chú máy A', category: 'chung' }); });
    await idle(page);
    const d = G.data();
    assert(d.tasks.some(t => t.id === 'from-B'), 'giữ việc máy B thêm');
    assert(d.notes.some(n => n.content === 'ghi chú máy A'), 'giữ ghi chú máy A thêm');
    assert(d.notes.some(n => n.content === 'máy B sửa ghi chú'), 'giữ sửa đổi của máy B');
    assert(d.blocks.length >= 39, 'không mất block');
    assert(await page.evaluate(() => state.tasks.some(t => t.id === 'from-B')), 'giao diện máy A cũng có việc từ máy B');
  });

  /* ======================= MỐC 4: phát sinh -> duyệt ======================= */
  const addDisruption = async (p, f) => {
    await nav(p, 'Lịch thông minh');
    await p.click('[data-tab="week"]');
    await p.click('#addDisruption');
    await p.fill('#d-title', f.title);
    await p.fill('#d-dur', String(f.dur));
    await p.selectOption('#d-prio', String(f.prio));
    await p.selectOption('#d-mode', f.mode);
    if (f.mode === 'fixed_time') { await p.fill('#d-fdate', f.date); await p.fill('#d-ftime', f.time); }
    else { await p.fill('#d-wsdate', f.date); await p.fill('#d-wstime', f.from); await p.fill('#d-wedate', f.date); await p.fill('#d-wetime', f.to); }
    await p.click('#mSave');
    await p.waitForSelector('#rv-approve');
  };

  await step('KB1 qua giao diện: Họp BCS vào khung đệm, không dời gì; Duyệt thì lưu và lên Calendar', async () => {
    await addDisruption(page, { title: 'Họp BCS', dur: 60, prio: 5, mode: 'fixed_time', date: '2026-10-06', time: '18:00' });
    const pl = await page.innerText('#rv-placement');
    assert(/18:00 đến 19:00/.test(pl) && /khung đệm/.test(pl), 'phương án: ' + pl);
    assert(await page.locator('.rv-moved').count() === 0, 'không block nào bị dời');
    assert(/Block bị mất \(0\)/.test(await page.innerText('#modalBody')));
    assert(await page.locator('#rv-budget').count() === 1, 'phải có bảng ngân sách trước/sau');
    await page.click('#rv-approve');
    await idle(page);
    const d = G.data();
    const dis = d.disruptions.find(x => x.title === 'Họp BCS');
    assert(dis && dis.resolution === 'accepted', 'disruption phải được lưu là accepted');
    const blk = d.blocks.find(b => b.disruptionId === dis.id);
    assert(blk && blk.type === 'fixed' && blk.start === '2026-10-06T18:00:00+07:00', 'block mới');
    assert(blk.gcalEventId, 'block phát sinh cũng lên Calendar');
    const log = JSON.parse(G.driveByName('changelog-2026-10.json').content).entries;
    assert(log.some(e => e.cause === 'disruption' && e.causeId === dis.id), 'changelog cause disruption');
  });

  await step('KB2 qua giao diện: đệm đã kín, CLB ưu tiên 5 bị chặn, có 3 khung thay thế, nút Duyệt bị khoá; Bỏ thì lưu rejected', async () => {
    // làm kín phần còn lại của khung đệm 17:45 đến 19:30 (18:00 đến 19:00 đã có Họp BCS)
    await addDisruption(page, { title: 'Họp lớp', dur: 15, prio: 3, mode: 'fixed_time', date: '2026-10-06', time: '17:45' });
    await page.click('#rv-approve'); await idle(page);
    await addDisruption(page, { title: 'Họp nhóm', dur: 30, prio: 3, mode: 'fixed_time', date: '2026-10-06', time: '19:00' });
    await page.click('#rv-approve'); await idle(page);
    await addDisruption(page, { title: 'Họp CLB', dur: 90, prio: 5, mode: 'flexible', date: '2026-10-06', from: '17:00', to: '21:00' });
    assert(await page.isVisible('#rv-conflict'), 'phải hiện cảnh báo xung đột');
    assert(await page.locator('[data-alt]').count() === 3, 'phải có 3 khung thay thế');
    assert(await page.isDisabled('#rv-approve'), 'không cho duyệt khi không có khung hợp lệ');
    await page.click('#rv-reject'); await idle(page);
    assert(G.data().disruptions.find(x => x.title === 'Họp CLB').resolution === 'rejected');
  });

  await step('KB3 qua giao diện: ưu tiên 1 chiếm block bảo vệ thứ 6, 2 block bị dời được cập nhật cả trên Calendar', async () => {
    await addDisruption(page, { title: 'Việc gấp', dur: 120, prio: 1, mode: 'fixed_time', date: '2026-10-09', time: '09:00' });
    assert(await page.locator('.rv-moved').count() === 2, 'phải dời 2 block');
    const txt = await page.innerText('#modalBody');
    assert(/15:10/.test(txt), 'một block sang khung đệm 15:10');
    await page.click('#rv-approve'); await idle(page);
    const b = G.data().blocks.find(x => x.id === 'tpl-t6-hocsau-2026-10-09-2');
    assert(b.start === '2026-10-09T15:10:00+07:00', 'block đã dời: ' + b.start);
    assert(G.cal.events.get(b.gcalEventId).start.dateTime === '2026-10-09T15:10:00+07:00', 'sự kiện Google cũng được dời');
  });

  await step('Sửa: mở lại form với dữ liệu cũ, kết quả lưu là edited', async () => {
    await addDisruption(page, { title: 'Gọi điện', dur: 30, prio: 4, mode: 'fixed_time', date: '2026-10-08', time: '12:15' });
    await page.click('#rv-edit');
    assert(await page.inputValue('#d-title') === 'Gọi điện', 'form giữ dữ liệu');
    await page.fill('#d-ftime', '12:30');
    await page.click('#mSave'); await page.waitForSelector('#rv-approve');
    await page.click('#rv-approve'); await idle(page);
    const dis = G.data().disruptions.find(x => x.title === 'Gọi điện');
    assert(dis.resolution === 'edited', 'resolution phải là edited, thấy ' + dis.resolution);
    assert(dis.fixedStart === '2026-10-08T12:30:00+07:00');
  });

  /* ======================= MỐC 3: đọc ngược Google Calendar ======================= */
  await step('Chống vòng lặp: mở lại app, sự kiện của chính app không sinh thay đổi gcal_sync', async () => {
    await page.reload(); await page.waitForFunction(() => state.dataLoaded); await idle(page);
    await closeAnyModal(page);
    const log = JSON.parse(G.driveByName('changelog-2026-10.json').content).entries;
    assert(!log.some(e => e.cause === 'gcal_sync'), 'không được có thay đổi gcal_sync khi chỉ đọc lại sự kiện của app');
    const lists = G.cal.calls.filter(c => c.startsWith('GET'));
    assert(lists.some(c => /timeMin=/.test(c) && !/syncToken=/.test(c)), 'lần đầu đồng bộ đầy đủ');
    assert(lists.some(c => /syncToken=sync-/.test(c) && !/timeMin=/.test(c)), 'lần sau dùng syncToken, không kèm timeMin');
  });

  await step('KB4: lời mời họp 13:30 đến 14:30 thứ 5 chồng block học: lưu fixed external, hiện xung đột, chưa duyệt thì giữ nguyên', async () => {
    G.addExternal('Họp mời từ Google', '2026-10-08T13:30:00+07:00', '2026-10-08T14:30:00+07:00');
    await page.evaluate(() => smartTick()); // vòng kiểm tra 5 phút
    await idle(page);
    const d = G.data();
    const ext = d.blocks.find(b => b.source === 'external');
    assert(ext && ext.type === 'fixed', 'phải lưu block external fixed');
    const pend = d.disruptions.filter(x => x.source === 'external' && !x.resolution);
    assert(pend.length === 1, 'phải có 1 phương án đang chờ duyệt');
    assert(d.blocks.find(b => b.id === 'tpl-t5-hoc-2026-10-08-1').start === '2026-10-08T13:15:00+07:00', 'chưa duyệt thì block học giữ nguyên');
    await nav(page, 'Lịch thông minh');
    assert(await page.locator('.blk.conflict').count() >= 2, 'giao diện phải đánh dấu xung đột');
    assert(await page.evaluate(() => window.__notes.some(n => /chồng/.test(n.title))), 'phải có Web Notification báo xung đột');
    await page.click('.banner button:has-text("Xem phương án")');
    assert(await page.locator('.rv-moved').count() === 2, 'phương án dời 2 block học');
    assert(await page.locator('#rv-edit').count() === 0, 'sự kiện Google không có nút Sửa');
    await page.click('#rv-approve'); await idle(page);
    assert(await page.locator('.blk.conflict').count() === 0, 'duyệt xong hết xung đột');
    assert(G.data().disruptions.find(x => x.source === 'external').resolution === 'accepted');
  });

  await step('Người dùng kéo block trên Google: lần đồng bộ sau cập nhật block, changelog gcal_sync', async () => {
    const b = G.data().blocks.find(x => x.id === 'tpl-t2-truocgt-2026-10-05-1');
    G.moveEvent(b.gcalEventId, '2026-10-05T20:00:00+07:00', '2026-10-05T20:45:00+07:00');
    await page.evaluate(() => smartTick()); await idle(page);
    assert(G.data().blocks.find(x => x.id === b.id).start === '2026-10-05T20:00:00+07:00', 'block phải theo giờ mới');
    const log = JSON.parse(G.driveByName('changelog-2026-10.json').content).entries;
    assert(log.some(e => e.cause === 'gcal_sync' && e.entityId === b.id), 'changelog gcal_sync');
  });

  await step('Lỗi 410 (syncToken hết hạn): đồng bộ đầy đủ lại, app vẫn chạy', async () => {
    G.cal.gone = true;
    const before = G.cal.calls.length;
    await page.evaluate(() => smartTick()); await idle(page);
    const calls = G.cal.calls.slice(before).filter(c => c.startsWith('GET'));
    assert(calls.length >= 2 && /syncToken=/.test(calls[0]) && /timeMin=/.test(calls[1]), 'sau 410 phải gọi lại không syncToken: ' + calls.join(' | '));
    assert(/^sync-\d+$/.test(G.data().calendarSync.syncToken), 'lưu syncToken mới');
    assert(!G.data().blocks.filter(b => b.source === 'external').some(b => b.deletedAt), 'không xoá nhầm sự kiện ngoài còn tồn tại');
  });

  /* ======================= MỐC 4: check-in ======================= */
  await step('Gán 2 việc vào block GT còn tồn thứ 4', async () => {
    await page.evaluate(async () => {
      await addTask({ title: 'GT Câu 12 (a,b,e,f)', quadrant: 2, status: 'todo', estBlocks: 1, deadline: '2026-10-08' });
      await addTask({ title: 'GT Câu 13', quadrant: 2, status: 'todo', estBlocks: 1, deadline: '2026-10-08' });
    });
    await nav(page, 'Lịch thông minh');
    await page.click('.blk[data-block-id="tpl-t4-gtton-2026-10-07-1"] button:has-text("Gán việc")');
    await page.check('label:has-text("GT Câu 12") input');
    await page.check('label:has-text("GT Câu 13") input');
    await page.click('#mSave'); await idle(page);
    assert(G.data().tasks.filter(t => t.blockId === 'tpl-t4-gtton-2026-10-07-1').length === 2);
  });

  await step('Web Notification khi block kết thúc lúc app đang mở', async () => {
    await context.clock.setFixedTime(at('2026-10-07T15:05:00+07:00'));
    await page.evaluate(() => { window.__notes = []; smartMinuteTick(); });
    const notes = await page.evaluate(() => window.__notes);
    assert(notes.some(n => /GT còn tồn/.test(n.title)), 'phải báo block GT còn tồn vừa kết thúc: ' + JSON.stringify(notes));
  });

  await step('KB6 qua giao diện: mở app thấy hàng chờ check-in; Bỏ (mệt) -> 2 việc về hàng chờ -> đề xuất chỗ mới -> Duyệt', async () => {
    await context.clock.setFixedTime(at('2026-10-07T15:30:00+07:00'));
    await page.reload(); await page.waitForFunction(() => state.dataLoaded); await idle(page);
    assert(await page.isVisible('.ci-item'), 'mở app phải hiện hàng chờ check-in');
    const item = page.locator('.ci-item[data-ci="tpl-t4-gtton-2026-10-07-1"]');
    await item.locator('button[data-r="skipped"]').click();
    await item.locator('.ci-reason').selectOption('tired');
    await item.locator('.ci-save').click();
    await page.click('#mCancel'); // để sau phần còn lại -> sang màn bù giờ và xếp lại việc
    await page.waitForSelector('#rc-approve');
    const rows = await page.locator('.mk-row').allInnerTexts();
    assert(rows.length === 2, 'bù 90 phút thành 2 block: ' + rows.join(' | '));
    assert(/18:00/.test(rows[0]) && /50 phút/.test(rows[0]), 'block bù đầu vào khung đệm tối thứ 4: ' + rows[0]);
    assert(/40 phút/.test(rows[1]), rows[1]);
    assert(/Bù 90 phút/.test(await page.innerText('.mk-plan h3')));
    await page.click('#rc-approve'); await idle(page);
    const d = G.data();
    const ck = d.checkins.find(c => c.blockId === 'tpl-t4-gtton-2026-10-07-1');
    assert(ck && ck.result === 'skipped' && ck.reasonCode === 'tired' && ck.completedRatio === 0, 'check-in phải lưu đủ');
    assert(d.blocks.find(b => b.id === 'tpl-t4-gtton-2026-10-07-1').status === 'skipped');
    const ts = d.tasks.filter(t => /^GT Câu 1[23]/.test(t.title));
    const bu = d.blocks.filter(b => b.makeupFor === 'tpl-t4-gtton-2026-10-07-1');
    assert(bu.length === 2 && bu.every(b => b.source === 'makeup' && b.gcalEventId), 'có 2 block bù, đã lên Calendar');
    assert(ts.every(t => t.blockId === bu[0].id), 'việc chuyển sang block bù đầu tiên');
  });

  await step('Check-in một phần 50% từ thẻ block, lý do mất tập trung', async () => {
    await closeAnyModal(page);
    await nav(page, 'Lịch thông minh');
    await page.click('.blk[data-block-id="tpl-t4-baids-2026-10-07-1"] button:has-text("Check-in")');
    const item = page.locator('.ci-item[data-ci="tpl-t4-baids-2026-10-07-1"]');
    await item.locator('button[data-r="partial"]').click();
    await item.locator('.ci-ratio').selectOption('0.5');
    await item.locator('.ci-reason').selectOption('distracted');
    await item.locator('.ci-save').click(); await idle(page);
    const ck = G.data().checkins.find(c => c.blockId === 'tpl-t4-baids-2026-10-07-1');
    assert(ck.result === 'partial' && ck.completedRatio === 0.5 && ck.reasonCode === 'distracted');
    // Làm dở 50% của 105 phút: đề xuất bù khoảng 55 phút; bấm Để sau thì chưa có gì thay đổi
    assert(await page.isVisible('#rc-approve'), 'phải đề xuất xếp bù');
    assert(/Bù 53 phút/.test(await page.innerText('.mk-plan h3')), await page.innerText('.mk-plan h3'));
    await page.click('#mCancel'); await idle(page);
    assert(!G.data().blocks.some(b => b.makeupFor === 'tpl-t4-baids-2026-10-07-1'), 'Để sau thì không tạo block bù');
    await nav(page, 'Lịch thông minh');
    assert(await page.locator('.blk[data-block-id="tpl-t4-baids-2026-10-07-1"] button:has-text("Xếp bù")').count() === 1, 'thẻ block có nút Xếp bù');
  });

  await step('Màn hình ngân sách tuần: thanh theo mục tiêu xếp theo hạng, block bỏ không cộng vào đã làm', async () => {
    await closeAnyModal(page);
    await nav(page, 'Ngân sách tuần');
    const rows = await page.locator('.budget-row').evaluateAll(els => els.map(e => e.dataset.goal));
    const goals = await page.evaluate(() => state.goals.map(g => ({ id: g.id, title: g.title })));
    const gpaId = goals.find(g => g.title === 'GPA').id, gymId = goals.find(g => g.title === 'Gym').id;
    assert(rows.indexOf(gpaId) === 0 && rows.indexOf(gymId) === 1, 'GPA hạng 1 đứng đầu, Gym thứ hai');
    const txt = await page.innerText(`.budget-row[data-goal="${gpaId}"]`);
    assert(/đã làm/.test(txt) && /mục tiêu 18 giờ/.test(txt), txt);
    const wb = await page.evaluate(() => GSEngine.weekBudget(state.blocks, state.goals, state.checkins, '2026-10-05', nowIso(), smartCtx()).find(x => x.title === 'GPA'));
    assert(wb.doneMin === 53, 'đã làm = 50% của 105 phút bài ĐS (làm tròn), thấy ' + wb.doneMin);
    assert(/Mất tập trung|Mệt/.test(await page.innerText('#views')), 'thống kê lý do bỏ');
  });

  await step('Khung đệm trống: hỏi học thêm hay nghỉ; chọn Học thêm tạo block cho mục tiêu hạng 1', async () => {
    // Tạo một khung đệm trống ở tuần sau rồi xét lúc nó đang diễn ra
    await page.evaluate(() => { state.blocks.push({ id: 'buf-test', type: 'buffer', label: 'Khung đệm', start: '2026-10-12T17:45:00+07:00', end: '2026-10-12T19:30:00+07:00', status: 'planned', source: 'manual', goalId: '' }); });
    await context.clock.setFixedTime(at('2026-10-12T18:00:00+07:00'));
    await nav(page, 'Trang chủ');
    await page.click('.banner button:has-text("Học thêm")'); await idle(page);
    const d = G.data();
    const gpaId = d.goals.find(g => g.title === 'GPA').id;
    const nb = d.blocks.find(b => b.label === 'Học thêm (khung đệm)');
    assert(nb && nb.goalId === gpaId && nb.end === '2026-10-12T19:30:00+07:00', 'block học thêm cho GPA');
    assert(d.blocks.find(b => b.id === 'buf-test').bufferChoice === 'study');
  });

  /* ======================= HƯỚNG DẪN SỬ DỤNG ======================= */
  await step('Hướng dẫn: trang có đủ mục, tìm kiếm chỉ ẩn/hiện mục (không vẽ lại ô nhập)', async () => {
    await context.clock.setFixedTime(at('2026-10-07T16:00:00+07:00')); // về lại tuần đã sinh block
    await closeAnyModal(page);
    await nav(page, 'Hướng dẫn sử dụng');
    const n = await page.locator('.guide-sec').count();
    assert(n >= 12, 'phải có đủ các mục hướng dẫn, thấy ' + n);
    await page.fill('#guideSearch', 'khung đệm');
    const visible = await page.locator('.guide-sec:visible').count();
    assert(visible > 0 && visible < n, 'tìm kiếm phải lọc mục, thấy ' + visible);
    assert(await page.inputValue('#guideSearch') === 'khung đệm', 'ô tìm kiếm giữ nguyên chữ tiếng Việt');
    await page.fill('#guideSearch', 'zzzkhongco');
    assert(await page.isVisible('text=Không tìm thấy mục nào khớp'));
    await page.fill('#guideSearch', '');
  });

  await step('Hướng dẫn: nút "Làm thử" mở đúng màn hình, nút ❓ mở đúng mục', async () => {
    await page.locator('#guide-smart-setup summary').click();
    await page.click('#guide-smart-setup button:has-text("Mở Giờ ngủ")');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => state.view === 'schedule' && state.schedule.tab === 'sleep'), 'phải mở tab Giờ ngủ');
    await page.click('#helpBtn'); await page.waitForTimeout(600);
    assert(await page.evaluate(() => state.view === 'guide'), 'nút ❓ mở trang hướng dẫn');
    assert(await page.evaluate(() => document.getElementById('guide-smart-setup').open), 'mở đúng mục cài đặt lịch thông minh');
  });

  await step('Danh sách Bắt đầu nhanh tự đánh dấu theo dữ liệu thật', async () => {
    const items = await page.evaluate(() => smartChecklist().map(x => [x.id, x.done]));
    const done = Object.fromEntries(items);
    assert(done.rank && done.budget && done.template && done.sleep && done.week && done.disruption && done.checkin, JSON.stringify(items));
    assert(await page.locator('#smartChecklist .guide-item.done').count() === 7);
  });

  await step('Tour Lịch thông minh: chạy hết các bước, không lỗi, lưu đã xem và ẩn lời mời', async () => {
    await page.evaluate(() => { state.profile.guide = {}; });
    await nav(page, 'Trang chủ');
    assert(await page.isVisible('#tourInvite'), 'lần đầu phải có lời mời xem tour');
    await page.click('#tourInvite button:has-text("Xem tour")');
    const total = await page.evaluate(() => TOURS.smart.length);
    for (let i = 0; i < total; i++) {
      await page.waitForSelector('#tourCard', { state: 'visible' });
      await page.waitForTimeout(550);
      const txt = await page.innerText('#tourCard');
      assert(txt.includes(`${i + 1} / ${total}`), 'đúng số bước: ' + txt.slice(0, 40));
      const box = await page.locator('#tourCard').boundingBox();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 900, 'thẻ tour nằm trong màn hình ở bước ' + (i + 1));
      const lit = await page.evaluate(() => !!(tourState && tourState.el));
      assert(lit, 'bước ' + (i + 1) + ' phải làm nổi được một phần tử thật');
      await page.click('#tourNext');
    }
    await page.waitForTimeout(300);
    assert(!(await page.isVisible('#tourCard')), 'tour đã đóng');
    await idle(page);
    assert((G.data().profile.guide.tourSeen || {}).smart >= 1, 'lưu đã xem tour lên Drive');
    await nav(page, 'Trang chủ');
    assert(!(await page.isVisible('#tourInvite')), 'không mời lại sau khi đã xem');
  });

  await step('Tour toàn bộ app: Trước/Tiếp/Esc hoạt động', async () => {
    await nav(page, 'Hướng dẫn sử dụng');
    await page.click('#tourAppBtn');
    await page.waitForTimeout(500);
    await page.click('#tourNext'); await page.waitForTimeout(400);
    assert(/2 \//.test(await page.innerText('#tourCard')));
    await page.click('#tourPrev'); await page.waitForTimeout(400);
    assert(/1 \//.test(await page.innerText('#tourCard')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert(!(await page.isVisible('#tourCard')), 'Esc đóng tour');
  });

  /* ======================= TRỢ LÝ AI (máy chủ giả, không gọi Claude thật) ======================= */
  const aiReqs = [];
  const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const lastMsg = b => b.messages[b.messages.length - 1];
  const waitAiIdle = async () => { await page.waitForFunction(() => !AI.busy, null, { timeout: 15000 }); await page.waitForTimeout(150); };

  await step('Trợ lý: chưa bật API key thì báo rõ cho người dùng', async () => {
    await closeAnyModal(page);
    SRV.assistant = null;
    await page.click('#aiFab');
    assert(await page.isVisible('#aiPanel'), 'khung chat phải mở');
    assert(await page.locator('.ai-chip').count() === 4, 'có 4 câu hỏi gợi ý');
    await page.fill('#aiInput', 'xin chào');
    await page.click('#aiSendBtn'); await waitAiIdle();
    assert(/ANTHROPIC_API_KEY/.test(await page.innerText('#aiMsgs')), 'phải báo chưa cấu hình');
    await page.click('#aiNew');
  });

  await step('Trợ lý: gọi công cụ đọc dữ liệu trong trình duyệt, gửi kết quả lên, giữ nguyên thinking block', async () => {
    SRV.assistant = body => {
      aiReqs.push(body);
      const last = lastMsg(body);
      if (Array.isArray(last.content) && last.content[0].type === 'text')
        return { status: 200, json: { ok: true, stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: '', signature: 'sig-1' }, toolUse('tu1', 'get_week_budget', {})] } };
      return { status: 200, json: { ok: true, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tuần này **GPA**:\n- đã làm 0.9 giờ\n- còn trong kế hoạch 15 giờ' }] } };
    };
    await page.click('.ai-chip:has-text("Tuần này mục tiêu hạng 1")'); await waitAiIdle();
    assert(aiReqs.length === 2, 'phải có 2 lượt gọi (câu hỏi, rồi kết quả công cụ), thấy ' + aiReqs.length);
    const first = aiReqs[0].messages[0].content;
    assert(/Bối cảnh tự động/.test(first[0].text) && /2026-10-07T16:00/.test(first[0].text), 'gửi kèm thời điểm hiện tại: ' + first[0].text);
    const second = aiReqs[1].messages;
    assert(second[1].role === 'assistant' && second[1].content[0].signature === 'sig-1', 'thinking block gửi lại nguyên văn');
    const tr = second[2].content[0];
    assert(tr.type === 'tool_result' && tr.tool_use_id === 'tu1' && !tr.is_error, 'kết quả công cụ đúng định dạng');
    const data = JSON.parse(tr.content);
    assert(data.goals.some(g => g.goal === 'GPA' && g.target_hours === 18), 'đọc đúng ngân sách GPA từ dữ liệu thật');
    const txt = await page.innerText('#aiMsgs');
    assert(/còn trong kế hoạch 15 giờ/.test(txt) && await page.locator('.ai-msg.ai li').count() === 2, 'hiện câu trả lời dạng danh sách');
  });

  await step('Trợ lý: đề xuất việc phát sinh bằng engine, hiện thẻ, bấm thẻ mở màn duyệt; chưa duyệt thì không đổi dữ liệu', async () => {
    aiReqs.length = 0;
    SRV.assistant = body => {
      aiReqs.push(body);
      const last = lastMsg(body);
      if (last.content[0].type === 'text')
        return { status: 200, json: { ok: true, stop_reason: 'tool_use', content: [toolUse('tu2', 'propose_disruption',
          { title: 'Họp BCS tối thứ 6', duration_min: 60, priority: 5, mode: 'fixed_time', fixed_start: '2026-10-09T19:00' })] } };
      return { status: 200, json: { ok: true, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Mình đã chuẩn bị phương án, bạn bấm nút để xem và duyệt.' }] } };
    };
    const before = await page.evaluate(() => state.disruptions.length);
    await page.fill('#aiInput', 'Thứ 6 19h họp BCS 1 tiếng');
    await page.keyboard.press('Enter'); await waitAiIdle();
    const res = JSON.parse(lastMsg(aiReqs[1]).content[0].content);
    assert(res.ok && res.placement.start === '2026-10-09T19:00' && res.user_must_approve, 'engine tính phương án: ' + JSON.stringify(res).slice(0, 200));
    assert(await page.locator('.ai-card').count() >= 1, 'phải có thẻ đề xuất');
    assert(await page.evaluate(() => state.disruptions.length) === before, 'chưa duyệt thì chưa lưu gì');
    await page.locator('.ai-card').last().locator('button').click();
    await page.waitForSelector('#rv-approve');
    assert(/19:00 đến 20:00/.test(await page.innerText('#rv-placement')));
    await page.click('#rv-reject'); await idle(page);
  });

  await step('Trợ lý: lỗi công cụ (id block sai) trả về is_error để Claude tự sửa; đề xuất xếp bù mở màn bù giờ', async () => {
    aiReqs.length = 0;
    SRV.assistant = body => {
      aiReqs.push(body);
      const n = aiReqs.length;
      if (n === 1) return { status: 200, json: { ok: true, stop_reason: 'tool_use', content: [toolUse('tu3', 'propose_makeup', { block_id: 'khong-co' })] } };
      if (n === 2) return { status: 200, json: { ok: true, stop_reason: 'tool_use', content: [toolUse('tu4', 'propose_makeup', { block_id: 'tpl-t4-baids-2026-10-07-1' })] } };
      return { status: 200, json: { ok: true, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Bấm nút để xem đề xuất bù.' }] } };
    };
    await page.fill('#aiInput', 'Bài ĐS sáng nay mình làm dở, bù giúp');
    await page.click('#aiSendBtn'); await waitAiIdle();
    const r1 = lastMsg(aiReqs[1]).content[0];
    assert(r1.is_error === true && /Không tìm thấy block/.test(r1.content), 'id sai phải trả lỗi cho Claude');
    const r2 = JSON.parse(lastMsg(aiReqs[2]).content[0].content);
    assert(r2.missed_minutes === 53 && r2.makeup_blocks.length >= 1, JSON.stringify(r2));
    await page.locator('.ai-card').last().locator('button').click();
    await page.waitForSelector('#rc-approve');
    await page.click('#mCancel'); await page.waitForTimeout(300);
  });

  await step('Trợ lý: máy chủ lỗi tạm thời thì có nút Thử lại và thử lại được', async () => {
    let n = 0;
    SRV.assistant = () => (++n === 1 ? { status: 502, json: { ok: false, error: 'upstream_529' } }
      : { status: 200, json: { ok: true, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Đã kết nối lại.' }] } });
    await page.fill('#aiInput', 'thử lại nhé');
    await page.click('#aiSendBtn'); await waitAiIdle();
    await page.click('.ai-msg button:has-text("Thử lại")'); await waitAiIdle();
    assert(/Đã kết nối lại/.test(await page.innerText('#aiMsgs')));
    await page.click('#aiClose');
    assert(!(await page.isVisible('#aiPanel')), 'đóng khung chat');
  });

  /* ======================= DÁN LỊCH NHANH & XOÁ HÀNG LOẠT ======================= */
  const activeIn = (d, day) => d.blocks.filter(b => !b.deletedAt && b.start.startsWith(day));
  await step('Dán lịch nhanh: đọc văn bản, xem trước có cảnh báo, bỏ tích dòng, thêm block lên lịch và Google', async () => {
    await closeAnyModal(page);
    await nav(page, 'Lịch thông minh');
    await page.click('[data-tab="week"]');
    await page.click('#quickAdd');
    const txt = 'T5\n20h-21h: Học giải tích nhanh\n21h: Gọi điện\nghi chú không có giờ';
    await page.fill('#qa-text', txt);
    await page.waitForTimeout(500);
    assert(await page.locator('.qa-row').count() === 2, 'đọc được 2 dòng');
    const prev = await page.innerText('#qa-preview');
    assert(/T5 08\/10 20:00 - 21:00/.test(prev) && /Học giải tích nhanh/.test(prev), prev.slice(0, 200));
    assert(/tạm tính 60 phút/.test(prev), 'cảnh báo dòng thiếu giờ kết thúc');
    assert(/Không đọc được giờ ở 1 dòng/.test(prev), 'báo dòng không đọc được');
    assert(await page.inputValue('#qa-text') === txt, 'ô văn bản giữ nguyên chữ (không vẽ lại khi gõ)');
    await page.locator('.qa-row[data-ln="3"] .qa-on').uncheck();
    await page.waitForTimeout(200);
    assert(/Thêm 1 block/.test(await page.innerText('#qa-add')));
    await page.click('#qa-add'); await idle(page);
    const d = G.data();
    const b = d.blocks.find(x => x.label === 'Học giải tích nhanh');
    assert(b && b.start === '2026-10-08T20:00:00+07:00' && b.end === '2026-10-08T21:00:00+07:00' && b.source === 'manual' && b.energy === 'light', JSON.stringify(b));
    assert(b.gcalEventId, 'block mới lên Google Calendar');
    assert(!d.blocks.some(x => x.label === 'Gọi điện' && x.source === 'manual'), 'dòng đã bỏ tích không được thêm');
  });

  await step('Dán vào lịch khung: các dòng thành block mẫu theo thứ', async () => {
    await page.click('[data-tab="templates"]');
    const before = (await page.evaluate(() => state.blockTemplates.filter(t => !t.deletedAt).length));
    await page.click('#quickAddTpl');
    assert(await page.inputValue('#qa-target') === 'template');
    await page.fill('#qa-text', 'CN\n14h-15h: Ôn tuần\nThứ 2: 6h-6h30 Chạy bộ');
    await page.waitForTimeout(450);
    await page.selectOption('#qa-type', 'protected');
    await page.waitForTimeout(200);
    await page.click('#qa-add'); await idle(page);
    const t = G.data().blockTemplates.filter(x => !x.deletedAt);
    assert(t.length === before + 2, 'thêm 2 block mẫu');
    const on = t.find(x => x.label === 'Ôn tuần'), run = t.find(x => x.label === 'Chạy bộ');
    assert(on.weekday === 0 && on.start === '14:00' && on.type === 'protected', JSON.stringify(on));
    assert(run.weekday === 1 && run.end === '06:30');
  });

  await step('Xoá cả ngày có xác nhận, xoá luôn sự kiện Google, giữ sự kiện tự tạo trên Google; Hoàn tác khôi phục đủ', async () => {
    await page.click('[data-tab="week"]');
    const evBefore = G.appEvents().length;
    const nThu = activeIn(G.data(), '2026-10-08').filter(b => b.source !== 'external').length;
    await page.click('.day-del[data-day="2026-10-08"]');
    assert(/Xoá \d+ block của T5 08\/10/.test(await page.innerText('#modalBody')), 'hộp thoại xác nhận nêu rõ số block');
    assert(/sự kiện bạn tạo trên Google được giữ nguyên/.test(await page.innerText('#modalBody')));
    await page.click('#cf-yes'); await idle(page);
    let d = G.data();
    assert(activeIn(d, '2026-10-08').every(b => b.source === 'external'), 'chỉ còn sự kiện Google tự tạo');
    assert(G.appEvents().length === evBefore - nThu, `xoá đúng ${nThu} sự kiện trên Google`);
    assert(await page.isVisible('#undoBanner'));
    await page.click('#undoDelete'); await idle(page);
    d = G.data();
    assert(activeIn(d, '2026-10-08').filter(b => b.source !== 'external').length === nThu, 'hoàn tác khôi phục đủ block');
    assert(G.appEvents().length === evBefore, 'hoàn tác tạo lại sự kiện Google');
  });

  await step('Xoá cả tuần rồi Sinh block tuần này: block mẫu được tạo lại, block tự thêm vẫn đã xoá', async () => {
    await page.click('#clearWeek');
    await page.click('#cf-yes'); await idle(page);
    let d = G.data();
    const live = d.blocks.filter(b => !b.deletedAt && b.start >= '2026-10-05' && b.start < '2026-10-12' && b.source !== 'external');
    assert(live.length === 0, 'tuần đã trống, còn ' + live.length);
    await page.click('#genWeek'); await idle(page);
    d = G.data();
    const tpl = d.blocks.filter(b => !b.deletedAt && b.source === 'template' && b.start >= '2026-10-05' && b.start < '2026-10-12');
    assert(tpl.length === 41, 'sinh lại 39 block mẫu cũ và 2 block mẫu vừa dán, thấy ' + tpl.length);
    assert(tpl.every(b => b.status === 'planned' && b.gcalEventId), 'block sinh lại sạch và có trên Google');
    assert(!d.blocks.some(b => !b.deletedAt && b.label === 'Học giải tích nhanh'), 'block dán tay không tự quay lại');
    const ids = d.blocks.map(b => b.id);
    assert(new Set(ids).size === ids.length, 'không có id trùng sau khi sinh lại');
  });

  await step('Làm lại từ đầu: xoá tất cả block mọi tuần và xoá toàn bộ lịch khung, đều hoàn tác được', async () => {
    await page.click('[data-tab="sleep"]');
    await page.click('#clearAllBlocks');
    await page.click('#cf-yes'); await idle(page);
    assert(G.data().blocks.filter(b => !b.deletedAt && b.source !== 'external').length === 0, 'không còn block nào của app');
    await page.click('#undoDelete'); await idle(page);
    assert(G.data().blocks.filter(b => !b.deletedAt && b.source === 'template').length >= 41, 'hoàn tác xoá tất cả');
    await page.click('[data-tab="templates"]');
    await page.click('#clearTemplates');
    await page.click('#cf-yes'); await idle(page);
    assert(G.data().blockTemplates.every(t => t.deletedAt), 'lịch khung đã xoá hết');
    assert(await page.isVisible('#loadSeed'), 'lịch khung trống thì hiện lại nút Nạp lịch mẫu');
    await page.click('#undoDelete'); await idle(page);
    assert(G.data().blockTemplates.filter(t => !t.deletedAt).length === 29, 'hoàn tác lịch khung');
  });

  /* ======================= THÔNG BÁO QUA GOOGLE CALENDAR ======================= */
  await step('Block trên Google có nhắc trước 1 tiếng và lúc bắt đầu; khung đệm không nhắc', async () => {
    await page.evaluate(() => { state.settings.reminderVersion = 0; migrateReminders(); });
    await idle(page);
    const evs = G.appEvents();
    const study = evs.find(e => e.extendedProperties.private.gsBlockId === 'tpl-t5-hoc-2026-10-08-1');
    assert(study && JSON.stringify(study.reminders.overrides) === JSON.stringify([{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 0 }]), JSON.stringify(study && study.reminders));
    const buf = evs.find(e => e.extendedProperties.private.gsType === 'buffer');
    assert(buf && buf.reminders.overrides.length === 0, 'khung đệm không nhắc');
  });

  await step('Bản tin buổi sáng: mỗi ngày còn lại một sự kiện 06:00, tiêu đề tóm tắt lịch, đổi giờ thì cập nhật', async () => {
    await page.evaluate(() => scheduleBriefSync());
    await page.waitForTimeout(3600); await idle(page);
    let br = G.briefEvents();
    const days = br.map(e => e.extendedProperties.private.gsBrief).sort();
    assert(days.includes('2026-10-08') && days.includes('2026-10-09'), 'có bản tin các ngày tới: ' + days.join(','));
    assert(br.every(e => /T06:00:00\+07:00$/.test(e.start.dateTime)), 'mọi bản tin lúc 06:00');
    const thu = br.find(e => e.extendedProperties.private.gsBrief === '2026-10-08');
    assert(thu.start.dateTime === '2026-10-08T06:00:00+07:00' && thu.transparency === 'transparent', JSON.stringify(thu.start));
    assert(/^☀️ Hôm nay: 6h Lớp Nhập môn CNTT/.test(thu.summary), thu.summary);
    assert(/Lịch hôm nay:/.test(thu.description));
    assert(G.data().blocks.every(b => b.source !== 'external' || !/Hôm nay/.test(b.label)), 'bản tin không bị đọc ngược thành lịch bận');
    await nav(page, 'Lịch thông minh'); await page.click('[data-tab="sleep"]');
    await page.fill('#st-brieftime', '06:30'); await page.dispatchEvent('#st-brieftime', 'change');
    await page.waitForTimeout(3600); await idle(page);
    br = G.briefEvents();
    assert(br.find(e => e.extendedProperties.private.gsBrief === '2026-10-08').start.dateTime === '2026-10-08T06:30:00+07:00', 'đổi giờ bản tin');
    assert(br.length === days.length, 'cập nhật chứ không tạo trùng');
  });

  await step('Việc mới mặc định bật đồng bộ Calendar, nhắc trước 1 ngày và 1 tiếng; deadline vào bản tin', async () => {
    await nav(page, 'Danh sách việc');
    await page.click('button:has-text("+ Thêm việc")');
    assert(await page.isChecked('#modalBody #f-sync'), 'mặc định bật đồng bộ');
    await page.fill('#modalBody #f-title', 'Nộp bài tập lớn');
    await page.fill('#modalBody #f-date', '2026-10-09');
    await page.fill('#modalBody #f-time', '23:00');
    await page.click('#modalBody #mSave'); await idle(page);
    const t = G.data().tasks.find(x => x.title === 'Nộp bài tập lớn');
    const ev = G.cal.events.get(t.calendarEventId);
    assert(ev && JSON.stringify(ev.reminders.overrides) === JSON.stringify([{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }]), JSON.stringify(ev && ev.reminders));
    await page.waitForTimeout(3600); await idle(page);
    const fri = G.briefEvents().find(e => e.extendedProperties.private.gsBrief === '2026-10-09');
    assert(/⏰ 1 deadline/.test(fri.summary) && /Nộp bài tập lớn lúc 23:00/.test(fri.description), fri.summary);
  });

  /* ======================= ĐỒNG HỒ HỌC FLOWTIME ======================= */
  await step('Đồng hồ: bắt đầu từ block đang diễn ra, 10 phút khởi động, tới 50 phút mới hỏi, có chuông và thông báo', async () => {
    await context.clock.setFixedTime(at('2026-10-08T13:15:00+07:00'));
    await nav(page, 'Lịch thông minh'); await page.click('[data-tab="week"]');
    await page.click('.blk[data-block-id="tpl-t5-hoc-2026-10-08-1"] button.blk-go');
    assert(await page.inputValue('#fs-goal') === (await page.evaluate(() => state.goals.find(g => g.title === 'GPA').id)), 'tự chọn mục tiêu của block');
    await page.fill('#fs-first', 'mở đề GT câu 12');
    await page.click('#fs-go'); await page.waitForTimeout(1300);
    assert(await page.isVisible('#focusBar'), 'hiện thanh đồng hồ');
    assert(/Khởi động/.test(await page.innerText('#fbSub')), 'đang 10 phút khởi động');
    await context.clock.setFixedTime(at('2026-10-08T14:00:00+07:00')); await page.waitForTimeout(1300);
    assert(/^45:/.test(await page.innerText('#fbClock')), 'đếm 45 phút: ' + await page.innerText('#fbClock'));
    assert(!(await page.isVisible('#fbContinue')), 'chưa tới 50 phút thì chưa hỏi');
    await page.evaluate(() => { window.__notes = []; });
    await context.clock.setFixedTime(at('2026-10-08T14:05:00+07:00')); await page.waitForTimeout(1300);
    assert(await page.isVisible('#fbContinue'), 'tới 50 phút thì hỏi nghỉ hay học tiếp');
    assert(await page.evaluate(() => window.__notes.some(n => /đã học 50 phút/.test(n.title))), 'có thông báo');
    await page.click('#fbContinue');
    await context.clock.setFixedTime(at('2026-10-08T14:20:00+07:00')); await page.waitForTimeout(1300);
    assert(!(await page.isVisible('#fbContinue')), 'học tiếp thì 25 phút sau mới hỏi lại');
    await context.clock.setFixedTime(at('2026-10-08T14:30:00+07:00')); await page.waitForTimeout(1300);
    assert(await page.isVisible('#fbDoBreak'), 'hỏi lại ở phút 75');
    assert(/Nghỉ 15 phút/.test(await page.innerText('#fbDoBreak')), 'nghỉ khoảng 1/5 của 75 phút');
  });

  await step('Đồng hồ: nghỉ có ghi chú quay lại, hết giờ nghỉ thì báo, quay lại học, kết thúc thì lưu phút học', async () => {
    await page.fill('#fbNote', 'làm tiếp câu 13b');
    await page.click('#fbDoBreak'); await page.waitForTimeout(1200);
    assert(/làm tiếp câu 13b/.test(await page.innerText('#fbSub')), 'hiện ghi chú khi nghỉ');
    await page.evaluate(() => { window.__notes = []; });
    await context.clock.setFixedTime(at('2026-10-08T14:46:00+07:00')); await page.waitForTimeout(1300);
    assert(await page.evaluate(() => window.__notes.some(n => /Hết giờ nghỉ/.test(n.title) && /câu 13b/.test(n.body))), 'báo hết giờ nghỉ kèm việc cần làm');
    await page.click('#fbResume');
    await context.clock.setFixedTime(at('2026-10-08T15:01:00+07:00')); await page.waitForTimeout(1300);
    await page.reload(); await page.waitForFunction(() => state.dataLoaded); await idle(page); await closeAnyModal(page);
    await page.waitForTimeout(1300);
    assert(await page.isVisible('#focusBar'), 'tải lại trang đồng hồ vẫn chạy');
    await page.click('#fbStop'); await idle(page);
    const ses = G.data().focusSessions;
    assert(ses.length === 1 && ses[0].minutes === 90 && ses[0].breaks === 1, 'lưu 75 + 15 = 90 phút học thật: ' + JSON.stringify(ses[0] && { m: ses[0].minutes, b: ses[0].breaks }));
    assert(!G.data().settings.focusRun, 'không còn phiên đang chạy');
    await nav(page, 'Trang chủ');
    assert(/1 giờ 30 phút/.test(await page.innerText('#focusCard')), 'thẻ Trang chủ hiện thời gian học hôm nay');
  });

  await step('Check-in theo đồng hồ và ngân sách tuần cộng phút học thật', async () => {
    const before = await page.evaluate(() => GSEngine.weekBudget(state.blocks, state.goals, state.checkins, '2026-10-05', nowIso(), smartCtx(), []).find(x => x.title === 'GPA').doneMin);
    await nav(page, 'Lịch thông minh'); await page.click('[data-tab="week"]');
    await page.click('.blk[data-block-id="tpl-t5-hoc-2026-10-08-1"] button:has-text("Check-in")');
    const item = page.locator('.ci-item[data-ci="tpl-t5-hoc-2026-10-08-1"]');
    const html = await item.evaluate(e => e.innerHTML);
    assert(/Đồng hồ ghi <strong>50 phút<\/strong> \(100% block\)/.test(html), html.slice(0, 700));
    await item.locator('button[data-r="focus"]').click(); await idle(page);
    await closeAnyModal(page);
    const ck = G.data().checkins.find(c => c.blockId === 'tpl-t5-hoc-2026-10-08-1');
    assert(ck && ck.result === 'done' && ck.completedRatio === 1 && /theo đồng hồ 50 phút/.test(ck.note), JSON.stringify(ck));
    const after = await page.evaluate(() => GSEngine.weekBudget(state.blocks, state.goals, state.checkins, '2026-10-05', nowIso(), smartCtx(), focusAllSessions()).find(x => x.title === 'GPA'));
    assert(after.doneMin - before === 90, 'cộng đúng 90 phút (50 trong block đã check-in + 40 ngoài block), thấy ' + (after.doneMin - before));
    await nav(page, 'Ngân sách tuần');
    assert(/đồng hồ/.test(await page.innerText('#views')), 'màn ngân sách ghi rõ phần từ đồng hồ');
    await context.clock.setFixedTime(at('2026-10-07T16:00:00+07:00'));
  });

  await step('Giao diện Lịch thông minh trên điện thoại không tràn ngang', async () => {
    const m = await context.newPage(); watch(m);
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(URL0); await m.waitForFunction(() => state.dataLoaded); await idle(m);
    await closeAnyModal(m);
    for (const label of ['Lịch thông minh', 'Ngân sách tuần', 'Hướng dẫn sử dụng']) {
      await m.click(`.navbtn:has-text("${label}")`); await m.waitForTimeout(300);
      const w = await m.evaluate(() => document.documentElement.scrollWidth);
      assert(w <= 400, `${label}: scrollWidth=${w}`);
    }
    await m.click('#aiFab'); await m.waitForTimeout(300);
    const pb = await m.locator('#aiPanel').boundingBox();
    assert(pb && pb.width <= 390 && pb.x >= 0, 'khung chat vừa màn hình điện thoại');
    await m.click('#aiClose');
    await m.click('#tourSmartBtn'); await m.waitForTimeout(800);
    const box = await m.locator('#tourCard').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, 'thẻ tour nằm gọn trên điện thoại');
    await m.keyboard.press('Escape');
    await m.close();
  });

  console.log('\n===== KẾT QUẢ LỊCH THÔNG MINH =====');
  results.forEach(r => console.log(r));
  console.log('\nLỗi JS:', errors.length ? JSON.stringify(errors, null, 2) : 'không có');
  const failed = results.filter(r => r.startsWith('FAIL')).length;
  console.log(failed === 0 && !errors.length ? `\n>>> TẤT CẢ ${results.length} TEST ĐỀU PASS` : `\n>>> ${failed} TEST THẤT BẠI`);
  await browser.close(); server.close();
  process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
})();
