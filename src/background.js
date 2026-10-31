/**
 * Background Service Worker for Apple Music Lyrics Extension.
 *
 * Responsibilities:
 *   - Proxies network requests to lyrics APIs bypassing page-level CORS and origin restrictions.
 *   - Sets up declarativeNetRequest session rules to inject required headers/cookies:
 *       Rule 201: Musixmatch cookie (mxm_bab=AB) — prevents wrong/garbage results.
 *       Rule 202: YouTube Music Innertube Origin + Referer headers — required for /youtubei/ calls.
 *   - Manages extension lifecycle and cross-tab storage sync.
 */

'use strict';

/**
 * Sets up declarativeNetRequest session rules needed for Musixmatch and YouTube Music Innertube.
 * Called on startup and install to ensure rules are always active.
 */
async function setupDeclarativeRules() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [201, 202],
      addRules: [
        {
          // Musixmatch: inject mxm_bab=AB cookie to avoid wrong/garbage search results
          id: 201,
          priority: 1,
          condition: {
            urlFilter: '||musixmatch.com/',
            resourceTypes: ['xmlhttprequest']
          },
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Cookie', operation: 'append', value: 'mxm_bab=AB' }
            ]
          }
        },
        {
          // YouTube Music Innertube: spoof Origin and Referer so unauthenticated API calls succeed
          id: 202,
          priority: 1,
          condition: {
            urlFilter: '||music.youtube.com/youtubei/',
            resourceTypes: ['xmlhttprequest']
          },
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'https://music.youtube.com' },
              { header: 'Referer', operation: 'set', value: 'https://music.youtube.com/' }
            ]
          }
        }
      ]
    });
    console.log('[AppleMusicLyrics] declarativeNetRequest session rules set (201, 202).');
  } catch (err) {
    console.warn('[AppleMusicLyrics] Failed to set declarativeNetRequest rules:', err);
  }
}

chrome.runtime.onStartup.addListener(setupDeclarativeRules);
chrome.runtime.onInstalled.addListener(setupDeclarativeRules);

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'PROXY_FETCH') {
    const { url, options = {} } = request;

    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'Accept': options.accept || '*/*',
        ...(options.headers || {})
      }
    };

    if (options.body) {
      fetchOptions.body = options.body;
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 8000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;

    fetch(url, fetchOptions)
      .then(async (response) => {
        clearTimeout(timeoutId);
        const text = await response.text();
        sendResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          data: text
        });
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        sendResponse({
          ok: false,
          status: 0,
          error: err.name === 'AbortError' ? 'Timeout' : err.message,
          data: null
        });
      });

    return true; // Keep message channel open for asynchronous response
  }
});
