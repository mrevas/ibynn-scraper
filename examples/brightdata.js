const TargetScraper = require('../src/scraper');

/**
 * Bright Data example
 *
 * Exact env setup:
 *   TARGET_SCRAPER_PROVIDER=brightdata
 *   BRIGHTDATA_AUTH=username:password
 *
 * Optional override:
 *   BRIGHTDATA_BROWSER_WS=wss://username:password@brd.superproxy.io:9222
 *   TARGET_SCRAPER_TIMEOUT=60000
 *
 * Example:
 *   TARGET_SCRAPER_PROVIDER=brightdata BRIGHTDATA_AUTH=username:password node examples/brightdata.js "gaming laptop" 5
 */
async function main() {
  const query = process.argv[2] || 'gaming laptop';
  const limit = Number.parseInt(process.argv[3] || '5', 10);

  const scraper = new TargetScraper({ timeout: 60000 });

  try {
    await scraper.init();

    const products = await scraper.search(query, { limit, pages: 1 });
    console.log(`Bright Data search for "${query}" returned ${products.length} products\n`);

    products.forEach((product) => {
      console.log(`${product.position}. ${product.title}`);
      console.log(`   Price: ${product.price ?? 'N/A'}`);
      console.log(`   URL: ${product.product_link}`);
      console.log(`   ID: ${product.product_id}\n`);
    });
  } catch (error) {
    console.error('Bright Data example failed:', error.message);
    process.exitCode = 1;
  } finally {
    await scraper.close();
  }
}

main();
