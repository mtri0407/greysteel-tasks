/* Unit test cho public/calsync.js (đồng bộ hai chiều Google Calendar, phần thuần).
   Nạp engine.js rồi calsync.js vào cùng một vm như trình duyệt. Không gọi mạng. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/public/engine.js', 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/public/calsync.js', 'utf8'), sandbox);
const E = sandbox.GSEngine, C = sandbox.GSCalSync;
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

let fails = 0, count = 0;
function t(name, fn) { count++; try { fn(); console.log('OK  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); } }

const seed = E.founderSeed();
const ctx = { sleepRules: seed.sleepRules, tzOffsetMin: 420 };
const NOW = '2026-10-05T07:00:00+07:00';
const base = E.generateWeekBlocks(seed.templates, '2026-10-05', [], NOW, ctx);
const appEv = (blockId, start, end, etag, extra) => Object.assign({ id: 'g-' + blockId, etag, status: 'confirmed',
  start: { dateTime: start }, end: { dateTime: end }, extendedProperties: { private: { gsApp: 'greysteel', gsBlockId: blockId } } }, extra || {});

t('Sự kiện của block mang dấu app trong extendedProperties.private và màu theo loại', () => {
  const b = base.find(x => x.type === 'protected');
  const body = C.blockEventBody(b, seed.goals, 'Asia/Ho_Chi_Minh');
  eq(body.extendedProperties.private, { gsApp: 'greysteel', gsBlockId: b.id, gsType: 'protected', gsGoalId: 'goal-gpa' });
  assert.strictEqual(body.colorId, C.COLOR_BY_TYPE.protected);
  assert.strictEqual(body.start.dateTime, b.start);
  assert.ok(/GPA/.test(body.description));
  assert.notStrictEqual(C.blockEventBody(base.find(x => x.type === 'buffer'), seed.goals, 'x').colorId, body.colorId);
});
t('Chỉ đẩy block của app còn hiệu lực; block đã xoá/mất chỗ thì xoá sự kiện', () => {
  assert.ok(C.shouldPush(base[0]));
  assert.ok(!C.shouldPush({ id: 'e', source: 'external', status: 'planned' }));
  assert.ok(C.shouldRemove(Object.assign({}, base[0], { gcalEventId: 'x', deletedAt: NOW })));
  assert.ok(C.shouldRemove(Object.assign({}, base[0], { gcalEventId: 'x', status: 'moved' })));
  assert.ok(!C.shouldRemove(Object.assign({}, base[0], { deletedAt: NOW })), 'chưa có sự kiện thì không cần xoá');
});
t('Tham số events.list: lần đầu dùng timeMin, sau đó chỉ syncToken (không kèm timeMin)', () => {
  const full = C.listParams('', '2026-10-04T00:00:00Z');
  assert.strictEqual(full.timeMin, '2026-10-04T00:00:00Z'); assert.ok(!('syncToken' in full));
  const inc = C.listParams('tok', '2026-10-04T00:00:00Z', 'p2');
  assert.strictEqual(inc.syncToken, 'tok'); assert.ok(!('timeMin' in inc)); assert.strictEqual(inc.pageToken, 'p2');
  assert.strictEqual(inc.singleEvents, full.singleEvents, 'cùng bộ tham số giữa các lần');
});
t('Chống vòng lặp: sự kiện có etag trùng lần app vừa ghi thì bỏ qua', () => {
  const b = Object.assign({}, base[0], { gcalEventId: 'g-' + base[0].id, gcalEtag: '"e1"' });
  const r = C.processEvents({ blocks: [b], events: [appEv(b.id, '2026-10-05T10:00:00+07:00', '2026-10-05T10:50:00+07:00', '"e1"')] }, NOW, ctx);
  assert.strictEqual(r.changes.length, 0);
  assert.strictEqual(r.blocks[0].start, b.start, 'không được áp giờ cũ/mới từ chính bản ghi của app');
});
t('Người dùng kéo block trên Google: cập nhật block, changelog cause gcal_sync', () => {
  const b = Object.assign({}, base.find(x => x.id === 'tpl-t2-hoc-2026-10-05-1'), { gcalEventId: 'g-x', gcalEtag: '"e1"' });
  const r = C.processEvents({ blocks: [b], events: [appEv(b.id, '2026-10-05T20:30:00+07:00', '2026-10-05T21:20:00+07:00', '"e2"')] }, NOW, ctx);
  assert.strictEqual(r.blocks[0].start, '2026-10-05T20:30:00+07:00');
  assert.strictEqual(r.blocks[0].gcalEtag, '"e2"');
  assert.strictEqual(r.changes.length, 1);
  assert.strictEqual(r.changes[0].cause, 'gcal_sync');
  assert.strictEqual(r.changes[0].before.start, b.start);
  assert.strictEqual(r.warnings.length, 0);
});
t('Kéo block vào giờ ngủ hoặc đè block cố định: chỉ cảnh báo, không tự đẩy ngược', () => {
  const b = Object.assign({}, base.find(x => x.id === 'tpl-t3-soloi-2026-10-06-1'), { gcalEtag: '"e1"' });
  const r = C.processEvents({ blocks: base.filter(x => x.id !== b.id).concat([b]),
    events: [appEv(b.id, '2026-10-06T21:30:00+07:00', '2026-10-06T22:15:00+07:00', '"e9"')] }, NOW, ctx);
  const nb = r.blocks.find(x => x.id === b.id);
  assert.strictEqual(nb.start, '2026-10-06T21:30:00+07:00', 'giữ đúng giờ người dùng đã kéo');
  assert.strictEqual(r.warnings[0].code, 'gcal_move_violation');
  assert.ok(r.warnings[0].violations.some(v => v.code === 'sleep'));
  const r2 = C.processEvents({ blocks: base.filter(x => x.id !== b.id).concat([b]),
    events: [appEv(b.id, '2026-10-06T08:00:00+07:00', '2026-10-06T08:45:00+07:00', '"e10"')] }, NOW, ctx);
  assert.ok(r2.warnings[0].violations.some(v => v.code === 'fixed'));
});
t('Xoá sự kiện của block trên Google: block xoá mềm (deletedAt), có changelog', () => {
  const b = Object.assign({}, base[0], { gcalEventId: 'g-' + base[0].id, gcalEtag: '"e1"' });
  const r = C.processEvents({ blocks: [b], events: [{ id: 'g-' + b.id, status: 'cancelled', etag: '"e2"', extendedProperties: { private: { gsApp: 'greysteel', gsBlockId: b.id } } }] }, NOW, ctx);
  assert.ok(r.blocks[0].deletedAt);
  assert.strictEqual(r.changes[0].action, 'delete');
});
t('KB4: sự kiện ngoài chồng block học -> lưu block fixed external và báo xung đột', () => {
  const ev = { id: 'meet1', etag: '"m1"', status: 'confirmed', summary: 'Họp mời', start: { dateTime: '2026-10-08T06:30:00Z' }, end: { dateTime: '2026-10-08T07:30:00Z' } };
  const r = C.processEvents({ blocks: base, events: [ev] }, NOW, ctx);
  const ext = r.blocks.find(b => b.id === 'ext-meet1');
  assert.ok(ext);
  assert.strictEqual(ext.type, 'fixed'); assert.strictEqual(ext.source, 'external');
  assert.strictEqual(ext.start, '2026-10-08T13:30:00+07:00', 'đổi về giờ địa phương');
  eq(r.conflicts, ['ext-meet1']);
  const d = C.disruptionForExternal(ext, NOW, ctx);
  assert.strictEqual(d.mode, 'fixed_time'); assert.ok(d.forced); assert.strictEqual(d.durationMin, 60);
  const p = E.propose(r.blocks, seed.goals, d, NOW, ctx);
  assert.strictEqual(p.moved.length, 2, 'phương án dời 2 block học bị chồng');
  // Lần đồng bộ sau thấy lại chính sự kiện đó (không đổi): không báo xung đột lần nữa
  const r2 = C.processEvents({ blocks: r.blocks, events: [ev] }, NOW, ctx);
  eq(r2.conflicts, []); assert.strictEqual(r2.changes.length, 0);
});
t('Sự kiện ngoài không chồng block nào thì không báo xung đột', () => {
  const r = C.processEvents({ blocks: base, events: [{ id: 'free', status: 'confirmed', summary: 'Cà phê', start: { dateTime: '2026-10-06T16:20:00+07:00' }, end: { dateTime: '2026-10-06T17:00:00+07:00' } }] }, NOW, ctx);
  eq(r.conflicts, []);
  assert.ok(r.blocks.some(b => b.id === 'ext-free'));
});
t('Bỏ qua: sự kiện cả ngày, sự kiện "rảnh", lời mời đã từ chối, sự kiện task/sinh nhật app tạo kiểu cũ', () => {
  const evs = [
    { id: 'allday', status: 'confirmed', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
    { id: 'free', status: 'confirmed', transparency: 'transparent', start: { dateTime: '2026-10-07T13:30:00+07:00' }, end: { dateTime: '2026-10-07T14:00:00+07:00' } },
    { id: 'decl', status: 'confirmed', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-07T13:30:00+07:00' }, end: { dateTime: '2026-10-07T14:00:00+07:00' } },
    { id: 'taskEvt', status: 'confirmed', start: { dateTime: '2026-10-07T13:30:00+07:00' }, end: { dateTime: '2026-10-07T14:00:00+07:00' } },
  ];
  const r = C.processEvents({ blocks: base, events: evs, knownEventIds: ['taskEvt'] }, NOW, ctx);
  assert.strictEqual(r.blocks.length, base.length, 'không tạo block nào');
  eq(r.conflicts, []);
});
t('Sự kiện ngoài bị huỷ hoặc đổi giờ: cập nhật block external', () => {
  const ev = { id: 'm', status: 'confirmed', summary: 'A', start: { dateTime: '2026-10-07T16:40:00+07:00' }, end: { dateTime: '2026-10-07T17:00:00+07:00' } };
  const r1 = C.processEvents({ blocks: base, events: [ev] }, NOW, ctx);
  const moved = Object.assign({}, ev, { start: { dateTime: '2026-10-07T13:30:00+07:00' }, end: { dateTime: '2026-10-07T14:30:00+07:00' } });
  const r2 = C.processEvents({ blocks: r1.blocks, events: [moved] }, NOW, ctx);
  assert.strictEqual(r2.blocks.find(b => b.id === 'ext-m').start, '2026-10-07T13:30:00+07:00');
  eq(r2.conflicts, ['ext-m'], 'đổi giờ sang chồng block GT còn tồn phải báo xung đột');
  const r3 = C.processEvents({ blocks: r2.blocks, events: [{ id: 'm', status: 'cancelled' }] }, NOW, ctx);
  assert.ok(r3.blocks.find(b => b.id === 'ext-m').deletedAt);
});
t('Đồng bộ đầy đủ (sau 410): sự kiện ngoài không còn trên Google thì xoá mềm', () => {
  const ext = { id: 'ext-gone', type: 'fixed', source: 'external', start: '2026-10-07T16:40:00+07:00', end: '2026-10-07T17:00:00+07:00', status: 'planned' };
  const r = C.processEvents({ blocks: base.concat([ext]), events: [], fullSync: true, fullSyncFrom: '2026-10-04T00:00:00Z' }, NOW, ctx);
  assert.ok(r.blocks.find(b => b.id === 'ext-gone').deletedAt);
  assert.ok(r.blocks.filter(b => b.source === 'template').every(b => !b.deletedAt), 'không đụng block của app');
});

console.log(fails === 0 ? `\nTẤT CẢ ${count} TEST CALENDAR PASS` : `\n${fails}/${count} TEST CALENDAR THẤT BẠI`);
process.exit(fails === 0 ? 0 : 1);
