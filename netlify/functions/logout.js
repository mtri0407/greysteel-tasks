'use strict';
// Đăng xuất: thu hồi refresh_token với Google (best-effort) và xoá cookie phiên.
const { SESSION_COOKIE, requireEnv, decrypt, parseCookies, serializeCookie, revokeToken } = require('./_lib');

exports.handler = async function (event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const enc = cookies[SESSION_COOKIE];
  if (enc) {
    try {
      const sessionSecret = requireEnv('SESSION_SECRET');
      const refreshToken = decrypt(enc, sessionSecret);
      await revokeToken({ token: refreshToken });
    } catch (e) { /* best-effort */ }
  }
  return {
    statusCode: 200,
    multiValueHeaders: { 'Set-Cookie': [serializeCookie(SESSION_COOKIE, '', { maxAge: 0 })] },
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
