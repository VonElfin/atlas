// Pré-carregamento: quando o mapa para, baixa em segundo plano os tiles de um anel
// ao redor da tela, do nível de zoom acima (para afastar) e do centro no nível abaixo
// (para aproximar). Quando o usuário mexe, os tiles já estão em cache.
// Qualquer movimento cancela o pré-carregamento em andamento.
import { fillTemplate, prefetchTile, realTemplate } from './tiles.js';

const CONCURRENCY = 6; // deixa conexões livres para o que o MapLibre pedir
const MAX_TILES = 240; // por parada do mapa, somando todas as fontes
const RING = 0.5; // margem de meia tela para cada lado
const DELAY_MS = 300;

const MAX_LAT = 85.0511;
const tileX = (lng, n) => Math.floor(((lng + 180) / 360) * n);
const tileY = (lat, n) => {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
};

const isEsri = (src) => realTemplate(src.tiles[0]).includes('arcgisonline.com');

// Fontes raster em uso agora: das camadas visíveis e do terreno 3D.
function activeSources(map) {
  const ids = new Set();
  for (const layer of map.getStyle().layers) {
    if (!layer.source || layer.layout?.visibility === 'none') continue;
    if (['raster', 'hillshade', 'color-relief'].includes(layer.type)) ids.add(layer.source);
  }
  const terrain = map.getTerrain();
  if (terrain) ids.add(terrain.source);
  return [...ids].map((id) => map.getSource(id)).filter((s) => s?.tiles?.length);
}

// Tiles de uma fonte num nível, em ordem de distância ao centro.
function tilesOf(src, z, range, skip) {
  const n = 2 ** z;
  const out = [];
  const cx = (range.x0 + range.x1) / 2;
  const cy = (range.y0 + range.y1) / 2;
  for (let y = Math.max(0, range.y0); y <= Math.min(n - 1, range.y1); y++) {
    for (let xi = range.x0; xi <= range.x1; xi++) {
      if (skip?.(xi, y)) continue;
      const x = ((xi % n) + n) % n;
      // Mesmo host que o MapLibre escolheria: tiles[(x + y) % n] (senão o cache não bate).
      const template = realTemplate(src.tiles[(x + y) % src.tiles.length]);
      out.push({ url: fillTemplate(template, z, x, y), d: (xi - cx) ** 2 + (y - cy) ** 2 });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((t) => t.url);
}

function plan(map) {
  const b = map.getBounds();
  const pitched = map.getPitch() > 45;
  const lists = [];
  for (const src of activeSources(map)) {
    const size = src.tileSize ?? 512;
    // Mesmo cálculo de zoom do MapLibre: raster arredonda, raster-dem trunca.
    const raw = map.getZoom() + Math.log2(512 / size);
    const zFor = (dz) => Math.max(src.minzoom ?? 0, Math.min(src.maxzoom ?? 22, (src.type === 'raster' ? Math.round : Math.floor)(raw) + dz));
    const z = zFor(0);
    const n = 2 ** z;
    const inner = { x0: tileX(b.getWest(), n), x1: tileX(b.getEast(), n), y0: tileY(b.getNorth(), n), y1: tileY(b.getSouth(), n) };
    const w = inner.x1 - inner.x0 + 1;
    const h = inner.y1 - inner.y0 + 1;
    // Inclinado, a área visível já vai até o horizonte: só um tile de margem. O Esri
    // também só ganha um tile de margem: ele trava sob carga, e cada tile a mais pesa.
    const light = pitched || isEsri(src);
    const mx = light ? 1 : Math.max(1, Math.ceil(w * RING));
    const my = light ? 1 : Math.max(1, Math.ceil(h * RING));
    const outer = { x0: inner.x0 - mx, x1: inner.x1 + mx, y0: inner.y0 - my, y1: inner.y1 + my };
    const inside = (x, y) => x >= inner.x0 && x <= inner.x1 && y >= inner.y0 && y <= inner.y1;

    const list = tilesOf(src, z, outer, inside); // anel ao redor da tela
    const zUp = zFor(-1);
    if (zUp < z) {
      // afastar: área ampliada, um nível acima (1/4 dos tiles)
      list.push(...tilesOf(src, zUp, { x0: outer.x0 >> 1, x1: outer.x1 >> 1, y0: outer.y0 >> 1, y1: outer.y1 >> 1 }));
    }
    const zDown = zFor(1);
    if (zDown > z && !light) {
      // aproximar: metade central da tela, um nível abaixo
      const qx = Math.floor(w / 4);
      const qy = Math.floor(h / 4);
      list.push(...tilesOf(src, zDown, { x0: (inner.x0 + qx) * 2, x1: (inner.x1 - qx) * 2 + 1, y0: (inner.y0 + qy) * 2, y1: (inner.y1 - qy) * 2 + 1 }));
    }
    lists.push(list);
  }
  // Intercala as fontes para que todas ganhem margem antes do limite. Em zoom baixo a
  // área dá a volta no mundo e repete tiles: o Set descarta as repetições.
  const urls = new Set();
  for (let i = 0; urls.size < MAX_TILES && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && urls.size < MAX_TILES) urls.add(l[i]);
  }
  return [...urls];
}

export function setupPrefetch(map) {
  let ctrl = null;
  let timer = null;
  const stop = () => {
    clearTimeout(timer);
    ctrl?.abort();
    ctrl = null;
  };
  const stats = { runs: 0, tiles: 0 };

  async function run() {
    if (map.isMoving() || document.hidden) return;
    stop();
    const c = (ctrl = new AbortController());
    const urls = plan(map);
    stats.runs++;
    let i = 0;
    const worker = async () => {
      while (i < urls.length && !c.signal.aborted) {
        const url = urls[i++];
        await prefetchTile(url, c.signal);
        if (!c.signal.aborted) stats.tiles++;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  map.on('movestart', stop);
  map.on('idle', () => {
    clearTimeout(timer);
    timer = setTimeout(run, DELAY_MS);
  });
  return stats;
}
