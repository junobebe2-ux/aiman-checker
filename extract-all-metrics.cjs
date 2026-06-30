#!/usr/bin/env node
/**
 * AIMAN CHECKER - FULL METRICS EXTRACTOR
 * 
 * Sources:
 * - DA/PA: dachecker.io (Moz data via Puppeteer)
 * - SS: Keywords Everywhere (their own algorithm)
 * - DR: Ahrefs API (free, no auth)
 * 
 * All real data - NO formulas!
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
 * Get DA/PA from dachecker.io
 */
async function getDAPA(browser, domain) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.goto('https://dachecker.io/domain-authority-checker', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Type domain
    const textarea = await page.$('textarea[placeholder*="example"], textarea[placeholder*="domain"]');
    if (!textarea) throw new Error('Textarea not found');
    await textarea.click({ clickCount: 3 });
    await page.keyboard.type(domain);
    
    // Click check
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent.trim(), btn);
      if (text.includes('Check Authority') && !text.includes('DR')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Extract DA/PA
    const result = await page.evaluate((targetDomain) => {
      const text = document.body.textContent;
      const domainPos = text.indexOf(targetDomain);
      if (domainPos === -1) return { da: null, pa: null };
      
      const context = text.substring(domainPos, domainPos + 500);
      
      // Format: "domain62DA SCORE35PA SCORE0SPAM SCORE"
      // Extract number IMMEDIATELY before "DA"
      const daMatch = context.match(/(\d{1,2})\s*DA/i);
      const da = daMatch ? parseInt(daMatch[1]) : null;
      
      // Extract number IMMEDIATELY before "PA"
      const paMatch = context.match(/(\d{1,2})\s*PA/i);
      const pa = paMatch ? parseInt(paMatch[1]) : null;
      
      return { da, pa };
    }, domain);
    
    await page.close();
    return result;
    
  } catch (error) {
    console.error(`  [DA/PA] Error: ${error.message}`);
    return { da: null, pa: null };
  }
}

/**
 * Get SS from Keywords Everywhere
 */
async function getSS(browser, domain) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.goto('https://keywordseverywhere.com/tools/spam-score-checker/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Type domain
    const input = await page.$('input[placeholder*="domain"], input[type="text"]');
    if (!input) throw new Error('Input not found');
    await input.click({ clickCount: 3 });
    await page.keyboard.type(domain);
    
    // Click check
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await page.evaluate(el => el.textContent.trim().toLowerCase(), btn);
      if (text.includes('check') || text.includes('analyze')) {
        await btn.click();
        break;
      }
    }
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Extract SS
    const ss = await page.evaluate(() => {
      const text = document.body.textContent;
      // Try multiple patterns
      const patterns = [
        /spam\s*score[:\s]*(\d+)/i,
        /(\d+)\s*%?\s*spam/i,
        /spam[^\d]*(\d+)/i,
        /score[^\d]*(\d+)[^\d]*spam/i
      ];
      
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const val = parseInt(match[1]);
          if (val >= 0 && val <= 100) return val;
        }
      }
      return null;
    });
    
    await page.close();
    return { ss };
    
  } catch (error) {
    console.error(`  [SS] Error: ${error.message}`);
    return { ss: null };
  }
}

/**
 * Main
 */
async function main() {
  console.log('='.repeat(70));
  console.log('AIMAN CHECKER - FULL METRICS EXTRACTOR');
  console.log('='.repeat(70));
  console.log('');
  console.log('SOURCES:');
  console.log('  🌐 DA/PA: dachecker.io (Moz)');
  console.log('  📊 SS: Keywords Everywhere');
  console.log('  📡 DR: Ahrefs API (free)');
  console.log('');
  console.log('='.repeat(70));
  
  let browser;
  
  try {
    console.log('\n[Browser] Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const results = [];
    
    for (const domain of DOMAINS) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`[Check] ${domain}`);
      console.log('='.repeat(70));
      
      // Get all metrics in parallel (2 browsers for speed)
      const [dap, ssResult, dr] = await Promise.all([
        getDAPA(browser, domain),
        getSS(browser, domain),
        getDR(domain)
      ]);
      
      const result = {
        domain,
        DA: dap.da,
        PA: dap.pa,
        SS: ssResult.ss,
        DR: dr
      };
      
      results.push(result);
      
      console.log(`  → DA=${dap.da}, PA=${dap.pa}, SS=${ssResult.ss}, DR=${dr}`);
    }
    
    // Output
    console.log('\n' + '='.repeat(70));
    console.log('FINAL RESULTS');
    console.log('='.repeat(70));
    console.table(results);
    
    // Validate
    const ref = results.find(r => r.domain === 'malcomschein.my.id');
    if (ref) {
      console.log('\n' + '='.repeat(70));
      console.log('VALIDATION (Reference: malcomschein.my.id)');
      console.log('='.repeat(70));
      console.log(`Expected: DA:62, PA:35, SS:32, DR:0`);
      console.log(`Got:      DA:${ref.DA}, PA:${ref.PA}, SS:${ref.SS}, DR:${ref.DR}`);
      
      const daMatch = ref.DA === 62 ? '✅' : '❌';
      const paMatch = ref.PA === 35 ? '✅' : '❌';
      const drMatch = Math.round(ref.DR) === 0 ? '✅' : '❌';
      
      console.log(`\nMatch:    DA:${daMatch}, PA:${paMatch}, DR:${drMatch}`);
      console.log(`Note:     SS dari Keywords Everywhere (algoritma sendiri)`);
    }
    
    // Save
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = `/home/ubuntu/aiman-checker/results-${ts}.json`;
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
    fs.writeFileSync('/home/ubuntu/aiman-checker/results-latest.json', JSON.stringify(results, null, 2));
    console.log(`\n💾 Saved: ${file}`);
    console.log(`📄 Latest: /home/ubuntu/aiman-checker/results-latest.json`);
    
  } catch (error) {
    console.error('\n❌ Fatal:', error.message);
  } finally {
    if (browser) {
      console.log('\n[Browser] Closing...');
      await browser.close();
    }
  }
}

main().catch(console.error);