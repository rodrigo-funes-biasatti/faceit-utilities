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

  async clear() {
    return new Promise((resolve) => chrome.storage.local.clear(resolve));
  },
};
