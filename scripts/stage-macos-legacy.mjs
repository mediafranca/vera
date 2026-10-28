import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const stage = 'dist/legacy-macos';

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync('dist/desktop', `${stage}/desktop`, { recursive: true });
cpSync('packages/web/dist', `${stage}/web`, { recursive: true });
cpSync('schema/schema.sql', `${stage}/schema.sql`);
cpSync('node_modules/p5/lib/p5.min.js', `${stage}/p5.min.js`);

const manifest = {
  name: 'vera-macos-catalina-legacy',
  version: root.version,
  private: true,
  type: 'module',
  main: 'desktop/main.mjs',
  dependencies: {
    'better-sqlite3': '11.10.0',
  },
  build: {
    appId: 'net.mediafranca.vera',
    productName: 'Vera',
    artifactName: `Vera-${root.version}-macOS-10.15-Intel-legacy.\${ext}`,
    asar: true,
    directories: { output: '../../release-legacy' },
    files: ['desktop/**', 'package.json'],
    extraResources: [
      { from: 'web', to: 'web' },
      { from: 'schema.sql', to: 'schema.sql' },
      { from: 'p5.min.js', to: 'p5.min.js' },
    ],
    mac: {
      target: ['dmg'],
      category: 'public.app-category.productivity',
      minimumSystemVersion: '10.15',
      identity: null,
      notarize: false,
    },
  },
};

writeFileSync(`${stage}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
