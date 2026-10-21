// Gera resources/data/gibs-catalog.json a partir do GetCapabilities e dos
// colormaps do NASA GIBS. Rode novamente (npm run catalog) para atualizar
// as datas disponíveis ou depois de adicionar camadas em LAYERS.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'resources', 'data', 'gibs-catalog.json');
const CAPS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';

// Camadas GIBS usadas pelo app (ids definidos em resources/js/layers.js).
const LAYERS = [
  'BlueMarble_NextGeneration',
  'GPW_Population_Density_2000',
  'GPW_Population_Density_2005',
  'GPW_Population_Density_2010',
  'GPW_Population_Density_2015',
  'GPW_Population_Density_2020',
  'MERRA2_2m_Air_Temperature_Monthly',
  'MERRA2_Precipitation_Bias_Corrected_Monthly',
  'MODIS_Terra_L3_NDVI_Monthly',
  'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
  'VIIRS_Black_Marble',
];

const text = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

const attr = (tag, name) => {
  const v = tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  return v === undefined ? undefined : decode(v);
};

function layerBlock(caps, id) {
  const i = caps.indexOf(`<ows:Identifier>${id}</ows:Identifier>`);
  if (i < 0) throw new Error(`Camada não encontrada no GetCapabilities: ${id}`);
  return caps.slice(caps.lastIndexOf('<Layer>', i), caps.indexOf('</Layer>', i));
}

// "1980-01-01/2023-11-01/P1M" -> ["1980-01-01", "2023-11-01", "P1M"]
function parseTimes(block) {
  return [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1].split('/'));
}

const monthIndex = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
const monthStr = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

// Normaliza períodos mensais/anuais para intervalos contínuos [início, fim] em "AAAA-MM".
function compactPeriods(times, period) {
  const step = period === 'P1Y' ? 12 : 1;
  const set = new Set();
  for (const [start, end, p] of times) {
    if (p !== period || start.slice(8, 10) !== '01') continue;
    for (let m = monthIndex(start); m <= monthIndex(end ?? start); m += step) set.add(m);
  }
  const sorted = [...set].sort((a, b) => a - b);
  const ranges = [];
  for (const m of sorted) {
    const last = ranges.at(-1);
    if (last && m === last[1] + step) last[1] = m;
    else ranges.push([m, m]);
  }
  return ranges.map(([a, b]) => [monthStr(a), monthStr(b)]);
}

function parseNumber(s) {
  if (s === '-INF') return -Infinity;
  if (s === '+INF' || s === 'INF') return Infinity;
  return Number(s);
}

function parseColormap(xml) {
  // Pode haver vários <ColorMap>; o de dados é o que não é só "No Data".
  const maps = [...xml.matchAll(/<ColorMap[\s>][\s\S]*?<\/ColorMap>/g)].map((m) => m[0]);
  const entries = [];
  let units = null;
  let legendType = 'continuous';
  for (const map of maps) {
    units ??= attr(map.slice(0, map.indexOf('>')), 'units') ?? null;
    const legend = map.match(/<Legend type="([^"]+)"/)?.[1];
    const tooltips = new Map(
      [...map.matchAll(/<LegendEntry [^>]*>/g)].map((m) => [attr(m[0], 'id'), attr(m[0], 'tooltip')]),
    );
    for (const m of map.matchAll(/<ColorMapEntry [^>]*>/g)) {
      const tag = m[0];
      if (attr(tag, 'transparent') === 'true' || attr(tag, 'nodata') === 'true') continue;
      const rgb = attr(tag, 'rgb').split(',').map(Number);
      const value = attr(tag, 'value');
      const label = tooltips.get(attr(tag, 'ref')) ?? attr(tag, 'label') ?? null;
      let lo = null;
      let hi = null;
      if (value) {
        const [a, b] = value.replace(/[[\]()]/g, '').split(',');
        lo = parseNumber(a);
        hi = b === undefined ? lo : parseNumber(b);
      }
      entries.push({ rgb, lo, hi, label });
      if (legend) legendType = legend;
    }
  }
  return { units, legendType, entries };
}

const caps = await text(CAPS);
const catalog = { generated: new Date().toISOString(), layers: {} };

for (const id of LAYERS) {
  const block = layerBlock(caps, id);
  const matrixSet = block.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/)[1];
  const format = block.match(/<Format>image\/([^<]+)<\/Format>/)[1];
  const defaultTime = block.match(/<Default>([^<]+)<\/Default>/)?.[1] ?? 'default';
  const times = parseTimes(block);
  const periods = new Set(times.map((t) => t[2]));
  const period = periods.has('P1M') ? 'P1M' : periods.has('P1Y') ? 'P1Y' : null;
  // A ordem dos atributos muda entre respostas do servidor; procure a tag inteira.
  const colormapTag = [...block.matchAll(/<ows:Metadata [^>]*>/g)]
    .map((m) => m[0])
    .find((t) => t.includes('colormap/1.3'));
  const colormapUrl = colormapTag?.match(/xlink:href='([^']+)'/)?.[1];

  const layer = {
    title: block.match(/<ows:Title xml:lang='en'>([^<]+)</)?.[1],
    matrixSet,
    maxzoom: Number(matrixSet.match(/Level(\d+)/)[1]),
    ext: format === 'jpeg' ? 'jpg' : format,
    defaultTime,
    period,
    ranges: period ? compactPeriods(times, period) : null,
    colormap: colormapUrl ? parseColormap(await text(colormapUrl)) : null,
  };
  catalog.layers[id] = layer;
  console.log(
    `${id}: z${layer.maxzoom} .${layer.ext} ${period ?? 'estática'}`,
    layer.ranges ? `${layer.ranges[0][0]}..${layer.ranges.at(-1)[1]} (${layer.ranges.length} intervalos)` : '',
    layer.colormap ? `${layer.colormap.entries.length} cores, ${layer.colormap.units ?? '-'}` : '',
  );
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(catalog));
console.log(`OK -> ${OUT}`);
