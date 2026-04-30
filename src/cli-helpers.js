const readline = require('readline');
const config = require('../config');

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  argv.forEach((arg) => {
    if (arg === '--headful') {
      options.headless = false;
      return;
    }
    if (arg === '--headless') {
      options.headless = true;
      return;
    }
    if (arg === '--manual-challenge') {
      options.manualChallenge = true;
      return;
    }

    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      options[match[1]] = match[2];
      return;
    }

    positional.push(arg);
  });

  return { positional, options };
}

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

function createManualChallengeHandler(storeName) {
  return async ({ diagnostics, stage }) => {
    console.log('\nManual challenge mode is active.');
    console.log(`Store: ${storeName}`);
    console.log(`Stage: ${stage}`);
    console.log(`Current URL: ${diagnostics.finalUrl}`);
    console.log('Solve the challenge in the opened browser, then press Enter here.');
    await waitForEnter('Press Enter after the page shows search results...');
  };
}

function buildScraperOptions(options, storeName = 'store') {
  const provider = options.provider || process.env.TARGET_SCRAPER_PROVIDER || config.browser.provider;
  const manualEnvName = `${storeName.toUpperCase()}_MANUAL_CHALLENGE`;
  const manualChallenge =
    options.manualChallenge ||
    process.env[manualEnvName] === 'true' ||
    process.env.STORE_MANUAL_CHALLENGE === 'true';
  const headless =
    typeof options.headless === 'boolean'
      ? options.headless
      : manualChallenge
        ? false
      : config.browser.headless;

  return {
    provider,
    manualChallenge,
    scraperOptions: {
      provider,
      headless,
      timeout: parseNumber(options.timeout, config.browser.timeout),
      slowMo: parseNumber(options['slow-mo'], config.browser.slowMo),
      devtools: config.browser.devtools,
      userDataDir: options['user-data-dir'] || config.browser.userDataDir,
      executablePath: options['executable-path'] || config.browser.executablePath,
      userAgent: options['user-agent'] || config.userAgent,
      browserWSEndpoint: config.brightdata.browserWSEndpoint
    }
  };
}

function getCommonHelpFlags() {
  return `CLI flags:
  --provider=local|brightdata
  --headful
  --headless
  --timeout=120000
  --slow-mo=75
  --manual-challenge
  --user-agent=auto
  --user-data-dir=.chrome-store-debug
  --executable-path="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`;
}

module.exports = {
  buildScraperOptions,
  createManualChallengeHandler,
  getCommonHelpFlags,
  parseArgs,
  parseNumber,
  sanitizeQuery
};
