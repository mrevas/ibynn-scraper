const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');
const {
  applyPageHardening,
  getCookieCount,
  humanDelay,
  maybeHandleManualChallenge
} = require('../hardening');

const COSTCO_HOME_URL = 'https://www.costco.com/';
const SEARCH_URLS = [
  (query) => `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(query)}`,
  (query) => `https://www.costco.com/s?keyword=${encodeURIComponent(query)}`
];
const SEARCH_LINK_SELECTOR = 'a[href*=".product."]';
const PRODUCT_TITLE_SELECTOR = 'h1, [data-testid*="product-name"], [class*="product-name"]';
const HOMEPAGE_SEARCH_INPUT_SELECTOR = 'input[placeholder="Search Costco"], input[aria-label="Search Costco"]';
const HOMEPAGE_SEARCH_BUTTON_SELECTOR = 'button[data-testid="SearchButton"], button[aria-label="Search"]';

class CostcoScraper extends BaseScraper {
  constructor(options = {}) {
    super('Costco', options);
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
  }

  getStepTimeout(maxTimeout = 20000) {
    return Math.min(this.timeout, maxTimeout);
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
      return 'Costco blocked the Bright Data-backed browser session.';
    }
    return 'Costco blocked the local browser session. Bright Data mode is recommended for Costco.';
  }

  getStatusErrorMessage(status, url) {
    if (status === 403) {
      return `Costco returned HTTP 403 for ${url}. ${this.getProviderSpecificBlockHint()}`;
    }
    return `Costco returned HTTP ${status} for ${url}.`;
  }

  isSearchNavigationUrl(url, query) {
    if (!url) {
      return false;
    }

    const lowerUrl = url.toLowerCase();
    const encodedQuery = encodeURIComponent(query).toLowerCase();
    return (
      lowerUrl.includes(`/s?keyword=${encodedQuery}`) ||
      lowerUrl.includes(`/catalogsearch?dept=all&keyword=${encodedQuery}`) ||
      lowerUrl.includes(`keyword=${encodedQuery}`)
    );
  }

  trackSearchNavigation(page, query) {
    const events = {
      requestUrl: null,
      responseUrl: null,
      responseStatus: null,
      requestFailure: null
    };

    const matches = (url) => this.isSearchNavigationUrl(url, query);
    const onRequest = (request) => {
      if (request.isNavigationRequest() && matches(request.url()) && !events.requestUrl) {
        events.requestUrl = request.url();
      }
    };
    const onResponse = (response) => {
      const request = response.request();
      if (request.isNavigationRequest() && matches(response.url()) && !events.responseUrl) {
        events.responseUrl = response.url();
        events.responseStatus = response.status();
      }
    };
    const onRequestFailed = (request) => {
      if (request.isNavigationRequest() && matches(request.url()) && !events.requestFailure) {
        events.requestUrl = events.requestUrl || request.url();
        events.requestFailure = request.failure()?.errorText || 'request failed';
      }
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    return {
      events,
      stop: () => {
        page.off('request', onRequest);
        page.off('response', onResponse);
        page.off('requestfailed', onRequestFailed);
      }
    };
  }

  async getPageDiagnostics(page, response, fallback = {}) {
    const responseStatus =
      response && typeof response.status === 'function' ? response.status() : null;
    const status = responseStatus ?? fallback.responseStatus ?? fallback.status ?? null;

    const pageData = await page
      .evaluate((currentStatus) => {
        const text = document.body?.innerText || '';
        const normalized = text.toLowerCase();
        const html = document.documentElement?.outerHTML || '';
        return {
          status: currentStatus,
          finalUrl: window.location.href,
          title: document.title,
          blocked:
            normalized.includes('access denied') ||
            normalized.includes("you don't have permission") ||
            normalized.includes('forbidden') ||
            normalized.includes('temporarily blocked'),
          verification:
            normalized.includes('verify you are human') ||
            normalized.includes('captcha') ||
            normalized.includes('security check'),
          homepage:
            window.location.href === 'https://www.costco.com/' ||
            document.title === 'Welcome to Costco Wholesale',
          noResults:
            normalized.includes('no results') ||
            normalized.includes('0 results') ||
            normalized.includes('did not match any products'),
          bodySnippet: text.replace(/\s+/g, ' ').trim().slice(0, 300),
          htmlSnippet: html.replace(/\s+/g, ' ').trim().slice(0, 300)
        };
      }, status)
      .catch((error) => ({
        status,
        finalUrl: page.url(),
        title: 'N/A',
        blocked: false,
        verification: false,
        homepage: page.url() === COSTCO_HOME_URL,
        noResults: false,
        bodySnippet: `Unable to read page body: ${error.message}`,
        htmlSnippet: ''
      }));

    return {
      ...pageData,
      requestUrl: fallback.requestUrl || null,
      responseUrl: fallback.responseUrl || null,
      responseStatus: fallback.responseStatus ?? responseStatus ?? null,
      requestFailure: fallback.requestFailure || null,
      navigationError: fallback.navigationError || null,
      cookieCount: fallback.cookieCount ?? null
    };
  }

  getSearchTimeoutMessage(searchUrl, diagnostics) {
    const requestSummary = diagnostics.requestUrl
      ? `requestUrl=${diagnostics.requestUrl}`
      : 'requestUrl=none';
    const responseSummary =
      diagnostics.responseStatus != null
        ? `responseStatus=${diagnostics.responseStatus} responseUrl=${diagnostics.responseUrl || 'unknown'}`
        : 'responseStatus=none';
    const failureSummary = diagnostics.requestFailure
      ? `requestFailure=${diagnostics.requestFailure}`
      : 'requestFailure=none';
    const navigationSummary = diagnostics.navigationError
      ? `navigationError="${diagnostics.navigationError}"`
      : 'navigationError=none';

    return (
      `Costco search did not finish for ${searchUrl}. ${requestSummary} ${responseSummary} ` +
      `${failureSummary} ${navigationSummary} finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
      `body="${diagnostics.bodySnippet}"`
    );
  }

  logNavigationDiagnostics(stage, diagnostics) {
    console.log(`${stage} diagnostics`, {
      provider: this.provider,
      status: diagnostics.status,
      finalUrl: diagnostics.finalUrl,
      title: diagnostics.title,
      blocked: diagnostics.blocked,
      verification: diagnostics.verification,
      homepage: diagnostics.homepage,
      noResults: diagnostics.noResults,
      requestUrl: diagnostics.requestUrl,
      responseUrl: diagnostics.responseUrl,
      responseStatus: diagnostics.responseStatus,
      requestFailure: diagnostics.requestFailure,
      navigationError: diagnostics.navigationError,
      cookieCount: diagnostics.cookieCount,
      bodySnippet: diagnostics.bodySnippet
    });
  }

  async hasProductResults(page) {
    try {
      return Boolean(await page.$(SEARCH_LINK_SELECTOR));
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

  async establishSession(page) {
    const response = await page.goto(COSTCO_HOME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForSelector('body', { timeout: this.timeout });
    await page.waitForSelector(HOMEPAGE_SEARCH_INPUT_SELECTOR, { timeout: this.timeout });
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 5000 }).catch(() => null);
    await humanDelay(1200, 2400);

    let diagnostics = await this.getPageDiagnostics(page, response, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Costco homepage', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Costco homepage');

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Homepage session establishment failed. ` +
          `status=${diagnostics.status || 'unknown'} url=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
          `body="${diagnostics.bodySnippet}"`
      );
    }

    return diagnostics;
  }

  async trySearchNavigation(page, query, searchUrl, referer) {
    const navigationProbe = this.trackSearchNavigation(page, query);
    let navigationError = null;
    const response = await page
      .goto(searchUrl, {
        referer,
        waitUntil: 'domcontentloaded',
        timeout: this.getStepTimeout()
      })
      .catch((error) => {
        navigationError = error.message;
        return null;
      });

    await page.waitForSelector('body', { timeout: 5000 }).catch(() => null);
    await humanDelay(1600, 3000);

    let selectorFound = false;
    try {
      await page.waitForSelector(SEARCH_LINK_SELECTOR, { timeout: 6000 });
      selectorFound = true;
    } catch (error) {
      selectorFound = false;
    }

    let diagnostics = await this.getPageDiagnostics(page, response, {
      ...navigationProbe.events,
      navigationError,
      cookieCount: await getCookieCount(page)
    });
    navigationProbe.stop();
    diagnostics.selectorFound = selectorFound;
    this.logNavigationDiagnostics('Costco search', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Costco search');

    if (diagnostics.selectorFound) {
      return diagnostics;
    }

    if (diagnostics.noResults) {
      return diagnostics;
    }

    if (diagnostics.status && diagnostics.status >= 400) {
      throw new Error(
        `${this.getStatusErrorMessage(diagnostics.status, searchUrl)} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" blocked=${diagnostics.blocked} verification=${diagnostics.verification} ` +
          `body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Search navigation was blocked. ` +
          `url=${searchUrl} finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
          `body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    throw new Error(this.getSearchTimeoutMessage(searchUrl, diagnostics));
  }

  async tryHomepageSearch(page, query) {
    await page.waitForSelector(HOMEPAGE_SEARCH_INPUT_SELECTOR, { timeout: this.timeout });
    await page.click(HOMEPAGE_SEARCH_INPUT_SELECTOR, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(HOMEPAGE_SEARCH_INPUT_SELECTOR, query, { delay: 80 });
    await humanDelay(900, 1800);

    const stepTimeout = this.getStepTimeout(15000);
    const navigationProbe = this.trackSearchNavigation(page, query);
    let navigationError = null;
    const startUrl = page.url();
    const navigationPromise = page
      .waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: stepTimeout
      })
      .catch((error) => {
        navigationError = error.message;
        return null;
      });
    const urlChangePromise = page
      .waitForFunction(
        (currentUrl) => window.location.href !== currentUrl,
        { timeout: stepTimeout },
        startUrl
      )
      .catch(() => null);

    if (await page.$(HOMEPAGE_SEARCH_BUTTON_SELECTOR)) {
      await page.$eval(HOMEPAGE_SEARCH_BUTTON_SELECTOR, (el) => el.click());
    } else {
      await page.keyboard.press('Enter');
    }

    await Promise.race([
      navigationPromise,
      urlChangePromise,
      new Promise((resolve) => setTimeout(resolve, stepTimeout))
    ]);
    const bodyWaitError = await page
      .waitForSelector('body', { timeout: 5000 })
      .then(() => null)
      .catch((error) => error);
    if (bodyWaitError) {
      navigationError = [navigationError, `body wait failed: ${bodyWaitError.message}`]
        .filter(Boolean)
        .join('; ');
    }
    await humanDelay(1600, 3000);

    let selectorFound = false;
    try {
      await page.waitForSelector(SEARCH_LINK_SELECTOR, { timeout: 6000 });
      selectorFound = true;
    } catch (error) {
      selectorFound = false;
    }

    let diagnostics = await this.getPageDiagnostics(page, null, {
      ...navigationProbe.events,
      navigationError,
      cookieCount: await getCookieCount(page)
    });
    navigationProbe.stop();
    diagnostics.selectorFound = selectorFound;
    diagnostics.queryVisible = diagnostics.bodySnippet.toLowerCase().includes(query.toLowerCase());
    this.logNavigationDiagnostics('Costco homepage search', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(
      page,
      diagnostics,
      'Costco homepage search'
    );

    const looksLikeSearchResults =
      !diagnostics.homepage &&
      (diagnostics.finalUrl.toLowerCase().includes('keyword=') ||
        diagnostics.finalUrl.toLowerCase().includes('/s?') ||
        diagnostics.queryVisible);

    if ((diagnostics.selectorFound && looksLikeSearchResults) || diagnostics.noResults) {
      return diagnostics;
    }

    if (diagnostics.status && diagnostics.status >= 400) {
      throw new Error(
        `${this.getStatusErrorMessage(diagnostics.status, diagnostics.finalUrl)} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" blocked=${diagnostics.blocked} verification=${diagnostics.verification} ` +
          `body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Homepage search submission was blocked. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
          `body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    throw new Error(this.getSearchTimeoutMessage('homepage-search-ui', diagnostics));
  }

  async navigateToSearch(page, query) {
    const homeDiagnostics = await this.establishSession(page);

    const errors = [];
    try {
      const diagnostics = await this.tryHomepageSearch(page, query);
      return { diagnostics, searchUrl: 'homepage-search-ui' };
    } catch (error) {
      errors.push(`homepage-search-ui -> ${error.message}`);
    }

    for (const buildUrl of SEARCH_URLS) {
      const searchUrl = buildUrl(query);
      console.log(`[>] Costco search: ${searchUrl}`);
      try {
        const diagnostics = await this.trySearchNavigation(
          page,
          query,
          searchUrl,
          homeDiagnostics.finalUrl || COSTCO_HOME_URL
        );
        return { diagnostics, searchUrl };
      } catch (error) {
        errors.push(`${searchUrl} -> ${error.message}`);
      }
    }

    throw new Error(errors.join(' | '));
  }

  async navigateToProduct(page, url) {
    await this.establishSession(page);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForSelector('body', { timeout: this.timeout });
    await humanDelay(1200, 2400);

    const diagnostics = await this.getPageDiagnostics(page, response);
    this.logNavigationDiagnostics('Costco product', diagnostics);

    const status = diagnostics.status;
    if (status && status >= 400) {
      throw new Error(
        `${this.getStatusErrorMessage(status, url)} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Product navigation was blocked. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    await page.waitForSelector(PRODUCT_TITLE_SELECTOR, { timeout: this.timeout });
  }

  async search(query, options = {}) {
    const { limit = 30 } = options;
    const seenUrls = new Set();

    let page;
    try {
      page = await this.getPage();
      console.log('costco scraper config', {
        provider: this.provider,
        hasAuth: Boolean(config.brightdata.auth),
        browserWSEndpoint: this.browserWSEndpoint || config.brightdata.browserWSEndpoint
          ? 'configured'
          : 'missing'
      });

      await this.navigateToSearch(page, query);

      const pageRaw = await page.evaluate(() => {
        const parsePrice = (text) => {
          const match = text.match(/\$([\d,]+(?:\.\d{2})?)/);
          return match ? parseFloat(match[1].replace(/,/g, '')) : null;
        };

        const normalizeTitle = (text) =>
          (text || '')
            .replace(/\s+/g, ' ')
            .replace(/^view details\s*/i, '')
            .trim();

        const links = [...document.querySelectorAll('a[href*=".product."]')];
        return links.map((link) => {
          const url = link.href;
          const container =
            link.closest('article') ||
            link.closest('li') ||
            link.closest('[class*="product"]') ||
            link.parentElement;

          const containerText = (container?.innerText || '').replace(/\s+/g, ' ').trim();
          const linkText = normalizeTitle(
            link.getAttribute('aria-label') || link.title || link.innerText || link.textContent
          );

          const image =
            container?.querySelector('img')?.src ||
            container?.querySelector('img')?.getAttribute('data-src') ||
            null;

          const ratingMatch = containerText.match(/rated\s+([\d.]+)\s+out of 5/i);
          const reviewsMatch =
            containerText.match(/\(([\d,]+)\)/) ||
            containerText.match(/based on\s+([\d,]+)\s+reviews?/i);

          const itemMatch =
            containerText.match(/item\s+#?\s*([A-Za-z0-9-]+)/i) ||
            url.match(/product\.([^.]+)\.html/i);

          const titleFromText = containerText
            .split(/\$[\d,]+(?:\.\d{2})?/)
            .map((part) => normalizeTitle(part))
            .find((part) => part && !/^rated\s/i.test(part) && !/^item\s/i.test(part));

          const title = linkText || titleFromText || 'N/A';
          const priceMatch = containerText.match(/\$[\d,]+(?:\.\d{2})?/);
          const price = priceMatch ? priceMatch[0] : null;
          const extractedPrice = price ? parsePrice(price) : null;

          return {
            name: title,
            price,
            extractedPrice,
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
            reviews: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null,
            url,
            thumbnail: image,
            productId: itemMatch ? itemMatch[1] : 'N/A'
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
          source: 'Costco',
          source_icon: 'https://www.costco.com/favicon.ico',
          price: product.price,
          extracted_price: product.extractedPrice,
          rating: product.rating,
          reviews: product.reviews,
          extensions: [],
          thumbnail: product.thumbnail,
          primary_offer:
            product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
          seller_name: 'Costco'
        }));

      console.log(`[OK] Done - ${products.length} total Costco products`);
      return products;
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Costco search Bright Data session');
      throw new Error(`Costco search failed for "${query}": ${error.message}`);
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
      const url = `https://www.costco.com/.product.${productId}.html`;
      console.log(`[>] Fetching Costco product details for ID: ${productId}`);
      await this.navigateToProduct(page, url);

      const details = await page.evaluate(() => {
        const getText = (selectors) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el?.textContent?.trim()) {
              return el.textContent.trim();
            }
          }
          return 'N/A';
        };

        return {
          title: getText(['h1', '[data-testid*="product-name"]', '[class*="product-name"]']),
          price: getText(['[data-testid*="price"]', '[class*="price"]', '[id*="price"]']),
          description: getText([
            '[data-testid*="description"]',
            '[class*="description"]',
            '#product-details',
            '.product-details'
          ]),
          rating: getText(['[aria-label*="Rated"]', '[data-testid*="rating"]', '[class*="rating"]']),
          reviews: getText(['[data-testid*="review"]', '[class*="review"]'])
        };
      });

      console.log('[OK] Costco product details retrieved');
      return details;
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Costco product Bright Data session');
      throw new Error(`Failed to get Costco product details for ${productId}: ${error.message}`);
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

module.exports = CostcoScraper;
