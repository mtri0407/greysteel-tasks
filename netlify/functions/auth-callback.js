'use strict';
// Google redirect về đây sau khi người dùng đồng ý cấp quyền. Đổi "code" lấy
// access_token + refresh_token, cất refresh_token (đã mã hoá) vào cookie
// httpOnly để phiên đăng nhập tồn tại lâu dài, rồi chuyển hướng người dùng
// về lại app kèm access_token trong URL fragment (không gửi lên server nào,
// chỉ JS phía trình duyệt đọc được) để dùng ngay.
const {
  SESSION_COOKIE, STATE_COOKIE, SESSION_MAX_AGE,
  requireEnv, encrypt, parseCookies, serializeCookie, exchangeCodeForTokens,
} = require('./_lib');

function htmlError(title, detail) {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title></head>
  <body style="font-family:sans-serif;padding:40px;max-width:520px;margin:0 auto;">
  <h2>${title}</h2><p>${detail}</p><p><a href="/">Quay lại Greysteel Tasks</a></p></body></html>`;
}

exports.handler = async function (event) {
  try {
    const params = event.queryStringParameters || {};
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const origin = `https://${event.headers.host}`;
    const redirectUri = `${origin}/.netlify/functions/auth-callback`;

    if (params.error) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlError('Đăng nhập bị huỷ', 'Bạn đã từ chối cấp quyền hoặc có lỗi từ Google: ' + params.error) };
    }
    if (!params.code || !params.state) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlError('Thiếu tham số', 'Yêu cầu không hợp lệ, thiếu code hoặc state.') };
    }
    if (!cookies[STATE_COOKIE] || cookies[STATE_COOKIE] !== params.state) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: htmlError('Không xác thực được yêu cầu', 'State không khớp (có thể phiên đăng nhập đã hết hạn), vui lòng thử đăng nhập lại.') };
    }

    const clientId = requireEnv('GOOGLE_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET');
    const sessionSecret = requireEnv('SESSION_SECRET');

    const tokens = await exchangeCodeForTokens({ code: params.code, clientId, clientSecret, redirectUri });

    const cookiesOut = [
      serializeCookie(STATE_COOKIE, '', { maxAge: 0 }),
    ];
    if (tokens.refresh_token) {
      const enc = encrypt(tokens.refresh_token, sessionSecret);
      cookiesOut.push(serializeCookie(SESSION_COOKIE, enc, { maxAge: SESSION_MAX_AGE }));
    }
    // Nếu Google không trả refresh_token (trường hợp hiếm khi đã từng cấp quyền
    // trước đó mà không ép prompt=consent) thì vẫn cho qua với access_token hiện có,
    // phiên sẽ chỉ tồn tại tới khi access_token hết hạn thay vì lâu dài.

    const frag = new URLSearchParams({
      at: tokens.access_token || '',
      exp: String(tokens.expires_in || 3600),
    }).toString();

    return {
      statusCode: 302,
      multiValueHeaders: { 'Set-Cookie': cookiesOut },
      headers: { Location: `${origin}/#${frag}` },
      body: '',
    };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: htmlError('Lỗi đăng nhập', 'Có lỗi khi trao đổi mã đăng nhập với Google: ' + String(err.message || err)) };
  }
};
