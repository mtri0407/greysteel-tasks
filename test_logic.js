/* Unit test cho phần tính toán của Lộ trình mục tiêu.
   Trích các hàm thuần tuý từ index.html rồi chạy trực tiếp bằng Node, có kiểm soát
   "hôm nay" để kiểm tra được cả trường hợp giai đoạn đã trôi qua nhiều tuần. */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// Cắt lấy phần từ đầu tới hết buildRetroSuggestion, bỏ phần DOM
const start = script.indexOf('function fmtNum');
const end = script.indexOf('function openRetroModal');
const logicSrc = script.slice(start, end);

let FAKE_TODAY = '2026-08-13';
const sandbox = {
  console,
  todayStr: () => FAKE_TODAY,
  fmtDate: (s) => s || '',
  // ymd/esc nằm ở phần UTIL phía trên đoạn được trích, nên cấp lại y hệt bản gốc
  ymd: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  esc: (s) => (s === null || s === undefined ? '' : String(s)),
  state: { goals: [] },
  uid: () => 'x' + Math.random().toString(36).slice(2, 8),
  el: () => ({}), $: () => ({}), scheduleSave: () => {}, renderAll: () => {}, toast: () => {},
  deleteTask: async () => {}, addTask: async () => {},
  GOAL_AREAS: [{ id: 'study', label: 'Học tập', icon: '📚' }, { id: 'other', label: 'Khác', icon: '🎯' }],
  PHASE_BLUEPRINTS: { study: ['A', 'B', 'C'], other: ['G1', 'G2', 'G3'] },
};
vm.createContext(sandbox);
vm.runInContext(logicSrc, sandbox);
const { phaseStats, phaseEstimate, phaseStartValue, buildRetroSuggestion, weeksOfPhase,
        goalProgressPct, goalCurrentValue, buildPhaseBlueprint, addDays } = sandbox;

let fails = 0;
function t(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { fails++; console.log('FAIL', name, '\n     ', e.message); }
}

/* ---------- weeksOfPhase ---------- */
t('weeksOfPhase chia đúng số tuần', () => {
  const w = weeksOfPhase({ startDate: '2026-08-01', endDate: '2026-08-28' });
  assert.strictEqual(w.length, 4);
  assert.strictEqual(w[0].start, '2026-08-01');
  assert.strictEqual(w[0].end, '2026-08-07');
  assert.strictEqual(w[3].end, '2026-08-28');
});
t('weeksOfPhase tuần cuối bị cắt ngắn vẫn tính là 1 tuần', () => {
  const w = weeksOfPhase({ startDate: '2026-08-01', endDate: '2026-08-10' });
  assert.strictEqual(w.length, 2);
  assert.strictEqual(w[1].end, '2026-08-10');
});

/* ---------- phaseStats ---------- */
t('phaseStats cộng đúng tổng và % nỗ lực', () => {
  FAKE_TODAY = '2026-09-01';
  const p = { startDate: '2026-08-01', endDate: '2026-08-28', weeklyTarget: 10, weeklyUnit: 'giờ',
    logs: [{ date: '2026-08-03', amount: 6 }, { date: '2026-08-10', amount: 8 }, { date: '2026-08-20', amount: 10 }] };
  const s = phaseStats(p);
  assert.strictEqual(s.totalTarget, 40);
  assert.strictEqual(s.totalActual, 24);
  assert.strictEqual(Math.round(s.pct), 60);
});
t('phaseStats chỉ tính nhịp trung bình trên các tuần ĐÃ trôi qua', () => {
  // Giai đoạn dài 18 tuần nhưng mới đi được 2 tuần: nhịp thật phải là 8/tuần, không phải 8/18
  FAKE_TODAY = '2026-08-20';
  const p = { startDate: '2026-08-01', endDate: '2026-12-04', weeklyTarget: 10, weeklyUnit: 'giờ',
    logs: [{ date: '2026-08-05', amount: 8 }, { date: '2026-08-12', amount: 8 }] };
  const s = phaseStats(p);
  assert.strictEqual(s.elapsedWeeks, 2, 'phải nhận diện 2 tuần đã trôi qua, thấy ' + s.elapsedWeeks);
  assert.strictEqual(s.avgWeeklyActual, 8, 'nhịp trung bình phải là 8/tuần, thấy ' + s.avgWeeklyActual);
  assert.ok(s.pct < 15, '% trên toàn giai đoạn vẫn thấp vì còn nhiều tuần phía trước');
});

/* ---------- phaseStartValue / estimate ---------- */
t('phaseStartValue lấy kết quả thực tế của phase trước', () => {
  const g = { startValue: 3, phases: [
    { expectedValue: 4.33, actualValue: 4 },
    { expectedValue: 5.67, actualValue: '' },
  ] };
  assert.strictEqual(phaseStartValue(g, 0), 3);
  assert.strictEqual(phaseStartValue(g, 1), 4, 'phải dùng thực tế 4 chứ không phải kỳ vọng 4.33');
});
t('phaseStartValue quay về kỳ vọng khi chưa có thực tế', () => {
  const g = { startValue: 3, phases: [{ expectedValue: 4.33, actualValue: '' }, { expectedValue: 5.67 }] };
  assert.strictEqual(phaseStartValue(g, 1), 4.33);
});
t('phaseEstimate nội suy theo % nhật ký', () => {
  FAKE_TODAY = '2026-09-05';
  const g = { startValue: 3, unit: 'band', phases: [
    { startDate: '2026-08-01', endDate: '2026-08-28', weeklyTarget: 10, expectedValue: 5, logs: [
      { date: '2026-08-03', amount: 20 }] },
  ] };
  // totalTarget 40, actual 20 => 50% => 3 + (5-3)*0.5 = 4
  assert.strictEqual(phaseEstimate(g, 0), 4);
});

/* ---------- goal progress ---------- */
t('goalProgressPct dựa trên kết quả thực tế mới nhất', () => {
  const g = { startValue: 3, targetValue: 7, phases: [
    { actualValue: 4 }, { actualValue: 5 }, { actualValue: '' },
  ] };
  assert.strictEqual(goalCurrentValue(g), 5);
  assert.strictEqual(goalProgressPct(g), 50); // (5-3)/(7-3)
});
t('goalProgressPct không âm và không vượt 100', () => {
  assert.strictEqual(goalProgressPct({ startValue: 3, targetValue: 7, phases: [{ actualValue: 2 }] }), 0);
  assert.strictEqual(goalProgressPct({ startValue: 3, targetValue: 7, phases: [{ actualValue: 9 }] }), 100);
});
t('goalProgressPct xử lý mục tiêu giảm (vd giảm cân) không chia cho 0', () => {
  const g = { startValue: 5, targetValue: 5, phases: [{ actualValue: 5 }] };
  assert.strictEqual(goalProgressPct(g), 0);
});

/* ---------- buildPhaseBlueprint ---------- */
t('buildPhaseBlueprint chia đều và nội suy kỳ vọng', () => {
  const phases = buildPhaseBlueprint({ area: 'study', startDate: '2026-08-01', targetDate: '2027-08-01', startValue: 3, targetValue: 7 }, 4);
  assert.strictEqual(phases.length, 4);
  assert.strictEqual(phases[0].startDate, '2026-08-01');
  assert.strictEqual(phases[3].endDate, '2027-08-01', 'phase cuối phải kết thúc đúng ngày đích');
  assert.strictEqual(phases[3].expectedValue, 7, 'phase cuối phải kỳ vọng đúng bằng đích');
  assert.strictEqual(phases[0].expectedValue, 4, '(3 + 4*1/4) = 4');
  // các phase phải nối tiếp nhau không chồng lấn
  for (let i = 1; i < phases.length; i++) {
    assert.ok(phases[i].startDate > phases[i - 1].endDate, 'phase ' + i + ' phải bắt đầu sau phase trước');
  }
});

/* ---------- buildRetroSuggestion: đây là chỗ từng có bug ---------- */
t('REGRESSION: giai đoạn mới bắt đầu KHÔNG gợi ý chỉ tiêu tuần vô lý', () => {
  FAKE_TODAY = '2026-08-13';
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-11-29', weeklyTarget: 10, weeklyUnit: 'giờ',
      expectedValue: 4.33, logs: [{ date: '2026-08-10', amount: 8 }] },
    { name: 'P2', startDate: '2026-11-30', endDate: '2027-03-30', weeklyTarget: 10, weeklyUnit: 'giờ', expectedValue: 5.67 },
  ] };
  const s = buildRetroSuggestion(g, 0, 4);
  assert.ok(s.nextSuggestion, 'vẫn phải gợi ý điều chỉnh kỳ vọng');
  assert.strictEqual(s.nextSuggestion.weeklyTo, undefined,
    'KHÔNG được gợi ý hạ chỉ tiêu tuần khi mới có 1 tuần dữ liệu (bug cũ đề xuất 0.4 giờ)');
  assert.strictEqual(s.nextSuggestion.to, 5.34, 'kỳ vọng phase sau phải dời xuống đúng khoảng hụt 0.33');
});
t('Gợi ý chỉ tiêu tuần dựa trên nhịp thật khi đã có đủ dữ liệu', () => {
  FAKE_TODAY = '2026-10-01';
  const logs = [];
  // 8 tuần, mỗi tuần làm 6 giờ trong khi chỉ tiêu là 10
  for (let i = 0; i < 8; i++) logs.push({ date: addDays('2026-08-03', i * 7), amount: 6 });
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 10, weeklyUnit: 'giờ',
      expectedValue: 4.5, logs },
    { name: 'P2', startDate: '2026-09-26', endDate: '2026-12-01', weeklyTarget: 10, weeklyUnit: 'giờ', expectedValue: 6 },
  ] };
  const s = buildRetroSuggestion(g, 0, 4);
  assert.ok(s.nextSuggestion.weeklyTo >= 5 && s.nextSuggestion.weeklyTo <= 7,
    'phải đề xuất khoảng 6 giờ/tuần (nhịp thật), thấy ' + s.nextSuggestion.weeklyTo);
  assert.ok(s.nextSuggestion.weeklyTo >= 1, 'không bao giờ đề xuất dưới 1');
});
t('Vượt kỳ vọng thì giữ nguyên kế hoạch phase sau', () => {
  FAKE_TODAY = '2026-10-01';
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 10, weeklyUnit: 'giờ', expectedValue: 4.5, logs: [] },
    { name: 'P2', startDate: '2026-09-26', endDate: '2026-12-01', weeklyTarget: 10, weeklyUnit: 'giờ', expectedValue: 6 },
  ] };
  const s = buildRetroSuggestion(g, 0, 5);
  assert.strictEqual(s.tone, 'ok');
  assert.ok(s.nextSuggestion.keep, 'phải khuyên giữ nguyên');
  assert.ok(/Vượt kỳ vọng/.test(s.verdict));
});
t('Phase cuối cùng không cần gợi ý phase sau', () => {
  FAKE_TODAY = '2026-10-01';
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 10, expectedValue: 7, logs: [] },
  ] };
  const s = buildRetroSuggestion(g, 0, 6);
  assert.strictEqual(s.nextSuggestion, null);
});
/* ---------- Mục tiêu GIẢM (giảm cân, giảm thời gian chạy): số nhỏ hơn mới là tốt ---------- */
t('REGRESSION: mục tiêu giảm cân, nhẹ hơn kỳ vọng = vượt kỳ vọng', () => {
  FAKE_TODAY = '2026-10-01';
  const g = { startValue: 80, targetValue: 70, unit: 'kg', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 4, weeklyUnit: 'buổi', expectedValue: 76, logs: [] },
    { name: 'P2', startDate: '2026-09-26', endDate: '2026-12-01', weeklyTarget: 4, weeklyUnit: 'buổi', expectedValue: 70 },
  ] };
  const s = buildRetroSuggestion(g, 0, 74); // giảm được nhiều hơn kỳ vọng
  assert.strictEqual(s.tone, 'ok', 'giảm nhiều hơn kỳ vọng phải là tin tốt, thấy tone=' + s.tone);
  assert.ok(/Vượt kỳ vọng/.test(s.verdict), 'thấy: ' + s.verdict);
});
t('REGRESSION: mục tiêu giảm cân, nặng hơn kỳ vọng = chưa đạt', () => {
  FAKE_TODAY = '2026-10-01';
  const g = { startValue: 80, targetValue: 70, unit: 'kg', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 4, weeklyUnit: 'buổi', expectedValue: 76, logs: [] },
    { name: 'P2', startDate: '2026-09-26', endDate: '2026-12-01', weeklyTarget: 4, weeklyUnit: 'buổi', expectedValue: 70 },
  ] };
  const s = buildRetroSuggestion(g, 0, 78); // mới giảm được 2kg thay vì 4kg
  assert.strictEqual(s.tone, 'warn', 'giảm ít hơn kỳ vọng phải cảnh báo, thấy tone=' + s.tone);
  assert.ok(/Chưa đạt kỳ vọng/.test(s.verdict), 'thấy: ' + s.verdict);
  // kỳ vọng phase sau phải được NỚI LỎNG lên (70 -> 72), không phải siết chặt xuống
  assert.strictEqual(s.nextSuggestion.to, 72,
    'mục tiêu giảm: phase sau phải nới lên 72kg, thấy ' + s.nextSuggestion.to);
});
t('Mục tiêu giảm: tiến độ % tính đúng chiều', () => {
  const g = { startValue: 80, targetValue: 70, phases: [{ actualValue: 75 }] };
  assert.strictEqual(goalProgressPct(g), 50, 'giảm 5/10 kg = 50%');
});

t('Đạt đúng kỳ vọng cho verdict phù hợp', () => {
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 10, expectedValue: 4.5, logs: [] },
  ] };
  const s = buildRetroSuggestion(g, 0, 4.5);
  assert.ok(/Đạt đúng kỳ vọng/.test(s.verdict), 'thấy: ' + s.verdict);
});

/* Test này trước đây nằm SAU process.exit nên không bao giờ chạy; đã dời lên trước. */
t('Giai đoạn chưa đặt kỳ vọng thì báo rõ, không coi kỳ vọng là 0', () => {
  FAKE_TODAY = '2026-10-01';
  const g = { startValue: 3, targetValue: 7, unit: 'band', phases: [
    { name: 'P1', startDate: '2026-08-01', endDate: '2026-09-25', weeklyTarget: 10, expectedValue: '', logs: [] },
    { name: 'P2', startDate: '2026-09-26', endDate: '2026-12-01', weeklyTarget: 10, expectedValue: 6 },
  ] };
  const s = buildRetroSuggestion(g, 0, 4);
  assert.ok(/chưa đặt kỳ vọng/i.test(s.verdict), 'phải báo chưa đặt kỳ vọng, thấy: ' + s.verdict);
  assert.strictEqual(s.nextSuggestion, null, 'không được gợi ý bừa khi chưa có kỳ vọng');
  assert.strictEqual(phaseEstimate(g, 0), null, 'ước chừng phải là null chứ không phải 0');
});
console.log(fails === 0 ? '\nTẤT CẢ UNIT TEST LOGIC PASS' : `\n${fails} TEST THẤT BẠI`);
process.exit(fails === 0 ? 0 : 1);
