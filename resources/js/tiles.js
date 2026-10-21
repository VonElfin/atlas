// Tiles decodificados em memória, fallback para tiles ausentes e reprojeção
// Web Mercator -> Equal Earth (feita aqui porque o MapLibre usa os tiles de
// um CRS customizado como vêm, sem reprojetar o conteúdo).

const TILE = 256;
const cache = new Map(); // url -> Promise<ImageData | null>
const CACHE_MAX = 192;

export const fillTemplate = (template, z, x, y) =>
  template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

function remember(key, promise) {
  cache.set(key, promise);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return promise;
}

async function decode(blob) {
  // Sem conversão de cor nem pré-multiplicação: os valores dos pixels importam
  // (colormaps e elevação codificada).
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Recorte de um ancestral ampliado para o tamanho do tile.
async function fromAncestor(img, levels, x, y) {
  const span = TILE >> levels;
  const mask = (1 << levels) - 1;
  const bmp = await createImageBitmap(img, (x & mask) * span, (y & mask) * span, span, span, {
    resizeWidth: TILE,
    resizeHeight: TILE,
    resizeQuality: 'medium',
  });
  const ctx = new OffscreenCanvas(TILE, TILE).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, TILE, TILE);
}

/**
 * Tile decodificado (ImageData) ou null. Com `fallback > 0`, um tile ausente
 * (404) é substituído pelo ancestral mais próximo, ampliado.
 */
export function tileImage(template, z, x, y, fallback = 0) {
  const url = fillTemplate(template, z, x, y);
  const key = fallback ? `${url}#fb` : url;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  return remember(
    key,
    (async () => {
      const res = await fetch(url).catch(() => null);
      if (res?.ok) return decode(await res.blob());
      if (!fallback || z === 0) {
        if (!res) cache.delete(key); // falha de rede: tente de novo na próxima vez
        return null;
      }
      return ancestorTile(template, z, x, y, fallback);
    })().catch(() => null),
  );
}

async function ancestorTile(template, z, x, y, levels) {
  for (let k = 1; k <= Math.min(levels, z); k++) {
    const up = await tileImage(template, z - k, x >> k, y >> k);
    if (up) return fromAncestor(up, k, x, y);
  }
  return null;
}

// ---------------------------------------------------------------- protocolos

// atlas-fb://{z}/{x}/{y}?src=<template>&levels=N
// Caminho rápido: devolve os bytes do tile. Só decodifica quando precisa recortar um ancestral.
async function fallbackProtocol(params, abort) {
  const { z, x, y, q } = parse(params.url);
  const template = q.get('src');
  const levels = Number(q.get('levels') ?? 6);
  // O 404 do Esri vem sem cabeçalho CORS, então o fetch rejeita em vez de
  // devolver o status: qualquer falha que não seja cancelamento conta como ausente.
  const res = await fetch(fillTemplate(template, z, x, y), { signal: abort.signal }).catch((err) => {
    if (abort.signal.aborted) throw err;
    return null;
  });
  if (res?.ok) return { data: await res.arrayBuffer() };
  const img = await ancestorTile(template, z, x, y, levels);
  if (img) return { data: await createImageBitmap(img) };
  throw new Error('Tile indisponível');
}

function parse(url) {
  const m = url.match(/^[\w-]+:\/\/(\d+)\/(\d+)\/(\d+)\??(.*)$/);
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), q: new URLSearchParams(m[4]) };
}

export function registerProtocols(maplibregl) {
  maplibregl.addProtocol('atlas-fb', fallbackProtocol);
  maplibregl.addProtocol('atlas-ee', equalEarthProtocol);
  maplibregl.addProtocol('atlas-eemask', equalEarthMaskProtocol);
}

/** URL de tiles com fallback para ancestrais (ex.: imagens Esri sem cobertura). */
export const fallbackUrl = (template, levels = 6) =>
  `atlas-fb://{z}/{x}/{y}?levels=${levels}&src=${encodeURIComponent(template)}`;

/** URL de tiles reprojetados para Equal Earth a partir de um template Web Mercator. */
export const equalEarthUrl = (template, { maxzoom, sampling = 'linear', fallback = 0 }) =>
  `atlas-ee://{z}/{x}/{y}?max=${maxzoom}&s=${sampling}&fb=${fallback}&src=${encodeURIComponent(template)}`;

export const EQUAL_EARTH_MASK_URL = 'atlas-eemask://{z}/{x}/{y}';

// ---------------------------------------------------------------- Equal Earth

// Šavrič, Patterson & Jenny (2018). Projeção de área igual, endossada em 2025
// pela União Africana na campanha "Correct The Map".
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const R = 6378137;
const D2R = Math.PI / 180;

const yOfTheta = (t) => {
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
};
const dyOfTheta = (t) => {
  const t2 = t * t;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2);
};

const THETA_MAX = Math.PI / 3;
const X_MAX = (R * Math.PI) / (M * A1);
const Y_MAX = R * yOfTheta(THETA_MAX);

// θ a partir de y (unidades de R), por Newton.
function thetaOf(yr) {
  let t = yr / A1;
  for (let i = 0; i < 12; i++) {
    const d = (yOfTheta(t) - yr) / dyOfTheta(t);
    t -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return t;
}

export const EQUAL_EARTH_CRS = {
  name: 'custom:equal-earth',
  projection: {
    forward([lng, lat]) {
      const t = Math.asin(M * Math.sin(Math.max(-90, Math.min(90, lat)) * D2R));
      return [(R * lng * D2R * Math.cos(t)) / (M * dyOfTheta(t)), R * yOfTheta(t)];
    },
    inverse([x, y]) {
      if (Math.abs(y) > Y_MAX) return null;
      const t = thetaOf(y / R);
      const lng = (M * (x / R) * dyOfTheta(t)) / Math.cos(t) / D2R;
      if (Math.abs(lng) > 180 + 1e-9) return null;
      return [lng, Math.asin(Math.sin(t) / M) / D2R];
    },
  },
  // Tile 0/0/0 é o quadrado que contém o mundo, centrado nele.
  tileMatrixSet: { origin: [-X_MAX, X_MAX], extentAtZoom0: 2 * X_MAX },
};

// Para cada linha de um tile Equal Earth a latitude é constante e a longitude
// é linear em x: lng = k·X. Pré-calcula isso por linha.
function rowsOf(z, ty) {
  const side = (2 * X_MAX) / 2 ** z;
  const top = X_MAX - ty * side;
  const rows = [];
  for (let j = 0; j < TILE; j++) {
    const Y = top - ((j + 0.5) * side) / TILE;
    if (Math.abs(Y) > Y_MAX) {
      rows.push(null);
      continue;
    }
    const t = thetaOf(Y / R);
    rows.push({ lat: Math.asin(Math.sin(t) / M), k: (M * dyOfTheta(t)) / Math.cos(t) / R });
  }
  return { rows, side };
}

// Sempre um bitmap novo: o MapLibre transfere (e invalida) o que recebe.
const EMPTY = new ImageData(TILE, TILE);
const empty = () => createImageBitmap(EMPTY);

const MAX_LAT = 85.0511 * D2R;

async function equalEarthProtocol(params) {
  const { z, x, y, q } = parse(params.url);
  const template = q.get('src');
  const maxzoom = Number(q.get('max'));
  const nearest = q.get('s') === 'nearest';
  const fallback = Number(q.get('fb'));

  const { rows, side } = rowsOf(z, y);
  if (rows.every((r) => !r)) return { data: await empty() };
  const X0 = -X_MAX + x * side;
  const dX = side / TILE;

  // Zoom de origem: tile Equal Earth e tile Mercator têm larguras parecidas
  // no zoom 0 (5,4R contra 2πR), então o mesmo z dá resolução equivalente.
  let zs = Math.max(0, Math.min(z, maxzoom));
  let need;
  for (;;) {
    need = new Set();
    const N = TILE * 2 ** zs;
    for (const r of rows) {
      if (!r) continue;
      const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, r.lat));
      const gy = (0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)) * N;
      const lngA = Math.max(-Math.PI, Math.min(Math.PI, r.k * X0));
      const lngB = Math.max(-Math.PI, Math.min(Math.PI, r.k * (X0 + side)));
      if (lngA === lngB) continue;
      // Margem de 1 px: a interpolação bilinear lê o pixel vizinho, que pode
      // estar no tile ao lado.
      const last = N / TILE - 1;
      const tyA = Math.max(0, Math.floor((gy - 1) / TILE));
      const tyB = Math.min(last, Math.floor((gy + 1) / TILE));
      const txA = Math.max(0, Math.floor(((lngA / (2 * Math.PI) + 0.5) * N - 1) / TILE));
      const txB = Math.min(last, Math.floor(((lngB / (2 * Math.PI) + 0.5) * N + 1) / TILE));
      for (let ty = tyA; ty <= tyB; ty++) for (let tx = txA; tx <= txB; tx++) need.add(ty * 1e7 + tx);
    }
    if (need.size <= 24 || zs === 0) break;
    zs--;
  }
  if (need.size === 0) return { data: await empty() };

  const N = TILE * 2 ** zs;
  const tiles = new Map();
  await Promise.all(
    [...need].map(async (key) => {
      const ty = Math.floor(key / 1e7);
      const tx = key % 1e7;
      const img = await tileImage(template, zs, tx, ty, fallback);
      if (img) tiles.set(key, img.data);
    }),
  );
  // Pixel global no zoom de origem; fora dos tiles buscados devolve null.
  const get = (gx, gy) => {
    gx = ((gx % N) + N) % N;
    gy = Math.max(0, Math.min(N - 1, gy));
    const data = tiles.get(Math.floor(gy / TILE) * 1e7 + Math.floor(gx / TILE));
    return data ? [data, ((gy % TILE) * TILE + (gx % TILE)) * 4] : null;
  };

  const out = new ImageData(TILE, TILE);
  const o = out.data;
  for (let j = 0; j < TILE; j++) {
    const r = rows[j];
    if (!r) continue;
    const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, r.lat));
    const gy = (0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI)) * N - 0.5;
    for (let i = 0; i < TILE; i++) {
      const lng = r.k * (X0 + (i + 0.5) * dX);
      if (lng < -Math.PI || lng > Math.PI) continue;
      const gx = (lng / (2 * Math.PI) + 0.5) * N - 0.5;
      const oi = (j * TILE + i) * 4;
      if (nearest) {
        const p = get(Math.round(gx), Math.round(gy));
        if (!p) continue;
        o[oi] = p[0][p[1]];
        o[oi + 1] = p[0][p[1] + 1];
        o[oi + 2] = p[0][p[1] + 2];
        o[oi + 3] = p[0][p[1] + 3];
        continue;
      }
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const a = get(x0, y0);
      const b = get(x0 + 1, y0);
      const c = get(x0, y0 + 1);
      const d = get(x0 + 1, y0 + 1);
      const any = a ?? b ?? c ?? d;
      if (!any) continue;
      const p00 = a ?? any;
      const p10 = b ?? p00;
      const p01 = c ?? p00;
      const p11 = d ?? p10;
      for (let c = 0; c < 4; c++) {
        const top = p00[0][p00[1] + c] * (1 - fx) + p10[0][p10[1] + c] * fx;
        const bot = p01[0][p01[1] + c] * (1 - fx) + p11[0][p11[1] + c] * fx;
        o[oi + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { data: await createImageBitmap(out, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) };
}

// Máscara opaca fora do contorno do mundo (com anti-aliasing 2×2), para que
// camadas de relevo — que pintam todo o tile — fiquem recortadas no oval.
async function equalEarthMaskProtocol(params) {
  const { z, x, y, q } = parse(params.url);
  const color = (q.get('c') ?? '04060d').match(/../g).map((h) => parseInt(h, 16));
  const side = (2 * X_MAX) / 2 ** z;
  const X0 = -X_MAX + x * side;
  const top = X_MAX - y * side;
  const out = new ImageData(TILE, TILE);
  const o = out.data;
  const sub = [0.25, 0.75];
  let inside = 0;
  for (let j = 0; j < TILE; j++) {
    const ks = sub.map((s) => {
      const Y = top - ((j + s) * side) / TILE;
      if (Math.abs(Y) > Y_MAX) return null;
      const t = thetaOf(Y / R);
      return (M * dyOfTheta(t)) / Math.cos(t) / R;
    });
    for (let i = 0; i < TILE; i++) {
      let cover = 0;
      for (const k of ks) {
        if (k == null) continue;
        for (const s of sub) if (Math.abs(k * (X0 + ((i + s) * side) / TILE)) <= Math.PI) cover++;
      }
      inside += cover;
      const oi = (j * TILE + i) * 4;
      o[oi] = color[0];
      o[oi + 1] = color[1];
      o[oi + 2] = color[2];
      o[oi + 3] = 255 - Math.round((cover / 4) * 255);
    }
  }
  if (inside === TILE * TILE * 4) return { data: await empty() };
  return { data: await createImageBitmap(out) };
}
