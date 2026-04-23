/**
 * Store Registry
 * Centralized registration of all available store scrapers
 * Makes it easy to add new stores and switch between them
 */

const TargetScraper = require('./TargetScraper');

/**
 * Map of available stores
 * Add new stores here to register them
 */
const STORES = {
  target: {
    name: 'Target',
    scraper: TargetScraper,
    description: 'Target.com product scraper'
  }
  // Future stores:
  // amazon: { name: 'Amazon', scraper: AmazonScraper, ... },
  // walmart: { name: 'Walmart', scraper: WalmartScraper, ... },
  // bestbuy: { name: 'Best Buy', scraper: BestBuyScraper, ... }
};

/**
 * Get a store scraper by name
 * @param {string} storeName - Name of the store (e.g., 'target', 'amazon')
 * @param {object} options - Options to pass to scraper
 * @returns {Object} Scraper instance
 */
function getScraper(storeName = 'target', options = {}) {
  const store = STORES[storeName.toLowerCase()];
  if (!store) {
    throw new Error(
      `Unknown store: ${storeName}. Available stores: ${Object.keys(STORES).join(', ')}`
    );
  }
  return new store.scraper(options);
}

/**
 * List all available stores
 * @returns {array} Array of store info
 */
function listStores() {
  return Object.entries(STORES).map(([key, value]) => ({
    key,
    name: value.name,
    description: value.description
  }));
}

module.exports = {
  getScraper,
  listStores,
  STORES
};
