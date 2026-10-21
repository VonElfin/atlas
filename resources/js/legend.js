// Legendas geradas a partir do colormap GIBS ou da rampa de relevo.
import { RELIEF_STOPS } from './layers.js';

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function gradient(colors, ticks, unit) {
  const stops = colors.map((c, i) => `${c} ${((i / (colors.length - 1)) * 100).toFixed(1)}%`).join(',');
  return `<div class="legend">
    <div class="legend-bar" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="legend-ticks">${ticks.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
    ${unit ? `<div class="legend-unit">${esc(unit)}</div>` : ''}
  </div>`;
}

export function reliefLegend() {
  const ticks = ['−8 km', '0', '1 km', '3 km', '6 km'];
  return gradient(RELIEF_STOPS.map(([, c]) => c), ticks, 'altitude / profundidade');
}

export function colormapLegend(overlay, colormap) {
  const { entries, legendType } = colormap;
  if (legendType === 'classification') {
    return `<ul class="legend-classes">${entries
      .map((e) => `<li><i style="background:${rgb(e.rgb)}"></i>${esc(overlay.format(e))}</li>`)
      .join('')}</ul>`;
  }
  const n = entries.length;
  const sampleCount = Math.min(n, 24);
  const colors = Array.from({ length: sampleCount }, (_, i) => rgb(entries[Math.round((i / (sampleCount - 1)) * (n - 1))].rgb));
  const tick = overlay.tick ?? ((e) => e.label);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => tick(entries[Math.round(f * (n - 1))]));
  return gradient(colors, ticks, overlay.unit);
}
