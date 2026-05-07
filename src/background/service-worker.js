// Service Worker — corre en background, SEPARADO de la página de FACEIT.
// Es el único que puede hacer fetch cross-origin a csnades.gg.
// Se comunica con el content script via chrome.runtime.sendMessage / onMessage.

import { UTILITY_TYPES, CACHE_TTL_MS } from '../modules/config.js';
import { fetchUtilityList, fetchVideoUrl } from '../modules/csnades-scraper.js';
import { Cache } from '../modules/cache.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_UTILITIES') {
    handleFetchUtilities(message.map, sendResponse);
    return true; // Mantiene el canal abierto para la respuesta asíncrona
  }

  if (message.type === 'FETCH_VIDEO') {
    handleFetchVideo(message.detailUrl, sendResponse);
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

    // Fetcha los 3 tipos de utilidad en paralelo para ser más rápido
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

async function handleFetchVideo(detailUrl, sendResponse) {
  try {
    const cached = await Cache.get(`video_${detailUrl}`);
    if (cached) {
      sendResponse({ ok: true, videoUrl: cached });
      return;
    }

    const videoUrl = await fetchVideoUrl(detailUrl);
    if (videoUrl) await Cache.set(`video_${detailUrl}`, videoUrl, CACHE_TTL_MS);

    sendResponse({ ok: true, videoUrl });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}
