/* ======================= ĐỒNG HỒ HỌC FLOWTIME (giao diện) =======================
   Logic thuần ở GSEngine.focus (engine.js). Ở đây chỉ có giao diện:
   - Bấm "▶ Học" để bắt đầu; 10 phút đầu là "khởi động", chỉ cần ngồi đủ 10 phút.
   - Đồng hồ đếm lên, không ép dừng. Tới mốc (50 phút, rồi mỗi 25 phút nếu học tiếp) thì hỏi nghỉ,
     kèm chuông nhẹ và thông báo.
   - Nghỉ khoảng 1/5 thời gian vừa học; trước khi nghỉ ghi "lát quay lại làm gì", hết giờ nghỉ hiện lại.
   - Phiên đang chạy lưu trong settings.focusRun (lên Drive) nên tải lại trang vẫn chạy tiếp.
   - Kết thúc thì lưu vào focusSessions; phút học thật được cộng vào Ngân sách tuần.
   Thanh đồng hồ chỉ cập nhật chữ mỗi giây, không vẽ lại ô nhập nào (an toàn với bộ gõ tiếng Việt).
   File chỉ định nghĩa hàm, dùng biến chung của index.html lúc được gọi; nạp TRƯỚC script chính. */

const FOCUS = { timer: null, promptedAt: -1, breakAlerted: false, audio: null };
const FOCUS_WARMUP_MIN = 10;

function focusRun() { return state.settings.focusRun || null; }
function setFocusRun(run) { state.settings.focusRun = run; scheduleSave(); }
function fmtClock(min) {
  const total = Math.max(0, Math.floor(min * 60));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
function fmtDur(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? `${h} giờ${m ? ' ' + m + ' phút' : ''}` : `${m} phút`; }

/* Chuông nhẹ hai nốt bằng WebAudio (không cần file âm thanh) */
function focusChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    FOCUS.audio = FOCUS.audio || new AC();
    const ctx = FOCUS.audio; const t0 = ctx.currentTime;
    [[660, 0], [880, 0.22]].forEach(([freq, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  } catch (e) { /* trình duyệt chặn âm thanh thì thôi */ }
}
function focusNotify(title, body, key) {
  focusChime();
  if (typeof notify === 'function') notify(title, body, key);
}

/* Mục tiêu và block gợi ý: block đang diễn ra (không cố định, không đệm, có mục tiêu), không thì mục tiêu hạng cao nhất */
function focusDefaultTarget() {
  const now = Date.now();
  const cur = state.blocks.find(b => GSEngine.isActive(b) && b.goalId && !['fixed', 'buffer'].includes(b.type) && tms(b.start) <= now + 10 * 60000 && now < tms(b.end));
  if (cur) return { goalId: cur.goalId, blockId: cur.id, label: cur.label };
  const top = activeGoals().filter(g => Number(g.rank) >= 1).sort((a, b) => Number(a.rank) - Number(b.rank))[0];
  return { goalId: top ? top.id : '', blockId: '', label: '' };
}
function openFocusStart(opts) {
  if (focusRun()) { renderFocusBar(); toast('Đồng hồ đang chạy rồi'); return; }
  const def = Object.assign(focusDefaultTarget(), opts || {});
  const body = $('#modalBody');
  body.innerHTML = `<h2>Bắt đầu học ⏱</h2>
    <p class="subtle">Đồng hồ đếm lên, không ép dừng. Tới 50 phút app hỏi bạn nghỉ hay học tiếp. Mọi phút học thật được cộng vào Ngân sách tuần.</p>
    <label>Học cho mục tiêu</label><select id="fs-goal">${goalOptions(def.goalId, 'Không gắn mục tiêu')}</select>
    <label>Việc đầu tiên, thật nhỏ (để vượt qua 10 phút đầu)</label>
    <input id="fs-first" placeholder="VD: mở đề GT câu 12, làm ý a">
    <div class="banner" style="margin-top:12px;">📵 Trước khi bấm: để điện thoại ra xa tầm với (phòng khác hoặc trong cặp).</div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Huỷ</button><button class="btn btn-primary" id="fs-go">▶ Bắt đầu</button></div>`;
  $('#modalBg').classList.add('show');
  $m('#mCancel').onclick = closeModal;
  $m('#fs-go').onclick = () => {
    const goalId = $m('#fs-goal').value;
    const blk = def.blockId && state.blocks.find(b => b.id === def.blockId);
    const run = GSEngine.focus.start(nowIso(), { id: 'fs-' + uid(), goalId, blockId: blk && blk.goalId === goalId ? blk.id : '', label: goalTitle(goalId) }, smartCtx());
    run.note = $m('#fs-first').value.trim();
    closeModal();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    FOCUS.promptedAt = -1; FOCUS.breakAlerted = false;
    setFocusRun(run);
    renderFocusBar(); focusLoop();
  };
  setTimeout(() => { const i = $m('#fs-first'); if (i) i.focus(); }, 50);
}
function focusLoop() {
  clearInterval(FOCUS.timer);
  FOCUS.timer = setInterval(focusTick, 1000);
  focusTick();
}
function focusTick() {
  const run = focusRun(); const bar = $('#focusBar');
  if (!run) { clearInterval(FOCUS.timer); if (bar) bar.remove(); return; }
  if (!bar) renderFocusBar();
  const now = nowIso(), ctx = smartCtx();
  const total = GSEngine.focus.minutes(run, now, ctx);
  const clock = $('#fbClock'), sub = $('#fbSub');
  if (run.phase === 'focus') {
    if (clock) clock.textContent = fmtClock(total);
    if (sub) {
      const phase = GSEngine.focus.phaseMinutes(run, now, ctx);
      sub.textContent = phase < FOCUS_WARMUP_MIN && (run.segments || []).length === 0
        ? `Khởi động: còn ${fmtClock(FOCUS_WARMUP_MIN - phase)} là qua 10 phút khó nhất${run.note ? ' · ' + run.note : ''}`
        : `${run.label ? run.label + ' · ' : ''}đang học${run.note ? ' · ' + run.note : ''}`;
    }
    if (GSEngine.focus.shouldPrompt(run, now, ctx) && FOCUS.promptedAt !== run.promptAtMin) {
      FOCUS.promptedAt = run.promptAtMin;
      showFocusPrompt(total);
      focusNotify('⏱ Bạn đã học ' + fmtDur(total), 'Đang có đà thì học tiếp, mệt thì nghỉ ' + GSEngine.focus.suggestBreakMin(GSEngine.focus.phaseMinutes(run, now, ctx)) + ' phút.', 'focus-prompt-' + run.id + '-' + run.promptAtMin);
    }
  } else {
    const left = (tms(run.breakEnd) - Date.now()) / 60000;
    if (clock) clock.textContent = left >= 0 ? fmtClock(left) : '+' + fmtClock(-left);
    if (sub) sub.textContent = left >= 0 ? `Đang nghỉ · đã học ${fmtDur(total)} · lát quay lại: ${run.note || '(chưa ghi)'}` : `Hết giờ nghỉ · quay lại: ${run.note || 'việc đang làm'}`;
    if (left < 0 && !FOCUS.breakAlerted) {
      FOCUS.breakAlerted = true;
      $('#focusBar') && $('#focusBar').classList.add('alert');
      focusNotify('🔔 Hết giờ nghỉ', run.note ? 'Quay lại: ' + run.note : 'Quay lại học tiếp nhé', 'focus-break-' + run.id + '-' + run.breaks);
    }
  }
}
function renderFocusBar() {
  const run = focusRun(); let bar = $('#focusBar');
  if (!run) { if (bar) bar.remove(); return; }
  if (!bar) { bar = el('div', 'focus-bar'); bar.id = 'focusBar'; ($('#appRoot') || document.body).appendChild(bar); }
  bar.classList.toggle('on-break', run.phase === 'break');
  bar.classList.remove('alert', 'ask');
  bar.innerHTML = `<div class="fb-main"><div class="fb-clock" id="fbClock">0:00</div><div class="fb-sub" id="fbSub"></div></div>
    <div class="fb-acts" id="fbActs"></div><div class="fb-ask" id="fbAsk"></div>`;
  const acts = $('#fbActs');
  if (run.phase === 'focus') {
    const br = el('button', 'btn btn-ghost btn-sm', '☕ Nghỉ'); br.id = 'fbBreak'; br.onclick = () => showFocusPrompt(GSEngine.focus.minutes(run, nowIso(), smartCtx()), true);
    acts.appendChild(br);
  } else {
    const back = el('button', 'btn btn-primary btn-sm', '▶ Quay lại học'); back.id = 'fbResume';
    back.onclick = () => { FOCUS.breakAlerted = false; setFocusRun(GSEngine.focus.resume(focusRun(), nowIso(), smartCtx())); renderFocusBar(); focusTick(); };
    acts.appendChild(back);
  }
  const stop = el('button', 'btn btn-ghost btn-sm', '■ Kết thúc'); stop.id = 'fbStop'; stop.onclick = stopFocus;
  acts.appendChild(stop);
  focusTick();
}
/* Hỏi nghỉ hay học tiếp. Nút Học tiếp chỉ hiện khi tới mốc (manual = bấm Nghỉ chủ động). */
function showFocusPrompt(totalMin, manual) {
  const run = focusRun(); const bar = $('#focusBar'); const ask = $('#fbAsk');
  if (!run || !ask) return;
  const bm = GSEngine.focus.suggestBreakMin(GSEngine.focus.phaseMinutes(run, nowIso(), smartCtx()));
  bar.classList.add('ask');
  ask.innerHTML = `<div class="fb-q">${manual ? 'Nghỉ một chút nhé.' : `Bạn đã học <strong>${fmtDur(totalMin)}</strong>. Đang có đà thì học tiếp, mệt thì nghỉ.`}</div>
    <input id="fbNote" placeholder="Lát quay lại làm gì? VD: làm tiếp câu 13b">
    <div class="fb-row"></div>`;
  const row = $('.fb-row', ask);
  if (!manual) {
    const cont = el('button', 'btn btn-primary btn-sm', '🔥 Học tiếp 25 phút'); cont.id = 'fbContinue';
    cont.onclick = () => { setFocusRun(GSEngine.focus.continue(focusRun(), nowIso(), smartCtx())); renderFocusBar(); };
    row.appendChild(cont);
  }
  const brk = el('button', 'btn ' + (manual ? 'btn-primary' : 'btn-ghost') + ' btn-sm', `☕ Nghỉ ${bm} phút`); brk.id = 'fbDoBreak';
  brk.onclick = () => {
    const note = ($('#fbNote') && $('#fbNote').value.trim()) || '';
    FOCUS.breakAlerted = false;
    setFocusRun(GSEngine.focus.pause(focusRun(), nowIso(), note, smartCtx()));
    renderFocusBar();
  };
  row.appendChild(brk);
  if (manual) { const cancel = el('button', 'btn btn-ghost btn-sm', 'Thôi, học tiếp'); cancel.onclick = renderFocusBar; row.appendChild(cancel); }
}
function stopFocus() {
  const run = focusRun(); if (!run) return;
  const ses = GSEngine.focus.stop(run, nowIso(), smartCtx());
  state.settings.focusRun = null;
  if (ses && ses.minutes >= 1) {
    state.focusSessions.push(ses);
    logChanges([mkChange(ses.id, 'focus', null, { minutes: ses.minutes, goalId: ses.goalId }, 'user_edit', '', 'focusSession')]);
  }
  scheduleSave();
  clearInterval(FOCUS.timer);
  const bar = $('#focusBar'); if (bar) bar.remove();
  const today = GSEngine.focus.daily(state.focusSessions, smartCtx())[todayStr()] || 0;
  const streak = GSEngine.focus.streak(state.focusSessions, nowIso(), smartCtx());
  toast(ses && ses.minutes >= 1 ? `Đã học ${fmtDur(ses.minutes)} 🎉 Hôm nay ${fmtDur(today)}${streak ? ' · chuỗi ' + streak + ' ngày' : ''}` : 'Đã dừng đồng hồ');
  safeSoftRefresh();
}
/* Thẻ tóm tắt ở Trang chủ: học hôm nay, chuỗi ngày, nút bắt đầu */
function focusSummaryCard() {
  const all = focusAllSessions(); // tính cả phiên đang chạy
  const daily = GSEngine.focus.daily(all, smartCtx());
  const today = daily[todayStr()] || 0;
  const streak = GSEngine.focus.streak(all, nowIso(), smartCtx());
  const days = []; for (let i = 6; i >= 0; i--) days.push(GSEngine.time.addDaysYmd(todayStr(), -i));
  const max = Math.max(60, ...days.map(d => daily[d] || 0));
  const c = el('div', 'card focus-card'); c.id = 'focusCard';
  c.innerHTML = `<div class="sch-head" style="margin-bottom:6px;"><h3 style="margin:0;">⏱ Thời gian học thật</h3>${streak ? `<span class="tag">🔥 chuỗi ${streak} ngày</span>` : ''}</div>
    <div class="focus-today"><strong>${fmtDur(today)}</strong> hôm nay</div>
    <div class="focus-week">${days.map(d => `<div class="fw-col" title="${fmtDate(d)}: ${fmtDur(daily[d] || 0)}"><div class="fw-bar" style="height:${Math.round((daily[d] || 0) / max * 100)}%"></div><div class="fw-d">${WEEKDAYS[new Date(d + 'T00:00:00').getDay()]}</div></div>`).join('')}</div>`;
  const go = el('button', 'btn btn-primary', focusRun() ? '⏱ Đồng hồ đang chạy' : '▶ Bắt đầu học'); go.id = 'focusStartHome';
  go.onclick = () => openFocusStart(); go.style.marginTop = '10px';
  c.appendChild(go);
  return c;
}
/* Gọi sau khi đăng nhập: khôi phục đồng hồ đang chạy (kể cả khi tải lại trang) */
function initFocus() {
  if (focusRun()) { renderFocusBar(); focusLoop(); }
}
