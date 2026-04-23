/**
 * Batch Scraping Template
 * Use this as a template for scraping multiple queries
 */

const TargetScraper = require('../src/scraper');
const ScraperUtils = require('../src/utils');
const fs = require('fs');

// List of search queries to scrape
const SEARCH_QUERIES = [
  { query: 'laptop', limit: 15 },
  { query: 'wireless headphones', limit: 15 },
  { query: 'gaming keyboard', limit: 15 }
];

// Delay between searches (in milliseconds) for polite scraping
const DELAY_BETWEEN_SEARCHES = 3000;

/**
 * Batch scraping function
 */
async function batchScrape() {
  const scraper = new TargetScraper({ headless: true });
  const allResults = {};

  try {
    console.log('\n🚀 Starting Batch Scrape\n');
    console.log(`Target queries: ${SEARCH_QUERIES.length}`);
    console.log('─'.repeat(60) + '\n');

    await scraper.init();

    for (let i = 0; i < SEARCH_QUERIES.length; i++) {
      const { query, limit } = SEARCH_QUERIES[i];
      const searchNum = i + 1;

      console.log(`[${searchNum}/${SEARCH_QUERIES.length}] Searching for: "${query}"`);

      try {
        // Perform search
        let products = await scraper.search(query, { limit });
        
        // Deduplicate
        products = ScraperUtils.getUniqueByName(products);
        
        // Get statistics
        const stats = ScraperUtils.getStatistics(products);

        // Store results
        allResults[query] = {
          products,
          stats,
          timestamp: new Date().toISOString(),
          count: products.length
        };

        // Display summary
        console.log(`   ✓ Found ${products.length} products`);
        if (stats) {
          console.log(`   💰 Price range: ${stats.priceRange}`);
          console.log(`   📊 Average price: ${stats.avgPrice}`);
        }

        // Add delay before next search (except for last one)
        if (i < SEARCH_QUERIES.length - 1) {
          console.log(`   ⏱️  Waiting ${DELAY_BETWEEN_SEARCHES / 1000}s before next search...\n`);
          await ScraperUtils.delay(DELAY_BETWEEN_SEARCHES);
        }
      } catch (error) {
        console.error(`   ❌ Error searching "${query}": ${error.message}\n`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log('\n📝 Batch Summary:\n');

    // Print summary
    let totalProducts = 0;
    for (const [query, result] of Object.entries(allResults)) {
      console.log(`"${query}": ${result.count} products`);
      totalProducts += result.count;
    }

    console.log(`\nTotal products scraped: ${totalProducts}\n`);

    // Save individual results
    console.log('💾 Saving Results...\n');

    for (const [query, result] of Object.entries(allResults)) {
      const filename = `results_${query.replace(/\s+/g, '_')}_${Date.now()}.json`;
      ScraperUtils.saveToJSON(result.products, filename);

      const csvFilename = `results_${query.replace(/\s+/g, '_')}_${Date.now()}.csv`;
      ScraperUtils.saveToCSV(result.products, csvFilename);
    }

    // Save batch summary
    const summaryFile = `batch_summary_${Date.now()}.json`;
    fs.writeFileSync(summaryFile, JSON.stringify(allResults, null, 2));
    console.log(`✓ Summary saved to: ${summaryFile}\n`);

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  } finally {
    await scraper.close();
    console.log('✓ Done!\n');
  }
}

// Example: Scrape with filters
async function batchScrapeWithFilters() {
  const scraper = new TargetScraper();
  const results = {};

  try {
    console.log('\n🎯 Batch Scrape with Filters\n');

    await scraper.init();

    const searches = [
      {
        query: 'laptop',
        filters: { priceMin: 500, priceMax: 1500, minRating: 4 },
        limit: 10
      },
      {
        query: 'headphones',
        filters: { priceMin: 50, priceMax: 300, minRating: 4 },
        limit: 10
      }
    ];

    for (const search of searches) {
      const { query, filters, limit } = search;

      console.log(`Searching: "${query}" with filters:`, filters);

      const products = await scraper.searchWithFilters(query, filters, { limit });

      results[query] = {
        count: products.length,
        filters,
        products
      };

      console.log(`Found ${products.length} products matching criteria\n`);

      // Save results
      const filename = `filtered_${query}_${Date.now()}.json`;
      ScraperUtils.saveToJSON(products, filename);

      await ScraperUtils.delay(2000);
    }

  } finally {
    await scraper.close();
  }
}

// Run batch scrape
async function run() {
  const mode = process.argv[2] || 'basic';

  if (mode === 'filters') {
    await batchScrapeWithFilters();
  } else {
    await batchScrape();
  }
}

run().catch(console.error);
