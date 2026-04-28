/**
 * Debug utility for scraper
 * Helps identify what selectors are available on Target pages
 */

const { chromium } = require('playwright');
const config = require('./config');

class DebugScraper {
  async inspectPage(query) {
    const browser = await chromium.launch({ headless: false, args: config.browser.args });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: config.userAgent
    });
    const page = await context.newPage();

    try {
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
      console.log(`[>] Navigating to: ${searchUrl}\n`);

      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

      console.log('[i] Page Analysis:\n');

      const analysis = await page.evaluate(() => {
        const results = {
          pageTitle: document.title,
          totalElements: document.querySelectorAll('*').length,
          selectors: {
            dataTestProductCards: document.querySelectorAll('[data-test*="ProductCard"]').length,
            dataTestNameElements: document.querySelectorAll('[data-test*="Name"]').length,
            dataTestPriceElements: document.querySelectorAll('[data-test*="Price"]').length,
            productLinks: document.querySelectorAll('a[href*="/p/"]').length,
            productImages: document.querySelectorAll('img[alt*="product"], img[alt*="Product"]').length,
            divWithProductClass: document.querySelectorAll('div[class*="product"]').length
          },
          dataTestAttributes: [],
          allClasses: []
        };

        const dataTests = new Set();
        document.querySelectorAll('[data-test]').forEach((el) => {
          dataTests.add(el.getAttribute('data-test'));
        });
        results.dataTestAttributes = Array.from(dataTests).slice(0, 20);

        const classes = new Set();
        document.querySelectorAll('[class]').forEach((el) => {
          const cls = el.getAttribute('class');
          if (cls && cls.includes('product')) {
            classes.add(cls);
          }
        });
        results.allClasses = Array.from(classes).slice(0, 10);

        return results;
      });

      console.log(`Page Title: ${analysis.pageTitle}`);
      console.log(`Total Elements: ${analysis.totalElements}\n`);

      console.log('[i] Selector Availability:');
      for (const [key, value] of Object.entries(analysis.selectors)) {
        console.log(`   ${key}: ${value}`);
      }

      if (analysis.dataTestAttributes.length > 0) {
        console.log('\n[i] Sample data-test Attributes:');
        analysis.dataTestAttributes.forEach((attr) => {
          console.log(`   - ${attr}`);
        });
      }

      if (analysis.allClasses.length > 0) {
        console.log('\n[i] Product-related Classes:');
        analysis.allClasses.forEach((cls) => {
          console.log(`   - ${cls}`);
        });
      }

      console.log('\n[OK] Browser opened for manual inspection...');
      console.log('Close the browser window to end analysis.\n');

      await new Promise((resolve) => {
        page.context().browser().once('disconnected', resolve);
      });
    } catch (error) {
      console.error('Error:', error.message);
    } finally {
      await browser.close();
    }
  }
}

const debugger_ = new DebugScraper();
const query = process.argv[2] || 'laptop';
debugger_.inspectPage(query);
