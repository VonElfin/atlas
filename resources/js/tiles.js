// Tiles decodificados em memória (usados na leitura de valores) e fallback
// de tiles ausentes para o ancestral ampliado.

const TILE = 256;
const cache = new Map(); // url -> Promise<ImageData | null>
const CACHE_MAX = 192;
// Sem timeout, um servidor que não responde prende uma das 6 conexões por host para sempre.
const FETCH_TIMEOUT_MS = 12000;

const timed = (url, signal) =>
  fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS) });

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
      const res = await timed(url).catch(() => null);
      if (res?.ok) return decode(await res.blob());
      if (!fallback || z === 0) {
        if (!res) cache.delete(key); // falha de rede: tente de novo na próxima vez
        return null;
      }
      return ancestorTile(template, z, x, y, fallback);
    })().catch(() => null),
  );
}

// `signal`: se o MapLibre já cancelou o tile, não gasta conexões buscando ancestrais.
async function ancestorTile(template, z, x, y, levels, signal) {
  for (let k = 1; k <= Math.min(levels, z); k++) {
    signal?.throwIfAborted();
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
  const res = await timed(fillTemplate(template, z, x, y), abort.signal).catch((err) => {
    if (abort.signal.aborted) throw err;
    return null;
  });
  if (res?.ok) return { data: await res.arrayBuffer() };
  const img = await ancestorTile(template, z, x, y, levels, abort.signal);
  if (img) return { data: await createImageBitmap(img) };
  throw new Error('Tile indisponível');
}

function parse(url) {
  const m = url.match(/^[\w-]+:\/\/(\d+)\/(\d+)\/(\d+)\??(.*)$/);
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), q: new URLSearchParams(m[4]) };
}

export function registerProtocols(maplibregl) {
  maplibregl.addProtocol('atlas-fb', fallbackProtocol);
}

/** URL de tiles com fallback para ancestrais (ex.: imagens Esri sem cobertura). */
export const fallbackUrl = (template, levels = 6) =>
  `atlas-fb://{z}/{x}/{y}?levels=${levels}&src=${encodeURIComponent(template)}`;
