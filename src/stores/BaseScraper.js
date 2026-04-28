/**
 * Base Scraper Adapter
 * All store scrapers should extend this class
 */

class BaseScraper {
  constructor(storeName, options = {}) {
    this.storeName = storeName;
    this.headless = options.headless !== false;
    this.timeout = options.timeout || 30000;
    this.browser = null;
    this.context = null;
  }

  /**
   * Initialize browser
   */
  async init() {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Close browser
   */
  async close() {
    throw new Error('close() must be implemented by subclass');
  }

  /**
   * Search for products
   */
  async search(query, options = {}) {
    throw new Error('search() must be implemented by subclass');
  }

  /**
   * Apply filters to products
   */
  async searchWithFilters(query, filters = {}, options = {}) {
    throw new Error('searchWithFilters() must be implemented by subclass');
  }

  /**
   * Get detailed product info
   */
  async getProductDetails(productId) {
    throw new Error('getProductDetails() must be implemented by subclass');
  }
}

module.exports = BaseScraper;
