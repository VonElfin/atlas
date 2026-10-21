import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import { BASEMAPS, LABELS, OVERLAYS, RELIEF_STOPS, TERRARIUM, gibsUrl } from './layers.js';
import { colormapLegend, reliefLegend } from './legend.js';
import { colormapEntryAt, elevationAt } from './probe.js';
import { climographSvg, fetchNormals, koppen, koppenName } from './climate.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v, digits = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ---------------------------------------------------------------- plataforma

const native = typeof window.NL_PORT !== 'undefined' && typeof Neutralino !== 'undefined';
if (native) Neutralino.init();

const storage = {
  async get(key) {
    try {
      // Sem conexão nativa (ex.: modo navegador) a chamada nunca responde; não trave o início.
      const data = native
        ? await Promise.race([Neutralino.storage.getData(key), new Promise((_, no) => setTimeout(no, 1500))])
        : localStorage.getItem(key);
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      const data = JSON.stringify(value);
      if (native) await Neutralino.storage.setData(key, data);
      else localStorage.setItem(key, data);
    } catch {
      /* persistência é só conveniência */
    }
  },
};

// Links externos abrem no navegador do sistema, não dentro da janela.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href^="http"]');
  if (!a) return;
  ev.preventDefault();
  if (native) Neutralino.os.open(a.href);
  else window.open(a.href, '_blank', 'noopener');
});

// ---------------------------------------------------------------- estado

const catalog = (await (await fetch('data/gibs-catalog.json')).json()).layers;

// Variantes anuais vindas do catálogo quando a camada não lista as suas.
for (const o of OVERLAYS) {
  if (o.time === 'annual' && !o.variants) {
    const info = catalog[o.gibs()];
    o.variants = expandRanges(info.ranges, 12).map((m) => m.slice(0, 4));
    o.variant = o.variants.at(-1);
  }
}

const monthlyInfos = OVERLAYS.filter((o) => o.time === 'monthly').map((o) => catalog[o.gibs()]);
const MONTH_MIN = monthlyInfos.map((i) => i.ranges[0][0]).sort()[0];
const MONTH_MAX = monthlyInfos.map((i) => i.ranges.at(-1)[1]).sort().at(-1);
// Mês mais recente disponível em todas as camadas mensais.
const MONTH_DEFAULT = monthlyInfos.map((i) => i.ranges.at(-1)[1]).sort()[0];

const defaults = {
  projection: 'globe',
  terrain: false,
  exaggeration: 1.5,
  labels: true,
  basemap: 'satellite',
  month: MONTH_DEFAULT,
  camera: { center: [-50, -12], zoom: 1.6, pitch: 0, bearing: 0 },
  overlays: Object.fromEntries(
    OVERLAYS.map((o) => [o.id, { visible: !!o.visible, opacity: o.opacity, variant: o.variant ?? null }]),
  ),
};

const saved = (await storage.get('atlas-state')) ?? {};
const state = { ...defaults, ...saved, overlays: { ...defaults.overlays } };
for (const o of OVERLAYS) {
  const s = saved.overlays?.[o.id];
  if (!s) continue;
  state.overlays[o.id] = { ...state.overlays[o.id], ...s };
  if (o.variants && !o.variants.includes(state.overlays[o.id].variant)) state.overlays[o.id].variant = o.variant;
}
if (state.month < MONTH_MIN || state.month > MONTH_MAX) state.month = MONTH_DEFAULT;

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const camera = {
      center: map.getCenter().toArray(),
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
    storage.set('atlas-state', { ...state, camera });
  }, 500);
}

// ---------------------------------------------------------------- tempo

function toIdx(ym) {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}
function toYm(i) {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

function expandRanges(ranges, step) {
  const out = [];
  for (const [a, b] of ranges) for (let i = toIdx(a); i <= toIdx(b); i += step) out.push(toYm(i));
  return out;
}

// Mês disponível mais próximo do pedido.
function nearestMonth(ranges, ym) {
  const t = toIdx(ym);
  let best = null;
  let bestD = Infinity;
  for (const [a, b] of ranges) {
    const c = Math.min(Math.max(t, toIdx(a)), toIdx(b));
    if (Math.abs(c - t) < bestD) [best, bestD] = [c, Math.abs(c - t)];
  }
  return toYm(best);
}

const monthLabel = (ym) =>
  new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', {
    month: 'short',
    year: 'numeric',
  });

// Camada GIBS + data efetivas de uma camada temática no estado atual.
function resolveGibs(o) {
  const variant = state.overlays[o.id].variant;
  const id = o.gibs(variant);
  const info = catalog[id];
  let time = info.defaultTime;
  let label = variant;
  if (o.time === 'monthly') {
    const ym = nearestMonth(info.ranges, state.month);
    time = `${ym}-01`;
    label = monthLabel(ym);
  } else if (o.time === 'annual') {
    time = `${variant}-01-01`;
  }
  return { id, info, time, label, url: gibsUrl(info, id, time) };
}

// ---------------------------------------------------------------- estilo

const OPACITY_PROP = { raster: 'raster-opacity', 'color-relief': 'color-relief-opacity', hillshade: 'hillshade-exaggeration' };
const layerType = (o) => o.kind ?? 'raster';
const sourceUrls = new Map(); // id da camada temática -> URL de tiles em uso
const vis = (on) => (on ? 'visible' : 'none');

function buildStyle() {
  const sources = {
    dem: { type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: OVERLAYS[0].attribution },
    'terrain-dem': { type: 'raster-dem', tiles: [TERRARIUM], encoding: 'terrarium', tileSize: 256, maxzoom: 13 },
    labels: { type: 'raster', tiles: LABELS.tiles, tileSize: 256, maxzoom: LABELS.maxzoom, attribution: LABELS.attribution },
  };
  const layers = [{ id: 'space', type: 'background', paint: { 'background-color': '#04060d' } }];

  for (const b of BASEMAPS) {
    const info = b.gibs && catalog[b.gibs];
    sources[`base-${b.id}`] = {
      type: 'raster',
      tiles: info ? [gibsUrl(info, b.gibs, info.defaultTime)] : b.tiles,
      tileSize: 256,
      maxzoom: info ? info.maxzoom : b.maxzoom,
      attribution: b.attribution,
    };
    layers.push({
      id: `base-${b.id}`,
      type: 'raster',
      source: `base-${b.id}`,
      layout: { visibility: vis(state.basemap === b.id) },
    });
  }

  for (const o of OVERLAYS) {
    const s = state.overlays[o.id];
    const type = layerType(o);
    const layer = { id: o.id, type, layout: { visibility: vis(s.visible) }, paint: { [OPACITY_PROP[type]]: s.opacity } };
    if (type === 'color-relief') {
      layer.source = 'dem';
      layer.paint['color-relief-color'] = ['interpolate', ['linear'], ['elevation'], ...RELIEF_STOPS.flat()];
    } else if (type === 'hillshade') {
      layer.source = 'dem';
      layer.paint['hillshade-shadow-color'] = '#1b1f2e';
      layer.paint['hillshade-highlight-color'] = '#ffffff';
    } else {
      const g = resolveGibs(o);
      sourceUrls.set(o.id, g.url);
      sources[`src-${o.id}`] = {
        type: 'raster',
        tiles: [g.url],
        tileSize: 256,
        maxzoom: g.info.maxzoom,
        attribution: `${o.source ? `${esc(o.source)} · ` : ''}<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a>`,
      };
      layer.source = `src-${o.id}`;
      layer.paint['raster-resampling'] = o.resampling ?? 'nearest';
      layer.paint['raster-fade-duration'] = 150;
    }
    layers.push(layer);
  }

  layers.push({ id: 'labels', type: 'raster', source: 'labels', layout: { visibility: vis(state.labels) } });

  return {
    version: 8,
    projection: { type: state.projection },
    sky: {
      'sky-color': '#0d1b3a',
      'horizon-color': '#6f9fd8',
      'fog-color': '#a9c6e8',
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.3,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
    },
    sources,
    layers,
  };
}

// ---------------------------------------------------------------- mapa

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  ...state.camera,
  maxPitch: 85,
  // Cada tile raster vira uma textura na GPU; limitar o cache por fonte
  // mantém a memória estável em sessões longas.
  maxTileCacheSize: 150,
  maxTileCacheZoomLevels: 3,
  attributionControl: { compact: true },
  dragRotate: true,
  touchPitch: true,
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

map.on('moveend', persist);
map.on('load', () => {
  if (state.terrain) applyTerrain();
});

const loading = $('#status-loading');
map.on('dataloading', () => (loading.hidden = false));
map.on('idle', () => (loading.hidden = true));

function applyTerrain() {
  map.setTerrain(state.terrain ? { source: 'terrain-dem', exaggeration: state.exaggeration } : null);
}

// ---------------------------------------------------------------- painel: visualização

function setSeg(container, attr, value) {
  for (const btn of container.querySelectorAll(`[${attr}]`)) {
    btn.setAttribute('aria-checked', String(btn.getAttribute(attr) === value));
  }
}

const projSeg = $('.seg[aria-label="Projeção"]');
setSeg(projSeg, 'data-projection', state.projection);
projSeg.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-projection]');
  if (!btn) return;
  state.projection = btn.dataset.projection;
  map.setProjection({ type: state.projection });
  setSeg(projSeg, 'data-projection', state.projection);
  persist();
});

const terrainToggle = $('#terrain-toggle');
const exaggeration = $('#exaggeration');
const exaggerationOut = $('#exaggeration-out');
terrainToggle.checked = state.terrain;
exaggeration.value = state.exaggeration;
exaggerationOut.value = `${fmt(state.exaggeration, 1)}×`;
$('#exaggeration-row').classList.toggle('disabled', !state.terrain);

terrainToggle.addEventListener('change', () => {
  state.terrain = terrainToggle.checked;
  $('#exaggeration-row').classList.toggle('disabled', !state.terrain);
  applyTerrain();
  if (state.terrain && map.getPitch() < 30) map.easeTo({ pitch: 60, duration: 1200 });
  persist();
});
exaggeration.addEventListener('input', () => {
  state.exaggeration = Number(exaggeration.value);
  exaggerationOut.value = `${fmt(state.exaggeration, 1)}×`;
  if (state.terrain) applyTerrain();
  persist();
});

const labelsToggle = $('#labels-toggle');
labelsToggle.checked = state.labels;
labelsToggle.addEventListener('change', () => {
  state.labels = labelsToggle.checked;
  map.setLayoutProperty('labels', 'visibility', vis(state.labels));
  persist();
});

const basemapSeg = $('#basemaps');
basemapSeg.innerHTML = BASEMAPS.map((b) => `<button data-basemap="${b.id}" role="radio">${esc(b.name)}</button>`).join('');
setSeg(basemapSeg, 'data-basemap', state.basemap);
basemapSeg.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-basemap]');
  if (!btn) return;
  state.basemap = btn.dataset.basemap;
  for (const b of BASEMAPS) map.setLayoutProperty(`base-${b.id}`, 'visibility', vis(state.basemap === b.id));
  setSeg(basemapSeg, 'data-basemap', state.basemap);
  persist();
});

// ---------------------------------------------------------------- painel: camadas temáticas

const overlaysEl = $('#overlays');
const groups = [...new Set(OVERLAYS.map((o) => o.group))];
overlaysEl.innerHTML = groups
  .map(
    (g) => `<section class="group"><h2>${esc(g)}</h2>${OVERLAYS.filter((o) => o.group === g)
      .map(
        (o) => `<div class="overlay" data-overlay="${o.id}">
          <label class="row switch"><input type="checkbox" data-role="visible"><span>${esc(o.name)}</span></label>
          <div class="overlay-detail">
            <div class="row slider"><span>Opacidade</span><input type="range" data-role="opacity" min="0" max="1" step="0.05"></div>
            ${o.variants && o.variants.length > 1 ? `<div class="row"><span>Ano</span><select data-role="variant">${[...o.variants].reverse().map((v) => `<option>${v}</option>`).join('')}</select></div>` : ''}
            <p class="note" data-role="note" hidden></p>
            <div data-role="legend"></div>
          </div>
        </div>`,
      )
      .join('')}</section>`,
  )
  .join('');

function renderOverlay(o) {
  const el = overlaysEl.querySelector(`[data-overlay="${o.id}"]`);
  const s = state.overlays[o.id];
  el.classList.toggle('on', s.visible);
  el.querySelector('[data-role="visible"]').checked = s.visible;
  el.querySelector('[data-role="opacity"]').value = s.opacity;
  const variant = el.querySelector('[data-role="variant"]');
  if (variant) variant.value = s.variant;

  const legend = el.querySelector('[data-role="legend"]');
  const note = el.querySelector('[data-role="note"]');
  if (o.kind === 'color-relief') legend.innerHTML = reliefLegend();
  if (o.gibs) {
    const g = resolveGibs(o);
    if (g.info.colormap && !legend.innerHTML) legend.innerHTML = colormapLegend(o, g.info.colormap);
    const shown = o.time === 'monthly' ? g.time.slice(0, 7) : null;
    note.hidden = !shown || shown === state.month;
    if (shown) note.textContent = `Sem dados para o mês escolhido; exibindo ${monthLabel(shown)}.`;
  }
}

overlaysEl.addEventListener('input', (ev) => {
  const el = ev.target.closest('[data-overlay]');
  if (!el) return;
  const o = OVERLAYS.find((x) => x.id === el.dataset.overlay);
  const s = state.overlays[o.id];
  const role = ev.target.dataset.role;
  if (role === 'visible') {
    s.visible = ev.target.checked;
    map.setLayoutProperty(o.id, 'visibility', vis(s.visible));
  } else if (role === 'opacity') {
    s.opacity = Number(ev.target.value);
    map.setPaintProperty(o.id, OPACITY_PROP[layerType(o)], s.opacity);
  } else if (role === 'variant') {
    s.variant = ev.target.value;
    updateGibsSource(o);
  }
  renderOverlay(o);
  persist();
});

function updateGibsSource(o) {
  const g = resolveGibs(o);
  if (sourceUrls.get(o.id) === g.url) return;
  sourceUrls.set(o.id, g.url);
  map.getSource(`src-${o.id}`).setTiles([g.url]);
}

OVERLAYS.forEach(renderOverlay);

// ---------------------------------------------------------------- painel: mês

const monthInput = $('#month');
monthInput.min = MONTH_MIN;
monthInput.max = MONTH_MAX;
monthInput.value = state.month;

function setMonth(ym) {
  const clamped = toYm(Math.min(Math.max(toIdx(ym), toIdx(MONTH_MIN)), toIdx(MONTH_MAX)));
  state.month = clamped;
  monthInput.value = clamped;
  for (const o of OVERLAYS.filter((x) => x.time === 'monthly')) {
    updateGibsSource(o);
    renderOverlay(o);
  }
  persist();
}

monthInput.addEventListener('change', () => monthInput.value && setMonth(monthInput.value));
$('#month-prev').addEventListener('click', () => setMonth(toYm(toIdx(state.month) - 1)));
$('#month-next').addEventListener('click', () => setMonth(toYm(toIdx(state.month) + 1)));

let playTimer = null;
const playBtn = $('#month-play');
playBtn.addEventListener('click', () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  } else {
    // Ao chegar no fim volta 12 meses: anima o último ano disponível.
    playTimer = setInterval(() => {
      const next = toIdx(state.month) + 1;
      setMonth(next > toIdx(MONTH_MAX) ? toYm(toIdx(MONTH_MAX) - 11) : toYm(next));
    }, 1300);
  }
  playBtn.classList.toggle('playing', !!playTimer);
});

$('#panel-toggle').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('panel-collapsed');
  $('#panel-toggle').setAttribute('aria-expanded', String(!collapsed));
});

// ---------------------------------------------------------------- barra de status

const coordsEl = $('#status-coords');
const elevEl = $('#status-elev');
const fmtCoord = (lng, lat) =>
  `${fmt(Math.abs(lat), 4)}° ${lat >= 0 ? 'N' : 'S'}  ${fmt(Math.abs(lng), 4)}° ${lng >= 0 ? 'L' : 'O'}`;
const fmtElev = (m) => (m >= 0 ? `${fmt(Math.round(m))} m` : `${fmt(Math.round(-m))} m de profundidade`);

let hoverSeq = 0;
let hoverPending = false;
let lastHover = null;
map.on('mousemove', (ev) => {
  lastHover = ev.lngLat;
  coordsEl.textContent = fmtCoord(ev.lngLat.lng, ev.lngLat.lat);
  if (hoverPending) return;
  hoverPending = true;
  setTimeout(async () => {
    hoverPending = false;
    const seq = ++hoverSeq;
    const { lng, lat } = lastHover;
    const z = Math.max(3, Math.min(12, Math.round(map.getZoom()) + 1));
    const elev = await elevationAt(lng, lat, z);
    if (seq === hoverSeq) elevEl.textContent = elev == null ? '' : fmtElev(elev);
  }, 120);
});
map.on('mouseout', () => {
  hoverSeq++;
  coordsEl.textContent = '—';
  elevEl.textContent = '';
});

// ---------------------------------------------------------------- informações do ponto

const info = $('#info');
const infoBody = $('#info-body');
const infoTitle = $('#info-title');
const marker = new maplibregl.Marker({ color: '#ffb547' });
let infoAbort = null;

map.on('click', (ev) => showPoint(ev.lngLat.lng, ev.lngLat.lat));

$('#info-close').addEventListener('click', closeInfo);

function closeInfo() {
  info.hidden = true;
  marker.remove();
  infoAbort?.abort();
}

async function showPoint(lng, lat) {
  infoAbort?.abort();
  const abort = (infoAbort = new AbortController());
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  marker.setLngLat([lng, lat]).addTo(map);
  info.hidden = false;
  infoTitle.textContent = fmtCoord(lng, lat);

  const probes = OVERLAYS.filter((o) => o.gibs && catalog[o.gibs(state.overlays[o.id].variant)].colormap);
  infoBody.innerHTML = `
    <p class="coords">${fmt(lat, 5)}, ${fmt(lng, 5)}</p>
    <dl class="facts">
      <dt>Elevação</dt><dd data-fact="elev">…</dd>
      ${probes.map((o) => `<dt>${esc(o.name.replace(/ \(.*\)$/, ''))} <small>${esc(resolveGibs(o).label ?? '')}</small></dt><dd data-fact="${o.id}">…</dd>`).join('')}
    </dl>
    <section class="climate">
      <h3>Clima <small>normais 1991–2020</small></h3>
      <div data-fact="climate"><p class="muted">Calculando…</p></div>
    </section>`;

  const fill = (key, html) => {
    if (abort.signal.aborted) return;
    const el = infoBody.querySelector(`[data-fact="${key}"]`);
    if (el) el.innerHTML = html;
  };

  reverseGeocode(lng, lat, abort.signal).then((name) => {
    if (name && !abort.signal.aborted) infoTitle.textContent = name;
  });

  elevationAt(lng, lat, 12).then((m) => fill('elev', m == null ? '—' : fmtElev(m)));

  for (const o of probes) {
    const g = resolveGibs(o);
    colormapEntryAt(g.url, g.info.maxzoom, g.info.colormap, lng, lat).then((e) =>
      fill(o.id, e ? `${esc(o.format(e))}${o.unit ? ` <small>${esc(o.unit)}</small>` : ''}` : '<span class="muted">sem dado</span>'),
    );
  }

  try {
    const n = await fetchNormals(lat, lng, abort.signal);
    const code = koppen(n, lat);
    const annualT = n.tmean.reduce((a, b) => a + b) / 12;
    const annualP = n.precip.reduce((a, b) => a + b);
    fill(
      'climate',
      `<p class="koppen"><b>${code}</b> ${esc(koppenName(code))}</p>
       <dl class="facts compact">
         <dt>Temperatura média anual</dt><dd>${fmt(annualT, 1)} °C</dd>
         <dt>Mês mais quente / mais frio</dt><dd>${fmt(Math.max(...n.tmean), 1)} / ${fmt(Math.min(...n.tmean), 1)} °C</dd>
         <dt>Precipitação anual</dt><dd>${fmt(Math.round(annualP))} mm</dd>
       </dl>
       ${climographSvg(n)}
       <p class="legend-inline"><i class="sw-bar"></i>precipitação (mm) <i class="sw-line"></i>temp. média <i class="sw-band"></i>mín–máx (°C)</p>
       <p class="source">Reanálise ERA5 via <a href="https://open-meteo.com" target="_blank">Open-Meteo</a>. Köppen-Geiger calculado com os critérios de Peel et al. (2007).</p>`,
    );
  } catch (err) {
    if (!abort.signal.aborted) fill('climate', `<p class="muted">Não foi possível obter dados climáticos (${esc(err.message)}).</p>`);
  }
}

// ---------------------------------------------------------------- busca (Nominatim)

const NOMINATIM = 'https://nominatim.openstreetmap.org';

async function reverseGeocode(lng, lat, signal) {
  try {
    const res = await fetch(
      `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=pt-BR`,
      { signal },
    );
    const data = await res.json();
    if (!data.address) return null;
    const a = data.address;
    const place = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? data.name;
    return [place, a.country].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || null;
  } catch {
    return null;
  }
}

const searchForm = $('#search');
const searchInput = $('#search-input');
const searchResults = $('#search-results');
let searchHits = [];

searchForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  // A política do Nominatim não permite autocompletar: busca só ao pressionar Enter.
  searchResults.hidden = false;
  searchResults.innerHTML = '<li class="muted">Buscando…</li>';
  try {
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
    searchHits = await res.json();
    searchResults.innerHTML = searchHits.length
      ? searchHits.map((h, i) => `<li><button type="button" data-hit="${i}">${esc(h.display_name)}</button></li>`).join('')
      : '<li class="muted">Nada encontrado.</li>';
  } catch {
    searchResults.innerHTML = '<li class="muted">Falha na busca (sem conexão?).</li>';
  }
});

searchResults.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-hit]');
  if (!btn) return;
  const h = searchHits[Number(btn.dataset.hit)];
  const [s, n, w, e] = h.boundingbox.map(Number);
  searchResults.hidden = true;
  searchInput.blur();
  map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: 80, maxZoom: 14, duration: 2500 },
  );
  map.once('moveend', () => showPoint(Number(h.lon), Number(h.lat)));
});

document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (ev.key === 'Escape') {
    if (!searchResults.hidden) searchResults.hidden = true;
    else closeInfo();
  }
});
document.addEventListener('click', (ev) => {
  if (!searchForm.contains(ev.target)) searchResults.hidden = true;
});
