const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');
const {
  applyPageHardening,
  getCookieCount,
  humanDelay,
  maybeHandleManualChallenge
} = require('../hardening');

const WALMART_HOME_URL = 'https://www.walmart.com/';
const PRODUCT_LINK_SELECTOR = 'a[href*="/ip/"]';
const SEARCH_INPUT_SELECTOR = 'input[type="search"], input[aria-label*="Search"], input[placeholder*="Search"]';
const SEARCH_BUTTON_SELECTOR = 'button[type="submit"], button[aria-label*="Search"]';

class WalmartScraper extends BaseScraper {
  constructor(options = {}) {
    super('Walmart', options);
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
      return 'Walmart blocked the Bright Data-backed browser session.';
    }
    return 'Walmart blocked the local browser session. Bright Data mode may be required for Walmart.';
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
          title: document.title,
          blocked:
            normalized.includes('access denied') ||
            normalized.includes('robot or human') ||
            normalized.includes('verify your identity') ||
            normalized.includes('verify you are human') ||
            normalized.includes('forbidden'),
          verification:
            normalized.includes('captcha') ||
            normalized.includes('press and hold') ||
            normalized.includes('security check') ||
            normalized.includes('robot or human'),
          noResults:
            normalized.includes('no results') ||
            normalized.includes('0 results') ||
            normalized.includes('we couldn') ||
            normalized.includes('did not match'),
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
        noResults: false,
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
      blocked: diagnostics.blocked,
      verification: diagnostics.verification,
      noResults: diagnostics.noResults,
      navigationError: diagnostics.navigationError,
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

  async navigateToSearch(page, query) {
    const searchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
    const homepageError = await this.tryHomepageSearch(page, query).catch((error) => error);
    if (!(homepageError instanceof Error)) {
      return homepageError;
    }

    console.log(`[>] Walmart homepage search fallback failed: ${homepageError.message}`);
    console.log(`[>] Walmart search: ${searchUrl}`);

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
    await humanDelay(1800, 3200);

    let selectorFound = false;
    try {
      await page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout: 10000 });
      selectorFound = true;
    } catch (error) {
      selectorFound = false;
    }

    let diagnostics = await this.getPageDiagnostics(page, response, {
      navigationError,
      cookieCount: await getCookieCount(page)
    });
    diagnostics.selectorFound = selectorFound;
    this.logNavigationDiagnostics('Walmart search', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Walmart search');

    if (diagnostics.selectorFound || diagnostics.noResults) {
      return { diagnostics, searchUrl };
    }

    if (diagnostics.status && diagnostics.status >= 400) {
      throw new Error(
        `Walmart returned HTTP ${diagnostics.status} for ${searchUrl}. ${this.getProviderSpecificBlockHint()} ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}" ` +
          `html="${diagnostics.htmlSnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    throw new Error(
      `Timed out waiting for Walmart search results on ${searchUrl}. finalUrl=${diagnostics.finalUrl} ` +
        `title="${diagnostics.title}" navigationError=${diagnostics.navigationError || 'none'} ` +
        `body="${diagnostics.bodySnippet}"`
    );
  }

  async tryHomepageSearch(page, query) {
    console.log(`[>] Walmart homepage search: ${WALMART_HOME_URL}`);
    const homeResponse = await page.goto(WALMART_HOME_URL, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });
    await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
    await humanDelay(1200, 2400);

    let homeDiagnostics = await this.getPageDiagnostics(page, homeResponse, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Walmart homepage', homeDiagnostics);
    homeDiagnostics = await this.maybeHandleManualChallenge(
      page,
      homeDiagnostics,
      'Walmart homepage'
    );

    if (homeDiagnostics.blocked || homeDiagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Homepage was blocked. ` +
          `finalUrl=${homeDiagnostics.finalUrl} title="${homeDiagnostics.title}" ` +
          `body="${homeDiagnostics.bodySnippet}"`
      );
    }

    await page.waitForSelector(SEARCH_INPUT_SELECTOR, { timeout: 10000 });
    await page.click(SEARCH_INPUT_SELECTOR, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(SEARCH_INPUT_SELECTOR, query, { delay: 60 });
    await humanDelay(700, 1600);

    const navigationPromise = page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: Math.min(this.timeout, 20000) })
      .catch(() => null);

    if (await page.$(SEARCH_BUTTON_SELECTOR)) {
      await page.$eval(SEARCH_BUTTON_SELECTOR, (el) => el.click());
    } else {
      await page.keyboard.press('Enter');
    }

    const response = await navigationPromise;
    await page.waitForSelector('body', { timeout: 10000 }).catch(() => null);
    await humanDelay(1800, 3200);

    let selectorFound = false;
    try {
      await page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout: 10000 });
      selectorFound = true;
    } catch (error) {
      selectorFound = false;
    }

    let diagnostics = await this.getPageDiagnostics(page, response, {
      cookieCount: await getCookieCount(page)
    });
    diagnostics.selectorFound = selectorFound;
    this.logNavigationDiagnostics('Walmart homepage search', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(
      page,
      diagnostics,
      'Walmart homepage search'
    );

    if (diagnostics.selectorFound || diagnostics.noResults) {
      return { diagnostics, searchUrl: 'homepage-search-ui' };
    }

    if (diagnostics.status && diagnostics.status >= 400) {
      throw new Error(
        `Walmart returned HTTP ${diagnostics.status} from homepage search. ` +
          `${this.getProviderSpecificBlockHint()} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Homepage search was blocked. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
          `body="${diagnostics.bodySnippet}"`
      );
    }

    throw new Error(
      `Homepage search did not reach Walmart results. finalUrl=${diagnostics.finalUrl} ` +
        `title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
    );
  }

  async search(query, options = {}) {
    const { limit = 30 } = options;
    const seenUrls = new Set();

    let page;
    try {
      page = await this.getPage();
      console.log('walmart scraper config', {
        provider: this.provider,
        hasAuth: Boolean(config.brightdata.auth),
        browserWSEndpoint: this.browserWSEndpoint || config.brightdata.browserWSEndpoint
          ? 'configured'
          : 'missing'
      });

      await this.navigateToSearch(page, query);

      const pageRaw = await page.evaluate(() => {
        const parsePrice = (text) => {
          const match = (text || '').match(/\$([\d,]+(?:\.\d{2})?)/);
          return match ? parseFloat(match[1].replace(/,/g, '')) : null;
        };

        const clean = (text) => (text || '').replace(/\s+/g, ' ').trim();
        const getText = (root, selectors) => {
          for (const selector of selectors) {
            const el = root.querySelector(selector);
            const text = clean(el?.textContent || el?.getAttribute('aria-label'));
            if (text) return text;
          }
          return null;
        };

        const links = [...document.querySelectorAll('a[href*="/ip/"]')];
        return links.map((link) => {
          const url = link.href.split('?')[0];
          const container =
            link.closest('[data-item-id]') ||
            link.closest('[data-testid="item-stack"]') ||
            link.closest('article') ||
            link.closest('li') ||
            link.parentElement;
          const containerText = clean(container?.innerText || '');

          const title =
            clean(link.getAttribute('aria-label')) ||
            getText(container || document, [
              '[data-automation-id="product-title"]',
              '[data-testid="product-title"]',
              'span[data-automation-id*="product-title"]'
            ]) ||
            clean(link.textContent);

          const image =
            container?.querySelector('img')?.src ||
            container?.querySelector('img')?.getAttribute('data-src') ||
            null;

          const priceText =
            getText(container || document, [
              '[data-automation-id="product-price"]',
              '[data-testid="price-wrap"]',
              '[itemprop="price"]',
              '[aria-label*="$"]'
            ]) ||
            (containerText.match(/\$[\d,]+(?:\.\d{2})?/) || [null])[0];

          const extractedPrice = parsePrice(priceText);
          const ratingMatch =
            containerText.match(/([\d.]+)\s+out of\s+5/i) ||
            containerText.match(/([\d.]+)\s+stars?/i);
          const reviewsMatch =
            containerText.match(/\(([\d,]+)\)/) ||
            containerText.match(/([\d,]+)\s+reviews?/i);
          const idMatch =
            container?.getAttribute('data-item-id') ||
            url.match(/\/ip\/(?:[^/]+\/)?(\d+)/)?.[1] ||
            url.match(/\/(\d+)$/)?.[1];

          return {
            name: title || 'N/A',
            price: priceText || null,
            extractedPrice,
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
            reviews: reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : null,
            url,
            thumbnail: image,
            productId: idMatch || 'N/A'
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
          source: 'Walmart',
          source_icon: 'https://www.walmart.com/favicon.ico',
          price: product.price,
          extracted_price: product.extractedPrice,
          rating: product.rating,
          reviews: product.reviews,
          extensions: [],
          thumbnail: product.thumbnail,
          primary_offer:
            product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
          seller_name: 'Walmart'
        }));

      console.log(`[OK] Done - ${products.length} total Walmart products`);
      return products;
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Walmart search Bright Data session');
      throw new Error(`Walmart search failed for "${query}": ${error.message}`);
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
      const url = `${WALMART_HOME_URL}ip/${productId}`;
      console.log(`[>] Fetching Walmart product details for ID: ${productId}`);
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout
      });

      const diagnostics = await this.getPageDiagnostics(page, response, {
        cookieCount: await getCookieCount(page)
      });
      this.logNavigationDiagnostics('Walmart product', diagnostics);

      if (diagnostics.status && diagnostics.status >= 400) {
        throw new Error(`Walmart returned HTTP ${diagnostics.status} for ${url}`);
      }

      if (diagnostics.blocked || diagnostics.verification) {
        throw new Error(`${this.getProviderSpecificBlockHint()} Product navigation was blocked.`);
      }

      return page.evaluate(() => {
        const text = (selector) => document.querySelector(selector)?.textContent?.trim() || 'N/A';
        return {
          title: text('h1, [data-automation-id="product-title"]'),
          price: text('[data-automation-id="product-price"], [itemprop="price"]'),
          description: text('[data-testid="product-description"], [data-automation-id="product-description"]'),
          rating: text('[data-testid*="rating"], [aria-label*="out of 5"]'),
          reviews: text('[data-testid*="review"], [aria-label*="review"]')
        };
      });
    } catch (error) {
      await this.logBrightDataSessionDiagnostics('Walmart product Bright Data session');
      throw new Error(`Failed to get Walmart product details for ${productId}: ${error.message}`);
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

module.exports = WalmartScraper;
