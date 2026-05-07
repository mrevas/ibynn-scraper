const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');
const {
  applyPageHardening,
  getCookieCount,
  humanDelay,
  maybeHandleManualChallenge
} = require('../hardening');

const AMAZON_FRESH_URL =
  'https://www.amazon.com/alm/storefront?almBrandId=QW1hem9uIEZyZXNo';
const DEFAULT_ZIP_CODE = '11435';
const DEFAULT_ACCEPTABLE_ZIP_PREFIXES = ['111', '113', '114', '116'];
const DEFAULT_ACCEPTABLE_ZIP_CODES = ['11004', '11005'];
const PRODUCT_SELECTOR = '[data-component-type="s-search-result"][data-asin]';
const PRODUCT_LINK_SELECTOR =
  '[data-component-type="s-search-result"] a[href*="/dp/"], [data-component-type="s-search-result"] a[href*="/gp/product/"]';
const LOCATION_LINK_SELECTOR =
  '#nav-global-location-popover-link, #glow-ingress-block, #nav-packard-glow-loc-icon';
const ZIP_INPUT_SELECTOR = '#GLUXZipUpdateInput, input[name="zipCode"]';
const ZIP_UPDATE_SELECTOR = '#GLUXZipUpdate, input[aria-labelledby="GLUXZipUpdate-announce"]';
const ZIP_DONE_SELECTOR =
  '#GLUXConfirmClose, input[name="glowDoneButton"], button[name="glowDoneButton"], .a-popover-footer button';
const LOCATION_STATUS_SELECTOR = [
  LOCATION_LINK_SELECTOR,
  '#glow-ingress-line1',
  '#glow-ingress-line2',
  '#glow-ingress-line1 span',
  '#glow-ingress-line2 span',
  '#GLUXZipConfirmationValue',
  '#GLUXZipConfirmationValue span',
  '#GLUXDisplayAddressValue',
  '#GLUXDisplayAddressValue span',
  '[data-action-type="LOCATION"]',
  '[aria-label*="Deliver to"]',
  '[aria-label*="delivery"]'
].join(', ');
const ZIP_CONFIRMATION_RETRY_LIMIT = 4;
const SEARCH_NAVIGATION_RETRY_LIMIT = 3;
const FAST_POLL_INTERVAL_MS = 200;

function normalizeZipCode(value) {
  const match = String(value || '').match(/\d{5}/);
  return match ? match[0] : null;
}

function normalizeZipList(values, fallback = []) {
  const source =
    Array.isArray(values)
      ? values
      : typeof values === 'string'
        ? values.split(',')
        : fallback;
  return source
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AmazonFreshScraper extends BaseScraper {
  constructor(options = {}) {
    super('Amazon Fresh', options);
    this.provider = getBrowserProvider(options);
    this.headless =
      typeof options.headless === 'boolean' ? options.headless : config.browser.headless;
    this.timeout = options.timeout || config.browser.timeout;
    this.browserWSEndpoint = options.browserWSEndpoint;
    this.slowMo = options.slowMo;
    this.devtools = options.devtools;
    this.userDataDir = options.userDataDir;
    this.executablePath = options.executablePath;
    this.userAgent =
      typeof options.userAgent === 'string' ? options.userAgent : config.userAgent;
    this.manualChallenge = options.manualChallenge;
    this.zipCode =
      normalizeZipCode(options.zipCode) ||
      normalizeZipCode(config.amazonFresh?.zipCode) ||
      DEFAULT_ZIP_CODE;
    this.acceptableZipPrefixes = normalizeZipList(
      options.acceptableZipPrefixes || config.amazonFresh?.acceptableZipPrefixes,
      DEFAULT_ACCEPTABLE_ZIP_PREFIXES
    );
    this.acceptableZipCodes = normalizeZipList(
      options.acceptableZipCodes || config.amazonFresh?.acceptableZipCodes,
      DEFAULT_ACCEPTABLE_ZIP_CODES
    );
    this.confirmedZipCode = null;
    this.sessionPage = null;
    this.sessionReady = false;
    this.sessionZip = null;
    this.sessionPreparedAt = null;
    this.hasLoggedSearchConfig = false;
  }

  async init() {
    try {
      this.browser = await createBrowser({
        provider: this.provider,
        headless: this.headless,
        timeout: this.timeout,
        browserWSEndpoint: this.browserWSEndpoint,
        slowMo: this.slowMo,
        devtools: this.devtools,
        userDataDir: this.userDataDir,
        executablePath: this.executablePath
      });
      console.log(`[OK] Browser initialized (${this.provider})`);
    } catch (error) {
      throw new Error(`Failed to initialize ${this.provider} browser: ${error.message}`);
    }
  }

  async close() {
    await this.resetSession();

    if (!this.browser) {
      return;
    }

    try {
      if (this.provider === 'brightdata') {
        await this.browser.disconnect();
        console.log('[OK] Browser disconnected');
      } else {
        await this.browser.close();
        console.log('[OK] Browser closed');
      }
    } finally {
      this.browser = null;
      this.hasLoggedSearchConfig = false;
    }
  }

  async getPage() {
    if (!this.browser) {
      await this.init();
    }

    const page = await this.browser.newPage();
    await applyPageHardening(page, {
      timeout: this.timeout,
      userAgent: this.userAgent
    });
    return page;
  }

  hasUsableSessionPage() {
    return Boolean(this.sessionPage && !this.sessionPage.isClosed());
  }

  async getSessionPage() {
    if (this.hasUsableSessionPage()) {
      return this.sessionPage;
    }

    this.sessionPage = await this.getPage();
    return this.sessionPage;
  }

  async resetSession() {
    await this.invalidateSession('reset', { closePage: true, log: false });
  }

  async invalidateSession(reason, options = {}) {
    const { closePage = false, log = true } = options;
    if (log && reason) {
      console.log(`[!] Resetting Amazon Fresh session: ${reason}`);
    }

    this.sessionReady = false;
    this.sessionZip = null;
    this.sessionPreparedAt = null;

    if (!closePage || !this.sessionPage) {
      return;
    }

    const page = this.sessionPage;
    this.sessionPage = null;
    if (!page.isClosed()) {
      await page.close().catch(() => null);
    }
  }

  markSessionReady(locationState = {}) {
    const confirmedZip = this.recordConfirmedZip(locationState) || this.confirmedZipCode || null;
    this.sessionReady = true;
    this.sessionZip = confirmedZip;
    this.sessionPreparedAt = new Date().toISOString();
    return confirmedZip;
  }

  logSearchConfig() {
    if (this.hasLoggedSearchConfig) {
      return;
    }

    console.log('amazon fresh scraper config', {
      provider: this.provider,
      preferredZipCode: this.zipCode,
      confirmedZipCode: this.confirmedZipCode,
      acceptableZipPrefixes: this.acceptableZipPrefixes,
      acceptableZipCodes: this.acceptableZipCodes,
      hasAuth: Boolean(config.brightdata.auth),
      browserWSEndpoint:
        this.browserWSEndpoint || config.brightdata.browserWSEndpoint ? 'configured' : 'missing'
    });
    this.hasLoggedSearchConfig = true;
  }

  getProviderSpecificBlockHint() {
    if (this.provider === 'brightdata') {
      return 'Amazon Fresh blocked the Bright Data-backed browser session.';
    }
    return 'Amazon Fresh blocked the local browser session. Bright Data mode may be required for Amazon Fresh.';
  }

  isAmazonFreshStorefrontUrl(url = '') {
    return typeof url === 'string' && url.includes('/alm/storefront');
  }

  isAmazonFreshSearchUrl(url = '') {
    return (
      typeof url === 'string' &&
      url.includes('/s?') &&
      (url.includes('i=amazonfresh') || url.includes('almBrandId=QW1hem9uIEZyZXNo'))
    );
  }

  isTransientExecutionErrorMessage(message = '') {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('execution context was destroyed') ||
      normalized.includes('cannot find context with specified id') ||
      normalized.includes('context was destroyed') ||
      normalized.includes('detached frame')
    );
  }

  extractZipCodes(text = '') {
    const matches = String(text || '').match(/\b\d{5}(?:-\d{4})?\b/g) || [];
    return [...new Set(matches.map((zip) => zip.slice(0, 5)))];
  }

  isAcceptableZip(zip) {
    const normalizedZip = normalizeZipCode(zip);
    if (!normalizedZip) {
      return false;
    }

    return (
      this.acceptableZipCodes.includes(normalizedZip) ||
      this.acceptableZipPrefixes.some((prefix) => normalizedZip.startsWith(prefix))
    );
  }

  findAcceptedZip(text = '') {
    return this.findAcceptedZipFromCodes(this.extractZipCodes(text));
  }

  findAcceptedZipFromCodes(zipCodes = []) {
    return zipCodes.find((zip) => this.isAcceptableZip(zip)) || null;
  }

  getAcceptableZipDescription() {
    return (
      `prefixes=${this.acceptableZipPrefixes.join(',')} ` +
      `exact=${this.acceptableZipCodes.join(',')}`
    );
  }

  recordConfirmedZip(locationState = {}) {
    const confirmedZip = locationState.acceptedZipCode || null;
    if (confirmedZip) {
      this.confirmedZipCode = confirmedZip;
    }
    return confirmedZip;
  }

  isBlankPageDiagnostics(diagnostics = {}) {
    const title = String(diagnostics.title || '').trim();
    const bodySnippet = String(diagnostics.bodySnippet || '').trim();
    return !title && !bodySnippet;
  }

  async getQuickPageState(page, fallback = {}) {
    const status = fallback.status ?? null;

    return page
      .evaluate((currentStatus) => {
        const text = document.body?.innerText || '';
        const normalizedText = text.replace(/\s+/g, ' ').trim();
        const normalized = normalizedText.toLowerCase();
        return {
          status: currentStatus,
          finalUrl: window.location.href,
          title: document.title || '',
          readyState: document.readyState || '',
          blocked:
            normalized.includes('captcha') ||
            normalized.includes('enter the characters you see below') ||
            normalized.includes('sorry, we just need to make sure') ||
            normalized.includes('access denied') ||
            normalized.includes('automated access') ||
            normalized.includes('robot check'),
          verification:
            normalized.includes('captcha') ||
            normalized.includes('robot check') ||
            normalized.includes('enter the characters you see below') ||
            normalized.includes('sorry, we just need to make sure'),
          signInRequired:
            normalized.includes('sign in to see your addresses') ||
            normalized.includes('please sign in') ||
            normalized.includes('sign in for the best experience'),
          noResults:
            normalized.includes('no results') ||
            normalized.includes('did not match') ||
            normalized.includes('try checking your spelling'),
          bodyLength: normalizedText.length,
          readError: null,
          executionContextUnstable: false,
          bodySnippet: normalizedText.slice(0, 300)
        };
      }, status)
      .then((pageData) => ({
        ...pageData,
        navigationError: fallback.navigationError || null
      }))
      .catch((error) => ({
        status,
        finalUrl: page.url(),
        title: '',
        readyState: 'unavailable',
        blocked: false,
        verification: false,
        signInRequired: false,
        noResults: false,
        bodyLength: 0,
        readError: error.message,
        executionContextUnstable: this.isTransientExecutionErrorMessage(error.message),
        bodySnippet: `Unable to read page body: ${error.message}`,
        navigationError: fallback.navigationError || null
      }));
  }

  async getPageDiagnostics(page, response, fallback = {}) {
    const responseStatus =
      response && typeof response.status === 'function' ? response.status() : null;
    const status = responseStatus ?? fallback.status ?? null;

    const pageData = await page
      .evaluate((currentStatus) => {
        const text = document.body?.innerText || '';
        const normalized = text.toLowerCase();
        const html = document.documentElement?.outerHTML || '';
        return {
          status: currentStatus,
          finalUrl: window.location.href,
          title: document.title || '',
          readyState: document.readyState || '',
          blocked:
            normalized.includes('captcha') ||
            normalized.includes('enter the characters you see below') ||
            normalized.includes('sorry, we just need to make sure') ||
            normalized.includes('access denied') ||
            normalized.includes('automated access') ||
            normalized.includes('robot check'),
          verification:
            normalized.includes('captcha') ||
            normalized.includes('robot check') ||
            normalized.includes('enter the characters you see below') ||
            normalized.includes('sorry, we just need to make sure'),
          signInRequired:
            normalized.includes('sign in to see your addresses') ||
            normalized.includes('please sign in') ||
            normalized.includes('sign in for the best experience'),
          noResults:
            normalized.includes('no results') ||
            normalized.includes('did not match') ||
            normalized.includes('try checking your spelling'),
          bodyLength: text.replace(/\s+/g, ' ').trim().length,
          readError: null,
          executionContextUnstable: false,
          bodySnippet: text.replace(/\s+/g, ' ').trim().slice(0, 300),
          htmlSnippet: html.replace(/\s+/g, ' ').trim().slice(0, 300)
        };
      }, status)
      .catch((error) => ({
        status,
        finalUrl: page.url(),
        title: '',
        readyState: 'unavailable',
        blocked: false,
        verification: false,
        signInRequired: false,
        noResults: false,
        bodyLength: 0,
        readError: error.message,
        executionContextUnstable: this.isTransientExecutionErrorMessage(error.message),
        bodySnippet: `Unable to read page body: ${error.message}`,
        htmlSnippet: ''
      }));

    return {
      ...pageData,
      cookieCount: fallback.cookieCount ?? null,
      navigationError: fallback.navigationError || null
    };
  }

  buildNavigationState(diagnostics, locationState = {}, extras = {}) {
    return {
      ...diagnostics,
      ...locationState,
      ...extras,
      blankPage: this.isBlankPageDiagnostics(diagnostics),
      bouncedToStorefront: this.isAmazonFreshStorefrontUrl(diagnostics.finalUrl),
      urlMatchesSearch: this.isAmazonFreshSearchUrl(diagnostics.finalUrl),
      zipConfirmed: this.isLocationConfirmed(locationState),
      confirmedZipCode: this.confirmedZipCode,
      acceptableZipRules: this.getAcceptableZipDescription()
    };
  }

  async inspectPageState(page, response = null, fallback = {}, extras = {}) {
    const responseStatus =
      response && typeof response.status === 'function' ? response.status() : null;
    const diagnostics = await this.getQuickPageState(page, {
      status: responseStatus ?? fallback.status ?? null,
      navigationError: fallback.navigationError
    });
    const locationState = await this.getLocationConfirmationState(page);
    return this.buildNavigationState(diagnostics, locationState, extras);
  }

  async collectFailureState(page, response = null, fallback = {}, extras = {}) {
    const withCookies =
      fallback.cookieCount === undefined
        ? { ...fallback, cookieCount: await getCookieCount(page) }
        : fallback;
    const diagnostics = await this.getStablePageDiagnostics(page, response, withCookies);
    const locationState = await this.getLocationConfirmationState(page);
    return this.buildNavigationState(diagnostics, locationState, extras);
  }

  logNavigationDiagnostics(stage, diagnostics) {
    console.log(`${stage} diagnostics`, {
      provider: this.provider,
      status: diagnostics.status,
      finalUrl: diagnostics.finalUrl,
      title: diagnostics.title,
      readyState: diagnostics.readyState,
      blocked: diagnostics.blocked,
      verification: diagnostics.verification,
      signInRequired: diagnostics.signInRequired,
      noResults: diagnostics.noResults,
      bodyLength: diagnostics.bodyLength,
      readError: diagnostics.readError,
      executionContextUnstable: diagnostics.executionContextUnstable,
      blankPage: diagnostics.blankPage,
      selectorFound: diagnostics.selectorFound,
      bouncedToStorefront: diagnostics.bouncedToStorefront,
      urlMatchesSearch: diagnostics.urlMatchesSearch,
      zipConfirmed: diagnostics.zipConfirmed,
      acceptedZipCode: diagnostics.acceptedZipCode,
      confirmedZipCode: diagnostics.confirmedZipCode,
      acceptableZipRules: diagnostics.acceptableZipRules,
      locationHasZip: diagnostics.locationHasZip,
      bodyHasZip: diagnostics.bodyHasZip,
      locationZipCodes: diagnostics.locationZipCodes,
      bodyZipCodes: diagnostics.bodyZipCodes,
      popoverOpen: diagnostics.popoverOpen,
      retrying: diagnostics.retrying,
      retryReason: diagnostics.retryReason,
      attempt: diagnostics.attempt,
      navigationError: diagnostics.navigationError,
      cookieCount: diagnostics.cookieCount,
      locationText: diagnostics.locationText,
      bodySnippet: diagnostics.bodySnippet
    });
  }

  async hasProductResults(page) {
    try {
      return Boolean(await page.$(PRODUCT_LINK_SELECTOR));
    } catch (error) {
      return false;
    }
  }

  async maybeHandleManualChallenge(page, diagnostics, stage) {
    return maybeHandleManualChallenge({
      page,
      diagnostics,
      stage,
      storeName: this.storeName,
      manualChallenge: this.manualChallenge,
      getDiagnostics: this.getPageDiagnostics.bind(this),
      logDiagnostics: this.logNavigationDiagnostics.bind(this),
      hasResults: this.hasProductResults.bind(this)
    });
  }

  async getVisibleHandle(page, selector) {
    const handles = await page.$$(selector);
    for (const handle of handles) {
      const visible = await handle.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      });

      if (visible) {
        return handle;
      }

      await handle.dispose();
    }
    return null;
  }

  async waitForVisibleHandle(page, selector, timeout = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const handle = await this.getVisibleHandle(page, selector);
      if (handle) {
        return handle;
      }
      await delay(FAST_POLL_INTERVAL_MS);
    }
    return null;
  }

  async waitForUsefulSignal(page, timeout = 8000, options = {}) {
    const { waitForResults = false, waitForLocation = false } = options;
    return page
      .waitForFunction(
        (
          {
            waitForResultSignals,
            waitForLocationSignals,
            productLinkSelector,
            locationSelector,
            zipInputSelector,
            zipDoneSelector
          }
        ) => {
          const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            if (!el) {
              return false;
            }
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            );
          };

          const body = document.body;
          const bodyText = clean(body?.innerText || '');
          const normalized = bodyText.toLowerCase();
          const hasBodyContent = Boolean(body) && (bodyText.length > 0 || body.children.length > 0);
          const hasResultSignals =
            waitForResultSignals &&
            (Boolean(document.querySelector(productLinkSelector)) ||
              normalized.includes('no results') ||
              normalized.includes('did not match') ||
              normalized.includes('try checking your spelling'));
          const hasLocationSignals =
            waitForLocationSignals &&
            ([...document.querySelectorAll(locationSelector)].some((el) =>
              /\b\d{5}(?:-\d{4})?\b/.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label')))
            ) ||
              Boolean(document.querySelector(zipInputSelector)) ||
              [...document.querySelectorAll(zipDoneSelector)].some((el) => isVisible(el)));

          return hasResultSignals || hasLocationSignals || (document.readyState === 'complete' && hasBodyContent);
        },
        { timeout },
        {
          waitForResultSignals: waitForResults,
          waitForLocationSignals: waitForLocation,
          productLinkSelector: PRODUCT_LINK_SELECTOR,
          locationSelector: LOCATION_STATUS_SELECTOR,
          zipInputSelector: ZIP_INPUT_SELECTOR,
          zipDoneSelector: ZIP_DONE_SELECTOR
        }
      )
      .then(() => true)
      .catch(() => false);
  }

  async waitForPageSettled(page, timeout = 15000, options = {}) {
    const { waitForResults = false, waitForLocation = false, includeIdleDelay = false } = options;
    const usefulSignalTimeout = Math.min(timeout, 8000);
    const waiters = [
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout })
        .then(() => 'navigation')
        .catch(() => null),
      delay(timeout).then(() => null)
    ];

    if (waitForResults || waitForLocation) {
      waiters.push(
        this.waitForUsefulSignal(page, usefulSignalTimeout, {
          waitForResults,
          waitForLocation
        }).then((found) => (found ? 'useful-signal' : null))
      );
    } else {
      waiters.push(
        page
          .waitForFunction(() => document.readyState !== 'loading', { timeout })
          .then(() => 'dom-ready')
          .catch(() => null)
      );
    }

    await Promise.race(waiters);

    await page.waitForSelector('body', { timeout: Math.min(timeout, 5000) }).catch(() => null);

    if (includeIdleDelay) {
      await humanDelay(900, 1800);
    }
  }

  async getStablePageDiagnostics(page, response = null, fallback = {}, attempts = 4) {
    let diagnostics = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      diagnostics = await this.getPageDiagnostics(page, response, fallback);
      diagnostics.blankPage = this.isBlankPageDiagnostics(diagnostics);
      if (!diagnostics.executionContextUnstable && !diagnostics.blankPage) {
        return diagnostics;
      }
      await this.waitForPageSettled(page, 5000);
    }
    if (diagnostics) {
      diagnostics.blankPage = this.isBlankPageDiagnostics(diagnostics);
    }
    return diagnostics;
  }

  async getLocationConfirmationState(page) {
    const state = await page
      .evaluate(
        ({ locationSelector, zipInputSelector, zipDoneSelector }) => {
          const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const extractZipCodes = (text) => [
            ...new Set(((text || '').match(/\b\d{5}(?:-\d{4})?\b/g) || []).map((zip) => zip.slice(0, 5)))
          ];
          const isVisible = (el) => {
            if (!el) {
              return false;
            }
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            );
          };
          const locationTexts = [...document.querySelectorAll(locationSelector)]
            .map((el) => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || ''))
            .filter(Boolean);
          const bodyText = clean(document.body?.innerText || '');
          const zipInput = document.querySelector(zipInputSelector);
          const zipInputValue = clean(
            zipInput?.value || zipInput?.getAttribute('value') || zipInput?.textContent || ''
          );
          const zipInputVisible = Boolean(zipInput && isVisible(zipInput));
          const doneButtonVisible = [...document.querySelectorAll(zipDoneSelector)].some((el) =>
            isVisible(el)
          );

          return {
            locationText: locationTexts.slice(0, 6).join(' | ').slice(0, 300),
            locationZipCodes: [...new Set(locationTexts.flatMap((text) => extractZipCodes(text)))],
            bodyZipCodes: extractZipCodes(bodyText),
            zipInputValue,
            popoverOpen: zipInputVisible || doneButtonVisible
          };
        },
        {
          locationSelector: LOCATION_STATUS_SELECTOR,
          zipInputSelector: ZIP_INPUT_SELECTOR,
          zipDoneSelector: ZIP_DONE_SELECTOR
        }
      )
      .catch((error) => ({
        locationText: '',
        locationZipCodes: [],
        bodyZipCodes: [],
        locationHasZip: false,
        bodyHasZip: false,
        zipInputValue: '',
        zipInputHasZip: false,
        popoverOpen: false,
        readError: error.message,
        executionContextUnstable: this.isTransientExecutionErrorMessage(error.message)
      }));

    const locationAcceptedZip = this.findAcceptedZipFromCodes(state.locationZipCodes || []);
    const bodyAcceptedZip = this.findAcceptedZipFromCodes(state.bodyZipCodes || []);
    const acceptedZipCode = !state.popoverOpen ? locationAcceptedZip || bodyAcceptedZip : null;

    return {
      ...state,
      acceptedZipCode,
      confirmedZipCode: this.confirmedZipCode,
      acceptableZipRules: this.getAcceptableZipDescription(),
      locationHasZip: Boolean(locationAcceptedZip),
      bodyHasZip: Boolean(bodyAcceptedZip),
      zipInputHasZip: String(state.zipInputValue || '').includes(this.zipCode)
    };
  }

  isLocationConfirmed(locationState = {}) {
    return Boolean(locationState.acceptedZipCode);
  }

  shouldTreatSignInAsFatal(diagnostics = {}) {
    return Boolean(diagnostics.signInRequired && !diagnostics.popoverOpen && !diagnostics.zipConfirmed);
  }

  async shouldReusePreparedSession(page) {
    if (!this.sessionReady || !page || page.isClosed()) {
      return false;
    }

    const quickState = await this.getQuickPageState(page);
    if (
      quickState.blocked ||
      quickState.verification ||
      quickState.signInRequired ||
      quickState.executionContextUnstable
    ) {
      return false;
    }

    const locationState = await this.getLocationConfirmationState(page);
    const state = this.buildNavigationState(quickState, locationState);

    return state.zipConfirmed && (state.urlMatchesSearch || state.bouncedToStorefront);
  }

  async prepareSession(options = {}) {
    const { force = false } = options;
    const page = await this.getSessionPage();

    if (!force && (await this.shouldReusePreparedSession(page).catch(() => false))) {
      const locationState = await this.getLocationConfirmationState(page);
      const confirmedZip = this.markSessionReady(locationState);
      console.log(`[OK] Reusing Amazon Fresh session at ZIP ${confirmedZip}`);
      return;
    }

    this.sessionReady = false;
    await this.establishFreshSession(page);

    const locationState = await this.getLocationConfirmationState(page);
    if (!this.isLocationConfirmed(locationState)) {
      const diagnostics = await this.collectFailureState(page);
      throw new Error(
        `Amazon Fresh session did not finish with an acceptable ZIP. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
          `body="${diagnostics.bodySnippet}" location="${diagnostics.locationText || 'n/a'}"`
      );
    }

    const confirmedZip = this.markSessionReady(locationState);
    console.log(`[OK] Amazon Fresh session prepared at ZIP ${confirmedZip}`);
  }

  async waitForProductResults(page, primaryTimeout = 10000, secondaryTimeout = 6000) {
    await this.waitForPageSettled(page, primaryTimeout, { waitForResults: true });

    if (await this.hasProductResults(page)) {
      return true;
    }

    const quickState = await this.getQuickPageState(page).catch(() => null);
    if (quickState?.noResults) {
      return false;
    }

    try {
      await page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout: secondaryTimeout });
      return true;
    } catch (error) {
      return false;
    }
  }

  async confirmDeliveryLocation(page) {
    let lastDiagnostics = null;

    for (let attempt = 1; attempt <= ZIP_CONFIRMATION_RETRY_LIMIT; attempt++) {
      if (attempt > 1) {
        await this.waitForPageSettled(page, 7000, { waitForLocation: true, includeIdleDelay: true });
      }

      const diagnostics = await this.getStablePageDiagnostics(page);
      const locationState = await this.getLocationConfirmationState(page);
      const enrichedDiagnostics = {
        ...diagnostics,
        ...locationState,
        attempt,
        blankPage: this.isBlankPageDiagnostics(diagnostics),
        zipConfirmed: this.isLocationConfirmed(locationState)
      };

      this.logNavigationDiagnostics('Amazon Fresh ZIP confirmation', enrichedDiagnostics);

      let finalDiagnostics = enrichedDiagnostics;
      if (finalDiagnostics.blocked || finalDiagnostics.verification) {
        finalDiagnostics = await this.maybeHandleManualChallenge(
          page,
          finalDiagnostics,
          'Amazon Fresh location'
        );
        const refreshedLocationState = await this.getLocationConfirmationState(page);
        finalDiagnostics = {
          ...finalDiagnostics,
          ...refreshedLocationState,
          attempt,
          blankPage: this.isBlankPageDiagnostics(finalDiagnostics),
          zipConfirmed: this.isLocationConfirmed(refreshedLocationState)
        };
        this.logNavigationDiagnostics('Amazon Fresh ZIP confirmation after challenge', finalDiagnostics);
      }

      if (finalDiagnostics.blocked || finalDiagnostics.verification) {
        throw new Error(
          `${this.getProviderSpecificBlockHint()} Location setup was blocked. ` +
            `finalUrl=${finalDiagnostics.finalUrl} title="${finalDiagnostics.title}" ` +
            `body="${finalDiagnostics.bodySnippet}" location="${finalDiagnostics.locationText || 'n/a'}"`
        );
      }

      if (this.shouldTreatSignInAsFatal(finalDiagnostics)) {
        throw new Error(
          `Amazon Fresh appears to require sign-in or delivery eligibility for preferred ZIP ${this.zipCode}. ` +
            `finalUrl=${finalDiagnostics.finalUrl} title="${finalDiagnostics.title}" ` +
            `body="${finalDiagnostics.bodySnippet}" location="${finalDiagnostics.locationText || 'n/a'}"`
        );
      }

      if (finalDiagnostics.zipConfirmed) {
        const confirmedZip = this.markSessionReady(finalDiagnostics);
        console.log(`[OK] Amazon Fresh location accepted at ZIP ${confirmedZip || 'unknown'}`);
        return finalDiagnostics;
      }

      lastDiagnostics = finalDiagnostics;
      const retryReason =
        finalDiagnostics.executionContextUnstable
          ? 'execution-context-unstable'
          : finalDiagnostics.blankPage
            ? 'blank-page'
            : finalDiagnostics.signInRequired && finalDiagnostics.popoverOpen
              ? 'sign-in-copy-inside-location-popover'
              : finalDiagnostics.signInRequired
                ? 'sign-in-required'
            : finalDiagnostics.popoverOpen
              ? 'location-popover-still-open'
              : finalDiagnostics.zipInputHasZip
                ? 'zip-entered-but-not-yet-confirmed'
                : null;

      if (!retryReason || attempt === ZIP_CONFIRMATION_RETRY_LIMIT) {
        break;
      }

      this.logNavigationDiagnostics('Amazon Fresh ZIP confirmation retrying', {
        ...finalDiagnostics,
        retrying: true,
        retryReason
      });
      await humanDelay(700, 1400);
    }

    throw new Error(
      `Amazon Fresh location did not confirm an acceptable Queens ZIP after submitting preferred ZIP ${this.zipCode}. ` +
        `acceptable=${this.getAcceptableZipDescription()} ` +
        `finalUrl=${lastDiagnostics?.finalUrl || page.url()} title="${lastDiagnostics?.title || ''}" ` +
        `detectedZips=${[
          ...(lastDiagnostics?.locationZipCodes || []),
          ...(lastDiagnostics?.bodyZipCodes || [])
        ].join(',') || 'none'} ` +
        `body="${lastDiagnostics?.bodySnippet || ''}" location="${lastDiagnostics?.locationText || 'n/a'}"`
    );
  }

  async establishFreshSession(page) {
    console.log(`[>] Amazon Fresh storefront: ${AMAZON_FRESH_URL}`);
    const response = await page.goto(AMAZON_FRESH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await this.waitForPageSettled(page, 9000, { waitForLocation: true });

    let diagnostics = await this.inspectPageState(page, response);
    this.logNavigationDiagnostics('Amazon Fresh storefront', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(
      page,
      diagnostics,
      'Amazon Fresh storefront'
    );

    const refreshedLocationState = await this.getLocationConfirmationState(page);
    diagnostics = this.buildNavigationState(diagnostics, refreshedLocationState);

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Storefront failed. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    await this.setDeliveryLocation(page);
    return diagnostics;
  }

  shouldUseFastZipEntry() {
    return this.headless || this.provider === 'brightdata';
  }

  async fillZipInput(page, zipInput) {
    await zipInput.click({ clickCount: 3 }).catch(() => null);

    if (!this.shouldUseFastZipEntry()) {
      await page.keyboard.press('Backspace');
      await zipInput.type(this.zipCode, { delay: 60 });
      await humanDelay(250, 500);
      return;
    }

    await zipInput.evaluate((input, zipCode) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (setter) {
        setter.call(input, '');
        setter.call(input, zipCode);
      } else {
        input.value = zipCode;
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, this.zipCode);

    await delay(FAST_POLL_INTERVAL_MS);
  }

  async getFocusedElementSummary(page) {
    return page
      .evaluate(() => {
        const el = document.activeElement;
        if (!el) {
          return null;
        }

        const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
        return {
          tagName: el.tagName || '',
          id: el.id || '',
          name: el.getAttribute('name') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: clean(el.innerText || el.textContent || ''),
          value: clean(el.value || ''),
          type: el.getAttribute('type') || ''
        };
      })
      .catch(() => null);
  }

  isDoneButtonSummary(summary = {}) {
    const haystack = [
      summary.tagName,
      summary.id,
      summary.name,
      summary.ariaLabel,
      summary.text,
      summary.value,
      summary.type
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes('done') || haystack.includes('confirmclose') || haystack.includes('glowdonebutton');
  }

  async dismissLocationPopoverWithKeyboard(page) {
    console.log('[>] Amazon Fresh ZIP done fallback via four keyboard tabs');

    for (let attempt = 0; attempt < 4; attempt++) {
      await page.keyboard.press('Tab');
      await delay(150);
    }

    const focused = await this.getFocusedElementSummary(page);
    if (!this.isDoneButtonSummary(focused)) {
      return false;
    }

    console.log('[>] Amazon Fresh ZIP done focused via keyboard');
    await page.keyboard.press('Enter');
    await this.waitForPageSettled(page, 7000, { waitForLocation: true });
    return true;
  }

  async setDeliveryLocation(page) {
    const currentLocationState = await this.getLocationConfirmationState(page);
    if (this.isLocationConfirmed(currentLocationState)) {
      const confirmedZip = this.markSessionReady(currentLocationState);
      console.log(`[OK] Amazon Fresh location already acceptable at ZIP ${confirmedZip}`);
      return;
    }

    console.log(
      `[>] Setting Amazon Fresh delivery location to preferred ZIP ${this.zipCode} ` +
        `(${this.getAcceptableZipDescription()})`
    );

    const locationLink = await this.getVisibleHandle(page, LOCATION_LINK_SELECTOR);
    if (!locationLink) {
      const diagnostics = await this.collectFailureState(page);
      throw new Error(
        `Amazon Fresh location control was not found. finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    await locationLink.click();
    console.log('[>] Amazon Fresh location modal opened');
    await this.waitForPageSettled(page, 4000, { waitForLocation: true });

    const zipInput = await this.waitForVisibleHandle(page, ZIP_INPUT_SELECTOR, 15000);
    if (!zipInput) {
      throw new Error('Amazon Fresh visible ZIP input was not found after opening location popover.');
    }

    await this.fillZipInput(page, zipInput);

    const updateButton = await this.getVisibleHandle(page, ZIP_UPDATE_SELECTOR);
    console.log('[>] Amazon Fresh ZIP submit');
    if (updateButton) {
      await updateButton.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await delay(2000);
    await this.waitForPageSettled(page, 9000, { waitForLocation: true });

    const doneButton = await this.getVisibleHandle(page, ZIP_DONE_SELECTOR);
    if (doneButton) {
      await doneButton.click().catch(() => null);
      await this.waitForPageSettled(page, 7000, { waitForLocation: true });
    }

    const afterDoneState = await this.getLocationConfirmationState(page);
    if (afterDoneState.popoverOpen) {
      const dismissedWithKeyboard = await this.dismissLocationPopoverWithKeyboard(page);
      if (dismissedWithKeyboard) {
        await this.waitForPageSettled(page, 5000, { waitForLocation: true });
      }
    }

    await this.confirmDeliveryLocation(page);
  }

  async navigateToSearch(page, query) {
    const searchUrl =
      `https://www.amazon.com/s?i=amazonfresh&k=${encodeURIComponent(query)}` +
      `&almBrandId=QW1hem9uIEZyZXNo`;
    console.log(`[>] Amazon Fresh search: ${searchUrl}`);

    let lastDiagnostics = null;

    for (let attempt = 1; attempt <= SEARCH_NAVIGATION_RETRY_LIMIT; attempt++) {
      console.log(
        `[>] Amazon Fresh search navigation attempt ${attempt}/${SEARCH_NAVIGATION_RETRY_LIMIT}`
      );

      let navigationError = null;
      const response = await page
        .goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout
        })
        .catch((error) => {
          navigationError = error.message;
          return null;
        });

      await this.waitForPageSettled(page, attempt === 1 ? 9000 : 14000, { waitForResults: true });

      const selectorFound = await this.waitForProductResults(
        page,
        attempt === 1 ? 7000 : 11000,
        attempt === 1 ? 4000 : 7000
      );

      let diagnostics = await this.inspectPageState(
        page,
        response,
        { navigationError },
        { attempt, selectorFound }
      );
      this.logNavigationDiagnostics('Amazon Fresh search', diagnostics);

      const needsManualChallenge = diagnostics.blocked || diagnostics.verification;
      if (needsManualChallenge) {
        diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Amazon Fresh search');
        const refreshedLocationState = await this.getLocationConfirmationState(page);
        diagnostics = this.buildNavigationState(diagnostics, refreshedLocationState, {
          attempt,
          selectorFound: diagnostics.selectorFound || (await this.hasProductResults(page))
        });
        this.logNavigationDiagnostics('Amazon Fresh search after challenge', diagnostics);
      }

      if (diagnostics.zipConfirmed) {
        this.markSessionReady(diagnostics);
      }

      if (diagnostics.blocked || diagnostics.verification) {
        const failureState = await this.collectFailureState(
          page,
          response,
          { navigationError },
          { attempt, selectorFound }
        );
        throw new Error(
          `${this.getProviderSpecificBlockHint()} finalUrl=${failureState.finalUrl} ` +
            `title="${failureState.title}" body="${failureState.bodySnippet}" ` +
            `html="${failureState.htmlSnippet}"`
        );
      }

      if (this.shouldTreatSignInAsFatal(diagnostics)) {
        await this.invalidateSession('sign-in-required', { closePage: false });
        throw new Error(
          `Amazon Fresh appears to require sign-in or delivery eligibility for preferred ZIP ${this.zipCode}. ` +
            `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
            `body="${diagnostics.bodySnippet}"`
        );
      }

      if (diagnostics.selectorFound || diagnostics.noResults) {
        if (diagnostics.zipConfirmed) {
          this.markSessionReady(diagnostics);
        }
        return { diagnostics, searchUrl };
      }

      if (diagnostics.status && diagnostics.status >= 400) {
        const failureState = await this.collectFailureState(
          page,
          response,
          { navigationError },
          { attempt, selectorFound }
        );
        throw new Error(
          `Amazon Fresh returned HTTP ${failureState.status} for ${searchUrl}. ` +
            `${this.getProviderSpecificBlockHint()} finalUrl=${failureState.finalUrl} ` +
            `title="${failureState.title}" body="${failureState.bodySnippet}" ` +
            `html="${failureState.htmlSnippet}"`
        );
      }

      lastDiagnostics = diagnostics;
      const navigationTimedOut = String(diagnostics.navigationError || '')
        .toLowerCase()
        .includes('timeout');
      const retryReason =
        diagnostics.executionContextUnstable
          ? 'execution-context-unstable'
          : diagnostics.blankPage
            ? 'blank-page'
            : diagnostics.bouncedToStorefront
              ? 'storefront-bounce'
              : !diagnostics.zipConfirmed
                ? 'zip-confirmation-lost'
                : navigationTimedOut && diagnostics.urlMatchesSearch
                  ? 'slow-search-render'
                  : null;

      if (!retryReason || attempt === SEARCH_NAVIGATION_RETRY_LIMIT) {
        break;
      }

      const retryDiagnostics = await this.collectFailureState(
        page,
        response,
        { navigationError },
        {
          attempt,
          selectorFound,
          retrying: true,
          retryReason
        }
      );
      this.logNavigationDiagnostics('Amazon Fresh search retrying', retryDiagnostics);
      lastDiagnostics = retryDiagnostics;

      if (retryDiagnostics.bouncedToStorefront || !retryDiagnostics.zipConfirmed) {
        console.log('[!] Amazon Fresh session needs recovery before retrying search');
        await this.invalidateSession(retryReason, { closePage: false });
        await this.prepareSession({ force: true });
      } else {
        await humanDelay(400, 900);
      }
    }

    throw new Error(
      `Timed out waiting for Amazon Fresh search results on ${searchUrl}. ` +
        `finalUrl=${lastDiagnostics?.finalUrl || page.url()} title="${lastDiagnostics?.title || ''}" ` +
        `bouncedToStorefront=${lastDiagnostics?.bouncedToStorefront ? 'yes' : 'no'} ` +
        `zipConfirmed=${lastDiagnostics?.zipConfirmed ? 'yes' : 'no'} ` +
        `confirmedZip=${this.confirmedZipCode || 'none'} ` +
        `navigationError=${lastDiagnostics?.navigationError || 'none'} ` +
        `body="${lastDiagnostics?.bodySnippet || ''}"`
    );
  }

  async extractProducts(page, limit = 30) {
    const seenUrls = new Set();

    const pageRaw = await page.evaluate((productSelector) => {
      const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
      const parsePrice = (text) => {
        const match = (text || '').match(/\$([\d,]+(?:\.\d{2})?)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : null;
      };

      const cards = [...document.querySelectorAll(productSelector)];
      return cards.map((card) => {
        const asin = card.getAttribute('data-asin') || 'N/A';
        const link =
          card.querySelector('a[href*="/dp/"]') || card.querySelector('a[href*="/gp/product/"]');
        const titleEl =
          card.querySelector('h2 span') ||
          card.querySelector('[data-cy="title-recipe-title"]') ||
          card.querySelector('.a-size-base-plus');
        const image = card.querySelector('img.s-image, img')?.src || null;
        const priceText =
          clean(card.querySelector('.a-price .a-offscreen')?.textContent) ||
          clean(card.querySelector('[data-a-color="base"] .a-offscreen')?.textContent) ||
          null;
        const ratingLabel =
          card.querySelector('[aria-label*="out of 5 stars"]')?.getAttribute('aria-label') ||
          card.querySelector('.a-icon-alt')?.textContent ||
          '';
        const reviewsText =
          card.querySelector('a[href*="#customerReviews"] span')?.textContent ||
          card.querySelector('[aria-label*="ratings"]')?.getAttribute('aria-label') ||
          '';
        const ratingMatch = ratingLabel.match(/([\d.]+)\s*out of\s*5/i);
        const reviewsMatch = reviewsText.match(/([\d,]+)/);

        return {
          name: clean(titleEl?.textContent || link?.textContent),
          price: priceText,
          extractedPrice: parsePrice(priceText),
          rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
          reviews: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null,
          url: link ? new URL(link.getAttribute('href'), window.location.origin).href.split('?')[0] : null,
          thumbnail: image,
          productId: asin
        };
      });
    }, PRODUCT_SELECTOR);

    return pageRaw
      .filter((product) => product.name && product.name !== 'N/A' && product.url)
      .filter((product) => {
        if (seenUrls.has(product.url)) {
          return false;
        }
        seenUrls.add(product.url);
        return true;
      })
      .slice(0, limit)
      .map((product, index) => ({
        position: index + 1,
        title: product.name,
        product_id: product.productId,
        product_link: product.url,
        source: 'Amazon Fresh',
        source_icon: 'https://www.amazon.com/favicon.ico',
        price: product.price,
        extracted_price: product.extractedPrice,
        rating: product.rating,
        reviews: product.reviews,
        extensions: [`zip:${this.confirmedZipCode || this.sessionZip || this.zipCode}`],
        thumbnail: product.thumbnail,
        primary_offer:
          product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
        seller_name: 'Amazon Fresh'
      }));
  }

  async search(query, options = {}) {
    const { limit = 30, skipConfigLog = false } = options;

    try {
      if (!skipConfigLog) {
        this.logSearchConfig();
      }

      await this.prepareSession();
      const page = await this.getSessionPage();
      await this.navigateToSearch(page, query);

      const products = await this.extractProducts(page, limit);
      console.log(`[OK] Done - ${products.length} total Amazon Fresh products`);
      return products;
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Amazon Fresh search Bright Data session');
      await this.invalidateSession(`search-failed:${query}`, { closePage: true, log: false });
      throw new Error(`Amazon Fresh search failed for "${query}": ${error.message}`);
    }
  }

  async searchBatch(queries, options = {}) {
    const { limit = 30, continueOnError = false } = options;
    const normalizedQueries = Array.isArray(queries)
      ? queries.map((query) => String(query || '').trim()).filter(Boolean)
      : [];

    if (!normalizedQueries.length) {
      return [];
    }

    this.logSearchConfig();

    try {
      await this.prepareSession();
    } catch (error) {
      if (!continueOnError) {
        throw error;
      }

      return normalizedQueries.map((query) => ({
        query,
        products: [],
        error: error.message
      }));
    }

    const results = [];
    for (const query of normalizedQueries) {
      try {
        const products = await this.search(query, { limit, skipConfigLog: true });
        results.push({ query, products, error: null });
      } catch (error) {
        results.push({ query, products: [], error: error.message });
        if (!continueOnError) {
          throw error;
        }
      }
    }

    return results;
  }

  async getProductDetails(productId) {
    let page;
    try {
      page = await this.getPage();
      const url = `https://www.amazon.com/dp/${productId}`;
      console.log(`[>] Fetching Amazon Fresh product details for ID: ${productId}`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });
      await this.waitForPageSettled(page, 9000);

      const diagnostics = await this.collectFailureState(page, response);
      this.logNavigationDiagnostics('Amazon Fresh product', diagnostics);

      if (diagnostics.status && diagnostics.status >= 400) {
        throw new Error(`Amazon Fresh returned HTTP ${diagnostics.status} for ${url}`);
      }

      if (diagnostics.blocked || diagnostics.verification) {
        throw new Error(`${this.getProviderSpecificBlockHint()} Product navigation was blocked.`);
      }

      return page.evaluate(() => {
        const text = (selector) => document.querySelector(selector)?.textContent?.trim() || 'N/A';
        return {
          title: text('#productTitle, h1'),
          price: text('.a-price .a-offscreen, #corePrice_feature_div .a-offscreen'),
          description: text('#feature-bullets, #productDescription'),
          rating: text('.a-icon-alt, [data-hook="rating-out-of-text"]'),
          reviews: text('#acrCustomerReviewText')
        };
      });
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Amazon Fresh product Bright Data session');
      throw new Error(`Failed to get Amazon Fresh product details for ${productId}: ${error.message}`);
    } finally {
      if (page) {
        await page.close().catch(() => null);
      }
    }
  }

  async searchWithFilters(query, filters = {}, options = {}) {
    const products = await this.search(query, options);

    return products.filter((product) => {
      if (filters.minRating) {
        const rating = parseFloat(product.rating || 0);
        if (rating < filters.minRating) return false;
      }

      if (filters.priceMin || filters.priceMax) {
        const price = product.extracted_price || 0;
        if (filters.priceMin && price < filters.priceMin) return false;
        if (filters.priceMax && price > filters.priceMax) return false;
      }

      return true;
    });
  }
}

module.exports = AmazonFreshScraper;
