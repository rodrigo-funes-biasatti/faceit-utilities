import { MAPS, UTILITY_TYPES, CACHE_TTL_MS } from '../modules/config.js';
import { fetchUtilityList, fetchOfficialNadeList } from '../modules/csnades-scraper.js';
import { Cache } from '../modules/cache.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_UTILITIES') {
    const map = message.map;
    if (typeof map !== 'string' || !Object.hasOwn(MAPS, map)) {
      sendResponse({ ok: false, error: `mapa inválido: ${map}` });
      return;
    }
    handleFetchUtilities(map, sendResponse);
    return true;
  }
});

async function fetchAndMergeType(map, type) {
  const [community, official] = await Promise.allSettled([
    fetchUtilityList(map, type),
    fetchOfficialNadeList(map, type),
  ]);

  const communityItems = community.status === 'fulfilled' ? community.value : [];
  const officialItems = official.status === 'fulfilled' ? official.value : [];

  if (community.status === 'rejected') console.error(`[FU] community ${type}:`, community.reason);
  if (official.status === 'rejected') console.error(`[FU] official ${type}:`, official.reason);

  // Deduplicar por slug — community tiene precedencia en caso de colisión
  const seen = new Set(communityItems.map((n) => n.slug));
  const merged = [...communityItems, ...officialItems.filter((n) => !seen.has(n.slug))];
  console.log(`[FU] ${map}/${type}: ${communityItems.length} community + ${officialItems.length} official = ${merged.length} total`);
  return merged;
}

async function handleFetchUtilities(map, sendResponse) {
  try {
    const cached = await Cache.get(`utilities_${map}`);
    if (cached) {
      sendResponse({ ok: true, data: cached, fromCache: true });
      return;
    }

    const results = await Promise.allSettled(
      UTILITY_TYPES.map((type) => fetchAndMergeType(map, type))
    );

    const data = {};
    UTILITY_TYPES.forEach((type, i) => {
      const result = results[i];
      data[type] = result.status === 'fulfilled' ? result.value : [];
      if (result.status === 'rejected') console.error(`[FU] ${type}:`, result.reason);
    });

    await Cache.set(`utilities_${map}`, data, CACHE_TTL_MS);
    sendResponse({ ok: true, data });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
}
