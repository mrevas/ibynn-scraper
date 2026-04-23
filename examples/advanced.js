const TargetScraper = require('../src/scraper');
const ScraperUtils = require('../src/utils');

/**
 * Advanced Example: Full workflow with filtering and exporting
 */
async function advancedExample() {
  const scraper = new TargetScraper({ headless: true });

  try {
    console.log('\n📱 Advanced Target Scraper Example\n');
    
    // Initialize scraper
    await scraper.init();
    console.log('✓ Scraper initialized\n');

    // Search for products
    console.log('🔍 Searching for "wireless headphones"...');
    let products = await scraper.search('wireless headphones', { limit: 25 });
    console.log(`✓ Found ${products.length} products\n`);

    // Deduplicate
    products = ScraperUtils.getUniqueByName(products);
    console.log(`✓ Deduplicated to ${products.length} unique products\n`);

    // Get statistics
    const stats = ScraperUtils.getStatistics(products);
    if (stats) {
      console.log('📊 Price Statistics:');
      console.log(`   Average: ${stats.avgPrice}`);
      console.log(`   Range: ${stats.priceRange}\n`);
    }

    // Filter by price
    console.log('💰 Filtering by price ($50 - $200)...');
    const affordable = ScraperUtils.filterByPrice(products, 50, 200);
    console.log(`✓ Found ${affordable.length} products in price range\n`);

    // Sort by price
    console.log('📈 Sorting by price (ascending)...');
    const sorted = ScraperUtils.sortByPrice(affordable, true);
    console.log('✓ Sorted\n');

    // Display top 5
    console.log('🏆 Top 5 Affordable Options:');
    sorted.slice(0, 5).forEach((product, index) => {
      console.log(`   ${index + 1}. ${product.name}`);
      console.log(`      ${product.price} - ${product.rating}`);
    });
    console.log();

    // Save to different formats
    console.log('💾 Saving results...');
    ScraperUtils.saveToJSON(sorted, 'headphones_filtered.json');
    ScraperUtils.saveToCSV(sorted, 'headphones_filtered.csv');
    console.log('✓ All done!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await scraper.close();
  }
}

// Run the example
advancedExample();
