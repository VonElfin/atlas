// Gera o ícone do app (globo estilizado) sem dependências:
//   resources/icons/appIcon.png   janela do app
//   installer/atlas.ico           instalador, atalhos e lista de programas (vários tamanhos)
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(S) {
  const px = Buffer.alloc(S * S * 4);
  const R = S * 0.44;
  const C = S / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - C) / R;
      const dy = (y + 0.5 - C) / R;
      const d = Math.hypot(dx, dy);
      let rgb = [0, 0, 0];
      let a = 0;
      if (d <= 1) {
        const z = Math.sqrt(1 - d * d);
        // Coordenadas esféricas com leve rotação para dar volume.
        const lat = Math.asin(-dy);
        const lng = Math.atan2(dx, z) + 0.6;
        const land =
          Math.sin(lng * 2.1 + 1.3) * Math.cos(lat * 2.7) + Math.sin(lng * 4.3 - lat * 3.1) * 0.45 > 0.55;
        rgb = land ? mix([62, 140, 82], [210, 190, 120], Math.max(0, Math.sin(lat * 3))) : [32, 96, 180];
        const grid = Math.min(Math.abs(Math.sin(lat * 6)), Math.abs(Math.sin(lng * 6)));
        if (S >= 64 && grid < 0.06) rgb = mix(rgb, [255, 255, 255], 0.35);
        const light = 0.35 + 0.65 * Math.max(0, -0.5 * dx - 0.55 * dy + 0.67 * z);
        rgb = rgb.map((v) => v * light);
        a = Math.min(1, (1 - d) * R); // anti-aliasing na borda
      } else if (d < 1.08) {
        rgb = [110, 170, 255];
        a = 0.5 * (1 - (d - 1) / 0.08); // atmosfera
      }
      const i = (y * S + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = Math.round(a * 255);
    }
  }
  return png(S, px);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(S, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO com imagens PNG (suportado desde o Windows Vista). Tamanho 256 é gravado como 0.
function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: render(s) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // tipo: ícone
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(({ s, data }) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map((i) => i.data)]);
}

mkdirSync(join(ROOT, 'resources', 'icons'), { recursive: true });
mkdirSync(join(ROOT, 'installer'), { recursive: true });
writeFileSync(join(ROOT, 'resources', 'icons', 'appIcon.png'), render(256));
writeFileSync(join(ROOT, 'installer', 'atlas.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('OK -> resources/icons/appIcon.png, installer/atlas.ico');
