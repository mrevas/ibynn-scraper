/**
 * Configuration file for Target Scraper
 * Edit this file to customize default settings
 */

module.exports = {
  // Browser settings
  browser: {
    headless: true,
    timeout: 30000,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  },

  // Default search settings
  search: {
    limit: 30,
    sort: 'relevance'
  },

  // Results folder settings
  results: {
    folder: './results',
    subfolder: 'target',
    format: 'json'
  },

  // Retry settings
  retry: {
    enabled: true,
    maxAttempts: 3,
    delayMs: 1000
  },

  // Output settings
  output: {
    format: 'json', // 'json' or 'csv'
    saveResults: true,
    filename: null // auto-generated if null
  },

  // Filter presets
  filters: {
    budget: {
      minRating: 3.5,
      priceMin: 0,
      priceMax: 100
    },
    midRange: {
      minRating: 4.0,
      priceMin: 100,
      priceMax: 300
    },
    premium: {
      minRating: 4.5,
      priceMin: 300,
      priceMax: Infinity
    }
  },

  // User agent to use
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',

  // Request delay (in ms) for polite scraping
  delayBetweenRequests: 0,

  // Logging
  logging: {
    verbose: true,
    logFile: null // Set to filename to log to file
  }
};
