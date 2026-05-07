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
  return {
    name: `${item.titleTo} from ${item.titleFrom}`,
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
// csnades.gg usa Next.js App Router con React Server Components.
// Los nades oficiales están embebidos en self.__next_f.push([1, "..."]) scripts.
// Parseamos estos chunks para extraer objetos con id "nade_XXX".
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
  const nades = extractNadeObjects(payload);
  console.log(`[FU] official ${map}/${utilityType}: ${nades.length} nades`);
  return nades.map((item) => parseOfficialItem(item, map, utilityType));
}
