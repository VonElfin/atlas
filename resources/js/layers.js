// Registro de mapas base e camadas temáticas.
// Para adicionar uma camada nova: inclua uma entrada em OVERLAYS (e, se for do
// NASA GIBS, o id em scripts/build-catalog.mjs e rode `npm run catalog`).

// Os servidores de tiles abaixo falam HTTP/1.1 (6 conexões por host no
// navegador); listar dois hosts do mesmo serviço dobra o paralelismo.
export const TERRARIUM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png',
];
export const TERRARIUM = TERRARIUM_TILES[0];

// Mapterhorn: elevação (só terra, sem batimetria) via CDN Cloudflare. Medido daqui:
// ~75 ms por tile, contra 450–630 ms do Terrarium no S3 (EUA, sem CDN). Tiles de 512 px,
// mesma codificação terrarium. Usado no sombreamento, no terreno 3D e na elevação em terra;
// o Terrarium fica para a camada de batimetria e para a profundidade dos oceanos.
export const MAPTERHORN = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
export const MAPTERHORN_MAXZOOM = 12; // cobertura global até z12 (mais só em algumas regiões)
export const MAPTERHORN_ATTR =
  'Elevação: <a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>';
const TERRARIUM_ATTR =
  'Elevação: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Mapzen/AWS Terrain Tiles</a>';
const GIBS_ATTR = '<a href="https://earthdata.nasa.gov/gibs" target="_blank">NASA GIBS</a>';

const esri = (service) =>
  ['server', 'services'].map((h) => `https://${h}.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`);

export const BASEMAPS = [
  {
    id: 'satellite',
    name: 'Satélite',
    // blankTile=false: onde não há imagem o Esri responde 404 (em vez do tile
    // cinza "Map data not yet available") e usamos o ancestral ampliado.
    tiles: esri('World_Imagery').map((u) => `${u}?blankTile=false`),
    fallback: 6,
    maxzoom: 19,
    attribution: 'Imagens © <a href="https://www.esri.com" target="_blank">Esri</a>, Maxar, Earthstar Geographics',
  },
  { id: 'bluemarble', name: 'Blue Marble', gibs: 'BlueMarble_NextGeneration', attribution: GIBS_ATTR },
  {
    id: 'dark',
    name: 'Escuro',
    // A CARTO passou a exigir chave de API (tiles com marca d'água); o Esri é aberto.
    tiles: esri('Canvas/World_Dark_Gray_Base'),
    maxzoom: 16,
    attribution: 'Mapa escuro © <a href="https://www.esri.com" target="_blank">Esri</a>, HERE, Garmin, © OpenStreetMap',
  },
];

export const LABELS = {
  tiles: esri('Reference/World_Boundaries_and_Places'),
  maxzoom: 19,
  attribution: 'Rótulos © Esri',
};

// Rampa hipsométrica (metros) usada no mapa de relevo e na legenda.
export const RELIEF_STOPS = [
  [-8000, '#0b1d4d'],
  [-4000, '#1d4f91'],
  [-1000, '#3f8ac6'],
  [-50, '#9fd0ef'],
  [0, '#5a9b5c'],
  [200, '#8fbf6a'],
  [500, '#d4d68b'],
  [1000, '#d9b77a'],
  [2000, '#b07d4f'],
  [3000, '#8b6a5a'],
  [4500, '#d9d4d0'],
  [6000, '#ffffff'],
];

const LANDCOVER_PT = {
  'Evergreen Needleleaf Forests': 'Floresta perene de coníferas',
  'Evergreen Broadleaf Forests': 'Floresta perene latifoliada',
  'Deciduous Needleleaf Forests': 'Floresta decídua de coníferas',
  'Deciduous Broadleaf Forests': 'Floresta decídua latifoliada',
  'Mixed Forests': 'Floresta mista',
  'Closed Shrublands': 'Arbustos densos',
  'Open Shrublands': 'Arbustos abertos',
  'Woody Savannas': 'Savana arborizada',
  Savannas: 'Savana',
  Grasslands: 'Campos',
  'Permanent Wetlands': 'Áreas úmidas permanentes',
  Croplands: 'Agricultura',
  'Urban and Built-up Lands': 'Área urbana',
  'Cropland/Natural Vegetation Mosaics': 'Mosaico agricultura/vegetação',
  'Permanent Snow and Ice': 'Neve e gelo permanentes',
  Barren: 'Solo exposto / deserto',
  'Water Bodies': 'Corpos d’água',
  Unclassified: 'Não classificado',
};

const fmt = (v, digits = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Cada camada GIBS informa como converter o valor do colormap para exibição.
//   gibs(variant) -> id da camada no GIBS
//   time: 'monthly' usa o seletor global de mês; variants: lista própria (ex.: anos)
//   format(entry) -> texto do valor para uma entrada do colormap
export const OVERLAYS = [
  {
    id: 'relief',
    short: 'Altitude',
    group: 'Relevo',
    name: 'Altitude e batimetria',
    kind: 'color-relief',
    opacity: 0.7,
    attribution: TERRARIUM_ATTR,
  },
  {
    id: 'hillshade',
    group: 'Relevo',
    name: 'Sombreamento do relevo',
    kind: 'hillshade',
    opacity: 0.6,
    visible: true,
    attribution: MAPTERHORN_ATTR,
  },
  {
    id: 'population',
    short: 'Densidade',
    group: 'Sociedade',
    name: 'Densidade populacional',
    gibs: (year) => `GPW_Population_Density_${year}`,
    variants: ['2000', '2005', '2010', '2015', '2020'],
    variant: '2020',
    opacity: 0.75,
    unit: 'hab/km²',
    format: (e) => {
      const d = (v) => fmt(v, v < 10 ? 1 : 0);
      if (e.hi >= 1e6) return `≥ ${d(e.lo)}`;
      return e.lo ? `${d(e.lo)}–${d(e.hi)}` : `< ${d(e.hi)}`;
    },
    tick: (e) => (e.hi >= 1e6 ? `${fmt(e.lo)}+` : fmt(e.lo ?? 0)),
    source: 'NASA SEDAC GPWv4',
  },
  {
    id: 'nightlights',
    group: 'Sociedade',
    name: 'Luzes noturnas',
    gibs: () => 'VIIRS_Black_Marble',
    variants: ['2012', '2016'],
    variant: '2016',
    time: 'annual',
    opacity: 0.9,
    source: 'NASA Black Marble (VIIRS)',
  },
  {
    id: 'temperature',
    short: 'Temperatura',
    group: 'Clima',
    name: 'Temperatura do ar (média mensal)',
    gibs: () => 'MERRA2_2m_Air_Temperature_Monthly',
    time: 'monthly',
    opacity: 0.65,
    resampling: 'linear',
    unit: '°C',
    format: (e) => fmt(mid(e) - 273.15, 1),
    tick: (e) => fmt(edge(e) - 273.15),
    source: 'NASA MERRA-2',
  },
  {
    id: 'precipitation',
    short: 'Precipitação',
    group: 'Clima',
    name: 'Precipitação (média mensal)',
    gibs: () => 'MERRA2_Precipitation_Bias_Corrected_Monthly',
    time: 'monthly',
    opacity: 0.7,
    resampling: 'linear',
    unit: 'mm/dia',
    format: (e) => fmt(mid(e) * 86400, 1),
    tick: (e) => fmt(edge(e) * 86400, 1),
    source: 'NASA MERRA-2',
  },
  {
    id: 'ndvi',
    short: 'NDVI',
    group: 'Natureza',
    name: 'Vegetação (NDVI)',
    gibs: () => 'MODIS_Terra_L3_NDVI_Monthly',
    time: 'monthly',
    opacity: 0.75,
    format: (e) => fmt(mid(e), 2),
    tick: (e) => fmt(edge(e), 1),
    source: 'NASA MODIS Terra',
  },
  {
    id: 'landcover',
    short: 'Cobertura',
    group: 'Natureza',
    name: 'Cobertura do solo',
    gibs: () => 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual',
    time: 'annual',
    opacity: 0.7,
    format: (e) => LANDCOVER_PT[e.label] ?? e.label,
    source: 'NASA MODIS (IGBP)',
  },
];

// Valor central de uma entrada [lo, hi) do colormap; lo/hi nulos são ±infinito.
function mid(e) {
  if (e.lo == null) return e.hi;
  if (e.hi == null) return e.lo;
  return (e.lo + e.hi) / 2;
}
const edge = (e) => e.lo ?? e.hi;

export function gibsUrl(info, id, time) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${time}/${info.matrixSet}/{z}/{y}/{x}.${info.ext}`;
}

// O GIBS fala HTTP/1.1 (6 conexões por host); gibs-a/b/c são espelhos do mesmo serviço.
export const gibsShards = (url) =>
  ['gibs', 'gibs-a', 'gibs-b', 'gibs-c'].map((h) => url.replace('//gibs.earthdata', `//${h}.earthdata`));
