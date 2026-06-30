// GET /me — returns current session user (or null)
import { getSessionUser } from './_auth.js';
import { clearSessionCookie } from './_auth.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const user = await getSessionUser(context.request, context.env);
  return new Response(JSON.stringify({ logged_in: !!user, user: user || null }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

// POST /me  -> logout (clears cookie)
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() }
  });
}
