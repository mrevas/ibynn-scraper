const { chromium } = require('playwright');
const BaseScraper = require('./BaseScraper');
const config = require('../../config');

/**
 * Target.com Scraper
 * Extends BaseScraper to provide Target-specific functionality
 */
class TargetScraper extends BaseScraper {
  constructor(options = {}) {
    super('Target', options);
  }

  /**
   * Initialize browser
   */
  async init() {
    try {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: config.browser.args
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: config.userAgent
      });
      console.log('[OK] Browser initialized');
    } catch (error) {
      console.error('[X] Failed to initialize browser:', error.message);
      throw error;
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[OK] Browser closed');
    }
  }

  async getPage() {
    if (!this.browser || !this.context) {
      await this.init();
    }
    return this.context.newPage();
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
        await tab.goto(searchUrl, { waitUntil: 'networkidle', timeout: this.timeout });

        if (pageNum === 1) {
          console.log('[..] Pausing briefly for first-page rendering...');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        try {
          await tab.waitForSelector('a[href*="/p/"]', { timeout: 10000 });
        } catch (error) {
          console.log(`[!] No products found on page ${pageNum}`);
        }

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
        console.error(`[X] Error on page ${pageNum}:`, error.message);
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

      await page.goto(url, { waitUntil: 'networkidle', timeout: this.timeout });

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
      console.error('[X] Failed to get product details:', error.message);
      throw error;
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
