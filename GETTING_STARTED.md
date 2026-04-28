# Getting Started Guide

## Setup

### 1. Prerequisites
- Node.js 14 or higher
- npm or yarn
- A modern system (Windows, macOS, or Linux)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ibynn-scraper.git
cd ibynn-scraper

# Install dependencies
npm install
npx playwright install chromium
```

This will install:
- **playwright** - Browser automation library
- **cheerio** - HTML parsing library

## Quick Start

### Command Line Usage

Search for products and save results:

```bash
npm run scrape -- "gaming laptop" 10
```

This will:
1. Search Target for "gaming laptop"
2. Return top 10 results
3. Save to `results_TIMESTAMP.json`

### Programmatic Usage

Create a new JavaScript file:

```javascript
const TargetScraper = require('./src/scraper');

async function main() {
  const scraper = new TargetScraper({ headless: true });
  
  try {
    await scraper.init();
    const products = await scraper.search('laptop', { limit: 10 });
    console.log(products);
  } finally {
    await scraper.close();
  }
}

main();
```

## Common Tasks

### Search with Filters

```javascript
const scraper = new TargetScraper();
await scraper.init();

const results = await scraper.searchWithFilters('headphones', {
  minRating: 4.0,
  priceMin: 50,
  priceMax: 200
}, { limit: 20 });

await scraper.close();
```

### Export Results

```javascript
const ScraperUtils = require('./src/utils');

// Save as JSON
ScraperUtils.saveToJSON(products, 'my_results.json');

// Save as CSV
ScraperUtils.saveToCSV(products, 'my_results.csv');
```

### Filter and Analyze

```javascript
const utils = ScraperUtils;

// Get statistics
const stats = utils.getStatistics(products);
console.log(stats);

// Filter by price
const cheap = utils.filterByPrice(products, 0, 100);

// Sort by price
const sorted = utils.sortByPrice(products, true);

// Remove duplicates
const unique = utils.getUniqueByName(products);
```

### Batch Searching

```javascript
const queries = ['laptop', 'headphones', 'keyboard'];
const scraper = new TargetScraper();

try {
  await scraper.init();

  for (const query of queries) {
    console.log(`Searching: ${query}`);
    const products = await scraper.search(query, { limit: 10 });
    
    // Save each batch
    const filename = `results_${query}.json`;
    ScraperUtils.saveToJSON(products, filename);
    
    // Add delay between searches
    await ScraperUtils.delay(2000);
  }
} finally {
  await scraper.close();
}
```

## Examples

### Run Examples

```bash
# Basic examples
npm test

# Advanced examples with filtering and export
npm run advanced
```

### Example Files
- `examples/test.js` - Basic usage examples
- `examples/advanced.js` - Advanced filtering and export

## Configuration

Edit `config.js` to customize defaults:

```javascript
module.exports = {
  browser: {
    headless: true,
    timeout: 30000
  },
  search: {
    limit: 20,
    sort: 'relevance'
  }
  // ... more options
};
```

## API Reference

### TargetScraper Class

#### Methods

- `init()` - Initialize browser
- `close()` - Close browser
- `search(query, options)` - Search products
- `searchWithFilters(query, filters, options)` - Search with filters
- `getProductDetails(productId)` - Get detailed info

### ScraperUtils Class

Static utility methods:

- `saveToJSON(products, filename)`
- `saveToCSV(products, filename)`
- `loadFromJSON(filename)`
- `filterByPrice(products, min, max)`
- `filterByRating(products, minRating)`
- `sortByPrice(products, ascending)`
- `getStatistics(products)`
- `delay(ms)`
- `getUniqueByName(products)`
- `deduplicateByProductId(products)`

## Troubleshooting

### Browser fails to launch

```bash
# Install system dependencies (macOS)
brew install chromium

# Install system dependencies (Linux - Ubuntu/Debian)
sudo apt-get install -y chromium-browser
```

### Timeout errors

Increase timeout in options:
```javascript
const scraper = new TargetScraper({ 
  timeout: 60000 // 60 seconds
});
```

### Element not found errors

Target's page structure may have changed. Check:
1. Make sure you're connected to the internet
2. Test manually at target.com
3. Try with `headless: false` to debug

### Memory issues

When scraping many products:
```javascript
// Process in batches
for (const query of queries) {
  const scraper = new TargetScraper();
  await scraper.init();
  
  const products = await scraper.search(query);
  ScraperUtils.saveToJSON(products);
  
  await scraper.close(); // Close immediately after
  await ScraperUtils.delay(2000); // Wait before next
}
```

## Performance Tips

1. **Reuse scraper instance** - Don't create/close for every search
2. **Add delays** between requests for polite scraping
3. **Run in headless mode** (default) - Faster than headed
4. **Filter client-side** vs server-side for better performance
5. **Batch process** large jobs with delays

## Legal & Ethical Considerations

- Always check Target's `robots.txt` and terms of service
- Don't overload their servers - add delays between requests
- Respect rate limits
- Use for personal research/analysis
- Consider reaching out to Target for commercial use

## Next Steps

1. Review the examples in `examples/`
2. Customize `config.js` for your needs
3. Build your own workflow using the API
4. Check GitHub issues for common problems

## Support

For issues or questions:
1. Check the [README.md](README.md)
2. Review examples files
3. Check browser console (use `headless: false`)

Happy scraping! 🚀
