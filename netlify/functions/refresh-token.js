'use strict';
// App gọi hàm này khi tải trang (và mỗi khi access_token sắp hết hạn) để âm
// thầm lấy access_token mới từ refresh_token đang cất trong cookie httpOnly,
// không cần người dùng bấm đăng nhập lại. Đây là phần giải quyết đúng vấn đề
// "vào web lại phải đăng nhập lại".
const { SESSION_COOKIE, requireEnv, decrypt, parseCookies, refreshAccessToken } = require('./_lib');

exports.handler = async function (event) {
  try {
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const enc = cookies[SESSION_COOKIE];
    if (!enc) {
      return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'no_session' }) };
    }
    const sessionSecret = requireEnv('SESSION_SECRET');
    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
    let refreshToken;
    try { refreshToken = decrypt(enc, sessionSecret); }
    catch (e) { return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'bad_session' }) }; }

    const tokens = await refreshAccessToken({ refreshToken, clientId, clientSecret });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: true, access_token: tokens.access_token, expires_in: tokens.expires_in || 3600 }),
    };
  } catch (err) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'refresh_failed' }) };
  }
};
