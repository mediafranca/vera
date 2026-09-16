// Las conexiones externas, gobernadas desde una sola página.
//
// Una sola página y no una por cliente. Zotero es una conexión saliente —Vera
// sale a buscar, con su secreto, su biblioteca y sus colecciones— y cada
// servicio saliente es distinto del siguiente: ahí una página por servicio es lo
// correcto. MCP es la dirección contraria: una puerta y muchos que entran por
// ella. Claude Code, Codex, Gemini y el bibliotecario no son cuatro servicios sino cuatro
// visitantes de la misma puerta, y lo único que los distingue es quién son, qué
// se les permite y qué se llevaron. Cuatro páginas serían cuatro copias de los
// mismos tres campos.
//
//     VERA: Conexiones
//       special-kind:: connections
//       etapa:: M1 — sólo lectura
//
//     ## Conexiones
//     - Claude Code
//         cliente:: claude-code
//         participante:: participant:herbert
//         permiso:: leer
//
// Un bloque que lleve `cliente::` declara una conexión, igual que en «Objetos»
// declara el que lleva propiedades colgando. Lo demás de la página es prosa y se
// lee y se edita como en cualquier otra.
//
// Lo que la página declara es lo que se decidió. Lo que Vera observó —desde
// cuándo lee, cuántas entregas se llevó, con qué identidad entró de verdad— no se
// escribe en la página: se deriva del registro de exposición y viaja al lado. Es
// la misma decisión que con la fecha de creación de una página, y por la misma
// razón: dos sitios diciendo lo mismo acaban diciendo cosas distintas.
//
// Y es donde se ve el agujero. Hoy tres de las cuatro conexiones leen como el
// dueño porque entran sin credencial: la columna declarada dice una cosa y la
// observada dice otra, en la misma fila.
//
// Ver specs/mcp-server.allium.

import type { VeraGraph } from '@vera/core';
import type { SeenClient } from '@vera/store/exposures';

/** El valor de `special-kind` que hace de una página la rectora de conexiones. */
export const CONNECTIONS_KIND = 'connections';

/** La clave con que un bloque declara ser una conexión. */
export const CLIENT_KEY = 'cliente';

export interface Connection {
  /** El bloque del que sale, para que la tabla escriba donde estaba escrito. */
  block: string;
  /** Cómo se llama la conexión, en cristiano. Es el texto del bloque. */
  name: string;
  /** Cómo se declara el cliente. Es lo que Vera compara con lo que llega. */
  client: string;
  /** Con qué identidad debería entrar. */
  participant: string | null;
  /** Y cómo se llama esa identidad, para no poner un identificador en la tabla. */
  participantName: string | null;
  /** Qué se le concede, dicho por quien manda. */
  permission: string | null;
  says: string | null;
  /** Y lo que el registro de exposición vio de ella. */
  seen: SeenNamed | null;
}

/** Lo observado, con los participantes ya nombrados. */
export interface SeenNamed extends SeenClient {
  name: string;
}

export interface MCPPage {
  id: string;
  title: string;
  stage: string | null;
  connections: Connection[];
  /**
   * Lo que entró y no está declarado.
   *
   * Un cliente que lee sin tener fila es lo que hay que ver primero, y una
   * página que sólo enseñara lo declarado lo escondería justamente por no estar
   * declarado.
   */
  undeclared: SeenNamed[];
}

const valueOf = (
  properties: readonly { key: string; value: string }[],
  key: string,
): string | null => {
  const found = properties.find((one) => one.key.trim().toLowerCase() === key);
  return found === undefined || found.value.trim() === '' ? null : found.value.trim();
};

/**
 * Cómo se comparan dos nombres de cliente.
 *
 * Sin distinguir mayúsculas ni espacios de sobra, porque quien escribe «Claude
 * Code» en la página y quien manda `claude-code` en la cabecera está hablando de
 * lo mismo, y una fila que no casa por una mayúscula se lee como una conexión que
 * nunca ha leído nada.
 */
const same = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** La página de la puerta, si está escrita, con lo declarado y lo observado. */
export function connectionsPage(
  graph: VeraGraph,
  specialKey: string,
  raw: readonly SeenClient[],
): MCPPage | null {
  const page = graph
    .pages()
    .find(
      (one) =>
        valueOf(graph.propertiesOf(one.id), specialKey)?.toLowerCase() === CONNECTIONS_KIND,
    );
  if (page === undefined) return null;

  /*
   * Los participantes, nombrados.
   *
   * `participant:herbert` en una celda de tabla es un identificador donde hacía
   * falta un nombre: ocupa el doble y se lee la mitad de rápido. El
   * identificador sigue siendo lo que se declara y lo que se compara; lo que
   * cambia es lo que se enseña.
   */
  const named = (id: string): string => graph.participant(id)?.name ?? id;
  const seen: SeenNamed[] = raw.map((one) => ({ ...one, name: named(one.participant) }));

  const taken = new Set<SeenNamed>();
  const connections: Connection[] = [];

  for (const block of graph.blocksOf(page.id)) {
    const properties = graph.propertiesOf(block.stableId);
    const client = valueOf(properties, CLIENT_KEY);
    if (client === null) continue;

    /*
     * De todo lo que ese cliente hizo, la conexión se queda con lo último.
     *
     * Un mismo cliente puede aparecer con dos identidades —leyó sin credencial
     * un rato y con ella después—, y lo que la fila tiene que enseñar es cómo
     * está entrando ahora, no la primera vez que entró.
     */
    const mine = seen.filter((one) => same(one.client, client));
    for (const one of mine) taken.add(one);
    const latest = mine.reduce<SeenNamed | null>(
      (best, one) => (best === null || one.lastAt > best.lastAt ? one : best),
      null,
    );

    connections.push({
      block: block.stableId,
      name: block.content.split('\n')[0]?.trim() ?? client,
      client,
      participant: valueOf(properties, 'participante'),
      participantName: (() => {
        const said = valueOf(properties, 'participante');
        return said === null ? null : named(said);
      })(),
      permission: valueOf(properties, 'permiso'),
      says: valueOf(properties, 'qué'),
      seen: latest,
    });
  }

  return {
    id: page.id,
    title: page.title,
    stage: valueOf(graph.propertiesOf(page.id), 'etapa'),
    connections,
    undeclared: seen.filter((one) => !taken.has(one)),
  };
}
