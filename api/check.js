/**
 * AIMAN CHECKER — API Proxy
 * Vercel serverless function that proxies requests to dapa-checker.com backend.
 */
const API_URL = "https://app.dapachecker.tools/get-domain-metrics";
const BATCH_SIZE = 50;
const MAX_BATCHES = 10; // 10 req/day limit, 50 URLs each = 500 URLs total
const REQ_DELAY_MS = 2500;

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let { urls } = req.body;
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "Send { urls: [...] }" });
  }

  // Normalize URLs
  urls = urls.map(u => {
    u = u.trim();
    if (u && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
    return u;
  }).filter(Boolean);

  if (urls.length === 0) return res.status(400).json({ error: "No valid URLs" });

  const total = urls.length;
  const allResults = [];
  const errors = [];
  let batchesUsed = 0;

  // Process in batches
  for (let i = 0; i < total; i += BATCH_SIZE) {
    if (batchesUsed >= MAX_BATCHES) {
      errors.push(`Rate limit: only ${MAX_BATCHES} batches (${MAX_BATCHES * BATCH_SIZE} URLs) allowed per session`);
      break;
    }

    const batch = urls.slice(i, i + BATCH_SIZE);
    batchesUsed++;

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://dapa-checker.com",
          "Referer": "https://dapa-checker.com/",
          "User-Agent": "Mozilla/5.0 (compatible; AIMANChecker/1.0)"
        },
        body: JSON.stringify({ urls: batch })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API ${response.status}: ${text}`);
      }

      const data = await response.json();
      allResults.push(...data);

      // Delay between batches
      if (i + BATCH_SIZE < total && batchesUsed < MAX_BATCHES) {
        await new Promise(r => setTimeout(r, REQ_DELAY_MS));
      }
    } catch (err) {
      errors.push(`Batch ${batchesUsed} (${batch[0]}..): ${err.message}`);
      break; // Stop on error
    }
  }

  // Extract key metrics
  const metrics = allResults.map(r => ({
    domain: r.domain || "",
    DA: r.mozDA || "0",
    PA: r.mozPA || "0",
    Spam: r.mozSpam || "0",
    DR: r.ahrefsDR || "0",
    TF: r.majesticTF || "0",
    CF: r.majesticCF || "0",
    MozRank: r.mozRank || "0",
    Backlinks: r.ahrefsBacklinks || 0,
    RefDomains: r.ahrefsRefDomains || 0,
    Traffic: r.ahrefsTraffic || 0,
    Keywords: r.ahrefsOrganicKeywords || 0
  }));

  res.json({
    success: true,
    total,
    checked: metrics.length,
    results: metrics,
    errors: errors.length > 0 ? errors : undefined,
    partial: errors.length > 0
  });
}