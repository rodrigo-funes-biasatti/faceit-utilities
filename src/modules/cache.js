// Wrapper sobre chrome.storage.local con soporte de TTL (tiempo de expiración).
// chrome.storage.local persiste entre sesiones del browser y tiene ~10MB de límite.
// Alternativa sería sessionStorage pero ese vive en la pestaña, no en el service worker.

export const Cache = {
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        const entry = result[key];
        if (!entry) return resolve(null);
        if (Date.now() > entry.expiresAt) {
          chrome.storage.local.remove(key);
          return resolve(null);
        }
        resolve(entry.data);
      });
    });
  },

  async set(key, data, ttlMs) {
    return new Promise((resolve) => {
      chrome.storage.local.set(
        { [key]: { data, expiresAt: Date.now() + ttlMs } },
        resolve
      );
    });
  },

  // getKeys evita deserializar todos los valores cacheados solo para leer nombres.
  async clear() {
    const keys = typeof chrome.storage.local.getKeys === 'function'
      ? await chrome.storage.local.getKeys()
      : Object.keys(await new Promise((r) => chrome.storage.local.get(null, r)));
    const cacheKeys = keys.filter((k) => k.startsWith('utilities_'));
    if (cacheKeys.length === 0) return;
    return new Promise((resolve) => chrome.storage.local.remove(cacheKeys, resolve));
  },
};
