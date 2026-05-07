# API Agent Integration Guide

Short API description:
Multi-store product search API helper for Target, Costco via the Instacart storefront, Walmart, and Amazon Fresh with local Chromium or Bright Data support.

This package exposes store scrapers through `getScraper(storeName, options)`.
Use explicit options from the API layer instead of relying only on package-level
environment resolution.

## Stores

Supported store keys:

- `target`
- `costco`
- `walmart`
- `amazonfresh`

Aliases such as `amazon fresh` and `amazon-fresh` also work, but API code should
prefer `amazonfresh`.

## Shared API Helper

Provider wrapper:

```js
const {
  API_DESCRIPTION,
  buildStoreScraperOptions,
  getScraper
} = require('ibynn-target-scraper');

console.log(API_DESCRIPTION);

async function searchStore(storeName, query, limit = 10, extra = {}) {
  const scraper = getScraper(
    storeName,
    buildStoreScraperOptions(storeName, {
      provider: process.env.TARGET_SCRAPER_PROVIDER || 'brightdata',
      ...extra
    })
  );

  try {
    return await scraper.search(query, { limit });
  } finally {
    await scraper.close();
  }
}
```

`buildStoreScraperOptions()` applies shared browser settings and store-specific
defaults such as `COSTCO_ZIP` and Amazon Fresh ZIP rules. When
`TARGET_SCRAPER_PROVIDER=brightdata`, it will use
`BRIGHTDATA_BROWSER_WS` or the endpoint derived from `BRIGHTDATA_AUTH`.

## Costco

Costco uses the Instacart storefront at `https://www.instacart.com/store/costco/storefront`
and requires a delivery ZIP. The package defaults to ZIP `11435`, which can be
overridden with `COSTCO_ZIP` or `zipCode` from the API layer.

Programmatic wrapper:

```js
const { buildStoreScraperOptions, getScraper } = require('ibynn-target-scraper');

async function searchCostco(query, limit = 10) {
  const scraper = getScraper(
    'costco',
    buildStoreScraperOptions('costco', {
      provider: process.env.TARGET_SCRAPER_PROVIDER || 'brightdata',
      zipCode: process.env.COSTCO_ZIP || '11435'
    })
  );

  try {
    return await scraper.search(query, { limit });
  } finally {
    await scraper.close();
  }
}

module.exports = { searchCostco };
```

Example Express route:

```js
app.get('/costco-search', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    const limit = Number(req.query.limit || 10);

    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }

    const products = await searchCostco(query, limit);

    res.json({
      store: 'costco',
      query,
      zipCode: process.env.COSTCO_ZIP || '11435',
      products
    });
  } catch (error) {
    res.status(500).json({
      error: 'Costco search failed',
      message: error.message
    });
  }
});
```

## Amazon Fresh

Amazon Fresh requires a delivery ZIP. Submit preferred ZIP `11435` by default,
but treat any acceptable Queens ZIP as valid after Amazon resolves the location.

Provider wrapper:

```js
const { buildStoreScraperOptions, getScraper } = require('ibynn-target-scraper');

async function searchAmazonFresh(query, limit = 10) {
  const scraper = getScraper(
    'amazonfresh',
    buildStoreScraperOptions('amazonfresh', {
      provider: process.env.TARGET_SCRAPER_PROVIDER || 'brightdata',
      zipCode: process.env.AMAZON_FRESH_ZIP || '11435',
      acceptableZipPrefixes:
        (process.env.AMAZON_FRESH_ACCEPTABLE_ZIP_PREFIXES || '111,113,114,116')
          .split(',')
          .map((zip) => zip.trim())
          .filter(Boolean),
      acceptableZipCodes:
        (process.env.AMAZON_FRESH_ACCEPTABLE_ZIP_CODES || '11004,11005')
          .split(',')
          .map((zip) => zip.trim())
          .filter(Boolean)
    })
  );

  try {
    return await scraper.search(query, { limit });
  } finally {
    await scraper.close();
  }
}

module.exports = { searchAmazonFresh };
```

For repeated Amazon Fresh queries in one process, reuse the same scraper
instance and prepared session:

```js
async function searchAmazonFreshBatch(queries, limit = 10) {
  const scraper = getScraper(
    'amazonfresh',
    buildStoreScraperOptions('amazonfresh', {
      provider: process.env.TARGET_SCRAPER_PROVIDER || 'brightdata',
      zipCode: process.env.AMAZON_FRESH_ZIP || '11435'
    })
  );

  try {
    await scraper.prepareSession();
    return await scraper.searchBatch(queries, {
      limit,
      continueOnError: true
    });
  } finally {
    await scraper.close();
  }
}
```

Amazon Fresh public methods for session reuse:

- `prepareSession()`
- `resetSession()`
- `searchBatch(queries, { limit, continueOnError })`

Example Express route:

```js
app.get('/amazon-fresh-search', async (req, res) => {
  try {
    const query = req.query.query || req.query.q;
    const limit = Number(req.query.limit || 10);

    if (!query) {
      return res.status(400).json({ error: 'Missing query' });
    }

    const products = await searchAmazonFresh(query, limit);

    res.json({
      store: 'amazonfresh',
      query,
      preferredZipCode: process.env.AMAZON_FRESH_ZIP || '11435',
      products
    });
  } catch (error) {
    res.status(500).json({
      error: 'Amazon Fresh search failed',
      message: error.message
    });
  }
});
```

## Production Env

Required for Bright Data:

```env
TARGET_SCRAPER_PROVIDER=brightdata
BRIGHTDATA_AUTH=username:password
COSTCO_ZIP=11435
AMAZON_FRESH_ZIP=11435
AMAZON_FRESH_ACCEPTABLE_ZIP_PREFIXES=111,113,114,116
AMAZON_FRESH_ACCEPTABLE_ZIP_CODES=11004,11005
TARGET_SCRAPER_TIMEOUT=60000
```

Optional:

```env
BRIGHTDATA_BROWSER_WS=wss://username:password@brd.superproxy.io:9222
BRIGHTDATA_API_KEY=your_brightdata_api_key
TARGET_SCRAPER_TIMEOUT_MS=60000
AMAZON_FRESH_CATEGORY_SEARCHES_FILE=path/to/amazon-fresh-category-searches.txt
```

`BRIGHTDATA_BROWSER_WS` overrides the endpoint derived from `BRIGHTDATA_AUTH`.

For Costco, `COSTCO_ZIP` is the delivery ZIP used when the scraper establishes
the Instacart Costco storefront session before opening storefront search
results.

For Amazon Fresh, `AMAZON_FRESH_ZIP` is the preferred ZIP submitted first.
Location confirmation accepts extracted 5-digit ZIPs that either start with
`111`, `113`, `114`, or `116`, or exactly match `11004` or `11005`. Do not use
the broad `110` prefix, since it includes non-Queens ZIPs.

## Hardening Features

The scraper package includes shared local/browser hardening used by Costco,
Walmart, and Amazon Fresh:

- `navigator.webdriver` cleanup
- language normalization
- optional `userAgent: 'auto'`
- human-ish pacing between page actions
- persistent local profile support
- system Chrome support
- manual challenge callback support

For API use, normally keep these defaults and pass only provider, timeout,
Bright Data endpoint, and store-specific options.

For local debugging only, you can pass:

```js
{
  headless: false,
  userAgent: 'auto',
  userDataDir: '.chrome-amazonfresh-debug',
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
}
```

Do not add CAPTCHA bypass logic. If a store presents a challenge, surface the
scraper error cleanly or debug locally with headful/manual mode.

## Bright Data Session Diagnostics

When `BRIGHTDATA_API_KEY` is set, scraper failures will log Bright Data Browser
Session diagnostics:

- `session_id`
- `status`
- `target_url`
- `end_url`
- `navigations`
- `duration`
- `captcha`
- `bandwidth`
- provider-side `error`

The scraper logs the session id when available:

```txt
[OK] Bright Data session: <session_id>
```

You can query it manually:

```bash
curl \
  -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  "https://api.brightdata.com/browser_sessions/<session_id>"
```

## Response Shape

All stores preserve this product shape:

```js
{
  position,
  title,
  product_id,
  product_link,
  source,
  source_icon,
  price,
  extracted_price,
  rating,
  reviews,
  extensions,
  thumbnail,
  primary_offer,
  seller_name
}
```

For Amazon Fresh, `extensions` includes `zip:<confirmedZip>` when the page
confirms an acceptable ZIP. If no confirmed ZIP was detected before extraction,
it falls back to the preferred ZIP.

## API Agent Checklist

1. Update/reinstall `ibynn-target-scraper` in the API repo.
2. Build a provider wrapper that passes explicit options.
3. Add `/costco-search?query=milk&limit=10` and/or `/amazon-fresh-search?query=milk&limit=10`.
4. Return `400` for missing query.
5. Default limit to `10`.
6. Default `COSTCO_ZIP` and `AMAZON_FRESH_ZIP` to `11435`.
7. For Amazon Fresh, still accept configured Queens ZIP matches.
8. Always call `await scraper.close()` in `finally`.
9. Restart the API process after env or package updates.
