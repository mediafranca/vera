// Arranca el servidor.
//   node packages/server/src/main.ts [puerto] [base] [host] [almacén-de-objetos]
//
// Lo que no venga en la línea de comandos se lee de `.env` en la raíz del
// repositorio. El orden es ese —argumento, luego entorno, luego el valor por
// defecto— porque quien escribe un argumento lo escribió para esta corrida, y
// una configuración de archivo no puede pisarlo.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listen } from './server.ts';
import { modelPresence } from './model.ts';
import { transcriberDiagnosis } from './transcribe.ts';

/**
 * La configuración de esta instancia, si la hay.
 *
 * `.env` no se versiona: lleva los secretos de una instancia concreta. Lo que sí
 * se versiona es `.env.example`, que dice qué hay que llenar sin decir con qué.
 * Que falte no es un error: los valores por defecto bastan para correr Vera en
 * la máquina de quien la escribe.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const setting = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
};

const port = Number(process.argv[2] ?? setting('VERA_PORT') ?? 4173);
const databasePath = process.argv[3] ?? setting('VERA_DATABASE') ?? 'data/vera.sqlite';
// Loopback por defecto; poner '0.0.0.0' aquí es una decisión consciente, y hoy
// una que abre el grafo a quien alcance el puerto: las personas todavía no se
// autentican. Ver identity-access.allium.
const host = process.argv[4] ?? setting('VERA_HOST') ?? '127.0.0.1';
// Configurable para que una instancia de pruebas no escriba en el almacén real.
const objectsRoot = process.argv[5] ?? setting('VERA_OBJECTS') ?? 'objects';
const webRoot = setting('VERA_WEB_ROOT') ?? 'packages/web/dist';

/*
 * De quién es este grafo.
 *
 * Sin decirlo, toda instancia nueva nacía con el dueño de la primera: el
 * servidor traía un nombre escrito en el código y nadie se lo pisaba nunca. Para
 * quien clona Vera y la levanta en su máquina eso no es un detalle cosmético
 * —firmaría cada cosa que escriba con el nombre de otra persona— y la
 * procedencia, que es de lo que Vera trata, diría algo falso desde el primer
 * bloque.
 *
 * No hay valor por defecto, y esa es la decisión: un nombre escrito en el código
 * es exactamente cómo se llegó al problema. Esto sólo sirve para sembrar un
 * grafo que todavía no tiene dueño; en uno con historia manda el grafo, porque
 * cambiar de dueño sería reescribir de quién es lo ya escrito.
 */
const ownerId = setting('VERA_OWNER');
const ownerName = setting('VERA_OWNER_NAME');
const declaredOwner =
  ownerId === undefined ? undefined : { id: ownerId, name: ownerName ?? ownerId };

/*
 * Por dónde se alcanza esta Vera desde otro equipo.
 *
 * Vera escucha en loopback y quien la publica elige el frente —aquí `tailscale
 * serve`—, así que esta dirección la sabe quien la configuró y no el proceso que
 * corre detrás. Se declara para poder dictarla en la página de la puerta: un
 * cliente MCP que corra en otro equipo de la tailnet necesita ponerla en
 * `VERA_URL`, y sin esto habría que acordarse de memoria.
 */
const reachableAt = setting('VERA_REACHABLE_AT');
const remoteMcpClient = setting('VERA_MCP_REMOTE_CLIENT');
const remoteMcpCredentialFile = setting('VERA_MCP_REMOTE_CREDENTIAL_FILE');
const remoteMcpCredentialName = setting('VERA_MCP_REMOTE_CREDENTIAL_NAME');
const remoteMcpCredential =
  remoteMcpClient !== undefined &&
  remoteMcpCredentialFile !== undefined &&
  remoteMcpCredentialName !== undefined
    ? { client: remoteMcpClient, file: remoteMcpCredentialFile, name: remoteMcpCredentialName }
    : undefined;
const publicDomain = setting('VERA_PUBLIC_DOMAIN');
const publicTitle = setting('VERA_PUBLIC_TITLE') ?? 'Vera';
const publicOutput = setting('VERA_PUBLIC_OUTPUT');
const publicPreviewPort = setting('VERA_PUBLIC_PREVIEW_PORT');
const publicPreviewUrl = setting('VERA_PUBLIC_PREVIEW_URL');
const publicMcpOrigin = setting('VERA_PUBLIC_MCP_ORIGIN');
const librarianHookUrl = setting('VERA_LIBRARIAN_HOOK_URL');
const librarianCredentialDirectory = setting('CREDENTIALS_DIRECTORY');
const librarianHookToken = setting('VERA_LIBRARIAN_HOOK_TOKEN') ?? (
  librarianCredentialDirectory === undefined
    ? undefined
    : (() => {
        const path = join(librarianCredentialDirectory, 'vera-librarian-hook');
        return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
      })()
);
const librarianHook = librarianHookUrl !== undefined && librarianHookToken !== undefined
  ? { url: librarianHookUrl, token: librarianHookToken }
  : undefined;
const pictosApiBase = setting('PICTOS_API_BASE');
const pictosApiKey = setting('PICTOS_API_KEY');
const pictosApi = pictosApiBase !== undefined && pictosApiKey !== undefined
  ? { baseUrl: pictosApiBase, key: pictosApiKey }
  : undefined;
const processConnections = pictosApi === undefined
  ? undefined
  : { 'pictos-next': pictosApi };

const { vera } = listen({
  port,
  databasePath,
  host,
  webRoot,
  objectsRoot,
  ...(reachableAt === undefined ? {} : { reachableAt }),
  ...(remoteMcpCredential === undefined ? {} : { remoteMcpCredential }),
  ...(publicDomain === undefined
    ? {}
    : { publicSite: { title: publicTitle, canonicalDomain: publicDomain } }),
  ...(publicOutput === undefined
    ? {}
    : {
        publicOutput,
        publicBranding: join(ROOT, 'packages/web/public'),
      }),
  ...(publicPreviewPort === undefined ? {} : { publicPreviewPort: Number(publicPreviewPort) }),
  ...(publicPreviewUrl === undefined ? {} : { publicPreviewUrl }),
  ...(publicMcpOrigin === undefined ? {} : { publicMcpOrigin }),
  ...(librarianHook === undefined ? {} : { librarianHook }),
  ...(processConnections === undefined ? {} : { processConnections }),
  ...(declaredOwner === undefined ? {} : { owner: declaredOwner }),
});

console.log(`Vera escucha en http://localhost:${port}`);
console.log(`  base:     ${databasePath}`);
// Quién firma lo que se escriba aquí. Se dice al arrancar porque el error que
// evita es silencioso: escribir durante días como otra persona.
const dueño = vera.graph.owner;
console.log(`  dueño:    ${vera.graph.participant(dueño ?? '')?.name ?? '—'} (${dueño ?? 'sin dueño'})`);
console.log(`  páginas:  ${vera.graph.pages().length}`);
console.log(`  bloques:  ${vera.graph.allBlocks().length}`);
console.log(`  secuencia:${vera.graph.log().lastSequence}`);
if (publicDomain !== undefined) {
  console.log(
    `  sitio:    ${publicDomain}${
      publicOutput === undefined ? ' (sin salida configurada)' : ` → ${publicOutput}`
    }`,
  );
  if (publicPreviewPort !== undefined) {
    console.log(`  previa:   http://127.0.0.1:${publicPreviewPort}`);
  }
}

/*
 * Lo que se sirve es el compilado, y el compilado puede estar viejo.
 *
 * La aplicación instalada no lee `packages/web/src`: lee `dist`, que sólo
 * existe porque alguien corrió `npm run build`. Editar una fuente y recargar no
 * cambia nada, y nada lo dice —la aplicación se ve igual de bien sirviendo
 * código de hace tres días—. Es una forma cara de perder una tarde: se busca el
 * error en un código que el navegador nunca llegó a recibir.
 *
 * Comparar las fechas es barato y responde la pregunta antes de que se haga.
 */
const newest = (root: string): number => {
  if (!existsSync(root)) return 0;
  const entry = statSync(root);
  if (!entry.isDirectory()) return entry.mtimeMs;
  return readdirSync(root).reduce((latest, name) => Math.max(latest, newest(join(root, name))), 0);
};

// `resolve` y no `join`: `VERA_WEB_ROOT` puede venir absoluto, y unirlo a la raíz
// del repositorio daría una ruta que no existe —y con ella un «sin compilar» que
// es mentira sobre un cliente que está perfectamente ahí.
const built = newest(resolve(ROOT, webRoot, 'index.html'));
const sources = Math.max(
  newest(join(ROOT, 'packages/web/src')),
  newest(join(ROOT, 'packages/web/public')),
  newest(join(ROOT, 'packages/web/index.html')),
);
if (built === 0) {
  console.log(`  cliente:  sin compilar en ${webRoot} — corre \`npm run build\``);
} else if (sources > built) {
  const age = Math.round((sources - built) / 60_000);
  console.log(`  cliente:  ${webRoot} quedó atrás de las fuentes por ${age} min`);
  console.log('            lo que se sirve es el compilado: corre `npm run build`');
} else {
  console.log(`  cliente:  ${webRoot}, al día`);
}

// Escuchar fuera de loopback sin que las personas se autentiquen entrega el
// grafo a cualquiera que alcance el puerto. Se dice al arrancar, cada vez.
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
  console.log(`  aviso:    escuchando en ${host}, y las personas todavía no se autentican:`);
  console.log('            cualquiera que alcance este puerto escribe como el dueño');
}

// La voz depende de dos binarios ajenos: mejor saberlo ahora que al grabar.
const voz = await transcriberDiagnosis();
if (voz.ready) {
  console.log(`  voz:      ${voz.whisper}`);
} else {
  console.log('  voz:      no disponible');
  if (voz.ffmpeg === null) console.log('    falta ffmpeg (o apunta VERA_FFMPEG al binario)');
  if (voz.whisper === null) console.log('    falta whisper.cpp (o apunta VERA_WHISPER al binario)');
  if (voz.model === null) console.log('    falta el modelo (o apunta VERA_WHISPER_MODEL a uno)');
}

// El modelo con que se leen las páginas. Que falte no impide nada: procesar hace
// la parte de los enlaces igual y dice cuál no pudo hacer.
const lector = await modelPresence();
console.log(
  lector.ready
    ? `  lectura:  ${lector.model}`
    : '  lectura:  sin modelo local (procesar sólo resolverá enlaces)',
);
