const TargetScraper = require('./stores/TargetScraper');
const CostcoScraper = require('./stores/CostcoScraper');
const { getScraper, listStores, STORES } = require('./stores');

// Default export: TargetScraper (for require('ibynn-target-scraper'))
module.exports = TargetScraper;

// Named exports (for destructured require)
module.exports.TargetScraper = TargetScraper;
module.exports.CostcoScraper = CostcoScraper;
module.exports.getScraper = getScraper;
module.exports.listStores = listStores;
module.exports.STORES = STORES;
