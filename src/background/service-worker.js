import { UTILITY_TYPES, CACHE_TTL_MS } from '../modules/config.js';
import { fetchUtilityList } from '../modules/csnades-scraper.js';
import { Cache } from '../modules/cache.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_UTILITIES') {
    handleFetchUtilities(message.map, sendResponse);
    return true;
  }
});

async function handleFetchUtilities(map, sendResponse) {
  try {
    const cached = await Cache.get(`utilities_${map}`);
    if (cached) {
      sendResponse({ ok: true, data: cached, fromCache: true });
      return;
    }

    const results = await Promise.allSettled(
      UTILITY_TYPES.map((type) => fetchUtilityList(map, type))
    );

    const data = {};
    UTILITY_TYPES.forEach((type, i) => {
      const result = results[i];
      data[type] = result.status === 'fulfilled' ? result.value : [];
      if (result.status === 'rejected') {
        console.error(`[FACEIT Utilities] Error fetching ${type}:`, result.reason);
      }
    });

    await Cache.set(`utilities_${map}`, data, CACHE_TTL_MS);
    sendResponse({ ok: true, data });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}
