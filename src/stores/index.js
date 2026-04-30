/**
 * Store Registry
 * Centralized registration of all available store scrapers
 * Makes it easy to add new stores and switch between them
 */

const TargetScraper = require('./TargetScraper');
const CostcoScraper = require('./CostcoScraper');
const WalmartScraper = require('./WalmartScraper');
const AmazonFreshScraper = require('./AmazonFreshScraper');

/**
 * Map of available stores
 * Add new stores here to register them
 */
const STORES = {
  target: {
    name: 'Target',
    scraper: TargetScraper,
    description: 'Target.com product scraper'
  },
  costco: {
    name: 'Costco',
    scraper: CostcoScraper,
    description: 'Costco.com product scraper'
  },
  walmart: {
    name: 'Walmart',
    scraper: WalmartScraper,
    description: 'Walmart.com product scraper'
  },
  amazonfresh: {
    name: 'Amazon Fresh',
    scraper: AmazonFreshScraper,
    description: 'Amazon Fresh product scraper'
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
function normalizeStoreName(storeName) {
  return storeName.toLowerCase().replace(/[\s_-]+/g, '');
}

function getScraper(storeName = 'target', options = {}) {
  const store = STORES[normalizeStoreName(storeName)];
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
