import { CSNADES_BASE, MAX_UTILITIES_PER_SECTION } from './config.js';

// ─── Side detection ───────────────────────────────────────────────────────────
// csnades.gg codifica el lado en el slug de la URL.
// Ej: "window-from-t-spawn-4" → T-side, "short-from-ct-spawn" → CT-side
function inferSideFromSlug(slug) {
  const s = slug.toLowerCase();
  if (/\bt[-_]/.test(s) || s.includes('t-spawn') || s.includes('t-side') || s.includes('from-t')) {
    return 'T';
  }
  if (/\bct[-_]/.test(s) || s.includes('ct-spawn') || s.includes('ct-side') || s.includes('from-ct')) {
    return 'CT';
  }
  return 'UNKNOWN';
}

// ─── Name formatting ──────────────────────────────────────────────────────────
// Intenta extraer un nombre legible del elemento link, o convierte el slug a Title Case
function extractName(linkEl, slug) {
  const candidate = linkEl.querySelector('[class*="name"], [class*="title"], h2, h3, h4, span');
  if (candidate?.textContent.trim()) return candidate.textContent.trim();

  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ─── List page parser ─────────────────────────────────────────────────────────
// Parsea el HTML de https://csnades.gg/{map}/{utilityType}
// Busca todos los links que coincidan con el patrón /{map}/{utilityType}/{slug}
function parseUtilityList(html, map, utilityType) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const linkPattern = new RegExp(`^/${map}/${utilityType}/([^/?#]+)$`);
  const seen = new Set();
  const items = [];

  for (const link of doc.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    const match = href?.match(linkPattern);
    if (!match || seen.has(href)) continue;

    seen.add(href);
    const slug = match[1];
    items.push({
      name: extractName(link, slug),
      slug,
      side: inferSideFromSlug(slug),
      detailUrl: `${CSNADES_BASE}${href}`,
    });

    // Tomamos el doble del máximo para que después del filtro T/CT quede suficiente
    if (items.length >= MAX_UTILITIES_PER_SECTION * 2) break;
  }

  return items;
}

// ─── Video URL extractor ──────────────────────────────────────────────────────
// Extrae la URL del video embebido en la página de detalle de una utility.
// Prioridad: iframe YouTube → link YouTube → <video> src → null
function extractVideoUrl(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const ytEmbed = doc.querySelector(
    'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]'
  );
  if (ytEmbed) return ytEmbed.getAttribute('src');

  const ytLink = doc.querySelector('a[href*="youtube.com/watch"]');
  if (ytLink) {
    try {
      const videoId = new URL(ytLink.getAttribute('href')).searchParams.get('v');
      if (videoId) return `https://www.youtube-nocookie.com/embed/${videoId}`;
    } catch (_) {}
  }

  const videoSrc =
    doc.querySelector('video[src]')?.getAttribute('src') ||
    doc.querySelector('video source[src]')?.getAttribute('src');
  if (videoSrc) return videoSrc;

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchUtilityList(map, utilityType) {
  const url = `${CSNADES_BASE}/${map}/${utilityType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`csnades.gg: HTTP ${res.status} en ${url}`);
  return parseUtilityList(await res.text(), map, utilityType);
}

export async function fetchVideoUrl(detailUrl) {
  const res = await fetch(detailUrl);
  if (!res.ok) return null;
  return extractVideoUrl(await res.text());
}
