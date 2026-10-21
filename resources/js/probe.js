// Leitura de valores em um ponto a partir dos próprios tiles raster:
// elevação decodificada do Terrarium e valores GIBS pela cor do colormap.
import { TERRARIUM } from './layers.js';
import { tileImage } from './tiles.js';

const TILE = 256;

// Posição (tile e pixel) de um lng/lat em Web Mercator no zoom z.
function locate(lng, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const fx = ((((lng + 180) / 360) % 1) + 1) % 1 * n;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x = Math.min(n - 1, Math.floor(fx));
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
  return {
    x,
    y,
    px: Math.min(TILE - 1, Math.floor((fx - x) * TILE)),
    py: Math.min(TILE - 1, Math.max(0, Math.floor((fy - y) * TILE))),
  };
}

// Os tiles Web Mercator não cobrem acima desta latitude; fora dela não há valor a ler
// (antes o ponto era "grudado" na borda e mostrava o valor de outro lugar).
const MAX_LAT = 85.0511;

async function samplePixel(template, z, lng, lat) {
  if (Math.abs(lat) > MAX_LAT) return null;
  const { x, y, px, py } = locate(lng, lat, z);
  const img = await tileImage(template, z, x, y);
  if (!img) return null;
  const i = (py * img.width + px) * 4;
  return img.data.slice(i, i + 4);
}

/** Elevação em metros (negativa no oceano) ou null. */
export async function elevationAt(lng, lat, z = 11) {
  const p = await samplePixel(TERRARIUM, z, lng, lat);
  if (!p) return null;
  return p[0] * 256 + p[1] + p[2] / 256 - 32768;
}

const indexes = new WeakMap();

function colorIndex(colormap) {
  let idx = indexes.get(colormap);
  if (!idx) {
    idx = new Map(colormap.entries.map((e) => [(e.rgb[0] << 16) | (e.rgb[1] << 8) | e.rgb[2], e]));
    indexes.set(colormap, idx);
  }
  return idx;
}

/** Entrada do colormap correspondente à cor do pixel, ou null se sem dado. */
export async function colormapEntryAt(template, z, colormap, lng, lat) {
  const p = await samplePixel(template, z, lng, lat);
  if (!p || p[3] < 128) return null;
  const exact = colorIndex(colormap).get((p[0] << 16) | (p[1] << 8) | p[2]);
  if (exact) return exact;
  // Fallback: cor mais próxima (caso o tile tenha sido reamostrado).
  let best = null;
  let bestD = Infinity;
  for (const e of colormap.entries) {
    const d = (e.rgb[0] - p[0]) ** 2 + (e.rgb[1] - p[1]) ** 2 + (e.rgb[2] - p[2]) ** 2;
    if (d < bestD) [best, bestD] = [e, d];
  }
  return bestD <= 48 ? best : null;
}
