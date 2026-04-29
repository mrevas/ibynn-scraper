const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');

const SEARCH_LINK_SELECTOR = 'a[href*=".product."]';
const PRODUCT_TITLE_SELECTOR = 'h1, [data-testid*="product-name"], [class*="product-name"]';

class CostcoScraper extends BaseScraper {
  constructor(options = {}) {
    super('Costco', options);
    this.provider = getBrowserProvider(options);
    this.headless =
      typeof options.headless === 'boolean' ? options.headless : config.browser.headless;
    this.timeout = options.timeout || config.browser.timeout;
    this.browserWSEndpoint = options.browserWSEndpoint;
  }

  async init() {
    try {
      this.browser = await createBrowser({
        provider: this.provider,
        headless: this.headless,
        timeout: this.timeout,
        browserWSEndpoint: this.browserWSEndpoint
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
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(config.userAgent);
    page.setDefaultNavigationTimeout(this.timeout);
    page.setDefaultTimeout(this.timeout);
    return page;
  }

  async navigateToSearch(page, url) {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });

    try {
      await page.waitForSelector(SEARCH_LINK_SELECTOR, { timeout: this.timeout });
      return;
    } catch (error) {
      const pageState = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() || '';
        return {
          title: document.title,
          body: text,
          noResults:
            text.includes('no results') ||
            text.includes('0 results') ||
            text.includes('did not match any products'),
          blocked:
            text.includes('access denied') ||
            text.includes("you don't have permission") ||
            text.includes('verify you are human') ||
            text.includes('captcha')
        };
      });

      if (pageState.noResults) {
        return;
      }

      const status = response && typeof response.status === 'function' ? response.status() : null;
      if (status && status >= 400) {
        if (status === 403) {
          throw new Error(
            `Costco returned HTTP 403 for ${url}. Bright Data mode is recommended for Costco.`
          );
        }
        throw new Error(`Costco returned HTTP ${status} for ${url}`);
      }

      if (pageState.blocked) {
        throw new Error(
          `Costco blocked the session while loading ${url}. Bright Data mode is recommended for Costco.`
        );
      }

      throw new Error(
        `Timed out waiting for Costco search results on ${url} (title: ${pageState.title || 'unknown'})`
      );
    }
  }

  async navigateToProduct(page, url) {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });

    const status = response && typeof response.status === 'function' ? response.status() : null;
    if (status && status >= 400) {
      throw new Error(`Costco returned HTTP ${status} for ${url}`);
    }

    await page.waitForSelector(PRODUCT_TITLE_SELECTOR, { timeout: this.timeout });
  }

  async search(query, options = {}) {
    const { limit = 30 } = options;
    const searchUrl = `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(query)}`;
    const seenUrls = new Set();

    let page;
    try {
      page = await this.getPage();
      console.log(`[>] Costco search: ${searchUrl}`);
      await this.navigateToSearch(page, searchUrl);

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
          price: getText([
            '[data-testid*="price"]',
            '[class*="price"]',
            '[id*="price"]'
          ]),
          description: getText([
            '[data-testid*="description"]',
            '[class*="description"]',
            '#product-details',
            '.product-details'
          ]),
          rating: getText([
            '[aria-label*="Rated"]',
            '[data-testid*="rating"]',
            '[class*="rating"]'
          ]),
          reviews: getText([
            '[data-testid*="review"]',
            '[class*="review"]'
          ])
        };
      });

      console.log('[OK] Costco product details retrieved');
      return details;
    } catch (error) {
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
