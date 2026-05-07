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
      <svg width="20" height="20" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g stroke="white" stroke-width="52" stroke-linecap="square">
          <line x1="256" y1="128" x2="256" y2="208"/>
          <line x1="256" y1="304" x2="256" y2="384"/>
          <line x1="128" y1="256" x2="208" y2="256"/>
          <line x1="304" y1="256" x2="384" y2="256"/>
        </g>
        <circle cx="256" cy="256" r="28" fill="white"/>
      </svg>
    </button>
    <div id="fu-panel" class="fu-hidden">
      <div id="fu-header">
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
  const mapEl = document.getElementById('fu-map-name');
  if (mapEl) mapEl.textContent = MAP_DISPLAY[map] ?? map;

  const content = document.getElementById('fu-content');
  if (!content) return;

  const sides = ['T', 'CT'];
  const types = ['smokes', 'flashbangs', 'molotovs', 'hegranades', 'combinations'];
  const typeLabels = {
    smokes: 'Smokes',
    flashbangs: 'Flashbangs',
    molotovs: 'Molotovs',
    hegranades: 'HE Grenades',
    combinations: 'Combinations',
  };

  let html = '';

  for (const side of sides) {
    let sideHtml = '';

    for (const type of types) {
      const items = (data[type] ?? []).filter(
        (item) => item.side === side || item.side === 'UNKNOWN'
      );
      if (items.length === 0) continue;

      sideHtml += `
        <details class="fu-accordion">
          <summary class="fu-accordion-summary">
            <span class="fu-util-dot fu-dot-${type}"></span>
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
    wrap.classList.add('fu-hidden');
    wrap.innerHTML = '';
    return;
  }

  wrap.classList.remove('fu-hidden');

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
  const videoEl = isYoutube
    ? `<iframe
        src="${escapeHtml(videoUrl)}"
        frameborder="0"
        allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      ></iframe>`
    : `<video src="${escapeHtml(videoUrl)}" controls preload="none" class="fu-native-video"></video>`;

  wrap.innerHTML = `
    <div class="fu-video-inner">
      ${videoEl}
      ${detailUrl
        ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" class="fu-watch-link fu-watch-link--small">Abrir en csnades.gg ↗</a>`
        : ''}
    </div>`;

  // Si el video nativo falla (ej: CSP de FACEIT bloquea media-src externo),
  // reemplazarlo con el link directo a csnades.gg.
  if (!isYoutube) {
    const vid = wrap.querySelector('.fu-native-video');
    if (vid) {
      vid.addEventListener('error', () => {
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
        vid.replaceWith(fallback);
      });
    }
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
    return;
  }

  // Resetear estado del lobby anterior ANTES de detectar, para que el nombre del mapa
  // anterior en nuestro propio panel no sea un falso positivo en detectMapFromDOM().
  currentMap = null;
  const mapEl = document.getElementById('fu-map-name');
  if (mapEl) mapEl.textContent = 'Esperando mapa...';

  if (MOCK.enabled) {
    await loadForMap(MOCK.map);
    return;
  }

  // Modo real: usa MutationObserver para detectar cuando el mapa aparece en el DOM
  injectPanel();
  showStatus('Esperando votación de mapa...');

  const checkFn = async () => {
    const map = detectMapFromDOM();
    if (map && map !== currentMap) {
      mapObserver?.disconnect();
      await loadForMap(map);
    }
  };

  // Throttle: document.body.innerText fuerza un reflow completo.
  // En una React SPA como FACEIT el observer puede dispararse docenas de veces
  // por segundo; ejecutar innerText en cada callback causaría jank visible.
  // Con throttle de 400ms lo limitamos a ≤2-3 veces/segundo.
  // characterData:true se omite — React actualiza el DOM insertando nuevos
  // nodos (childList), no mutando text nodes existentes.
  mapObserver = new MutationObserver(throttle(checkFn, 400));
  mapObserver.observe(document.body, { childList: true, subtree: true });
  await checkFn(); // Check inicial sin throttle para respuesta inmediata
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
