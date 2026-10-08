/* ======================= ENGINE LỊCH THÔNG MINH (giai đoạn 1) =======================
   Engine xếp lịch và xử lý phát sinh dựa trên luật. Toàn bộ là hàm thuần:
   - không đụng DOM, Drive hay mạng;
   - không tự gọi Date.now(): thời điểm "bây giờ" luôn được truyền vào qua tham số `now`;
   - cùng đầu vào luôn cho cùng đầu ra (id sinh ra cũng tất định), nên viết unit test được.

   Chạy được ở hai nơi:
   - trình duyệt: <script src="/engine.js"> gắn API vào biến global `GSEngine`;
   - Node: require('./public/engine.js') hoặc nạp bằng vm như test_logic.js.

   Quy ước thời gian: block lưu start/end dạng ISO 8601 có múi giờ, ví dụ
   2026-10-09T08:00:00+07:00. Bên trong engine đổi hết sang mili giây epoch để so sánh,
   còn "giờ địa phương" (giờ ngủ, thứ trong tuần, năng lượng sáng/tối) tính theo
   tzOffsetMin cố định truyền vào (Việt Nam không có giờ mùa hè nên một độ lệch là đủ). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Trọng số chi phí và các ngưỡng. Đây là giá trị khởi đầu theo spec, để thành cấu hình
     để tinh chỉnh sau khi có dữ liệu thật (truyền ctx.config để ghi đè từng khoá). */
  const ENGINE_CONFIG = {
    weights: { free: 0, buffer: 1, flexible: 10, protected: 50, perDisplaced: 1 },
    stepMin: 15,               // bước dò khung ứng viên
    unitMin: 50,               // độ dài 1 "block" học khi một dòng lịch khung chứa nhiều block
    protectedMaxPriority: 2,   // chỉ việc ưu tiên 1..2 được chiếm block protected
    unrankedGoalRank: 5,       // mục tiêu chưa đặt hạng coi như hạng thấp nhất
    noGoalRank: 6,             // block không gắn mục tiêu: thấp hơn mọi mục tiêu
    lightFromHour: 17,         // từ 17:00 trở đi là năng lượng "light", trước đó là "deep"
    tzOffsetMin: 420,          // UTC+7
    alternativesCount: 3,
    alternativesSearchDays: 3, // tìm khung thay thế trong vòng ±3 ngày quanh khung người dùng chọn
    staleCheckinHours: 48,     // quá 48 giờ chưa check-in thì status = unknown
    rank1WarnRatio: 0.9,       // cảnh báo khi mục tiêu hạng 1 dự kiến dưới 90% mục tiêu tuần
    defaultTaskWindowDays: 7,  // task trả về hàng chờ mà không có hạn: tìm chỗ trong 7 ngày
  };

  const MIN = 60000, DAY = 86400000;
  const pad = n => String(n).padStart(2, '0');

  function makeCtx(ctx) {
    ctx = ctx || {};
    const c = ctx.config || {};
    const cfg = Object.assign({}, ENGINE_CONFIG, c, { weights: Object.assign({}, ENGINE_CONFIG.weights, c.weights || {}) });
    const off = Number.isFinite(ctx.tzOffsetMin) ? ctx.tzOffsetMin : cfg.tzOffsetMin;
    return { cfg, off, sleepRules: ctx.sleepRules || [] };
  }

  /* ---------------- Thời gian ---------------- */
  function ymdParts(ymd) { const [y, m, d] = String(ymd).split('-').map(Number); return { y, m, d }; }
  function addDaysYmd(ymd, n) {
    const { y, m, d } = ymdParts(ymd);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  function weekdayOfYmd(ymd) { const { y, m, d } = ymdParts(ymd); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function hhmmToMin(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
  function localToMs(ymd, hhmm, off) {
    const { y, m, d } = ymdParts(ymd); const mins = hhmmToMin(hhmm);
    return Date.UTC(y, m - 1, d, 0, mins) - off * MIN;
  }
  function localParts(ms, off) {
    const t = new Date(ms + off * MIN);
    return {
      ymd: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
      wd: t.getUTCDay(), minOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
      hhmm: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    };
  }
  function toISO(ms, off) {
    const p = localParts(ms, off);
    const sign = off >= 0 ? '+' : '-', a = Math.abs(off);
    return `${p.ymd}T${p.hhmm}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  /* Đọc thời điểm. Chuỗi có múi giờ thì dùng múi giờ đó; chuỗi không có múi giờ hiểu là giờ
     địa phương theo `off` (không phụ thuộc múi giờ của máy chạy test). */
  function parseTime(v, off) {
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    const s = String(v || '');
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!m) throw new Error('bad_time:' + s);
    const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (!m[7]) return base - off * MIN;
    if (m[7] === 'Z') return base;
    const tz = m[7].replace(':', ''); const sg = tz[0] === '-' ? -1 : 1;
    return base - sg * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * MIN;
  }
  /* Hạn chót: chuỗi chỉ có ngày (YYYY-MM-DD) nghĩa là hết ngày đó. */
  function parseDeadline(v, off) {
    if (v === null || v === undefined || v === '') return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return localToMs(addDaysYmd(v, 1), '00:00', off);
    return parseTime(v, off);
  }
  function startOfLocalDay(ms, off) { return localToMs(localParts(ms, off).ymd, '00:00', off); }
  function endOfLocalDay(ms, off) { return localToMs(addDaysYmd(localParts(ms, off).ymd, 1), '00:00', off); }
  function weekStartYmd(ms, off) { const p = localParts(ms, off); return addDaysYmd(p.ymd, -((p.wd + 6) % 7)); }
  function weekRange(ymdMonday, off) { return { s: localToMs(ymdMonday, '00:00', off), e: localToMs(addDaysYmd(ymdMonday, 7), '00:00', off) }; }
  const overlap = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;

  /* ---------------- Giờ ngủ ----------------
     sleepRules: [{wakeWeekdays:[2,3,4], start:'22:00', end:'05:00'}, ...]
     wakeWeekdays là thứ của BUỔI SÁNG thức dậy (0 = Chủ nhật, 1 = thứ 2, ... theo getDay()).
     Ví dụ "22:00 đến 05:00 trước các ngày thứ 3, 4, 5" là wakeWeekdays [2,3,4]. */
  function sleepIntervals(rules, fromMs, toMs, off) {
    const out = [];
    if (!rules || !rules.length) return out;
    let ymd = addDaysYmd(localParts(fromMs, off).ymd, -1);
    const last = addDaysYmd(localParts(toMs, off).ymd, 1);
    while (ymd <= last) {
      const wd = weekdayOfYmd(ymd);
      const r = rules.find(x => (x.wakeWeekdays || []).map(Number).includes(wd));
      if (r) {
        const crosses = hhmmToMin(r.start) > hhmmToMin(r.end);
        const iv = { s: localToMs(crosses ? addDaysYmd(ymd, -1) : ymd, r.start, off), e: localToMs(ymd, r.end, off) };
        if (iv.e > fromMs && iv.s < toMs) out.push(iv);
      }
      ymd = addDaysYmd(ymd, 1);
    }
    return out;
  }

  /* ---------------- Block ---------------- */
  const INACTIVE_STATUS = ['skipped', 'moved'];
  function isActive(b) { return !!b && !b.deletedAt && !INACTIVE_STATUS.includes(b.status); }
  function goalMapOf(goals) { const m = {}; (goals || []).forEach(g => { if (g && !g.deletedAt) m[g.id] = g; }); return m; }
  function goalRank(g, cfg) { const r = Number(g && g.rank); return (r >= 1 && r <= 5) ? r : cfg.unrankedGoalRank; }
  function blockPriority(b, goalMap, cfg) {
    if (b.priority !== undefined && b.priority !== null && b.priority !== '' && Number.isFinite(Number(b.priority))) return Number(b.priority);
    if (b.goalId) return goalMap[b.goalId] ? goalRank(goalMap[b.goalId], cfg) : cfg.unrankedGoalRank;
    return cfg.noGoalRank;
  }
  function itemsOf(blocks, off, excludeIds) {
    const ex = new Set(excludeIds || []);
    return (blocks || []).filter(b => isActive(b) && !ex.has(b.id)).map(b => ({ b, s: parseTime(b.start, off), e: parseTime(b.end, off) }))
      .filter(it => it.e > it.s).sort((a, b) => a.s - b.s || String(a.b.id).localeCompare(String(b.b.id)));
  }
  function energyAt(ms, off, cfg) { return localParts(ms, off).minOfDay >= cfg.lightFromHour * 60 ? 'light' : 'deep'; }
  function blockDeadline(it, off) { return parseDeadline(it.b.deadline, off) || endOfLocalDay(it.s, off); }
  function minutesOf(it) { return Math.round((it.e - it.s) / MIN); }

  /* ---------------- Đánh giá 1 khung ứng viên ----------------
     forced = true dùng cho sự kiện bên ngoài đã nằm sẵn trên Google Calendar: khung giờ
     là sự thật, engine không được từ chối, chỉ tính block nào phải dời và cảnh báo nếu
     chồng giờ ngủ / block cố định. */
  function evaluateSlot(s, e, prio, forced, items, sleeps, goalMap, cfg) {
    const warnings = [];
    if (sleeps.some(z => overlap(s, e, z.s, z.e))) {
      if (!forced) return { ok: false, reason: 'sleep' };
      warnings.push({ code: 'sleep_overlap', message: 'Sự kiện chồng lên giờ ngủ.' });
    }
    const displaced = []; let buffer = false, flex = false, prot = false;
    for (const it of items) {
      if (!overlap(s, e, it.s, it.e)) continue;
      const t = it.b.type;
      if (t === 'buffer') { buffer = true; continue; }
      if (t === 'fixed') {
        if (forced) { warnings.push({ code: 'fixed_overlap', blockId: it.b.id, message: `Chồng lên block cố định "${it.b.label || ''}".` }); continue; }
        return { ok: false, reason: 'fixed', blockId: it.b.id };
      }
      if (t === 'protected') {
        if (!forced && prio > cfg.protectedMaxPriority) return { ok: false, reason: 'protected', blockId: it.b.id };
        prot = true; displaced.push(it); continue;
      }
      // flexible (loại lạ cũng đối xử như flexible để không bao giờ bị bỏ sót)
      if (!forced && !(blockPriority(it.b, goalMap, cfg) > prio)) return { ok: false, reason: 'priority', blockId: it.b.id };
      flex = true; displaced.push(it);
    }
    const w = cfg.weights;
    const cost = (buffer ? w.buffer : 0) + (flex ? w.flexible : 0) + (prot ? w.protected : 0) + displaced.length * w.perDisplaced;
    return { ok: true, cost, displaced, bufferUsed: buffer, warnings };
  }

  /* ---------------- Khoảng trống ---------------- */
  function mergeIntervals(list) {
    const arr = list.filter(x => x.e > x.s).map(x => ({ s: x.s, e: x.e })).sort((a, b) => a.s - b.s);
    const out = [];
    for (const x of arr) { const l = out[out.length - 1]; if (l && x.s <= l.e) l.e = Math.max(l.e, x.e); else out.push(x); }
    return out;
  }
  function gapsWithin(lo, hi, busy) {
    const out = []; let cur = lo;
    for (const b of mergeIntervals(busy)) {
      if (b.e <= cur) continue; if (b.s >= hi) break;
      if (b.s > cur) out.push({ s: cur, e: Math.min(b.s, hi) });
      cur = Math.max(cur, b.e); if (cur >= hi) break;
    }
    if (cur < hi) out.push({ s: cur, e: hi });
    return out;
  }
  /* Cắt khoảng trống tại mốc đổi năng lượng (00:00 và lightFromHour mỗi ngày) để mỗi mảnh
     chỉ mang một loại năng lượng. */
  function splitByEnergy(gaps, off, cfg) {
    const out = [];
    for (const g of gaps) {
      const cuts = [];
      let ymd = localParts(g.s, off).ymd; const lastYmd = localParts(g.e, off).ymd;
      while (ymd <= lastYmd) {
        [localToMs(ymd, '00:00', off), localToMs(ymd, `${pad(cfg.lightFromHour)}:00`, off)].forEach(c => { if (c > g.s && c < g.e) cuts.push(c); });
        ymd = addDaysYmd(ymd, 1);
      }
      let s = g.s;
      cuts.sort((a, b) => a - b).forEach(c => { out.push({ s, e: c, energy: energyAt(s, off, cfg) }); s = c; });
      out.push({ s, e: g.e, energy: energyAt(s, off, cfg) });
    }
    return out;
  }
  /* Trong các khoảng trống đủ dài, chọn vị trí gần `anchor` nhất; hoà thì chọn sớm hơn. */
  function nearestFit(gaps, dur, anchor) {
    let best = null;
    for (const g of gaps) {
      if (g.e - g.s < dur) continue;
      const s = Math.min(Math.max(anchor, g.s), g.e - dur);
      const dist = Math.abs(s - anchor);
      if (!best || dist < best.dist || (dist === best.dist && s < best.s)) best = { s, e: s + dur, dist };
    }
    return best;
  }

  /* Tìm chỗ mới cho một khoảng thời lượng `dur` trong [lo, hi], theo thứ tự spec:
     khung đệm còn trống -> khoảng trống cùng năng lượng -> khoảng trống bất kỳ.
     `busy` là mọi thứ đang chiếm giờ (block không phải đệm, giờ ngủ, chỗ vừa xếp). */
  function findHome(dur, lo, hi, anchor, energy, busy, bufferItems, off, cfg) {
    if (hi - lo < dur) return null;
    const bufferFree = [];
    bufferItems.forEach(bi => { if (overlap(bi.s, bi.e, lo, hi)) gapsWithin(Math.max(lo, bi.s), Math.min(hi, bi.e), busy).forEach(g => bufferFree.push(g)); });
    let hit = nearestFit(bufferFree, dur, anchor);
    if (hit) return Object.assign(hit, { via: 'buffer' });
    const free = gapsWithin(lo, hi, busy);
    if (energy === 'deep' || energy === 'light') {
      hit = nearestFit(splitByEnergy(free, off, cfg).filter(g => g.energy === energy), dur, anchor);
      if (hit) return Object.assign(hit, { via: 'energy' });
    }
    hit = nearestFit(free, dur, anchor);
    return hit ? Object.assign(hit, { via: 'free' }) : null;
  }

  /* ---------------- Ngân sách tuần (kế hoạch) ----------------
     Chỉ tính block tự học/tự tập: bỏ block cố định (giờ lên lớp, việc bên ngoài) và khung đệm. */
  function countsForBudget(b) { return b.type !== 'fixed' && b.type !== 'buffer' && !!b.goalId; }
  function plannedBudget(blocks, goals, weekYmd, off, cfg) {
    const wr = weekRange(weekYmd, off);
    const per = {};
    itemsOf(blocks, off).forEach(it => {
      if (!countsForBudget(it.b)) return;
      const s = Math.max(it.s, wr.s), e = Math.min(it.e, wr.e);
      if (e > s) per[it.b.goalId] = (per[it.b.goalId] || 0) + Math.round((e - s) / MIN);
    });
    return sortGoals(goals, cfg).map(g => ({
      goalId: g.id, title: g.title || '', rank: goalRank(g, cfg), rawRank: g.rank,
      targetMin: numOrNull(g.timeBudgetMinPerWeek), plannedMin: per[g.id] || 0,
    }));
  }
  function numOrNull(v) { return (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v); }
  function sortGoals(goals, cfg) {
    return (goals || []).filter(g => g && !g.deletedAt).slice()
      .sort((a, b) => goalRank(a, cfg) - goalRank(b, cfg) || String(a.title || '').localeCompare(String(b.title || '')));
  }

  /* ======================= propose ======================= */
  /* propose(blocks, goals, disruption, now, ctx) -> Proposal
     disruption: {id, title, durationMin, priority (1..5), goalId?, mode:'fixed_time'|'flexible',
                  fixedStart, windowStart, windowEnd, forced?, externalBlockId?}
     ctx: {sleepRules, tzOffsetMin, config}
     Engine KHÔNG áp dụng gì: chỉ trả về phương án. Áp dụng bằng applyProposal() sau khi duyệt. */
  function propose(blocks, goals, disruption, now, ctx) {
    const { cfg, off, sleepRules } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    const d = disruption || {};
    const goalMap = goalMapOf(goals);
    let prio = Number(d.priority);
    if (!(prio >= 1 && prio <= 5)) prio = d.goalId && goalMap[d.goalId] ? goalRank(goalMap[d.goalId], cfg) : 5;
    const forced = !!d.forced;
    const dur = Math.round(Number(d.durationMin) || 0) * MIN;
    const items = itemsOf(blocks, off, d.externalBlockId ? [d.externalBlockId] : []);
    const warnings = [];
    const result = {
      disruptionId: d.id || '', priority: prio, ok: false, placement: null, moved: [], lost: [], lostMinByGoal: {},
      budget_before: [], budget_after: [], warnings, alternatives: [],
    };
    if (dur <= 0) { warnings.push({ code: 'bad_duration', message: 'Thời lượng phải lớn hơn 0.' }); return result; }

    // Khoảng cần quan tâm để tính giờ ngủ
    let anchorS, anchorE;
    if (d.mode === 'fixed_time') { anchorS = parseTime(d.fixedStart, off); anchorE = anchorS + dur; }
    else {
      anchorS = parseTime(d.windowStart, off); anchorE = parseTime(d.windowEnd, off);
      if (anchorE - anchorS < dur) warnings.push({ code: 'window_too_short', message: 'Khung từ đến ngắn hơn thời lượng việc.' });
    }
    const span = cfg.alternativesSearchDays * DAY;
    const sleeps = sleepIntervals(sleepRules, anchorS - span - DAY, anchorE + span + 2 * DAY, off);
    const weekYmd = weekStartYmd(anchorS, off);
    result.budget_before = plannedBudget(blocks, goals, weekYmd, off, cfg);

    // 1. Danh sách khung ứng viên
    const step = cfg.stepMin * MIN;
    const cands = [];
    if (d.mode === 'fixed_time') {
      if (anchorE <= nowMs && !forced) warnings.push({ code: 'in_past', message: 'Khung giờ này đã trôi qua.' });
      else cands.push(anchorS);
    } else {
      let s = anchorS;
      if (nowMs > s) s = anchorS + Math.ceil((nowMs - anchorS) / step) * step;
      for (; s + dur <= anchorE; s += step) cands.push(s);
    }

    // 2-3. Tính chi phí, chọn rẻ nhất, hoà thì sớm hơn
    const reasons = {};
    let best = null;
    for (const s of cands) {
      const ev = evaluateSlot(s, s + dur, prio, forced, items, sleeps, goalMap, cfg);
      if (!ev.ok) { reasons[ev.reason] = (reasons[ev.reason] || 0) + 1; continue; }
      if (!best || ev.cost < best.ev.cost) best = { s, ev };
    }

    if (!best) {
      // 6. Không có ứng viên hợp lệ: cảnh báo xung đột + 3 khung thay thế gần nhất
      warnings.push({ code: 'conflict', reasons, message: conflictMessage(reasons, prio, cfg) });
      result.alternatives = findAlternatives(anchorS, anchorE, dur, prio, nowMs, items, sleeps, goalMap, cfg, off);
      result.budget_after = result.budget_before;
      return result;
    }

    const ps = best.s, pe = best.s + dur;
    result.ok = true;
    result.placement = { start: toISO(ps, off), end: toISO(pe, off), cost: best.ev.cost, bufferUsed: best.ev.bufferUsed };
    best.ev.warnings.forEach(w => warnings.push(w));

    // 4. Dời các block bị chiếm (chỉ một cấp: chỉ vào khoảng trống, không đẩy tiếp block khác)
    const displacedIds = new Set(best.ev.displaced.map(it => it.b.id));
    const busy = sleeps.slice();
    items.forEach(it => { if (it.b.type !== 'buffer' && !displacedIds.has(it.b.id)) busy.push({ s: it.s, e: it.e }); });
    busy.push({ s: ps, e: pe });
    const bufferItems = items.filter(it => it.b.type === 'buffer');
    for (const it of best.ev.displaced) {
      const lo = Math.max(nowMs, startOfLocalDay(it.s, off));
      const hi = blockDeadline(it, off);
      const home = findHome(it.e - it.s, lo, hi, it.s, it.b.energy, busy, bufferItems, off, cfg);
      if (home) {
        busy.push({ s: home.s, e: home.e });
        result.moved.push({ blockId: it.b.id, block: it.b, from: { start: it.b.start, end: it.b.end },
          to: { start: toISO(home.s, off), end: toISO(home.e, off) }, via: home.via });
      } else {
        // 5. Không có chỗ trong hạn: mất block này, báo số phút mục tiêu bị hụt
        result.lost.push(it.b);
        if (it.b.goalId) result.lostMinByGoal[it.b.goalId] = (result.lostMinByGoal[it.b.goalId] || 0) + minutesOf(it);
      }
    }
    if (result.lost.length) warnings.push({ code: 'lost_blocks', message: `${result.lost.length} block không còn chỗ trong hạn.` });

    const applied = applyProposal(blocks, result, d, nowMs, ctx).blocks;
    result.budget_after = plannedBudget(applied, goals, weekYmd, off, cfg);
    return result;
  }

  function conflictMessage(reasons, prio, cfg) {
    const parts = [];
    if (reasons.sleep) parts.push('chồng giờ ngủ');
    if (reasons.fixed) parts.push('chồng block cố định');
    if (reasons.protected) parts.push(`việc ưu tiên ${prio} không được chiếm block bảo vệ (chỉ ưu tiên 1 đến ${cfg.protectedMaxPriority})`);
    if (reasons.priority) parts.push('chỉ được đẩy block có ưu tiên thấp hơn việc mới');
    return 'Không có khung hợp lệ' + (parts.length ? ': ' + parts.join('; ') : '') + '.';
  }

  function findAlternatives(anchorS, anchorE, dur, prio, nowMs, items, sleeps, goalMap, cfg, off) {
    const step = cfg.stepMin * MIN, span = cfg.alternativesSearchDays * DAY;
    let s = anchorS - span;
    if (s < nowMs) s = anchorS - Math.floor((anchorS - nowMs) / step) * step;
    const found = [];
    for (; s + dur <= anchorE + span; s += step) {
      if (s < nowMs) continue;
      const e = s + dur;
      if (s >= anchorS && e <= anchorE) continue; // trong khung đã thử và không hợp lệ
      const ev = evaluateSlot(s, e, prio, false, items, sleeps, goalMap, cfg);
      if (!ev.ok) continue;
      const dist = Math.max(0, anchorS - s, e - anchorE);
      found.push({ s, e, dist, cost: ev.cost, displaced: ev.displaced.length });
    }
    found.sort((a, b) => a.dist - b.dist || a.cost - b.cost || a.s - b.s);
    const out = [];
    for (const f of found) {
      if (out.some(o => overlap(o.s, o.e, f.s, f.e))) continue;
      out.push(f);
      if (out.length >= cfg.alternativesCount) break;
    }
    return out.map(f => ({ start: toISO(f.s, off), end: toISO(f.e, off), cost: f.cost, displaced: f.displaced, distanceMin: Math.round(f.dist / MIN) }));
  }

  /* ======================= Áp dụng phương án (sau khi người dùng bấm Duyệt) ======================= */
  function makeChange(seq, nowMs, off, entity, entityId, action, before, after, cause, causeId) {
    /* id tất định nhưng không trùng giữa hai lần áp dụng trong cùng một mili giây */
    return { id: `chg-${nowMs}-${causeId || cause}-${entityId}-${seq}`, entity, entityId, action, before: before || null, after: after || null,
      cause, causeId: causeId || '', createdAt: toISO(nowMs, off) };
  }
  function pick(b) { return b ? { start: b.start, end: b.end, status: b.status, type: b.type, goalId: b.goalId || '' } : null; }

  function placementBlockId(d) { return 'blk-d-' + (d.id || 'x'); }
  function applyProposal(blocks, proposal, disruption, now, ctx) {
    const { off } = makeCtx(ctx);
    const nowMs = parseTime(now, off), nowIso = toISO(nowMs, off);
    const d = disruption || {};
    const changes = [];
    let seq = 0;
    const movedMap = {}; (proposal.moved || []).forEach(m => { movedMap[m.blockId] = m; });
    const lostIds = new Set((proposal.lost || []).map(b => b.id));
    const out = (blocks || []).map(b => {
      if (movedMap[b.id]) {
        const m = movedMap[b.id];
        const nb = Object.assign({}, b, { start: m.to.start, end: m.to.end, movedFrom: { start: b.start, end: b.end }, movedBy: d.id || '', updatedAt: nowIso });
        changes.push(makeChange(++seq, nowMs, off, 'block', b.id, 'move', pick(b), pick(nb), 'disruption', d.id));
        return nb;
      }
      if (lostIds.has(b.id)) {
        const nb = Object.assign({}, b, { status: 'moved', lostBy: d.id || '', updatedAt: nowIso });
        changes.push(makeChange(++seq, nowMs, off, 'block', b.id, 'lose', pick(b), pick(nb), 'disruption', d.id));
        return nb;
      }
      return b;
    });
    if (proposal.placement && !d.forced) {
      const nb = {
        id: placementBlockId(d), templateId: '', start: proposal.placement.start, end: proposal.placement.end,
        type: d.mode === 'fixed_time' ? 'fixed' : 'flexible', goalId: d.goalId || '', energy: d.energy || '',
        label: d.title || 'Việc phát sinh', priority: proposal.priority || d.priority || 5, status: 'planned', source: 'disruption',
        disruptionId: d.id || '', deadline: d.mode === 'flexible' ? (d.windowEnd || '') : '', gcalEventId: '', updatedAt: nowIso,
      };
      const i = out.findIndex(b => b.id === nb.id);
      if (i >= 0) out[i] = nb; else out.push(nb);
      changes.push(makeChange(++seq, nowMs, off, 'block', nb.id, 'create', null, pick(nb), 'disruption', d.id));
    }
    return { blocks: out, changes };
  }

  /* ======================= Lịch khung -> block thật ======================= */
  /* Template: {id, weekday (0=CN..6=T7), start:'HH:MM', end:'HH:MM', endNextDay?, type, goalId,
                energy, label, count? (số block trong dòng), deadlineHours?}
     Một dòng có count > 1 (ví dụ "Học sâu, 4 block" 08:00 đến 12:00) được chia thành count
     block, mỗi block dài tối đa unitMin phút, bắt đầu cách đều nhau (làm tròn 5 phút).
     Id block tất định nên sinh lại bao nhiêu lần cũng không bị trùng. */
  function generateWeekBlocks(templates, weekMondayYmd, existingBlocks, now, ctx) {
    const { cfg, off } = makeCtx(ctx);
    const nowIso = toISO(parseTime(now, off), off);
    const have = new Set((existingBlocks || []).map(b => b.id));
    const out = [];
    (templates || []).filter(t => t && !t.deletedAt).forEach(t => {
      const wd = Number(t.weekday);
      const ymd = addDaysYmd(weekMondayYmd, (wd + 6) % 7);
      const s0 = localToMs(ymd, t.start, off);
      let e0 = localToMs(t.endNextDay ? addDaysYmd(ymd, 1) : ymd, t.end, off);
      if (e0 <= s0) e0 = localToMs(addDaysYmd(ymd, 1), t.end, off);
      const count = Math.max(1, Math.floor(Number(t.count) || 1));
      const stepRaw = (e0 - s0) / count;
      const step = count > 1 ? Math.round(stepRaw / (5 * MIN)) * 5 * MIN : e0 - s0;
      const unit = count > 1 ? Math.min(cfg.unitMin * MIN, step) : e0 - s0;
      for (let i = 0; i < count; i++) {
        const id = `tpl-${t.id}-${ymd}-${i + 1}`;
        if (have.has(id)) continue;
        const s = s0 + i * step, e = Math.min(s + unit, e0);
        out.push({
          id, templateId: t.id, start: toISO(s, off), end: toISO(e, off), type: t.type || 'flexible',
          goalId: t.goalId || '', energy: t.energy || '', label: (t.label || '') + (count > 1 ? ` (${i + 1}/${count})` : ''),
          status: 'planned', source: 'template',
          deadline: Number(t.deadlineHours) > 0 ? toISO(s + Number(t.deadlineHours) * 3600000, off) : '',
          gcalEventId: '', updatedAt: nowIso,
        });
      }
    });
    return out;
  }

  /* ======================= Check-in ======================= */
  const CHECKIN_TYPES = ['flexible', 'protected'];
  function needsCheckin(b) { return isActive(b) && CHECKIN_TYPES.includes(b.type) && b.status === 'planned'; }
  /* Hàng chờ check-in: block đã kết thúc, chưa check-in.
     due: trong vòng 48 giờ; stale: quá 48 giờ (phải chuyển sang unknown, không tự coi là xong). */
  function checkinQueue(blocks, checkins, now, ctx) {
    const { cfg, off } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    const done = new Set((checkins || []).filter(c => !c.deletedAt).map(c => c.blockId));
    const due = [], stale = [];
    itemsOf(blocks, off).forEach(it => {
      if (!needsCheckin(it.b) || done.has(it.b.id) || it.e > nowMs) return;
      if (nowMs - it.e > cfg.staleCheckinHours * 3600000) stale.push(it.b); else due.push(it.b);
    });
    return { due, stale };
  }
  function markStaleUnknown(blocks, checkins, now, ctx) {
    const { off } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    const { stale } = checkinQueue(blocks, checkins, now, ctx);
    const ids = new Set(stale.map(b => b.id));
    const changes = []; let seq = 0;
    const out = (blocks || []).map(b => {
      if (!ids.has(b.id)) return b;
      const nb = Object.assign({}, b, { status: 'unknown', updatedAt: toISO(nowMs, off) });
      changes.push(makeChange(++seq, nowMs, off, 'block', b.id, 'stale', pick(b), pick(nb), 'user_edit', 'checkin_timeout'));
      return nb;
    });
    return { blocks: out, changes };
  }
  /* checkin: {id, blockId, result:'done'|'partial'|'skipped', completedRatio?, reasonCode?, note?}
     Trả về block đã cập nhật, danh sách task bị trả về hàng chờ (blockId = '') và changelog. */
  function applyCheckin(blocks, tasks, checkin, now, ctx) {
    const { off } = makeCtx(ctx);
    const nowMs = parseTime(now, off), nowIso = toISO(nowMs, off);
    const c = Object.assign({}, checkin);
    c.completedRatio = c.result === 'done' ? 1 : c.result === 'skipped' ? 0 : clampRatio(c.completedRatio);
    if (c.result === 'done') c.reasonCode = '';
    c.createdAt = c.createdAt || nowIso;
    const changes = []; let seq = 0;
    let block = null;
    const outBlocks = (blocks || []).map(b => {
      if (b.id !== c.blockId) return b;
      block = Object.assign({}, b, { status: c.result === 'skipped' ? 'skipped' : c.result, updatedAt: nowIso });
      changes.push(makeChange(++seq, nowMs, off, 'block', b.id, 'checkin', pick(b), pick(block), 'user_edit', c.id));
      return block;
    });
    const returned = [];
    const outTasks = (tasks || []).map(t => {
      if (t.blockId !== c.blockId || c.result === 'done' || t.status === 'done' || t.deletedAt) return t;
      const nt = Object.assign({}, t, { blockId: '', lastBlockId: c.blockId, goalId: t.goalId || (block && block.goalId) || '', updatedAt: nowIso });
      returned.push(nt);
      changes.push(makeChange(++seq, nowMs, off, 'task', t.id, 'unassign', { blockId: t.blockId }, { blockId: '' }, 'user_edit', c.id));
      return nt;
    });
    return { checkin: c, block, blocks: outBlocks, tasks: outTasks, returnedTasks: returned, changes };
  }
  function clampRatio(r) { const v = Number(r); if (!Number.isFinite(v)) return 0.5; return Math.max(0, Math.min(1, v)); }

  /* Đề xuất chỗ mới cho các task vừa quay về hàng chờ (ví dụ sau check-in Bỏ).
     Mỗi task cần estBlocks x unitMin phút, trong khoảng [max(now, earliest), deadline].
     Thứ tự giống khi dời block: khung đệm trống -> cùng năng lượng -> trống bất kỳ. */
  function proposeTaskSlots(tasks, blocks, goals, now, ctx, opts) {
    const { cfg, off, sleepRules } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    opts = opts || {};
    const items = itemsOf(blocks, off);
    const busy = []; items.forEach(it => { if (it.b.type !== 'buffer') busy.push({ s: it.s, e: it.e }); });
    const bufferItems = items.filter(it => it.b.type === 'buffer');
    const horizon = nowMs + (cfg.defaultTaskWindowDays + 1) * DAY;
    sleepIntervals(sleepRules, nowMs - DAY, horizon + 30 * DAY, off).forEach(z => busy.push(z));
    const placed = [], unplaced = [];
    (tasks || []).forEach(t => {
      const dur = Math.max(1, Number(t.estBlocks) || 1) * cfg.unitMin * MIN;
      const earliest = t.earliest ? parseDeadline(t.earliest, off) - (/^\d{4}-\d{2}-\d{2}$/.test(t.earliest) ? DAY : 0) : null;
      const lo = Math.max(nowMs, earliest || nowMs);
      const hi = parseDeadline(t.deadline, off) || parseDeadline(opts.deadline, off) || nowMs + cfg.defaultTaskWindowDays * DAY;
      const energy = t.energyNeed || opts.energy || '';
      const home = findHome(dur, lo, hi, lo, energy, busy, bufferItems, off, cfg);
      if (!home) { unplaced.push(t); return; }
      busy.push({ s: home.s, e: home.e });
      placed.push({ taskId: t.id, title: t.title || '', goalId: t.goalId || opts.goalId || '', energy,
        start: toISO(home.s, off), end: toISO(home.e, off), via: home.via });
    });
    return { placed, unplaced };
  }

  /* ======================= Xếp bù block bị bỏ / làm dở =======================
     Phần thời gian chưa làm được (thời lượng x (1 - tỷ lệ hoàn thành)) được chia thành các
     block bù dài tối đa unitMin phút, xếp sớm nhất có thể từ `now` tới hết tuần của block
     (hoặc tới opts.until). Thứ tự chỗ giống khi dời block: khung đệm trống, rồi khoảng trống
     cùng năng lượng, rồi khoảng trống bất kỳ. Chỉ là đề xuất, áp dụng bằng applyMakeup(). */
  function proposeMakeup(block, completedRatio, blocks, goals, now, ctx, opts) {
    const { cfg, off, sleepRules } = makeCtx(ctx);
    opts = opts || {};
    const nowMs = parseTime(now, off);
    const s = parseTime(block.start, off), e = parseTime(block.end, off);
    const missedMin = Math.round((e - s) / MIN * (1 - clampRatio(completedRatio)));
    const out = { blockId: block.id, goalId: block.goalId || '', energy: block.energy || '', label: block.label || '',
      missedMin, placed: [], unplacedMin: 0 };
    if (missedMin < 15) { out.unplacedMin = 0; out.tooShort = true; return out; }
    let hi = opts.until ? parseDeadline(opts.until, off) : weekRange(weekStartYmd(s, off), off).e;
    if (hi <= nowMs) hi = weekRange(weekStartYmd(nowMs, off), off).e;
    const items = itemsOf(blocks, off);
    const busy = []; items.forEach(it => { if (it.b.type !== 'buffer') busy.push({ s: it.s, e: it.e }); });
    sleepIntervals(sleepRules, nowMs - DAY, hi + DAY, off).forEach(z => busy.push(z));
    const bufferItems = items.filter(it => it.b.type === 'buffer');
    // Chia phần thiếu thành các khúc tối đa unitMin, làm tròn 5 phút, khúc cuối tối thiểu 15 phút
    const chunks = []; let left = Math.round(missedMin / 5) * 5;
    while (left > 0) { const c = Math.min(cfg.unitMin, left); if (c < 15 && chunks.length) { chunks[chunks.length - 1] += c; break; } chunks.push(Math.max(15, c)); left -= c; }
    chunks.forEach(c => {
      const home = findHome(c * MIN, nowMs, hi, nowMs, block.energy, busy, bufferItems, off, cfg);
      if (!home) { out.unplacedMin += c; return; }
      busy.push({ s: home.s, e: home.e });
      out.placed.push({ start: toISO(home.s, off), end: toISO(home.e, off), minutes: c, via: home.via });
    });
    return out;
  }
  /* Áp dụng đề xuất xếp bù: tạo block bù (source = makeup) và đưa các việc vừa quay về
     hàng chờ vào block bù đầu tiên (giống block gốc chứa chúng). */
  function applyMakeup(blocks, tasks, makeup, taskIds, now, ctx) {
    const { off } = makeCtx(ctx);
    const nowMs = parseTime(now, off), nowIso = toISO(nowMs, off);
    const changes = []; let seq = 0;
    const created = (makeup.placed || []).map((p, i) => ({
      id: `blk-bu-${makeup.blockId}-${i + 1}`, templateId: '', start: p.start, end: p.end, type: 'flexible',
      goalId: makeup.goalId || '', energy: makeup.energy || '', label: 'Bù: ' + (makeup.label || 'block'),
      status: 'planned', source: 'makeup', makeupFor: makeup.blockId, deadline: '', gcalEventId: '', updatedAt: nowIso,
    }));
    const have = new Set((blocks || []).map(b => b.id));
    const outBlocks = (blocks || []).slice();
    created.forEach(b => {
      if (have.has(b.id)) return;
      outBlocks.push(b);
      changes.push(makeChange(++seq, nowMs, off, 'block', b.id, 'create', null, pick(b), 'user_edit', 'makeup:' + makeup.blockId));
    });
    const ids = new Set(taskIds || []);
    const target = created[0];
    const outTasks = (tasks || []).map(t => {
      if (!target || !ids.has(t.id)) return t;
      changes.push(makeChange(++seq, nowMs, off, 'task', t.id, 'assign', { blockId: t.blockId || '' }, { blockId: target.id }, 'user_edit', 'makeup:' + makeup.blockId));
      return Object.assign({}, t, { blockId: target.id, updatedAt: nowIso });
    });
    return { blocks: outBlocks, tasks: outTasks, created, changes };
  }

  /* ======================= Dán lịch nhanh từ văn bản =======================
     Mỗi dòng: "giờ - giờ: việc", ví dụ "16h-18h30: Học giải tích", "7:00 - 9:15 Ôn đại số",
     "7-9h Gym", hoặc chỉ giờ bắt đầu "20h: Gọi điện" (mặc định 60 phút, đánh dấu assumedEnd).
     Dòng tiêu đề thứ ("Thứ 2", "T3:", "CN", "Chủ nhật") hoặc ngày ("08/10", "Ngày 8/10/2026")
     đổi ngày cho các dòng phía sau; tiêu đề cũng có thể nằm chung dòng: "T4: 9h-11h Học".
     Không có tiêu đề thì dùng opts.defaultDate. Trả về {items, skipped}. */
  const WD_WORDS = { hai: 1, ba: 2, 'tư': 3, tu: 3, 'năm': 4, nam: 4, 'sáu': 5, sau: 5, 'bảy': 6, bay: 6 };
  const SEP = '[\\s:,.\\-–—)|]';
  const RE_DAY = new RegExp(`^\\s*(?:[-*•+]\\s*)?(?:(thứ|thu)\\s*(hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[2-7])|t\\s*([2-7])|(cn|chủ\\s*nhật|chu\\s*nhat))(?=${SEP}|$)${SEP}*(.*)$`, 'iu');
  const RE_DATE = new RegExp(`^\\s*(?:[-*•+]\\s*)?(?:ngày\\s*)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?(?=${SEP}|$)${SEP}*(.*)$`, 'iu');
  const T = '(\\d{1,2})(?:\\s*(?:h|g|:|giờ)\\s*(\\d{1,2})?\\s*(?:p|ph|phút)?)?';
  const RE_RANGE = new RegExp(`^\\s*(?:[-*•+]\\s*|\\d+[.)]\\s+)?${T}\\s*(?:-|–|—|~|đến|den|tới|toi|to)\\s*${T}(?:\\s*[:.\\-–—|,]+\\s*|\\s+|$)(.*)$`, 'iu');
  const RE_SINGLE = new RegExp(`^\\s*(?:[-*•+]\\s*|\\d+[.)]\\s+)?(\\d{1,2})\\s*(?:h|g|:)\\s*(\\d{1,2})?\\s*(?:[:.\\-–—|,]+\\s*|\\s+)(.+)$`, 'iu');
  function hm2(h, m) { return `${pad(h)}:${pad(m)}`; }
  function okTime(h, m) { return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 24 && m >= 0 && m < 60 && !(h === 24 && m > 0); }
  function parseQuickSchedule(text, opts) {
    opts = opts || {};
    const defaultDate = opts.defaultDate || opts.weekStart;
    const weekStart = opts.weekStart || weekStartYmd(localToMs(defaultDate, '12:00', 0), 0);
    const items = [], skipped = [];
    let curDate = defaultDate;
    String(text || '').normalize('NFC').split(/\r?\n/).forEach((raw, idx) => {
      let line = raw.trim();
      const lineNo = idx + 1;
      if (!line) return;
      let m = line.match(RE_DAY);
      if (m) {
        let wd;
        if (m[4]) wd = 0; else if (m[3]) wd = Number(m[3]) - 1;
        else { const w = m[2].toLowerCase(); wd = /^\d$/.test(w) ? Number(w) - 1 : WD_WORDS[w]; }
        curDate = addDaysYmd(weekStart, (wd + 6) % 7);
        line = m[5].trim();
        if (!line) return;
      } else if ((m = line.match(RE_DATE))) {
        const d = Number(m[1]), mo = Number(m[2]);
        let y = m[3] ? Number(m[3]) : Number(weekStart.slice(0, 4));
        if (y < 100) y += 2000;
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
          curDate = `${y}-${pad(mo)}-${pad(d)}`;
          line = m[4].trim();
          if (!line) return;
        }
      }
      let r = line.match(RE_RANGE), sh, sm, eh, em, title, assumedEnd = false;
      if (r) { sh = +r[1]; sm = +(r[2] || 0); eh = +r[3]; em = +(r[4] || 0); title = r[5]; }
      else if ((r = line.match(RE_SINGLE))) { sh = +r[1]; sm = +(r[2] || 0); title = r[3]; eh = sh + 1; em = sm; assumedEnd = true; }
      if (!r || !okTime(sh, sm) || !okTime(Math.min(eh, 24), em)) { skipped.push({ lineNo, text: raw.trim() }); return; }
      title = String(title || '').replace(/^[\s:.\-–—|,]+/, '').trim() || '(chưa đặt tên)';
      const startMin = sh * 60 + sm;
      let endMin = eh * 60 + em;
      let endNextDay = false;
      if (endMin >= 24 * 60) { endMin -= 24 * 60; endNextDay = true; }
      else if (endMin <= startMin) endNextDay = true; // ví dụ 23h-1h
      if (startMin >= 24 * 60) { skipped.push({ lineNo, text: raw.trim() }); return; }
      items.push({ lineNo, date: curDate, weekday: weekdayOfYmd(curDate), start: hm2(Math.floor(startMin / 60), startMin % 60),
        end: hm2(Math.floor(endMin / 60), endMin % 60), endNextDay, title: title.slice(0, 120), assumedEnd });
    });
    return { items, skipped };
  }

  /* ======================= Ngân sách tuần thực tế ======================= */
  function weekBudget(blocks, goals, checkins, weekMondayYmd, now, ctx) {
    const { cfg, off } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    const wr = weekRange(weekMondayYmd, off);
    const ck = {}; (checkins || []).filter(c => !c.deletedAt).forEach(c => { ck[c.blockId] = c; });
    const per = {};
    (blocks || []).forEach(b => {
      if (!b || b.deletedAt || !countsForBudget(b)) return;
      const s = parseTime(b.start, off), e = parseTime(b.end, off);
      if (!(e > wr.s && s < wr.e)) return;
      const mins = Math.round((Math.min(e, wr.e) - Math.max(s, wr.s)) / MIN);
      const r = per[b.goalId] || (per[b.goalId] = { doneMin: 0, remainingMin: 0, missedMin: 0, unknownMin: 0 });
      const c = ck[b.id];
      if (c) { const got = Math.round(mins * clampRatio(c.completedRatio)); r.doneMin += got; r.missedMin += mins - got; return; }
      if (b.status === 'moved' || b.status === 'skipped') { r.missedMin += mins; return; }
      if (b.status === 'unknown') { r.unknownMin += mins; return; }
      if (e > nowMs) r.remainingMin += mins; else r.unknownMin += mins; // đã qua mà chưa check-in: chưa biết
    });
    return sortGoals(goals, cfg).map(g => {
      const r = per[g.id] || { doneMin: 0, remainingMin: 0, missedMin: 0, unknownMin: 0 };
      const targetMin = numOrNull(g.timeBudgetMinPerWeek);
      const projectedMin = r.doneMin + r.remainingMin;
      const rank = goalRank(g, cfg);
      const warn = Number(g.rank) === 1 && targetMin !== null && targetMin > 0 && projectedMin < targetMin * cfg.rank1WarnRatio;
      return { goalId: g.id, title: g.title || '', rank, rawRank: g.rank, targetMin, doneMin: r.doneMin, remainingMin: r.remainingMin,
        missedMin: r.missedMin, unknownMin: r.unknownMin, projectedMin,
        shortfallPct: targetMin ? Math.max(0, Math.round((1 - projectedMin / targetMin) * 100)) : null, warn };
    });
  }

  /* Thống kê đơn giản: tỷ lệ hoàn thành theo loại block, theo thứ, theo khung giờ; 3 lý do bỏ hàng đầu. */
  function weekStats(blocks, checkins, ctx) {
    const { off } = makeCtx(ctx);
    const byId = {}; (blocks || []).forEach(b => { byId[b.id] = b; });
    const acc = (map, key, ratio) => { const r = map[key] || (map[key] = { count: 0, sum: 0 }); r.count++; r.sum += ratio; };
    const byType = {}, byWeekday = {}, byDaypart = {}, reasons = {};
    (checkins || []).filter(c => !c.deletedAt).forEach(c => {
      const b = byId[c.blockId]; if (!b) return;
      const ratio = clampRatio(c.completedRatio);
      const p = localParts(parseTime(b.start, off), off);
      acc(byType, b.type || 'flexible', ratio);
      acc(byWeekday, p.wd, ratio);
      acc(byDaypart, p.minOfDay < 12 * 60 ? 'sang' : p.minOfDay < 17 * 60 ? 'chieu' : 'toi', ratio);
      if (c.result !== 'done' && c.reasonCode) reasons[c.reasonCode] = (reasons[c.reasonCode] || 0) + 1;
    });
    const fin = m => { const o = {}; Object.keys(m).forEach(k => { o[k] = { count: m[k].count, rate: Math.round(m[k].sum / m[k].count * 100) }; }); return o; };
    const topReasons = Object.keys(reasons).map(k => ({ reasonCode: k, count: reasons[k] }))
      .sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode)).slice(0, 3);
    return { byType: fin(byType), byWeekday: fin(byWeekday), byDaypart: fin(byDaypart), topReasons };
  }

  /* Khung đệm đang diễn ra (hoặc vừa kết thúc) mà vẫn trống: để hỏi người dùng học thêm hay nghỉ. */
  function emptyBuffersAt(blocks, now, ctx) {
    const { off } = makeCtx(ctx);
    const nowMs = parseTime(now, off);
    const items = itemsOf(blocks, off);
    return items.filter(it => it.b.type === 'buffer' && it.b.status === 'planned' && it.s <= nowMs && nowMs < it.e
      && !items.some(o => o.b.type !== 'buffer' && overlap(o.s, o.e, it.s, it.e))).map(it => it.b);
  }

  /* Xung đột hiện có: block của app (không cố định) đang chồng lên block cố định / sự kiện ngoài. */
  function findConflicts(blocks, ctx) {
    const { off } = makeCtx(ctx);
    const items = itemsOf(blocks, off);
    const out = [];
    items.forEach(a => {
      if (a.b.type !== 'fixed') return;
      items.forEach(o => {
        if (o.b.id === a.b.id || o.b.type === 'fixed' || o.b.type === 'buffer') return;
        if (overlap(a.s, a.e, o.s, o.e)) out.push({ fixedId: a.b.id, blockId: o.b.id });
      });
    });
    return out;
  }

  /* ======================= Dữ liệu seed (Phụ lục của spec) ======================= */
  function founderSeed() {
    const T = (id, weekday, start, end, type, goalId, energy, label, extra) =>
      Object.assign({ id, weekday, start, end, type, goalId: goalId || '', energy: energy || '', label, count: 1 }, extra || {});
    return {
      goals: [
        { id: 'goal-gpa', title: 'GPA', rank: 1, timeBudgetMinPerWeek: 18 * 60 },
        { id: 'goal-gym', title: 'Gym', rank: 2, timeBudgetMinPerWeek: 6 * 60 },
        { id: 'goal-quanhe', title: 'Quan hệ', rank: 3, timeBudgetMinPerWeek: null },
        { id: 'goal-startup', title: 'Startup', rank: 4, timeBudgetMinPerWeek: null },
        { id: 'goal-clb', title: 'CLB và ban cán sự', rank: 5, timeBudgetMinPerWeek: null },
      ],
      sleepRules: [
        { wakeWeekdays: [2, 3, 4], start: '22:00', end: '05:00' },
        { wakeWeekdays: [0, 1, 5, 6], start: '23:00', end: '07:00' },
      ],
      templates: [
        T('t2-hocsau', 1, '09:00', '12:00', 'protected', 'goal-gpa', 'deep', 'Học sâu', { count: 3 }),
        T('t2-hoc', 1, '13:15', '16:00', 'flexible', 'goal-gpa', 'deep', 'Học', { count: 3 }),
        T('t2-gym', 1, '16:30', '18:00', 'flexible', 'goal-gym', '', 'Gym'),
        T('t2-truocgt', 1, '19:45', '20:30', 'flexible', 'goal-gpa', 'light', 'Học trước GT'),
        T('t3-gt', 2, '06:00', '10:10', 'fixed', 'goal-gpa', '', 'Lớp Giải tích 1'),
        T('t3-antrua', 2, '10:15', '11:15', 'flexible', 'goal-quanhe', '', 'Ăn trưa với anh em'),
        T('t3-baigt', 2, '11:20', '13:10', 'flexible', 'goal-gpa', 'deep', 'Bài GT sau lớp (hạn 24h)', { deadlineHours: 24 }),
        T('t3-gym', 2, '14:45', '16:15', 'flexible', 'goal-gym', '', 'Gym'),
        T('t3-dem', 2, '17:45', '19:30', 'buffer', '', '', 'Khung đệm'),
        T('t3-soloi', 2, '19:45', '20:30', 'flexible', 'goal-gpa', 'light', 'Sổ lỗi, trang Vũ khí'),
        T('t4-ds', 3, '06:00', '10:10', 'fixed', 'goal-gpa', '', 'Lớp Đại số'),
        T('t4-baids', 3, '11:00', '12:45', 'flexible', 'goal-gpa', 'deep', 'Bài ĐS sau lớp (hạn 24h)', { deadlineHours: 24 }),
        T('t4-gtton', 3, '13:30', '15:00', 'flexible', 'goal-gpa', 'deep', 'GT còn tồn'),
        T('t4-tdtt', 3, '15:30', '16:30', 'fixed', 'goal-gpa', '', 'Lý luận TDTT'),
        T('t4-dem', 3, '18:00', '20:00', 'buffer', '', '', 'Khung đệm / CLB'),
        T('t5-cntt1', 4, '06:00', '12:00', 'fixed', 'goal-gpa', '', 'Lớp Nhập môn CNTT'),
        T('t5-hoc', 4, '13:15', '15:45', 'flexible', 'goal-gpa', 'deep', 'Học: 2 Toán + 1 CNTT', { count: 3 }),
        T('t5-cntt2', 4, '16:00', '18:00', 'fixed', 'goal-gpa', '', 'Lớp Nhập môn CNTT'),
        T('t5-gym', 4, '18:15', '19:45', 'flexible', 'goal-gym', '', 'Gym'),
        T('t6-hocsau', 5, '08:00', '12:00', 'protected', 'goal-gpa', 'deep', 'Học sâu', { count: 4 }),
        T('t6-hoc', 5, '13:15', '15:05', 'flexible', 'goal-gpa', 'deep', 'Học', { count: 2 }),
        T('t6-dem', 5, '15:10', '16:00', 'buffer', '', '', 'Khung đệm'),
        T('t6-gym', 5, '16:30', '18:00', 'flexible', 'goal-gym', '', 'Gym'),
        T('t7-hoc', 6, '08:00', '11:00', 'flexible', 'goal-gpa', 'deep', 'Học: 2 Toán + 1 Pháp luật', { count: 3 }),
        T('t7-pldc', 6, '12:00', '16:00', 'fixed', 'goal-gpa', '', 'Lớp Pháp luật đại cương'),
        T('t7-quehp', 6, '16:30', '08:00', 'fixed', 'goal-quanhe', '', 'Về Hải Phòng', { endNextDay: true }),
        T('cn-nhe', 0, '08:00', '10:45', 'flexible', 'goal-gpa', 'light', 'Việc nhẹ ở quê'),
      ],
    };
  }

  return {
    ENGINE_CONFIG, propose, applyProposal, generateWeekBlocks, checkinQueue, markStaleUnknown, applyCheckin,
    proposeTaskSlots, proposeMakeup, applyMakeup, parseQuickSchedule, weekBudget, plannedBudget: (blocks, goals, weekYmd, ctx) => { const c = makeCtx(ctx); return plannedBudget(blocks, goals, weekYmd, c.off, c.cfg); },
    weekStats, emptyBuffersAt, findConflicts, founderSeed, placementBlockId,
    // tiện ích thời gian (dùng chung cho giao diện và test)
    time: { parseTime, parseDeadline, toISO, localParts, localToMs, addDaysYmd, weekStartYmd, sleepIntervals, endOfLocalDay },
    isActive, blockPriority: (b, goals, ctx) => { const c = makeCtx(ctx); return blockPriority(b, goalMapOf(goals), c.cfg); },
  };
});
