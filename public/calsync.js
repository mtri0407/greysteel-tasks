/* ======================= ĐỒNG BỘ HAI CHIỀU VỚI GOOGLE CALENDAR (phần thuần) =======================
   File này không gọi mạng. index.html gọi Calendar API rồi đưa kết quả vào đây để:
   - dựng nội dung sự kiện cho một block (có dấu của app trong extendedProperties.private, màu theo loại);
   - xử lý danh sách sự kiện đọc ngược (events.list) thành thay đổi trên block, kèm changelog
     và danh sách xung đột cần chạy engine.
   Cần GSEngine (public/engine.js) được nạp trước. */
(function (root, factory) {
  const engine = (typeof module === 'object' && module.exports) ? require('./engine.js') : root.GSEngine;
  const api = factory(engine);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSCalSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const APP_MARK = 'greysteel';
  /* colorId của Google Calendar: 2 xanh lá nhạt, 5 vàng, 8 xám, 11 đỏ cà chua */
  const COLOR_BY_TYPE = { fixed: '8', protected: '11', flexible: '2', buffer: '5' };
  const TYPE_ICON = { fixed: '📌', protected: '🛡️', flexible: '🍊', buffer: '⏳' };
  const EXT_PREFIX = 'ext-';

  /* Nội dung sự kiện cho 1 block của app. Không đặt nhắc hẹn popup để khỏi dội thông báo
     cho vài chục block mỗi tuần (app tự báo khi block kết thúc). */
  function blockEventBody(block, goals, tz) {
    const g = (goals || []).find(x => x.id === block.goalId);
    return {
      summary: `${TYPE_ICON[block.type] || '🍊'} ${block.label || 'Block'}`,
      description: [g ? `Mục tiêu: ${g.title}` : '', `Loại block: ${block.type}`, 'Tạo bởi Greysteel Tasks (Lịch thông minh).'].filter(Boolean).join('\n'),
      start: { dateTime: block.start, timeZone: tz },
      end: { dateTime: block.end, timeZone: tz },
      colorId: COLOR_BY_TYPE[block.type] || COLOR_BY_TYPE.flexible,
      extendedProperties: { private: { gsApp: APP_MARK, gsBlockId: block.id, gsType: block.type || '', gsGoalId: block.goalId || '' } },
      reminders: { useDefault: false, overrides: [] },
    };
  }
  /* Block nào cần có sự kiện trên Google: block của app còn hiệu lực (sự kiện ngoài thì đã có sẵn) */
  function shouldPush(block) { return !!block && block.source !== 'external' && E.isActive(block); }
  function shouldRemove(block) { return !!block && block.source !== 'external' && !!block.gcalEventId && !E.isActive(block); }

  function isAppEvent(ev) { const p = ev && ev.extendedProperties && ev.extendedProperties.private; return !!(p && p.gsApp === APP_MARK && p.gsBlockId); }
  function declinedBySelf(ev) { return (ev.attendees || []).some(a => a.self && a.responseStatus === 'declined'); }

  /* Xử lý các sự kiện vừa đọc về.
     input: {blocks, knownEventIds (id sự kiện của task/ngày đặc biệt do app tạo theo kiểu cũ),
             events, fullSync (true nếu là đồng bộ đầy đủ), fullSyncFrom (ISO timeMin của lần đầy đủ)}
     output: {blocks (mảng mới), changes, conflicts: [extBlockId], warnings} */
  function processEvents(input, now, ctx) {
    const off = Number.isFinite(ctx && ctx.tzOffsetMin) ? ctx.tzOffsetMin : 420;
    const T = E.time;
    const nowIso = T.toISO(T.parseTime(now, off), off);
    const nowMs = T.parseTime(now, off);
    const blocks = (input.blocks || []).map(b => Object.assign({}, b));
    const byId = new Map(blocks.map(b => [b.id, b]));
    const known = new Set(input.knownEventIds || []);
    const changes = [], conflicts = [], warnings = [];
    let seq = 0;
    const change = (entityId, action, before, after) => changes.push({ id: `chg-gcal-${nowMs}-${entityId}-${++seq}`, entity: 'block', entityId, action,
      before, after, cause: 'gcal_sync', causeId: '', createdAt: nowIso });
    const pick = b => ({ start: b.start, end: b.end, status: b.status, type: b.type });
    const norm = dt => T.toISO(T.parseTime(dt, off), off);
    const seenExt = new Set();

    (input.events || []).forEach(ev => {
      if (!ev || !ev.id) return;
      if (isAppEvent(ev)) {
        const b = byId.get(ev.extendedProperties.private.gsBlockId);
        if (!b || b.deletedAt) return;
        if (ev.status === 'cancelled') {
          if (b.gcalEventId === ev.id && E.isActive(b)) {
            const before = pick(b);
            b.deletedAt = nowIso; b.updatedAt = nowIso; b.gcalEventId = '';
            change(b.id, 'delete', before, null);
          }
          return;
        }
        if (ev.etag && ev.etag === b.gcalEtag) return; // chính app vừa ghi: bỏ qua để chống vòng lặp
        b.gcalEventId = ev.id; b.gcalEtag = ev.etag || '';
        if (!ev.start || !ev.start.dateTime || !ev.end || !ev.end.dateTime) return;
        const ns = norm(ev.start.dateTime), ne = norm(ev.end.dateTime);
        if (T.parseTime(ns, off) === T.parseTime(b.start, off) && T.parseTime(ne, off) === T.parseTime(b.end, off)) return;
        const before = pick(b);
        b.start = ns; b.end = ne; b.updatedAt = nowIso;
        change(b.id, 'move', before, pick(b));
        // Người dùng kéo block trên Google: vi phạm luật cứng thì chỉ cảnh báo, không tự đẩy ngược
        const v = hardRuleViolations(b, blocks, ctx);
        if (v.length) warnings.push({ code: 'gcal_move_violation', blockId: b.id, violations: v,
          message: `Block "${b.label || ''}" bạn vừa kéo trên Google Calendar ${v.map(x => x.message).join(', ')}.` });
        return;
      }
      if (known.has(ev.id)) return; // sự kiện task / ngày đặc biệt do app tạo theo kiểu cũ
      const id = EXT_PREFIX + ev.id;
      const ex = byId.get(id);
      const timed = ev.start && ev.start.dateTime && ev.end && ev.end.dateTime;
      const ignore = ev.status === 'cancelled' || !timed || ev.transparency === 'transparent' || declinedBySelf(ev);
      if (ignore) {
        if (ex && !ex.deletedAt) { const before = pick(ex); ex.deletedAt = nowIso; ex.updatedAt = nowIso; change(id, 'delete', before, null); }
        return;
      }
      seenExt.add(id);
      const ns = norm(ev.start.dateTime), ne = norm(ev.end.dateTime);
      if (ex && !ex.deletedAt && ex.start === ns && ex.end === ne) {
        if (ex.label !== (ev.summary || '')) { ex.label = ev.summary || ''; ex.updatedAt = nowIso; }
        ex.gcalEtag = ev.etag || ''; return;
      }
      const before = ex ? pick(ex) : null;
      const nb = Object.assign(ex || {}, { id, templateId: '', type: 'fixed', source: 'external', label: ev.summary || '(Sự kiện Google)',
        start: ns, end: ne, goalId: '', energy: '', status: 'planned', deadline: '', gcalEventId: ev.id, gcalEtag: ev.etag || '', updatedAt: nowIso });
      delete nb.deletedAt;
      if (!ex) { blocks.push(nb); byId.set(id, nb); }
      change(id, ex ? 'move' : 'create', before, pick(nb));
      if (T.parseTime(ne, off) > nowMs && overlapsAppBlocks(nb, blocks, off)) conflicts.push(id);
    });

    // Đồng bộ đầy đủ (lần đầu hoặc sau lỗi 410): sự kiện ngoài không còn trên Google thì xoá mềm
    if (input.fullSync) {
      const from = input.fullSyncFrom ? T.parseTime(input.fullSyncFrom, off) : -Infinity;
      blocks.forEach(b => {
        if (b.source === 'external' && !b.deletedAt && !seenExt.has(b.id) && T.parseTime(b.end, off) > from) {
          const before = pick(b); b.deletedAt = nowIso; b.updatedAt = nowIso; change(b.id, 'delete', before, null);
        }
      });
    }
    return { blocks, changes, conflicts, warnings };
  }

  function overlapsAppBlocks(ext, blocks, off) {
    const T = E.time; const s = T.parseTime(ext.start, off), e = T.parseTime(ext.end, off);
    return blocks.some(b => b.id !== ext.id && E.isActive(b) && b.type !== 'fixed' && b.type !== 'buffer'
      && T.parseTime(b.start, off) < e && s < T.parseTime(b.end, off));
  }
  function hardRuleViolations(b, blocks, ctx) {
    const off = Number.isFinite(ctx && ctx.tzOffsetMin) ? ctx.tzOffsetMin : 420;
    const T = E.time; const s = T.parseTime(b.start, off), e = T.parseTime(b.end, off);
    const out = [];
    if (T.sleepIntervals((ctx && ctx.sleepRules) || [], s - 86400000, e + 86400000, off).some(z => z.s < e && s < z.e)) out.push({ code: 'sleep', message: 'đang chồng giờ ngủ' });
    blocks.forEach(o => {
      if (o.id === b.id || !E.isActive(o) || o.type !== 'fixed') return;
      if (T.parseTime(o.start, off) < e && s < T.parseTime(o.end, off)) out.push({ code: 'fixed', blockId: o.id, message: `đang chồng block cố định "${o.label || ''}"` });
    });
    return out;
  }

  /* Biến một sự kiện ngoài đang chồng lịch thành "việc phát sinh giờ cố định" cho engine. */
  function disruptionForExternal(ext, now, ctx) {
    const off = Number.isFinite(ctx && ctx.tzOffsetMin) ? ctx.tzOffsetMin : 420;
    const T = E.time;
    const mins = Math.round((T.parseTime(ext.end, off) - T.parseTime(ext.start, off)) / 60000);
    return { id: `dis-${ext.id}-${T.parseTime(ext.start, off)}`, title: ext.label || 'Sự kiện Google', durationMin: mins, priority: 1,
      mode: 'fixed_time', fixedStart: ext.start, windowStart: '', windowEnd: '', forced: true, externalBlockId: ext.id,
      source: 'external', resolution: '', createdAt: T.toISO(T.parseTime(now, off), off), updatedAt: T.toISO(T.parseTime(now, off), off) };
  }

  /* Tham số events.list: lần đầu đồng bộ đầy đủ từ timeMin; sau đó chỉ dùng syncToken
     (theo tài liệu Google, syncToken không được dùng cùng timeMin/timeMax/q/orderBy...). */
  function listParams(syncToken, timeMin, pageToken) {
    const p = { singleEvents: 'true', maxResults: '250', showDeleted: 'true' };
    if (syncToken) p.syncToken = syncToken; else p.timeMin = timeMin;
    if (pageToken) p.pageToken = pageToken;
    return p;
  }

  return { APP_MARK, COLOR_BY_TYPE, blockEventBody, shouldPush, shouldRemove, isAppEvent, processEvents, disruptionForExternal, listParams, hardRuleViolations };
});
