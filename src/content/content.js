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
// FACEIT usa React Router. Los content scripts viven en un "isolated world"
// separado del contexto de la página, por lo que parchear history.pushState
// no intercepta las llamadas del router de FACEIT.
// Solución: polling de la URL cada 500ms — simple y confiable.
let lastUrl = location.href;

setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    onPageChange();
  }
}, 500);

window.addEventListener('popstate', onPageChange);

// ─── Detección del mapa desde el DOM ─────────────────────────────────────────
function normalizeMapName(raw) {
  const lower = raw.toLowerCase().trim();
  if (lower === 'dust 2' || lower === 'dust2') return 'dust2';
  return lower.replace(/\s+/g, '');
}

function detectMapFromDOM() {
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3"/>
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

  const check = async () => {
    const map = detectMapFromDOM();
    if (map && map !== currentMap) {
      mapObserver?.disconnect();
      await loadForMap(map);
    }
  };

  mapObserver = new MutationObserver(check);
  mapObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  await check(); // Revisar inmediatamente por si el mapa ya está visible
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
