const { getScraper } = require('../src/stores');

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseHeadless(provider) {
  if (process.env.TARGET_SCRAPER_HEADLESS) {
    return process.env.TARGET_SCRAPER_HEADLESS !== 'false';
  }
  return provider !== 'local';
}

async function main() {
  const query = process.argv[2] || 'milk';
  const limit = parseNumber(process.argv[3], 5);
  const provider = process.env.TARGET_SCRAPER_PROVIDER || 'local';
  const timeout = parseNumber(
    process.env.TARGET_SCRAPER_TIMEOUT || process.env.TARGET_SCRAPER_TIMEOUT_MS,
    120000
  );

  const scraper = getScraper('costco', {
    provider,
    headless: parseHeadless(provider),
    timeout,
    slowMo: parseNumber(process.env.TARGET_SCRAPER_SLOW_MO, provider === 'local' ? 75 : 0),
    devtools: process.env.TARGET_SCRAPER_DEVTOOLS === 'true',
    userDataDir: process.env.TARGET_SCRAPER_USER_DATA_DIR,
    executablePath: process.env.TARGET_SCRAPER_EXECUTABLE_PATH,
    browserWSEndpoint: process.env.BRIGHTDATA_BROWSER_WS
  });

  console.log('costco local/headful example config', {
    provider,
    headless: parseHeadless(provider),
    timeout,
    slowMo: parseNumber(process.env.TARGET_SCRAPER_SLOW_MO, provider === 'local' ? 75 : 0),
    userDataDir: process.env.TARGET_SCRAPER_USER_DATA_DIR || null,
    executablePath: process.env.TARGET_SCRAPER_EXECUTABLE_PATH || null,
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
