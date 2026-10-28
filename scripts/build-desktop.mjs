import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const outdir = 'dist/desktop';
const legacySqlite = process.env['VERA_LEGACY_SQLITE'] === '1';
const target = process.env['VERA_DESKTOP_NODE_TARGET'] ?? 'node24';
const legacySqlitePath = fileURLToPath(new URL('./sqlite-legacy.mjs', import.meta.url));
const legacySqlitePlugin = {
  name: 'legacy-sqlite',
  setup(build) {
    build.onResolve({ filter: /^node:sqlite$/ }, () => ({ path: legacySqlitePath }));
  },
};

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ['packages/desktop/src/main.ts'],
  outfile: `${outdir}/main.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target,
  external: ['electron', 'electron-updater', ...(legacySqlite ? ['better-sqlite3'] : [])],
  plugins: legacySqlite ? [legacySqlitePlugin] : [],
  banner: legacySqlite ? { js: "process.env.VERA_LEGACY_DESKTOP = '1';" } : undefined,
  sourcemap: true,
});

await build({
  entryPoints: ['packages/desktop/src/preload.ts'],
  outfile: `${outdir}/preload.cjs`,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target,
  external: ['electron'],
  sourcemap: true,
});

copyFileSync('packages/desktop/src/setup.html', `${outdir}/setup.html`);
