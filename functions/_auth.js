// HMAC-signed session cookie helper for CF Pages Functions.
// Cookie format: stw_session=<base64url-payload>.<base64url-hmac>
// Payload: JSON { u: username, exp: unix-seconds }

const COOKIE = 'stw_session';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new TextEncoder().encode(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

export async function signSession(secret, payload) {
  const body = b64urlEncode(JSON.stringify(payload));
  const mac = await hmac(secret, body);
  return `${body}.${mac}`;
}

export async function verifySession(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = await hmac(secret, body);
  // constant-time compare
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const json = new TextDecoder().decode(b64urlDecode(body));
    const obj = JSON.parse(json);
    if (typeof obj.exp !== 'number' || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch (_) { return null; }
}

export function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export async function getSessionUser(request, env) {
  if (!env.AUTH_SECRET) return null;
  const cookies = parseCookies(request);
  const token = cookies[COOKIE];
  if (!token) return null;
  const payload = await verifySession(env.AUTH_SECRET, token);
  return payload ? payload.u : null;
}

export function setSessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export const SESSION_TTL = TTL_SECONDS;
