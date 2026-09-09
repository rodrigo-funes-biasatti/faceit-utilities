import { MAPS, UTILITY_TYPES, CACHE_TTL_MS, CSNADES_BASE } from '../modules/config.js';
import { fetchUtilityList, fetchOfficialNadeList } from '../modules/csnades-scraper.js';
import { Cache } from '../modules/cache.js';

const UPDATE_ALARM = 'fu_update_check';
const UPDATE_PERIOD_MIN = 360; // cada 6 horas

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install' || reason === 'update') {
    Cache.clear();
    console.log(`[FU] cache cleared on ${reason}`);
  }
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForCsnadesUpdates();
});

// Lista las claves de caché sin traerse los valores. chrome.storage.local.get(null)
// deserializaba TODA la storage (megas de nades) solo para leer los nombres.
async function cachedMapSlugs() {
  const keys = typeof chrome.storage.local.getKeys === 'function'
    ? await chrome.storage.local.getKeys()
    : Object.keys(await new Promise((r) => chrome.storage.local.get(null, r)));
  return keys
    .filter((k) => k.startsWith('utilities_'))
    .map((k) => k.slice('utilities_'.length))
    .filter((slug) => Object.hasOwn(MAPS, slug));
}

// Compara el conteo de nades comunitarias en csnades.gg contra el caché local.
// Si el conteo cambió → invalida el caché para que el próximo panel load traiga datos frescos.
async function checkMapForUpdate(map) {
  const cached = await Cache.get(`utilities_${map}`);
  if (!cached) return false;

  // Los items comunitarios tienen videoUrl de YouTube (o null), nunca de assets.csnades.gg
  const cachedCount = (cached.smokes ?? []).filter(
    (n) => !n.videoUrl?.includes('assets.csnades.gg')
  ).length;

  try {
    const res = await fetch(`${CSNADES_BASE}/api/server/community/${map}/smokes`);
    if (!res.ok) return false;
    const fresh = await res.json();
    if (!Array.isArray(fresh)) return false;
    if (fresh.length === cachedCount) return false;

    await new Promise((r) => chrome.storage.local.remove(`utilities_${map}`, r));
    console.log(`[FU] ${map}: smokes community ${cachedCount} → ${fresh.length}, caché invalidado`);
    return true;
  } catch (err) {
    console.warn(`[FU] update check failed for ${map}:`, err.message);
    return false;
  }
}

async function checkForCsnadesUpdates() {
  const maps = await cachedMapSlugs();
  // En paralelo: en serie eran hasta 11 fetches encadenados y el service worker
  // de MV3 se puede terminar antes de llegar al último.
  const results = await Promise.allSettled(maps.map(checkMapForUpdate));
  const invalidated = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  if (invalidated > 0) console.log(`[FU] ${invalidated} mapa(s) invalidados`);
}

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

  if (message.type === 'FETCH_VIDEO') {
    handleFetchVideo(message.url, sendResponse);
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

// El content script no puede hacer fetch cross-origin a assets.csnades.gg por CORS.
// El service worker sí puede (tiene host_permissions sin restricción CORS).
// Devuelve el ArrayBuffer para que el content script cree un blob URL.
// ArrayBuffer no es JSON-serializable: sendResponse lo convertiría en {}.
// Solución: codificar a base64 (string) antes de enviarlo y decodificar en el content script.
async function handleFetchVideo(url, sendResponse) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'assets.csnades.gg') {
      sendResponse({ ok: false, error: 'URL no permitida' });
      return;
    }
    // Referer evita que CDNs de origen rechacen el request con cuerpo vacío.
    const res = await fetch(url, { headers: { Referer: 'https://csnades.gg/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'video/mp4';

    // toBase64 nativo evita construir el string binario intermedio (un pico de
    // memoria extra del tamaño del video). Chrome 140+; fallback en chunks para
    // evitar "Maximum call stack size exceeded".
    const bytes = new Uint8Array(buffer);
    let base64;
    if (typeof bytes.toBase64 === 'function') {
      base64 = bytes.toBase64();
    } else {
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      base64 = btoa(binary);
    }
    sendResponse({ ok: true, base64, mime });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
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
