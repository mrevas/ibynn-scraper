const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeProductDetails } = require('../src/productDetails');

test('normalizeProductDetails parses common numeric detail fields', () => {
  const details = normalizeProductDetails(
    'walmart',
    {
      title: 'Great Value Milk',
      description: '1 gallon jug',
      price: '$3.48',
      old_price: '$4.12',
      price_per_unit: '$0.03/fl oz',
      availability: 'Out of stock',
      rating: '4.6 out of 5 stars',
      reviews: '1,234 ratings',
      thumbnail: 'https://example.com/milk.jpg',
      product_page_url: 'https://example.com/milk',
    },
    { identifier: '10450114' }
  );

  assert.equal(details.store, 'walmart');
  assert.equal(details.identifier, '10450114');
  assert.equal(details.price, 3.48);
  assert.equal(details.old_price, 4.12);
  assert.equal(details.sale_price, 3.48);
  assert.deepEqual(details.price_per_unit, {
    amount: '$0.03/fl oz',
    unit: null,
  });
  assert.equal(details.out_of_stock, true);
  assert.equal(details.quantity, 0);
  assert.equal(details.rating, 4.6);
  assert.equal(details.reviews, 1234);
});

test('normalizeProductDetails keeps missing optional fields undefined', () => {
  const details = normalizeProductDetails('amazonfresh', {
    title: 'Organic Bananas',
    price: '$1.99',
  });

  assert.equal(details.title, 'Organic Bananas');
  assert.equal(details.price, 1.99);
  assert.equal(details.old_price, undefined);
  assert.equal(details.sale_price, undefined);
  assert.equal(details.price_per_unit, undefined);
  assert.equal(details.out_of_stock, undefined);
  assert.equal(details.quantity, undefined);
});
