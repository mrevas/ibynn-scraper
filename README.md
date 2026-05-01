# Target Search Scraper

A powerful, modular Node.js web scraper for Target.com, Costco.com, Walmart.com, and Amazon Fresh product searches with support for both local Chromium and Bright Data Browser API sessions.

## Features

- 🔍 Search products by keyword (default: 30 results)
- 📊 Extract product details (name, price, rating, URL, image, product ID)
- 🎯 Filter results by rating and price
- 📄 Get detailed product information
- 💾 Save results to organized folders (by store/query)
- 🤖 Headless browser automation
- ⚙️ Modular architecture for easy store expansion
- 📦 Designed for future multi-store integration

## Quick Start

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ibynn-scraper.git
cd ibynn-scraper
```

2. Install dependencies:
```bash
npm install
```

If you are updating an existing checkout from the older Playwright-based version, delete `node_modules` and `package-lock.json`, then run:
```bash
npm install
```

### Browser Providers

The scraper supports two browser providers selected via environment variables:

- `local`
- `brightdata`

Local mode:
```bash
TARGET_SCRAPER_PROVIDER=local
```

Bright Data mode:
```bash
TARGET_SCRAPER_PROVIDER=brightdata
BRIGHTDATA_AUTH=username:password
```

Optional Bright Data override:
```bash
BRIGHTDATA_BROWSER_WS=wss://username:password@brd.superproxy.io:9222
```

Optional production timeout:
```bash
TARGET_SCRAPER_TIMEOUT=60000
```

Optional Bright Data session diagnostics:
```bash
BRIGHTDATA_API_KEY=your_brightdata_api_key
```

When `BRIGHTDATA_API_KEY` is set, scraper failures log the Bright Data Browser API session details, including session status, end URL, navigation count, captcha status, bandwidth, and provider-side errors.

### Usage

Search for products (defaults to 30 results):
```bash
npm run scrape -- "gaming laptop"
```

Search with custom limit:
```bash
npm run scrape -- "wireless headphones" 50
```

Example Bright Data run:
```bash
TARGET_SCRAPER_PROVIDER=brightdata BRIGHTDATA_AUTH=username:password npm run scrape -- "gaming laptop" 10 1
```

Costco via the store registry:
```javascript
const { getScraper } = require('./src/stores');
const scraper = getScraper('costco');
```

Amazon Fresh CLI:
```bash
npm run amazonfresh:scrape -- "milk" 10
```

Amazon Fresh submits preferred ZIP `11435` by default, then accepts any configured Queens ZIP match.
Override the preferred ZIP with:
```bash
node src/amazon-fresh-cli.js "milk" 10 --zip=11435
```

Amazon Fresh acceptable Queens ZIP rules:
```bash
AMAZON_FRESH_ZIP=11435
AMAZON_FRESH_ACCEPTABLE_ZIP_PREFIXES=111,113,114,116
AMAZON_FRESH_ACCEPTABLE_ZIP_CODES=11004,11005
```

The preferred ZIP is what the scraper submits first. Confirmation succeeds if Amazon resolves the
location to any ZIP matching the acceptable prefixes or exact ZIP list.

Amazon Fresh local manual-challenge/headful mode:
```bash
node src/amazon-fresh-cli.js "milk" 10 --manual-challenge --user-agent=auto --user-data-dir=".chrome-amazonfresh-debug" --zip=11435
```

Costco CLI:
```bash
npm run costco:scrape -- "milk" 10
```

Costco local manual-challenge/headful mode:
```bash
node src/costco-cli.js "milk" 10 --manual-challenge --user-agent=auto --user-data-dir=".chrome-costco-debug"
```

Walmart CLI:
```bash
npm run walmart:scrape -- "milk" 10
```

Walmart local headful debugging:
```bash
node src/walmart-cli.js "milk" 10 --headful
```

Walmart with system Chrome and a persistent debug profile:
```bash
node src/walmart-cli.js "milk" 10 --headful --executable-path="C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir=".chrome-walmart-debug"
```

Walmart local manual-challenge mode:
```bash
node src/walmart-cli.js "milk" 10 --manual-challenge --user-agent=auto --user-data-dir=".chrome-walmart-debug"
```

When Amazon Fresh, Costco, or Walmart shows a challenge page, solve it in the opened browser, then press Enter in the terminal. The scraper will reuse the same browser/profile and continue extracting if the page reaches search results.

Amazon Fresh, Costco, and Walmart CLIs share these local hardening flags:
```bash
--headful
--manual-challenge
--user-agent=auto
--slow-mo=75
--user-data-dir=".chrome-store-debug"
--executable-path="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

Walmart Bright Data run:
```bash
TARGET_SCRAPER_PROVIDER=brightdata BRIGHTDATA_AUTH=username:password npm run walmart:scrape -- "milk" 10
```

Results are automatically saved to:
```
results/target/{search_query}_{date}.json
```

Example:
- `results/target/gaming_laptop_2026-04-23.json`
- `results/target/wireless_headphones_2026-04-23.json`

## API Reference

For API integration details, including provider options, production env vars,
Amazon Fresh ZIP handling, hardening behavior, and Bright Data session
diagnostics, see [API_AGENT_GUIDE.md](./API_AGENT_GUIDE.md).

### Using as a Module

```javascript
const TargetScraper = require('./src/scraper');

async function demo() {
  const scraper = new TargetScraper({ headless: true });
  
  try {
    await scraper.init();
    
    // Basic search
    const products = await scraper.search('laptop', { limit: 30 });
    
    // Search with filters
    const filtered = await scraper.searchWithFilters('headphones', {
      minRating: 4,
      priceMin: 50,
      priceMax: 200
    }, { limit: 30 });
    
    // Get product details
    if (products[0].productId !== 'N/A') {
      const details = await scraper.getProductDetails(products[0].productId);
      console.log(details);
    }
    
  } finally {
    await scraper.close();
  }
}

demo();
```

### Using the Store Registry (for multi-store support)

```javascript
const { getScraper } = require('./src/stores');

// Get Target scraper
const scraper = getScraper('target');

// Get Costco scraper
// const scraper = getScraper('costco');

// Get Walmart scraper
// const scraper = getScraper('walmart');

// Get Amazon Fresh scraper
// const scraper = getScraper('amazonfresh');
// const scraper = getScraper('amazon fresh');
```

## Project Structure

```
ibynn-scraper/
├── src/
│   ├── scraper.js          # Main export (backward compatibility)
│   ├── cli.js              # Command-line interface
│   ├── utils.js            # Utility functions
│   └── stores/
│       ├── index.js        # Store registry & factory
│       ├── BaseScraper.js  # Abstract base class
│       └── TargetScraper.js # Target implementation
├── results/
│   └── target/             # Organized by store
│       ├── laptop_2026-04-23.json
│       └── ...
├── config.js               # Global configuration
├── ARCHITECTURE.md         # Detailed architecture docs
└── README.md
```

## Configuration

Edit `config.js` to customize defaults:

```javascript
module.exports = {
  browser: { provider: 'local', headless: true, timeout: 60000 },
  search: {
    limit: 30,              // Default number of results
    sort: 'relevance'
  },
  results: {
    folder: './results',
    subfolder: 'target',    // Changes to store name for other stores
    format: 'json'
  }
  // ... more options
};
```

## Extending for Other Stores

This project is designed to be easily extensible. To add a new store (Amazon, Walmart, etc.):

1. Create a new scraper in `src/stores/AmazonScraper.js` that extends `BaseScraper`
2. Register it in `src/stores/index.js`
3. Use the factory pattern: `getScraper('amazon')`

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed instructions on adding new stores.

## Example Usage

### Example 1: Basic Search
```bash
npm run scrape -- "shoes" 15
```

### Example 2: Using Filters
```javascript
const scraper = new TargetScraper();
await scraper.init();

const products = await scraper.searchWithFilters('headphones', {
  minRating: 4.0,
  priceMin: 30,
  priceMax: 150
}, { limit: 20 });

console.log(products);
await scraper.close();
```

### Example 3: Run Examples
```bash
npm test
```

## Output

Results are saved as JSON files with timestamps:
```
results_1629876543210.json
```

Sample output structure:
```json
[
  {
    "name": "Product Name",
    "price": "$99.99",
    "rating": "4.5 out of 5 stars",
    "url": "https://www.target.com/p/...",
    "image": "https://...",
    "productId": "12345678"
  }
]
```

## Notes

- Respects store terms of service - use responsibly
- Add delays between requests if scraping large volumes
- Some data might be "N/A" if the page structure differs
- `local` mode launches a bundled Chromium browser via Puppeteer
- `brightdata` mode connects to Bright Data Browser API over WebSocket
- Costco commonly blocks direct local-browser sessions; Bright Data mode is recommended there

## Requirements

- Node.js 14+
- npm or yarn

## Dependencies

- **puppeteer** - Headless browser automation
- **cheerio** - jQuery-like HTML parsing

## License

MIT

## Disclaimer

This tool is for educational purposes. Always check the website's `robots.txt` and terms of service before scraping.
