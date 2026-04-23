const fs = require('fs');
const path = require('path');

/**
 * Utility functions for the Target scraper
 */

class ScraperUtils {
  /**
   * Save products to JSON file
   */
  static saveToJSON(products, filename = null) {
    const name = filename || `results_${Date.now()}.json`;
    const filepath = path.join(process.cwd(), name);
    fs.writeFileSync(filepath, JSON.stringify(products, null, 2));
    console.log(`✓ Results saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Save products to CSV file
   */
  static saveToCSV(products, filename = null) {
    if (products.length === 0) {
      console.warn('No products to save');
      return;
    }

    const name = filename || `results_${Date.now()}.csv`;
    const filepath = path.join(process.cwd(), name);

    // Get headers from first product
    const headers = Object.keys(products[0]);
    const csv = [
      headers.join(','),
      ...products.map((product) =>
        headers
          .map((header) => {
            const value = product[header];
            // Escape quotes and wrap in quotes if contains comma
            const escaped = String(value || '').replace(/"/g, '""');
            return escaped.includes(',') ? `"${escaped}"` : escaped;
          })
          .join(',')
      )
    ].join('\n');

    fs.writeFileSync(filepath, csv);
    console.log(`✓ Results saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Load products from JSON file
   */
  static loadFromJSON(filename) {
    const filepath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    const data = fs.readFileSync(filepath, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * Filter products by price range
   */
  static filterByPrice(products, min, max) {
    return products.filter((product) => {
      const priceStr = product.price?.replace('$', '').split('-')[0] || '0';
      const price = parseFloat(priceStr);
      return price >= min && price <= max;
    });
  }

  /**
   * Filter products by rating
   */
  static filterByRating(products, minRating) {
    return products.filter((product) => {
      const rating = parseFloat(product.rating?.[0] || 0);
      return rating >= minRating;
    });
  }

  /**
   * Sort products by price
   */
  static sortByPrice(products, ascending = true) {
    return products.sort((a, b) => {
      const priceA = parseFloat(a.price?.replace('$', '') || 0);
      const priceB = parseFloat(b.price?.replace('$', '') || 0);
      return ascending ? priceA - priceB : priceB - priceA;
    });
  }

  /**
   * Get statistics about products
   */
  static getStatistics(products) {
    if (products.length === 0) return null;

    const prices = products
      .map((p) => parseFloat(p.price?.replace('$', '') || 0))
      .filter((p) => p > 0);

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2);

    return {
      totalProducts: products.length,
      minPrice: `$${minPrice.toFixed(2)}`,
      maxPrice: `$${maxPrice.toFixed(2)}`,
      avgPrice: `$${avgPrice}`,
      priceRange: `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`
    };
  }

  /**
   * Delay execution (useful for polite scraping)
   */
  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Group products by name pattern
   */
  static groupByPattern(products, pattern) {
    return products.reduce((acc, product) => {
      const key = product.name.match(pattern)?.[0] || 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(product);
      return acc;
    }, {});
  }

  /**
   * Deduplicate products by productId
   */
  static deduplicateByProductId(products) {
    const seen = new Set();
    return products.filter((product) => {
      if (seen.has(product.productId)) return false;
      seen.add(product.productId);
      return true;
    });
  }

  /**
   * Get unique products by name
   */
  static getUniqueByName(products) {
    const seen = new Set();
    return products.filter((product) => {
      if (seen.has(product.name)) return false;
      seen.add(product.name);
      return true;
    });
  }
}

module.exports = ScraperUtils;
