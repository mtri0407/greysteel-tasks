/* Unit test cho public/datastore.js: migrate file cũ, gộp hai thiết bị, changelog.
   Nạp bằng vm như test_logic.js. Không gọi Drive thật. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/public/datastore.js', 'utf8'), sandbox);
const D = sandbox.GSData;
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, m) => assert.deepStrictEqual(plain(a), plain(b), m);

let fails = 0, count = 0;
function t(name, fn) { count++; try { fn(); console.log('OK  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); } }

/* File thật đúng định dạng app đang ghi (5 khoá, chưa có schemaVersion) */
const OLD = {
  tasks: [{ id: 't1', title: 'Ôn ngữ pháp "khẩn"', description: '', dueDate: '2026-08-20', dueTime: '09:00', quadrant: 2, status: 'doing',
    tags: 'học', subtasks: [{ t: 'a', done: true }], syncCalendar: true, calendarEventId: 'evt1',
    createdAt: '2026-08-13T10:00:00.000Z', updatedAt: '2026-08-13T10:00:00.000Z', completedAt: '' }],
  people: [{ id: 'p1', name: 'Mẹ', type: 'birthday', date: '1970-05-02', recurring: true, reminderDaysBefore: 1, calendarEventId: 'evt2', createdAt: '2026-08-01T00:00:00Z' }],
  notes: [{ id: 'n1', content: 'mật khẩu wifi', category: 'chung', pinned: true }],
  goals: [{ id: 'g1', title: 'IELTS 7.0', area: 'study', unit: 'band', startValue: 3, targetValue: 7, startDate: '2026-08-01', targetDate: '2027-08-01',
    logs: [], phases: [{ id: 'ph1', name: 'Nền tảng', startDate: '2026-08-01', endDate: '2026-11-29', expectedValue: 4.33, actualValue: '',
      weeklyTarget: 10, weeklyUnit: 'giờ', logs: [{ id: 'l1', date: '2026-08-10', amount: 8, taskId: 't9' }], retro: null, status: 'active', weeks: [] }] }],
  profile: { name: 'Trí', avatarEmoji: '🍊', theme: 'dark', notificationsEnabled: true, birthday: '2007-01-01' },
  someFutureKey: { keep: 'me' },
};

/* ---------------- Migrate ---------------- */
t('Migrate file cũ: không mất, không đổi nghĩa bất kỳ trường nào', () => {
  const { data, migrated, fromVersion } = D.migrateState(OLD);
  assert.strictEqual(migrated, true);
  assert.strictEqual(fromVersion, 1);
  // Mọi trường cũ còn nguyên giá trị
  const check = (oldV, newV, path) => {
    if (oldV && typeof oldV === 'object') Object.keys(oldV).forEach(k => check(oldV[k], newV[k], path + '.' + k));
    else assert.strictEqual(newV, oldV, 'đổi giá trị ở ' + path);
  };
  check(OLD, data, 'root');
  assert.strictEqual(data.tasks.length, 1); assert.strictEqual(data.goals[0].phases[0].logs.length, 1);
  eq(data.someFutureKey, { keep: 'me' }, 'khoá lạ phải được giữ');
});
t('Migrate thêm khoá mới với giá trị mặc định', () => {
  const { data } = D.migrateState(OLD);
  assert.strictEqual(data.schemaVersion, 2);
  ['blockTemplates', 'blocks', 'disruptions', 'checkins', 'changelogOutbox'].forEach(k => eq(data[k], [], k));
  assert.ok(Array.isArray(data.settings.sleepRules) && data.settings.sleepRules.length > 0);
  eq(data.calendarSync, { syncToken: '', lastSyncAt: '' });
  assert.strictEqual(data.goals[0].rank, null);
  assert.strictEqual(data.goals[0].timeBudgetMinPerWeek, null);
  assert.strictEqual(data.tasks[0].blockId, '');
  assert.strictEqual(data.tasks[0].estBlocks, 1);
});
t('Migrate không ghi đè trường mới nếu file đã có', () => {
  const v2 = D.migrateState(OLD).data;
  v2.goals[0].rank = 1; v2.goals[0].timeBudgetMinPerWeek = 1080; v2.settings.sleepRules = [{ wakeWeekdays: [1], start: '22:00', end: '05:00' }];
  const again = D.migrateState(v2);
  assert.strictEqual(again.migrated, false);
  assert.strictEqual(again.data.goals[0].rank, 1);
  assert.strictEqual(again.data.goals[0].timeBudgetMinPerWeek, 1080);
  eq(again.data.settings.sleepRules, v2.settings.sleepRules);
  eq(again.data, v2, 'chạy lại migrate phải cho đúng bản cũ');
});
t('Migrate file rỗng hoặc hỏng không lỗi', () => {
  ['', null, undefined, [], 'abc', {}].forEach(x => { const r = D.migrateState(x); assert.ok(Array.isArray(r.data.tasks)); });
});
t('Payload ghi lên Drive giữ khoá lạ và đủ khoá mới', () => {
  const d = D.migrateState(OLD).data;
  const p = D.buildPayload(d, D.extraKeysOf(d));
  eq(p.someFutureKey, { keep: 'me' });
  assert.strictEqual(p.schemaVersion, 2);
  eq(p.tasks, d.tasks);
  assert.ok('blocks' in p && 'calendarSync' in p && 'settings' in p);
});

/* ---------------- Gộp hai thiết bị ---------------- */
const base = D.migrateState(OLD).data;
const copy = x => JSON.parse(JSON.stringify(x));
t('Gộp: mỗi máy thêm một việc khác nhau thì giữ cả hai', () => {
  const local = copy(base), remote = copy(base);
  local.tasks.push({ id: 'tA', title: 'máy A', updatedAt: '2026-10-06T01:00:00Z' });
  remote.tasks.push({ id: 'tB', title: 'máy B', updatedAt: '2026-10-06T02:00:00Z' });
  const m = D.mergeStates(base, local, remote);
  eq(m.tasks.map(x => x.id), ['t1', 'tA', 'tB']);
});
t('Gộp: cùng sửa một việc thì bản updatedAt mới hơn thắng', () => {
  const local = copy(base), remote = copy(base);
  local.tasks[0].title = 'sửa ở A'; local.tasks[0].updatedAt = '2026-10-06T01:00:00Z';
  remote.tasks[0].title = 'sửa ở B'; remote.tasks[0].updatedAt = '2026-10-06T03:00:00Z';
  assert.strictEqual(D.mergeStates(base, local, remote).tasks[0].title, 'sửa ở B');
  remote.tasks[0].updatedAt = '2026-10-05T00:00:00Z';
  assert.strictEqual(D.mergeStates(base, local, remote).tasks[0].title, 'sửa ở A');
});
t('Gộp: chỉ một bên sửa thì lấy bên đã sửa (kể cả khi thiếu updatedAt)', () => {
  const local = copy(base), remote = copy(base);
  remote.notes[0].content = 'đổi ở B';
  assert.strictEqual(D.mergeStates(base, local, remote).notes[0].content, 'đổi ở B');
  local.goals[0].title = 'đổi ở A';
  assert.strictEqual(D.mergeStates(base, local, remote).goals[0].title, 'đổi ở A');
});
t('Gộp: xoá ở một bên không bị hồi sinh từ bên kia', () => {
  const local = copy(base), remote = copy(base);
  local.notes = [];
  eq(D.mergeStates(base, local, remote).notes, [], 'xoá ở máy này');
  const l2 = copy(base), r2 = copy(base); r2.people = [];
  eq(D.mergeStates(base, l2, r2).people, [], 'xoá ở máy kia');
});
t('Gộp: một bên xoá nhưng bên kia vừa sửa thì giữ bản đã sửa', () => {
  const local = copy(base), remote = copy(base);
  local.notes = []; remote.notes[0].content = 'vừa sửa'; remote.notes[0].updatedAt = '2026-10-06T00:00:00Z';
  assert.strictEqual(D.mergeStates(base, local, remote).notes[0].content, 'vừa sửa');
});
t('Gộp: thực thể xoá mềm (deletedAt) đi theo bản mới hơn', () => {
  const b = copy(base); b.blocks = [{ id: 'b1', start: 'x', updatedAt: '2026-10-06T00:00:00Z' }];
  const local = copy(b), remote = copy(b);
  local.blocks[0] = D.softDelete(local.blocks[0], '2026-10-06T05:00:00Z');
  remote.blocks[0].start = 'y'; remote.blocks[0].updatedAt = '2026-10-06T04:00:00Z';
  assert.strictEqual(D.mergeStates(b, local, remote).blocks[0].deletedAt, '2026-10-06T05:00:00Z');
});
t('Gộp: profile/settings gộp theo từng khoá; syncToken lấy cả cặp mới hơn', () => {
  const local = copy(base), remote = copy(base);
  local.profile.name = 'Trí A'; remote.profile.theme = 'light';
  const m = D.mergeStates(base, local, remote);
  assert.strictEqual(m.profile.name, 'Trí A'); assert.strictEqual(m.profile.theme, 'light');
  local.calendarSync = { syncToken: 'tokA', lastSyncAt: '2026-10-06T01:00:00Z' };
  remote.calendarSync = { syncToken: 'tokB', lastSyncAt: '2026-10-06T02:00:00Z' };
  eq(D.mergeStates(base, local, remote).calendarSync, remote.calendarSync);
});
t('Gộp: không có base (file mới tạo ở máy khác) vẫn giữ đủ dữ liệu hai bên', () => {
  const local = copy(base), remote = copy(base);
  remote.tasks.push({ id: 'tR', title: 'r' });
  const m = D.mergeStates({}, local, remote);
  eq(m.tasks.map(x => x.id), ['t1', 'tR']);
  eq(m.goals, base.goals);
});

/* ---------------- Backup & changelog ---------------- */
t('Tên file backup và changelog theo tháng', () => {
  assert.strictEqual(D.backupFileName('2026-10-06', 1), 'greysteel-tasks-backup-v1-2026-10-06.json');
  assert.strictEqual(D.changelogFileName('2026-10'), 'changelog-2026-10.json');
  const g = D.groupOutboxByMonth([{ id: 'a', createdAt: '2026-10-31T23:00:00+07:00' }, { id: 'b', createdAt: '2026-11-01T00:10:00+07:00' }]);
  eq(Object.keys(g).sort(), ['2026-10', '2026-11']);
});
t('Changelog chỉ ghi thêm và bỏ trùng theo id', () => {
  const doc1 = D.appendChangelog(null, [{ id: 'a', action: 'move' }]);
  const doc2 = D.appendChangelog(doc1, [{ id: 'a', action: 'move' }, { id: 'b', action: 'create' }]);
  eq(doc2.entries.map(e => e.id), ['a', 'b']);
  eq(doc1.entries.map(e => e.id), ['a'], 'không sửa bản cũ');
});

console.log(fails === 0 ? `\nTẤT CẢ ${count} TEST DỮ LIỆU PASS` : `\n${fails}/${count} TEST DỮ LIỆU THẤT BẠI`);
process.exit(fails === 0 ? 0 : 1);
