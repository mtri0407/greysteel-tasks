'use strict';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.SESSION_SECRET = 'unit-test-session-secret-please-ignore';

const assert = require('assert');
const lib = require('./_lib');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('OK  ', name); }
  catch (e) { failures++; console.log('FAIL', name, '\n     ', e.message); }
}

// 1. Encrypt/decrypt round trip
check('encrypt/decrypt round trip', () => {
  const secret = 'my-session-secret';
  const plain = '1//0gRefreshTokenExample';
  const enc = lib.encrypt(plain, secret);
  assert.notStrictEqual(enc, plain);
  const dec = lib.decrypt(enc, secret);
  assert.strictEqual(dec, plain);
});
check('decrypt with wrong secret throws', () => {
  const enc = lib.encrypt('abc', 'secret-a');
  assert.throws(() => lib.decrypt(enc, 'secret-b'));
});

// 2. Cookie parse/serialize
check('parseCookies handles multiple cookies', () => {
  const parsed = lib.parseCookies('gt_session=abc123; gt_oauth_state=xyz%20789');
  assert.strictEqual(parsed.gt_session, 'abc123');
  assert.strictEqual(parsed.gt_oauth_state, 'xyz 789');
});
check('parseCookies handles empty/undefined', () => {
  assert.deepStrictEqual(lib.parseCookies(undefined), {});
  assert.deepStrictEqual(lib.parseCookies(''), {});
});
check('serializeCookie includes HttpOnly/Secure/SameSite/MaxAge', () => {
  const str = lib.serializeCookie('gt_session', 'val', { maxAge: 100 });
  assert.ok(str.includes('HttpOnly'));
  assert.ok(str.includes('Secure'));
  assert.ok(str.includes('SameSite=Lax'));
  assert.ok(str.includes('Max-Age=100'));
});
check('serializeCookie maxAge 0 expires the cookie', () => {
  const str = lib.serializeCookie('gt_session', '', { maxAge: 0 });
  assert.ok(str.includes('Max-Age=0'));
  assert.ok(str.includes('1970'));
});

// 3. buildAuthUrl
check('buildAuthUrl includes required params', () => {
  const url = lib.buildAuthUrl({ clientId: 'cid', redirectUri: 'https://x.netlify.app/.netlify/functions/auth-callback', state: 'st123' });
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(url.includes('client_id=cid'));
  assert.ok(url.includes('access_type=offline'));
  assert.ok(url.includes('prompt=consent'));
  assert.ok(url.includes('state=st123'));
  assert.ok(url.includes(encodeURIComponent('https://x.netlify.app/.netlify/functions/auth-callback')));
});

// 4. exchangeCodeForTokens / refreshAccessToken with fake fetch
async function run() {
  await (async () => {
    const fakeFetch = async (url, opts) => {
      assert.strictEqual(url, 'https://oauth2.googleapis.com/token');
      const body = new URLSearchParams(opts.body);
      assert.strictEqual(body.get('grant_type'), 'authorization_code');
      assert.strictEqual(body.get('code'), 'fake-code');
      return { ok: true, json: async () => ({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }) };
    };
    const tokens = await lib.exchangeCodeForTokens({ code: 'fake-code', clientId: 'cid', clientSecret: 'secret', redirectUri: 'https://x/redirect', fetchImpl: fakeFetch });
    assert.strictEqual(tokens.access_token, 'AT1');
    assert.strictEqual(tokens.refresh_token, 'RT1');
    console.log('OK   exchangeCodeForTokens happy path');
  })().catch(e => { failures++; console.log('FAIL exchangeCodeForTokens happy path\n     ', e.message); });

  await (async () => {
    const fakeFetch = async () => ({ ok: false, json: async () => ({ error: 'invalid_grant' }) });
    let threw = false;
    try { await lib.exchangeCodeForTokens({ code: 'bad', clientId: 'c', clientSecret: 's', redirectUri: 'r', fetchImpl: fakeFetch }); }
    catch (e) { threw = true; }
    assert.ok(threw);
    console.log('OK   exchangeCodeForTokens throws on Google error');
  })().catch(e => { failures++; console.log('FAIL exchangeCodeForTokens throws on Google error\n     ', e.message); });

  await (async () => {
    const fakeFetch = async (url, opts) => {
      const body = new URLSearchParams(opts.body);
      assert.strictEqual(body.get('grant_type'), 'refresh_token');
      assert.strictEqual(body.get('refresh_token'), 'RT1');
      return { ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) };
    };
    const tokens = await lib.refreshAccessToken({ refreshToken: 'RT1', clientId: 'cid', clientSecret: 'secret', fetchImpl: fakeFetch });
    assert.strictEqual(tokens.access_token, 'AT2');
    console.log('OK   refreshAccessToken happy path');
  })().catch(e => { failures++; console.log('FAIL refreshAccessToken happy path\n     ', e.message); });

  // 5. Full handler tests with fetch mocked globally
  global.fetch = async (url, opts) => {
    if (String(url).includes('/token')) {
      const body = new URLSearchParams(opts.body);
      if (body.get('grant_type') === 'authorization_code') {
        if (body.get('code') === 'good-code') return { ok: true, json: async () => ({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }) };
        return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
      }
      if (body.get('grant_type') === 'refresh_token') {
        if (body.get('refresh_token') === 'RT1') return { ok: true, json: async () => ({ access_token: 'AT2', expires_in: 3600 }) };
        return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
      }
    }
    if (String(url).includes('/revoke')) return { ok: true, json: async () => ({}) };
    throw new Error('unexpected fetch to ' + url);
  };

  const authCallback = require('./auth-callback');
  const refreshTokenFn = require('./refresh-token');
  const logoutFn = require('./logout');

  await (async () => {
    const event = {
      headers: { host: 'greysteeltask.netlify.app', cookie: 'gt_oauth_state=state123' },
      queryStringParameters: { code: 'good-code', state: 'state123' },
    };
    const res = await authCallback.handler(event);
    assert.strictEqual(res.statusCode, 302);
    assert.ok(res.headers.Location.startsWith('https://greysteeltask.netlify.app/#'));
    assert.ok(res.headers.Location.includes('at=AT1'));
    const setCookies = res.multiValueHeaders['Set-Cookie'];
    assert.ok(setCookies.some(c => c.startsWith('gt_session=')));
    assert.ok(setCookies.some(c => c.startsWith('gt_oauth_state=;') || c.includes('Max-Age=0')));
    console.log('OK   auth-callback: happy path sets session cookie + redirects with access_token');

    // capture the session cookie value for the next test
    global.__testSessionCookie = setCookies.find(c => c.startsWith('gt_session=')).split(';')[0];
  })().catch(e => { failures++; console.log('FAIL auth-callback happy path\n     ', e.stack); });

  await (async () => {
    const event = {
      headers: { host: 'greysteeltask.netlify.app', cookie: 'gt_oauth_state=state123' },
      queryStringParameters: { code: 'good-code', state: 'WRONG-STATE' },
    };
    const res = await authCallback.handler(event);
    assert.strictEqual(res.statusCode, 400);
    console.log('OK   auth-callback: rejects mismatched state (CSRF protection)');
  })().catch(e => { failures++; console.log('FAIL auth-callback CSRF check\n     ', e.stack); });

  await (async () => {
    const event = { headers: { host: 'x', cookie: `${global.__testSessionCookie}` }, queryStringParameters: {} };
    const res = await refreshTokenFn.handler(event);
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.access_token, 'AT2');
    console.log('OK   refresh-token: returns new access token from session cookie');
  })().catch(e => { failures++; console.log('FAIL refresh-token happy path\n     ', e.stack); });

  await (async () => {
    const event = { headers: { host: 'x', cookie: '' }, queryStringParameters: {} };
    const res = await refreshTokenFn.handler(event);
    assert.strictEqual(res.statusCode, 401);
    console.log('OK   refresh-token: 401 when no session cookie');
  })().catch(e => { failures++; console.log('FAIL refresh-token no-session\n     ', e.stack); });

  await (async () => {
    const event = { headers: { host: 'x', cookie: `${global.__testSessionCookie}` } };
    const res = await logoutFn.handler(event);
    assert.strictEqual(res.statusCode, 200);
    const cleared = res.multiValueHeaders['Set-Cookie'][0];
    assert.ok(cleared.startsWith('gt_session=;') || cleared.includes('Max-Age=0'));
    console.log('OK   logout: clears session cookie');
  })().catch(e => { failures++; console.log('FAIL logout\n     ', e.stack); });

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
