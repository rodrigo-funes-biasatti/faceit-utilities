// Content Script — se inyecta dentro de faceit.com.
// NO puede importar módulos (los content scripts no soportan ES modules por defecto).
// Se comunica con el service worker via chrome.runtime.sendMessage.

// ─── Mock mode ────────────────────────────────────────────────────────────────
// Cambiar a enabled: true + map: 'mirage' para testear sin partida real.
const MOCK = {
  enabled: false,
  map: 'mirage',
};

// ─── Constantes ───────────────────────────────────────────────────────────────
const CS2_MAP_NAMES = [
  'mirage', 'dust 2', 'dust2', 'inferno', 'nuke',
  'ancient', 'anubis', 'vertigo', 'overpass', 'train',
];

const MAP_DISPLAY = {
  mirage: 'Mirage', dust2: 'Dust 2', inferno: 'Inferno', nuke: 'Nuke',
  ancient: 'Ancient', anubis: 'Anubis', vertigo: 'Vertigo',
  overpass: 'Overpass', train: 'Train',
};

// ─── Estado ───────────────────────────────────────────────────────────────────
let currentMap = null;
let mapObserver = null;
let browseMode = false;

// ─── Detección de navegación SPA ─────────────────────────────────────────────
// Polling de URL cada 500ms. popstate cubre back/forward instantáneamente;
// ambos handlers comparten lastUrl para que no se duplique la llamada.
let lastUrl = location.href;

function handleUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    onPageChange();
  }
}

setInterval(handleUrlChange, 500);
window.addEventListener('popstate', handleUrlChange);

// ─── Detección del mapa desde el DOM ─────────────────────────────────────────
function normalizeMapName(raw) {
  const lower = raw.toLowerCase().trim();
  if (lower === 'dust 2' || lower === 'dust2') return 'dust2';
  return lower.replace(/\s+/g, '');
}

function detectMapFromDOM() {
  // Reads visible page text solely to detect which CS2 map name appears
  // in the FACEIT match room UI (e.g. "Mirage", "Ancient").
  // No page content is stored, transmitted, or used for any other purpose.
  const text = document.body.innerText.toLowerCase();
  for (const name of CS2_MAP_NAMES) {
    if (text.includes(name)) return normalizeMapName(name);
  }
  return null;
}

// ─── Inyección del panel ──────────────────────────────────────────────────────
// Todos los IDs y clases tienen prefijo "fu-" para no colisionar con el CSS de FACEIT
function injectPanel() {
  if (document.getElementById('fu-root')) return;

  const root = document.createElement('div');
  root.id = 'fu-root';
  root.innerHTML = `
    <button id="fu-toggle" title="FACEIT Utilities">
      <img src="${chrome.runtime.getURL('icons/icon32.png')}" width="22" height="22" alt="FACEIT Utilities"/>
    </button>
    <div id="fu-panel" class="fu-hidden">
      <div id="fu-header">
        <select id="fu-map-select" class="fu-hidden">
          <option value="">— Elegir mapa —</option>
          <option value="ancient">Ancient</option>
          <option value="anubis">Anubis</option>
          <option value="dust2">Dust 2</option>
          <option value="inferno">Inferno</option>
          <option value="mirage">Mirage</option>
          <option value="nuke">Nuke</option>
          <option value="overpass">Overpass</option>
          <option value="train">Train</option>
          <option value="vertigo">Vertigo</option>
        </select>
        <img id="fu-map-icon" class="fu-hidden" alt="" width="24" height="24"/>
        <span id="fu-map-name">Esperando mapa...</span>
        <a href="https://csnades.gg" target="_blank" rel="noopener noreferrer" class="fu-badge">csnades.gg</a>
        <button id="fu-close" title="Cerrar">✕</button>
      </div>
      <div id="fu-content">
        <div class="fu-status">Esperando sala de FACEIT...</div>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  document.getElementById('fu-toggle').addEventListener('click', togglePanel);
  document.getElementById('fu-close').addEventListener('click', closePanel);
  document.getElementById('fu-map-select').addEventListener('change', (e) => {
    const map = e.target.value;
    if (!map) { showStatus('Seleccioná un mapa para ver las utilidades.'); return; }
    loadForMap(map);
  });
}

function togglePanel() {
  document.getElementById('fu-panel')?.classList.toggle('fu-hidden');
}

function closePanel() {
  document.getElementById('fu-panel')?.classList.add('fu-hidden');
}

function showStatus(msg) {
  const el = document.getElementById('fu-content');
  if (el) el.innerHTML = `<div class="fu-status">${msg}</div>`;
}

// ─── Render de utilidades ─────────────────────────────────────────────────────
function renderUtilities(map, data) {
  if (!browseMode) {
    const mapEl = document.getElementById('fu-map-name');
    if (mapEl) mapEl.textContent = MAP_DISPLAY[map] ?? map;

    const mapIcon = document.getElementById('fu-map-icon');
    if (mapIcon) {
      mapIcon.src = chrome.runtime.getURL(`icons/maps/${map}.webp`);
      mapIcon.alt = MAP_DISPLAY[map] ?? map;
      mapIcon.classList.remove('fu-hidden');
    }
  }

  const content = document.getElementById('fu-content');
  if (!content) return;

  const sides = ['T', 'CT'];
  const types = ['smokes', 'flashbangs', 'molotovs', 'hegrenades', 'combinations'];
  const typeLabels = {
    smokes: 'Smokes',
    flashbangs: 'Flashbangs',
    molotovs: 'Molotovs',
    hegrenades: 'HE Grenades',
    combinations: 'Combinations',
  };
  const typeIcons = {
    smokes:     chrome.runtime.getURL('icons/grenades/smokes.webp'),
    flashbangs: chrome.runtime.getURL('icons/grenades/flashbangs.webp'),
    molotovs:   chrome.runtime.getURL('icons/grenades/molotovs.webp'),
    hegrenades: chrome.runtime.getURL('icons/grenades/hegrenades.webp'),
  };

  let html = '';

  for (const side of sides) {
    let sideHtml = '';

    for (const type of types) {
      const items = (data[type] ?? []).filter(
        (item) => item.side === side || item.side === 'UNKNOWN'
      );
      if (items.length === 0) continue;

      const iconUrl = typeIcons[type];
      sideHtml += `
        <details class="fu-accordion">
          <summary class="fu-accordion-summary">
            ${iconUrl
              ? `<img src="${iconUrl}" class="fu-util-icon" alt="${typeLabels[type]}" width="18" height="18"/>`
              : `<span class="fu-util-dot fu-dot-${type}"></span>`}
            ${typeLabels[type]}
            <span class="fu-count">${items.length}</span>
          </summary>
          <ul class="fu-list">
            ${items
              .map(
                (item) => `
              <li class="fu-item"
                data-detail-url="${encodeURIComponent(item.detailUrl)}"
                data-video-url="${encodeURIComponent(item.videoUrl ?? '')}">
                <button class="fu-item-btn">${escapeHtml(item.name)}</button>
                <div class="fu-video-wrap fu-hidden"></div>
              </li>`
              )
              .join('')}
          </ul>
        </details>
      `;
    }

    if (!sideHtml) continue;

    html += `
      <div class="fu-side-block">
        <div class="fu-side-label fu-side-${side.toLowerCase()}">${side}-Side</div>
        ${sideHtml}
      </div>
    `;
  }

  content.innerHTML = html || '<div class="fu-status">No se encontraron utilidades.</div>';

  content.querySelectorAll('.fu-item-btn').forEach((btn) => {
    btn.addEventListener('click', handleItemClick);
  });
}

// ─── Video toggle ─────────────────────────────────────────────────────────────
// El videoUrl ya viene en el dataset del item — no necesita fetch adicional.
function handleItemClick(e) {
  const btn = e.currentTarget;
  const item = btn.closest('.fu-item');
  const wrap = item.querySelector('.fu-video-wrap');

  // safeUrl valida protocolo https:// — bloquea javascript: y data: de la API externa
  const detailUrl = safeUrl(decodeURIComponent(item.dataset.detailUrl));
  const videoUrl  = safeUrl(decodeURIComponent(item.dataset.videoUrl));

  if (!wrap.classList.contains('fu-hidden')) {
    // Revocar blob URLs al cerrar para liberar memoria
    wrap.querySelectorAll('video[data-blob-url]').forEach((v) => {
      URL.revokeObjectURL(v.dataset.blobUrl);
    });
    wrap.classList.add('fu-hidden');
    wrap.innerHTML = '';
    return;
  }

  wrap.classList.remove('fu-hidden');

  const linkHtml = detailUrl
    ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" class="fu-watch-link fu-watch-link--small">Abrir en csnades.gg ↗</a>`
    : '';

  if (!videoUrl) {
    wrap.innerHTML = `
      <div class="fu-video-fallback">
        ${detailUrl
          ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" class="fu-watch-link">▶ Ver en csnades.gg</a>`
          : '<span class="fu-status">Video no disponible</span>'}
      </div>`;
    return;
  }

  const isYoutube = videoUrl.includes('youtube-nocookie.com');

  if (isYoutube) {
    wrap.innerHTML = `
      <div class="fu-video-inner">
        <iframe
          src="${escapeHtml(videoUrl)}"
          frameborder="0"
          allowfullscreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        ></iframe>
        ${linkHtml}
      </div>`;
    return;
  }

  // Videos nativos de assets.csnades.gg: el CSP de FACEIT bloquea media-src externo.
  // Solución: fetchar el MP4 desde el content script (que tiene host_permissions y
  // puede ignorar CORS/CSP), convertir a blob URL (same-origin → no bloqueado), e
  // inyectarlo en el <video>. Se revoca el blob al cerrar para no acumular memoria.
  wrap.innerHTML = `
    <div class="fu-video-inner">
      <div class="fu-video-loading">Cargando video...</div>
      ${linkHtml}
    </div>`;

  fetchBlobVideo(videoUrl, detailUrl, wrap);
}

async function fetchBlobVideo(videoUrl, detailUrl, wrap) {
  const inner = wrap.querySelector('.fu-video-inner');
  const loading = inner?.querySelector('.fu-video-loading');

  try {
    // El fetch se delega al service worker para evadir restricciones CORS del servidor.
    // El service worker devuelve base64 porque ArrayBuffer no sobrevive la serialización JSON de sendResponse.
    const res = await chrome.runtime.sendMessage({ type: 'FETCH_VIDEO', url: videoUrl });
    if (!res?.ok) throw new Error(res?.error ?? 'fetch failed');

    const binary = atob(res.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: res.mime });
    const blobUrl = URL.createObjectURL(blob);

    if (!inner || !wrap.isConnected) {
      URL.revokeObjectURL(blobUrl);
      return;
    }

    const vid = document.createElement('video');
    vid.src = blobUrl;
    vid.controls = true;
    vid.className = 'fu-native-video';
    vid.dataset.blobUrl = blobUrl; // guardado para revocarlo al cerrar
    loading?.replaceWith(vid);

  } catch (err) {
    console.error('[FU] fetchBlobVideo error:', err.message);
    if (!inner) return;
    const fallback = document.createElement('div');
    fallback.className = 'fu-video-fallback';
    if (detailUrl) {
      const link = document.createElement('a');
      link.href = detailUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'fu-watch-link';
      link.textContent = '▶ Ver en csnades.gg';
      fallback.appendChild(link);
    }
    loading?.replaceWith(fallback);
  }
}

// ─── Carga de utilidades ──────────────────────────────────────────────────────
async function loadForMap(map) {
  currentMap = map;
  injectPanel();

  // Abre el panel automáticamente cuando se detecta el mapa
  document.getElementById('fu-panel')?.classList.remove('fu-hidden');
  showStatus('Cargando utilidades...');

  const res = await chrome.runtime.sendMessage({ type: 'FETCH_UTILITIES', map });

  if (!res?.ok) {
    showStatus(`Error: ${res?.error ?? 'desconocido'}`);
    return;
  }

  renderUtilities(map, res.data);
}

// ─── Lógica principal ─────────────────────────────────────────────────────────
function isRoomPage() {
  return /\/cs2\/room\//.test(window.location.pathname);
}

async function onPageChange() {
  mapObserver?.disconnect();

  if (!isRoomPage()) {
    currentMap = null;
    browseMode = true;
    injectPanel();
    // Mostrar select, ocultar nombre/ícono de sala
    document.getElementById('fu-map-select')?.classList.remove('fu-hidden');
    document.getElementById('fu-map-name')?.classList.add('fu-hidden');
    document.getElementById('fu-map-icon')?.classList.add('fu-hidden');
    // Si el usuario ya había elegido un mapa, mantenerlo; si no, mostrar prompt
    const select = document.getElementById('fu-map-select');
    if (select?.value) {
      await loadForMap(select.value);
    } else {
      showStatus('Seleccioná un mapa para ver las utilidades.');
    }
    return;
  }

  // ── Modo sala ──────────────────────────────────────────────────────────────
  browseMode = false;
  // Ocultar select y restaurar nombre/ícono
  document.getElementById('fu-map-select')?.classList.add('fu-hidden');
  document.getElementById('fu-map-name')?.classList.remove('fu-hidden');

  // Resetear estado del lobby anterior ANTES de detectar, para que el nombre del mapa
  // anterior en nuestro propio panel no sea un falso positivo en detectMapFromDOM().
  currentMap = null;
  const mapEl = document.getElementById('fu-map-name');
  if (mapEl) mapEl.textContent = 'Esperando mapa...';
  const mapIcon = document.getElementById('fu-map-icon');
  if (mapIcon) { mapIcon.src = ''; mapIcon.classList.add('fu-hidden'); }

  if (MOCK.enabled) {
    await loadForMap(MOCK.map);
    return;
  }

  injectPanel();
  showStatus('Esperando votación de mapa...');

  const checkFn = async () => {
    const map = detectMapFromDOM();
    if (map && map !== currentMap) {
      mapObserver?.disconnect();
      await loadForMap(map);
    }
  };

  mapObserver = new MutationObserver(throttle(checkFn, 400));
  mapObserver.observe(document.body, { childList: true, subtree: true });
  await checkFn();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    }
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Valida que una URL use protocolo https — previene javascript: y data: injection.
function safeUrl(url) {
  if (!url) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
onPageChange();
