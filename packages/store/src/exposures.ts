// El registro compacto de exposición: que algo salió de la memoria, hacia
// dónde, por qué superficie y cuánto contexto ocupó.
//
// El log de operaciones cuenta lo que se escribió, y eso bastaba mientras todo
// el que entraba escribía. Una inteligencia artificial hace algo que el log no
// ve: recibe. Se lleva páginas, extractos y contexto sin modificar una coma, y
// de eso no quedaba rastro. El bibliotecario lleva 6.844 operaciones escritas y cero
// lecturas registradas, y no porque no haya leído.
//
// Vive en la API y no en el adaptador MCP, y la diferencia es la que decide si
// esto sirve para algo: puesto en MCP, el mayor lector del corpus —un agente
// que entra por HTTP directo, como el bibliotecario hoy— quedaría fuera del registro, y
// un registro con un agujero del tamaño de su lector principal es decorativo.
// Aquí lo hereda toda puerta: la web, MCP, curl y lo que venga después.
//
// No se repite una fila por cada bloque entregado: esa materialización llegó a
// pesar más que el corpus. El bibliotecario necesita magnitudes agregables para
// cuidar la puerta, no una segunda estructura del grafo.
// Ver specs/mcp-server.allium, contrato WhatWasReadIsRecorded.

import type { Store } from './store.ts';

export interface Exposure {
  /** Quién se lo llevó. Sale de la credencial, nunca de lo que diga quien pide. */
  participant: string;
  /** Con qué credencial, para poder revocar sabiendo qué se revoca. */
  credential?: string | null;
  /** Qué cliente dijo ser. Se registra y no se cree. */
  client?: string | null;
  /** Por dónde entró: la ruta o la herramienta. */
  surface: string;
  /** Qué pidió, dicho como lo pidió. */
  subject: string;
  /** Qué se le entregó: identidades estables de páginas y bloques. */
  delivered?: readonly string[];
  /** Cómo acabó: `served`, `refused`, `empty`. */
  outcome?: string;
  /** Cuánto viajó, en caracteres. */
  volume?: number;
  at: number;
}

export interface RecordedExposure extends Exposure {
  id: string;
  /** Cuántas identidades distintas viajaron; no sus copias. */
  deliveredCount: number;
  outcome: string;
  volume: number;
}

let counter = 0;

/**
 * Anota una entrega.
 *
 * @invariant NoDeliveryWithoutItsRecord. Se llama antes de responder y no
 * después: una anotación que ocurre después de que el texto salió por el cable
 * es una anotación que un proceso caído convierte en lectura invisible.
 *
 * Lo que no se guarda es la respuesta ni un índice por cada bloque. Copiar el
 * texto o su estructura dejaría una segunda versión del corpus dentro del
 * registro que existe para vigilarlo. Se guarda la consulta, cuántas identidades
 * distintas viajaron y cuánto medía la respuesta.
 */
export function recordExposure(store: Store, exposure: Exposure): string {
  counter += 1;
  const id = `exposure:${exposure.at.toString(36)}:${counter.toString(36)}`;
  const delivered = [...new Set(exposure.delivered ?? [])];
  store.db
    .prepare(
      `INSERT INTO exposures
         (id, graph_id, participant_id, credential_id, client, surface, subject,
          outcome, volume, delivered_count, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      store.graphId,
      exposure.participant,
      exposure.credential ?? null,
      exposure.client ?? null,
      exposure.surface,
      exposure.subject,
      exposure.outcome ?? 'served',
      Math.max(0, Math.round(exposure.volume ?? 0)),
      delivered.length,
      exposure.at,
    );
  return id;
}

interface Row {
  id: string;
  participant_id: string;
  credential_id: string | null;
  client: string | null;
  surface: string;
  subject: string;
  outcome: string;
  volume: number;
  delivered_count: number;
  at: number;
}

const shape = (row: Row): RecordedExposure => ({
  id: row.id,
  participant: row.participant_id,
  credential: row.credential_id,
  client: row.client,
  surface: row.surface,
  subject: row.subject,
  outcome: row.outcome,
  volume: row.volume,
  deliveredCount: row.delivered_count,
  at: row.at,
});

/**
 * Lo que se ha llevado alguien, o todo el mundo, empezando por lo último.
 *
 * Esto es la mitad que le faltaba a la página de participantes: hasta ahora se
 * podía ver qué había escrito un agente y no qué se había llevado.
 */
export function exposuresOf(
  store: Store,
  options: { participant?: string | undefined; since?: number | undefined; most?: number | undefined } = {},
): RecordedExposure[] {
  const most = Math.max(1, Math.min(1000, options.most ?? 100));
  const rows = store.db
    .prepare(
      `SELECT * FROM exposures
        WHERE graph_id = ?
          AND (? IS NULL OR participant_id = ?)
          AND at >= ?
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
    )
    .all(
      store.graphId,
      options.participant ?? null,
      options.participant ?? null,
      options.since ?? 0,
      most,
    ) as unknown as Row[];
  return rows.map(shape);
}

export interface SeenClient {
  /** Cómo se declaró. Nulo cuando no dijo nada. */
  client: string | null;
  participant: string;
  /** Cuántas entregas, y cuánto midieron en total. */
  deliveries: number;
  volume: number;
  /** Cuántas páginas o bloques distintos sumaron esas respuestas. */
  deliveredCount: number;
  firstAt: number;
  lastAt: number;
}

/**
 * Quién ha estado leyendo, agrupado por cómo se declaró.
 *
 * Es lo que la página de la puerta MCP pone al lado de cada conexión declarada:
 * lo que se decidió a un lado, lo que pasó al otro. Donde las dos columnas no
 * coinciden —una conexión declarada como un agente que lee como el dueño— es
 * donde está el agujero, y verlo es todo el punto de la página.
 */
export function clientsSeen(store: Store, since = 0): SeenClient[] {
  const rows = store.db
    .prepare(
      `SELECT client, participant_id, COUNT(*) AS n, SUM(volume) AS volume,
              SUM(delivered_count) AS delivered_count,
              MIN(at) AS first_at, MAX(at) AS last_at
         FROM exposures
        WHERE graph_id = ? AND at >= ?
        GROUP BY client, participant_id
        ORDER BY last_at DESC`,
    )
    .all(store.graphId, since) as unknown as {
    client: string | null;
    participant_id: string;
    n: number;
    volume: number;
    delivered_count: number;
    first_at: number;
    last_at: number;
  }[];
  return rows.map((row) => ({
    client: row.client,
    participant: row.participant_id,
    deliveries: row.n,
    volume: row.volume ?? 0,
    deliveredCount: row.delivered_count ?? 0,
    firstAt: row.first_at,
    lastAt: row.last_at,
  }));
}
