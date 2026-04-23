#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const TargetScraper = require('./scraper');
const ScraperUtils = require('./utils');
const config = require('../config');

async function main() {
  const args = process.argv.slice(2);
  const query = args[0] || 'laptop';
  const limit = parseInt(args[1] || config.search.limit);

  if (!query) {
    console.log(`
Usage: npm run scrape -- <search-term> [limit]

Examples:
  npm run scrape -- "gaming laptop" 30
  npm run scrape -- "wireless headphones" 50
  npm run scrape -- "shoes"
    `);
    process.exit(0);
  }

  const scraper = new TargetScraper({ headless: true });

  try {
    await scraper.init();
    
    console.log('\n🔍 Starting Target Search Scraper\n');
    console.log(`Store: Target`);
    console.log(`Search term: "${query}"`);
    console.log(`Max results: ${limit}\n`);

    const products = await scraper.search(query, { limit });

    console.log('\n📦 Results:\n');
    console.log('─'.repeat(100));

    products.forEach((product, index) => {
      console.log(`\n${index + 1}. ${product.name}`);
      console.log(`   Price: ${product.price}`);
      console.log(`   Rating: ${product.rating}`);
      console.log(`   URL: ${product.url}`);
      console.log(`   ID: ${product.productId}`);
    });

    console.log('\n' + '─'.repeat(100));
    console.log(`\n✓ Scraped ${products.length} products\n`);

    // Create results folder structure
    const resultsDir = path.join(process.cwd(), config.results.folder, config.results.subfolder);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    // Generate filename from query
    const sanitizedQuery = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `${sanitizedQuery}_${timestamp}.json`;
    const filepath = path.join(resultsDir, filename);

    // Save results to JSON
    fs.writeFileSync(filepath, JSON.stringify(products, null, 2));
    
    // Print relative path for clarity
    const relativePath = path.relative(process.cwd(), filepath);
    console.log(`💾 Results saved to: ${relativePath}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await scraper.close();
  }
}

main();
