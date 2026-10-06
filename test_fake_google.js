/* Google API giả lập cho test Playwright (không bao giờ gọi Google thật).
   - Drive appDataFolder: nhiều file theo tên, có version tăng dần mỗi lần ghi.
   - Calendar: tạo/sửa/xoá sự kiện có etag, events.list có syncToken, giả lập lỗi 410.
   Cài lên cả browser context để mọi trang mở trong test đều dùng chung một "Google". */
function createFakeGoogle() {
  const drive = { files: new Map(), seq: 0, calls: [] };
  const cal = { events: new Map(), seq: 0, idSeq: 0, gone: false, calls: [], failList: false };

  function driveCreate(name, content) {
    const id = 'f' + (++drive.seq);
    drive.files.set(id, { id, name, content, version: 1 });
    return drive.files.get(id);
  }
  function driveByName(name) { return [...drive.files.values()].find(f => f.name === name) || null; }

  function eventOut(e) { const o = Object.assign({}, e); delete o._seq; return o; }
  function calTouch(e) { e._seq = ++cal.seq; e.etag = `"etag-${e.id}-${e._seq}"`; e.updated = new Date(1767225600000 + e._seq * 1000).toISOString(); return e; }
  function calInsert(body) {
    const id = body.id || ('evt' + (++cal.idSeq));
    const e = calTouch(Object.assign({ kind: 'calendar#event', status: 'confirmed' }, body, { id }));
    cal.events.set(id, e);
    return e;
  }

  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

  async function install(ctx) {
    await ctx.route('https://www.googleapis.com/oauth2/v3/userinfo', route =>
      json(route, 200, { email: 'demo@gmail.com', name: 'Minh Tri', picture: '' }));

    await ctx.route('https://www.googleapis.com/drive/v3/files**', route => {
      const req = route.request(); const url = new URL(req.url());
      drive.calls.push(req.method() + ' ' + url.pathname + url.search);
      if (req.method() !== 'GET') return json(route, 405, {});
      if (url.pathname === '/drive/v3/files') {
        const q = url.searchParams.get('q') || '';
        const m = q.match(/name='([^']+)'/);
        const files = [...drive.files.values()].filter(f => !m || f.name === m[1]).map(f => ({ id: f.id, name: f.name, version: String(f.version) }));
        return json(route, 200, { files });
      }
      const id = url.pathname.split('/').pop();
      const f = drive.files.get(id);
      if (!f) return json(route, 404, { error: { message: 'not found' } });
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'application/json', body: f.content });
      return json(route, 200, { id: f.id, version: String(f.version) });
    });

    await ctx.route('https://www.googleapis.com/upload/drive/v3/files**', route => {
      const req = route.request(); const url = new URL(req.url());
      drive.calls.push(req.method() + ' ' + url.pathname + url.search);
      const body = req.postData() || '';
      if (req.method() === 'POST') {
        const parts = body.split(/--greysteel_bnd_\d+/).map(p => p.replace(/^\r\n/, '')).filter(p => p.includes('\r\n\r\n'));
        const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
        const content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        const f = driveCreate(meta.name, content);
        return json(route, 200, { id: f.id, version: String(f.version) });
      }
      const id = url.pathname.split('/').pop();
      const f = drive.files.get(id);
      if (!f) return json(route, 404, {});
      f.content = body; f.version++;
      return json(route, 200, { id: f.id, version: String(f.version) });
    });

    await ctx.route('https://www.googleapis.com/calendar/v3/calendars/primary/events**', route => {
      const req = route.request(); const url = new URL(req.url()); const method = req.method();
      cal.calls.push(method + ' ' + url.pathname + url.search);
      const parts = url.pathname.split('/events');
      const id = parts[1] ? decodeURIComponent(parts[1].replace(/^\//, '')) : '';
      if (method === 'POST') return json(route, 200, eventOut(calInsert(JSON.parse(req.postData() || '{}'))));
      if (method === 'PATCH') {
        const e = cal.events.get(id);
        if (!e || e.status === 'cancelled') return json(route, 404, { error: { message: 'not found' } });
        Object.assign(e, JSON.parse(req.postData() || '{}')); calTouch(e);
        return json(route, 200, eventOut(e));
      }
      if (method === 'DELETE') {
        const e = cal.events.get(id);
        if (e) { e.status = 'cancelled'; calTouch(e); }
        return route.fulfill({ status: 204, body: '' });
      }
      // GET events.list
      if (cal.failList) return json(route, 500, { error: { message: 'boom' } });
      const tok = url.searchParams.get('syncToken');
      if (tok && (cal.gone || !/^sync-\d+$/.test(tok))) { cal.gone = false; return json(route, 410, { error: { code: 410, message: 'Sync token is no longer valid' } }); }
      if (tok && url.searchParams.get('timeMin')) return json(route, 400, { error: { message: 'timeMin not allowed with syncToken' } });
      const since = tok ? Number(tok.slice(5)) : -1;
      let items = [...cal.events.values()].filter(e => e._seq > since);
      if (!tok) items = items.filter(e => e.status !== 'cancelled' || url.searchParams.get('showDeleted') === 'true');
      return json(route, 200, { items: items.map(eventOut), nextSyncToken: 'sync-' + cal.seq });
    });
  }

  return {
    drive, cal, install, driveCreate, driveByName, calInsert,
    dataFile: () => driveByName('greysteel-tasks-data.json'),
    data: () => { const f = driveByName('greysteel-tasks-data.json'); return f ? JSON.parse(f.content) : null; },
    /* Thiết bị khác ghi đè file dữ liệu (tăng version) */
    writeData: obj => { const f = driveByName('greysteel-tasks-data.json'); if (f) { f.content = JSON.stringify(obj); f.version++; return f; } return driveCreate('greysteel-tasks-data.json', JSON.stringify(obj)); },
    /* Sự kiện người dùng tự tạo / được mời trên Google */
    addExternal: (summary, start, end, extra) => calInsert(Object.assign({ summary, start: { dateTime: start }, end: { dateTime: end } }, extra || {})),
    moveEvent: (id, start, end) => { const e = cal.events.get(id); e.start = { dateTime: start }; e.end = { dateTime: end }; return calTouch(e); },
    appEvents: () => [...cal.events.values()].filter(e => e.status !== 'cancelled' && e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.gsApp === 'greysteel'),
  };
}

/* Server tĩnh cho thư mục public + giả lập Netlify Functions đăng nhập */
function createAppServer(port, opts) {
  const http = require('http'), fs = require('fs'), path = require('path');
  const pub = path.join(__dirname, 'public');
  const st = { session: !!(opts && opts.signedIn) };
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/.netlify/functions/refresh-token') {
      if (!st.session) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'no_session' })); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, access_token: 'AT_REFRESHED', expires_in: 3600 }));
    }
    if (url.pathname === '/.netlify/functions/logout') { st.session = false; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    if (url.pathname === '/.netlify/functions/auth-callback') { st.session = true; res.writeHead(302, { Location: `http://localhost:${port}/#at=AT_FIRST&exp=3600` }); return res.end(); }
    const file = path.join(pub, path.normalize(url.pathname).replace(/^([\\/])+/, ''));
    if (url.pathname !== '/' && file.startsWith(pub) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(file));
    }
    let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
    html = html.replace(/GOOGLE_CLIENT_ID: "[^"]*"/, 'GOOGLE_CLIENT_ID: "fake-client-id.apps.googleusercontent.com"');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  });
  return { server, st };
}

/* Chromium: dùng đường dẫn cố định nếu có (máy CI cũ), không thì để Playwright tự tìm */
function launchOptions() {
  const fs = require('fs');
  return fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
}

module.exports = { createFakeGoogle, createAppServer, launchOptions };
