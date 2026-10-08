/* ======================= DỮ LIỆU: MIGRATE, GỘP HAI THIẾT BỊ, CHANGELOG =======================
   Hàm thuần, không gọi Drive: index.html tự đọc/ghi Drive rồi gọi các hàm ở đây.
   Chạy được trong trình duyệt (biến global GSData) và trong Node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;
  const DATA_FILE_NAME = 'greysteel-tasks-data.json';
  /* Các mảng có phần tử mang `id`, gộp theo id khi hai thiết bị cùng sửa */
  const ARRAY_KEYS = ['tasks', 'people', 'notes', 'goals', 'blockTemplates', 'blocks', 'disruptions', 'checkins', 'changelogOutbox', 'focusSessions'];
  const OBJECT_KEYS = ['profile', 'settings', 'calendarSync'];

  const DEFAULT_SLEEP_RULES = [
    { wakeWeekdays: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '07:00' },
  ];
  function defaultSettings() {
    return { sleepRules: DEFAULT_SLEEP_RULES.map(r => Object.assign({}, r, { wakeWeekdays: r.wakeWeekdays.slice() })),
      syncBlocksToCalendar: true, readCalendar: true, autoGenerateWeek: true,
      // Thông báo qua Google Calendar: bản tin buổi sáng và nhắc trước mỗi block
      morningBrief: true, morningBriefTime: '06:00', blockReminders: true, reminderVersion: 0, briefEvents: {},
      // Khung lớn (08:00 đến 12:00) là một block dài; bật thì chia thành block 50 phút như trước
      splitTemplates: false, focusRun: null };
  }

  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

  /* ---------------- Migrate ----------------
     Nhận nội dung file cũ (bất kỳ phiên bản nào), trả về bản mới:
     - KHÔNG xoá, KHÔNG đổi nghĩa trường nào đã có (kể cả khoá lạ không biết);
     - chỉ thêm khoá/trường mới với giá trị mặc định;
     - chạy lại nhiều lần cho cùng kết quả. */
  function migrateState(raw) {
    const src = isObj(raw) ? raw : {};
    const fromVersion = Number(src.schemaVersion) || 1;
    const d = clone(src);
    ARRAY_KEYS.forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
    d.profile = isObj(d.profile) ? d.profile : {};
    d.settings = Object.assign(defaultSettings(), isObj(d.settings) ? d.settings : {});
    if (!Array.isArray(d.settings.sleepRules)) d.settings.sleepRules = defaultSettings().sleepRules;
    d.calendarSync = Object.assign({ syncToken: '', lastSyncAt: '' }, isObj(d.calendarSync) ? d.calendarSync : {});

    d.goals = d.goals.map(g => isObj(g) ? Object.assign({ rank: null, timeBudgetMinPerWeek: null }, g) : g);
    d.tasks = d.tasks.map(t => isObj(t) ? Object.assign({ blockId: '', estBlocks: 1, energyNeed: '', earliest: '', deadline: '' }, t) : t);
    d.schemaVersion = Math.max(SCHEMA_VERSION, fromVersion);
    return { data: d, fromVersion, migrated: fromVersion < SCHEMA_VERSION };
  }

  /* ---------------- Gộp hai thiết bị ----------------
     Gộp ba chiều: base = bản đã tải về lần trước, local = bản đang có trong máy,
     remote = bản vừa đọc lại trên Drive (đã bị thiết bị khác ghi).
     - Phần tử chỉ một bên sửa: lấy bên đã sửa.
     - Cả hai bên cùng sửa: bên có updatedAt mới hơn thắng (bằng nhau thì giữ bản trong máy).
     - Một bên xoá cứng (dữ liệu cũ vẫn xoá cứng), bên kia không sửa: giữ việc xoá.
       Bên kia có sửa sau đó: giữ bản đã sửa để không mất công người dùng.
     - Phần tử mới ở bất kỳ bên nào đều được giữ. */
  function tsOf(x) { const t = Date.parse(x && (x.updatedAt || x.createdAt) || ''); return Number.isNaN(t) ? 0 : t; }
  function mergeArray(base, local, remote) {
    const B = new Map(), L = new Map(), R = new Map();
    (base || []).forEach(x => x && x.id !== undefined && B.set(x.id, x));
    (local || []).forEach(x => x && x.id !== undefined && L.set(x.id, x));
    (remote || []).forEach(x => x && x.id !== undefined && R.set(x.id, x));
    const out = [];
    const decide = id => {
      const b = B.get(id), l = L.get(id), r = R.get(id);
      if (l && r) {
        if (same(l, r)) return l;
        if (b && same(l, b)) return r;
        if (b && same(r, b)) return l;
        return tsOf(r) > tsOf(l) ? r : l;
      }
      if (l) return (b && same(l, b)) ? null : l; // remote đã xoá
      if (r) return (b && same(r, b)) ? null : r; // local đã xoá
      return null;
    };
    const seen = new Set();
    (local || []).forEach(x => { if (!x || x.id === undefined) { out.push(x); return; } if (seen.has(x.id)) return; seen.add(x.id); const v = decide(x.id); if (v) out.push(v); });
    (remote || []).forEach(x => { if (!x || x.id === undefined || seen.has(x.id)) return; seen.add(x.id); const v = decide(x.id); if (v) out.push(v); });
    return out;
  }
  function mergeObject(base, local, remote) {
    if (same(local, remote)) return clone(local);
    if (same(local, base)) return clone(remote);
    if (same(remote, base)) return clone(local);
    if (!isObj(local) || !isObj(remote)) return clone(local);
    const out = {};
    const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
    const b = isObj(base) ? base : {};
    keys.forEach(k => {
      const v = mergeObject(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  function mergeStates(base, local, remote) {
    base = base || {};
    const out = {};
    const keys = new Set([...Object.keys(remote || {}), ...Object.keys(local || {})]);
    keys.forEach(k => {
      if (ARRAY_KEYS.includes(k)) out[k] = mergeArray(base[k], local[k], remote[k]);
      else if (k === 'schemaVersion') out[k] = Math.max(Number(local[k]) || 0, Number(remote[k]) || 0);
      else if (k === 'calendarSync') out[k] = mergeCalendarSync(base[k], local[k], remote[k]);
      else out[k] = mergeObject(base[k], local[k], remote[k]);
    });
    return out;
  }
  /* syncToken là một cặp với lastSyncAt: lấy nguyên cặp của lần đồng bộ mới hơn */
  function mergeCalendarSync(base, local, remote) {
    const l = local || {}, r = remote || {};
    return clone((Date.parse(r.lastSyncAt || '') || 0) > (Date.parse(l.lastSyncAt || '') || 0) ? r : l);
  }

  /* ---------------- Payload ghi lên Drive ----------------
     Giữ nguyên mọi khoá lạ đã đọc được từ file (extra) để bản app cũ hơn/mới hơn không làm mất dữ liệu. */
  function buildPayload(s, extra) {
    const out = Object.assign({}, extra || {});
    out.schemaVersion = SCHEMA_VERSION;
    ARRAY_KEYS.forEach(k => { out[k] = s[k] || []; });
    OBJECT_KEYS.forEach(k => { out[k] = s[k] || {}; });
    return out;
  }
  function extraKeysOf(data) {
    const known = new Set([...ARRAY_KEYS, ...OBJECT_KEYS, 'schemaVersion']);
    const out = {};
    Object.keys(data || {}).forEach(k => { if (!known.has(k)) out[k] = data[k]; });
    return out;
  }

  /* ---------------- Backup & changelog ---------------- */
  function backupFileName(ymd, fromVersion) { return `greysteel-tasks-backup-v${fromVersion}-${ymd}.json`; }
  function monthKey(iso) { return String(iso || '').slice(0, 7); }
  function changelogFileName(ym) { return `changelog-${ym}.json`; }
  /* Nhóm các mục changelog đang chờ theo tháng: {'2026-10': [...]} */
  function groupOutboxByMonth(outbox) {
    const g = {};
    (outbox || []).forEach(e => { const k = monthKey(e.createdAt) || 'unknown'; (g[k] = g[k] || []).push(e); });
    return g;
  }
  /* Chỉ ghi thêm, không sửa mục cũ, bỏ trùng theo id (an toàn khi gửi lại sau lỗi mạng). */
  function appendChangelog(fileContent, entries) {
    const doc = isObj(fileContent) && Array.isArray(fileContent.entries) ? clone(fileContent)
      : { kind: 'greysteel-changelog', entries: Array.isArray(fileContent) ? clone(fileContent) : [] };
    const have = new Set(doc.entries.map(e => e && e.id));
    (entries || []).forEach(e => { if (!have.has(e.id)) { doc.entries.push(clone(e)); have.add(e.id); } });
    return doc;
  }

  /* Xoá mềm: các thực thể mới không xoá cứng mà gắn deletedAt */
  function softDelete(item, nowIso) { return Object.assign({}, item, { deletedAt: nowIso, updatedAt: nowIso }); }
  const alive = arr => (arr || []).filter(x => x && !x.deletedAt);

  return { SCHEMA_VERSION, DATA_FILE_NAME, ARRAY_KEYS, OBJECT_KEYS, defaultSettings, migrateState, mergeStates, mergeArray,
    buildPayload, extraKeysOf, backupFileName, changelogFileName, monthKey, groupOutboxByMonth, appendChangelog, softDelete, alive, clone };
});
