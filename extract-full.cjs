#!/usr/bin/env node
/**
 * DA/PA/SS/DR Extractor - FULL AUTOMATION
 * 
 * Sources:
 * - DA/PA/SS: dachecker.io (Puppeteer browser automation)
 * - DR: Ahrefs API (free, no auth)
 * 
 * Features:
 * - Headless browser automation
 * - Real Moz data (DA/PA/SS)
 * - Real Ahrefs data (DR)
 * - No formulas, all real metrics
 */

const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');

// Config
const DOMAINS = [
  'malcomschein.my.id',
  'google.com',
  'mozilla.org',
  'example.com'
];

// Reference data (from user)
const REFERENCE = {
  'malcomschein.my.id': { DA: 62, PA: 35, SS: 32, DR: 0 }
};

/**
 * Get DR from Ahrefs (FREE API)
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
            const dr = json.domain_rating?.domain_rating || 0;
            resolve(dr);
          } catch (e) {
            console.error(`  [DR] Parse error: ${e.message}`);
            resolve(0);
          }
        });
      }
    ).on('error', (e) => {
      console.error(`  [DR] Request error: ${e.message}`);
      resolve(0);
    });
  });
}

/**
 * Get DA/PA/SS from dachecker.io using Puppeteer
 */
async function getDAPA_SS(browser, domain) {
  try {
    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log(`  [DA/PA/SS] Navigating to dachecker.io...`);
    
    // Go to DA checker page
    await page.goto('https://dachecker.io/domain-authority-checker', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for textarea
    await page.waitForSelector('textarea[placeholder*="domain"], textarea[placeholder*="example"]', { 
      timeout: 10000 
    });
    
    console.log(`  [DA/PA/SS] Typing domain: ${domain}...`);
    
    // Clear and type domain
    const textarea = await page.$('textarea[placeholder*="domain"], textarea[placeholder*="example"]');
    await textarea.click({ clickCount: 3 });
    await page.keyboard.type(domain);
    
    // Find and click check button
    console.log(`  [DA/PA/SS] Finding check button...`);
    
    // Try multiple selector strategies
    let checkButton = null;
    
    // Strategy 1: By text content - look for specific check buttons
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent.trim(), btn);
      // Look for the right button (not DR Checker)
      if ((text.includes('Check') && !text.includes('DR')) || 
          text.includes('Check Authority') || 
          text.includes('Analyze') ||
          text.includes('Submit')) {
        checkButton = btn;
        console.log(`  [DA/PA/SS] Found button: "${text}"`);
        break;
      }
    }
    
    // Strategy 2: By type
    if (!checkButton) {
      checkButton = await page.$('button[type="submit"]');
    }
    
    // Strategy 3: By class containing 'check' or 'submit'
    if (!checkButton) {
      const allButtons = await page.$$('button[class*="check"], button[class*="submit"]');
      if (allButtons.length > 0) {
        checkButton = allButtons[0];
      }
    }
    
    if (checkButton) {
      console.log(`  [DA/PA/SS] Clicking check button...`);
      await checkButton.click();
    } else {
      console.log(`  [DA/PA/SS] No check button found, trying form submission...`);
      // Try pressing Enter in textarea
      await textarea.focus();
      await page.keyboard.press('Enter');
    }
    
    // Wait for results (up to 45 seconds - dachecker.io can be slow)
    console.log(`  [DA/PA/SS] Waiting for results (up to 45s)...`);
    
    let resultsLoaded = false;
    
    try {
      // Wait for result cards or table
      await page.waitForSelector('[class*="result-card"], [class*="metric-card"], table tbody tr td', { 
        timeout: 45000 
      });
      resultsLoaded = true;
      console.log(`  [DA/PA/SS] Results loaded!`);
      
      // Scroll to results
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e) {
      console.log(`  [DA/PA/SS] Timeout - checking if partial results available...`);
      
      // Check if there's an error message
      const errorMsg = await page.evaluate(() => {
        const error = document.querySelector('[class*="error"], [class*="invalid"], [class*="failed"]');
        return error ? error.textContent : null;
      });
      
      if (errorMsg) {
        console.log(`  [DA/PA/SS] Error on page: ${errorMsg}`);
      }
    }
    
    // Extra delay to ensure all metrics rendered
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Take screenshot for debugging
    await page.screenshot({ path: `/home/ubuntu/aiman-checker/debug-${domain.replace(/\./g, '_')}.png`, fullPage: false });
    console.log(`  [Debug] Screenshot saved`);
    
    // Log page content for debugging
    const pageContent = await page.evaluate(() => document.body.textContent);
    const relevantText = pageContent.substring(0, 2000);
    console.log(`  [Debug] Page text preview: ${relevantText.replace(/\s+/g, ' ').trim()}`);
    
    // Extract metrics with better selectors
    const result = await page.evaluate((targetDomain) => {
      // Helper to find metric value
      function findMetric(label) {
        const text = document.body.textContent;
        const patterns = [
          new RegExp(`${label}[:\\s]+(\\d+)`, 'i'),
          new RegExp(`${label}.*?(\\d{1,2})`, 'i')
        ];
        
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match && match[1]) {
            const val = parseInt(match[1]);
            if (val >= 0 && val <= 100) return val;
          }
        }
        return null;
      }
      
      // Try to find result cards first
      const cards = document.querySelectorAll('[class*="card"], [class*="result"], [class*="metric"]');
      let da = null, pa = null, ss = null;
      
      for (const card of cards) {
        const cardText = card.textContent;
        
        // Check if this card contains our domain
        if (cardText.includes(targetDomain)) {
          // Extract DA
          const daMatch = cardText.match(/DA[:\s]*(\d+)/i) || cardText.match(/(\d+)\s*\/\s*100/i);
          if (daMatch) da = parseInt(daMatch[1]);
          
          // Extract PA
          const paMatch = cardText.match(/PA[:\s]*(\d+)/i);
          if (paMatch) pa = parseInt(paMatch[1]);
          
          // Extract SS
          const ssMatch = cardText.match(/Spam[:\s]*(\d+)/i) || cardText.match(/SS[:\s]*(\d+)/i);
          if (ssMatch) ss = parseInt(ssMatch[1]);
        }
      }
      
      // Fallback: search entire page
      if (da === null) da = findMetric('DA');
      if (pa === null) pa = findMetric('PA');
      if (ss === null) ss = findMetric('Spam');
      
      return { da, pa, ss };
    }, domain);
    
    await page.close();
    
    return result;
    
  } catch (error) {
    console.error(`  [DA/PA/SS] Error: ${error.message}`);
    return { da: null, pa: null, ss: null };
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(70));
  console.log('DA/PA/SS/DR Extractor - FULL AUTOMATION');
  console.log('='.repeat(70));
  console.log('');
  console.log('SOURCES:');
  console.log('  🌐 DA/PA/SS: dachecker.io (Puppeteer)');
  console.log('  📡 DR: Ahrefs API (free)');
  console.log('');
  console.log('='.repeat(70));
  
  let browser;
  
  try {
    // Launch browser
    console.log('\\n[Browser] Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
    
    const results = [];
    
    for (const domain of DOMAINS) {
      console.log(`\\n${'='.repeat(70)}`);
      console.log(`[Check] ${domain}`);
      console.log('='.repeat(70));
      
      // Get DA/PA/SS from browser
      const dap = await getDAPA_SS(browser, domain);
      
      // Get DR from API
      console.log(`  [DR] Fetching from Ahrefs...`);
      const dr = await getDR(domain);
      
      const result = {
        domain,
        DA: dap.da,
        PA: dap.pa,
        SS: dap.ss,
        DR: dr
      };
      
      results.push(result);
      
      console.log(`  → Result: DA=${dap.da}, PA=${dap.pa}, SS=${dap.ss}, DR=${dr}`);
    }
    
    // Output results
    console.log('\\n' + '='.repeat(70));
    console.log('FINAL RESULTS');
    console.log('='.repeat(70));
    console.table(results);
    
    // Validate against reference
    const refDomain = results.find(r => r.domain === 'malcomschein.my.id');
    if (refDomain) {
      console.log('\\n' + '='.repeat(70));
      console.log('VALIDATION (Reference: malcomschein.my.id)');
      console.log('='.repeat(70));
      console.log(`Expected: DA:62, PA:35, SS:32, DR:0`);
      console.log(`Got:      DA:${refDomain.DA}, PA:${refDomain.PA}, SS:${refDomain.SS}, DR:${refDomain.DR}`);
      
      const daMatch = refDomain.DA === 62 ? '✅' : '❌';
      const paMatch = refDomain.PA === 35 ? '✅' : '❌';
      const ssMatch = refDomain.SS === 32 ? '✅' : '❌';
      const drMatch = Math.round(refDomain.DR) === 0 ? '✅' : '❌';
      
      console.log(`Match:    DA:${daMatch}, PA:${paMatch}, SS:${ssMatch}, DR:${drMatch}`);
      
      const allMatch = (
        refDomain.DA === 62 &&
        refDomain.PA === 35 &&
        refDomain.SS === 32 &&
        Math.round(refDomain.DR) === 0
      );
      
      console.log(`\\nStatus:   ${allMatch ? '✅ ALL MATCH!' : '⚠️ Some mismatch'}`);
    }
    
    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `/home/ubuntu/aiman-checker/results-${timestamp}.json`;
    
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`\\nResults saved to: ${filename}`);
    
    // Also save as latest
    fs.writeFileSync('/home/ubuntu/aiman-checker/results-latest.json', JSON.stringify(results, null, 2));
    console.log(`Latest results: /home/ubuntu/aiman-checker/results-latest.json`);
    
  } catch (error) {
    console.error('\\n❌ Fatal error:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      console.log('\\n[Browser] Closing...');
      await browser.close();
    }
  }
}

main().catch(console.error);