# Changelog

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
