function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readEnv(name) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function parseList(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const brightDataAuth = readEnv('BRIGHTDATA_AUTH');
const brightDataBrowserWS = readEnv('BRIGHTDATA_BROWSER_WS');
const brightDataApiKey = readEnv('BRIGHTDATA_API_KEY');

/**
 * Configuration file for Target Scraper
 * Edit this file to customize default settings
 */

module.exports = {
  // Browser settings
  browser: {
    provider: process.env.TARGET_SCRAPER_PROVIDER || 'local',
    headless: process.env.TARGET_SCRAPER_HEADLESS
      ? process.env.TARGET_SCRAPER_HEADLESS !== 'false'
      : true,
    slowMo: parseNumber(process.env.TARGET_SCRAPER_SLOW_MO, 0),
    devtools: process.env.TARGET_SCRAPER_DEVTOOLS === 'true',
    userDataDir: readEnv('TARGET_SCRAPER_USER_DATA_DIR'),
    executablePath: readEnv('TARGET_SCRAPER_EXECUTABLE_PATH'),
    timeout: parseNumber(
      process.env.TARGET_SCRAPER_TIMEOUT || process.env.TARGET_SCRAPER_TIMEOUT_MS,
      60000
    ),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  },

  brightdata: {
    apiKey: brightDataApiKey,
    auth: brightDataAuth || null,
    browserWSEndpoint:
      brightDataBrowserWS ||
      (brightDataAuth ? `wss://${brightDataAuth}@brd.superproxy.io:9222` : null)
  },

  amazonFresh: {
    zipCode: readEnv('AMAZON_FRESH_ZIP') || '11435',
    acceptableZipPrefixes: parseList(
      readEnv('AMAZON_FRESH_ACCEPTABLE_ZIP_PREFIXES'),
      ['111', '113', '114', '116']
    ),
    acceptableZipCodes: parseList(
      readEnv('AMAZON_FRESH_ACCEPTABLE_ZIP_CODES'),
      ['11004', '11005']
    )
  },

  // Default search settings
  search: {
    limit: 30,
    sort: 'relevance'
  },

  // Results folder settings
  results: {
    folder: './results',
    subfolder: 'target',
    format: 'json'
  },

  // Retry settings
  retry: {
    enabled: true,
    maxAttempts: 3,
    delayMs: 1000
  },

  // Output settings
  output: {
    format: 'json', // 'json' or 'csv'
    saveResults: true,
    filename: null // auto-generated if null
  },

  // Filter presets
  filters: {
    budget: {
      minRating: 3.5,
      priceMin: 0,
      priceMax: 100
    },
    midRange: {
      minRating: 4.0,
      priceMin: 100,
      priceMax: 300
    },
    premium: {
      minRating: 4.5,
      priceMin: 300,
      priceMax: Infinity
    }
  },

  // User agent to use. Set TARGET_SCRAPER_USER_AGENT=auto to keep the browser default.
  userAgent:
    readEnv('TARGET_SCRAPER_USER_AGENT') ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',

  // Request delay (in ms) for polite scraping
  delayBetweenRequests: 0,

  // Logging
  logging: {
    verbose: true,
    logFile: null // Set to filename to log to file
  }
};
