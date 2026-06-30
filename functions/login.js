// POST /login -> { ok: true } + Set-Cookie
// POST /login (logout=true) -> clears cookie
// GET /login -> { authed: bool, user?: string }
import { signSession, setSessionCookie, clearSessionCookie, getSessionUser, SESSION_TTL } from './_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true'
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context.request, context.env);
  return new Response(JSON.stringify({ authed: !!user, user: user || null }), {
    status: 200, headers: JSON_HEADERS
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.AUTH_SECRET || !env.STW_USER || !env.STW_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: 'Auth not configured' }), {
      status: 500, headers: JSON_HEADERS
    });
  }

  const body = await request.json().catch(() => ({}));

  // Logout
  if (body.logout) {
    return new Response(JSON.stringify({ ok: true, loggedOut: true }), {
      status: 200,
      headers: { ...JSON_HEADERS, 'Set-Cookie': clearSessionCookie() }
    });
  }

  const user = String(body.user || '').trim();
  const pass = String(body.pass || '');

  // small timing protection: always do the comparison
  const userOk = user === env.STW_USER;
  const passOk = pass === env.STW_PASSWORD;

  if (!userOk || !passOk) {
    // slight delay to slow brute force from a single client
    await new Promise(r => setTimeout(r, 600));
    return new Response(JSON.stringify({ ok: false, error: 'Invalid credentials' }), {
      status: 401, headers: JSON_HEADERS
    });
  }

  const token = await signSession(env.AUTH_SECRET, {
    u: user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL
  });

  return new Response(JSON.stringify({ ok: true, user }), {
    status: 200,
    headers: { ...JSON_HEADERS, 'Set-Cookie': setSessionCookie(token) }
  });
}
