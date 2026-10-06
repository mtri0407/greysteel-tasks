// Thư viện dùng chung cho các Netlify Functions xử lý đăng nhập Google bền vững.
// Toàn bộ logic thuần tuý (không đụng vào event/context của Netlify) được tách
// riêng ra đây để có thể unit test bằng Node bình thường, không cần chạy thật
// trên Netlify hay gọi mạng ra Google.
'use strict';
const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const SESSION_COOKIE = 'gt_session';
const STATE_COOKIE = 'gt_oauth_state';
const SESSION_MAX_AGE = 180 * 24 * 60 * 60; // 180 ngày, khớp chính sách refresh token của Google
const STATE_MAX_AGE = 10 * 60; // 10 phút, chỉ tồn tại trong lúc quay lại từ Google

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name} trên Netlify. Xem HUONG_DAN.md.`);
  return v;
}

/* ---------- Mã hoá refresh token trước khi lưu vào cookie ---------- */
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}
function encrypt(plainText, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}
function decrypt(payload, secret) {
  const key = deriveKey(secret);
  const buf = Buffer.from(payload, 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/* ---------- Cookie helpers ---------- */
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function serializeCookie(name, value, { maxAge, path = '/', httpOnly = true, secure = true, sameSite = 'Lax' } = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) str += '; HttpOnly';
  if (secure) str += '; Secure';
  if (maxAge === 0) str += '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  else if (maxAge) str += `; Max-Age=${maxAge}`;
  return str;
}

/* ---------- OAuth state (chống CSRF) ---------- */
function randomState() {
  return crypto.randomBytes(24).toString('base64url');
}

/* ---------- Gọi Google OAuth (nhận fetchImpl để test được, mặc định dùng global fetch) ---------- */
function buildAuthUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('exchange_failed: ' + JSON.stringify(json));
  return json; // { access_token, refresh_token?, expires_in, id_token, ... }
}

async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const params = new URLSearchParams({
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('refresh_failed: ' + JSON.stringify(json));
  return json; // { access_token, expires_in, ... } (Google không trả lại refresh_token mới)
}

async function revokeToken({ token, fetchImpl = fetch }) {
  try {
    await fetchImpl(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch (e) { /* best-effort, không chặn logout */ }
}

module.exports = {
  SESSION_COOKIE, STATE_COOKIE, SESSION_MAX_AGE, STATE_MAX_AGE, SCOPES,
  requireEnv, encrypt, decrypt, parseCookies, serializeCookie, randomState,
  buildAuthUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken,
};
