/**
 * Main Scraper Export
 * 
 * This file provides backward compatibility. 
 * New code should import directly from ./stores/TargetScraper
 * 
 * Structure:
 * - src/stores/BaseScraper.js - Base class for all scrapers
 * - src/stores/TargetScraper.js - Target-specific implementation
 * - src/stores/index.js - Store registry and factory
 */

const TargetScraper = require('./stores/TargetScraper');

// Export for backward compatibility
module.exports = TargetScraper;
