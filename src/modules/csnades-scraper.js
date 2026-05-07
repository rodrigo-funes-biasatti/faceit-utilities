// csnades.gg expone datos de dos formas:
// 1. Community API: /api/server/community/{map}/{type} → JSON con YouTube IDs
// 2. Official nades: embebidas en el RSC payload (self.__next_f.push) de la página HTML
//    → video propio en assets.csnades.gg (MP4/WebM)

import { CSNADES_BASE } from './config.js';

// Compilada una sola vez al cargar el módulo en lugar de en cada llamada a fetchOfficialNadeList.
// Requiere resetear lastIndex antes de cada uso porque tiene flag /g.
const CHUNK_REGEX = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

function normalizeSide(team) {
  if (team === 't') return 'T';
  if (team === 'ct') return 'CT';
  return 'UNKNOWN';
}

function buildYoutubeUrl(video) {
  if (!video?.youtubeId) return null;
  const params = new URLSearchParams({ start: video.start ?? 0 });
  if (video.end) params.set('end', video.end);
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${params}`;
}

function parseCommunityItem(item, map, utilityType) {
  return {
    name: `${item.titleTo} from ${item.titleFrom}`,
    slug: item.slug,
    side: normalizeSide(item.team),
    videoUrl: buildYoutubeUrl(item.video),
    detailUrl: `${CSNADES_BASE}/${map}/${utilityType}/${item.slug}`,
  };
}

function parseOfficialItem(item, map, utilityType) {
  const videoUrl = item.assets?.videoHq?.mp4 ?? item.assets?.videoLq?.webm ?? null;
  // Combinations don't have titleTo/titleFrom — derive name from slug
  const name = (item.titleTo && item.titleFrom)
    ? `${item.titleTo} from ${item.titleFrom}`
    : item.slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return {
    name,
    slug: item.slug,
    side: normalizeSide(item.team),
    videoUrl,
    detailUrl: `${CSNADES_BASE}/${map}/${utilityType}/${item.slug}`,
  };
}

// ─── Community API ────────────────────────────────────────────────────────────
export async function fetchUtilityList(map, utilityType) {
  const url = `${CSNADES_BASE}/api/server/community/${map}/${utilityType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`csnades.gg community: HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Respuesta inesperada de csnades.gg');

  return data.map((item) => parseCommunityItem(item, map, utilityType));
}

// ─── Official nades (RSC payload parsing) ────────────────────────────────────
// csnades.gg is a Next.js App Router site. Its curated (non-community) nade
// data has no public JSON API — it is embedded in the page HTML inside
// React Server Component streaming chunks (self.__next_f.push([1, "..."])).
// We fetch the public csnades.gg page for each map/utility combination,
// extract only the nade objects (id, title, team, slug, video assets),
// and discard the rest. No user data is involved at any point.
function extractNadeObjects(payload) {
  const results = [];
  const marker = '"id":"nade_';
  let pos = 0;

  while (pos < payload.length) {
    const markerIdx = payload.indexOf(marker, pos);
    if (markerIdx === -1) break;

    // Escanear hacia atrás para encontrar el { que abre este objeto
    let objStart = markerIdx - 1;
    while (objStart > 0 && payload[objStart] !== '{') objStart--;

    // Contar llaves para encontrar el } que cierra este objeto
    let depth = 0;
    let objEnd = -1;
    for (let i = objStart; i < payload.length; i++) {
      if (payload[i] === '{') depth++;
      else if (payload[i] === '}') {
        depth--;
        if (depth === 0) { objEnd = i; break; }
      }
    }

    if (objEnd !== -1) {
      try {
        const obj = JSON.parse(payload.slice(objStart, objEnd + 1));
        if (typeof obj.id === 'string' && obj.id.startsWith('nade_') && obj.slug) {
          results.push(obj);
        }
      } catch {}
    }

    pos = markerIdx + marker.length;
  }

  return results;
}

// Combinations usan IDs numéricos ("14") en lugar de "nade_xxx", por lo que
// extractNadeObjects no las detecta. Viven en el array "nades":[{...}] del payload.
// Hay dos ocurrencias de "nades":[ — la primera es metadata resumida ([[id,side,...]]),
// la segunda tiene los objetos completos. Buscamos "nades":[{ para ir directo a los objetos.
function extractCombinationNades(payload) {
  const marker = '"nades":[{';
  const markerIdx = payload.indexOf(marker);
  if (markerIdx === -1) return [];

  const arrStart = markerIdx + marker.length - 2; // posición del '['
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < payload.length; i++) {
    if (payload[i] === '[') depth++;
    else if (payload[i] === ']') {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
  }
  if (arrEnd === -1) return [];

  try {
    const arr = JSON.parse(payload.slice(arrStart, arrEnd + 1));
    return arr.filter((item) => item.type === 'combination' && item.slug);
  } catch {
    return [];
  }
}

export async function fetchOfficialNadeList(map, utilityType) {
  const url = `${CSNADES_BASE}/${map}/${utilityType}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const html = await res.text();

  // Extraer y decodificar cada chunk del RSC payload
  const chunks = [];
  CHUNK_REGEX.lastIndex = 0; // reset obligatorio: la regex es stateful por el flag /g
  let m;
  while ((m = CHUNK_REGEX.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse('"' + m[1] + '"'));
    } catch {}
  }

  if (!chunks.length) return [];

  const payload = chunks.join('');
  const nades = [
    ...extractNadeObjects(payload),
    ...extractCombinationNades(payload),
  ];
  console.log(`[FU] official ${map}/${utilityType}: ${nades.length} nades`);
  return nades.map((item) => parseOfficialItem(item, map, utilityType));
}
