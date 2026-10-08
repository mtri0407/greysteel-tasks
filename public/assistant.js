/* ======================= TRỢ LÝ AI (phía trình duyệt) =======================
   - Khung chat nổi ở góc phải dưới, hỏi gì về app cũng được.
   - Netlify Function /.netlify/functions/assistant gọi Claude; công cụ chạy NGAY TẠI ĐÂY vì dữ liệu
     nằm trong trình duyệt. Mỗi lượt Claude gọi công cụ, trình duyệt chạy rồi gửi kết quả ở lượt sau.
   - Trợ lý không bao giờ tự sửa dữ liệu: công cụ propose_* / open_* chỉ tạo thẻ có nút, người dùng
     tự bấm và duyệt bằng đúng các màn hình sẵn có của app.
   - Lịch sử gửi lại NGUYÊN VĂN (chỉ ghi thêm, không sửa lượt cũ) vì thinking block của Claude gắn
     với lịch sử; sửa lượt cũ sẽ làm request bị từ chối.
   File chỉ định nghĩa hàm, dùng biến chung của index.html lúc được gọi; nạp TRƯỚC script chính. */

const AI_ENDPOINT = '/.netlify/functions/assistant';
const AI_MAX_HISTORY = 76;   // máy chủ chặn ở 80 tin nhắn
const AI_MAX_ROUNDS = 8;     // số lượt gọi công cụ tối đa cho một câu hỏi
const AI = { history: [], busy: false, open: false, cards: {}, pendingRetry: false };
const AI_SUGGESTIONS = [
  'Block mình lỡ có được xếp bù không?',
  'Tối nay 18h có họp 1 tiếng, xếp giúp mình',
  'Tuần này mục tiêu hạng 1 có đủ giờ không?',
  'Bắt đầu dùng Lịch thông minh thế nào?',
];
const AI_ERRORS = {
  not_configured: 'Trợ lý chưa được bật: chủ app cần thêm biến ANTHROPIC_API_KEY trên Netlify.',
  bad_api_key: 'API key của trợ lý không hợp lệ, chủ app cần kiểm tra lại trên Netlify.',
  no_session: 'Phiên đăng nhập đã hết, hãy tải lại trang.', bad_session: 'Phiên đăng nhập đã hết, hãy tải lại trang.',
  rate_limited: 'Trợ lý đang quá tải, thử lại sau ít phút nhé.',
  timeout: 'Trợ lý trả lời chậm quá, bấm Thử lại.', conversation_too_long: 'Cuộc trò chuyện đã dài, bấm "Cuộc mới" để bắt đầu lại.',
};

/* ---------- Tiện ích ---------- */
function aiLocal(iso) { const p = GSEngine.time.localParts(tms(iso), tzOff()); return `${p.ymd}T${p.hhmm}`; }
function aiDayLabel(iso) { return `${WEEKDAYS[wdOf(iso)]} ${fmtDate(ymdOf(iso))}`; }
/* Nhận 'YYYY-MM-DDTHH:MM' (giờ địa phương) hoặc ISO có múi giờ */
function aiParseLocal(s) {
  const v = String(s || '').trim();
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) throw new Error('Thời gian không hợp lệ: ' + v + ' (cần YYYY-MM-DDTHH:MM)');
  if (/([+-]\d{2}:?\d{2}|Z)$/.test(v)) return GSEngine.time.toISO(GSEngine.time.parseTime(v, tzOff()), tzOff());
  return isoAt(m[1], m[2]);
}
function aiFindGoal(title) {
  if (!title) return null;
  const q = String(title).trim().toLowerCase();
  const gs = activeGoals();
  return gs.find(g => String(g.title || '').toLowerCase() === q) || gs.find(g => String(g.title || '').toLowerCase().includes(q)) || null;
}
const aiH = min => Math.round((Number(min) || 0) / 6) / 10;
function aiBlockInfo(b) {
  const ck = state.checkins.find(c => c.blockId === b.id && !c.deletedAt);
  return { id: b.id, day: aiDayLabel(b.start), start: aiLocal(b.start), end: aiLocal(b.end), label: b.label || '', type: b.type,
    goal: goalTitle(b.goalId) || '', energy: b.energy || '', status: b.status, source: b.source || '',
    tasks: state.tasks.filter(t => t.blockId === b.id && !t.deletedAt).map(t => t.title + (t.status === 'done' ? ' (xong)' : '')),
    checkin: ck ? { result: ck.result, completed_pct: Math.round((Number(ck.completedRatio) || 0) * 100), reason: ck.reasonCode || '' } : null,
    makeup_for: b.makeupFor || '', has_makeup: state.blocks.some(x => x.makeupFor === b.id && !x.deletedAt) };
}

/* ---------- Công cụ ---------- */
const AI_TOOLS = {
  get_overview() {
    const due = checkinDue();
    const stale = state.blocks.filter(b => b.status === 'unknown' && !b.deletedAt).length;
    const wk = currentWeekYmd();
    return {
      goals: activeGoals().map(g => ({ title: g.title, rank: g.rank || null, budget_hours_per_week: g.timeBudgetMinPerWeek ? aiH(g.timeBudgetMinPerWeek) : null, phases: (g.phases || []).length })),
      tasks: { todo: state.tasks.filter(t => t.status === 'todo').length, doing: state.tasks.filter(t => t.status === 'doing').length,
        done: state.tasks.filter(t => t.status === 'done').length, waiting_reschedule: waitingTasks().length },
      checkin_due: due.length, blocks_unknown: stale,
      pending_conflicts: pendingDisruptions().map(d => ({ title: d.title, start: d.fixedStart ? aiLocal(d.fixedStart) : '' })),
      templates: state.blockTemplates.filter(t => !t.deletedAt).length, blocks_this_week: blocksOfWeek(wk).length,
      study_time: { today_minutes: GSEngine.focus.daily(focusAllSessions(), smartCtx())[todayStr()] || 0, streak_days: GSEngine.focus.streak(state.focusSessions, nowIso(), smartCtx()),
        timer_running: !!state.settings.focusRun, morning_brief: state.settings.morningBrief !== false ? (state.settings.morningBriefTime || '06:00') : 'tắt', block_reminders: state.settings.blockReminders !== false },
      setup_checklist: smartChecklist().map(x => ({ step: x.label, done: x.done })),
      sleep_rules: (state.settings.sleepRules || []).map(r => ({ nights_before: (r.wakeWeekdays || []).map(w => WEEKDAYS[w]), sleep: r.start, wake: r.end })),
      settings: { push_blocks_to_google: state.settings.syncBlocksToCalendar !== false, read_google_calendar: state.settings.readCalendar !== false,
        auto_generate_week: state.settings.autoGenerateWeek !== false, last_google_sync: state.calendarSync.lastSyncAt ? aiLocal(state.calendarSync.lastSyncAt) : null },
    };
  },
  get_schedule({ from_date, to_date }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to_date || '')) throw new Error('from_date/to_date phải có dạng YYYY-MM-DD');
    const s = GSEngine.time.localToMs(from_date, '00:00', tzOff());
    let e = GSEngine.time.localToMs(GSEngine.time.addDaysYmd(to_date, 1), '00:00', tzOff());
    if (e - s > 14 * 86400000) e = s + 14 * 86400000;
    const list = state.blocks.filter(b => !b.deletedAt && tms(b.end) > s && tms(b.start) < e).sort((a, b) => tms(a.start) - tms(b.start));
    return { from: from_date, to: GSEngine.time.localParts(e - 1, tzOff()).ymd, count: list.length, blocks: list.slice(0, 200).map(aiBlockInfo),
      note: list.length ? '' : 'Không có block nào trong khoảng này.' };
  },
  get_week_budget({ week_start } = {}) {
    const wk = week_start && /^\d{4}-\d{2}-\d{2}$/.test(week_start) ? GSEngine.time.weekStartYmd(GSEngine.time.localToMs(week_start, '12:00', tzOff()), tzOff()) : currentWeekYmd();
    const wb = GSEngine.weekBudget(state.blocks, activeGoals(), state.checkins, wk, nowIso(), smartCtx(), focusAllSessions());
    const ids = new Set(blocksOfWeek(wk).map(b => b.id));
    const st = GSEngine.weekStats(state.blocks, state.checkins.filter(c => ids.has(c.blockId)), smartCtx());
    return { week_start: wk, goals: wb.map(x => ({ goal: x.title, rank: x.rawRank || null, target_hours: x.targetMin != null ? aiH(x.targetMin) : null,
      done_hours: aiH(x.doneMin), remaining_planned_hours: aiH(x.remainingMin), missed_hours: aiH(x.missedMin), not_checked_in_hours: aiH(x.unknownMin),
      projected_hours: aiH(x.projectedMin), shortfall_pct: x.shortfallPct, warning: x.warn })),
      completion_rate_pct: { by_block_type: st.byType, by_weekday: st.byWeekday, by_daypart: st.byDaypart }, top_skip_reasons: st.topReasons };
  },
  list_tasks({ status = 'any', query = '' } = {}) {
    const q = String(query || '').toLowerCase();
    let list = state.tasks.filter(t => !t.deletedAt);
    if (status === 'waiting') list = waitingTasks();
    else if (status && status !== 'any') list = list.filter(t => (t.status || 'todo') === status);
    if (q) list = list.filter(t => String(t.title || '').toLowerCase().includes(q));
    return { count: list.length, tasks: list.slice(0, 50).map(t => ({ title: t.title, status: t.status || 'todo', due: t.dueDate || '', due_time: t.dueTime || '',
      quadrant: t.quadrant, in_block: t.blockId ? (state.blocks.find(b => b.id === t.blockId) || {}).label || t.blockId : '', est_blocks: t.estBlocks || 1, deadline: t.deadline || '' })) };
  },
  get_missed_blocks() {
    const q = GSEngine.checkinQueue(state.blocks, state.checkins, nowIso(), smartCtx());
    const missed = state.blocks.filter(b => !b.deletedAt && ['skipped', 'partial', 'unknown'].includes(b.status) && b.type !== 'fixed');
    return { waiting_checkin: q.due.map(aiBlockInfo), over_48h_not_checked: q.stale.map(aiBlockInfo),
      skipped_or_partial_or_unknown: missed.map(b => Object.assign(aiBlockInfo(b), { can_makeup: canMakeup(b) })) };
  },
  propose_disruption(inp) {
    const goal = aiFindGoal(inp.goal_title);
    let prio = Number(inp.priority);
    if (!(prio >= 1 && prio <= 5)) prio = goal && Number(goal.rank) >= 1 ? Number(goal.rank) : 5;
    const d = { id: 'dis-' + uid(), title: String(inp.title || 'Việc phát sinh').slice(0, 120), durationMin: Math.round(Number(inp.duration_min) || 0),
      priority: prio, goalId: goal ? goal.id : '', mode: inp.mode === 'flexible' ? 'flexible' : 'fixed_time', source: 'assistant', resolution: '',
      fixedStart: '', windowStart: '', windowEnd: '' };
    if (d.durationMin <= 0) throw new Error('duration_min phải lớn hơn 0');
    if (d.mode === 'fixed_time') d.fixedStart = aiParseLocal(inp.fixed_start);
    else { d.windowStart = aiParseLocal(inp.window_start); d.windowEnd = aiParseLocal(inp.window_end); }
    const p = GSEngine.propose(state.blocks, state.goals, d, nowIso(), smartCtx());
    aiCard('⚡', `Phương án cho "${d.title}"`, p.ok ? `${fmtSlot(p.placement.start, p.placement.end)} · dời ${p.moved.length} block · mất ${p.lost.length} block`
      : 'Không có khung hợp lệ, có khung thay thế để chọn', 'Xem phương án và duyệt',
      () => openReviewModal(d, GSEngine.propose(state.blocks, state.goals, d, nowIso(), smartCtx())));
    const after = {}; p.budget_after.forEach(x => { after[x.goalId] = x; });
    return { card_shown: true, user_must_approve: true, ok: p.ok, priority_used: p.priority, goal: goal ? goal.title : null,
      placement: p.placement ? { start: aiLocal(p.placement.start), end: aiLocal(p.placement.end), uses_buffer: p.placement.bufferUsed } : null,
      moved: p.moved.map(m => ({ block: m.block.label, goal: goalTitle(m.block.goalId), from: aiLocal(m.from.start), to: aiLocal(m.to.start), via: m.via })),
      lost: p.lost.map(b => ({ block: b.label, goal: goalTitle(b.goalId), minutes: Math.round((tms(b.end) - tms(b.start)) / 60000) })),
      budget_change: p.budget_before.filter(x => (after[x.goalId] || x).plannedMin !== x.plannedMin)
        .map(x => ({ goal: x.title, before_hours: aiH(x.plannedMin), after_hours: aiH(after[x.goalId].plannedMin), target_hours: x.targetMin != null ? aiH(x.targetMin) : null })),
      warnings: p.warnings.map(w => w.message), alternatives: p.alternatives.map(a => ({ start: aiLocal(a.start), end: aiLocal(a.end) })) };
  },
  propose_makeup({ block_id }) {
    const b = state.blocks.find(x => x.id === block_id);
    if (!b) throw new Error('Không tìm thấy block ' + block_id + '. Dùng get_missed_blocks hoặc get_schedule để lấy id đúng.');
    if (!canMakeup(b)) return { ok: false, reason: b.goalId ? 'Block này không cần hoặc đã được xếp bù (chỉ bù block bị Bỏ, làm Một phần hoặc chưa rõ, chưa có block bù).' : 'Block không gắn mục tiêu nên không cần bù.' };
    const mk = GSEngine.proposeMakeup(b, ratioOf(b), state.blocks, state.goals, nowIso(), smartCtx());
    const tasks = state.tasks.filter(t => t.lastBlockId === b.id && !t.blockId && t.status !== 'done');
    aiCard('🔁', `Xếp bù "${b.label}"`, `${mk.missedMin} phút · ${mk.placed.length} block bù${mk.unplacedMin ? ' · thiếu chỗ ' + mk.unplacedMin + ' phút' : ''}`,
      'Xem đề xuất bù và duyệt', () => openRecoveryModal([{ blockId: b.id, ratio: ratioOf(b) }], tasks));
    return { card_shown: true, user_must_approve: true, missed_minutes: mk.missedMin, too_short: !!mk.tooShort,
      makeup_blocks: mk.placed.map(x => ({ start: aiLocal(x.start), end: aiLocal(x.end), minutes: x.minutes, via: x.via })), unplaced_minutes: mk.unplacedMin,
      tasks_moving_with_it: tasks.map(t => t.title) };
  },
  propose_task(inp) {
    const t = { title: String(inp.title || '').slice(0, 200), dueDate: inp.due_date || '', dueTime: inp.due_time || '', quadrant: Number(inp.quadrant) || 4,
      status: 'todo', subtasks: [], estBlocks: Number(inp.est_blocks) || 1, energyNeed: inp.energy || '', deadline: inp.deadline || '' };
    aiCard('📋', `Thêm việc "${t.title}"`, [t.dueDate && 'hạn ' + fmtDate(t.dueDate), t.dueTime, QUADRANTS[t.quadrant] && QUADRANTS[t.quadrant].label].filter(Boolean).join(' · '),
      'Mở form đã điền sẵn', () => openTaskModal(Object.assign({}, t), true));
    return { card_shown: true, user_must_confirm: true };
  },
  open_screen({ view, tab }) {
    const v = VIEWS.find(x => x.id === view);
    if (!v) throw new Error('Màn hình không tồn tại: ' + view);
    aiCard(v.icon, `Mở ${v.label}`, '', 'Mở màn hình', () => { guideTry({ view, tab }); aiToggle(false); });
    return { card_shown: true };
  },
  open_checkin() {
    const n = checkinDue().length;
    aiCard('✅', 'Hàng chờ check-in', n ? `${n} block chờ check-in` : 'Hiện chưa có block nào chờ', 'Mở check-in', () => { guideTry({ action: 'checkin' }); });
    return { card_shown: true, blocks_waiting: n };
  },
  start_tour({ tour }) {
    aiCard('▶', tour === 'app' ? 'Tour toàn bộ app' : 'Tour Lịch thông minh', '', 'Bắt đầu tour', () => { aiToggle(false); startTour(tour === 'app' ? 'app' : 'smart'); });
    return { card_shown: true };
  },
};
const AI_TOOL_LABEL = { get_overview: 'xem tổng quan dữ liệu', get_schedule: 'xem lịch', get_week_budget: 'xem ngân sách tuần', list_tasks: 'xem danh sách việc',
  get_missed_blocks: 'xem các block bị lỡ', propose_disruption: 'chạy engine tính phương án', propose_makeup: 'tính đề xuất xếp bù' };

async function aiRunTool(block) {
  const f = AI_TOOLS[block.name];
  if (AI_TOOL_LABEL[block.name]) aiStatus('🔎 Trợ lý đang ' + AI_TOOL_LABEL[block.name] + (block.name === 'get_schedule' && block.input ? ` ${fmtDate(block.input.from_date)} đến ${fmtDate(block.input.to_date)}` : ''));
  try {
    if (!f) throw new Error('Công cụ không tồn tại: ' + block.name);
    const out = await f(block.input || {});
    let text = JSON.stringify(out);
    if (text.length > 38000) text = text.slice(0, 38000) + '... (đã cắt bớt, hãy hỏi khoảng ngắn hơn)';
    return { type: 'tool_result', tool_use_id: block.id, content: text };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: block.id, content: String(e.message || e), is_error: true };
  }
}

/* ---------- Gọi máy chủ và vòng lặp công cụ ---------- */
function aiContextLine() {
  const now = nowIso();
  const titleOf = { schedule: 'Lịch thông minh', budget: 'Ngân sách tuần', planner: 'Lộ trình mục tiêu', guide: 'Hướng dẫn sử dụng' };
  const v = VIEWS.find(x => x.id === state.view);
  return `[Bối cảnh tự động, không phải câu hỏi: bây giờ là ${aiDayLabel(now)} ${aiLocal(now)}; tuần hiện tại bắt đầu thứ 2 ${currentWeekYmd()}; người dùng đang ở màn hình "${titleOf[state.view] || (v && v.label) || state.view}".]`;
}
async function aiSend(text) {
  text = String(text || '').trim();
  if (!text || AI.busy) return;
  if (AI.history.length >= AI_MAX_HISTORY) { aiBubble('ai', AI_ERRORS.conversation_too_long, true); return; }
  AI.history.push({ role: 'user', content: [{ type: 'text', text: aiContextLine() }, { type: 'text', text }] });
  aiBubble('me', text);
  await aiLoop();
}
async function aiLoop() {
  AI.busy = true; aiSetBusy(true);
  try {
    for (let round = 0; round < AI_MAX_ROUNDS; round++) {
      let res, j;
      try {
        res = await fetch(AI_ENDPOINT, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: AI.history }) });
        j = await res.json().catch(() => ({}));
      } catch (e) { j = { ok: false, error: 'network' }; }
      if (!j || !j.ok) {
        const msg = AI_ERRORS[j && j.error] || 'Chưa kết nối được trợ lý (mạng chập chờn hoặc máy chủ bận).';
        aiBubble('ai', msg, true, AI_ERRORS[j && j.error] && !/timeout|rate_limited/.test(j.error) ? null : () => aiLoop());
        return;
      }
      AI.history.push({ role: 'assistant', content: j.content }); // giữ nguyên văn, kể cả thinking block
      const said = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
      if (said) aiBubble('ai', said);
      if (j.stop_reason === 'refusal') { aiBubble('ai', 'Mình không trả lời được câu này. Bạn thử hỏi cách khác về việc dùng app nhé.', true); return; }
      if (j.stop_reason !== 'tool_use') return;
      const calls = (j.content || []).filter(b => b.type === 'tool_use');
      const results = [];
      for (const c of calls) results.push(await aiRunTool(c));
      AI.history.push({ role: 'user', content: results }); // trả mọi kết quả trong MỘT tin nhắn
    }
    aiBubble('ai', 'Câu hỏi này cần nhiều bước quá, bạn hỏi tách nhỏ giúp mình nhé.', true);
  } finally { AI.busy = false; aiSetBusy(false); aiStatus(''); }
}

/* ---------- Giao diện ---------- */
function aiMd(src) {
  const lines = esc(src).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  lines.forEach(l => {
    const ul = l.match(/^\s*[-*•]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/), h = l.match(/^#{1,4}\s+(.*)$/);
    if (ul || ol) { const tag = ul ? 'ul' : 'ol'; if (list !== tag) { close(); html += `<${tag}>`; list = tag; } html += `<li>${(ul || ol)[1]}</li>`; return; }
    close();
    if (h) html += `<div class="ai-h">${h[1]}</div>`; else if (l.trim()) html += `<p>${l}</p>`;
  });
  close();
  return html;
}
function aiBubble(who, text, isNote, retry) {
  const box = $('#aiMsgs'); if (!box) return;
  $('#aiEmpty') && $('#aiEmpty').remove();
  const b = el('div', 'ai-msg ' + (who === 'me' ? 'me' : 'ai') + (isNote ? ' note' : ''));
  if (who === 'me') b.textContent = text; else b.innerHTML = aiMd(text);
  if (retry) { const r = el('button', 'btn btn-ghost btn-sm', '↻ Thử lại'); r.onclick = () => { r.remove(); aiLoop(); }; b.appendChild(r); }
  box.appendChild(b); box.scrollTop = box.scrollHeight;
}
function aiCard(icon, title, sub, btnLabel, onClick) {
  const box = $('#aiMsgs'); if (!box) return;
  const c = el('div', 'ai-card');
  c.innerHTML = `<div class="ai-card-t">${icon} ${esc(title)}</div>${sub ? `<div class="subtle">${esc(sub)}</div>` : ''}`;
  const b = el('button', 'btn btn-primary btn-sm', esc(btnLabel)); b.onclick = onClick; c.appendChild(b);
  box.appendChild(c); box.scrollTop = box.scrollHeight;
}
function aiStatus(text) { const s = $('#aiStatus'); if (s) { s.textContent = text; s.style.display = text ? '' : 'none'; } }
function aiSetBusy(on) {
  const send = $('#aiSendBtn'); if (send) send.disabled = on;
  if (on) aiStatus('✍️ Trợ lý đang trả lời...');
}
function aiToggle(open) {
  AI.open = open === undefined ? !AI.open : open;
  const p = $('#aiPanel'); if (!p) return;
  p.classList.toggle('show', AI.open);
  document.body.classList.toggle('ai-open', AI.open);
  $('#aiFab').classList.toggle('hide', AI.open);
  if (AI.open) setTimeout(() => { const i = $('#aiInput'); if (i) i.focus(); }, 50);
}
function openAssistant(question) {
  aiToggle(true);
  if (question) aiSend(question);
}
function aiNewChat() {
  if (AI.busy) return;
  AI.history = [];
  const box = $('#aiMsgs'); box.innerHTML = ''; box.appendChild(aiEmptyState());
}
function aiEmptyState() {
  const e = el('div', 'ai-empty'); e.id = 'aiEmpty';
  e.innerHTML = '<div class="ai-hello">👋 Mình là trợ lý của Greysteel Tasks. Hỏi mình bất cứ điều gì về cách dùng app, hoặc nhờ mình xử lý tình huống: việc phát sinh, block bị lỡ, ngân sách giờ...</div>';
  AI_SUGGESTIONS.forEach(s => { const b = el('button', 'ai-chip', esc(s)); b.onclick = () => aiSend(s); e.appendChild(b); });
  return e;
}
/* Gắn nút và khung chat vào app (gọi một lần sau khi đăng nhập) */
function initAssistant() {
  if ($('#aiFab')) return;
  const root = $('#appRoot');
  const fab = el('button', 'ai-fab', '💬 <span>Hỏi trợ lý</span>'); fab.id = 'aiFab'; fab.title = 'Trợ lý AI'; fab.onclick = () => aiToggle(true);
  const panel = el('div', 'ai-panel'); panel.id = 'aiPanel';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Trợ lý AI');
  panel.innerHTML = `<div class="ai-head"><strong>🤖 Trợ lý Greysteel</strong><span style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" id="aiNew">Cuộc mới</button><button class="icon-btn ai-x" id="aiClose" title="Đóng">✕</button></div>
    <div class="ai-msgs" id="aiMsgs"></div>
    <div class="ai-status subtle" id="aiStatus" style="display:none"></div>
    <div class="ai-input-row"><textarea id="aiInput" rows="2" placeholder="Hỏi gì cũng được, ví dụ: thứ 6 có việc gấp 9h thì sao?"></textarea>
      <button class="btn btn-primary" id="aiSendBtn">Gửi</button></div>
    <div class="ai-foot">Câu hỏi và phần dữ liệu trợ lý cần xem được gửi tới Claude (Anthropic) để trả lời. Trợ lý không tự sửa dữ liệu: mọi thay đổi bạn tự bấm duyệt.</div>`;
  root.append(fab, panel);
  $('#aiMsgs').appendChild(aiEmptyState());
  $('#aiClose').onclick = () => aiToggle(false);
  $('#aiNew').onclick = aiNewChat;
  const input = $('#aiInput');
  /* Không đụng vào value khi đang gõ (bộ gõ tiếng Việt); chỉ xoá sau khi gửi. Enter gửi, Shift+Enter xuống dòng. */
  const send = () => { const v = input.value; if (!v.trim() || AI.busy) return; input.value = ''; aiSend(v); };
  $('#aiSendBtn').onclick = send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
}
