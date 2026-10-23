// Lo que otra inteligencia puede hacer con esta memoria: leer y enviar cambios
// no destructivos por la misma puerta canónica que usa la interfaz.
//
// La descripción de cada herramienta dice qué hace, qué límites tiene y qué
// alcance necesita. No es cortesía: un modelo elige la herramienta leyendo su
// descripción, y una descripción vaga es una llamada mal hecha.
//
// Ver specs/mcp-server.allium.

import type { Failure, Health, Hit, Page, WhoAmI } from './client.ts';
import { failed } from './client.ts';

/** Preguntarle algo a Vera. Se inyecta para poder probar sin servidor. */
export type Ask = <T>(
  path: string,
  parameters?: Record<string, string | number | undefined>,
) => Promise<T | Failure>;

export type Query = <T>(input: {
  source: string;
  cursor: number;
  limit: number;
}) => Promise<T | Failure>;

export type Write = (
  origin: string,
  change: Record<string, unknown>,
  ifRevision?: string,
  ownOnly?: boolean,
) => Promise<{ status: 'applied' | 'duplicate'; sequence: number; subjectId: string } | Failure>;

export type WriteBatch = (
  origin: string,
  changes: readonly Record<string, unknown>[],
) => Promise<{
  status: 'applied' | 'duplicate';
  operations: { sequence: number; subjectId: string }[];
} | Failure>;

export interface VeraTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema en crudo: la forma que el protocolo pide, sin traductor. */
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  run(
    args: Record<string, unknown>,
    ask: Ask,
    write?: Write,
    writeBatch?: WriteBatch,
    query?: Query,
  ): Promise<string | ToolRunResult>;
}

export interface ToolRunResult {
  text: string;
  structured: Record<string, unknown>;
}

/**
 * Cuánto texto puede llevarse una llamada.
 *
 * Un tope existe porque una página del corpus tiene 189 bloques y hay contextos
 * que no la aguantan. Cuando corta, lo dice: un tope callado se lee como «esto
 * es todo lo que hay», que es la manera de que un modelo concluya de menos
 * creyendo que concluyó de todo.
 */
const MOST_CHARACTERS = 60_000;

const cut = (text: string, most = MOST_CHARACTERS): string =>
  text.length <= most
    ? text
    : `${text.slice(0, most)}\n\n[…cortado aquí: ${text.length - most} caracteres más. ` +
      'Pide la página por partes o busca dentro de ella.]';

const say = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown, fallback: number, most: number): number => {
  const asked = typeof value === 'number' ? value : Number(value ?? fallback);
  if (!Number.isFinite(asked)) return fallback;
  return Math.max(1, Math.min(most, Math.round(asked)));
};

const trouble = (what: Failure): string =>
  `No pude leer eso: ${what.error}${what.status > 0 ? ` (${what.status})` : ''}`;

function orderedOutline(blocks: readonly Page['blocks'][number][]): {
  block: Page['blocks'][number]; depth: number;
}[] {
  const children = new Map<string | null, Page['blocks'][number][]>();
  for (const block of blocks) {
    const kin = children.get(block.parent) ?? [];
    kin.push(block);
    children.set(block.parent, kin);
  }
  for (const kin of children.values()) kin.sort((a, b) => a.position - b.position);

  const ordered: { block: Page['blocks'][number]; depth: number }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const block of children.get(parent) ?? []) {
      ordered.push({ block, depth });
      walk(block.stableId, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

/** Los bloques de una página, con su sangría, en el orden en que se leen. */
export function outline(
  blocks: readonly Page['blocks'][number][],
  options: { identities?: boolean } = {},
): string {
  const explicitDepth = blocks.every((block) => block.depth !== undefined);
  const ordered = explicitDepth
    ? blocks.map((block) => ({ block, depth: block.depth ?? 0 }))
    : orderedOutline(blocks);
  return ordered.map(({ block, depth }) => {
    const pad = '  '.repeat(depth);
    // El texto de un bloque puede tener saltos —un dibujo, un bloque de
    // código— y todos se sangran igual, o la sangría deja de decir de quién
    // es hijo qué.
    const revision = block.revision === undefined || block.revision === null ? '' : ` @ ${block.revision}`;
    const identity = options.identities === true ? `[${block.stableId}${revision}] ` : '';
    return block.content.split('\n').map((line, index) =>
      `${pad}- ${index === 0 ? identity : ''}${line}`,
    ).join('\n');
  }).join('\n');
}

const when = (at: number | null | undefined): string =>
  at === null || at === undefined ? 'nunca' : new Date(at).toISOString().slice(0, 16).replace('T', ' ');

export const TOOLS: readonly VeraTool[] = [
  {
    name: 'vera_quien_soy',
    title: 'Quién soy en esta memoria',
    description:
      'Comprueba la conexión con Vera y dice con qué identidad se entró, qué alcances ' +
      'tiene la credencial y de qué tamaño es el corpus. Es la primera llamada de una ' +
      'conexión: si ésta falla, ninguna otra va a funcionar. No expone contenido.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ask) {
      const who = await ask<WhoAmI>('/agents/whoami');
      if (failed(who)) return trouble(who);
      const health = await ask<Health>('/health');
      const size = failed(health)
        ? ''
        : `\nCorpus «${health.graph}»: ${health.pages} páginas, ${health.blocks} bloques, ` +
          `${health.lastSequence} operaciones.`;
      return (
        `Conectado a Vera.\n` +
        `Participante: ${who.participant}${who.kind === null ? '' : ` (${who.kind})`}\n` +
        `Credencial: ${who.label ?? 'sin credencial: se entró como el dueño'}\n` +
        `Alcances: ${who.scopes === null ? 'todos, por ser el dueño' : who.scopes.join(', ')}` +
        size +
        `\nEsta puerta puede escribir cuando la credencial tiene alcance write; no ofrece borrado.`
      );
    },
  },

  {
    name: 'vera_buscar',
    title: 'Buscar en la memoria',
    description:
      'Busca texto en todo el corpus y devuelve extractos con la página y el bloque de ' +
      'donde salió cada uno, para poder citarlos. Es la forma de entrar cuando no se sabe ' +
      'en qué página está algo. Devuelve extractos, no páginas enteras: para leer una ' +
      'entera, usa vera_leer_pagina con el título que aparezca aquí.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar. Palabras sueltas o una frase.' },
        cuantos: {
          type: 'integer',
          description: 'Cuántos extractos devolver, hasta 50. Por omisión 12.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
    async run(args, ask) {
      const asked = say(args.consulta).trim();
      if (asked === '') return 'Dime qué buscar.';
      const hits = await ask<Hit[]>('/search', { q: asked });
      if (failed(hits)) return trouble(hits);
      if (hits.length === 0) return `Nada en el corpus dice «${asked}».`;
      const most = count(args.cuantos, 12, 50);
      const shown = hits.slice(0, most);
      const lines = shown.map(
        (hit) =>
          `${hit.rank}. [${hit.page}]${hit.block === null ? '' : ` bloque ${hit.block}`} · ${hit.field}\n` +
          `   ${hit.excerpt}`,
      );
      const more = hits.length > shown.length ? `\n\n(${hits.length - shown.length} más sin mostrar.)` : '';
      return cut(`${hits.length} coincidencias con «${asked}»:\n\n${lines.join('\n')}${more}`);
    },
  },

  {
    name: 'vera_consultar',
    title: 'Consultar la estructura del grafo',
    description:
      'Ejecuta el lenguaje estructurado de Vera sobre propiedades, enlaces y contenido. ' +
      'Úsalo cuando la pregunta tenga condiciones precisas, por ejemplo `? tipo=proyecto + ' +
      'concepto=accesibilidad ; tabla` o `? ~notarización ; bloques`. Devuelve resultados ' +
      'estructurados, conteo total y cursor; no guarda la consulta ni modifica el corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        consulta: {
          type: 'string',
          description: 'Consulta compacta completa, comenzando por `?` y con vista opcional tras `;`.',
        },
        cursor: { type: 'integer', description: 'Desplazamiento del tramo. Por omisión 0.', minimum: 0 },
        cuantos: {
          type: 'integer',
          description: 'Resultados por tramo, de 1 a 100. Por omisión 30.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        view: { type: 'string' },
        asked: { type: 'string' },
        count: { type: 'integer' },
        cursor: { type: 'integer' },
        limit: { type: 'integer' },
        nextCursor: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        more: { type: 'integer' },
        pages: { type: 'array', items: { type: 'object', additionalProperties: true } },
        blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: true,
    },
    async run(args, _ask, _write, _writeBatch, query) {
      const source = say(args.consulta).trim();
      if (source === '') return 'Dime qué consulta estructurada ejecutar.';
      if (query === undefined) return 'Esta conexión MCP no habilitó la puerta de consultas estructuradas.';
      const cursor = args.cursor === undefined ? 0 : Math.max(0, Math.floor(Number(args.cursor) || 0));
      const limit = count(args.cuantos, 30, 100);
      const result = await query<Record<string, unknown>>({ source, cursor, limit });
      if (failed(result)) return trouble(result);
      if (typeof result.error === 'string') {
        return `Vera no entendió la consulta: ${result.error}`;
      }
      const view = say(result.view);
      const total = typeof result.count === 'number' ? result.count : 0;
      const next = typeof result.nextCursor === 'number' ? result.nextCursor : null;
      const rows = view === 'blocks'
        ? (Array.isArray(result.blocks) ? result.blocks : [])
        : (Array.isArray(result.pages) ? result.pages : []);
      const lines = rows.map((row) => JSON.stringify(row));
      return {
        text:
          `${total} resultados para ${say(result.asked) || source}; ` +
          `${rows.length} en este tramo${next === null ? '.' : `; cursor_siguiente: ${next}.`}\n\n` +
          lines.join('\n'),
        structured: result,
      };
    },
  },

  {
    name: 'vera_leer_pagina',
    title: 'Leer una página por tramos',
    description:
      'Devuelve un tramo paginado de una página: sus propiedades y bloques con sangría, identidad ' +
      'estable y revisión en el orden de lectura, y quién escribió cada uno cuando no fue el dueño. ' +
      'Opcionalmente añade a qué páginas apunta y qué páginas apuntan a ella. ' +
      'Acepta el título o el identificador. Usa `cursor_siguiente` para ' +
      'continuar sin volver a recibir el comienzo; `desde_bloque` limita la lectura a un subárbol.',
    inputSchema: {
      type: 'object',
      properties: {
        pagina: {
          type: 'string',
          description: 'Título exacto de la página, o su identificador (page:1234).',
        },
        con_vecinos: {
          type: 'boolean',
          description: 'Añadir la lista de páginas enlazadas y de las que la enlazan. Por omisión no.',
        },
        desde_bloque: {
          type: 'string',
          description: 'Bloque raíz cuyo subárbol leer. Ausente lee la página entera por tramos.',
        },
        cursor: {
          type: 'integer',
          description: 'Desplazamiento del siguiente tramo. Por omisión 0.',
          minimum: 0,
        },
        cuantos: {
          type: 'integer',
          description: 'Bloques por tramo, de 1 a 200. Por omisión 80.',
          minimum: 1,
          maximum: 200,
        },
      },
      required: ['pagina'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        error: { type: 'string' },
        page: { type: 'object', additionalProperties: true },
        window: { type: 'object', additionalProperties: true },
        blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: false,
    },
    async run(args, ask) {
      const named = say(args.pagina).trim();
      if (named === '') return 'Dime qué página.';
      const safeCursor = args.cursor === undefined ? 0 : Math.max(0, Number(args.cursor) || 0);
      const most = count(args.cuantos, 80, 200);
      const page = await ask<Page>(`/pages/${encodeURIComponent(named)}`, {
        stage: args.con_vecinos === true ? undefined : 'readable',
        root: say(args.desde_bloque).trim() || undefined,
        cursor: safeCursor,
        limit: most,
      });
      if (failed(page)) {
        return page.status === 404
          ? `No hay ninguna página que se llame «${named}». Prueba con vera_buscar.`
          : trouble(page);
      }

      const properties = page.properties.map((one) => `${one.key}:: ${one.value}`).join('\n');
      /*
       * Qué bloques no escribió el dueño.
       *
       * Va en la lectura y no en una llamada aparte porque distinguir lo escrito
       * de lo generado tiene que costar lo mismo que leer, o no se hará: una
       * inteligencia que resume esta página tiene que poder decir qué parte la
       * escribió otra inteligencia. @invariant GeneratedContentIsAlwaysDistinguishable.
       */
      const others = orderedOutline(page.blocks)
        .map(({ block }) => [block.stableId, page.authorship[block.stableId]] as const)
        .filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => entry[1]?.kind === 'agent')
        .map(([id, hand]) => `${id} · ${hand.participant ?? '?'}`);

      const parts = [
        `# ${page.title}`,
        `(${page.id} · ${page.visibility} · última edición ${when(page.lastEditedAt)})`,
        properties === '' ? '' : `\n${properties}`,
        `\n${outline(page.blocks, { identities: true })}`,
      ];

      if (others.length > 0) {
        parts.push(`\n## Escrito por agentes\n${others.join('\n')}`);
      }

      if (args.con_vecinos === true) {
        const out = page.references.map(
          (one) => `→ ${one.title}${one.page === null ? ' (aún sin escribir)' : ''}`,
        );
        const back = page.backlinks.map((one) => `← ${one.title}: ${one.excerpt}`);
        if (out.length > 0 || back.length > 0) {
          parts.push(`\n## Vecindad\n${[...out, ...back].join('\n')}`);
        }
      }

      const window = page.window ?? {
        root: null,
        cursor: safeCursor,
        limit: page.blocks.length,
        total: page.blocks.length,
        nextCursor: null,
      };
      parts.push(
        `\n## Tramo\n${page.blocks.length} de ${window.total} bloques; cursor ${window.cursor}; ` +
        (window.nextCursor === null ? 'lectura completa.' : `cursor_siguiente: ${window.nextCursor}.`),
      );
      return {
        text: cut(parts.filter((one) => one !== '').join('\n')),
        structured: {
          page: {
            id: page.id,
            title: page.title,
            visibility: page.visibility,
            lastEditedAt: page.lastEditedAt,
            properties: page.properties,
          },
          window,
          blocks: page.blocks.map((block) => ({
            ...block,
            authorship: page.authorship[block.stableId] ?? null,
          })),
        },
      };
    },
  },

  {
    name: 'vera_historia_bloque',
    title: 'La historia de un bloque',
    description:
      'Todo lo que un bloque dijo alguna vez, en orden, con quién lo escribió y por qué vía ' +
      '—tecleado, dictado, generado por un agente, importado—. Sirve para saber cómo llegó ' +
      'una idea a su forma actual, y para ver texto que ya no está en la página. Incluye ' +
      'estados borrados: el registro de Vera no olvida.',
    inputSchema: {
      type: 'object',
      properties: {
        bloque: { type: 'string', description: 'El identificador del bloque (block:1234).' },
      },
      required: ['bloque'],
      additionalProperties: false,
    },
    async run(args, ask) {
      const id = say(args.bloque).trim();
      if (id === '') return 'Dime qué bloque.';
      const history = await ask<{
        block: string;
        alive: boolean;
        now: string | null;
        states: { sequence: number; at: number; by: string; channel: string; what: string; content: string | null }[];
      }>(`/blocks/${encodeURIComponent(id)}/history`);
      if (failed(history)) return trouble(history);
      if (history.states.length === 0) return `No hay historia de ${id}: puede que no exista.`;
      const lines = history.states.map(
        (state) =>
          `${when(state.at)} · ${state.by} · ${state.channel} · ${state.what}` +
          (state.content === null ? '' : `\n    ${state.content.split('\n').join('\n    ')}`),
      );
      return cut(
        `${id} ${history.alive ? 'sigue vivo' : 'está borrado'}, ${history.states.length} estados:\n\n` +
          lines.join('\n\n'),
      );
    },
  },

  {
    name: 'vera_vecindario',
    title: 'Qué hay alrededor de una página',
    description:
      'Las páginas conectadas con una, hasta la profundidad que se pida, con la distancia y ' +
      'cuántas conexiones tiene cada una. Es el mapa, no el texto: sirve para decidir qué ' +
      'leer después. Profundidad 2 basta casi siempre; 4 devuelve medio corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        pagina: { type: 'string', description: 'Título o identificador del centro.' },
        profundidad: {
          type: 'integer',
          description: 'Cuántos saltos alrededor, de 1 a 4. Por omisión 2.',
          minimum: 1,
          maximum: 4,
        },
      },
      required: ['pagina'],
      additionalProperties: false,
    },
    async run(args, ask) {
      const named = say(args.pagina).trim();
      if (named === '') return 'Dime desde qué página.';
      const depth = count(args.profundidad, 2, 4);
      const hood = await ask<{ nodes: { id: string; title: string; distance: number; degree: number }[] }>(
        `/graph/${encodeURIComponent(named)}`,
        { depth },
      );
      if (failed(hood)) return trouble(hood);
      const near = [...hood.nodes].sort((a, b) => a.distance - b.distance || b.degree - a.degree);
      return cut(
        `${near.length} páginas a ${depth} saltos de «${named}»:\n\n` +
          near
            .map((node) => `${'·'.repeat(node.distance)} ${node.title} (${node.degree} conexiones)`)
            .join('\n'),
      );
    },
  },

  {
    name: 'vera_indice',
    title: 'El índice de páginas',
    description:
      'Todos los títulos del corpus, con cuántos bloques y cuántas conexiones tiene cada ' +
      'página. Opcionalmente sólo los que contengan un texto. Es lo que se pide para ' +
      'orientarse cuando no se sabe qué hay; para encontrar algo concreto es mejor vera_buscar.',
    inputSchema: {
      type: 'object',
      properties: {
        contiene: { type: 'string', description: 'Filtrar por títulos que contengan esto.' },
        cuantos: { type: 'integer', description: 'Hasta cuántos títulos. Por omisión 100.', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    async run(args, ask) {
      const pages = await ask<{ id: string; title: string; blockCount: number; linkCount: number }[]>(
        '/pages',
      );
      if (failed(pages)) return trouble(pages);
      const asked = say(args.contiene).trim().toLowerCase();
      const found =
        asked === '' ? pages : pages.filter((page) => page.title.toLowerCase().includes(asked));
      const most = count(args.cuantos, 100, 500);
      const shown = [...found].sort((a, b) => b.linkCount - a.linkCount).slice(0, most);
      const more = found.length > shown.length ? `\n\n(${found.length - shown.length} más sin mostrar.)` : '';
      return cut(
        `${found.length} páginas${asked === '' ? '' : ` con «${asked}» en el título`}:\n\n` +
          shown
            .map((page) => `${page.title} — ${page.blockCount} bloques, ${page.linkCount} conexiones`)
            .join('\n') +
          more,
      );
    },
  },

  {
    name: 'vera_preparar_escritura',
    title: 'Preparar una escritura correcta',
    description:
      'Lee juntas las reglas vivas para agentes y la ontología vigente del corpus. Debe usarse ' +
      'antes de crear o conectar páginas: evita copiar convenciones antiguas, inventar propiedades ' +
      'o confundir frontmatter, bloques, jerarquía y enlaces. Devuelve un paquete compacto con ' +
      'presupuesto explícito; no modifica nada.',
    inputSchema: {
      type: 'object',
      properties: {
        presupuesto_caracteres: {
          type: 'integer',
          description: 'Máximo aproximado del paquete, entre 4000 y 30000. Por omisión 12000.',
          minimum: 4000,
          maximum: 30000,
        },
      },
      additionalProperties: false,
    },
    async run(args, ask) {
      const guideTitle = 'VERA — Escritura por agentes';
      const budget = Math.max(4_000, count(args.presupuesto_caracteres, 12_000, 30_000));
      const [guide, ontology] = await Promise.all([
        ask<Page>(`/pages/${encodeURIComponent(guideTitle)}`, { stage: 'readable', cursor: 0, limit: 60 }),
        ask<unknown>('/ontology'),
      ]);
      if (failed(ontology)) return trouble(ontology);

      const live = failed(guide)
        ? `La guía viva «${guideTitle}» todavía no existe. Rigen estas reglas mínimas:\n` +
          '- el frontmatter se escribe con set_property;\n' +
          '- cada unidad semántica ocupa un bloque;\n' +
          '- la jerarquía se expresa con parent;\n' +
          '- las conexiones se escriben como enlaces [[Página]].'
        : `# ${guide.title}\n\n${outline(guide.blocks)}`;

      return cut(
        `${live}\n\n# Ontología vigente\n\n${JSON.stringify(ontology, null, 2)}`,
        budget,
      );
    },
  },

  {
    name: 'vera_escribir',
    title: 'Escribir un cambio en Vera',
    readOnly: false,
    description:
      'Aplica exactamente un cambio no destructivo mediante POST /operations. Todo queda en el ' +
      'registro canónico con la identidad de la credencial y canal agent_generation. Antes de ' +
      'añadir, lee la página para usar su identificador y calcular la posición final. `origen` es una ' +
      'clave estable de idempotencia: reutiliza la misma al reintentar el mismo cambio y usa otra ' +
      'para un cambio distinto. Crea páginas y bloques, y escribe propiedades reales de página o bloque ' +
      'con set_property; remove_property retira una propiedad obsoleta ya leída. El frontmatter nunca ' +
      'va en el contenido de un bloque. No edita, mueve ni borra páginas o bloques.',
    inputSchema: {
      type: 'object',
      properties: {
        origen: {
          type: 'string',
          description: 'Identificador único y estable del cambio, por ejemplo codex:sesion:tarea:1.',
          minLength: 1,
        },
        cambio: {
          type: 'object',
          description:
            'Una operación canónica: create_page, create_block, set_property o remove_property.',
          properties: {
            kind: {
              type: 'string',
              enum: ['create_page', 'create_block', 'set_property', 'remove_property'],
            },
            title: { type: 'string' },
            visibility: { type: 'string', enum: ['private', 'public'] },
            page: { type: 'string', description: 'Identificador page:... cuando la operación lo requiere.' },
            block: { type: 'string', description: 'Identificador block:... cuando la operación lo requiere.' },
            parent: { type: ['string', 'null'], description: 'Padre block:... o null para un bloque raíz.' },
            position: { type: 'integer', minimum: 0 },
            content: { type: 'string' },
            propertyKey: { type: 'string' },
            propertyValue: { type: 'string' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      required: ['origen', 'cambio'],
      additionalProperties: false,
    },
    async run(args, _ask, write) {
      const origin = say(args.origen).trim();
      if (origin === '') return 'Falta `origen`: una clave estable para reintentar sin duplicar.';
      if (write === undefined) return 'Esta conexión MCP no habilitó la puerta de escritura.';
      if (typeof args.cambio !== 'object' || args.cambio === null || Array.isArray(args.cambio)) {
        return 'Falta `cambio`: debe ser una operación canónica.';
      }
      const change = args.cambio as Record<string, unknown>;
      if (
        change.kind !== 'create_page' &&
        change.kind !== 'create_block' &&
        change.kind !== 'set_property' &&
        change.kind !== 'remove_property'
      ) {
        return 'Ese cambio no está disponible por MCP: esta puerta sólo crea páginas y bloques o corrige propiedades.';
      }
      const result = await write(origin, change);
      if (failed(result)) return `No pude escribir eso: ${result.error}${result.status > 0 ? ` (${result.status})` : ''}`;
      return (
        `${result.status === 'duplicate' ? 'Ese cambio ya estaba aplicado' : 'Cambio aplicado'}: ` +
        `${result.subjectId}, operación ${result.sequence}.`
      );
    },
  },

  {
    name: 'vera_editar_bloque_propio',
    title: 'Corregir un bloque propio sin pisar cambios',
    readOnly: false,
    description:
      'Reescribe el texto de un bloque cuya autoría vigente pertenece a esta identidad agente. ' +
      'Exige la revisión exacta entregada por vera_leer_pagina; si el bloque cambió, devuelve ' +
      'conflicto y el estado actual sin aplicar nada. No permite editar palabras ajenas, mover ' +
      'el bloque ni borrarlo. Cada corrección usa una clave de origen idempotente.',
    inputSchema: {
      type: 'object',
      properties: {
        origen: {
          type: 'string',
          description: 'Identificador único y estable de esta corrección.',
          minLength: 1,
        },
        bloque: { type: 'string', description: 'Identificador estable block:...' },
        revision: {
          type: 'string',
          description: 'Revisión @ op:... recibida al leer el bloque.',
          minLength: 1,
        },
        contenido: { type: 'string', description: 'Texto completo que reemplazará el contenido actual.' },
      },
      required: ['origen', 'bloque', 'revision', 'contenido'],
      additionalProperties: false,
    },
    async run(args, _ask, write) {
      const origin = say(args.origen).trim();
      const block = say(args.bloque).trim();
      const revision = say(args.revision).trim();
      if (origin === '' || block === '' || revision === '' || typeof args.contenido !== 'string') {
        return 'La corrección necesita origen, bloque, revision y contenido completo.';
      }
      if (write === undefined) return 'Esta conexión MCP no habilitó la puerta de escritura.';
      const result = await write(
        origin,
        { kind: 'edit_block', block, content: args.contenido },
        revision,
        true,
      );
      if (failed(result)) {
        return `No pude corregir ese bloque: ${result.error}${result.status > 0 ? ` (${result.status})` : ''}`;
      }
      return (
        `${result.status === 'duplicate' ? 'Esa corrección ya estaba aplicada' : 'Bloque corregido'}: ` +
        `${result.subjectId}, operación ${result.sequence}. Vuelve a leerlo antes de otra corrección.`
      );
    },
  },

  {
    name: 'vera_escribir_lote',
    title: 'Escribir muchos cambios de una vez',
    readOnly: false,
    description:
      'Aplica entre 1 y 1000 cambios no destructivos en una sola llamada y una sola transacción: ' +
      'o se aceptan todos o no se aplica ninguno. Cada cambio conserva su operación, secuencia, ' +
      'autoría y procedencia. Para crear una página con su outline sin esperar respuestas intermedias, ' +
      'asigna stableId a create_page y create_block y usa esas mismas identidades en page y parent. ' +
      'Reutilizar origen reintenta el lote entero sin duplicarlo. No edita, mueve ni borra contenido.',
    inputSchema: {
      type: 'object',
      properties: {
        origen: {
          type: 'string',
          minLength: 1,
          description: 'Clave estable de idempotencia para el lote completo.',
        },
        cambios: {
          type: 'array',
          minItems: 1,
          maxItems: 1000,
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['create_page', 'create_block', 'set_property', 'remove_property'] },
              title: { type: 'string' },
              visibility: { type: 'string', enum: ['private', 'public'] },
              stableId: { type: 'string', description: 'Identidad nueva elegida por el cliente; page:… o block:…' },
              page: { type: 'string' },
              block: { type: 'string' },
              parent: { type: ['string', 'null'] },
              position: { type: 'integer', minimum: 0 },
              content: { type: 'string' },
              propertyKey: { type: 'string' },
              propertyValue: { type: 'string' },
            },
            required: ['kind'],
            additionalProperties: false,
          },
        },
      },
      required: ['origen', 'cambios'],
      additionalProperties: false,
    },
    async run(args, _ask, _write, writeBatch) {
      const origin = say(args.origen).trim();
      if (origin === '') return 'Falta `origen`: una clave estable para reintentar el lote sin duplicarlo.';
      if (!Array.isArray(args.cambios) || args.cambios.length === 0) return 'Falta `cambios`: debe ser una lista no vacía.';
      if (writeBatch === undefined) return 'Esta conexión MCP no habilitó la escritura por lotes.';
      const changes = args.cambios as Record<string, unknown>[];
      const allowed = new Set(['create_page', 'create_block', 'set_property', 'remove_property']);
      if (changes.some((change) => !allowed.has(String(change.kind)))) {
        return 'El lote sólo admite crear páginas y bloques o escribir y retirar propiedades.';
      }
      const result = await writeBatch(origin, changes);
      if (failed(result)) return `No pude escribir el lote: ${result.error}${result.status > 0 ? ` (${result.status})` : ''}`;
      const first = result.operations[0]?.sequence;
      const last = result.operations.at(-1)?.sequence;
      return `${result.status === 'duplicate' ? 'Ese lote ya estaba aplicado' : 'Lote aplicado'}: ` +
        `${result.operations.length} cambios${first === undefined ? '' : `, operaciones ${first}–${last}`}.`;
    },
  },

  {
    name: 'vera_ontologia',
    title: 'El vocabulario del corpus',
    description:
      'Cómo está clasificada esta memoria: qué clases de objeto existen, qué propiedades las ' +
      'constituyen y qué tipo de campo es cada propiedad. Es lo que hay que leer antes de ' +
      'interpretar las propiedades de una página, porque el vocabulario lo gobierna el dueño ' +
      'y no está fijado en el programa.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, ask) {
      const ontology = await ask<unknown>('/ontology');
      if (failed(ontology)) return trouble(ontology);
      return cut(JSON.stringify(ontology, null, 2));
    },
  },
];

export const toolNamed = (name: string): VeraTool | undefined =>
  TOOLS.find((tool) => tool.name === name);
