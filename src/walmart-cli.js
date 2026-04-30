#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getScraper } = require('./stores');
const config = require('../config');
const {
  buildScraperOptions,
  createManualChallengeHandler,
  getCommonHelpFlags,
  parseArgs,
  parseNumber,
  sanitizeQuery
} = require('./cli-helpers');

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const query = positional[0];
  const limit = parseNumber(positional[1], config.search.limit);
  const { provider, manualChallenge, scraperOptions } = buildScraperOptions(options, 'walmart');

  if (!query || query === '--help' || query === '-h') {
    console.log(`
Usage: ibynn-walmart-scrape <search-term> [limit]

Examples:
  ibynn-walmart-scrape "milk" 10
  npm run walmart:scrape -- "wireless headphones" 25
  node src/walmart-cli.js "milk" 5 --headful
  node src/walmart-cli.js "milk" 5 --headful --executable-path="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=".chrome-walmart-debug"
  node src/walmart-cli.js "milk" 5 --headful --manual-challenge --user-agent=auto --user-data-dir=".chrome-walmart-debug"

Provider env:
  TARGET_SCRAPER_PROVIDER=local|brightdata
  BRIGHTDATA_AUTH=username:password
  BRIGHTDATA_BROWSER_WS=wss://username:password@brd.superproxy.io:9222
  BRIGHTDATA_API_KEY=your_brightdata_api_key
  TARGET_SCRAPER_HEADLESS=false

${getCommonHelpFlags()}
`);
    process.exit(0);
  }

  const scraper = getScraper('walmart', {
    ...scraperOptions,
    manualChallenge: manualChallenge ? createManualChallengeHandler('Walmart') : null
  });

  try {
    console.log('\nStarting Walmart Search Scraper\n');
    console.log('Store: Walmart');
    console.log(`Provider: ${scraper.provider}`);
    console.log(`Search term: "${query}"`);
    console.log(`Max results: ${limit}\n`);

    const products = await scraper.search(query, { limit });

    console.log('\nResults:\n');
    console.log('-'.repeat(100));

    products.forEach((product) => {
      console.log(`\n${product.position}. ${product.title}`);
      console.log(`   Price: ${product.price ?? 'N/A'}`);
      console.log(`   Rating: ${product.rating ?? 'N/A'}`);
      console.log(`   URL: ${product.product_link}`);
      console.log(`   ID: ${product.product_id}`);
    });

    console.log('\n' + '-'.repeat(100));
    console.log(`\nScraped ${products.length} products\n`);

    const resultsDir = path.join(process.cwd(), config.results.folder, 'walmart');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filepath = path.join(resultsDir, `${sanitizeQuery(query)}_${timestamp}.json`);
    fs.writeFileSync(filepath, JSON.stringify(products, null, 2));

    console.log(`Results saved to: ${path.relative(process.cwd(), filepath)}\n`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
