# AIMAN CHECKER - DA/PA/SS/DR Data

## Reference Data (from dapachecker.org)
```json
{
  "malcomschein.my.id": {
    "DA": 62,
    "PA": 35,
    "SS": 32,
    "source": "dapachecker.org (scraped)",
    "verified": "2026-06-29"
  }
}
```

## Infrastructure Available

### 1. Residential Proxies (from .env.prod)
Format: `IP:PORT:USERNAME:PASSWORD`

```
31.59.20.176:6754:hcwoqjbo:15jf7g5nb1vm
31.56.127.193:7684:hcwoqjbo:15jf7g5nb1vm
45.38.107.97:6014:hcwoqjbo:15jf7g5nb1vm
38.154.203.95:5863:hcwoqjbo:15jf7g5nb1vm
198.105.121.200:6462:hcwoqjbo:15jf7g5nb1vm
64.137.96.74:6641:hcwoqjbo:15jf7g5nb1vm
198.23.243.226:6361:hcwoqjbo:15jf7g5nb1vm
38.154.185.97:6370:hcwoqjbo:15jf7g5nb1vm
142.111.67.146:5611:hcwoqjbo:15jf7g5nb1vm
191.96.254.138:6185:hcwoqjbo:15jf7g5nb1vm
```

### 2. YesCaptcha API Key
```
478eaa708b16d466c687b9c3e1e7669d7b55cc11127237
```
- Supports: Cloudflare Turnstile, reCAPTCHA v2/v3, hCaptcha
- Endpoint: https://api.yescaptcha.com

### 3. dapachecker.org API
- Endpoint: `POST https://www.dapachecker.org/api/user/dapa-checker`
- Requires: API key (Bearer token)
- Free tier: 5 URLs/request
- Returns: `site_da`, `site_pa`, `site_mr`, `spam_score`

## How to Get dapachecker.org API Key

1. Visit: https://www.dapachecker.org/pricing
2. Sign up for free account (Guest tier)
3. Go to API section in dashboard
4. Copy API key
5. Add to .env.local: `DAPA_API_KEY=your_key_here`

## Usage Examples

### Check Single Domain via API
```bash
curl -X POST "https://www.dapachecker.org/api/user/dapa-checker" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"urls":["malcomschein.my.id"]}'
```

### Using Proxy + Browser Automation
See: `extract-da-pa-ss.js`

## Data Sources Comparison

| Source | DA | PA | SS | DR | Captcha | API Required |
|--------|----|----|----|----|---------|--------------|
| dapachecker.org | ✓ | ✓ | ✓ | ✓ | Turnstile | No (web) / Yes (API) |
| dachecker.io | ✓ | ✓ | ✓ | ✗ | None | No |
| guestpostlinks.net | ✓ | ✓ | ✓ | ✗ | None | No |
| keywordseverywhere.com | ✗ | ✗ | ✓ | ✗ | reCAPTCHA | No |

## Notes
- SS (Spam Score) must match reference: **32** for malcomschein.my.id
- All metrics from Moz API (DA, PA, SS) or Ahrefs (DR, UR)
- Proxy credentials rotate every ~24 hours
- YesCaptcha solves Turnstile in ~5-15 seconds