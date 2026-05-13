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
  'ancient', 'anubis', 'vertigo', 'overpass', 'train', 'cache', 'cobblestone',
];

const MAP_DISPLAY = {
  mirage: 'Mirage', dust2: 'Dust 2', inferno: 'Inferno', nuke: 'Nuke',
  ancient: 'Ancient', anubis: 'Anubis', vertigo: 'Vertigo',
  overpass: 'Overpass', train: 'Train', cache: 'Cache', cobblestone: 'Cobblestone',
};

// Mapas reconocidos pero sin cobertura en csnades.gg todavía.
const MAPS_UNSUPPORTED = new Set(['cache', 'cobblestone']);

// ─── Estado ───────────────────────────────────────────────────────────────────
let currentMap = null;
let mapObserver = null;
let browseMode = false;
let favFilterActive = false;
let compactMode = false;
let restoringAccordions = false;
let saveAccordionDebounce = null;

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

// Frases que indican que el veto/ban de mapa está en curso.
// Cuando están presentes, todos los mapas aparecen como opciones en el DOM
// y cualquier detección de nombre sería un falso positivo.
const VOTING_PHRASES = [
  'baneando un mapa', // es
  'eligiendo un mapa', // es
  'banning a map',    // en
  'picking a map',    // en
  'banindo um mapa',  // pt
];

function detectMapFromDOM() {
  // Skips detection while map veto/ban is actively in progress (all maps appear as options).
  const text = document.body.innerText.toLowerCase();
  if (VOTING_PHRASES.some((phrase) => text.includes(phrase))) return null;

  // Count occurrences of each map name. The picked map appears in multiple
  // places (banner, match header, pick entry), while banned maps appear only
  // once in the veto history — so the highest count wins.
  const scores = {};
  for (const name of CS2_MAP_NAMES) {
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(name, pos)) !== -1) { count++; pos += name.length; }
    if (count > 0) {
      const key = normalizeMapName(name);
      scores[key] = (scores[key] ?? 0) + count;
    }
  }

  if (Object.keys(scores).length === 0) return null;
  const best = Object.entries(scores).reduce((a, b) => b[1] > a[1] ? b : a);
  console.log('[FU] map scores:', scores, '→', best[0]);
  return best[0];
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
      <span id="fu-toggle-badge" class="fu-hidden"></span>
    </button>
    <div id="fu-panel" class="fu-hidden">
      <div id="fu-header">
        <div class="fu-header-row1">
          <img id="fu-map-icon" class="fu-hidden" alt="" width="24" height="24"/>
          <select id="fu-map-select" class="fu-hidden">
            <option value="">— Elegir mapa —</option>
            <option value="ancient">Ancient</option>
            <option value="anubis">Anubis</option>
            <option value="cache">Cache</option>
            <option value="cobblestone">Cobblestone</option>
            <option value="dust2">Dust 2</option>
            <option value="inferno">Inferno</option>
            <option value="mirage">Mirage</option>
            <option value="nuke">Nuke</option>
            <option value="overpass">Overpass</option>
            <option value="train">Train</option>
            <option value="vertigo">Vertigo</option>
          </select>
          <span id="fu-map-name">Esperando mapa...</span>
          <button id="fu-close" title="Cerrar">✕</button>
        </div>
        <div class="fu-header-row2">
          <span id="fu-progress" class="fu-hidden" title="Latas aprendidas"></span>
          <a href="https://csnades.gg" target="_blank" rel="noopener noreferrer" class="fu-badge">csnades.gg</a>
        </div>
      </div>
      <div id="fu-search-bar" class="fu-hidden">
        <input id="fu-search" type="text" placeholder="Buscar lata..." autocomplete="off" spellcheck="false"/>
        <button id="fu-fav-filter" data-tooltip="Solo favoritos"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg></button>
        <button id="fu-compact-toggle" data-tooltip="Modo compacto"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="2" y1="11" x2="14" y2="11"/><line x1="2" y1="15" x2="14" y2="15"/></svg></button>
        <button id="fu-collapse-all" data-tooltip="Colapsar todo"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,10 8,5 13,10"/><polyline points="3,14 8,9 13,14"/></svg></button>
      </div>
      <div id="fu-content">
        <div class="fu-status">Esperando sala de FACEIT...</div>
      </div>
      <div id="fu-footer">
        <a href="https://paypal.me/rodritest" target="_blank" rel="noopener noreferrer" id="fu-donate">
          ♥ Invitame un café
        </a>
        <span class="fu-footer-sep">—</span>
        <a href="https://www.instagram.com/rodritest" target="_blank" rel="noopener noreferrer" id="fu-author">by @rodritest</a>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  document.getElementById('fu-toggle').addEventListener('click', togglePanel);
  document.getElementById('fu-close').addEventListener('click', closePanel);
  document.getElementById('fu-search').addEventListener('input', (e) => filterNades(e.target.value));
  document.getElementById('fu-fav-filter').addEventListener('click', () => {
    favFilterActive = !favFilterActive;
    document.getElementById('fu-fav-filter').classList.toggle('fu-active', favFilterActive);
    filterNades(document.getElementById('fu-search')?.value ?? '');
  });
  document.getElementById('fu-compact-toggle').addEventListener('click', toggleCompactMode);
  document.getElementById('fu-collapse-all').addEventListener('click', () => {
    const input = document.getElementById('fu-search');
    if (input) input.value = '';
    document.querySelectorAll('#fu-content .fu-accordion').forEach((a) => {
      a.open = false;
      a.style.display = '';
    });
    document.querySelectorAll('#fu-content .fu-item, #fu-content .fu-side-block').forEach((el) => {
      el.style.display = '';
    });
    document.querySelector('#fu-content .fu-no-results')?.remove();
  });
  document.addEventListener('keydown', handlePanelKeydown);
  initCompactMode();
  document.getElementById('fu-map-select').addEventListener('change', (e) => {
    const map = e.target.value;
    if (!map) {
      setMapIcon(null);
      showStatus('Seleccioná un mapa para ver las utilidades.');
      return;
    }
    setMapIcon(map);
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
  document.getElementById('fu-search-bar')?.classList.add('fu-hidden');
  const input = document.getElementById('fu-search');
  if (input) input.value = '';
  favFilterActive = false;
  document.getElementById('fu-fav-filter')?.classList.remove('fu-active');
  document.getElementById('fu-progress')?.classList.add('fu-hidden');
  document.getElementById('fu-toggle-badge')?.classList.add('fu-hidden');
}

function showLoadingSkeleton() {
  const el = document.getElementById('fu-content');
  if (!el) return;
  const item = (w) => `
    <div class="fu-skeleton-item">
      <div class="fu-skeleton-block fu-skeleton-line" style="width:${w}%"></div>
    </div>`;
  const group = `
    <div class="fu-skeleton-group">
      <div class="fu-skeleton-block fu-skeleton-header"></div>
      ${item(60)}${item(45)}${item(70)}${item(38)}
    </div>`;
  el.innerHTML = group + group;
  document.getElementById('fu-search-bar')?.classList.add('fu-hidden');
  document.getElementById('fu-progress')?.classList.add('fu-hidden');
  document.getElementById('fu-toggle-badge')?.classList.add('fu-hidden');
}

// ─── Render de utilidades ─────────────────────────────────────────────────────
function renderUtilities(map, data) {
  setMapIcon(map);
  if (!browseMode) {
    const mapEl = document.getElementById('fu-map-name');
    if (mapEl) mapEl.textContent = MAP_DISPLAY[map] ?? map;
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
    smokes:       chrome.runtime.getURL('icons/grenades/smokes.webp'),
    flashbangs:   chrome.runtime.getURL('icons/grenades/flashbangs.webp'),
    molotovs:     chrome.runtime.getURL('icons/grenades/molotovs.webp'),
    hegrenades:   chrome.runtime.getURL('icons/grenades/hegrenades.webp'),
    combinations: chrome.runtime.getURL('icons/grenades/combinations.png'),
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
        <details class="fu-accordion" data-key="${side.toLowerCase()}-${type}">
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
                data-slug="${escapeHtml(item.slug)}"
                data-detail-url="${encodeURIComponent(item.detailUrl)}"
                data-video-url="${encodeURIComponent(item.videoUrl ?? '')}">
                <div class="fu-item-main">
                  <button class="fu-item-btn">
                    <span class="fu-item-name">${escapeHtml(item.name)}</span>
                    ${item.thumbnailUrl ? `<img class="fu-item-thumb" src="${escapeHtml(item.thumbnailUrl)}" loading="lazy" alt=""/>` : ''}
                  </button>
                  <div class="fu-item-actions">
                    <button class="fu-fav-btn" data-tooltip="Favorito" aria-label="Favorito">☆</button>
                    <button class="fu-learned-btn" data-tooltip="Aprendida" aria-label="Aprendida">○</button>
                  </div>
                </div>
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
  content.querySelectorAll('.fu-fav-btn').forEach((btn) => {
    btn.addEventListener('click', handleFavClick);
  });
  content.querySelectorAll('.fu-learned-btn').forEach((btn) => {
    btn.addEventListener('click', handleLearnedClick);
  });

  content.querySelectorAll('.fu-accordion').forEach((accordion) => {
    accordion.addEventListener('toggle', debouncedSaveAccordionState);
  });

  document.getElementById('fu-search-bar')?.classList.remove('fu-hidden');
  applyUserData(map);

  // Pulse en el toggle si el panel está cerrado — ayuda a descubrir la extensión
  const panel = document.getElementById('fu-panel');
  const toggle = document.getElementById('fu-toggle');
  if (panel?.classList.contains('fu-hidden') && toggle) {
    toggle.classList.add('fu-pulse');
    toggle.addEventListener('animationend', () => toggle.classList.remove('fu-pulse'), { once: true });
  }
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
    // Limpiar contenido después de que termine la transición de colapso
    wrap.addEventListener('transitionend', () => { wrap.innerHTML = ''; }, { once: true });
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

  document.getElementById('fu-panel')?.classList.remove('fu-hidden');

  if (MAPS_UNSUPPORTED.has(map)) {
    const name = MAP_DISPLAY[map] ?? map;
    setMapIcon(map);
    if (!browseMode) {
      const mapEl = document.getElementById('fu-map-name');
      if (mapEl) mapEl.textContent = name;
    }
    showStatus(`${name} aún no está disponible en csnades.gg. ¡Próximamente!`);
    return;
  }

  showLoadingSkeleton();

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
      setMapIcon(select.value);
      await loadForMap(select.value);
    } else {
      setMapIcon(null);
      showStatus('Seleccioná un mapa para ver las utilidades.');
    }
    return;
  }

  // ── Modo sala ──────────────────────────────────────────────────────────────
  browseMode = false;
  // Ocultar select y restaurar nombre/ícono
  const sel = document.getElementById('fu-map-select');
  if (sel) { sel.value = ''; sel.classList.add('fu-hidden'); }
  document.getElementById('fu-map-name')?.classList.remove('fu-hidden');

  // Resetear estado del lobby anterior ANTES de detectar, para que el nombre del mapa
  // anterior en nuestro propio panel no sea un falso positivo en detectMapFromDOM().
  currentMap = null;
  const mapEl = document.getElementById('fu-map-name');
  if (mapEl) mapEl.textContent = 'Esperando mapa...';
  setMapIcon(null);

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

// ─── Compact mode ─────────────────────────────────────────────────────────────
async function initCompactMode() {
  const result = await chrome.storage.local.get('fu_compact_mode');
  compactMode = result.fu_compact_mode ?? false;
  applyCompactMode();
}

function applyCompactMode() {
  document.getElementById('fu-panel')?.classList.toggle('fu-compact', compactMode);
  document.getElementById('fu-compact-toggle')?.classList.toggle('fu-active', compactMode);
}

async function toggleCompactMode() {
  compactMode = !compactMode;
  await chrome.storage.local.set({ fu_compact_mode: compactMode });
  applyCompactMode();
}

// ─── Memoria de acordeones ────────────────────────────────────────────────────
function debouncedSaveAccordionState() {
  if (restoringAccordions) return;
  clearTimeout(saveAccordionDebounce);
  saveAccordionDebounce = setTimeout(() => saveAccordionState(currentMap), 400);
}

async function saveAccordionState(map) {
  if (!map) return;
  const state = {};
  document.querySelectorAll('.fu-accordion[data-key]').forEach((accordion) => {
    state[accordion.dataset.key] = accordion.open;
  });
  const result = await chrome.storage.local.get('fu_accordion_state');
  const allStates = result.fu_accordion_state ?? {};
  allStates[map] = state;
  await chrome.storage.local.set({ fu_accordion_state: allStates });
}

async function restoreAccordionState(map) {
  if (!map) return;
  const result = await chrome.storage.local.get('fu_accordion_state');
  const state = (result.fu_accordion_state ?? {})[map];
  if (!state) return;
  restoringAccordions = true;
  document.querySelectorAll('.fu-accordion[data-key]').forEach((accordion) => {
    if (accordion.dataset.key in state) accordion.open = state[accordion.dataset.key];
  });
  restoringAccordions = false;
}

// ─── Favoritos y Aprendidas ───────────────────────────────────────────────────
async function loadUserData() {
  const result = await chrome.storage.local.get(['fu_favorites', 'fu_learned']);
  return {
    favorites: result.fu_favorites ?? {},
    learned: result.fu_learned ?? {},
  };
}

async function applyUserData(map) {
  const { favorites, learned } = await loadUserData();
  const mapFavs = new Set(favorites[map] ?? []);
  const mapLearned = new Set(learned[map] ?? []);

  document.querySelectorAll('.fu-item').forEach((item) => {
    const { slug } = item.dataset;
    const favBtn = item.querySelector('.fu-fav-btn');
    const learnedBtn = item.querySelector('.fu-learned-btn');
    const actions = item.querySelector('.fu-item-actions');

    const isFav = mapFavs.has(slug);
    const isLearned = mapLearned.has(slug);

    if (favBtn) {
      favBtn.textContent = isFav ? '★' : '☆';
      favBtn.classList.toggle('fu-active', isFav);
    }
    if (learnedBtn) {
      learnedBtn.textContent = isLearned ? '✓' : '○';
      learnedBtn.classList.toggle('fu-active', isLearned);
    }
    item.classList.toggle('fu-learned', isLearned);
  });

  document.querySelectorAll('.fu-list').forEach(sortListByFavorites);
  await restoreAccordionState(map);
  updateProgress();
  updateToggleBadge(map);
}

function updateToggleBadge(map) {
  if (!map) {
    document.getElementById('fu-toggle-badge')?.classList.add('fu-hidden');
    return;
  }
  chrome.storage.local.get('fu_favorites', (result) => {
    const count = ((result.fu_favorites ?? {})[map] ?? []).length;
    const badge = document.getElementById('fu-toggle-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('fu-hidden');
    } else {
      badge.classList.add('fu-hidden');
    }
  });
}

function sortListByFavorites(list) {
  const items = [...list.querySelectorAll(':scope > .fu-item')];
  const favs = items.filter((item) => item.querySelector('.fu-fav-btn')?.classList.contains('fu-active'));
  const rest = items.filter((item) => !item.querySelector('.fu-fav-btn')?.classList.contains('fu-active'));
  [...favs, ...rest].forEach((item) => list.appendChild(item));
}

async function handleFavClick(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const item = btn.closest('.fu-item');
  const { slug } = item.dataset;
  const map = currentMap || document.getElementById('fu-map-select')?.value;
  if (!map || !slug) return;

  const data = await chrome.storage.local.get('fu_favorites');
  const favs = data.fu_favorites ?? {};
  const mapFavs = favs[map] ?? [];
  const idx = mapFavs.indexOf(slug);
  if (idx === -1) mapFavs.push(slug); else mapFavs.splice(idx, 1);
  favs[map] = mapFavs;
  await chrome.storage.local.set({ fu_favorites: favs });

  const isFav = idx === -1;
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('fu-active', isFav);
  const learnedActive = item.querySelector('.fu-learned-btn')?.classList.contains('fu-active') ?? false;

  const list = item.closest('.fu-list');
  if (list) sortListByFavorites(list);
  updateToggleBadge(map);
}

async function handleLearnedClick(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const item = btn.closest('.fu-item');
  const { slug } = item.dataset;
  const map = currentMap || document.getElementById('fu-map-select')?.value;
  if (!map || !slug) return;

  const data = await chrome.storage.local.get('fu_learned');
  const learned = data.fu_learned ?? {};
  const mapLearned = learned[map] ?? [];
  const idx = mapLearned.indexOf(slug);
  if (idx === -1) mapLearned.push(slug); else mapLearned.splice(idx, 1);
  learned[map] = mapLearned;
  await chrome.storage.local.set({ fu_learned: learned });

  const isLearned = idx === -1;
  btn.textContent = isLearned ? '✓' : '○';
  btn.classList.toggle('fu-active', isLearned);
  const favActive = item.querySelector('.fu-fav-btn')?.classList.contains('fu-active') ?? false;
  item.classList.toggle('fu-learned', isLearned);
  updateProgress();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function updateProgress() {
  const el = document.getElementById('fu-progress');
  const header = document.getElementById('fu-header');
  if (!el) return;
  const allItems = document.querySelectorAll('#fu-content .fu-item');
  const total = allItems.length;
  if (total === 0) {
    el.classList.add('fu-hidden');
    header?.style.setProperty('--fu-progress-pct', '0%');
    return;
  }
  const learned = [...allItems].filter((item) => item.classList.contains('fu-learned')).length;
  el.textContent = `${learned}/${total}`;
  el.classList.remove('fu-hidden');
  const pct = Math.round((learned / total) * 100);
  header?.style.setProperty('--fu-progress-pct', `${pct}%`);
}

function filterNades(query) {
  const q = query.toLowerCase().trim();
  let totalVisible = 0;

  document.querySelectorAll('.fu-side-block').forEach((sideBlock) => {
    let sideVisible = 0;

    sideBlock.querySelectorAll('.fu-accordion').forEach((accordion) => {
      let accordionVisible = 0;

      accordion.querySelectorAll('.fu-item').forEach((item) => {
        const name = item.querySelector('.fu-item-name')?.textContent.toLowerCase() ?? '';
        const isFav = item.querySelector('.fu-fav-btn')?.classList.contains('fu-active') ?? false;
        const match = (!q || name.includes(q)) && (!favFilterActive || isFav);
        item.style.display = match ? '' : 'none';
        if (match) accordionVisible++;
      });

      accordion.style.display = accordionVisible ? '' : 'none';
      if (accordionVisible) {
        if (q) accordion.open = true;
        sideVisible += accordionVisible;
      }
    });

    sideBlock.style.display = sideVisible ? '' : 'none';
    totalVisible += sideVisible;
  });

  const content = document.getElementById('fu-content');
  const noResults = content?.querySelector('.fu-no-results');
  if (q && totalVisible === 0) {
    if (!noResults) {
      const el = document.createElement('div');
      el.className = 'fu-status fu-no-results';
      el.textContent = 'Sin resultados.';
      content?.appendChild(el);
    }
  } else {
    noResults?.remove();
  }
}

function setMapIcon(map) {
  const icon = document.getElementById('fu-map-icon');
  if (!icon) return;
  if (map) {
    icon.onerror = () => icon.classList.add('fu-hidden');
    icon.src = chrome.runtime.getURL(`icons/maps/${map}.webp`);
    icon.alt = MAP_DISPLAY[map] ?? map;
    icon.classList.remove('fu-hidden');
  } else {
    icon.src = '';
    icon.classList.add('fu-hidden');
  }
}

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

function handlePanelKeydown(e) {
  const panel = document.getElementById('fu-panel');
  const isTyping = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);

  // Alt+G — toggle panel desde cualquier lugar
  if (e.altKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    panel?.classList.toggle('fu-hidden');
    return;
  }

  if (!panel || panel.classList.contains('fu-hidden')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    const openVideo = document.querySelector('.fu-video-wrap:not(.fu-hidden)');
    if (openVideo) {
      openVideo.querySelectorAll('video[data-blob-url]').forEach((v) => URL.revokeObjectURL(v.dataset.blobUrl));
      openVideo.classList.add('fu-hidden');
      openVideo.addEventListener('transitionend', () => { openVideo.innerHTML = ''; }, { once: true });
    } else {
      closePanel();
    }
    return;
  }

  if (isTyping) return;

  switch (e.key) {
    case 'f': case 'F':
      e.preventDefault();
      document.getElementById('fu-search')?.focus();
      break;
    case 's': case 'S':
      e.preventDefault();
      document.getElementById('fu-fav-filter')?.click();
      break;
    case 'c': case 'C':
      e.preventDefault();
      toggleCompactMode();
      break;
    case 'ArrowDown': case 'ArrowUp': {
      e.preventDefault();
      const items = [...document.querySelectorAll('#fu-content .fu-item:not([style*="display: none"])')];
      if (!items.length) break;
      const focused = document.activeElement?.closest('.fu-item');
      const idx = focused ? items.indexOf(focused) : -1;
      const next = e.key === 'ArrowDown'
        ? items[Math.min(idx + 1, items.length - 1)]
        : items[Math.max(idx - 1, 0)];
      next?.querySelector('.fu-item-btn')?.focus();
      break;
    }
  }
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
