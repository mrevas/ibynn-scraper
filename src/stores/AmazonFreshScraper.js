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
const PRODUCT_SELECTOR = '[data-component-type="s-search-result"][data-asin]';
const PRODUCT_LINK_SELECTOR =
  '[data-component-type="s-search-result"] a[href*="/dp/"], [data-component-type="s-search-result"] a[href*="/gp/product/"]';
const LOCATION_LINK_SELECTOR =
  '#nav-global-location-popover-link, #glow-ingress-block, #nav-packard-glow-loc-icon';
const ZIP_INPUT_SELECTOR = '#GLUXZipUpdateInput, input[name="zipCode"]';
const ZIP_UPDATE_SELECTOR = '#GLUXZipUpdate, input[aria-labelledby="GLUXZipUpdate-announce"]';
const ZIP_DONE_SELECTOR =
  '#GLUXConfirmClose, input[name="glowDoneButton"], button[name="glowDoneButton"], .a-popover-footer button';

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
    this.zipCode = options.zipCode || process.env.AMAZON_FRESH_ZIP || DEFAULT_ZIP_CODE;
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
        signInRequired: false,
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
      signInRequired: diagnostics.signInRequired,
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
    const currentText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (currentText.includes(this.zipCode)) {
      console.log(`[OK] Amazon Fresh location already appears set to ${this.zipCode}`);
      return;
    }

    console.log(`[>] Setting Amazon Fresh delivery location to ZIP ${this.zipCode}`);

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
    const zipInput = await this.waitForVisibleHandle(page, ZIP_INPUT_SELECTOR, 15000);
    if (!zipInput) {
      throw new Error(`Amazon Fresh visible ZIP input was not found after opening location popover.`);
    }

    await zipInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await zipInput.type(this.zipCode, { delay: 60 });
    await humanDelay(500, 1200);

    const updateButton = await this.getVisibleHandle(page, ZIP_UPDATE_SELECTOR);
    if (updateButton) {
      await updateButton.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await humanDelay(1500, 3000);

    const doneButton = await this.getVisibleHandle(page, ZIP_DONE_SELECTOR);
    if (doneButton) {
      await doneButton.click().catch(() => null);
      await humanDelay(800, 1600);
    }

    const diagnostics = await this.getPageDiagnostics(page, null, {
      cookieCount: await getCookieCount(page)
    });
    this.logNavigationDiagnostics('Amazon Fresh location', diagnostics);

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} Location setup was blocked. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    const updatedText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (!updatedText.includes(this.zipCode)) {
      throw new Error(
        `Amazon Fresh location did not update to ZIP ${this.zipCode}. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    console.log(`[OK] Amazon Fresh location set to ZIP ${this.zipCode}`);
  }

  async navigateToSearch(page, query) {
    const searchUrl =
      `https://www.amazon.com/s?i=amazonfresh&k=${encodeURIComponent(query)}` +
      `&almBrandId=QW1hem9uIEZyZXNo`;
    console.log(`[>] Amazon Fresh search: ${searchUrl}`);

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
      await page.waitForSelector(PRODUCT_LINK_SELECTOR, { timeout: 12000 });
      selectorFound = true;
    } catch (error) {
      selectorFound = false;
    }

    let diagnostics = await this.getPageDiagnostics(page, response, {
      navigationError,
      cookieCount: await getCookieCount(page)
    });
    diagnostics.selectorFound = selectorFound;
    this.logNavigationDiagnostics('Amazon Fresh search', diagnostics);
    diagnostics = await this.maybeHandleManualChallenge(page, diagnostics, 'Amazon Fresh search');

    if (diagnostics.selectorFound || diagnostics.noResults) {
      return { diagnostics, searchUrl };
    }

    if (diagnostics.status && diagnostics.status >= 400) {
      throw new Error(
        `Amazon Fresh returned HTTP ${diagnostics.status} for ${searchUrl}. ` +
          `${this.getProviderSpecificBlockHint()} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    if (diagnostics.blocked || diagnostics.verification) {
      throw new Error(
        `${this.getProviderSpecificBlockHint()} finalUrl=${diagnostics.finalUrl} ` +
          `title="${diagnostics.title}" body="${diagnostics.bodySnippet}" html="${diagnostics.htmlSnippet}"`
      );
    }

    if (diagnostics.signInRequired) {
      throw new Error(
        `Amazon Fresh appears to require sign-in or delivery eligibility for ZIP ${this.zipCode}. ` +
          `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" body="${diagnostics.bodySnippet}"`
      );
    }

    throw new Error(
      `Timed out waiting for Amazon Fresh search results on ${searchUrl}. ` +
        `finalUrl=${diagnostics.finalUrl} title="${diagnostics.title}" ` +
        `navigationError=${diagnostics.navigationError || 'none'} body="${diagnostics.bodySnippet}"`
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
        zipCode: this.zipCode,
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
          extensions: [`zip:${this.zipCode}`],
          thumbnail: product.thumbnail,
          primary_offer:
            product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
          seller_name: 'Amazon Fresh'
        }));

      console.log(`[OK] Done - ${products.length} total Amazon Fresh products`);
      return products;
    } catch (error) {
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
