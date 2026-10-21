// Normais climatológicas 1991–2020 (reanálise ERA5 via Open-Meteo),
// classificação de Köppen-Geiger e climograma em SVG.

const API = 'https://archive-api.open-meteo.com/v1/archive';
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Médias mensais: { tmean[12], tmax[12], tmin[12], precip[12] (mm/mês) }. */
export async function fetchNormals(lat, lng, signal) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    start_date: '1991-01-01',
    end_date: '2020-12-31',
    daily: 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'UTC',
  });
  const res = await fetch(`${API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const { daily } = await res.json();

  const sum = { tmean: zeros(), tmax: zeros(), tmin: zeros(), precip: zeros() };
  const count = zeros();
  daily.time.forEach((day, i) => {
    const m = Number(day.slice(5, 7)) - 1;
    if (daily.temperature_2m_mean[i] == null) return;
    sum.tmean[m] += daily.temperature_2m_mean[i];
    sum.tmax[m] += daily.temperature_2m_max[i];
    sum.tmin[m] += daily.temperature_2m_min[i];
    sum.precip[m] += daily.precipitation_sum[i] ?? 0;
    count[m]++;
  });
  if (count.some((c) => c === 0)) throw new Error('Série incompleta');
  return {
    tmean: sum.tmean.map((v, m) => v / count[m]),
    tmax: sum.tmax.map((v, m) => v / count[m]),
    tmin: sum.tmin.map((v, m) => v / count[m]),
    // Média diária × dias do mês: robusto a dias faltantes na série.
    precip: sum.precip.map((v, m) => (v / count[m]) * DAYS[m]),
  };
}

function zeros() {
  return Array(12).fill(0);
}

/** Código Köppen-Geiger a partir das médias mensais (critérios de Peel et al., 2007). */
export function koppen({ tmean: T, precip: P }, lat) {
  const MAT = T.reduce((a, b) => a + b) / 12;
  const MAP = P.reduce((a, b) => a + b);
  const Thot = Math.max(...T);
  const Tcold = Math.min(...T);
  const Tmon10 = T.filter((t) => t > 10).length;
  const Pdry = Math.min(...P);

  // Semestre de verão: abr–set no hemisfério norte, out–mar no sul.
  const summer = (m) => (lat >= 0 ? m >= 3 && m <= 8 : m <= 2 || m >= 9);
  const Ps = P.filter((_, m) => summer(m));
  const Pw = P.filter((_, m) => !summer(m));
  const Psdry = Math.min(...Ps);
  const Pswet = Math.max(...Ps);
  const Pwdry = Math.min(...Pw);
  const Pwwet = Math.max(...Pw);
  const Pwinter = Pw.reduce((a, b) => a + b);
  const Psummer = Ps.reduce((a, b) => a + b);

  let Pth = 2 * MAT + 14;
  if (Pwinter >= 0.7 * MAP) Pth = 2 * MAT;
  else if (Psummer >= 0.7 * MAP) Pth = 2 * MAT + 28;

  if (Thot < 10) return Thot > 0 ? 'ET' : 'EF';
  if (MAP < 10 * Pth) return (MAP < 5 * Pth ? 'BW' : 'BS') + (MAT >= 18 ? 'h' : 'k');
  if (Tcold >= 18) {
    if (Pdry >= 60) return 'Af';
    if (Pdry >= 100 - MAP / 25) return 'Am';
    return Psdry < Pwdry ? 'As' : 'Aw';
  }
  let second = 'f';
  if (Psdry < 40 && Psdry < Pwwet / 3) second = 's';
  else if (Pwdry < Pswet / 10) second = 'w';
  let third = 'c';
  if (Thot >= 22) third = 'a';
  else if (Tmon10 >= 4) third = 'b';
  else if (Tcold < -38) third = 'd';
  return (Tcold > 0 ? 'C' : 'D') + second + third;
}

const KOPPEN_NAMES = {
  Af: 'Equatorial úmido',
  Am: 'Tropical de monção',
  Aw: 'Tropical com inverno seco',
  As: 'Tropical com verão seco',
  BWh: 'Desértico quente',
  BWk: 'Desértico frio',
  BSh: 'Semiárido quente',
  BSk: 'Semiárido frio',
  Csa: 'Mediterrâneo de verão quente',
  Csb: 'Mediterrâneo de verão ameno',
  Csc: 'Mediterrâneo de verão frio',
  Cwa: 'Subtropical com inverno seco',
  Cwb: 'Tropical de altitude',
  Cwc: 'Subpolar oceânico com inverno seco',
  Cfa: 'Subtropical úmido',
  Cfb: 'Oceânico temperado',
  Cfc: 'Subpolar oceânico',
  Dsa: 'Continental de verão seco e quente',
  Dsb: 'Continental de verão seco e ameno',
  Dsc: 'Subártico de verão seco',
  Dsd: 'Subártico de verão seco e inverno extremo',
  Dwa: 'Continental de monção quente',
  Dwb: 'Continental de monção ameno',
  Dwc: 'Subártico de monção',
  Dwd: 'Subártico de monção com inverno extremo',
  Dfa: 'Continental úmido de verão quente',
  Dfb: 'Continental úmido de verão ameno',
  Dfc: 'Subártico',
  Dfd: 'Subártico com inverno extremo',
  ET: 'Tundra',
  EF: 'Gelo perpétuo',
};

export const koppenName = (code) => KOPPEN_NAMES[code] ?? code;

/** Climograma: barras de precipitação (eixo direito) e curvas de temperatura (eixo esquerdo). */
export function climographSvg({ tmean, tmax, tmin, precip }) {
  const W = 320;
  const H = 180;
  const pad = { l: 30, r: 34, t: 10, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const tLo = Math.floor(Math.min(0, ...tmin) / 10) * 10;
  const tHi = Math.ceil(Math.max(10, ...tmax) / 10) * 10;
  const pHi = Math.max(50, Math.ceil(Math.max(...precip) / 50) * 50);
  const bw = iw / 12;
  const xc = (m) => pad.l + bw * (m + 0.5);
  const yt = (t) => pad.t + ih * (1 - (t - tLo) / (tHi - tLo));
  const yp = (p) => pad.t + ih * (1 - p / pHi);
  const line = (vals) => vals.map((v, m) => `${m ? 'L' : 'M'}${xc(m).toFixed(1)},${yt(v).toFixed(1)}`).join('');

  const tTicks = [];
  for (let t = tLo; t <= tHi; t += 10) tTicks.push(t);
  const pTicks = [0, pHi / 2, pHi];

  const bars = precip
    .map((p, m) => {
      const y = yp(p);
      return `<rect class="cg-bar" x="${(xc(m) - bw * 0.32).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(pad.t + ih - y).toFixed(1)}" rx="1.5"><title>${Math.round(p)} mm</title></rect>`;
    })
    .join('');

  return `<svg class="climograph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Climograma: temperatura e precipitação médias mensais">
    ${tTicks.map((t) => `<line class="cg-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${yt(t)}" y2="${yt(t)}"/><text class="cg-axis" x="${pad.l - 5}" y="${yt(t) + 3.5}" text-anchor="end">${t}°</text>`).join('')}
    ${pTicks.map((p) => `<text class="cg-axis cg-axis-p" x="${W - pad.r + 5}" y="${yp(p) + 3.5}">${p}</text>`).join('')}
    ${bars}
    <path class="cg-band" d="${line(tmax)}L${[...tmin].reverse().map((v, i) => `${xc(11 - i).toFixed(1)},${yt(v).toFixed(1)}`).join('L')}Z"/>
    <path class="cg-line" d="${line(tmean)}"/>
    ${tmean.map((v, m) => `<circle class="cg-dot" cx="${xc(m).toFixed(1)}" cy="${yt(v).toFixed(1)}" r="2.5"><title>${v.toFixed(1)} °C</title></circle>`).join('')}
    ${MONTHS.map((l, m) => `<text class="cg-axis" x="${xc(m)}" y="${H - 6}" text-anchor="middle">${l}</text>`).join('')}
  </svg>`;
}
