const { getScraper } = require('./stores');
const { buildStoreScraperOptions } = require('./api-helpers');

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRating(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/([\d.]+)/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseReviews(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/([\d,]+)/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizePricePerUnit(value) {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'object') {
    const amount = normalizeText(value.amount);
    const unit = normalizeText(value.unit);

    if (!amount && !unit) {
      return undefined;
    }

    return {
      amount: amount || unit,
      unit: unit || null,
    };
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  return {
    amount: normalized,
    unit: null,
  };
}

function normalizeAvailability(value) {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function deriveOutOfStock(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes('out of stock') ||
    normalized.includes('sold out') ||
    normalized.includes('currently unavailable') ||
    normalized.includes('unavailable')
  ) {
    return true;
  }

  if (
    normalized.includes('in stock') ||
    normalized.includes('available') ||
    normalized.includes('add to cart')
  ) {
    return false;
  }

  return undefined;
}

function normalizeProductDetails(storeName, rawDetails = {}, fallback = {}) {
  const title = normalizeText(rawDetails.title);
  const description = normalizeText(rawDetails.description);
  const productPageUrl =
    normalizeText(rawDetails.product_page_url) ||
    normalizeText(rawDetails.url) ||
    normalizeText(fallback.productPageUrl);
  const thumbnail =
    normalizeText(rawDetails.thumbnail) ||
    normalizeText(rawDetails.image) ||
    normalizeText(rawDetails.image_url);
  const price = parsePrice(rawDetails.price ?? rawDetails.current_price);
  const oldPrice = parsePrice(
    rawDetails.old_price ?? rawDetails.compare_at_price ?? rawDetails.list_price
  );
  const availability = normalizeAvailability(rawDetails.availability);
  const outOfStock =
    typeof rawDetails.out_of_stock === 'boolean'
      ? rawDetails.out_of_stock
      : deriveOutOfStock(availability);
  const quantity =
    typeof rawDetails.quantity === 'number' && Number.isFinite(rawDetails.quantity)
      ? rawDetails.quantity
      : typeof outOfStock === 'boolean'
        ? outOfStock
          ? 0
          : 100
        : undefined;

  const normalized = {
    store: String(storeName || '').toLowerCase(),
    identifier:
      normalizeText(rawDetails.product_id) ||
      normalizeText(rawDetails.productId) ||
      normalizeText(fallback.identifier),
    title: title || undefined,
    description: description || undefined,
    price,
    old_price: oldPrice,
    sale_price:
      typeof oldPrice === 'number' && typeof price === 'number'
        ? oldPrice > price
          ? price
          : null
        : undefined,
    price_per_unit: normalizePricePerUnit(
      rawDetails.price_per_unit ?? rawDetails.unit_price ?? rawDetails.pricePerUnit
    ),
    out_of_stock: outOfStock,
    quantity,
    rating: parseRating(rawDetails.rating),
    reviews: parseReviews(rawDetails.reviews),
    availability,
    thumbnail: thumbnail || undefined,
    product_page_url: productPageUrl || undefined,
    raw: { ...rawDetails },
  };

  return normalized;
}

async function fetchNormalizedProductDetails(storeName, identifier, options = {}) {
  const scraper = getScraper(storeName, buildStoreScraperOptions(storeName, options));

  try {
    const rawDetails = await scraper.getProductDetails(identifier);
    return normalizeProductDetails(storeName, rawDetails, {
      identifier,
      productPageUrl: /^https?:\/\//i.test(String(identifier)) ? identifier : '',
    });
  } finally {
    await scraper.close().catch(() => null);
  }
}

module.exports = {
  fetchNormalizedProductDetails,
  normalizeProductDetails,
};
