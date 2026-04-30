const config = require('../config');

async function humanDelay(minMs = 600, maxMs = 1600) {
  const delay = minMs + Math.floor(Math.random() * Math.max(maxMs - minMs, 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function applyPageHardening(page, options = {}) {
  const viewport = options.viewport || { width: 1366, height: 900 };
  const userAgent =
    typeof options.userAgent === 'string' ? options.userAgent : config.userAgent;

  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  if (userAgent && userAgent !== 'auto') {
    await page.setUserAgent(userAgent);
  }

  if (options.timeout) {
    page.setDefaultNavigationTimeout(options.timeout);
    page.setDefaultTimeout(options.timeout);
  }
}

async function getCookieCount(page) {
  try {
    const cookies = await page.cookies();
    return cookies.length;
  } catch (error) {
    return null;
  }
}

async function maybeHandleManualChallenge({
  page,
  diagnostics,
  stage,
  storeName,
  manualChallenge,
  getDiagnostics,
  logDiagnostics,
  hasResults
}) {
  if (!manualChallenge || !(diagnostics.blocked || diagnostics.verification)) {
    return diagnostics;
  }

  await manualChallenge({ page, diagnostics, stage, storeName });
  await humanDelay(1200, 2500);

  const refreshed = await getDiagnostics(page, null, {
    cookieCount: await getCookieCount(page)
  });

  if (hasResults) {
    refreshed.selectorFound = await hasResults(page);
  }

  logDiagnostics(`${stage} after manual challenge`, refreshed);
  return refreshed;
}

module.exports = {
  applyPageHardening,
  getCookieCount,
  humanDelay,
  maybeHandleManualChallenge
};
