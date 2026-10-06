/* Unit test cho engine Lịch thông minh (public/engine.js).
   Nạp file theo đúng cách test_logic.js đang làm: đọc nguồn rồi chạy trong vm, lấy API từ
   biến global. Dữ liệu seed lấy từ Phụ lục của spec (founderSeed). Không gọi mạng. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(__dirname + '/public/engine.js', 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const E = sandbox.GSEngine;
// so sánh sâu giữa object tạo trong vm và object của Node: đưa về JSON
const plain = x => JSON.parse(JSON.stringify(x));
const eq = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

let fails = 0, count = 0;
function t(name, fn) {
  count++;
  try { fn(); console.log('OK  ', name); }
  catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); }
}

const seed = E.founderSeed();
const ctx = { sleepRules: seed.sleepRules, tzOffsetMin: 420 };
const NOW = '2026-10-05T07:00:00+07:00';      // sáng thứ 2 đầu tuần
const WEEK = '2026-10-05';
const base = E.generateWeekBlocks(seed.templates, WEEK, [], NOW, ctx);
const goals = seed.goals;
const P = s => E.time.parseTime(s, 420);
const overlaps = (a, b) => P(a.start) < P(b.end) && P(b.start) < P(a.end);
const byId = (blocks, id) => blocks.find(b => b.id === id);
const gpa = budget => budget.find(x => x.goalId === 'goal-gpa');
const sleepsOfWeek = E.time.sleepIntervals(seed.sleepRules, P('2026-10-04T00:00:00+07:00'), P('2026-10-13T00:00:00+07:00'), 420)
  .map(z => ({ start: E.time.toISO(z.s, 420), end: E.time.toISO(z.e, 420) }));
const inSleep = slot => sleepsOfWeek.some(z => overlaps(slot, z));

/* ======================= Nạp file & tính thuần ======================= */
t('engine.js nạp được bằng vm (như test_logic.js) và bằng require', () => {
  assert.ok(E && typeof E.propose === 'function');
  const viaRequire = require('./public/engine.js');
  assert.strictEqual(typeof viaRequire.propose, 'function');
});
t('engine.js không truy cập DOM, mạng, Drive và không tự gọi Date.now()/new Date()', () => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/Date\.now\s*\(/.test(code), 'không được gọi Date.now()');
  assert.ok(!/new Date\(\s*\)/.test(code), 'không được gọi new Date() không tham số');
  [/\bdocument\./, /\bwindow\./, /\bfetch\(/, /\blocalStorage\b/, /\bXMLHttpRequest\b/].forEach(w => assert.ok(!w.test(code), 'không được dùng ' + w));
});
t('Trọng số chi phí 1 / 10 / 50 nằm trong object cấu hình', () => {
  assert.strictEqual(E.ENGINE_CONFIG.weights.buffer, 1);
  assert.strictEqual(E.ENGINE_CONFIG.weights.flexible, 10);
  assert.strictEqual(E.ENGINE_CONFIG.weights.protected, 50);
});

/* ======================= Lịch khung ======================= */
t('Sinh block tuần từ lịch khung: tách "4 block" thứ 6 thành 4 block 50 phút', () => {
  const fri = base.filter(b => b.templateId === 't6-hocsau');
  assert.strictEqual(fri.length, 4);
  eq(fri.map(b => b.start.slice(11, 16)), ['08:00', '09:00', '10:00', '11:00']);
  eq(fri.map(b => b.end.slice(11, 16)), ['08:50', '09:50', '10:50', '11:50']);
  assert.ok(fri.every(b => b.start.startsWith('2026-10-09') && b.start.endsWith('+07:00')));
  assert.ok(fri.every(b => b.type === 'protected' && b.goalId === 'goal-gpa' && b.status === 'planned' && b.source === 'template'));
});
t('Sinh block lại lần nữa không tạo trùng (id tất định)', () => {
  const again = E.generateWeekBlocks(seed.templates, WEEK, base, NOW, ctx);
  assert.strictEqual(again.length, 0);
  const fresh = E.generateWeekBlocks(seed.templates, WEEK, [], NOW, ctx);
  eq(plain(fresh), plain(base));
});
t('Block "Về Hải Phòng" kéo sang sáng hôm sau; block hạn 24h có deadline', () => {
  const hp = base.find(b => b.templateId === 't7-quehp');
  assert.strictEqual(hp.start, '2026-10-10T16:30:00+07:00');
  assert.strictEqual(hp.end, '2026-10-11T08:00:00+07:00');
  const gt = base.find(b => b.templateId === 't3-baigt');
  assert.strictEqual(gt.deadline, '2026-10-07T11:20:00+07:00');
});

/* ======================= 6 kịch bản nghiệm thu ======================= */
t('KB1: Họp BCS 60p ưu tiên 5 cố định 18:00 thứ 3 -> vào khung đệm, không dời gì, GPA không đổi', () => {
  const d = { id: 'd1', title: 'Họp BCS', durationMin: 60, priority: 5, mode: 'fixed_time', fixedStart: '2026-10-06T18:00:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.ok(p.ok, JSON.stringify(p.warnings));
  assert.strictEqual(p.placement.start, '2026-10-06T18:00:00+07:00');
  assert.strictEqual(p.placement.end, '2026-10-06T19:00:00+07:00');
  assert.strictEqual(p.placement.bufferUsed, true);
  assert.strictEqual(p.placement.cost, 1);
  const buf = byId(base, 'tpl-t3-dem-2026-10-06-1');
  assert.ok(overlaps(p.placement, buf), 'phải nằm trong khung đệm 17:45 đến 19:30');
  assert.strictEqual(p.moved.length, 0);
  assert.strictEqual(p.lost.length, 0);
  assert.strictEqual(gpa(p.budget_after).plannedMin, gpa(p.budget_before).plannedMin);
});

// Khung đệm tối thứ 3 đã kín: một việc cố định đã được duyệt trước đó chiếm trọn 17:45 đến 19:30
function withBufferFull() {
  const d0 = { id: 'd0', title: 'Họp lớp', durationMin: 105, priority: 3, mode: 'fixed_time', fixedStart: '2026-10-06T17:45:00+07:00' };
  const p0 = E.propose(base, goals, d0, NOW, ctx);
  assert.ok(p0.ok);
  return E.applyProposal(base, p0, d0, NOW, ctx).blocks;
}
t('KB2: đệm thứ 3 đã kín, Họp CLB 90p ưu tiên 5 linh hoạt 17:00 đến 21:00 -> xung đột + 3 khung thay thế', () => {
  const blocks = withBufferFull();
  const d = { id: 'd2', title: 'Họp CLB', durationMin: 90, priority: 5, mode: 'flexible',
    windowStart: '2026-10-06T17:00:00+07:00', windowEnd: '2026-10-06T21:00:00+07:00' };
  const p = E.propose(blocks, goals, d, NOW, ctx);
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.placement, null);
  assert.ok(p.warnings.some(w => w.code === 'conflict'), 'phải có cảnh báo xung đột');
  assert.ok(p.warnings.find(w => w.code === 'conflict').reasons.priority > 0, 'lý do: không được đẩy block GPA ưu tiên cao hơn');
  assert.strictEqual(p.moved.length, 0, 'không được dời block GPA 19:45');
  assert.strictEqual(p.alternatives.length, 3, 'phải có đúng 3 khung thay thế');
  const soloi = byId(blocks, 'tpl-t3-soloi-2026-10-06-1');
  p.alternatives.forEach(a => {
    assert.ok(!overlaps(a, soloi), 'khung thay thế không được đè block GPA 19:45');
    assert.ok(!inSleep(a), 'khung thay thế không được vào giờ ngủ');
    assert.strictEqual(P(a.end) - P(a.start), 90 * 60000);
    assert.ok(a.distanceMin > 0, 'khung thay thế nằm ngoài khung đã chọn');
  });
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlaps(p.alternatives[i], p.alternatives[j]), 'các khung thay thế không chồng nhau');
});

const friProt = n => `tpl-t6-hocsau-2026-10-09-${n}`;
t('KB3: việc ưu tiên 1, 120p, cố định 9:00 thứ 6 -> chiếm block protected, dời sang đệm cuối thứ 6 và khung trống gần nhất', () => {
  const d = { id: 'd3', title: 'Việc gấp', durationMin: 120, priority: 1, mode: 'fixed_time', fixedStart: '2026-10-09T09:00:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.ok(p.ok, JSON.stringify(p.warnings));
  assert.strictEqual(p.placement.start, '2026-10-09T09:00:00+07:00');
  assert.strictEqual(p.placement.cost, 50 + 2, 'chồng protected (50) + 2 block phải dời');
  eq(p.moved.map(m => m.blockId).sort(), [friProt(2), friProt(3)]);
  const m2 = p.moved.find(m => m.blockId === friProt(2)), m3 = p.moved.find(m => m.blockId === friProt(3));
  assert.strictEqual(m2.via, 'buffer');
  assert.strictEqual(m2.to.start, '2026-10-09T15:10:00+07:00', 'block đầu sang khung đệm cuối thứ 6');
  assert.strictEqual(m3.via, 'energy');
  assert.strictEqual(m3.to.start, '2026-10-09T11:50:00+07:00', 'block sau vào khoảng trống buổi sáng gần nhất');
  assert.strictEqual(p.lost.length, 0);
  assert.strictEqual(gpa(p.budget_after).plannedMin, gpa(p.budget_before).plannedMin, 'dời đủ thì GPA không hụt');
});
t('KB3b: hết chỗ trong hạn thì block vào lost và hiện số phút GPA bị hụt', () => {
  // Lấp kín các khoảng trống thứ 6 bằng việc cố định để block thứ hai không còn chỗ
  const fill = [['07:00', '08:00'], ['11:50', '13:15'], ['16:00', '16:30'], ['18:00', '23:00']].map(([s, e], i) => ({
    id: 'fill' + i, type: 'fixed', source: 'external', start: `2026-10-09T${s}:00+07:00`, end: `2026-10-09T${e}:00+07:00`, status: 'planned' }));
  const blocks = base.concat(fill);
  const d = { id: 'd3b', title: 'Việc gấp', durationMin: 120, priority: 1, mode: 'fixed_time', fixedStart: '2026-10-09T09:00:00+07:00' };
  const p = E.propose(blocks, goals, d, NOW, ctx);
  assert.ok(p.ok);
  assert.strictEqual(p.moved.length, 1);
  assert.strictEqual(p.moved[0].via, 'buffer');
  assert.strictEqual(p.lost.length, 1);
  assert.strictEqual(p.lostMinByGoal['goal-gpa'], 50);
  assert.strictEqual(gpa(p.budget_before).plannedMin - gpa(p.budget_after).plannedMin, 50, 'ngân sách GPA sau phải giảm đúng 50 phút');
  assert.ok(p.warnings.some(w => w.code === 'lost_blocks'));
});
t('KB4: sự kiện Google 13:30 đến 14:30 thứ 5 chồng block học -> fixed external, phương án dời block; chưa duyệt thì vẫn còn xung đột', () => {
  const ext = { id: 'ext-ev1', type: 'fixed', source: 'external', label: 'Họp mời', start: '2026-10-08T13:30:00+07:00',
    end: '2026-10-08T14:30:00+07:00', status: 'planned', gcalEventId: 'ev1' };
  const blocks = base.concat([ext]);
  const conflicts = E.findConflicts(blocks, ctx);
  eq(conflicts.map(c => c.blockId).sort(), ['tpl-t5-hoc-2026-10-08-1', 'tpl-t5-hoc-2026-10-08-2']);
  const d = { id: 'd4', title: 'Họp mời', durationMin: 60, priority: 1, mode: 'fixed_time', fixedStart: ext.start, forced: true, externalBlockId: ext.id };
  const p = E.propose(blocks, goals, d, NOW, ctx);
  assert.ok(p.ok);
  eq(p.moved.map(m => m.blockId).sort(), ['tpl-t5-hoc-2026-10-08-1', 'tpl-t5-hoc-2026-10-08-2']);
  p.moved.forEach(m => assert.ok(!overlaps(m.to, ext) && !inSleep(m.to)));
  // Chưa duyệt: dữ liệu giữ nguyên, xung đột vẫn hiển thị
  assert.strictEqual(byId(blocks, 'tpl-t5-hoc-2026-10-08-1').start, '2026-10-08T13:15:00+07:00');
  const applied = E.applyProposal(blocks, p, d, NOW, ctx);
  assert.strictEqual(E.findConflicts(applied.blocks, ctx).length, 0, 'duyệt xong thì hết xung đột');
  assert.ok(!applied.blocks.some(b => b.id === E.placementBlockId(d)), 'sự kiện ngoài đã có sẵn, không tạo block trùng');
  assert.ok(applied.changes.every(c => c.cause === 'disruption' && c.causeId === 'd4'));
});
t('KB5: ưu tiên 2, 90p, linh hoạt thứ 3 21:00 đến 23:30 -> không qua 22:00 vì sáng thứ 4 có ca 6h', () => {
  const d = { id: 'd5', title: 'Việc', durationMin: 90, priority: 2, mode: 'flexible',
    windowStart: '2026-10-06T21:00:00+07:00', windowEnd: '2026-10-06T23:30:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.strictEqual(p.ok, false);
  const c = p.warnings.find(w => w.code === 'conflict');
  assert.ok(c && c.reasons.sleep > 0, 'lý do phải là giờ ngủ');
  assert.ok(p.alternatives.length >= 1);
  p.alternatives.forEach(a => assert.ok(!inSleep(a), 'khung thay thế không vào giờ ngủ: ' + a.start));
  assert.strictEqual(p.alternatives[0].start, '2026-10-06T20:30:00+07:00');
  assert.strictEqual(p.alternatives[0].end, '2026-10-06T22:00:00+07:00');
});
t('KB6: check-in "Bỏ, mệt" block GPA 13:30 thứ 4 có 2 task -> task về hàng chờ, đề xuất chỗ mới, ngân sách thực tế không cộng', () => {
  const blockId = 'tpl-t4-gtton-2026-10-07-1';
  const tasks = [
    { id: 'tk1', title: 'GT Câu 12 (a,b,e,f)', status: 'todo', blockId, estBlocks: 1, deadline: '2026-10-08' },
    { id: 'tk2', title: 'GT Câu 13', status: 'doing', blockId, estBlocks: 1, deadline: '2026-10-08' },
    { id: 'tk3', title: 'Việc khác', status: 'todo', blockId: 'khac' },
  ];
  const now = '2026-10-07T15:30:00+07:00';
  const r = E.applyCheckin(base, tasks, { id: 'ck1', blockId, result: 'skipped', reasonCode: 'tired' }, now, ctx);
  assert.strictEqual(r.block.status, 'skipped');
  assert.strictEqual(r.checkin.completedRatio, 0);
  eq(r.returnedTasks.map(x => x.id), ['tk1', 'tk2']);
  assert.ok(r.tasks.filter(x => x.id !== 'tk3').every(x => x.blockId === ''), '2 task phải về hàng chờ');
  assert.strictEqual(r.tasks.find(x => x.id === 'tk3').blockId, 'khac');
  const sug = E.proposeTaskSlots(r.returnedTasks, r.blocks, goals, now, ctx);
  assert.strictEqual(sug.placed.length, 2);
  sug.placed.forEach(s => {
    assert.ok(P(s.start) >= P(now), 'chỗ mới phải ở tương lai');
    assert.ok(P(s.end) <= P('2026-10-09T00:00:00+07:00'), 'chỗ mới phải trong hạn');
    assert.ok(!inSleep(s));
  });
  assert.strictEqual(sug.placed[0].start, '2026-10-07T18:00:00+07:00', 'ưu tiên khung đệm tối thứ 4');
  assert.ok(!overlaps(sug.placed[0], sug.placed[1]));
  const wb = E.weekBudget(r.blocks, goals, [r.checkin], WEEK, now, ctx);
  const g = gpa(wb);
  assert.strictEqual(g.doneMin, 0, 'block bỏ không được cộng vào thực tế');
  assert.strictEqual(g.missedMin, 90);
});

/* ======================= Luật cứng ======================= */
t('Luật cứng: không đặt việc vào giờ ngủ (giờ cố định)', () => {
  const d = { id: 'x', durationMin: 30, priority: 1, mode: 'fixed_time', fixedStart: '2026-10-06T22:30:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.strictEqual(p.ok, false);
  assert.ok(p.warnings.find(w => w.code === 'conflict').reasons.sleep);
});
t('Luật cứng: không chồng block fixed, kể cả ưu tiên 1', () => {
  const d = { id: 'x', durationMin: 60, priority: 1, mode: 'fixed_time', fixedStart: '2026-10-06T08:00:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.strictEqual(p.ok, false);
  assert.ok(p.warnings.find(w => w.code === 'conflict').reasons.fixed);
  p.alternatives.forEach(a => assert.ok(!byId(base, 'tpl-t3-gt-2026-10-06-1') || !overlaps(a, byId(base, 'tpl-t3-gt-2026-10-06-1'))));
});
t('Luật cứng: việc ưu tiên 3 đến 5 không được chiếm block protected; ưu tiên 1 đến 2 thì được', () => {
  [3, 4, 5].forEach(pr => {
    const p = E.propose(base, goals, { id: 'x', durationMin: 50, priority: pr, mode: 'fixed_time', fixedStart: '2026-10-05T09:00:00+07:00' }, NOW, ctx);
    assert.strictEqual(p.ok, false, 'ưu tiên ' + pr + ' phải bị từ chối');
    assert.ok(p.warnings.find(w => w.code === 'conflict').reasons.protected);
  });
  [1, 2].forEach(pr => {
    const p = E.propose(base, goals, { id: 'x', durationMin: 50, priority: pr, mode: 'fixed_time', fixedStart: '2026-10-05T09:00:00+07:00' }, NOW, ctx);
    assert.ok(p.ok, 'ưu tiên ' + pr + ' phải được chiếm');
    eq(p.moved.concat(p.lost.map(b => ({ blockId: b.id }))).map(m => m.blockId), ['tpl-t2-hocsau-2026-10-05-1']);
  });
});
t('Luật cứng: chỉ đẩy block flexible có ưu tiên thấp hơn (số hạng lớn hơn)', () => {
  // Gym hạng 2 thứ 2 16:30: ưu tiên 2 (bằng) không đẩy được, ưu tiên 1 đẩy được
  const at = { durationMin: 60, mode: 'fixed_time', fixedStart: '2026-10-05T16:45:00+07:00' };
  assert.strictEqual(E.propose(base, goals, Object.assign({ id: 'a', priority: 2 }, at), NOW, ctx).ok, false);
  assert.strictEqual(E.propose(base, goals, Object.assign({ id: 'b', priority: 3 }, at), NOW, ctx).ok, false);
  const p = E.propose(base, goals, Object.assign({ id: 'c', priority: 1 }, at), NOW, ctx);
  assert.ok(p.ok);
  assert.strictEqual(p.placement.cost, 10 + 1);
  // Block GPA hạng 1: không việc nào (kể cả ưu tiên 1) đẩy được
  const q = E.propose(base, goals, { id: 'd', priority: 1, durationMin: 30, mode: 'fixed_time', fixedStart: '2026-10-05T19:45:00+07:00' }, NOW, ctx);
  assert.strictEqual(q.ok, false);
  assert.ok(q.warnings.find(w => w.code === 'conflict').reasons.priority);
});
t('Luật cứng: chỉ dời một cấp, block bị dời không đẩy block khác (không có chỗ thì vào lost)', () => {
  // Ngày chỉ có 1 block flexible ưu tiên thấp và kín mọi chỗ còn lại bằng block cố định
  const day = '2026-10-20';
  const blocks = [
    { id: 'low', type: 'flexible', goalId: 'goal-clb', start: `${day}T09:00:00+07:00`, end: `${day}T10:00:00+07:00`, status: 'planned' },
    { id: 'gpa', type: 'flexible', goalId: 'goal-gpa', start: `${day}T10:00:00+07:00`, end: `${day}T23:00:00+07:00`, status: 'planned' },
    { id: 'wall', type: 'fixed', start: `${day}T05:00:00+07:00`, end: `${day}T09:00:00+07:00`, status: 'planned' },
  ];
  const p = E.propose(blocks, goals, { id: 'z', priority: 3, durationMin: 60, mode: 'fixed_time', fixedStart: `${day}T09:00:00+07:00` }, '2026-10-19T07:00:00+07:00', ctx);
  assert.ok(p.ok);
  assert.strictEqual(p.moved.length, 0, 'không được đẩy block GPA để lấy chỗ cho block bị dời');
  eq(p.lost.map(b => b.id), ['low']);
});
t('Luật cứng (quét toàn tuần): mọi phương án không vào giờ ngủ, không đè fixed, đúng luật protected/ưu tiên, dời một cấp', () => {
  const goalMap = {}; goals.forEach(g => { goalMap[g.id] = g; });
  let checked = 0;
  for (let day = 0; day < 7; day++) {
    const ymd = E.time.addDaysYmd(WEEK, day);
    for (let h = 6; h <= 21; h += 1) {
      for (let pr = 1; pr <= 5; pr++) {
        for (const mode of ['fixed_time', 'flexible']) {
          const hh = String(h).padStart(2, '0');
          const d = mode === 'fixed_time'
            ? { id: `s${day}${h}${pr}`, durationMin: 60, priority: pr, mode, fixedStart: `${ymd}T${hh}:00:00+07:00` }
            : { id: `f${day}${h}${pr}`, durationMin: 60, priority: pr, mode, windowStart: `${ymd}T${hh}:00:00+07:00`, windowEnd: `${ymd}T${String(h + 2).padStart(2, '0')}:00:00+07:00` };
          const p = E.propose(base, goals, d, NOW, ctx);
          const slots = p.ok ? [p.placement] : p.alternatives;
          slots.forEach(s => {
            assert.ok(!inSleep(s), 'vào giờ ngủ: ' + s.start);
            base.filter(b => b.type === 'fixed').forEach(b => assert.ok(!overlaps(s, b), 'đè fixed: ' + s.start));
            base.filter(b => overlaps(s, b) && b.type === 'protected').forEach(() => assert.ok(pr <= 2, 'ưu tiên ' + pr + ' chiếm protected'));
            base.filter(b => overlaps(s, b) && b.type === 'flexible').forEach(b => assert.ok((goalMap[b.goalId] || { rank: 6 }).rank > pr, 'đẩy block ưu tiên không thấp hơn'));
          });
          if (p.ok) {
            const applied = E.applyProposal(base, p, d, NOW, ctx).blocks;
            p.moved.forEach(m => {
              assert.ok(!inSleep(m.to), 'block bị dời vào giờ ngủ');
              applied.filter(b => b.id !== m.blockId && b.type !== 'buffer' && E.isActive(b)).forEach(b =>
                assert.ok(!overlaps(m.to, b), `block dời ${m.blockId} chồng lên ${b.id}`));
              assert.ok(P(m.to.end) <= (m.block.deadline ? P(m.block.deadline) : E.time.endOfLocalDay(P(m.from.start), 420)), 'dời quá hạn');
            });
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000);
});

/* ======================= Tính chất khác ======================= */
t('Cùng đầu vào luôn cho cùng đầu ra', () => {
  const d = { id: 'd3', durationMin: 120, priority: 1, mode: 'fixed_time', fixedStart: '2026-10-09T09:00:00+07:00' };
  eq(plain(E.propose(base, goals, d, NOW, ctx)), plain(E.propose(base, goals, d, NOW, ctx)));
});
t('Hoà chi phí thì chọn khung sớm hơn; cấu hình trọng số đổi được lựa chọn', () => {
  // Thứ 3 16:15 đến 17:45 trống (cost 0) còn 17:45 trở đi là đệm (cost 1)
  const d = { id: 'w', durationMin: 30, priority: 5, mode: 'flexible', windowStart: '2026-10-06T16:15:00+07:00', windowEnd: '2026-10-06T19:00:00+07:00' };
  const p = E.propose(base, goals, d, NOW, ctx);
  assert.strictEqual(p.placement.start, '2026-10-06T16:15:00+07:00');
  assert.strictEqual(p.placement.cost, 0);
  // Nếu cấu hình cho đệm rẻ hơn trống (trọng số âm) thì engine chọn đệm
  const p2 = E.propose(base, goals, d, NOW, Object.assign({}, ctx, { config: { weights: { buffer: -1 } } }));
  assert.ok(p2.placement.bufferUsed);
});
t('Không đặt việc vào quá khứ', () => {
  const d = { id: 'past', durationMin: 30, priority: 5, mode: 'flexible', windowStart: '2026-10-06T16:00:00+07:00', windowEnd: '2026-10-06T17:00:00+07:00' };
  const p = E.propose(base, goals, d, '2026-10-06T16:20:00+07:00', ctx);
  assert.ok(P(p.placement.start) >= P('2026-10-06T16:20:00+07:00'));
  assert.strictEqual(p.placement.start, '2026-10-06T16:30:00+07:00', 'bước 15 phút tính từ đầu khung');
});
t('Check-in: quá 48 giờ thành unknown, không tự coi là xong', () => {
  const now = '2026-10-08T12:00:00+07:00';
  const q = E.checkinQueue(base, [], now, ctx);
  assert.ok(q.stale.some(b => b.id === 'tpl-t2-hocsau-2026-10-05-1'), 'block sáng thứ 2 đã quá 48 giờ');
  assert.ok(q.due.some(b => b.id === 'tpl-t3-soloi-2026-10-06-1'), 'block tối thứ 3 vẫn trong 48 giờ');
  assert.ok(!q.due.concat(q.stale).some(b => b.type === 'fixed' || b.type === 'buffer'), 'không hỏi check-in block cố định và đệm');
  const r = E.markStaleUnknown(base, [], now, ctx);
  assert.strictEqual(byId(r.blocks, 'tpl-t2-hocsau-2026-10-05-1').status, 'unknown');
  const wb = gpa(E.weekBudget(r.blocks, goals, [], WEEK, now, ctx));
  assert.strictEqual(wb.doneMin, 0, 'unknown không được tính là đã làm');
});
t('Check-in một phần 50% chỉ cộng nửa thời lượng; task dở quay về hàng chờ', () => {
  const blockId = 'tpl-t2-truocgt-2026-10-05-1';
  const r = E.applyCheckin(base, [{ id: 'a', blockId, status: 'todo' }, { id: 'b', blockId, status: 'done' }],
    { id: 'c', blockId, result: 'partial', completedRatio: 0.5, reasonCode: 'distracted' }, '2026-10-05T21:00:00+07:00', ctx);
  assert.strictEqual(r.block.status, 'partial');
  eq(r.returnedTasks.map(x => x.id), ['a'], 'task đã xong không quay về');
  const g = gpa(E.weekBudget(r.blocks, goals, [r.checkin], WEEK, '2026-10-05T21:00:00+07:00', ctx));
  assert.strictEqual(g.doneMin, 23); // 45 phút x 50%, làm tròn
});
t('Ngân sách tuần: cảnh báo khi mục tiêu hạng 1 dự kiến hụt quá 10%', () => {
  const ok = gpa(E.weekBudget(base, goals, [], WEEK, NOW, ctx));
  assert.strictEqual(ok.targetMin, 1080);
  assert.ok(ok.projectedMin >= 1080 && ok.warn === false, 'lịch mẫu đủ giờ thì không cảnh báo, dự kiến ' + ok.projectedMin);
  const fewer = base.map(b => b.goalId === 'goal-gpa' && b.type !== 'fixed' && b.start < '2026-10-08' ? Object.assign({}, b, { status: 'skipped' }) : b);
  const bad = gpa(E.weekBudget(fewer, goals, [], WEEK, NOW, ctx));
  assert.ok(bad.warn, 'hụt nhiều phải cảnh báo, dự kiến ' + bad.projectedMin);
  assert.ok(bad.shortfallPct > 10);
  const gym = E.weekBudget(fewer, goals, [], WEEK, NOW, ctx).find(x => x.goalId === 'goal-gym');
  assert.strictEqual(gym.warn, false, 'chỉ cảnh báo mục tiêu hạng 1');
});
t('Thống kê: tỷ lệ theo loại block, theo thứ, theo khung giờ và 3 lý do hàng đầu', () => {
  const ck = [
    { blockId: 'tpl-t2-hocsau-2026-10-05-1', result: 'done', completedRatio: 1 },
    { blockId: 'tpl-t2-hoc-2026-10-05-1', result: 'partial', completedRatio: 0.5, reasonCode: 'tired' },
    { blockId: 'tpl-t2-truocgt-2026-10-05-1', result: 'skipped', completedRatio: 0, reasonCode: 'tired' },
    { blockId: 'tpl-t3-soloi-2026-10-06-1', result: 'skipped', completedRatio: 0, reasonCode: 'disruption' },
  ];
  const s = E.weekStats(base, ck, ctx);
  assert.strictEqual(s.byType.protected.rate, 100);
  assert.strictEqual(s.byType.flexible.rate, 17);
  assert.strictEqual(s.byWeekday[1].count, 3);
  assert.strictEqual(s.byDaypart.toi.rate, 0);
  eq(plain(s.topReasons), [{ reasonCode: 'tired', count: 2 }, { reasonCode: 'disruption', count: 1 }]);
});
t('Khung đệm đang trống thì báo để hỏi học thêm hay nghỉ', () => {
  const at = '2026-10-06T18:00:00+07:00';
  eq(E.emptyBuffersAt(base, at, ctx).map(b => b.id), ['tpl-t3-dem-2026-10-06-1']);
  assert.strictEqual(E.emptyBuffersAt(withBufferFull(), at, ctx).length, 0);
});
t('Giờ ngủ theo từng đêm khớp Phụ lục', () => {
  const z = sleepsOfWeek.find(x => x.end.startsWith('2026-10-07'));
  assert.strictEqual(z.start, '2026-10-06T22:00:00+07:00');
  assert.strictEqual(z.end, '2026-10-07T05:00:00+07:00');
  const fri = sleepsOfWeek.find(x => x.end.startsWith('2026-10-09'));
  assert.strictEqual(fri.start, '2026-10-08T23:00:00+07:00');
  assert.strictEqual(fri.end, '2026-10-09T07:00:00+07:00');
});

console.log(fails === 0 ? `\nTẤT CẢ ${count} TEST ENGINE PASS` : `\n${fails}/${count} TEST ENGINE THẤT BẠI`);
process.exit(fails === 0 ? 0 : 1);
