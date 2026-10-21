// Gera release/Atlas-Setup-<versão>.exe: compila o app (neu build) e empacota com o Inno Setup.
// Uso: npm run installer
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const iscc = join(ROOT, 'node_modules', 'innosetup', 'bin', 'ISCC.exe');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: cmd === 'npx' });
  if (r.status !== 0) {
    console.error(`Falhou: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

if (process.platform !== 'win32') {
  console.error('O instalador só pode ser gerado no Windows.');
  process.exit(1);
}
if (!existsSync(iscc)) {
  console.error('Compilador do Inno Setup não encontrado. Rode `npm install` primeiro.');
  process.exit(1);
}

run('npx', ['neu', 'build', '--release', '--embed-resources']);
run(iscc, [`/DAppVersion=${version}`, join('installer', 'atlas.iss')]);

const out = join(ROOT, 'release', `Atlas-Setup-${version}.exe`);
console.log(`\nOK -> ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
