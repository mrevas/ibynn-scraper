const puppeteer = require('puppeteer');
const config = require('../config');

function getBrowserProvider(options = {}) {
  return options.provider || config.browser.provider;
}

function getBrightDataBrowserWSEndpoint(options = {}) {
  const browserWSEndpoint = options.browserWSEndpoint || config.brightdata.browserWSEndpoint;
  if (!browserWSEndpoint) {
    throw new Error(
      'Bright Data browser endpoint is not configured. Set BRIGHTDATA_AUTH or BRIGHTDATA_BROWSER_WS.'
    );
  }
  return browserWSEndpoint;
}

async function createBrowser(options = {}) {
  const provider = getBrowserProvider(options);

  if (provider === 'local') {
    return puppeteer.launch({
      headless: options.headless !== false,
      args: config.browser.args
    });
  }

  if (provider === 'brightdata') {
    return puppeteer.connect({
      browserWSEndpoint: getBrightDataBrowserWSEndpoint(options),
      protocolTimeout: options.timeout || config.browser.timeout
    });
  }

  throw new Error(
    `Unsupported browser provider "${provider}". Expected "local" or "brightdata".`
  );
}

module.exports = {
  createBrowser,
  getBrowserProvider,
  getBrightDataBrowserWSEndpoint
};
