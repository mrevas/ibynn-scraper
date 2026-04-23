/**
 * Detailed diagnostic tool to inspect what Target returns
 */

const puppeteer = require('puppeteer');

async function diagnose(query = 'laptop') {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
    console.log(`\n🔍 Diagnosing: ${query}`);
    console.log(`📍 URL: ${searchUrl}\n`);

    // Navigate
    console.log('[→] Navigating...');
    const response = await page.goto(searchUrl, { waitUntil: 'networkidle2' });
    console.log(`[✓] Response status: ${response?.status()}\n`);

    // Wait a bit more for dynamic content
    console.log('[→] Waiting for dynamic content...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get page information
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText.substring(0, 500),
        hasNoResults: document.body.innerText.toLowerCase().includes('no results'),
        hasProducts: document.body.innerText.toLowerCase().includes('results'),
        productElements: {
          byDataTest: document.querySelectorAll('[data-test*="product"], [data-test*="Product"]').length,
          byHref: document.querySelectorAll('a[href*="/p/"]').length,
          byClass: document.querySelectorAll('[class*="product"]').length,
          byAlt: document.querySelectorAll('img[alt*="product"]').length
        },
        htmlSnippet: document.body.innerHTML.substring(0, 1000)
      };
    });

    console.log(`[✓] Page title: ${pageInfo.title}`);
    console.log(`[✓] Current URL: ${pageInfo.url}`);
    console.log(`[✓] Has "no results" message: ${pageInfo.hasNoResults}`);
    console.log(`[✓] Has "results" text: ${pageInfo.hasProducts}\n`);

    console.log('📊 Product Elements Found:');
    for (const [key, count] of Object.entries(pageInfo.productElements)) {
      console.log(`   ${key}: ${count}`);
    }

    console.log('\n📝 Page Content Preview:');
    console.log('─'.repeat(60));
    console.log(pageInfo.bodyText);
    console.log('─'.repeat(60) + '\n');

    if (pageInfo.productElements.byHref > 0) {
      console.log('[✓] Found product links! Extracting sample...\n');

      const samples = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="/p/"]'))
          .slice(0, 3)
          .map((el) => ({
            href: el.href,
            text: el.innerText?.substring(0, 100),
            parent: el.parentElement?.className
          }));
      });

      console.log('Sample products:');
      samples.forEach((s, i) => {
        console.log(`${i + 1}. ${s.text}`);
        console.log(`   URL: ${s.href}`);
        console.log(`   Parent class: ${s.parent}\n`);
      });
    }

    // Take a screenshot for visual inspection
    const screenshotPath = `debug_${query}_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Screenshot saved to: ${screenshotPath}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

const query = process.argv[2] || 'laptop';
diagnose(query);
