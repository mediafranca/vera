// Lo leído se queda.
//
// Ver specs/offline-reconciliation.allium, fase 2. @guarantee WhatWasReadStays: una
// página que se leyó se vuelve a leer en ese aparato sin servidor, y se escribe
// también.
//
// Hasta ahora leer era *server-first* de punta a punta. Escribir ya no esperaba a la
// red —paso 3—, pero recargar sin ella daba «no se pudo hablar con el servidor» y
// nada más: una memoria personal que necesita permiso de la red para dejarte leer lo
// tuyo no es soberana, es un cliente. La bandeja resolvía la mitad de salida; esto
// resuelve la de entrada.
//
// **Nada se replica por adelantado.** Un corpus de casi dos mil páginas no cabe en un
// teléfono, y elegir de antemano qué bajar es adivinar la atención de alguien. Leer es
// esa adivinanza ya hecha, por la persona, en voz alta — y se corrige sola, porque
// aquello a lo que se vuelve es aquello a lo que se vuelve.
//
// Retener no es guardar: lo canónico está en el corpus. Por eso soltar lo más antiguo
// es seguro, y por eso esto no se parece a la bandeja, donde soltar algo sería
// perderlo. Cuando no hay dónde retener, no se retiene y ya está: esto es una mejora
// de lectura, y una mejora que rompe al fallar es peor que no tenerla.
//
// El almacén se inyecta por la misma razón que en `outbox.ts`: IndexedDB no existe en
// node, y lo que decide qué se suelta y cuándo tiene que poder probarse.

import type { CorpusHealth, Hit, PageSummary, PageView } from './api.ts';

/**
 * Cuántas páginas se retienen. Ver rule ForgetTheLeastRecentlyRead.
 *
 * Un número y no una fracción del disco: el navegador no dice cuánto hay libre de
 * forma que se pueda usar para decidir, y pedirle permiso a alguien para guardar
 * lo que acaba de leer sería una pregunta que nadie quiere que le hagan.
 */
export const RETAINED = 240;

/**
 * Cuántos orígenes propios se recuerdan.
 *
 * Bastantes más de los que una sesión escribe entre dos preguntas al corpus, y
 * bastantes menos de los que harían de esto un segundo registro.
 */
export const SENT = 500;

/** Una página tal como queda retenida. */
export interface KeptPage {
  id: string;
  /** El título en minúsculas: la dirección puede nombrar una página por él. */
  titleKey: string;
  /** Cuándo se leyó por última vez. Es por lo que se suelta, y no por tamaño. */
  at: number;
  view: PageView;
}

/** Proyección compacta que permite buscar sin cargar PageView enteros. */
export interface SearchDocument {
  id: string;
  title: string;
  fields: { block: string | null; field: Hit['field']; text: string }[];
}

export interface LocalSearch {
  hits: Hit[];
  /** Páginas retenidas que sí tenían proyección buscable. */
  pages: number;
}

function searchDocument(view: PageView): SearchDocument {
  const fields: SearchDocument['fields'] = [
    { block: null, field: 'page_title', text: view.title },
    ...view.blocks.map((block) => ({ block: block.stableId, field: 'block_content', text: block.content })),
    ...view.properties.map((property) => ({ block: null, field: 'property_value', text: `${property.key}: ${property.value}` })),
    ...Object.entries(view.blockProperties ?? {}).flatMap(([block, properties]) =>
      properties.map((property) => ({ block, field: 'property_value', text: `${property.key}: ${property.value}` }))),
    ...Object.entries(view.glosses ?? {}).map(([block, gloss]) => ({ block, field: 'gloss_content', text: gloss.content })),
  ];
  return { id: view.id, title: view.title, fields };
}

const foldedSearch = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function searchDocuments(documents: readonly SearchDocument[], text: string, limit = 50): LocalSearch {
  const words = foldedSearch(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length === 0) return { hits: [], pages: documents.length };
  const hits: Hit[] = [];
  for (const document of documents) {
    for (const field of document.fields) {
      const haystack = foldedSearch(field.text);
      if (!words.every((word) => haystack.includes(word))) continue;
      const at = Math.max(0, haystack.indexOf(words[0] ?? '') - 35);
      const excerpt = `${at > 0 ? '…' : ''}${field.text.slice(at, at + 140)}${at + 140 < field.text.length ? '…' : ''}`;
      hits.push({ page: document.id, block: field.block, field: field.field, excerpt, rank: hits.length + 1 });
      if (hits.length >= limit) return { hits, pages: documents.length };
    }
  }
  return { hits, pages: documents.length };
}

/** Lo mínimo que retener necesita de un almacén. */
export interface Keeps {
  put(kept: KeptPage): Promise<void>;
  get(id: string): Promise<KeptPage | null>;
  byTitle(titleKey: string): Promise<KeptPage | null>;
  count(): Promise<number>;
  /** Los `n` que se leyeron hace más tiempo, del más antiguo en adelante. */
  oldest(n: number): Promise<string[]>;
  /** Qué páginas hay, por identidad. */
  ids(): Promise<string[]>;
  drop(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  putSearch(document: SearchDocument): Promise<void>;
  searchDocuments(): Promise<SearchDocument[]>;
  meta<T>(name: string): Promise<T | null>;
  setMeta<T>(name: string, value: T): Promise<void>;
}

/** Lo que este aparato ya tenía cuando se le preguntó. */
export interface Held {
  page(id: string): Promise<PageView | null>;
  keepPage(view: PageView): Promise<void>;

  index(): Promise<PageSummary[] | null>;
  keepIndex(pages: PageSummary[]): Promise<void>;

  corpus(): Promise<CorpusHealth | null>;
  keepCorpus(health: CorpusHealth): Promise<void>;

  /**
   * Hasta dónde del registro canónico sabe este aparato.
   *
   * `canonical_cursor` de la spec. Sobrevive a cerrar porque si no, cada arranque
   * volvería a preguntar por el corpus entero o no preguntaría nada.
   * @invariant CursorAdvancesOnlyThroughCanonicalOperations.
   */
  cursor(): Promise<number | null>;
  keepCursor(sequence: number): Promise<void>;

  /**
   * Los orígenes que salieron de este aparato, para no anunciárselos a sí mismo.
   *
   * El registro canónico es uno solo, así que lo que se manda vuelve en la misma
   * respuesta a «¿qué ha pasado desde mi cursor?». Sin esta lista, Vera avisaría de
   * que la página cambió cada vez que uno escribe en ella.
   *
   * Es durable y acotada: en memoria se perdería al recargar y lo escrito ayer se
   * anunciaría hoy como ajeno, y sin tope crecería con el corpus para contestar una
   * pregunta que sólo mira hacia atrás unas pocas operaciones.
   */
  sent(): Promise<string[]>;
  noteSent(originId: string): Promise<void>;

  /**
   * Suelta una página retenida que dejó de estar al día.
   *
   * Soltar no es perder: lo canónico está en el corpus. Es lo que se hace con una
   * página que otra mano tocó y aquí no se está mirando — enseñarla al instante y
   * equivocada sería lo único peor que tardar en enseñarla.
   */
  forgetPage(id: string): Promise<void>;

  /** Qué páginas hay retenidas. Se pregunta para saber cuáles dejaron de valer. */
  retained(): Promise<string[]>;

  /** Cuántas páginas hay retenidas. Se enseña en Memoria; no se decide con ello. */
  count(): Promise<number>;
  search(text: string): Promise<LocalSearch>;
  forget(): Promise<void>;
}

/**
 * La política, sobre un almacén cualquiera.
 *
 * Cada método se traga sus propios fallos, y no es descuido: un fallo al retener no
 * puede impedir leer una página que el servidor acaba de entregar, y un fallo al
 * leer lo retenido tiene la misma respuesta que no tener nada —«no tengo»—, que es
 * lo que quien llama ya sabe manejar.
 */
export function heldOn(keeps: Keeps, now: () => number = Date.now): Held {
  const quietly = async <T>(what: () => Promise<T>, otherwise: T): Promise<T> => {
    try {
      return await what();
    } catch {
      return otherwise;
    }
  };

  /** Leer una retenida es leerla: cuenta como lectura y la aleja de ser soltada. */
  const touch = (kept: KeptPage): Promise<void> => keeps.put({ ...kept, at: now() });

  const found = async (kept: KeptPage | null): Promise<PageView | null> => {
    if (kept === null) return null;
    await touch(kept);
    return kept.view;
  };

  return {
    page: (id) =>
      quietly(async () => {
        // Por identidad y también por título, porque la dirección puede nombrarla
        // de las dos formas y sin servidor no hay quien lo resuelva.
        const byId = await keeps.get(id);
        return found(byId ?? (await keeps.byTitle(id.toLowerCase())));
      }, null),

    keepPage: (view) =>
      quietly(async () => {
        await keeps.put({ id: view.id, titleKey: view.title.toLowerCase(), at: now(), view });
        await keeps.putSearch(searchDocument(view));
        /*
         * Y soltar lo que sobre, por última lectura.
         *
         * Se mira la cuenta antes de tocar nada: el caso corriente es que no sobre,
         * y recorrer el almacén en cada lectura para descubrirlo cobraría el precio
         * del límite a quien no lo ha alcanzado.
         */
        const held = await keeps.count();
        if (held <= RETAINED) return;
        await keeps.drop(await keeps.oldest(held - RETAINED));
      }, undefined),

    /*
     * La lista de páginas de la última vez.
     *
     * No es un adorno: de ella salen el autocompletado de `[[enlaces]]`, resolver
     * una dirección escrita por título y saber si una página existe antes de
     * crearla. Sin lista, abrir sin red dejaría a Vera sabiendo leer una página y
     * sin saber cómo se llama ninguna otra.
     */
    index: () => quietly(() => keeps.meta<PageSummary[]>('index'), null),
    keepIndex: (pages) => quietly(() => keeps.setMeta('index', pages), undefined),

    corpus: () => quietly(() => keeps.meta<CorpusHealth>('corpus'), null),
    keepCorpus: (health) => quietly(() => keeps.setMeta('corpus', health), undefined),

    cursor: () => quietly(() => keeps.meta<number>('cursor'), null),
    keepCursor: (sequence) => quietly(() => keeps.setMeta('cursor', sequence), undefined),

    sent: () => quietly(async () => (await keeps.meta<string[]>('sent')) ?? [], []),
    noteSent: (originId) =>
      quietly(async () => {
        const held = (await keeps.meta<string[]>('sent')) ?? [];
        if (held.includes(originId)) return;
        await keeps.setMeta('sent', [...held, originId].slice(-SENT));
      }, undefined),

    forgetPage: (id) => quietly(() => keeps.drop([id]), undefined),
    retained: () => quietly(() => keeps.ids(), []),

    count: () => quietly(() => keeps.count(), 0),
    search: (text) => quietly(async () => searchDocuments(await keeps.searchDocuments(), text), { hits: [], pages: 0 }),

    /*
     * Olvidar todo lo retenido.
     *
     * Hace falta porque esto es una copia del corpus en un aparato, y quien deja de
     * usar Vera en una máquina prestada tiene que poder llevársela. No toca la
     * bandeja: lo pendiente no es copia de nada, y borrarlo sí sería perderlo.
     */
    forget: () => quietly(() => keeps.clear(), undefined),
  };
}

const DB = 'vera-held';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      let pages: IDBObjectStore;
      if (!request.result.objectStoreNames.contains('pages')) {
        pages = request.result.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('at', 'at');
        pages.createIndex('titleKey', 'titleKey');
      } else {
        pages = request.transaction?.objectStore('pages') as IDBObjectStore;
      }
      if (!request.result.objectStoreNames.contains('meta')) request.result.createObjectStore('meta', { keyPath: 'name' });
      if (!request.result.objectStoreNames.contains('search')) {
        const search = request.result.createObjectStore('search', { keyPath: 'id' });
        // Las páginas retenidas antes de v2 ganan su proyección durante la
        // migración, sin esperar a que vuelvan a abrirse.
        pages.openCursor().onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor === null) return;
          const kept = cursor.value as KeptPage;
          search.put(searchDocument(kept.view));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Una transacción, con su base cerrada al terminar. */
async function within<T>(
  store: 'pages' | 'meta' | 'search',
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = act(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

/** El almacén de verdad. */
export function indexedDbKeeps(): Keeps {
  return {
    put: (kept) => within<void>('pages', 'readwrite', (store) => store.put(kept)),
    get: async (id) => (await within<KeptPage | undefined>('pages', 'readonly', (s) => s.get(id))) ?? null,
    byTitle: async (titleKey) =>
      (await within<KeptPage | undefined>('pages', 'readonly', (s) =>
        s.index('titleKey').get(titleKey),
      )) ?? null,
    count: () => within<number>('pages', 'readonly', (store) => store.count()),

    /*
     * Los más antiguos, leyendo sólo sus llaves.
     *
     * `getAllKeys` sobre el índice de última lectura los devuelve ya ordenados, y
     * con un límite: no hay que traer doscientas cuarenta páginas enteras a memoria
     * para averiguar cuáles son las tres que sobran.
     */
    oldest: (n) =>
      n <= 0
        ? Promise.resolve([])
        : within<string[]>('pages', 'readonly', (s) => s.index('at').getAllKeys(null, n)),

    // Sólo las llaves, por lo mismo: saber qué hay no puede costar traerlo todo.
    ids: () => within<string[]>('pages', 'readonly', (s) => s.getAllKeys()),

    drop: async (ids) => {
      for (const id of ids) {
        await within<void>('pages', 'readwrite', (store) => store.delete(id));
        await within<void>('search', 'readwrite', (store) => store.delete(id));
      }
    },
    clear: async () => {
      await within<void>('pages', 'readwrite', (store) => store.clear());
      await within<void>('search', 'readwrite', (store) => store.clear());
      await within<void>('meta', 'readwrite', (store) => store.clear());
    },
    putSearch: (document) => within<void>('search', 'readwrite', (store) => store.put(document)),
    searchDocuments: () => within<SearchDocument[]>('search', 'readonly', (store) => store.getAll()),
    meta: async <T>(name: string) =>
      (await within<{ name: string; value: T } | undefined>('meta', 'readonly', (s) => s.get(name)))
        ?.value ?? null,
    setMeta: (name, value) => within<void>('meta', 'readwrite', (s) => s.put({ name, value })),
  };
}

/** Y uno de memoria, para probar y para cuando no hay otro. */
export function inMemoryKeeps(): Keeps {
  const pages = new Map<string, KeptPage>();
  const search = new Map<string, SearchDocument>();
  const meta = new Map<string, unknown>();
  return {
    put: async (kept) => void pages.set(kept.id, kept),
    get: async (id) => pages.get(id) ?? null,
    byTitle: async (titleKey) => [...pages.values()].find((one) => one.titleKey === titleKey) ?? null,
    count: async () => pages.size,
    oldest: async (n) =>
      n <= 0 ? [] : [...pages.values()].sort((a, b) => a.at - b.at).slice(0, n).map((one) => one.id),
    ids: async () => [...pages.keys()],
    drop: async (ids) => {
      for (const id of ids) {
        pages.delete(id);
        search.delete(id);
      }
    },
    clear: async () => {
      pages.clear();
      search.clear();
      meta.clear();
    },
    putSearch: async (document) => void search.set(document.id, document),
    searchDocuments: async () => [...search.values()],
    meta: async <T>(name: string) => (meta.get(name) as T | undefined) ?? null,
    setMeta: async (name, value) => void meta.set(name, value),
  };
}

/**
 * La que no retiene nada.
 *
 * Navegación privada, permiso denegado, disco lleno, un navegador sin IndexedDB.
 * Contesta «no tengo» a todo y acepta todo sin guardarlo, que deja la aplicación
 * exactamente como estaba antes de que esto existiera.
 *
 * Es una tercera cosa y no el almacén de memoria: retener en memoria dentro de una
 * pestaña no sirve de nada —lo que retiene se pierde en la recarga, que es justo
 * cuando haría falta— y encima costaría la memoria de tenerlo.
 */
export function holdsNothing(): Held {
  return {
    page: async () => null,
    keepPage: async () => {},
    index: async () => null,
    keepIndex: async () => {},
    corpus: async () => null,
    keepCorpus: async () => {},
    cursor: async () => null,
    keepCursor: async () => {},
    sent: async () => [],
    noteSent: async () => {},
    forgetPage: async () => {},
    retained: async () => [],
    count: async () => 0,
    search: async () => ({ hits: [], pages: 0 }),
    forget: async () => {},
  };
}

/** La memoria de lectura de este aparato, si se puede abrir. */
export async function heldHere(): Promise<Held> {
  if (typeof indexedDB === 'undefined') return holdsNothing();
  const keeps = indexedDbKeeps();
  try {
    // Abrir de verdad y no comprobar que el objeto existe: un permiso denegado o
    // una cuota agotada no se notan hasta que se toca la base.
    await keeps.count();
  } catch {
    return holdsNothing();
  }
  return heldOn(keeps);
}
