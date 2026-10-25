// Crea una memoria nueva con identidad humana explícita y contenido inicial.
// No elimina ni reemplaza bases existentes: la operación es idempotente y se
// niega a atribuir una memoria ya habitada a otra persona.

import { initializeStarterMemory } from './starter-memory.ts';

const databasePath = process.argv[2];
const ownerId = process.argv[3] ?? process.env['VERA_OWNER'];
const ownerName = process.argv[4] ?? process.env['VERA_OWNER_NAME'];
const profile = process.argv[5] ?? process.env['VERA_PROFILE'] ?? 'personal';

if (databasePath === undefined || ownerId === undefined || ownerName === undefined ||
  (profile !== 'personal' && profile !== 'collective')) {
  console.error('uso: npm run initialize -- <base.sqlite> <participant:id> "Nombre" [personal|collective]');
  process.exitCode = 2;
} else {
  const report = initializeStarterMemory({ databasePath, owner: { id: ownerId, name: ownerName }, profile });
  console.log(`Memoria inicial v${report.version}`);
  console.log(`  aplicadas:  ${report.applied}`);
  console.log(`  existentes: ${report.duplicates}`);
  console.log(`  páginas:    ${report.pages}`);
  console.log(`  bloques:    ${report.blocks}`);
  if (profile === 'collective') {
    console.log('  siguiente:  registra la primera passkey administrativa con');
    console.log(`              npm run owner:enroll-passkey -- ${databasePath}`);
  }
}
