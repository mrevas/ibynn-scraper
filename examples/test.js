const TargetScraper = require('../src/scraper');

async function example1() {
  console.log('\n=== Example 1: Basic Search ===\n');
  
  const scraper = new TargetScraper({ headless: true });
  
  try {
    await scraper.init();
    
    const products = await scraper.search('laptop', { limit: 5 });
    
    products.forEach((product) => {
      console.log(`- ${product.name} | ${product.price}`);
    });
    
  } finally {
    await scraper.close();
  }
}

async function example2() {
  console.log('\n=== Example 2: Search with Filters ===\n');
  
  const scraper = new TargetScraper({ headless: true });
  
  try {
    await scraper.init();
    
    const products = await scraper.searchWithFilters('headphones', {
      minRating: 4,
      priceMin: 50,
      priceMax: 200
    }, { limit: 10 });
    
    console.log(`Found ${products.length} products matching filters:`);
    products.forEach((product) => {
      console.log(`- ${product.name} | ${product.price} | ${product.rating}`);
    });
    
  } finally {
    await scraper.close();
  }
}

async function example3() {
  console.log('\n=== Example 3: Get Product Details ===\n');
  
  const scraper = new TargetScraper({ headless: true });
  
  try {
    await scraper.init();
    
    // First search
    const products = await scraper.search('shoes', { limit: 1 });
    
    if (products.length > 0 && products[0].productId !== 'N/A') {
      // Then get details
      const details = await scraper.getProductDetails(products[0].productId);
      console.log('Product Details:', details);
    }
    
  } finally {
    await scraper.close();
  }
}

// Run examples (uncomment the one you want to test)
async function runExamples() {
  try {
    await example1();
    // await example2();
    // await example3();
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

runExamples();
