# Project Structure & Architecture

## Overview
This project is designed to be easily extensible with support for multiple store scrapers. The architecture uses a store adapter pattern that makes it easy to add new stores in the future.

## Directory Structure

```
ibynn-scraper/
├── src/
│   ├── scraper.js                 # Main export (re-exports TargetScraper for backward compatibility)
│   ├── cli.js                     # Command-line interface
│   ├── utils.js                   # Utility functions (filtering, exporting, etc.)
│   ├── stores/
│   │   ├── index.js              # Store registry and factory pattern
│   │   ├── BaseScraper.js        # Abstract base class for all scrapers
│   │   └── TargetScraper.js      # Target.com scraper implementation
│   └── examples/
│       ├── test.js               # Basic usage examples
│       ├── advanced.js           # Advanced features
│       └── batch.js              # Batch scraping template
├── results/
│   └── target/                   # Results organized by store
│       ├── laptop_2026-04-23.json
│       ├── keyboard_2026-04-23.json
│       └── ...
├── config.js                      # Global configuration
├── package.json                   # Dependencies
└── README.md                      # Documentation
```

## Key Components

### 1. Store Registry (`src/stores/index.js`)
Centralized registration of all available stores. When adding a new store:

```javascript
const STORES = {
  target: {
    name: 'Target',
    scraper: TargetScraper,
    description: 'Target.com product scraper'
  },
  // Add new stores here
  amazon: {
    name: 'Amazon',
    scraper: AmazonScraper,
    description: 'Amazon.com product scraper'
  },
  walmart: {
    name: 'Walmart',
    scraper: WalmartScraper,
    description: 'Walmart.com product scraper'
  }
};
```

Use the factory function:
```javascript
const { getScraper } = require('./stores');
const scraper = getScraper('amazon'); // Get Amazon scraper
const scraper = getScraper('target'); // Get Target scraper
```

### 2. Base Scraper Class (`src/stores/BaseScraper.js`)
All store scrapers extend this class. It defines the interface that every scraper must implement:

```javascript
class MyScraper extends BaseScraper {
  constructor(options = {}) {
    super('My Store', options);
  }

  async init() { /* implementation */ }
  async close() { /* implementation */ }
  async search(query, options) { /* implementation */ }
  async searchWithFilters(query, filters, options) { /* implementation */ }
  async getProductDetails(productId) { /* implementation */ }
}
```

### 3. Configuration (`config.js`)
Centralized configuration for all stores:

```javascript
module.exports = {
  browser: { /* global browser settings */ },
  search: { limit: 30, sort: 'relevance' },
  results: {
    folder: './results',
    subfolder: 'target',  // Change to store name
    format: 'json'        // or 'csv'
  }
};
```

## Adding a New Store

### Step 1: Create Store Scraper
Create `src/stores/AmazonScraper.js`:

```javascript
const BaseScraper = require('./BaseScraper');
const { createBrowser } = require('../browser');

class AmazonScraper extends BaseScraper {
  constructor(options = {}) {
    super('Amazon', options);
  }

  async init() {
    // Initialize local Puppeteer or Bright Data Browser API session
  }

  async close() {
    // Close browser
  }

  async search(query, options = {}) {
    const { limit = 30 } = options;
    // Scrape Amazon search results
    // Return array of products with: name, price, rating, url, image, productId
  }

  async searchWithFilters(query, filters = {}, options = {}) {
    const products = await this.search(query, options);
    // Apply client-side filters
    return filtered;
  }

  async getProductDetails(productId) {
    // Fetch detailed product info
  }
}

module.exports = AmazonScraper;
```

### Step 2: Register Store
Edit `src/stores/index.js`:

```javascript
const AmazonScraper = require('./AmazonScraper');

const STORES = {
  target: { /* ... */ },
  amazon: {
    name: 'Amazon',
    scraper: AmazonScraper,
    description: 'Amazon.com product scraper'
  }
};
```

### Step 3: Create CLI for New Store (Optional)
You can create store-specific CLIs:

Create `src/cli-amazon.js`:

```javascript
const { getScraper } = require('./stores');
const scraper = getScraper('amazon');

// Similar logic to src/cli.js but for Amazon
```

Update `package.json`:
```json
{
  "scripts": {
    "scrape": "node src/cli.js",
    "scrape:target": "node src/cli.js",
    "scrape:amazon": "node src/cli-amazon.js"
  }
}
```

### Step 4: Update Results Configuration
If you want separate result folders per store, update `config.js` or create per-store config.

## Product Data Format

All scrapers should return products in this standardized format:

```javascript
{
  name: "Product Name",
  price: "$99.99",
  rating: "4.5 out of 5 stars",
  url: "https://...",
  image: "https://...",
  productId: "123456"
}
```

This consistent format ensures utilities and downstream processors work across all stores.

## Results Organization

Results are saved in organized folders:

```
results/
├── target/
│   ├── laptop_2026-04-23.json
│   ├── keyboard_2026-04-23.json
│   └── headphones_2026-04-23.json
├── amazon/        (When Amazon scraper is added)
│   ├── laptop_2026-04-23.json
│   └── ...
└── walmart/       (When Walmart scraper is added)
    └── ...
```

Filenames follow pattern: `{query}_{date}.json`

## Using Different Stores

```javascript
const { getScraper } = require('./src/stores');

// Get Target scraper
const target = getScraper('target');
await target.init();
const products = await target.search('laptop', { limit: 30 });
await target.close();

// Get Amazon scraper (when added)
const amazon = getScraper('amazon');
await amazon.init();
const products = await amazon.search('laptop', { limit: 30 });
await amazon.close();
```

## Configuration per Store

For store-specific configurations, you can also pass options:

```javascript
const config = require('./config');

// Global config for all stores
const defaultLimit = config.search.limit;

// Or per-store config
const storeConfigs = {
  target: { limit: 30, timeout: 30000 },
  amazon: { limit: 50, timeout: 45000 },
  walmart: { limit: 20, timeout: 35000 }
};
```

## Testing

Each store scraper should have tests. Example structure:

```
tests/
├── target.test.js
├── amazon.test.js  (when added)
└── utils.test.js
```

## Best Practices

1. **Keep stores independent** - Each scraper should not depend on others
2. **Consistent API** - All scrapers implement the same interface
3. **Error handling** - Each scraper should handle its own errors gracefully
4. **Rate limiting** - Add delays between requests to be polite to servers
5. **Configuration** - Use config.js for customization
6. **Logging** - Use consistent log format with [✓], [✗], [→], etc.

## Future Enhancements

- [ ] Database integration to store results
- [ ] Scheduling (cron jobs for regular scraping)
- [ ] Web API/Dashboard to view results
- [ ] Multi-store price comparison
- [ ] Change notifications (price drops, etc.)
- [ ] Export formats (CSV, Excel, PDF)
- [ ] Cloud storage integration (S3, GCS)
