'use strict';
// Trợ lý AI: nhận lịch sử hội thoại từ trình duyệt, gọi Claude, trả về một lượt trả lời.
// Công cụ (đọc lịch, đề xuất phương án) chạy ở trình duyệt; trình duyệt tự gửi kết quả công cụ
// ở lượt sau. API key nằm trong biến môi trường ANTHROPIC_API_KEY của Netlify, không bao giờ
// gửi xuống trình duyệt. Chỉ người đã đăng nhập (có cookie phiên hợp lệ) mới gọi được.
const Anthropic = require('@anthropic-ai/sdk');
const { SESSION_COOKIE, requireEnv, decrypt, parseCookies } = require('./_lib');
const { validateRequest, buildRequest } = require('./_assistant');

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, obj) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) });

let clientFactory = () => new Anthropic({ maxRetries: 1, timeout: 25000 });
/* Chỉ dùng cho test: thay client thật bằng client giả */
exports._setClientFactory = f => { clientFactory = f; };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  // Xác thực: cookie phiên phải giải mã được bằng SESSION_SECRET (không cần gọi Google)
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  const enc = cookies[SESSION_COOKIE];
  if (!enc) return reply(401, { ok: false, error: 'no_session' });
  try { decrypt(enc, requireEnv('SESSION_SECRET')); }
  catch (e) { return reply(401, { ok: false, error: 'bad_session' }); }

  if (!process.env.ANTHROPIC_API_KEY) return reply(503, { ok: false, error: 'not_configured' });

  const v = validateRequest(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body);
  if (v.error) return reply(400, { ok: false, error: v.error });

  try {
    const res = await clientFactory().beta.messages.create(buildRequest(v.messages));
    return reply(200, {
      ok: true, content: res.content, stop_reason: res.stop_reason, stop_details: res.stop_details || null,
      model: res.model,
      usage: res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens,
        cache_read: res.usage.cache_read_input_tokens, cache_write: res.usage.cache_creation_input_tokens } : null,
    });
  } catch (err) {
    // Lỗi cụ thể trước, lỗi chung sau
    if (err instanceof Anthropic.RateLimitError) return reply(429, { ok: false, error: 'rate_limited' });
    if (err instanceof Anthropic.AuthenticationError) return reply(503, { ok: false, error: 'bad_api_key' });
    if (err instanceof Anthropic.BadRequestError) return reply(400, { ok: false, error: 'bad_request', detail: String(err.message).slice(0, 300) });
    if (err instanceof Anthropic.APIConnectionTimeoutError) return reply(504, { ok: false, error: 'timeout' });
    if (err instanceof Anthropic.APIError) return reply(502, { ok: false, error: 'upstream_' + (err.status || 'error') });
    return reply(500, { ok: false, error: 'internal' });
  }
};
