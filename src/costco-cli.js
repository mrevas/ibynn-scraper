#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getScraper } = require('./stores');
const config = require('../config');
const {
  buildScraperOptions,
  createManualChallengeHandler,
  getCommonHelpFlags,
  parseArgs,
  parseNumber,
  sanitizeQuery
} = require('./cli-helpers');

const CATEGORY_SEARCHES_FILE_ENV = 'COSTCO_CATEGORY_SEARCHES_FILE';

function getResultsDir() {
  return path.join(process.cwd(), config.results.folder, 'costco');
}

function ensureResultsDir() {
  const resultsDir = getResultsDir();
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  return resultsDir;
}

function getOutputFilepath(query) {
  const resultsDir = ensureResultsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  return path.join(resultsDir, `${sanitizeQuery(query)}_${timestamp}.json`);
}

function saveQueryResults(query, products) {
  const filepath = getOutputFilepath(query);
  fs.writeFileSync(filepath, JSON.stringify(products, null, 2));
  return filepath;
}

function printProducts(products) {
  console.log('\nResults:\n');
  console.log('-'.repeat(100));

  products.forEach((product) => {
    console.log(`\n${product.position}. ${product.title}`);
    console.log(`   Price: ${product.price ?? 'N/A'}`);
    console.log(`   Rating: ${product.rating ?? 'N/A'}`);
    console.log(`   URL: ${product.product_link}`);
    console.log(`   ID: ${product.product_id}`);
  });

  console.log('\n' + '-'.repeat(100));
  console.log(`\nScraped ${products.length} products\n`);
}

function readQueriesFile(queriesFile) {
  const filepath = path.resolve(process.cwd(), queriesFile);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Queries file not found: ${queriesFile}`);
  }

  return fs
    .readFileSync(filepath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function printBatchSummary(savedQueries, failedResults) {
  console.log('\nBatch summary:\n');
  console.log(`Saved categories: ${savedQueries.length}`);
  if (savedQueries.length) {
    console.log(savedQueries.map((query) => `  - ${query}`).join('\n'));
  }

  console.log(`\nFailed categories: ${failedResults.length}`);
  if (failedResults.length) {
    console.log(
      failedResults
        .map((result) => `  - ${result.query}: ${result.error}`)
        .join('\n')
    );
  }
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const queriesFile = options['queries-file'] || process.env[CATEGORY_SEARCHES_FILE_ENV] || null;
  const showHelp = positional.includes('--help') || positional.includes('-h');
  const query = queriesFile ? null : positional[0];
  const limit = parseNumber(positional[queriesFile ? 0 : 1], config.search.limit);
  const { provider, manualChallenge, scraperOptions } = buildScraperOptions(options, 'costco');
  const zipCode = options.zip || process.env.COSTCO_ZIP || config.costco.zipCode;

  if (showHelp || (!query && !queriesFile)) {
    console.log(`
Usage: ibynn-costco-scrape <search-term> [limit]
       ibynn-costco-scrape --queries-file=queries.txt [limit]

Examples:
  ibynn-costco-scrape "milk" 10
  npm run costco:scrape -- "wireless headphones" 25
  node src/costco-cli.js "milk" 5 --headful --zip=11435
  node src/costco-cli.js --queries-file=queries.txt 25 --zip=11435
  node src/costco-cli.js "milk" 5 --headful --executable-path="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir=".chrome-costco-debug" --zip=11435
  node src/costco-cli.js "milk" 5 --manual-challenge --user-agent=auto --user-data-dir=".chrome-costco-debug" --zip=11435

Provider env:
  TARGET_SCRAPER_PROVIDER=local|brightdata
  BRIGHTDATA_AUTH=username:password
  BRIGHTDATA_BROWSER_WS=wss://username:password@brd.superproxy.io:9222
  BRIGHTDATA_API_KEY=your_brightdata_api_key
  COSTCO_CATEGORY_SEARCHES_FILE=path\\to\\costco-category-searches.txt
  TARGET_SCRAPER_HEADLESS=false
  COSTCO_ZIP=11435

Costco Instacart storefront flags:
  --zip=11435
  --queries-file=queries.txt

${getCommonHelpFlags()}
`);
    process.exit(0);
  }

  const scraper = getScraper('costco', {
    ...scraperOptions,
    zipCode,
    manualChallenge: manualChallenge ? createManualChallengeHandler('Costco') : null
  });

  try {
    console.log('\nStarting Costco Search Scraper\n');
    console.log('Store: Costco');
    console.log(`Provider: ${provider}`);
    console.log(`ZIP code: ${zipCode}`);
    console.log(`Max results: ${limit}\n`);

    if (!queriesFile) {
      console.log(`Search term: "${query}"\n`);
      const products = await scraper.search(query, { limit });
      printProducts(products);

      const filepath = saveQueryResults(query, products);
      console.log(`Results saved to: ${path.relative(process.cwd(), filepath)}\n`);
      return;
    }

    const resolvedQueriesFile = path.resolve(process.cwd(), queriesFile);
    const queries = readQueriesFile(queriesFile);
    if (!queries.length) {
      throw new Error(`No queries found in ${queriesFile}`);
    }

    console.log(`Queries file: ${resolvedQueriesFile}`);
    console.log(`Queries loaded: ${queries.length}\n`);

    const batchResults = await scraper.searchBatch(queries, {
      limit,
      continueOnError: true
    });

    let savedCount = 0;
    let failureCount = 0;
    const savedQueries = [];
    const failedResults = [];

    for (const result of batchResults) {
      console.log(`\nQuery: "${result.query}"`);

      if (result.error) {
        failureCount += 1;
        process.exitCode = 1;
        failedResults.push(result);
        console.error(`Error: ${result.error}`);
        continue;
      }

      printProducts(result.products);
      const filepath = saveQueryResults(result.query, result.products);
      savedCount += 1;
      savedQueries.push(result.query);
      console.log(`Results saved to: ${path.relative(process.cwd(), filepath)}\n`);
    }

    console.log(`Batch complete. Saved ${savedCount} query result set(s).`);
    if (failureCount) {
      console.log(`Batch completed with ${failureCount} failed quer${failureCount === 1 ? 'y' : 'ies'}.`);
    }
    printBatchSummary(savedQueries, failedResults);
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
