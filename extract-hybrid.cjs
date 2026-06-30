#!/usr/bin/env node
/**
 * DA/PA/SS/DR Extractor - HYBRID VERSION
 * 
 * Sources:
 * - DR: Ahrefs API (free, instant)
 * - DA/PA/SS: Browser automation (dachecker.io)
 */

const { execSync } = require('child_process');
const fs = require('fs');

const DOMAINS = [
  'malcomschein.my.id',
  'google.com',
  'mozilla.org',
  'example.com'
];

/**
 * Get DR from Ahrefs (FREE API)
 */
async function getDR(domain) {
  try {
    const curl = `curl -s "https://api.ahrefs.com/v3/public/domain-rating-free?target=${domain}"`;
    const result = execSync(curl, { encoding: 'utf8' });
    const data = JSON.parse(result);
    return data.domain_rating?.domain_rating || 0;
  } catch (e) {
    console.error(`  [DR] Error: ${e.message}`);
    return 0;
  }
}

/**
 * Get DA/PA/SS from dachecker.io using browser
 */
async function getDAPA_SS(domain) {
  console.log(`  [Browser] Checking ${domain} on dachecker.io...`);
  
  try {
    // Create temporary Puppeteer script
    const script = `
      const puppeteer = require('puppeteer');
      
      (async () => {
        const browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Go to dachecker.io DA checker
        await page.goto('https://dachecker.io/domain-authority-checker', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        
        // Type domain
        await page.waitForSelector('textarea[placeholder*="domain"], textarea[aria-label*="domain"]', { timeout: 10000 });
        const textarea = await page.$('textarea');
        await textarea.click({ clickCount: 3 });
        await page.keyboard.type('${domain}');
        
        // Click check button
        await page.click('button:contains("Check"), button[type="submit"]');
        
        // Wait for results
        await page.waitForSelector('[class*="result"], table tbody tr', { timeout: 30000 });
        
        // Extract metrics
        const result = await page.evaluate(() => {
          const text = document.body.textContent;
          
          // Try to find DA, PA, SS in result cards or table
          const daMatch = text.match(/DA[^0-9]{0,10}(\\d+)/i) || text.match(/Domain Authority[^0-9]{0,10}(\\d+)/i);
          const paMatch = text.match(/PA[^0-9]{0,10}(\\d+)/i) || text.match(/Page Authority[^0-9]{0,10}(\\d+)/i);
          const ssMatch = text.match(/Spam Score[^0-9]{0,10}(\\d+)/i) || text.match(/SS[^0-9]{0,10}(\\d+)/i);
          
          return {
            da: daMatch ? parseInt(daMatch[1]) : null,
            pa: paMatch ? parseInt(paMatch[1]) : null,
            ss: ssMatch ? parseInt(ssMatch[1]) : null
          };
        });
        
        await browser.close();
        console.log(JSON.stringify(result));
      })();
    `;
    
    fs.writeFileSync('/tmp/dachecker-scraper.js', script);
    const output = execSync('node /tmp/dachecker-scraper.js 2>&1', { encoding: 'utf8', timeout: 60000 });
    
    try {
      const json = JSON.parse(output.trim().split('\n').pop());
      return json;
    } catch (e) {
      console.error(`  [Browser] Parse error: ${e.message}`);
      return { da: null, pa: null, ss: null };
    }
    
  } catch (error) {
    console.error(`  [Browser] Error: ${error.message}`);
    return { da: null, pa: null, ss: null };
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(70));
  console.log('DA/PA/SS/DR Extractor - HYBRID VERSION');
  console.log('='.repeat(70));
  console.log(`DR: Ahrefs API (free)`);
  console.log(`DA/PA/SS: Browser automation (dachecker.io)`);
  console.log('='.repeat(70));
  
  const results = [];
  
  for (const domain of DOMAINS) {
    console.log(`\\n[Check] ${domain}`);
    console.log('-'.repeat(50));
    
    const [dr, dap] = await Promise.all([
      getDR(domain),
      getDAPA_SS(domain)
    ]);
    
    results.push({
      domain,
      DA: dap.da,
      PA: dap.pa,
      SS: dap.ss,
      DR: dr
    });
    
    console.log(`  Result: DA=${dap.da}, PA=${dap.pa}, SS=${dap.ss}, DR=${dr}`);
  }
  
  console.log('\\n' + '='.repeat(70));
  console.log('FINAL RESULTS');
  console.log('='.repeat(70));
  console.table(results);
  
  // Save
  fs.writeFileSync(
    '/home/ubuntu/aiman-checker/results-hybrid.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\\nSaved to: /home/ubuntu/aiman-checker/results-hybrid.json');
}

main().catch(console.error);