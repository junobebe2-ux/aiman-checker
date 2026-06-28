const axios = require('axios');
const cheerio = require('cheerio');

// Fetch fresh CSRF token from Guestpostlinks bulk tool page
async function fetchToken() {
  const page = await axios.get('https://tools.guestpostlinks.net/bulk-da-pa-checker-tool/');
  const $ = cheerio.load(page.data);
  const token = $('input[name="_token"]').attr('value');
  if (!token) throw new Error('Unable to extract _token');
  return token;
}

// Query the export endpoint – returns CSV lines: URL,DA,PA,SS
async function queryExport(urls, token) {
  const payload = new URLSearchParams();
  payload.append('_token', token);
  payload.append('urls', urls.join('\n'));
  const resp = await axios.post('https://tools.guestpostlinks.net/export', payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    responseType: 'arraybuffer',
  });
  const csv = resp.data.toString('utf8');
  const lines = csv.trim().split('\n');
  const results = {};
  for (const line of lines) {
    const [url, da, pa, ss] = line.split(',').map(v => v.trim());
    if (url) results[url] = { da, pa, ss };
  }
  return results;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Provide { urls: [...] }' });
  }

  try {
    const token = await fetchToken();
    const data = await queryExport(urls, token);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    console.error('Guestpost fetch error', e);
    return res.status(500).json({ error: e.message || 'Failed to fetch Guestpost data' });
  }
}
