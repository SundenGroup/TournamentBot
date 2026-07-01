// Minimal signed-cookie session for the web-admin dashboard.
// No external deps: the session payload is a JSON object, base64url-encoded and
// HMAC-SHA256 signed with the configured secret. httpOnly + Secure + SameSite=Lax
// (Lax still works for the top-level OAuth redirect and same-origin iframes).

const crypto = require('node:crypto');
const config = require('../config');

const COOKIE = 'clutch_admin';
const OAUTH_STATE_COOKIE = 'clutch_oauth_state';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(data) {
  return b64url(crypto.createHmac('sha256', config.webAdmin.sessionSecret).update(data).digest());
}

function serialize(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function deserialize(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  try {
    const [body, sig] = token.split('.');
    const expected = sign(body);
    // constant-time compare on BYTE length (a multibyte char in the sig slot
    // could match on string length but not byte length, which would make
    // timingSafeEqual throw instead of returning false)
    const sigBuf = Buffer.from(sig, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(fromB64url(body).toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // malformed percent-encoding (e.g. a bare '%') — skip the pair rather
      // than 500 the request
    }
  }
  return out;
}

function cookieString(name, value, { maxAgeMs = MAX_AGE_MS, clear = false } = {}) {
  const secure = config.publicBaseUrl.startsWith('https');
  const attrs = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    clear ? 'Max-Age=0' : `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ].filter(Boolean);
  return attrs.join('; ');
}

function setSession(res, payload) {
  const full = { ...payload, exp: Date.now() + MAX_AGE_MS };
  res.append('Set-Cookie', cookieString(COOKIE, serialize(full)));
}

function getSession(req) {
  return deserialize(parseCookies(req)[COOKIE]);
}

function clearSession(res) {
  res.append('Set-Cookie', cookieString(COOKIE, '', { clear: true }));
}

// Short-lived signed state for the OAuth round-trip (CSRF protection).
function setOAuthState(res, state) {
  res.append('Set-Cookie', cookieString(OAUTH_STATE_COOKIE, serialize({ state, exp: Date.now() + 10 * 60 * 1000 }), { maxAgeMs: 10 * 60 * 1000 }));
}
function takeOAuthState(req, res) {
  const payload = deserialize(parseCookies(req)[OAUTH_STATE_COOKIE]);
  res.append('Set-Cookie', cookieString(OAUTH_STATE_COOKIE, '', { clear: true }));
  return payload?.state || null;
}

module.exports = {
  setSession,
  getSession,
  clearSession,
  setOAuthState,
  takeOAuthState,
  parseCookies,
};
