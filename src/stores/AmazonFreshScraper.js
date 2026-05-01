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
      await humanDelay(200, 400);
    }
    return null;
  }

  async waitForPageSettled(page, timeout = 15000) {
    await Promise.race([
      page
        .waitForNavigation({ waitUntil: 'domcontentloaded', timeout })
        .catch(() => null),
      page
        .waitForFunction(() => document.readyState !== 'loading', { timeout })
        .catch(() => null),
      new Promise((resolve) => setTimeout(resolve, timeout))
    ]);
    await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
    await page
      .waitForFunction(
        () => {
          const body = document.body;
          if (!body) {
            return false;
          }
          const text = (body.innerText || '').trim();
          return document.readyState === 'complete' || text.length > 0 || body.children.length > 0;
        },
        { timeout: Math.min(timeout, 8000) }
      )
      .catch(() => null);
    await humanDelay(1000, 2000);
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

  async getStableBodyText(page, attempts = 4) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => null);
      if (typeof text === 'string' && text.trim()) {
        return text;
      }
      await this.waitForPageSettled(page, 5000);
    }
    return '';
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
    const acceptedZipCode = locationAcceptedZip || (!state.popoverOpen ? bodyAcceptedZip : null);

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

  async waitForProductResults(page, primaryTimeout = 16000, secondaryTimeout = 10000) {
    try {
      await page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout: primaryTimeout });
      return true;
    } catch (error) {
      if (!this.isTransientExecutionErrorMessage(error.message)) {
        await this.waitForPageSettled(page, Math.min(secondaryTimeout, 8000));
      } else {
        await this.waitForPageSettled(page, 5000);
      }
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
        await this.waitForPageSettled(page, 7000);
      }

      const diagnostics = await this.getStablePageDiagnostics(page, null, {
        cookieCount: await getCookieCount(page)
      });
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

      if (finalDiagnostics.signInRequired) {
        throw new Error(
          `Amazon Fresh appears to require sign-in or delivery eligibility for preferred ZIP ${this.zipCode}. ` +
            `finalUrl=${finalDiagnostics.finalUrl} title="${finalDiagnostics.title}" ` +
            `body="${finalDiagnostics.bodySnippet}" location="${finalDiagnostics.locationText || 'n/a'}"`
        );
      }

      if (finalDiagnostics.zipConfirmed) {
        const confirmedZip = this.recordConfirmedZip(finalDiagnostics);
        console.log(
          `[OK] Amazon Fresh location accepted at ZIP ${confirmedZip || this.confirmedZipCode || 'unknown'}`
        );
        return finalDiagnostics;
      }

      lastDiagnostics = finalDiagnostics;
      const retryReason =
        finalDiagnostics.executionContextUnstable
          ? 'execution-context-unstable'
          : finalDiagnostics.blankPage
            ? 'blank-page'
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
    await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
    await humanDelay(1200, 2400);

    let diagnostics = await this.getPageDiagnostics(page, response, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Amazon Fresh storefront', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(
      page,
      diagnostics,
      'Amazon Fresh storefront'
    );

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Storefront failed. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    await this.setDeliveryLocation(page);
    return diagnostics;
  }

  async setDeliveryLocation(page) {
    const currentLocationState = await this.getLocationConfirmationState(page);
    if (this.isLocationConfirmed(currentLocationState)) {
      const confirmedZip = this.recordConfirmedZip(currentLocationState);
      console.log(`[OK] Amazon Fresh location already acceptable at ZIP ${confirmedZip}`);
      return;
    }

    console.log(
      `[>] Setting Amazon Fresh delivery location to preferred ZIP ${this.zipCode} ` +
        `(${this.getAcceptableZipDescription()})`
    );

    const locationLink = await this.getVisibleHandle(page, LOCATION_LINK_SELECTOR);
    if (!locationLink) {
      const diagnostics = await this.getPageDiagnostics(page, null, {
        cookieCount: await getCookieCount(page)
      });
      throw new Error(
        `Amazon Fresh location control was not found. finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    await locationLink.click();
    console.log('[>] Amazon Fresh location modal opened');
    const zipInput = await this.waitForVisibleHandle(page, ZIP_INPUT_SELECTOR, 15000);
    if (!zipInput) {
      throw new Error(`Amazon Fresh visible ZIP input was not found after opening location popover.`);
    }

    await zipInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await zipInput.type(this.zipCode, { delay: 60 });
    await humanDelay(500, 1200);

    const updateButton = await this.getVisibleHandle(page, ZIP_UPDATE_SELECTOR);
    const settlePromise = this.waitForPageSettled(page, 15000);
    console.log('[>] Amazon Fresh ZIP submit');
    if (updateButton) {
      await updateButton.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await settlePromise;

    const doneButton = await this.getVisibleHandle(page, ZIP_DONE_SELECTOR);
    if (doneButton) {
      const doneSettlePromise = this.waitForPageSettled(page, 10000);
      await doneButton.click().catch(() => null);
      await doneSettlePromise;
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

      await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
      await this.waitForPageSettled(page, attempt === 1 ? 16000 : 22000);
      await humanDelay(1200, 2200);

      console.log(`[>] Amazon Fresh result selector wait attempt ${attempt}`);
      const selectorFound = await this.waitForProductResults(
        page,
        attempt === 1 ? 14000 : 18000,
        attempt === 1 ? 8000 : 12000
      );
      const diagnostics = await this.getStablePageDiagnostics(page, response, {
        navigationError,
        cookieCount: await getCookieCount(page)
      });
      const locationState = await this.getLocationConfirmationState(page);

      let enrichedDiagnostics = {
        ...diagnostics,
        ...locationState,
        attempt,
        selectorFound,
        blankPage: this.isBlankPageDiagnostics(diagnostics),
        bouncedToStorefront: this.isAmazonFreshStorefrontUrl(diagnostics.finalUrl),
        urlMatchesSearch: this.isAmazonFreshSearchUrl(diagnostics.finalUrl),
        zipConfirmed: this.isLocationConfirmed(locationState)
      };

      this.logNavigationDiagnostics('Amazon Fresh search', enrichedDiagnostics);
      const needsManualChallenge =
        enrichedDiagnostics.blocked || enrichedDiagnostics.verification;
      enrichedDiagnostics = await this.maybeHandleManualChallenge(
        page,
        enrichedDiagnostics,
        'Amazon Fresh search'
      );
      const refreshedLocationState = await this.getLocationConfirmationState(page);
      enrichedDiagnostics = {
        ...enrichedDiagnostics,
        ...refreshedLocationState,
        attempt,
        blankPage: this.isBlankPageDiagnostics(enrichedDiagnostics),
        bouncedToStorefront: this.isAmazonFreshStorefrontUrl(enrichedDiagnostics.finalUrl),
        urlMatchesSearch: this.isAmazonFreshSearchUrl(enrichedDiagnostics.finalUrl),
        zipConfirmed: this.isLocationConfirmed(refreshedLocationState)
      };
      if (enrichedDiagnostics.zipConfirmed) {
        this.recordConfirmedZip(enrichedDiagnostics);
      }
      if (needsManualChallenge) {
        this.logNavigationDiagnostics('Amazon Fresh search after challenge', enrichedDiagnostics);
      }

      if (enrichedDiagnostics.blocked || enrichedDiagnostics.verification) {
        throw new Error(
          `${this.getProviderSpecificBlockHint()} finalUrl=${enrichedDiagnostics.finalUrl} ` +
            `title="${enrichedDiagnostics.title}" body="${enrichedDiagnostics.bodySnippet}" ` +
            `html="${enrichedDiagnostics.htmlSnippet}"`
        );
      }

      if (enrichedDiagnostics.signInRequired) {
        throw new Error(
          `Amazon Fresh appears to require sign-in or delivery eligibility for preferred ZIP ${this.zipCode}. ` +
            `finalUrl=${enrichedDiagnostics.finalUrl} title="${enrichedDiagnostics.title}" ` +
            `body="${enrichedDiagnostics.bodySnippet}"`
        );
      }

      if (enrichedDiagnostics.selectorFound || enrichedDiagnostics.noResults) {
        return { diagnostics: enrichedDiagnostics, searchUrl };
      }

      if (enrichedDiagnostics.status && enrichedDiagnostics.status >= 400) {
        throw new Error(
          `Amazon Fresh returned HTTP ${enrichedDiagnostics.status} for ${searchUrl}. ` +
            `${this.getProviderSpecificBlockHint()} finalUrl=${enrichedDiagnostics.finalUrl} ` +
            `title="${enrichedDiagnostics.title}" body="${enrichedDiagnostics.bodySnippet}" ` +
            `html="${enrichedDiagnostics.htmlSnippet}"`
        );
      }

      lastDiagnostics = enrichedDiagnostics;
      const navigationTimedOut = String(enrichedDiagnostics.navigationError || '')
        .toLowerCase()
        .includes('timeout');
      const retryReason =
        enrichedDiagnostics.executionContextUnstable
          ? 'execution-context-unstable'
          : enrichedDiagnostics.blankPage
            ? 'blank-page'
            : enrichedDiagnostics.bouncedToStorefront && navigationTimedOut
              ? 'storefront-bounce-after-timeout'
              : enrichedDiagnostics.bouncedToStorefront && enrichedDiagnostics.zipConfirmed
                ? 'storefront-bounce-with-valid-session'
                : navigationTimedOut && enrichedDiagnostics.urlMatchesSearch
                  ? 'slow-search-render'
                  : null;

      if (!retryReason || attempt === SEARCH_NAVIGATION_RETRY_LIMIT) {
        break;
      }

      this.logNavigationDiagnostics('Amazon Fresh search retrying', {
        ...enrichedDiagnostics,
        retrying: true,
        retryReason
      });

      if (enrichedDiagnostics.bouncedToStorefront && !enrichedDiagnostics.zipConfirmed) {
        console.log('[!] Amazon Fresh search bounce lost ZIP confirmation; re-establishing location');
        await this.setDeliveryLocation(page);
      } else {
        await humanDelay(900, 1800);
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

  async search(query, options = {}) {
    const { limit = 30 } = options;
    const seenUrls = new Set();

    let page;
    try {
      page = await this.getPage();
      console.log('amazon fresh scraper config', {
        provider: this.provider,
        preferredZipCode: this.zipCode,
        confirmedZipCode: this.confirmedZipCode,
        acceptableZipPrefixes: this.acceptableZipPrefixes,
        acceptableZipCodes: this.acceptableZipCodes,
        hasAuth: Boolean(config.brightdata.auth),
        browserWSEndpoint: this.browserWSEndpoint || config.brightdata.browserWSEndpoint
          ? 'configured'
          : 'missing'
      });

      await this.establishFreshSession(page);
      await this.navigateToSearch(page, query);

      const pageRaw = await page.evaluate(() => {
        const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const parsePrice = (text) => {
          const match = (text || '').match(/\$([\d,]+(?:\.\d{2})?)/);
          return match ? parseFloat(match[1].replace(/,/g, '')) : null;
        };

        const cards = [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')];
        return cards.map((card) => {
          const asin = card.getAttribute('data-asin') || 'N/A';
          const link =
            card.querySelector('a[href*="/dp/"]') ||
            card.querySelector('a[href*="/gp/product/"]');
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
      });

      const products = pageRaw
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
          extensions: [`zip:${this.confirmedZipCode || this.zipCode}`],
          thumbnail: product.thumbnail,
          primary_offer:
            product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
          seller_name: 'Amazon Fresh'
        }));

      console.log(`[OK] Done - ${products.length} total Amazon Fresh products`);
      return products;
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Amazon Fresh search Bright Data session');
      throw new Error(`Amazon Fresh search failed for "${query}": ${error.message}`);
    } finally {
      if (page) {
        await page.close();
      }
    }
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
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);

      const diagnostics = await this.getPageDiagnostics(page, response, {
        cookieCount: await getCookieCount(page)
      });
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
        await page.close();
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
