// Tiles decodificados em memória (usados na leitura de valores) e fallback
// de tiles ausentes para o ancestral ampliado.

const TILE = 256;
// Bitmap 1×1 transparente: tile vazio sem erro no console nem nova tentativa.
const EMPTY = new ImageData(1, 1);
const cache = new Map(); // url -> Promise<ImageData | null>
const CACHE_MAX = 192;
// Sem timeout, um servidor que não responde prende uma das 6 conexões por host. O Esri
// responde em < 0,5 s em 90% dos casos, mas ~10% travam por 30–60 s, e as conexões
// presas acabam bloqueando a fila inteira: 5 s já indica tile travado.
const FETCH_TIMEOUT_MS = 5000;
const isTimeout = (err) => err?.name === 'TimeoutError';
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
// Pedido de reserva: o Esri segura parte das requisições por 30 s ou mais (medido:
// mediana 0,4 s, mas ~10% travam), e a mesma URL repetida costuma responder em 0,1 s.
// Se não houver resposta neste tempo, dispara o mesmo tile de novo (no outro host).
const HEDGE_MS = 1200;
const MAX_ATTEMPTS = 3;

// Hosts espelhados que servem o mesmo conteúdo.
const MIRRORS = [
  ['//server.arcgisonline.com/', '//services.arcgisonline.com/'],
  ['//gibs.earthdata.nasa.gov/', '//gibs-a.earthdata.nasa.gov/', '//gibs-b.earthdata.nasa.gov/', '//gibs-c.earthdata.nasa.gov/'],
  ['//s3.amazonaws.com/elevation-tiles-prod/', '//elevation-tiles-prod.s3.amazonaws.com/'],
];
function mirrors(url) {
  for (const [g, group] of MIRRORS.entries()) {
    const i = group.findIndex((h) => url.includes(h));
    if (i >= 0) return { group: g, urls: group.map((_, k) => url.replace(group[i], group[(i + k) % group.length])) };
  }
  return { group: -1, urls: [url] };
}

// Requisições em andamento por grupo de espelhos. Com a fila do navegador cheia
// (6 conexões por host), um pedido que só espera conexão parece "lento"; disparar
// reservas aí só aumentaria a fila. Reserva só quando há folga.
const active = new Map();
const HEDGE_BUDGET_PER_HOST = 3;

/**
 * fetch com timeout e pedidos de reserva. Resolve com a primeira resposta que chegar
 * (e cancela as outras). Uma falha rápida (ex.: 404 do Esri, que vem sem CORS e o
 * navegador reporta como erro de rede) não gera nova tentativa: só a lentidão gera.
 */
function timed(url, signal) {
  const { group, urls } = mirrors(url);
  const budget = HEDGE_BUDGET_PER_HOST * urls.length;
  return new Promise((resolve, reject) => {
    const ctrls = [];
    const timers = [];
    let inFlight = 0;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      fn(value);
    };
    const launch = (hedge) => {
      if (done || ctrls.length >= MAX_ATTEMPTS) return;
      if (hedge && (urls.length < 2 && group < 0 || (active.get(group) ?? 0) >= budget)) return;
      const c = new AbortController();
      const n = ctrls.push(c);
      inFlight++;
      active.set(group, (active.get(group) ?? 0) + 1);
      let counted = true;
      const release = () => counted && ((counted = false), active.set(group, active.get(group) - 1));
      const signals = [c.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)];
      if (signal) signals.push(signal);
      // force-cache: tile já baixado (mesmo vencido) sai do disco sem ir ao servidor.
      // Imagem de satélite e relevo quase nunca mudam, e a revalidação também trava.
      fetch(urls[(n - 1) % urls.length], { signal: AbortSignal.any(signals), cache: 'force-cache' }).then(
        (res) => {
          release();
          for (const other of ctrls) if (other !== c) other.abort();
          finish(resolve, res);
        },
        (err) => {
          release();
          inFlight--;
          if (signal?.aborted || inFlight === 0) {
            for (const other of ctrls) other.abort();
            finish(reject, err);
          }
        },
      );
    };
    launch(false);
    for (let k = 1; k < MAX_ATTEMPTS; k++) timers.push(setTimeout(() => launch(true), HEDGE_MS * k));
    signal?.addEventListener('abort', () => finish(reject, signal.reason), { once: true });
  });
}

export const fillTemplate = (template, z, x, y) =>
  template.replace('{z}', z).replace('{x}', x).replace('{y}', y);

// ---------------------------------------------------------------- cache de bytes

// O NASA GIBS responde com "Cache-Control: no-store": o navegador nunca guarda
// esses tiles, e cada volta a um lugar (ou cada pré-carregamento) baixava tudo de
// novo. Guardamos os bytes em memória durante a sessão.
const BYTES_MAX = 96e6;
const bytes = new Map(); // chave -> Promise<ArrayBuffer | null>  (null = tile vazio, 404)
const sizes = new Map();
let bytesTotal = 0;

export const isNoStore = (url) => /\/\/gibs(-[abc])?\.earthdata\.nasa\.gov\//.test(url);
// gibs, gibs-a, gibs-b e gibs-c servem o mesmo conteúdo: uma chave só.
const canon = (url) => url.replace(/\/\/gibs-[abc]\./, '//gibs.');

export function cachedBytes(url) {
  const key = canon(url);
  const hit = bytes.get(key);
  if (hit) {
    bytes.delete(key);
    bytes.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const res = await timed(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  })();
  bytes.set(key, p);
  p.then(
    (buf) => {
      if (bytes.get(key) !== p) return; // já foi descartado
      const n = buf ? buf.byteLength : 0;
      sizes.set(key, n);
      bytesTotal += n;
      while (bytesTotal > BYTES_MAX && bytes.size > 1) {
        const old = bytes.keys().next().value;
        bytes.delete(old);
        bytesTotal -= sizes.get(old) ?? 0;
        sizes.delete(old);
      }
    },
    () => bytes.get(key) === p && bytes.delete(key), // erro ou timeout: tenta de novo depois
  );
  return p;
}

/**
 * Baixa um tile em segundo plano só para ele estar em cache quando o mapa pedir:
 * no cache de bytes (GIBS) ou no cache HTTP do navegador (demais servidores).
 */
export async function prefetchTile(url, signal) {
  if (isNoStore(url)) return cachedBytes(url).catch(() => null);
  const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), priority: 'low', cache: 'force-cache' }).catch(() => null);
  // Ler o corpo inteiro: só assim a resposta é gravada no cache HTTP.
  await res?.arrayBuffer().catch(() => null);
}

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
      if (isNoStore(url)) {
        const buf = await cachedBytes(url).catch(() => null);
        return buf ? decode(new Blob([buf])) : null;
      }
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
  // Travou (timeout): tenta de novo o mesmo tile com uma conexão nova, sem ir aos
  // ancestrais (eles travariam do mesmo jeito, 5 s cada). Falha rápida = tile ausente:
  // o 404 do Esri vem sem cabeçalho CORS e o navegador o reporta como erro de rede.
  const url = fillTemplate(template, z, x, y);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await timed(url, abort.signal);
      if (res.ok) return { data: await res.arrayBuffer() };
      break;
    } catch (err) {
      if (abort.signal.aborted) throw err;
      if (!isTimeout(err)) break;
      if (attempt === 2) throw err; // o MapLibre mantém o tile pai (mais grosso) no lugar
      await wait(1000 * (attempt + 1), abort.signal);
    }
  }
  const img = levels > 0 ? await ancestorTile(template, z, x, y, levels, abort.signal) : null;
  // Sem tile nem ancestral: tile transparente (sem erro no console nem nova tentativa).
  return { data: await createImageBitmap(img ?? EMPTY) };
}

// atlas-c://{z}/{x}/{y}?src=<template>  -> servido pelo cache de bytes.
async function cachedProtocol(params, abort) {
  const { z, x, y, q } = parse(params.url);
  // O download não é cancelado (ele termina e fica no cache); só a espera é.
  const aborted = new Promise((_, no) =>
    abort.signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true }),
  );
  const buf = await Promise.race([cachedBytes(fillTemplate(q.get('src'), z, x, y)), aborted]);
  // Cópia: o MapLibre transfere o buffer para o worker, o que o esvaziaria no cache.
  return { data: buf ? buf.slice(0) : await createImageBitmap(EMPTY) };
}

function parse(url) {
  const m = url.match(/^[\w-]+:\/\/(\d+)\/(\d+)\/(\d+)\??(.*)$/);
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]), q: new URLSearchParams(m[4]) };
}

export function registerProtocols(maplibregl) {
  maplibregl.addProtocol('atlas-fb', fallbackProtocol);
  maplibregl.addProtocol('atlas-c', cachedProtocol);
}

/** URL de tiles servidos pelo cache de bytes (servidores com no-store, como o GIBS). */
export const cachedUrl = (template) => `atlas-c://{z}/{x}/{y}?src=${encodeURIComponent(template)}`;

/** Template real por trás de uma URL de protocolo (atlas-fb / atlas-c) ou ela mesma. */
export const realTemplate = (url) => {
  const m = url.match(/^atlas-[a-z]+:\/\/.*[?&]src=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : url;
};

/**
 * URL de tiles que passam pelo nosso fetch (timeout + pedido de reserva). Com `levels` > 0,
 * tiles ausentes são trocados pelo ancestral ampliado (imagens Esri sem cobertura).
 */
export const fallbackUrl = (template, levels = 6) =>
  `atlas-fb://{z}/{x}/{y}?levels=${levels}&src=${encodeURIComponent(template)}`;
