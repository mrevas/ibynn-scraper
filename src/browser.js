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

function getBrightDataConnectionDiagnostics(browserWSEndpoint) {
  try {
    const parsed = new URL(browserWSEndpoint);
    return {
      protocol: parsed.protocol,
      host: parsed.host,
      hasUsername: Boolean(parsed.username),
      hasPassword: Boolean(parsed.password),
      usernamePrefix: parsed.username ? parsed.username.slice(0, 24) : null,
      endpoint: `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ''}${parsed.host}${parsed.pathname}`
    };
  } catch (error) {
    return {
      protocol: null,
      host: null,
      hasUsername: false,
      hasPassword: false,
      usernamePrefix: null,
      endpoint: 'invalid-url'
    };
  }
}

function getBrightDataConnectionErrorMessage(error, browserWSEndpoint) {
  const diagnostics = getBrightDataConnectionDiagnostics(browserWSEndpoint);
  const parts = [
    `Bright Data browser connection failed: ${error.message}`,
    `endpoint=${diagnostics.endpoint}`,
    `host=${diagnostics.host || 'unknown'}`,
    `hasUsername=${diagnostics.hasUsername}`,
    `hasPassword=${diagnostics.hasPassword}`
  ];

  if (diagnostics.usernamePrefix) {
    parts.push(`usernamePrefix=${diagnostics.usernamePrefix}`);
  }

  if (error.message.includes('Unexpected server response: 403')) {
    parts.push(
      'Bright Data rejected the WebSocket handshake before any Costco page loaded. Verify that BRIGHTDATA_AUTH/BRIGHTDATA_BROWSER_WS are for a Bright Data Scraping Browser/Browser API zone, the zone is active, the password is current, and special characters in credentials are URL-encoded.'
    );
  }

  return parts.join(' ');
}

async function createBrowser(options = {}) {
  const provider = getBrowserProvider(options);

  if (provider === 'local') {
    return puppeteer.launch({
      headless: options.headless !== false,
      args: config.browser.args,
      slowMo: options.slowMo ?? config.browser.slowMo,
      devtools: options.devtools ?? config.browser.devtools,
      userDataDir: options.userDataDir || config.browser.userDataDir || undefined,
      executablePath: options.executablePath || config.browser.executablePath || undefined
    });
  }

  if (provider === 'brightdata') {
    const browserWSEndpoint = getBrightDataBrowserWSEndpoint(options);
    try {
      return await puppeteer.connect({
        browserWSEndpoint,
        protocolTimeout: options.timeout || config.browser.timeout
      });
    } catch (error) {
      throw new Error(getBrightDataConnectionErrorMessage(error, browserWSEndpoint));
    }
  }

  throw new Error(
    `Unsupported browser provider "${provider}". Expected "local" or "brightdata".`
  );
}

module.exports = {
  createBrowser,
  getBrowserProvider,
  getBrightDataBrowserWSEndpoint,
  getBrightDataConnectionDiagnostics
};
