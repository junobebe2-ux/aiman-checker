1|/**
2| * AIMAN CHECKER — API Proxy with auth & role-based limits
3| */
4|const API_URL = "https://app.dapachecker.tools/get-domain-metrics";
5|const BATCH_SIZE = 50;
6|const REQ_DELAY_MS = 3000;
7|const jwt = require('jsonwebtoken');
8|const fs = require('fs');
9|const { checkLimit, getLimits } = require('./limits');
10|
11|var JWT_SECRET = (process.env.JWT_SECRET) || 'aiman-checker-jwt-secret-change-in-production-2024';
12|const USERS_PATH = '/tmp/users.json';
13|
14|function loadUsers() {
15|  try {
16|    if (fs.existsSync(USERS_PATH)) {
17|      return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
18|    }
19|  } catch (e) {}
20|  return [];
21|}
22|
23|function verifyAuth(authHeader) {
24|  if (!authHeader || !authHeader.startsWith('Bearer ')) {
25|    return { role: 'guest', user: null };
26|  }
27|  const token = authHeader.slice(7);
28|  try {
29|    const decoded = jwt.verify(token, JWT_SECRET);
30|    const users = loadUsers();
31|    const user = users.find(u => u.id === decoded.id);
32|    if (user) {
33|      // Reset daily usage if new day
34|      const today = new Date().toISOString().slice(0, 10);
35|      if (user.usage.date !== today) {
36|        user.usage.today = 0;
37|        user.usage.date = today;
38|      }
39|      return { role: user.role, user, limits: getLimits(user.role) };
40|    }
41|  } catch (e) {}
42|  return { role: 'guest', user: null, limits: getLimits('guest') };
43|}
44|
45|function saveUserUsage(user) {
46|  try {
47|    const users = loadUsers();
48|    const idx = users.findIndex(u => u.id === user.id);
49|    if (idx !== -1) {
50|      users[idx].usage = user.usage;
51|      fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
52|    }
53|  } catch (e) {}
54|}
55|
56|// Parse proxy list from env
57|function getProxyAgents() {
58|  const raw = process.env.PROXY_LIST || "";
59|  if (!raw) return [];
60|  return raw.split(",").map(entry => {
61|    const [host, port, user, pass] = entry.trim().split(":");
62|    return { host, port, user, pass };
63|  });
64|}
65|
66|function rotateProxy(proxies, index) {
67|  if (!proxies.length) return null;
68|  const p = proxies[index % proxies.length];
69|  return {
70|    url: "http://" + p.user + ":" + p.pass + "@" + p.host + ":" + p.port,
71|    host: p.host,
72|    port: p.port
73|  };
74|}
75|
76|async function fetchWithProxy(urls, proxyConfig) {
77|  const body = JSON.stringify({ urls });
78|  const options = {
79|    method: "POST",
80|    headers: {
81|      "Content-Type": "application/json",
82|      "Origin": "https://dapa-checker.com",
83|      "Referer": "https://dapa-checker.com/",
84|      "User-Agent": "Mozilla/5.0 (compatible; AIMANChecker/1.0)"
85|    },
86|    body
87|  };
88|
89|  if (proxyConfig) {
90|    const { HttpsProxyAgent } = await import("https-proxy-agent");
91|    const agent = new HttpsProxyAgent(proxyConfig.url);
92|    const fetchWithProxy = (await import("node-fetch")).default;
93|    const resp = await fetchWithProxy(API_URL, { ...options, agent });
94|    return resp;
95|  } else {
96|    const resp = await fetch(API_URL, options);
97|    return resp;
98|  }
99|}
100|
101|export default async function handler(req, res) {
102|  const origin = req.headers.origin || "*";
103|  res.setHeader("Access-Control-Allow-Origin", origin);
104|  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
105|  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
106|
107|  if (req.method === "OPTIONS") return res.status(200).end();
108|  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
109|
110|  let { urls } = req.body;
111|  if (!urls || !Array.isArray(urls) || urls.length === 0) {
112|    return res.status(400).json({ error: "Send { urls: [...] }" });
113|  }
114|
115|  // Normalize
116|  urls = urls.map(u => {
117|    u = (u || "").trim();
118|    if (u && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
119|    return u;
120|  }).filter(Boolean);
121|
122|  if (urls.length === 0) return res.status(400).json({ error: "No valid URLs" });
123|
124|  // ---- AUTH & ROLE-BASED LIMITS ----
125|  const authResult = verifyAuth(req.headers.authorization);
126|  const role = authResult.role;
127|  const user = authResult.user;
128|  const limits = authResult.limits || getLimits(role);
129|
130|  // Check limit for this request
131|  const limitCheck = checkLimit(role, urls.length);
132|  if (!limitCheck.allowed) {
133|    return res.status(403).json({
134|      error: "plan_limit_exceeded",
135|      message: limitCheck.message,
136|      plan: role,
137|      plan_label: limits.label,
138|      plan_limit: limitCheck.limit,
139|      your_count: limitCheck.yourCount,
140|      upgrade_url: "/pricing.html"
141|    });
142|  }
143|
144|  // Track usage for logged-in users
145|  if (user) {
146|    user.usage.today += urls.length;
147|    user.usage.total = (user.usage.total || 0) + urls.length;
148|    saveUserUsage(user);
149|  }
150|
151|  // ---- PROXY / PREMIUM LOGIC ----
152|  const proxies = getProxyAgents();
153|  const isPremium = proxies.length > 0 && (role === 'pro' || role === 'business' || role === 'admin');
154|  const maxBatches = isPremium ? Math.ceil(urls.length / BATCH_SIZE) + 5 : Math.min(2, Math.ceil(urls.length / BATCH_SIZE));
155|  const total = urls.length;
156|  const allResults = [];
157|  const errors = [];
158|  let proxyIndex = 0;
159|
160|  for (let i = 0; i < total; i += BATCH_SIZE) {
161|    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
162|    if (batchNum > maxBatches) {
163|      errors.push("Plan limit: " + maxBatches + " batches (" + (maxBatches * BATCH_SIZE) + " URLs) allowed");
164|      break;
165|    }
166|
167|    const batch = urls.slice(i, i + BATCH_SIZE);
168|    const proxyConfig = isPremium ? rotateProxy(proxies, proxyIndex++) : null;
169|
170|    try {
171|      const response = isPremium
172|        ? await fetchWithProxy(batch, proxyConfig)
173|        : await fetch(API_URL, {
174|            method: "POST",
175|            headers: {
176|              "Content-Type": "application/json",
177|              "Origin": "https://dapa-checker.com",
178|              "Referer": "https://dapa-checker.com/",
179|              "User-Agent": "Mozilla/5.0 (compatible; AIMANChecker/1.0)"
180|            },
181|            body: JSON.stringify({ urls: batch })
182|          });
183|
184|      if (!response.ok) {
185|        const text = await response.text();
186|        throw new Error("API " + response.status + ": " + text);
187|      }
188|
189|      const data = await response.json();
190|      allResults.push(...data);
191|
192|      if (i + BATCH_SIZE < total) {
193|        await new Promise(r => setTimeout(r, REQ_DELAY_MS));
194|      }
195|    } catch (err) {
196|      errors.push("Batch " + batchNum + ": " + err.message);
197|      if (!isPremium) break;
198|    }
199|  }
200|
201|  // Extract key metrics - convert mozSpam (Moz v1: 0-17) to percentage (0-100)
202|  const metrics = allResults.map(r => {
203|    const raw = parseFloat(String(r.mozSpam || "0").replace('%', '').trim()) || 0;
204|    // Moz Spam Score v1 uses 17 flags → convert to 0-100 percentage
205|    const spamPct = Math.round((raw / 17) * 100);
206|    return {
207|    domain: r.domain || "",
208|    DA: r.mozDA || "0",
209|    PA: r.mozPA || "0",
210|    Spam: String(spamPct), // converted from Moz v1 (0-17) to percentage (0-100)
211|    DR: r.ahrefsDR || "0",
212|    TF: r.majesticTF || "0",
213|    CF: r.majesticCF || "0",
214|    MozRank: r.mozRank || "0",
215|    Backlinks: r.ahrefsBacklinks || 0,
216|    RefDomains: r.ahrefsRefDomains || 0,
217|    Traffic: r.ahrefsTraffic || 0,
218|    Keywords: r.ahrefsOrganicKeywords || 0
219|  }); // end metrics.map
220|
221|  res.json({
222|    success: true,
223|    total,
224|    checked: metrics.length,
225|    results: metrics,
226|    errors: errors.length > 0 ? errors : undefined,
227|    partial: errors.length > 0,
228|    plan: role,
229|    plan_label: limits.label,
230|    plan_limit: limits.maxUrls,
231|    remaining: user ? (limits.maxUrls - user.usage.today) : (limits.maxUrls - urls.length)
232|  });
233|