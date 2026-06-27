# AIMAN CHECKER 🔍

**Free Bulk DA PA Checker** — Check Domain Authority, Page Authority, Spam Score, Domain Rating, Trust Flow & Citation Flow for up to 500 URLs at once.

## Features
- ✅ Check **DA, PA, Spam Score, DR, TF, CF** in bulk
- ✅ Up to **500 URLs per session** (50/batch, 10 batches)
- ✅ Paste URLs or upload `.txt` file
- ✅ Sort results by any column
- ✅ Export to **CSV / JSON / Clipboard**
- ✅ Summary stats (avg DA, PA, high-DA count)
- ✅ Clean dark UI, mobile responsive

## Tech Stack
- **Frontend:** Vanilla HTML + CSS + JS (no framework)
- **Backend:** Vercel Serverless Function (Node.js proxy)
- **Data Source:** Moz & Ahrefs Premium APIs via dapachecker.tools
- **Deploy:** Vercel

## Usage
1. Go to [aiman-checker.vercel.app](https://aiman-checker.vercel.app)
2. Paste up to 500 URLs (one per line)
3. Click **Check Authority**
4. View, sort, and export results

## Local Development
```bash
npm install -g vercel
vercel dev
```

## Limitations
- 10 API requests/day backend limit → ~500 URLs/day
- Rate limit: 2.5s between batches

## License
MIT