// csnades.gg expone sus datos como JSON en /{map}/{utilityType}.json
// Cada item incluye youtubeId directamente — no necesitamos fetchear páginas de detalle.

import { CSNADES_BASE } from './config.js';

function normalizeSide(team) {
  if (team === 't') return 'T';
  if (team === 'ct') return 'CT';
  return 'UNKNOWN';
}

function buildVideoUrl(video) {
  if (!video?.youtubeId) return null;
  const params = new URLSearchParams({ start: video.start ?? 0 });
  if (video.end) params.set('end', video.end);
  return `https://www.youtube-nocookie.com/embed/${video.youtubeId}?${params}`;
}

function parseItem(item, map, utilityType) {
  return {
    name: `${item.titleTo} from ${item.titleFrom}`,
    slug: item.slug,
    side: normalizeSide(item.team),
    videoUrl: buildVideoUrl(item.video),
    detailUrl: `${CSNADES_BASE}/${map}/${utilityType}/${item.slug}`,
  };
}

export async function fetchUtilityList(map, utilityType) {
  const url = `${CSNADES_BASE}/api/server/community/${map}/${utilityType}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`csnades.gg: HTTP ${res.status} en ${url}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Respuesta inesperada de csnades.gg');

  return data.map((item) => parseItem(item, map, utilityType));
}
