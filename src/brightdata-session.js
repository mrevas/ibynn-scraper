const https = require('https');
const config = require('../config');

async function getBrightDataSessionId(browser) {
  if (browser?.__brightDataSessionId) {
    return browser.__brightDataSessionId;
  }

  const connection = browser?._connection;
  if (connection && typeof connection.send === 'function') {
    const result = await connection.send('Browser.getSessionId');
    return result.session_id || result.sessionId || result.id || null;
  }

  const target = typeof browser.target === 'function' ? browser.target() : null;
  if (!target || typeof target.createCDPSession !== 'function') {
    return null;
  }

  const client = await target.createCDPSession();
  const result = await client.send('Browser.getSessionId');
  return result.session_id || result.sessionId || result.id || null;
}

async function getBrightDataSessionIdFromPage(page) {
  const target = typeof page.target === 'function' ? page.target() : null;
  if (!target || typeof target.createCDPSession !== 'function') {
    return null;
  }

  const client = await target.createCDPSession();
  const result = await client.send('Browser.getSessionId');
  return result.session_id || result.sessionId || result.id || null;
}

async function attachBrightDataSessionIdFromPage(page) {
  const browser = typeof page.browser === 'function' ? page.browser() : null;
  if (!browser?.__isBrightData || browser.__brightDataSessionId) {
    return browser?.__brightDataSessionId || null;
  }

  try {
    browser.__brightDataSessionId = await getBrightDataSessionIdFromPage(page);
    if (browser.__brightDataSessionId) {
      console.log(`[OK] Bright Data session: ${browser.__brightDataSessionId}`);
    }
    return browser.__brightDataSessionId || null;
  } catch (error) {
    browser.__brightDataSessionIdError = error.message;
    return null;
  }
}

function getBrightDataSession(sessionId, apiKey = config.brightdata.apiKey) {
  if (!sessionId || !apiKey) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: 'GET',
        hostname: 'api.brightdata.com',
        path: `/browser_sessions/${encodeURIComponent(sessionId)}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        }
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = body ? JSON.parse(body) : null;
          } catch (error) {
            reject(
              new Error(
                `Bright Data session lookup returned invalid JSON: HTTP ${response.statusCode}`
              )
            );
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                `Bright Data session lookup failed: HTTP ${response.statusCode} ${JSON.stringify(data)}`
              )
            );
            return;
          }

          resolve(data);
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

function getBrowserBrightDataSessionId(browser) {
  return browser?.__brightDataSessionId || null;
}

function summarizeBrightDataSessionResponse(response) {
  const session = response?.session;
  if (!session) {
    return null;
  }

  return {
    session_id: session.session_id,
    api_name: session.api_name,
    status: session.status,
    target_url: session.target_url,
    end_url: session.end_url,
    navigations: session.navigations,
    duration: session.duration,
    captcha: session.captcha,
    bandwidth: session.bandwidth,
    error: session.error
  };
}

async function logBrightDataSessionDiagnostics(browser, contextLabel = 'Bright Data session') {
  const sessionId = getBrowserBrightDataSessionId(browser);
  if (!sessionId) {
    return null;
  }

  if (!config.brightdata.apiKey) {
    console.log(`${contextLabel} diagnostics`, {
      session_id: sessionId,
      lookup: 'skipped',
      reason: 'BRIGHTDATA_API_KEY is not set'
    });
    return null;
  }

  const response = await getBrightDataSession(sessionId);
  const summary = summarizeBrightDataSessionResponse(response);
  console.log(`${contextLabel} diagnostics`, summary);
  return summary;
}

module.exports = {
  attachBrightDataSessionIdFromPage,
  getBrightDataSession,
  getBrightDataSessionId,
  getBrightDataSessionIdFromPage,
  getBrowserBrightDataSessionId,
  logBrightDataSessionDiagnostics,
  summarizeBrightDataSessionResponse
};
