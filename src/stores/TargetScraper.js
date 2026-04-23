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
    const { limit = 30, sort = 'relevance' } = options;

    if (!this.browser) {
      await this.init();
    }

    let page;
    try {
      page = await this.browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      );

      // Navigate to Target search
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`;
      console.log(`[→] Searching for: "${query}"`);
      
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: this.timeout });

      // Wait for product links to load
      try {
        await page.waitForSelector('a[href*="/p/"]', { timeout: 10000 });
      } catch (e) {
        console.log('[⚠] No products found on page');
      }

      // Extract product data from links
      const products = await page.evaluate(() => {
        const items = [];
        const links = document.querySelectorAll('a[href*="/p/"]');

        // Group links by parent container to avoid duplicates
        const seenUrls = new Set();

        links.forEach((link) => {
          try {
            const url = link.href;
            
            // Skip duplicates
            if (seenUrls.has(url)) return;
            seenUrls.add(url);

            // Get product ID from URL - extract the actual product ID
            const idMatch = url.match(/\/A-(\d+)/);
            const productId = idMatch ? idMatch[1] : url.match(/\/p\/([^/?-]+)/)?.[1] || 'N/A';

            let name = 'N/A';
            
            // Extract product name from URL slug (most reliable method)
            const slug = url.split('/p/')[1]?.split('/')[0];
            if (slug) {
              // Clean up the slug: replace hyphens with spaces and capitalize
              name = slug
                .split('-')
                .filter(word => word.length > 1 || /\d/.test(word)) // Filter out single letters
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ')
                .substring(0, 200);
            }
            
            // Fallback: try to find from DOM elements
            if (!name || name.length < 3) {
              let container = link.closest('div');
              if (container) {
                // Look for h3, h2, or any heading
                const heading = container.querySelector('h3, h2, h1');
                if (heading?.innerText?.trim()?.length > 3) {
                  name = heading.innerText.trim();
                }
              }
              
              // Last resort: use link title
              if (!name && link.title?.trim()?.length > 3) {
                name = link.title.trim();
              }
            }

            // Ensure name is set
            name = (name || 'N/A').substring(0, 250).trim();

            // Get price from nearby elements in parent container
            let price = 'N/A';
            let container = link.closest('div');
            if (container) {
              // Look for price pattern
              const priceText = container.innerText;
              const priceMatch = priceText?.match(/\$[\d,]+\.?\d{0,2}/);
              price = priceMatch ? priceMatch[0] : 'N/A';
            }

            // Get rating from parent container
            let rating = 'N/A';
            if (container) {
              const ratingEl = container.querySelector('[role="img"][aria-label*="star"], [aria-label*="star"], [class*="rating"]');
              if (ratingEl) {
                rating = ratingEl.getAttribute('aria-label') || ratingEl.innerText?.trim() || 'N/A';
              }
            }

            // Get image
            let image = 'N/A';
            if (container) {
              const imgEl = container.querySelector('img');
              image = imgEl?.src || imgEl?.dataset?.src || 'N/A';
            }

            // Only add if we have name and valid URL
            if (name !== 'N/A' && url) {
              items.push({
                name,
                price,
                rating,
                url,
                image,
                productId
              });
            }
          } catch (err) {
            // Skip this product
          }
        });

        return items;
      });

      console.log(`[✓] Found ${products.length} products`);
      return products.slice(0, limit);

    } catch (error) {
      console.error('[✗] Search error:', error.message);
      throw error;
    } finally {
      if (page) {
        await page.close();
      }
    }
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
