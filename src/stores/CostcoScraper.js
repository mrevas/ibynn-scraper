const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');
const {
  applyPageHardening,
  getCookieCount,
  humanDelay,
  maybeHandleManualChallenge
} = require('../hardening');

const INSTACART_BASE_URL = 'https://www.instacart.com';
const COSTCO_STOREFRONT_PATH = '/store/costco/storefront';
const COSTCO_SEARCH_PATH_PREFIX = '/store/costco/s';
const COSTCO_STOREFRONT_PRODUCT_PATH_PREFIX = '/store/costco/products/';
const COSTCO_PRODUCT_PATH_PREFIX = '/products/';
const COSTCO_PRODUCT_URL_PREFIX = `${INSTACART_BASE_URL}${COSTCO_PRODUCT_PATH_PREFIX}`;
const ZIP_INPUT_SELECTOR = [
  'input[placeholder="Enter ZIP code"]',
  'input[placeholder*="ZIP"]',
  'input[aria-label*="ZIP" i]',
  'input[name="postal_code"]'
].join(', ');
const ZIP_SUBMIT_SELECTOR = [
  'button[type="submit"]',
  'button[aria-label*="ZIP" i]',
  'button[aria-label*="delivery" i]'
].join(', ');
const SEARCH_INPUT_SELECTOR = 'input[placeholder="Search Costco..."], input[aria-label="Search"]';
const PRODUCT_CARD_SELECTOR = '[data-item-card="true"]';
const PRODUCT_LINK_SELECTOR = [
  `${PRODUCT_CARD_SELECTOR} a[href*="${COSTCO_PRODUCT_PATH_PREFIX}"]`,
  `${PRODUCT_CARD_SELECTOR} a[href*="${COSTCO_STOREFRONT_PRODUCT_PATH_PREFIX}"]`
].join(', ');
const PRODUCT_TITLE_SELECTOR = 'h1';

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
    this.zipCode = String(options.zipCode || config.costco.zipCode || '11435').trim();
  }

  getStepTimeout(maxTimeout = 20000) {
    return Math.min(this.timeout, maxTimeout);
  }

  buildAbsoluteUrl(pathOrUrl = COSTCO_STOREFRONT_PATH) {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    return new URL(pathOrUrl, INSTACART_BASE_URL).toString();
  }

  buildSearchPath(query) {
    return `${COSTCO_SEARCH_PATH_PREFIX}?k=${encodeURIComponent(query)}`;
  }

  buildEntryUrl() {
    return this.buildAbsoluteUrl(COSTCO_STOREFRONT_PATH);
  }

  buildProductUrl(productId) {
    if (!productId) {
      throw new Error('A Costco product ID is required.');
    }

    if (/^https?:\/\//i.test(productId)) {
      return productId;
    }

    if (productId.startsWith(COSTCO_PRODUCT_PATH_PREFIX)) {
      return this.buildAbsoluteUrl(productId);
    }

    if (productId.startsWith(COSTCO_STOREFRONT_PRODUCT_PATH_PREFIX)) {
      return this.buildAbsoluteUrl(productId);
    }

    return `${COSTCO_PRODUCT_URL_PREFIX}${encodeURIComponent(productId)}?retailerSlug=costco`;
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
      return 'Instacart Costco storefront blocked the Bright Data-backed browser session.';
    }
    return 'Instacart Costco storefront blocked the local browser session.';
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

  async waitForPageSettled(page, timeout = 12000) {
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
    await humanDelay(900, 1800);
  }

  async getPageDiagnostics(page, response = null, fallback = {}) {
    const responseStatus =
      response && typeof response.status === 'function' ? response.status() : null;
    const status = responseStatus ?? fallback.responseStatus ?? fallback.status ?? null;

    const diagnostics = await page
      .evaluate(
        ({ status: currentStatus, searchPathPrefix, productLinkSelector, zipSelector, searchSelector }) => {
          const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
          const text = normalize(document.body?.innerText || '');
          const lower = text.toLowerCase();

          return {
            status: currentStatus,
            finalUrl: window.location.href,
            title: document.title || '',
            readyState: document.readyState || '',
            blocked:
              lower.includes('access denied') ||
              lower.includes("you don't have permission") ||
              lower.includes('forbidden') ||
              lower.includes('temporarily blocked') ||
              lower.includes('request blocked'),
            verification:
              lower.includes('verify you are human') ||
              lower.includes('captcha') ||
              lower.includes('security check') ||
              lower.includes('pardon our interruption'),
            hasZipPrompt: Boolean(document.querySelector(zipSelector)),
            hasSearchInput: Boolean(document.querySelector(searchSelector)),
            hasProductResults: Boolean(document.querySelector(productLinkSelector)),
            noResults:
              lower.includes('no results for') ||
              lower.includes('no results') ||
              lower.includes('no items found') ||
              lower.includes('did not match any products') ||
              lower.includes('try another search'),
            onStorefrontPage: window.location.pathname === '/store/costco/storefront',
            onSearchPage:
              window.location.pathname === searchPathPrefix ||
              window.location.pathname.startsWith(`${searchPathPrefix}/`) ||
              window.location.href.includes(`${searchPathPrefix}?`),
            bodyLength: text.length,
            bodySnippet: text.slice(0, 400)
          };
        },
        {
          status,
          searchPathPrefix: COSTCO_SEARCH_PATH_PREFIX,
          productLinkSelector: PRODUCT_LINK_SELECTOR,
          zipSelector: ZIP_INPUT_SELECTOR,
          searchSelector: SEARCH_INPUT_SELECTOR
        }
      )
      .catch((error) => ({
        status,
        finalUrl: page.url(),
        title: '',
        readyState: 'unavailable',
        blocked: false,
        verification: false,
        hasZipPrompt: false,
        hasSearchInput: false,
        hasProductResults: false,
        noResults: false,
        onStorefrontPage: page.url().includes(COSTCO_STOREFRONT_PATH),
        onSearchPage: page.url().includes(COSTCO_SEARCH_PATH_PREFIX),
        bodyLength: 0,
        bodySnippet: `Unable to read page body: ${error.message}`,
        executionContextUnstable: this.isTransientExecutionErrorMessage(error.message)
      }));

    return {
      ...diagnostics,
      responseStatus: responseStatus ?? null,
      cookieCount: fallback.cookieCount ?? null,
      navigationError: fallback.navigationError || null
    };
  }

  logNavigationDiagnostics(stage, diagnostics) {
    console.log(`${stage} diagnostics`, {
      provider: this.provider,
      zipCode: this.zipCode,
      status: diagnostics.status,
      finalUrl: diagnostics.finalUrl,
      title: diagnostics.title,
      readyState: diagnostics.readyState,
      blocked: diagnostics.blocked,
      verification: diagnostics.verification,
      hasZipPrompt: diagnostics.hasZipPrompt,
      hasSearchInput: diagnostics.hasSearchInput,
      hasProductResults: diagnostics.hasProductResults,
      noResults: diagnostics.noResults,
      onStorefrontPage: diagnostics.onStorefrontPage,
      onSearchPage: diagnostics.onSearchPage,
      navigationError: diagnostics.navigationError,
      responseStatus: diagnostics.responseStatus,
      cookieCount: diagnostics.cookieCount,
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

  async setZipCode(page) {
    await page.waitForSelector(ZIP_INPUT_SELECTOR, { timeout: this.getStepTimeout(12000) });
    await page.$eval(
      ZIP_INPUT_SELECTOR,
      (input, zipCode) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;

        if (setter) {
          setter.call(input, '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setter.call(input, zipCode);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        input.value = zipCode;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      this.zipCode
    );
  }

  async submitZipCodeGate(page) {
    await this.setZipCode(page);

    const startUrl = page.url();
    const navigationPromise = page
      .waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: this.getStepTimeout(20000)
      })
      .catch(() => null);
    const urlChangePromise = page
      .waitForFunction((currentUrl) => window.location.href !== currentUrl, {
        timeout: this.getStepTimeout(20000)
      }, startUrl)
      .catch(() => null);

    await page.click(ZIP_SUBMIT_SELECTOR);
    await Promise.race([
      navigationPromise,
      urlChangePromise,
      new Promise((resolve) => setTimeout(resolve, this.getStepTimeout(20000)))
    ]);
    await this.waitForPageSettled(page, 14000);
  }

  async establishSession(page) {
    const landingUrl = this.buildEntryUrl();
    const response = await page.goto(landingUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForSelector('body', { timeout: this.timeout });
    await this.waitForPageSettled(page, 9000);

    let diagnostics = await this.getPageDiagnostics(page, response, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Instacart Costco landing', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Instacart Costco landing');

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Landing page session establishment failed. ` +
          `status=${diagnostics.status || 'unknown'} url=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    if (diagnostics.hasZipPrompt) {
      await this.submitZipCodeGate(page);
      diagnostics = await this.getPageDiagnostics(page, null, {
        cookieCount: await getCookieCount(page)
      });
      this.logNavigationDiagnostics('Instacart Costco post-ZIP', diagnostics);
      diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Instacart Costco post-ZIP');
    }

    if (diagnostics.hasZipPrompt) {
      throw new Error(
        `Instacart Costco storefront kept the ZIP gate open for ${this.zipCode}. ` +
          `url=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    return diagnostics;
  }

  async waitForSearchResults(page, query) {
    const timeout = this.getStepTimeout(25000);

    try {
      await Promise.race([
        page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout }),
        page.waitForFunction(
          (searchQuery, productLinkSelector) => {
            const bodyText = (document.body?.innerText || '').toLowerCase();
            return (
              bodyText.includes(`results for "${String(searchQuery).toLowerCase()}"`) ||
              bodyText.includes(`results for ${String(searchQuery).toLowerCase()}`) ||
              bodyText.includes(`no results for "${String(searchQuery).toLowerCase()}"`) ||
              Boolean(document.querySelector(productLinkSelector))
            );
          },
          { timeout },
          query,
          PRODUCT_LINK_SELECTOR
        )
      ]);
    } catch (error) {
      await this.waitForPageSettled(page, 8000);
    }

    return this.getPageDiagnostics(page, null, {
      cookieCount: await getCookieCount(page)
    });
  }

  async navigateToSearch(page, query) {
    const searchPath = this.buildSearchPath(query);
    const searchUrl = this.buildAbsoluteUrl(searchPath);

    await this.establishSession(page);

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

    await this.waitForPageSettled(page, 9000);

    let diagnostics = await this.getPageDiagnostics(page, response, {
      navigationError,
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Instacart Costco direct search', diagnostics);

    diagnostics = await this.waitForSearchResults(page, query);
    this.logNavigationDiagnostics('Instacart Costco search results', diagnostics);

    if (diagnostics.blocked || diagnostics.verification) {
      diagnostics = await this.maybeHandleManualChallenge(
        page,
        diagnostics,
        'Instacart Costco search results'
      );
    }

    if (!diagnostics.hasProductResults && !diagnostics.noResults) {
      throw new Error(
        `Instacart Costco search page shape changed or results did not load for "${query}". ` +
          `url=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    return diagnostics;
  }

  async navigateToProduct(page, url) {
    const targetUrl = this.buildAbsoluteUrl(url);
    await this.establishSession(page);

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForSelector(PRODUCT_TITLE_SELECTOR, { timeout: this.timeout });
    await this.waitForPageSettled(page, 7000);

    const diagnostics = await this.getPageDiagnostics(page, response, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Instacart Costco product', diagnostics);

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Product navigation was blocked. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }
  }

  async search(query, options = {}) {
    const { limit = 30 } = options;
    const seenUrls = new Set();

    let page;
    try {
      page = await this.getPage();
      console.log('costco scraper config', {
        provider: this.provider,
        zipCode: this.zipCode,
        hasAuth: Boolean(config.brightdata.auth),
        browserWSEndpoint:
          this.browserWSEndpoint || config.brightdata.browserWSEndpoint ? 'configured' : 'missing'
      });

      const diagnostics = await this.navigateToSearch(page, query);
      if (diagnostics.noResults) {
        console.log('[OK] Done - 0 total Costco products');
        return [];
      }

      const pageRaw = await page.evaluate((productLinkSelector) => {
        const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const parsePrice = (text) => {
          const match = String(text || '').match(/\$([\d,]+(?:\.\d{2})?)/);
          return match ? parseFloat(match[1].replace(/,/g, '')) : null;
        };
        const getAbsoluteUrl = (href) => {
          try {
            return new URL(href, window.location.origin).toString();
          } catch (error) {
            return null;
          }
        };

        return [...document.querySelectorAll('[data-item-card="true"]')]
          .map((card) => {
            const link = card.querySelector(productLinkSelector);
            if (!link) {
              return null;
            }

            const href = getAbsoluteUrl(link.getAttribute('href') || link.href);
            const heading =
              normalize(card.querySelector('[role="heading"][aria-level]')?.textContent) ||
              normalize(link.querySelector('img')?.getAttribute('alt')) ||
              normalize(link.textContent);
            const screenReaderTexts = [...card.querySelectorAll('.screen-reader-only')]
              .map((el) => normalize(el.textContent))
              .filter(Boolean);
            const currentPriceText =
              screenReaderTexts.find((text) => /^Current price:/i.test(text)) ||
              normalize(card.innerText);
            const priceMatch = currentPriceText.match(
              /Current price:\s*(\$[\d,]+(?:\.\d{2})?(?:\s+per\s+package\s+\(estimated\))?)/i
            );
            const image = link.querySelector('img[data-testid="item-card-image"], img');
            const productIdMatch = href?.match(/\/products\/(\d+)/i);

            return {
              name: heading || 'N/A',
              price: priceMatch ? priceMatch[1] : null,
              extractedPrice: parsePrice(priceMatch ? priceMatch[1] : currentPriceText),
              url: href,
              thumbnail: image?.currentSrc || image?.src || null,
              productId: productIdMatch ? productIdMatch[1] : 'N/A'
            };
          })
          .filter(Boolean);
      }, PRODUCT_LINK_SELECTOR);

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
          rating: null,
          reviews: null,
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
      const url = this.buildProductUrl(productId);
      console.log(`[>] Fetching Costco product details for ID: ${productId}`);
      await this.navigateToProduct(page, url);

      const details = await page.evaluate(() => {
        const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const getText = (selectors) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el?.textContent?.trim()) {
              return normalize(el.textContent);
            }
          }
          return 'N/A';
        };

        const priceText =
          [...document.querySelectorAll('.screen-reader-only')]
            .map((el) => normalize(el.textContent))
            .find((text) => /^Current price:/i.test(text)) || 'N/A';

        const detailsHeading = [...document.querySelectorAll('h2, h3, [role="heading"]')].find(
          (el) => normalize(el.textContent).toLowerCase() === 'details'
        );
        const description =
          normalize(detailsHeading?.parentElement?.innerText) ||
          normalize(detailsHeading?.nextElementSibling?.innerText) ||
          'N/A';

        return {
          title: getText(['h1']),
          price: priceText === 'N/A' ? 'N/A' : priceText.replace(/^Current price:\s*/i, ''),
          description,
          rating: 'N/A',
          reviews: 'N/A'
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
