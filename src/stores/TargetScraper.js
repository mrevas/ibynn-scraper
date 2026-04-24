const puppeteer = require('puppeteer');
const BaseScraper = require('./BaseScraper');

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
      this.browser = await puppeteer.launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      console.log('[✓] Browser initialized');
    } catch (error) {
      console.error('[✗] Failed to initialize browser:', error.message);
      throw error;
    }
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('[✓] Browser closed');
    }
  }

  /**
   * Search for products on Target
   * @param {string} query - Search term
   * @param {object} options - Additional options (limit, sort, etc.)
   * @returns {array} Array of product objects
   */
  async search(query, options = {}) {
    const { limit = 30, pages = 1 } = options;
    const RESULTS_PER_PAGE = 24;

    if (!this.browser) {
      await this.init();
    }

    const allRaw = [];
    const seenUrls = new Set();

    for (let pageNum = 1; pageNum <= pages; pageNum++) {
      const offset = (pageNum - 1) * RESULTS_PER_PAGE;
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}${offset > 0 ? `&Nao=${offset}` : ''}`;
      console.log(`[→] Page ${pageNum}/${pages}: ${searchUrl}`);

      let tab;
      try {
        tab = await this.browser.newPage();
        await tab.setViewport({ width: 1280, height: 720 });
        await tab.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await tab.goto(searchUrl, { waitUntil: 'networkidle2', timeout: this.timeout });

        if (pageNum === 1) {
          console.log('[⏸] Pausing — check the browser...');
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        try {
          await tab.waitForSelector('a[href*="/p/"]', { timeout: 10000 });
        } catch (e) {
          console.log(`[⚠] No products found on page ${pageNum}`);
        }

        const pageRaw = await tab.evaluate(() => {
          const items = [];
          const links = document.querySelectorAll('a[href*="/p/"]');

          links.forEach((link) => {
            try {
              const url = link.href;

              // Skip recommendation carousels and mini cards (e.g. "Deals" carousel)
              // but keep "More Results" grid links which are plain product cards
              if (link.closest('[data-test="recommended-products-carousel"]') ||
                  link.closest('[data-test="productCardVariantMini"]')) return;

              const idMatch = url.match(/\/A-(\d+)/);
              const productId = idMatch ? idMatch[1] : url.match(/\/p\/([^/?-]+)/)?.[1] || 'N/A';

              // Name from URL slug
              let name = 'N/A';
              const slug = url.split('/p/')[1]?.split('/')[0];
              if (slug) {
                name = slug
                  .split('-')
                  .filter(word => word.length > 1 || /\d/.test(word))
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ')
                  .substring(0, 200);
              }
              if (!name || name.length < 3) {
                name = link.title?.trim() || link.getAttribute('aria-label')?.trim() || 'N/A';
              }
              name = (name || 'N/A').substring(0, 250).trim();

              // Card container
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

              // Price via Target's predictable id="product-card-price-{productId}"
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

              // Rating and review count
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

              // Thumbnail
              let thumbnail = null;
              if (container) {
                const imgEl = container.querySelector('img');
                thumbnail = imgEl?.src || imgEl?.dataset?.src || null;
              }

              if (name !== 'N/A' && url) {
                items.push({ name, price, extractedPrice, rating, reviews, url, thumbnail, productId });
              }
            } catch (err) {
              // skip
            }
          });

          return items;
        });

        // Cross-page dedup
        for (const p of pageRaw) {
          if (!seenUrls.has(p.url)) {
            seenUrls.add(p.url);
            allRaw.push(p);
          }
        }

        console.log(`[✓] Page ${pageNum}: ${pageRaw.length} products (total so far: ${allRaw.length})`);
      } catch (error) {
        console.error(`[✗] Error on page ${pageNum}:`, error.message);
      } finally {
        if (tab) await tab.close();
      }

      if (allRaw.length >= limit) break;
    }

    const products = allRaw.slice(0, limit).map((p, i) => ({
      position: i + 1,
      title: p.name,
      product_id: p.productId,
      product_link: p.url,
      source: 'Target',
      source_icon: 'https://www.target.com/favicon.ico',
      price: p.price,
      extracted_price: p.extractedPrice,
      rating: p.rating,
      reviews: p.reviews,
      extensions: [],
      thumbnail: p.thumbnail,
      primary_offer: p.extractedPrice != null ? { offer_price: p.extractedPrice } : null,
      seller_name: 'Target'
    }));

    console.log(`[✓] Done — ${products.length} total products`);
    return products;
  }

  /**
   * Get product details
   * @param {string} productId - Target product ID
   * @returns {object} Product details
   */
  async getProductDetails(productId) {
    if (!this.browser) {
      await this.init();
    }

    let page;
    try {
      page = await this.browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      const url = `https://www.target.com/p/${productId}`;
      console.log(`[→] Fetching product details for ID: ${productId}`);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: this.timeout });

      const details = await page.evaluate(() => {
        const title = document.querySelector('[data-test="@web/ProductTitle"]')?.textContent?.trim() || 'N/A';
        const price = document.querySelector('[data-test="@web/ProductPrice"]')?.textContent?.trim() || 'N/A';
        const description = document.querySelector('[data-test="@web/ProductDescription"]')?.textContent?.trim() || 'N/A';
        const rating = document.querySelector('[data-test="@web/ProductRating"]')?.textContent?.trim() || 'N/A';
        const reviews = document.querySelector('[data-test="@web/ProductReviews"]')?.textContent?.trim() || 'N/A';

        return { title, price, description, rating, reviews };
      });

      console.log('[✓] Product details retrieved');
      return details;

    } catch (error) {
      console.error('[✗] Failed to get product details:', error.message);
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

    // Client-side filtering
    return products.filter((product) => {
      // Rating filter
      if (filters.minRating) {
        const rating = parseFloat(product.rating?.[0] || 0);
        if (rating < filters.minRating) return false;
      }

      // Price filter
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
