const BaseScraper = require('./BaseScraper');
const config = require('../../config');
const { createBrowser, getBrowserProvider } = require('../browser');

const SEARCH_LINK_SELECTOR = 'a[href*="/p/"]';
const PRODUCT_TITLE_SELECTOR = '[data-test="@web/ProductTitle"]';

/**
 * Target.com Scraper
 * Extends BaseScraper to provide Target-specific functionality
 */
class TargetScraper extends BaseScraper {
  constructor(options = {}) {
    super('Target', options);
    this.provider = getBrowserProvider(options);
    this.headless =
      typeof options.headless === 'boolean' ? options.headless : config.browser.headless;
    this.timeout = options.timeout || config.browser.timeout;
    this.browserWSEndpoint = options.browserWSEndpoint;
  }

  /**
   * Initialize browser
   */
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

  /**
   * Close browser
   */
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

    if (response && response.status() >= 400) {
      throw new Error(`Target returned HTTP ${response.status()} for ${url}`);
    }

    try {
      await page.waitForSelector(SEARCH_LINK_SELECTOR, { timeout: this.timeout });
      return;
    } catch (error) {
      const pageState = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() || '';
        return {
          title: document.title,
          noResults:
            text.includes('no results') ||
            text.includes('0 results') ||
            text.includes('did not match any products'),
          blocked:
            text.includes('access denied') ||
            text.includes('verify you are human') ||
            text.includes('captcha')
        };
      });

      if (pageState.noResults) {
        return;
      }

      if (pageState.blocked) {
        throw new Error(`Target blocked the session while loading ${url}`);
      }

      throw new Error(
        `Timed out waiting for Target search results on ${url} (title: ${pageState.title || 'unknown'})`
      );
    }
  }

  async navigateToProduct(page, url) {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.timeout
    });

    if (response && response.status() >= 400) {
      throw new Error(`Target returned HTTP ${response.status()} for ${url}`);
    }

    await page.waitForSelector(PRODUCT_TITLE_SELECTOR, { timeout: this.timeout });
  }

  /**
   * Search for products on Target
   * @param {string} query - Search term
   * @param {object} options - Additional options (limit, sort, etc.)
   * @returns {array} Array of product objects
   */
  async search(query, options = {}) {
    const { limit = 30, pages = 1 } = options;
    const resultsPerPage = 24;
    const allRaw = [];
    const seenUrls = new Set();

    for (let pageNum = 1; pageNum <= pages; pageNum++) {
      const offset = (pageNum - 1) * resultsPerPage;
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}${offset > 0 ? `&Nao=${offset}` : ''}`;
      console.log(`[>] Page ${pageNum}/${pages}: ${searchUrl}`);

      let tab;
      try {
        tab = await this.getPage();
        await this.navigateToSearch(tab, searchUrl);

        const pageRaw = await tab.evaluate(() => {
          const items = [];
          const links = document.querySelectorAll('a[href*="/p/"]');

          links.forEach((link) => {
            try {
              const url = link.href;

              if (
                link.closest('[data-test="recommended-products-carousel"]') ||
                link.closest('[data-test="productCardVariantMini"]')
              ) {
                return;
              }

              const idMatch = url.match(/\/A-(\d+)/);
              const productId = idMatch ? idMatch[1] : url.match(/\/p\/([^/?-]+)/)?.[1] || 'N/A';

              let name = 'N/A';
              const slug = url.split('/p/')[1]?.split('/')[0];
              if (slug) {
                name = slug
                  .split('-')
                  .filter((word) => word.length > 1 || /\d/.test(word))
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')
                  .substring(0, 200);
              }
              if (!name || name.length < 3) {
                name = link.title?.trim() || link.getAttribute('aria-label')?.trim() || 'N/A';
              }
              name = (name || 'N/A').substring(0, 250).trim();

              let container = link.closest('li') || link.closest('article');
              if (!container) {
                let el = link.parentElement;
                for (let i = 0; i < 10; i++) {
                  if (!el) break;
                  if (el.tagName === 'LI' || (el.offsetHeight > 150 && el.offsetWidth > 100)) {
                    container = el;
                    break;
                  }
                  el = el.parentElement;
                }
              }

              let price = null;
              let extractedPrice = null;
              const priceWrapper = document.getElementById(`product-card-price-${productId}`);
              const priceEl = priceWrapper?.querySelector('[data-test="current-price"]');
              const priceText = priceEl?.textContent?.trim();
              if (priceText) {
                price = priceText;
                const firstMatch = priceText.match(/\$([\d,]+\.?\d{0,2})/);
                if (firstMatch) extractedPrice = parseFloat(firstMatch[1].replace(',', ''));
              }

              let rating = null;
              let reviews = null;
              if (container) {
                const ratingEl = container.querySelector(
                  '[aria-label*="out of"], [aria-label*="star"], [aria-label*="rating"]'
                );
                if (ratingEl) {
                  const label = ratingEl.getAttribute('aria-label') || '';
                  const rMatch = label.match(/([\d.]+)\s*out of/i) || label.match(/^([\d.]+)/);
                  const rvMatch = label.match(/([\d,]+)\s*review/i);
                  if (rMatch) rating = parseFloat(rMatch[1]);
                  if (rvMatch) reviews = parseInt(rvMatch[1].replace(',', ''));
                }
              }

              let thumbnail = null;
              if (container) {
                const imgEl = container.querySelector('img');
                thumbnail = imgEl?.src || imgEl?.dataset?.src || null;
              }

              if (name !== 'N/A' && url) {
                items.push({ name, price, extractedPrice, rating, reviews, url, thumbnail, productId });
              }
            } catch (error) {
              // Skip malformed cards.
            }
          });

          return items;
        });

        for (const product of pageRaw) {
          if (!seenUrls.has(product.url)) {
            seenUrls.add(product.url);
            allRaw.push(product);
          }
        }

        console.log(`[OK] Page ${pageNum}: ${pageRaw.length} products (total so far: ${allRaw.length})`);
      } catch (error) {
        throw new Error(`Target search failed on page ${pageNum} for "${query}": ${error.message}`);
      } finally {
        if (tab) {
          await tab.close();
        }
      }

      if (allRaw.length >= limit) break;
    }

    const products = allRaw.slice(0, limit).map((product, index) => ({
      position: index + 1,
      title: product.name,
      product_id: product.productId,
      product_link: product.url,
      source: 'Target',
      source_icon: 'https://www.target.com/favicon.ico',
      price: product.price,
      extracted_price: product.extractedPrice,
      rating: product.rating,
      reviews: product.reviews,
      extensions: [],
      thumbnail: product.thumbnail,
      primary_offer: product.extractedPrice != null ? { offer_price: product.extractedPrice } : null,
      seller_name: 'Target'
    }));

    console.log(`[OK] Done - ${products.length} total products`);
    return products;
  }

  /**
   * Get product details
   * @param {string} productId - Target product ID
   * @returns {object} Product details
   */
  async getProductDetails(productId) {
    let page;
    try {
      page = await this.getPage();

      const url = `https://www.target.com/p/${productId}`;
      console.log(`[>] Fetching product details for ID: ${productId}`);

      await this.navigateToProduct(page, url);

      const details = await page.evaluate(() => {
        const title = document.querySelector('[data-test="@web/ProductTitle"]')?.textContent?.trim() || 'N/A';
        const price = document.querySelector('[data-test="@web/ProductPrice"]')?.textContent?.trim() || 'N/A';
        const description = document.querySelector('[data-test="@web/ProductDescription"]')?.textContent?.trim() || 'N/A';
        const rating = document.querySelector('[data-test="@web/ProductRating"]')?.textContent?.trim() || 'N/A';
        const reviews = document.querySelector('[data-test="@web/ProductReviews"]')?.textContent?.trim() || 'N/A';

        return { title, price, description, rating, reviews };
      });

      console.log('[OK] Product details retrieved');
      return details;
    } catch (error) {
      throw new Error(`Failed to get Target product details for ${productId}: ${error.message}`);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Search with filters
   * @param {string} query - Search term
   * @param {object} filters - Filter options (priceMin, priceMax, rating, etc.)
   * @returns {array} Filtered products
   */
  async searchWithFilters(query, filters = {}, options = {}) {
    const products = await this.search(query, options);

    return products.filter((product) => {
      if (filters.minRating) {
        const rating = parseFloat(product.rating?.[0] || 0);
        if (rating < filters.minRating) return false;
      }

      if (filters.priceMin || filters.priceMax) {
        const priceStr = product.price?.replace('$', '').split('-')[0] || '0';
        const price = parseFloat(priceStr);
        if (filters.priceMin && price < filters.priceMin) return false;
        if (filters.priceMax && price > filters.priceMax) return false;
      }

      return true;
    });
  }
}

module.exports = TargetScraper;
