import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listPackage } from '@electron/asar';

const archives = [];
const visit = (directory) => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name === 'app.asar') archives.push(path);
  }
};

visit('release');
if (archives.length === 0) throw new Error('el paquete Desktop no dejó ningún app.asar verificable');

for (const archive of archives) {
  const files = listPackage(archive).map((path) => path.replaceAll('\\', '/'));
  const hasBridge = files.includes('/node_modules/@napi-rs/canvas/index.js');
  const native = files.filter((path) =>
    path.startsWith('/node_modules/@napi-rs/canvas-') && path.endsWith('.node')
  );
  const normalizedArchive = archive.replaceAll('\\', '/').toLowerCase();
  const expected = normalizedArchive.includes('win')
    ? ['canvas-win32-x64-msvc']
    : normalizedArchive.includes('.app/') || normalizedArchive.includes('/mac')
      ? ['canvas-darwin-arm64', 'canvas-darwin-x64']
      : ['canvas-linux-x64-gnu'];
  const missing = expected.filter((platform) => !native.some((path) => path.includes(platform)));
  if (!hasBridge || missing.length > 0) {
    throw new Error(
      `${archive} no contiene el puente y todos los binarios nativos de @napi-rs/canvas` +
      (missing.length === 0 ? '' : `: faltan ${missing.join(', ')}`),
    );
  }
  process.stdout.write(`Paquete Desktop cerrado: ${archive}\n`);
}
