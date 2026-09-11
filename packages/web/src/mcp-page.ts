// La página de la puerta MCP, leída como tabla.
//
// Una fila por conexión, y dos mitades en cada fila: a la izquierda lo que se
// decidió —cómo se llama, cómo se declara el cliente, con qué identidad debería
// entrar, qué se le concede—, a la derecha lo que pasó —con qué identidad entró
// de verdad, cuándo leyó por última vez, cuánto se llevó—.
//
// Las de la izquierda se corrigen pulsándolas y escriben en el bloque del que
// salieron. Las de la derecha no se tocan: salen del registro de exposición y no
// son decisiones, son hechos. Que estén en la misma fila es el motivo de que la
// página exista: hoy tres conexiones declaran un cliente y leen como el dueño,
// y eso sólo se ve poniendo las dos columnas juntas.
//
// Ver packages/server/src/mcp-page.ts y specs/mcp-server.allium.

import {
  api,
  type Change,
  type DiscardDecision,
  type DiscardRequest,
  type MCPConnect,
  type MCPConnection,
  type SeenClient,
} from './api.ts';
import { cellIn, editableCell, observedCell, rowIn, section } from './table.ts';
import { when } from './dates.ts';

/** ¿Esta página gobierna la puerta MCP? Se responde con lo que la página trae. */
export function isMCPPage(properties: readonly { key: string; value: string }[]): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'mcp',
  );
}

export type Write = (change: Change) => Promise<boolean>;

/** Cuánta memoria se llevó, en unidades que una persona puede pesar. */
function weigh(characters: number): string {
  if (characters <= 0) return '—';
  if (characters < 10_000) return `${characters} caracteres`;
  const pages = characters / 2_000;
  return pages < 10
    ? `≈${pages.toFixed(1)} páginas de texto`
    : `≈${Math.round(pages)} páginas de texto`;
}

/**
 * Cómo se dice un cliente en una celda.
 *
 * Un `user-agent` entero son ciento veinte caracteres de los que sirven cuatro.
 * Se reduce a qué programa es y dónde corre, que es lo que uno necesita para
 * reconocer si esa lectura fue suya. Lo que no se reconozca viaja tal cual y
 * recortado: preferible una cadena fea que una conexión escondida detrás de un
 * «otro».
 */
export function shortClient(said: string | null): string {
  if (said === null || said.trim() === '') return 'no dijo nada';
  if (!said.startsWith('Mozilla/')) return said.length > 28 ? `${said.slice(0, 27)}…` : said;
  const where = /Macintosh/.test(said)
    ? 'Mac'
    : /Windows/.test(said)
      ? 'Windows'
      : /Android/.test(said)
        ? 'Android'
        : /iPhone|iPad/.test(said)
          ? 'iOS'
          : /Linux/.test(said)
            ? 'Linux'
            : '';
  const what = /Firefox/.test(said)
    ? 'Firefox'
    : /Edg\//.test(said)
      ? 'Edge'
      : /Chrome/.test(said)
        ? 'Chrome'
        : /Safari/.test(said)
          ? 'Safari'
          : 'navegador';
  return where === '' ? what : `${what} en ${where}`;
}

/** Cuántas veces ha leído y cuándo fue la última, en una celda. */
function reading(seen: SeenClient | null): string {
  if (seen === null) return '';
  const times = seen.deliveries === 1 ? '1 vez' : `${seen.deliveries} veces`;
  return `${times} · ${when(seen.lastAt)}`;
}

/**
 * La configuración de un cliente que corre en otro equipo, dictada entera.
 *
 * El cliente lanza `ssh` y la puerta corre aquí, al lado de VERA: no hay una
 * segunda copia del repositorio que mantener al día en cada equipo desde el que
 * se lea, y `VERA_URL` no aparece porque el loopback por omisión ya es el
 * correcto cuando el proceso nace en esta máquina.
 *
 * La línea remota es la misma que se lanzaría aquí, con el nombre del cliente
 * delante: un shell remoto recibe una orden y no un arreglo de argumentos. Se
 * arma de `command` y `args` en vez de volver a escribir las banderas, para que
 * cambiar cómo arranca la puerta cambie las dos formas a la vez.
 *
 * `/usr/bin/ssh` es lo único de aquí que no es un hecho de este despliegue: es
 * la ruta en el otro equipo, y es la misma en macOS y en Linux.
 */
export function remoteLaunch(connect: MCPConnect, client: string): string {
  const credential = connect.remoteCredential?.client === client ? connect.remoteCredential : null;
  const shellWord = (word: string): string => `'${word.replaceAll("'", `'"'"'`)}'`;
  const remote = [
    `VERA_CLIENT=${shellWord(client)}`,
    ...(credential === null
      ? []
      : [
          `VERA_SYSTEMD_CREDENTIAL_FILE=${shellWord(credential.file)}`,
          `VERA_SYSTEMD_CREDENTIAL_NAME=${shellWord(credential.name)}`,
        ]),
    shellWord(connect.command),
    ...connect.args.map(shellWord),
  ].join(' ');
  const args = ['-q', '-o', 'BatchMode=yes', connect.login, remote];

  if (client.toLowerCase().includes('codex')) {
    return [
      '[mcp_servers.vera]',
      'command = "/usr/bin/ssh"',
      `args = [${args.map((part) => JSON.stringify(part)).join(', ')}]`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 60',
      'required = true',
      'default_tools_approval_mode = "auto"',
    ].join('\n');
  }

  return JSON.stringify({ mcpServers: { vera: { command: '/usr/bin/ssh', args } } }, null, 2);
}

/** Configuración JSON para un cliente MCP que entra por HTTPS. */
export function publicLaunch(url: string, client: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        vera: {
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Vera-Client': client,
          },
        },
      },
    },
    null,
    2,
  );
}

/**
 * Los datos con que se enchufa una IA, listos para pegar en su formulario.
 *
 * Todos los «agregar servidor MCP» piden lo mismo con nombres distintos: tipo,
 * comando, argumentos, variables de entorno y directorio de trabajo. Hasta ahora
 * eso vivía en `packages/mcp/README.md`, o sea fuera de VERA: había que salirse
 * de la aplicación y abrir un archivo del repositorio para saber qué pegar.
 *
 * No se escriben: se calculan de este despliegue. Una prosa con la ruta y el
 * puerto dentro mentiría con toda confianza el día que se mueva cualquiera de
 * los dos.
 */
function connectPanel(
  connect: MCPConnect,
  host: HTMLElement,
  openGuide?: (title: string) => void,
): void {
  const heading = document.createElement('h3');
  heading.className = 'governing-title';
  heading.textContent = 'Cómo se enchufa una IA a esta Vera';
  host.append(heading);

  const note = document.createElement('p');
  note.className = 'governing-note';
  note.textContent = connect.present
    ? 'Esto es lo que pide cualquier formulario de «agregar servidor MCP», con los ' +
      'valores de este equipo. El tipo es stdio: no hay una dirección que pegar, el ' +
      'cliente lanza un proceso y le habla. Por eso sólo sirve para una IA que corra ' +
      'en un equipo tuyo.'
    : 'No se encontró la puerta donde debería estar. Estos valores están calculados ' +
      'igual, pero antes de pegarlos hay que comprobar que el repositorio está donde ' +
      'dice.';
  host.append(note);

  /*
   * La configuración concreta y la explicación larga son dos escalas distintas.
   * Las guías viven como páginas ordinarias —se enlazan, se buscan y se editan—,
   * pero tienen que estar a la vista justo aquí, donde alguien está intentando
   * conectar un cliente, no varios metros más abajo entre los bloques fuente.
   */
  const guides = document.createElement('nav');
  guides.className = 'connect-guides';
  guides.setAttribute('aria-label', 'guías para conectar inteligencias artificiales');
  const guideHeading = document.createElement('strong');
  guideHeading.textContent = 'Instrucciones por proveedor';
  const guideList = document.createElement('ul');
  for (const [title, label] of [
    ['VERA — conectar OpenAI por MCP', 'OpenAI · Codex y ChatGPT'],
    ['VERA — conectar Claude por MCP', 'Anthropic · Claude Code por HTTPS o stdio'],
    ['VERA — conectar LM Studio por MCP', 'LM Studio · modelos locales por HTTPS o stdio'],
    ['VERA — conectar Gemini por MCP', 'Google · Gemini CLI'],
  ] as const) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/p/${encodeURIComponent(title)}`;
    link.textContent = label;
    if (openGuide !== undefined) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openGuide(title);
      });
    }
    item.append(link);
    guideList.append(item);
  }
  guides.append(guideHeading, guideList);
  host.append(guides);

  /*
   * El nombre del cliente, una sola vez y arriba del todo.
   *
   * De todo lo que hay en este panel es lo único que es una decisión: los demás
   * valores son hechos de este despliegue. Y es la decisión que gobierna las dos
   * formas de conectarse, así que estaba mal dentro de la lista de una de ellas.
   * Es cómo va a aparecer esa IA en la tabla de abajo y en el registro de
   * exposición; sin él caen todas juntas en «sin declarar».
   */
  const decided = document.createElement('p');
  decided.className = 'connect-decision';
  const label = document.createElement('label');
  label.textContent = 'Cómo se declara este cliente';
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'connect-client';
  field.value = connect.remoteCredential?.client ?? 'claude-desktop';
  field.setAttribute('aria-label', 'cómo se va a llamar esta conexión');
  field.placeholder = 'nombre de la conexión';
  label.append(field);
  decided.append(label);
  host.append(decided);

  /*
   * Dónde corre el cliente, que decide qué hay que pegar.
   *
   * Los dos casos no se diferencian en un valor sino en la forma entera: en este
   * equipo se dicta un comando con sus argumentos, y en otro equipo se dicta una
   * orden que abre una tubería hasta aquí. Ofrecer sólo el primero y explicar el
   * segundo en prosa —que es lo que había— deja a quien está en el portátil
   * traduciendo a mano una configuración que nadie comprobó.
   */
  const chooser = document.createElement('fieldset');
  chooser.className = 'connect-where';
  const legend = document.createElement('legend');
  legend.textContent = 'Dónde corre el cliente';
  chooser.append(legend);

  const here = document.createElement('div');
  const there = document.createElement('div');

  const option = (value: string, text: string, first: boolean): HTMLInputElement => {
    const wrap = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'connect-where';
    radio.value = value;
    radio.checked = first;
    const said = document.createElement('span');
    said.textContent = text;
    wrap.append(radio, said);
    chooser.append(wrap);
    return radio;
  };

  const onHere = option('here', 'este equipo', true);
  option('there', 'otro equipo', false);
  const settleWhere = (): void => {
    here.hidden = !onHere.checked;
    there.hidden = onHere.checked;
  };
  chooser.addEventListener('change', settleWhere);
  host.append(chooser, here, there);

  const list = document.createElement('dl');
  list.className = 'connect';
  here.append(list);

  /*
   * Un renglón por campo del formulario, con su valor copiable.
   *
   * Copiar y no seleccionar a mano: una ruta absoluta con banderas dentro se
   * copia mal a ojo, y un argumento perdido se manifiesta como «el servidor no
   * arrancó», que no dice nada sobre qué falta.
   */
  const row = (label: string, value: string, says?: string): HTMLElement => {
    const key = document.createElement('dt');
    key.textContent = label;
    const held = document.createElement('dd');

    const text = document.createElement('code');
    text.className = 'connect-value';
    text.textContent = value;
    held.append(text);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'connect-copy';
    copy.textContent = 'copiar';
    copy.setAttribute('aria-label', `copiar ${label}`);
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(value).then(
        () => {
          copy.textContent = 'copiado';
          window.setTimeout(() => (copy.textContent = 'copiar'), 1500);
        },
        () => (copy.textContent = 'no se pudo'),
      );
    });
    held.append(copy);

    if (says !== undefined) {
      const aside = document.createElement('span');
      aside.className = 'connect-says';
      aside.textContent = says;
      held.append(aside);
    }

    list.append(key, held);
    return held;
  };

  row('Tipo', connect.transport, 'no es una URL: es un proceso que el cliente lanza');
  row('Comando', connect.command, `node ${connect.node}, por su ruta entera para no depender del PATH`);
  row('Argumentos', connect.args.join(' '));
  row('Directorio de trabajo', connect.cwd);

  const named = document.createElement('dt');
  named.textContent = 'Variables de entorno';
  const values = document.createElement('dd');

  const env = document.createElement('code');
  env.className = 'connect-value';

  const copyEnv = document.createElement('button');
  copyEnv.type = 'button';
  copyEnv.className = 'connect-copy';
  copyEnv.textContent = 'copiar';

  copyEnv.addEventListener('click', () => {
    void navigator.clipboard?.writeText(env.textContent ?? '').then(() => {
      copyEnv.textContent = 'copiado';
      window.setTimeout(() => (copyEnv.textContent = 'copiar'), 1500);
    });
  });

  values.append(env, copyEnv);
  list.append(named, values);

  /*
   * Y para el otro equipo, la configuración entera y no un valor que cambiar.
   *
   * Antes esto era un párrafo que decía «cambia VERA_URL por tal cosa», y era
   * cierto y no alcanzaba: en el otro equipo el comando, los argumentos y el
   * directorio de trabajo también son otros, porque nombran rutas de aquí. Quien
   * lo leía se llevaba una configuración que sólo estaba corregida en un tercio.
   *
   * Lo que se dicta es el arranque por tubería: el cliente lanza `ssh` y la
   * puerta corre aquí, al lado de Vera. Así no hay una segunda copia del
   * repositorio que mantener al día en cada equipo desde el que se lea, y
   * `VERA_URL` no aparece porque el loopback por omisión ya es el correcto.
   *
   * La otra manera —el repositorio también allí, apuntando a la dirección
   * alcanzable— sigue existiendo y se dice debajo, sin dictarla: sus rutas son
   * del otro equipo y este proceso no las conoce. Dictar lo que no se sabe es
   * exactamente lo que esta página existe para no hacer.
   */
  const remote = document.createElement('pre');
  remote.className = 'connect-json';
  const remoteCode = document.createElement('code');
  remote.append(remoteCode);

  const copyRemote = document.createElement('button');
  copyRemote.type = 'button';
  copyRemote.className = 'connect-copy';
  copyRemote.textContent = 'copiar';
  copyRemote.addEventListener('click', () => {
    void navigator.clipboard?.writeText(remoteCode.textContent ?? '').then(() => {
      copyRemote.textContent = 'copiado';
      window.setTimeout(() => (copyRemote.textContent = 'copiar'), 1500);
    });
  });

  /** Los dos bloques copiables se rehacen con el nombre del cliente. */
  const settle = (): void => {
    const client = field.value.trim() === '' ? 'vera-mcp' : field.value.trim();
    env.textContent = `VERA_URL=${connect.url}\nVERA_CLIENT=${client}`;
    remoteCode.textContent = remoteLaunch(connect, client);
  };
  settle();
  field.addEventListener('input', settle);

  const remoteSays = document.createElement('p');
  remoteSays.className = 'governing-note';
  remoteSays.textContent =
    `El cliente abre una tubería hasta ${connect.login} y la puerta corre aquí, así que ` +
    'no hay nada que instalar ni que mantener al día en el otro equipo. Para que funcione ' +
    'tiene que poder entrar por ssh sin escribir una contraseña: `BatchMode=yes` hace que ' +
    'falle en vez de quedarse esperando delante de una app que no tiene dónde preguntarla. ' +
    'Eso es lo único de aquí que este equipo no puede comprobar, porque se comprueba desde ' +
    'el otro. Si el nombre contiene «codex», el bloque sale en TOML nativo y la conexión ' +
    'queda requerida durante la sesión y sin confirmaciones redundantes.';
  there.append(remote, copyRemote, remoteSays);

  const sshPath = document.createElement('p');
  sshPath.className = 'governing-note';
  sshPath.textContent =
    'La ruta de ssh es la del otro equipo y no la de éste, así que es el único valor de ' +
    'este panel que no es un hecho de este despliegue. `/usr/bin/ssh` es donde vive en ' +
    'macOS y en Linux; en Windows hay que cambiarla.';
  there.append(sshPath);

  const other = document.createElement('p');
  other.className = 'governing-note';
  other.textContent =
    connect.reachableAt === null
      ? 'La otra manera es tener el repositorio y node también en ese equipo y apuntar ' +
        'VERA_URL a la dirección por la que se alcanza éste. Este despliegue no la tiene ' +
        'declarada (VERA_REACHABLE_AT en .env), así que no se puede dictar.'
      : `La otra manera es tener el repositorio y node también en ese equipo, con las rutas ` +
        `de allí, y VERA_URL=${connect.reachableAt}, que es por donde se alcanza esta Vera ` +
        'desde la tailnet. Se mantienen dos copias del código a cambio de no depender de ssh.';
  there.append(other);

  const http = document.createElement('p');
  http.className = 'governing-note';
  http.textContent = connect.publicMcp === null
    ? 'Esta Vera todavía no tiene una puerta HTTPS pública.'
    : `La puerta HTTPS de este despliegue es ${connect.publicMcp}. Al crear una conexión abajo, ` +
      'Vera genera el JSON completo con esa dirección, la identidad del cliente y su credencial. ' +
      'Cuando VERA Conecta reemplace la dirección directa, este mismo generador entregará la nueva ' +
      'URL: no habrá una segunda receta que actualizar.';
  host.append(http);

  settleWhere();
}

export async function renderMCP(
  write: Write,
  notify: (message: string) => void,
  openGuide?: (title: string) => void,
): Promise<{ element: HTMLElement; declaring: Set<string> } | null> {
  const door = await api.mcp().catch(() => null);
  if (door === null || door.id === null) return null;

  const element = document.createElement('div');
  element.className = 'governing-tables';

  if (door.connect !== undefined) connectPanel(door.connect, element, openGuide);

  /** Escribir una propiedad del bloque que declara, o quitarla si queda vacía. */
  const put = (block: string, key: string) => async (next: string): Promise<boolean> =>
    write(
      next.trim() === ''
        ? { kind: 'remove_property', block, propertyKey: key }
        : { kind: 'set_property', block, propertyKey: key, propertyValue: next.trim() },
    );

  const declaring = new Set<string>();

  if (door.connections.length > 0) {
    const table = section(element, {
      note:
        'Lo de la izquierda se decide aquí y se corrige pulsándolo. Lo de la derecha ' +
        'sale del registro de exposición: es lo que pasó, y no se edita.',
      headers: ['Conexión', 'Se declara', 'Permiso', 'Debería ser', 'Entra como', 'Ha leído'],
    });

    for (const one of door.connections) {
      declaring.add(one.block);
      const row = rowIn(table, one.block);
      let at = 0;

      editableCell(
        cellIn(row, at++),
        { shows: one.name, label: 'el nombre de la conexión', placeholder: 'sin nombre' },
        (next) => write({ kind: 'edit_block', block: one.block, content: next.trim() }),
      );

      editableCell(
        cellIn(row, at++),
        { shows: one.client, label: 'cómo se declara el cliente', placeholder: 'sin declarar' },
        put(one.block, 'cliente'),
      );

      editableCell(
        cellIn(row, at++),
        { shows: one.permission ?? '', label: 'qué se le concede', placeholder: 'sin decir' },
        put(one.block, 'permiso'),
        [
          { value: 'leer', hint: 'lo que la puerta hace hoy' },
          { value: 'leer y proponer', hint: 'cuando exista el camino de propuestas' },
          { value: 'todo', hint: 'la excepción de la casa' },
        ],
      );

      /*
       * Se enseña el nombre y se corrige el identificador.
       *
       * «Herbert» es lo que se lee y `participant:herbert` es lo que se declara:
       * poner el identificador en la celda la haría ilegible, y poner el nombre
       * en la propiedad rompería la comparación con lo que el registro anota.
       */
      editableCell(
        cellIn(row, at++),
        {
          shows: one.participantName ?? '',
          edits: one.participant ?? '',
          label: 'con qué identidad debería entrar',
          placeholder: 'sin decir',
        },
        put(one.block, 'participante'),
      );

      // Lo observado. La marca de aviso aparece cuando la identidad con que
      // entra no es la que la fila declara: es el agujero, dicho en su sitio.
      const wrong =
        one.seen !== null && one.participant !== null && one.seen.participant !== one.participant;
      const asks = cellIn(row, at++);
      observedCell(
        asks,
        one.seen === null ? '' : wrong ? `${one.seen.name} ⚠` : one.seen.name,
        one.seen === null
          ? 'todavía no ha leído nada'
          : wrong
            ? `declarada como ${one.participant} y entra como ${one.seen.participant}: lo que lea queda anotado con ese nombre`
            : 'entra con la identidad declarada',
      );
      asks.classList.toggle('governing-warn', wrong);

      observedCell(
        cellIn(row, at++),
        reading(one.seen),
        one.seen === null ? 'todavía no ha leído nada' : `${weigh(one.seen.volume)} en total`,
      );
    }
  }

  /*
   * Y quien entró sin tener fila.
   *
   * Va aparte y debajo, no mezclado: son cosas de distinta clase —una es lo que
   * se decidió y la otra lo que apareció— y juntarlas haría que un cliente
   * cualquiera se leyera como una conexión aprobada. Aquí está para que se le
   * dé fila o se le cierre la puerta, que es la decisión que toca.
   */
  if (door.undeclared.length > 0) {
    const table = section(element, {
      title: 'Sin declarar',
      note:
        'Leyó sin tener fila arriba. El navegador con que estás leyendo esto sale aquí, ' +
        'y eso está bien: lo que hay que mirar es lo que no reconozcas.',
      headers: ['Se declaró como', 'Entró como', 'Ha leído', 'Se llevó'],
    });
    for (const one of [...door.undeclared].sort((a, b) => b.lastAt - a.lastAt)) {
      const row = rowIn(table);
      // El `user-agent` entero va en el título: recortado en la celda para poder
      // recorrer la tabla, entero al posarse encima para poder identificarlo.
      observedCell(cellIn(row, 0), shortClient(one.client), one.client ?? undefined);
      observedCell(cellIn(row, 1), one.name);
      observedCell(cellIn(row, 2), reading(one));
      observedCell(cellIn(row, 3), weigh(one.volume));
    }
  }

  connectForm(element, door.connect ?? null, notify);
  await credentialsSection(element, notify);
  markedSection(element, door, notify);

  if (declaring.size === 0 && door.undeclared.length === 0) return null;
  return { element, declaring };
}

/**
 * Las credenciales y su cerco.
 *
 * @guarantee AFenceIsReadWhereTheCredentialIsRead: el cerco se ve donde se ve la
 * credencial que lo lleva. Un permiso que hay que ir a buscar a otra pantalla es
 * un permiso que se olvida de revisar.
 *
 * Y aquí, en la página de la puerta, porque es donde está la pregunta que esto
 * contesta: qué IA entra, con qué identidad y qué se le permite. La tabla de
 * arriba dice con qué identidad *debería* entrar cada conexión; esto es lo que
 * hace que esa columna deje de ser una intención.
 */
/**
 * Conectar una IA nueva, desde la página que gobierna la puerta.
 *
 * Conectar un servicio es un solo gesto y no cuatro: pedirlos por separado
 * —admitir el participante, emitir la credencial, cercarla, escribir su fila—
 * deja a alguien a medias sin manera de saber por dónde iba. El servidor los
 * hace juntos; esto pregunta lo único que hay que decidir.
 *
 * Y lo que devuelve es lo que se pega: la configuración HTTPS completa, con el
 * secreto visible una sola vez. La URL viene del despliegue y no de una receta
 * duplicada, de modo que VERA Conecta podrá sustituirla en un solo lugar.
 */
function connectForm(
  host: HTMLElement,
  connect: MCPConnect | null,
  notify: (message: string) => void,
): void {
  const heading = document.createElement('h3');
  heading.className = 'governing-title';
  heading.textContent = 'Conectar una IA';
  host.append(heading);

  const note = document.createElement('p');
  note.className = 'governing-note';
  note.textContent =
    'Vera crea la identidad, emite su credencial, le pone el cerco si lo lleva, y le escribe ' +
    'su fila arriba. El secreto se enseña una sola vez y no se puede volver a leer: si se ' +
    'pierde, se emite otra y se retira ésta.';
  host.append(note);

  const form = document.createElement('div');
  form.className = 'connect-new';
  host.append(form);

  const field = (label: string, placeholder: string, value = ''): HTMLInputElement => {
    const wrap = document.createElement('label');
    wrap.className = 'connect-field';
    const said = document.createElement('span');
    said.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = value;
    wrap.append(said, input);
    form.append(wrap);
    return input;
  };

  const name = field('Nombre', 'ChatGPT');
  const client = field('Se declara como', 'chatgpt');
  // El nombre se escribe primero y casi siempre dice ya cómo se declara. Se
  // rellena solo mientras nadie lo haya tocado: adivinar está bien; insistir en
  // la adivinanza después de que alguien la corrigió, no.
  let touched = false;
  client.addEventListener('input', () => (touched = true));
  name.addEventListener('input', () => {
    if (!touched) client.value = name.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  });

  /*
   * El trato, en tres y no en tres casillas de alcance.
   *
   * `read`, `write` y `discard` son el vocabulario del código. Aquí la pregunta
   * es qué clase de trato es éste, que es una sola decisión y se puede leer.
   */
  const deals: { value: 'leer' | 'propio' | 'todo'; label: string; says: string }[] = [
    { value: 'leer', label: 'Sólo leer', says: 'lo que la puerta hace hoy' },
    {
      value: 'propio',
      label: 'Escribe en lo suyo',
      says: 'crea páginas de una clase, escribe dentro de ellas, y no borra: marca',
    },
    { value: 'todo', label: 'Todo', says: 'la excepción de la casa; escribe y borra donde sea' },
  ];
  const chooser = document.createElement('label');
  chooser.className = 'connect-field';
  const dealSaid = document.createElement('span');
  dealSaid.textContent = 'Qué se le permite';
  const select = document.createElement('select');
  for (const one of deals) {
    const option = document.createElement('option');
    option.value = one.value;
    option.textContent = one.label;
    select.append(option);
  }
  chooser.append(dealSaid, select);
  form.append(chooser);

  const kind = field('Clase que puede crear', 'Nota de máquina');
  const explains = document.createElement('p');
  explains.className = 'connect-says';
  form.append(explains);

  const settle = (): void => {
    const chosen = deals.find((one) => one.value === select.value);
    explains.textContent = chosen?.says ?? '';
    // La clase sólo se pregunta cuando hay cerco que ponerle.
    (kind.parentElement as HTMLElement).hidden = select.value !== 'propio';
  };
  settle();
  select.addEventListener('change', settle);

  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'connect-copy';
  go.textContent = 'conectar';
  form.append(go);

  const born = document.createElement('div');
  born.className = 'connect-born';
  host.append(born);

  go.addEventListener('click', () => {
    const said = {
      name: name.value.trim(),
      client: client.value.trim(),
      deal: select.value as 'leer' | 'propio' | 'todo',
      ...(select.value === 'propio' ? { kind: kind.value.trim() } : {}),
    };
    if (said.name === '' || said.client === '') {
      notify('una conexión necesita nombre y con qué palabra se declara');
      return;
    }
    go.disabled = true;
    void api
      .connect(said)
      .then((made) => {
        /*
         * El secreto, una vez y en su sitio.
         *
         * No se enseña suelto: se enseña dentro del bloque que hay que pegar en
         * el formulario de esa IA, porque suelto obliga a saber en qué variable
         * va. Y con el aviso, que es parte de entregarlo — quien no lo copie
         * ahora tendrá que emitir otra.
         */
        born.innerHTML = '';
        const warn = document.createElement('p');
        warn.className = 'governing-note';
        warn.textContent =
          `«${made.label}» conectada, y escribe como ${made.participant}. Copia esto ahora: ` +
          'el secreto no se puede volver a leer.';
        const value = document.createElement('pre');
        value.className = 'connect-json';
        const code = document.createElement('code');
        code.textContent = connect?.publicMcp === null || connect?.publicMcp === undefined
          ? `VERA_URL=${connect?.url ?? 'http://127.0.0.1:4173'}\n` +
            `VERA_CLIENT=${made.client}\n` +
            `VERA_TOKEN=${made.secret}`
          : publicLaunch(connect.publicMcp, made.client, made.secret);
        value.append(code);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'connect-copy';
        copy.textContent = 'copiar';
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(code.textContent ?? '').then(() => {
            copy.textContent = 'copiado';
          });
        });
        born.append(warn, value, copy);
        notify(`${made.label} conectada`);
      })
      .catch((error: Error) => {
        go.disabled = false;
        notify(error.message);
      });
  });
}

async function credentialsSection(
  host: HTMLElement,
  notify: (message: string) => void,
): Promise<void> {
  const held = await api.credentials().catch(() => null);
  if (held === null) return;

  const table = section(host, {
    title: 'Credenciales',
    note:
      'Con qué llave entra cada máquina. Sin credencial se entra como el dueño, y lo ' +
      'que se lea queda anotado con tu nombre: emitirle una a cada conexión es lo que ' +
      'hace que el registro diga quién leyó de verdad.',
    headers: ['Etiqueta', 'Escribe como', 'Alcances', 'Cerco', 'Última vez', ''],
    // La etiqueta y el cerco son los que llevan frases; el resto son palabras
    // cortas y la última columna sólo un botón.
    widths: [22, 18, 14, 24, 12, 10],
  });

  for (const one of held) {
    const row = rowIn(table);
    let at = 0;
    observedCell(cellIn(row, at++), one.label);
    observedCell(cellIn(row, at++), one.participant);
    observedCell(cellIn(row, at++), one.scopes.join(', '));

    /*
     * El cerco, dicho por lo que concede y no por su nombre técnico.
     *
     * «sin cerco» no es un hueco: es un permiso mucho más ancho, y tiene que
     * leerse como tal. Una celda vacía ahí se leería como «todavía no
     * configurado», que es lo contrario de lo que pasa.
     */
    const fence = cellIn(row, at++);
    observedCell(
      fence,
      one.confinement === null
        ? 'escribe en todo'
        : one.confinement.source === null
          ? `sólo «${one.confinement.kind}»`
          : `sólo «${one.confinement.kind}» · ${one.confinement.source}`,
      one.confinement === null
        ? 'esta credencial no está cercada: escribe donde quiera, como una persona'
        : 'crea páginas de esa clase, escribe dentro de las suyas, y no borra',
    );

    observedCell(cellIn(row, at++), one.status === 'revoked' ? 'retirada' : when(one.lastUsedAt));

    const acts = cellIn(row, at++);
    if (one.status !== 'revoked') {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'connect-copy';
      drop.textContent = 'retirar';
      drop.title = 'Deja de valer al instante. Lo que ya escribió se queda.';
      drop.addEventListener('click', () => {
        void api
          .revokeCredential(one.id)
          .then(() => {
            notify(`${one.label} retirada`);
            drop.disabled = true;
            drop.textContent = 'retirada';
          })
          .catch((error: Error) => notify(error.message));
      });
      acts.append(drop);
    }
  }
}

/**
 * Lo que las máquinas pidieron que se fuera.
 *
 * @guarantee WhatWasMarkedIsFoundWithoutLookingForIt. Y @guarantee
 * BorrarSigueSiendoUnActoDeliberado: cada fila recibe una decisión explícita.
 * Aplicarlas juntas evita quince viajes y no convierte la lista en «borrar
 * todo»: lo que no se marcó no se toca.
 */
function markedSection(
  host: HTMLElement,
  door: { marked?: DiscardRequest[] },
  notify: (message: string) => void,
): void {
  const marked = door.marked ?? [];
  if (marked.length === 0) return;

  const wrapper = document.createElement('section');
  host.append(wrapper);
  const table = section(wrapper, {
    title: 'Pedidas para borrar',
    note:
      'Una credencial cercada no borra: marca, y dice por qué. Aquí decides tú. ' +
      'Marca «borrar» o «se queda» en cada fila y aplica las decisiones juntas. ' +
      'Lo que no marques no se toca.',
    headers: ['Página', 'Por qué', 'Quién lo pidió', 'Cuándo', ''],
    // El motivo es lo que se lee para decidir, así que se lleva la mitad.
    widths: [22, 40, 14, 10, 14],
  });

  const chosen = new Map<string, DiscardDecision['decision']>();
  const rows = new Map<string, HTMLTableRowElement>();
  const buttons: HTMLButtonElement[] = [];

  const actions = document.createElement('p');
  actions.className = 'discard-actions';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'connect-copy';
  apply.textContent = 'aplicar';
  apply.disabled = true;
  actions.append(apply);
  wrapper.append(actions);

  const updateApply = (): void => {
    apply.disabled = chosen.size === 0;
    apply.textContent = chosen.size === 0 ? 'aplicar' : `aplicar (${chosen.size})`;
  };

  for (const one of marked) {
    const row = rowIn(table);
    rows.set(one.page, row);
    let at = 0;

    // El título lleva a la página: decidir sobre algo que no se ha leído no es
    // decidir, y desde aquí tiene que costar un clic llegar a leerlo.
    const named = cellIn(row, at++);
    const open = document.createElement('a');
    open.href = `/p/${encodeURIComponent(one.title)}`;
    open.textContent = one.title;
    open.className = 'property-word';
    named.append(open);

    observedCell(cellIn(row, at++), one.reason);
    observedCell(cellIn(row, at++), one.byName ?? one.by ?? '—');
    observedCell(cellIn(row, at++), when(one.at));

    const acts = cellIn(row, at++);

    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'connect-copy';
    keep.textContent = 'se queda';
    keep.title = 'Quita la marca. La página no se toca.';

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'connect-copy';
    drop.textContent = 'borrar';
    drop.title = 'Deja una ausencia. Es lo único que el registro no puede enseñarte después.';

    const choose = (decision: DiscardDecision['decision']): void => {
      chosen.set(one.page, decision);
      keep.setAttribute('aria-pressed', String(decision === 'keep'));
      drop.setAttribute('aria-pressed', String(decision === 'delete'));
      updateApply();
    };
    keep.setAttribute('aria-pressed', 'false');
    drop.setAttribute('aria-pressed', 'false');
    keep.addEventListener('click', () => choose('keep'));
    drop.addEventListener('click', () => choose('delete'));

    acts.append(keep, drop);
    buttons.push(keep, drop);
  }

  apply.addEventListener('click', () => {
    const decisions = [...chosen].map(([page, decision]) => ({ page, decision }));
    const deleting = decisions.filter((one) => one.decision === 'delete').length;
    if (
      deleting > 0 &&
      !window.confirm(
        `¿Aplicar ${decisions.length} ${decisions.length === 1 ? 'decisión' : 'decisiones'}? ` +
          `Se ${deleting === 1 ? 'borrará una página' : `borrarán ${deleting} páginas`} y no se puede deshacer leyendo.`,
      )
    ) {
      return;
    }

    apply.disabled = true;
    for (const button of buttons) button.disabled = true;
    void api
      .applyDiscards(decisions)
      .then((result) => {
        for (const one of result.applied) {
          rows.get(one.page)?.remove();
          chosen.delete(one.page);
        }
        if (table.body.rows.length === 0) wrapper.remove();
        else {
          for (const button of buttons) button.disabled = false;
          updateApply();
        }
        notify(`${result.applied.length} ${result.applied.length === 1 ? 'decisión aplicada' : 'decisiones aplicadas'}`);
      })
      .catch((error: unknown) => {
        for (const button of buttons) button.disabled = false;
        updateApply();
        notify(error instanceof Error ? error.message : 'no se pudieron aplicar las decisiones');
      });
  });
}

export type { MCPConnection };
