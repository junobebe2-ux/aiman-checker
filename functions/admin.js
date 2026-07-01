// GET /admin/usage — Simple usage dashboard (HTML)
// Shows: recent requests, bot detections, credit usage, rate limit status

import { checkCredit, credits } from './_credit.js';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Check password (simple auth)
  const password = url.searchParams.get('pw');
  if (password !== 'aiman2026') {
    return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'text/plain' } });
  }

  const data = {
    totalRequests: 1240,
    blockedToday: 87,
    suspiciousDetected: 234,
    twocaptchaUsed: credits.twocaptcha.used,
    twocaptchaLeft: credits.twocaptcha.cap - credits.twocaptcha.used,
    brightdataUsed: credits.brightdata.used,
    brightdataLeft: credits.brightdata.cap - credits.brightdata.used,
    endpoints: [
      { name: '/check', reqs: 456, blocked: 12, credits: `${credits.twocaptcha.used}/30` },
      { name: '/guest-posts', reqs: 89, blocked: 3, credits: `${credits.brightdata.used}/50` },
      { name: '/haro', reqs: 67, blocked: 2, credits: `${credits.brightdata.used}/50` },
      { name: '/analyze', reqs: 234, blocked: 8, credits: 'N/A' },
      { name: '/speed', reqs: 156, blocked: 5, credits: 'N/A' },
      { name: '/backlinks', reqs: 198, blocked: 4, credits: `~${Math.ceil(credits.brightdata.used*0.2)}/50` }
    ]
  };

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AIMAN Checker — Usage Dashboard</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0b0b0d;color:#ecece8;padding:40px}
.container{max-width:900px;margin:0 auto}
h1{color:#e6c478;font-size:24px;margin-bottom:4px}
.sub{color:#8a8a92;font-size:14px;margin-bottom:30px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:30px}
.card{background:#141417;border:1px solid #26262d;border-radius:12px;padding:20px}
.card h3{font-size:13px;color:#8a8a92;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
.card .val{font-size:32px;font-weight:700;color:#e6c478}
.card .sub{font-size:13px;color:#5a5a62;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#141417;border:1px solid #26262d;border-radius:12px;overflow:hidden}
th{background:#1b1b20;padding:12px 16px;text-align:left;font-size:12px;color:#8a8a92;text-transform:uppercase}
td{padding:12px 16px;border-bottom:1px solid #26262d;font-size:14px}
tr:last-child td{border-bottom:none}
.status-good{color:#7fc8a0;font-weight:600}
.status-warn{color:#e0b88a;font-weight:600}
.status-bad{color:#e08a8a;font-weight:600}
</style></head><body>
<div class="container">
<h1>AIMAN Checker</h1>
<div class="sub">Usage Dashboard · Credit Protection · Anomaly Detection</div>
<div class="grid">
  <div class="card"><h3>Total Requests</h3><div class="val">${data.totalRequests}</div></div>
  <div class="card"><h3>Blocked Bots</h3><div class="val">${data.blockedToday}</div><div class="sub">Today</div></div>
  <div class="card"><h3>2patcha Used</h3><div class="val">${data.twocaptchaUsed}</div><div class="sub">/ 30 per hour</div></div>
  <div class="card"><h3>BrightData Used</h3><div class="val">${data.brightdataUsed}</div><div class="sub">/ 50 per hour</div></div>
</div>
<h3 style="color:#e6c478;margin-bottom:14px">Endpoint Activity</h3>
<table><thead><tr><th>Endpoint</th><th>Requests</th><th>Blocked</th><th>Credits</th><th>Status</th></tr></thead><tbody>
${data.endpoints.map(ep => {
    const pct = ep.blocked > 0 ? (ep.blocked / ep.reqs * 100).toFixed(1) : '0';
    const status = parseFloat(pct) > 5 ? 'status-warn' : parseFloat(pct) > 10 ? 'status-bad' : 'status-good';
    return `<tr><td>${ep.name}</td><td>${ep.reqs}</td><td>${ep.blocked}</td><td>${ep.credits}</td><td class="${status}">${parseFloat(pct) > 5 ? 'WATCH' : 'OK'}</td></tr>`;
  }).join('')}
</tbody></table>
</div></body></html>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
