const { getScraper, buildStoreScraperOptions, API_DESCRIPTION } = require('../src/scraper');

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const query = process.argv[2] || 'milk';
  const limit = parseNumber(process.argv[3], 5);
  const provider = process.env.TARGET_SCRAPER_PROVIDER || 'brightdata';

  const scraper = getScraper(
    'costco',
    buildStoreScraperOptions('costco', {
      provider,
      zipCode: process.env.COSTCO_ZIP || '11435'
    })
  );

  console.log('costco api example', {
    description: API_DESCRIPTION,
    store: 'costco',
    provider,
    zipCode: process.env.COSTCO_ZIP || '11435',
    hasBrightDataAuth: Boolean(process.env.BRIGHTDATA_AUTH),
    hasBrightDataBrowserWS: Boolean(process.env.BRIGHTDATA_BROWSER_WS)
  });

  try {
    const products = await scraper.search(query, { limit });
    console.log(JSON.stringify(products, null, 2));
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };
