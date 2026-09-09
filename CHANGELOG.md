# Changelog

## [1.6.0] - 2026-09-09

### New features
- Side filter (ALL / T / CT) — segmented control in the filter bar that narrows the panel to one team's nades. The side already came from csnades.gg (`item.team`) and was normalised by the scraper; it is now filterable instead of only being a section header.
- The sliding indicator takes the colour of the active side (orange for T, blue for CT), matching the existing `T-SIDE` / `CT-SIDE` labels.
- With a side pinned, the redundant `T-SIDE` / `CT-SIDE` header is hidden to save vertical space.
- New keyboard shortcut: `T` cycles ALL → T → CT.
- Choice persists across sessions and maps via `chrome.storage.local` (`fu_side_filter`).

### Performance
- Native base64 for the video relay. The service worker built the payload with `String.fromCharCode` in 8 KB chunks and the content script decoded it with a byte-by-byte JS loop that ran on FACEIT's main thread. Both now use `Uint8Array#toBase64` / `Uint8Array.fromBase64` when available, with the previous implementations kept as a fallback. Measured on 3 MB of binary data: encode 65.3 ms → 1.0 ms, decode 9.9 ms → 1.2 ms, byte-identical round trip.
- `chrome.storage.local.getKeys()` replaces `get(null)` when listing cache keys, in both the 6-hourly update check and `Cache.clear()`. `get(null)` deserialised every cached map (megabytes of nade data) just to read key names.
- The 6-hourly update check now runs its per-map requests with `Promise.allSettled` instead of sequential `await`s. Up to 11 chained fetches risked the MV3 service worker being terminated before the last one finished.

### Bug fixes
- Accordion collapse state is no longer clobbered when re-applying a filter. `filterNades()` auto-expanded every matching accordion whenever the search box held any text; since the side filter and the favourites filter both re-run it with the current query, switching sides with leftover text in the search box expanded everything. Auto-expanding is now opt-in (`{ autoOpen: true }`) and only the search input asks for it.

---

## [1.5.0] - 2026-05-27

### New features
- Cache map is now fully supported — removed from the "coming soon" list, nades load from csnades.gg normally.
- Automatic update detection: the service worker now checks csnades.gg every 6 hours in the background. If the community nade count for a cached map changes, the cache for that map is invalidated so the next panel open fetches fresh data.

---

## [1.4.0] - 2026-05-18

### New features
- Language toggle (ES / EN) — small button in the panel header switches between Spanish and English for all UI text. Choice persists across sessions via `chrome.storage.local`. Only the extension UI is translated; nade names come from csnades.gg as-is.

---

## [1.3.2] - 2026-05-18

### Bug fixes
- Reverted direct content-script fetch for native videos — FACEIT's page CSP blocks `connect-src` to `assets.csnades.gg` in content scripts, causing all native videos to show the fallback link.
- Service worker relay restored as the correct approach (it is not subject to the page's CSP).
- Added `Referer: https://csnades.gg/` header to the service worker fetch — some CDNs return an empty 200 body for requests without a recognisable referrer, which was producing the gray player.
- Added guard: if the base64 payload is empty, the fallback link is shown instead of an unplayable gray `<video>`.
- Fixed `isConnected` guard to check the inner container node instead of the outer wrap (which is always in the DOM).

---

## [1.3.1] - 2026-05-18

### Bug fix
- Fixed native videos from `assets.csnades.gg` showing as a gray player in the published extension. Root cause: the service-worker ↔ content-script base64 relay could produce an empty payload in packed (Web Store) builds, creating a zero-byte blob that the `<video>` element could not play. Fix: the content script now fetches the video directly — Chrome extension `host_permissions` bypass CORS for content-script `fetch()` calls, so no service-worker relay is needed.

---

## [1.3.0] - 2026-05-14

### UI / UX
- Chevron rotable en acordeones indica estado abierto/cerrado
- Barra de progreso degradado (verde→azul) en el borde inferior del header
- Items aprendidos con borde verde, fondo tintado y nombre tachado
- Botones ★ y ○ siempre visibles con área de click ampliada y fondo al hover/activo
- Video de latas se abre y cierra con animación suave (grid-template-rows)
- Pulse naranja en el botón toggle al detectar el mapa (si el panel está cerrado)
- Skeleton de carga con shimmer animado reemplaza el texto gris de espera
- Glassmorphism sutil en el panel (backdrop-filter blur)
- Línea de color por tipo de granada en el borde izquierdo de cada acordeón
- Glow animado en el buscador y selector de mapa al hacer foco
- Thumbnail escala y muestra anillo naranja al hacer hover sobre un item
- Panel se abre con easing expo-out (más fluido)
- Footer colapsado con corazón visible; se expande al hover mostrando donación y crédito
- Header en dos filas: nombre del mapa más grande en fila 1, progreso y badge en fila 2
- Contadores de acordeón muestran `aprendidas/total` con color según porcentaje completado
- Botón `?` con tooltip de atajos de teclado (posicionado fuera del panel para no cortarse)
- Crédito `by @rodritest` con link a Instagram en el footer

### Mejoras de accesibilidad
- Navegación por teclado: `⌥G`/`Alt+G` toggle, `Esc` cerrar, `F` buscar, `S` favoritos, `C` compacto, `↑↓` navegar items
- Atajo de toggle detecta OS y muestra `⌥G` en Mac o `Alt+G` en Windows

### Bug fixes
- Animación de acordeones restaurada con `::details-content` + `interpolate-size`
- Tooltip de atajos movido a `document.body` con `position:fixed` para no cortarse por `overflow:hidden`
- Shortcut `⌥G`/`Alt+G` usa `e.code` en lugar de `e.key` (Option+G en Mac produce `©`, no `g`)

---

## [1.2.0] - 2026-05-11

### New features
- Favorites (★) per map — persists across sessions, sorts to top of each list, badge counter on toggle button
- Learned (✓) per map — marks nades as practiced, fades item name, progress counter in header (X/Y learned)
- Filter by favorites — show only starred nades across all categories
- Accordion state memory — each T/CT section remembers open/closed state per map
- Compact mode — reduces padding and hides thumbnails for a denser view
- Thumbnails for nade items — YouTube preview images for community nades, native assets for official nades
- Cache and Cobblestone added to map list and browse dropdown
- Grenade type icon for Combinations category

### Bug fixes
- Fixed `Cache.clear()` wiping favorites and learned data on extension update (now only removes `utilities_*` cache keys)
- Fixed map detection picking wrong map in completed rooms (switched from first-match to frequency-based: the picked map appears more times than banned maps)
- Fixed map detection triggering during active ban/veto phase (VOTING_PHRASES guard)
- Fixed broken image when Cache or Cobblestone icon file is missing (`onerror` hides the element gracefully)
- Fixed browse mode keeping previous map selected when entering a new room

### UI improvements
- SVG icons for filter, compact, and collapse-all buttons
- CSS tooltips on all action buttons (fav, learned, filter, compact, collapse)
- Toggle button badge showing favorite count for the current map

---

## [1.1.0] - 2025-05-07

### New features
- Native csnades.gg videos now play inline inside the extension panel (previously only YouTube embeds worked)
- Grenade type icons (smoke, flashbang, molotov, HE grenade) displayed next to each category
- Map logo displayed in the panel header when a match room is detected
- HE Grenades and Combinations now load correctly (URL slug and parser fixes)
- Cache is automatically cleared on extension update so users always see fresh data

### Bug fixes
- Videos from assets.csnades.gg now play correctly (fetched via service worker to bypass FACEIT CSP and CORS restrictions)
- Fixed map icon not resetting when switching between match rooms
- Fixed combinations not appearing (RSC payload parser was skipping numeric-ID objects)
- Fixed HE Grenades returning HTTP 500 (wrong URL slug: `hegranades` → `hegrenades`)

### Other
- Toggle button now shows the extension's custom crosshair icon
- Reduced host permissions scope to minimum required

---

## [1.0.0] - 2025-04-01

- Initial release
- Detects CS2 map in FACEIT match rooms
- Loads smokes, flashbangs, molotovs, HE grenades and combinations from csnades.gg
- Displays community and official nades organized by T-Side / CT-Side
- Inline YouTube video player for community nades
- 24-hour cache per map
