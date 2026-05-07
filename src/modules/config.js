// Keys = slugs usados en csnades.gg URLs, values = nombres para mostrar en UI
export const MAPS = {
  mirage: 'Mirage',
  dust2: 'Dust 2',
  inferno: 'Inferno',
  nuke: 'Nuke',
  ancient: 'Ancient',
  anubis: 'Anubis',
  vertigo: 'Vertigo',
  overpass: 'Overpass',
  train: 'Train',
};

// FACEIT a veces muestra los mapas como "de_mirage" (formato Source engine)
// Este mapa los normaliza al slug de csnades.gg
export const MAP_ALIASES = {
  de_mirage: 'mirage',
  de_dust2: 'dust2',
  de_inferno: 'inferno',
  de_nuke: 'nuke',
  de_ancient: 'ancient',
  de_anubis: 'anubis',
  de_vertigo: 'vertigo',
  de_overpass: 'overpass',
  de_train: 'train',
};

export const UTILITY_TYPES = ['smokes', 'flashbangs', 'molotovs', 'hegrenades', 'combinations'];

export const CSNADES_BASE = 'https://csnades.gg';

// TTL de caché por mapa: 24hs. Las utilities no cambian seguido.
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Límite por sección para no sobrecargar la UI
export const MAX_UTILITIES_PER_SECTION = 15;
