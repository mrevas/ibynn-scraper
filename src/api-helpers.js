const config = require('../config');

const API_DESCRIPTION =
  'Multi-store product search API helper for Target, Costco via the Instacart storefront, Walmart, and Amazon Fresh with local Chromium or Bright Data support.';

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStoreName(storeName = 'target') {
  return String(storeName).toLowerCase().replace(/[\s_-]+/g, '');
}

function buildBrowserOptions(extra = {}) {
  const provider = extra.provider || process.env.TARGET_SCRAPER_PROVIDER || config.browser.provider;
  const headless =
    typeof extra.headless === 'boolean'
      ? extra.headless
      : provider === 'brightdata'
        ? true
        : config.browser.headless;
  const timeout = parseNumber(
    extra.timeout ??
      process.env.TARGET_SCRAPER_TIMEOUT ??
      process.env.TARGET_SCRAPER_TIMEOUT_MS,
    config.browser.timeout
  );
  const slowMo = parseNumber(
    extra.slowMo ?? process.env.TARGET_SCRAPER_SLOW_MO,
    config.browser.slowMo
  );
  const browserWSEndpoint = extra.browserWSEndpoint || config.brightdata.browserWSEndpoint;

  return {
    ...extra,
    provider,
    headless,
    timeout,
    slowMo,
    devtools:
      typeof extra.devtools === 'boolean' ? extra.devtools : config.browser.devtools,
    userDataDir: extra.userDataDir || config.browser.userDataDir,
    executablePath: extra.executablePath || config.browser.executablePath,
    userAgent: extra.userAgent || config.userAgent,
    browserWSEndpoint
  };
}

function buildStoreScraperOptions(storeName = 'target', extra = {}) {
  const normalizedStore = normalizeStoreName(storeName);
  const options = buildBrowserOptions(extra);

  if (normalizedStore === 'costco') {
    return {
      ...options,
      zipCode: extra.zipCode || process.env.COSTCO_ZIP || config.costco.zipCode
    };
  }

  if (normalizedStore === 'amazonfresh') {
    return {
      ...options,
      zipCode: extra.zipCode || process.env.AMAZON_FRESH_ZIP || config.amazonFresh.zipCode,
      acceptableZipPrefixes:
        extra.acceptableZipPrefixes ||
        parseList(
          process.env.AMAZON_FRESH_ACCEPTABLE_ZIP_PREFIXES,
          config.amazonFresh.acceptableZipPrefixes
        ),
      acceptableZipCodes:
        extra.acceptableZipCodes ||
        parseList(
          process.env.AMAZON_FRESH_ACCEPTABLE_ZIP_CODES,
          config.amazonFresh.acceptableZipCodes
        )
    };
  }

  return options;
}

module.exports = {
  API_DESCRIPTION,
  buildBrowserOptions,
  buildStoreScraperOptions
};
