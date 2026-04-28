/**
 * Detailed diagnostic tool to inspect what Target returns
 */

const { chromium } = require('playwright');
const config = require('./config');

async function diagnose(query = 'laptop') {
  const browser = await chromium.launch({ headless: true, args: config.browser.args });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: config.userAgent
  });
  const page = await context.newPage();

  try {
    const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
    console.log(`\n[?] Diagnosing: ${query}`);
    console.log(`[i] URL: ${searchUrl}\n`);

    console.log('[>] Navigating...');
    const response = await page.goto(searchUrl, { waitUntil: 'networkidle' });
    console.log(`[OK] Response status: ${response?.status()}\n`);

    console.log('[>] Waiting for dynamic content...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

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

    console.log(`[OK] Page title: ${pageInfo.title}`);
    console.log(`[OK] Current URL: ${pageInfo.url}`);
    console.log(`[OK] Has "no results" message: ${pageInfo.hasNoResults}`);
    console.log(`[OK] Has "results" text: ${pageInfo.hasProducts}\n`);

    console.log('[i] Product Elements Found:');
    for (const [key, count] of Object.entries(pageInfo.productElements)) {
      console.log(`   ${key}: ${count}`);
    }

    console.log('\n[i] Page Content Preview:');
    console.log('-'.repeat(60));
    console.log(pageInfo.bodyText);
    console.log('-'.repeat(60) + '\n');

    if (pageInfo.productElements.byHref > 0) {
      console.log('[OK] Found product links. Extracting sample...\n');

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
      samples.forEach((sample, index) => {
        console.log(`${index + 1}. ${sample.text}`);
        console.log(`   URL: ${sample.href}`);
        console.log(`   Parent class: ${sample.parent}\n`);
      });
    }

    const screenshotPath = `debug_${query}_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    console.log(`[i] Screenshot saved to: ${screenshotPath}\n`);
  } catch (error) {
    console.error('[X] Error:', error.message);
  } finally {
    await browser.close();
  }
}

const query = process.argv[2] || 'laptop';
diagnose(query);
