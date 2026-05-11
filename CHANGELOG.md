# Changelog

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
