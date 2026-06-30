#!/usr/bin/env node
/**
 * DA/PA/SS/DR Extractor - FINAL VERSION
 * 
 * Sources:
 * - DA/PA/SS: dachecker.io (Puppeteer - finds values near domain)
 * - DR: Ahrefs API (free)
 */

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');

const DOMAINS = [
  'malcomschein.my.id',
  'google.com',
  'mozilla.org',
  'example.com'
];

const REFERENCE = {
  'malcomschein.my.id': { DA: 62, PA: 35, SS: 32, DR: 0 }
};

/**
 * Get DR from Ahrefs
 */
function getDR(domain) {
  return new Promise((resolve) => {
    https.get(
      `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`,
      { rejectUnauthorized: false },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.domain_rating?.domain_rating || 0);
          } catch (e) {
            resolve(0);
          }
        });
      }
    ).on('error', () => resolve(0));
  });
}

/**
 * Get DA/PA/SS from dachecker.io - IMPROVED EXTRACTION
 */
async function getDAPA_SS(browser, domain) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log(`  [DA/PA/SS] Navigating...`);
    await page.goto('https://dachecker.io/domain-authority-checker', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Type domain
    console.log(`  [DA/PA/SS] Typing ${domain}...`);
    const textarea = await page.$('textarea[placeholder*="example"], textarea[placeholder*="domain"]');
    if (!textarea) throw new Error('Textarea not found');
    await textarea.click({ clickCount: 3 });
    await page.keyboard.type(domain);
    
    // Click check
    console.log(`  [DA/PA/SS] Clicking check...`);
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent.trim(), btn);
      if (text.includes('Check Authority') && !text.includes('DR')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for results
    console.log(`  [DA/PA/SS] Waiting for results...`);
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Extract - find values CLOSEST to the domain name
    const result = await page.evaluate((targetDomain) => {
      const text = document.body.textContent;
      
      // Find position of domain in page
      const domainPos = text.indexOf(targetDomain);
      if (domainPos === -1) return { da: null, pa: null, ss: null, error: 'Domain not found in page' };
      
      // Get 500 chars after domain
      const context = text.substring(domainPos, domainPos + 500);
      
      // Format on dachecker.io: "malcomschein.my.id62DA SCORE35PA SCORE0SPAM SCORE"
      // Extract numbers followed by metric names
      
      // DA: number followed by "DA"
      const daMatch = context.match(/(\\d+)\\s*DA/i) || context.match(/DA[^\\d]*(\\d+)/i);
      const da = daMatch ? parseInt(daMatch[1]) : null;
      
      // PA: number followed by "PA"
      const paMatch = context.match(/(\\d+)\\s*PA/i) || context.match(/PA[^\\d]*(\\d+)/i);
      const pa = paMatch ? parseInt(paMatch[1]) : null;
      
      // SS: number followed by "SPAM" or "SS"
      const ssMatch = context.match(/(\\d+)\\s*SPAM/i) || context.match(/SPAM[^\\d]*(\\d+)/i);
      const ss = ssMatch ? parseInt(ssMatch[1]) : null;
      
      return { da, pa, ss };
    }, domain);
    
    await page.close();
    return result;
    
  } catch (error) {
    console.error(`  [DA/PA/SS] Error: ${error.message}`);
    return { da: null, pa: null, ss: null, error: error.message };
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(70));
  console.log('DA/PA/SS/DR Extractor - FINAL VERSION');
  console.log('='.repeat(70));
  
  let browser;
  
  try {
    console.log('\\n[Browser] Launching...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const results = [];
    
    for (const domain of DOMAINS) {
      console.log(`\\n${'='.repeat(70)}`);
      console.log(`[Check] ${domain}`);
      console.log('='.repeat(70));
      
      const [dap, dr] = await Promise.all([
        getDAPA_SS(browser, domain),
        getDR(domain)
      ]);
      
      const result = { domain, DA: dap.da, PA: dap.pa, SS: dap.ss, DR: dr };
      results.push(result);
      
      console.log(`  → DA=${dap.da}, PA=${dap.pa}, SS=${dap.ss}, DR=${dr}`);
      if (dap.error) console.log(`  ⚠️  ${dap.error}`);
    }
    
    // Output
    console.log('\\n' + '='.repeat(70));
    console.log('FINAL RESULTS');
    console.log('='.repeat(70));
    console.table(results);
    
    // Validate
    const ref = results.find(r => r.domain === 'malcomschein.my.id');
    if (ref) {
      console.log('\\n' + '='.repeat(70));
      console.log('VALIDATION');
      console.log('='.repeat(70));
      console.log(`Expected: DA:62, PA:35, SS:32, DR:0`);
      console.log(`Got:      DA:${ref.DA}, PA:${ref.PA}, SS:${ref.SS}, DR:${ref.DR}`);
      
      const match = (ref.DA === 62 && ref.PA === 35 && ref.SS === 32 && Math.round(ref.DR) === 0);
      console.log(`Status:   ${match ? '✅ ALL MATCH!' : '⚠️ Mismatch'}`);
    }
    
    // Save
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `/home/ubuntu/aiman-checker/results-${ts}.json`;
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
    fs.writeFileSync('/home/ubuntu/aiman-checker/results-latest.json', JSON.stringify(results, null, 2));
    console.log(`\\nSaved: ${file}`);
    
  } catch (error) {
    console.error('Fatal:', error.message);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(console.error);