// La página de un servicio de fuera, con su clave a la vista.
//
// «A la vista» quiere decir dos cosas y las dos importan: que se ve que la clave
// está, cuándo se guardó, cuándo se usó y cómo quitarla —todo en la misma página
// que dice qué servicio es y qué se trae de él—, y que su dueño puede mirarla
// pulsando el ojo. Que no se enseñe por defecto y que no se pueda ver nunca son
// cosas distintas, y sólo la primera es prudencia: la segunda obliga a guardar la
// clave además en otra parte, que es tener dos copias y una de ellas fuera de
// aquí. Lo que esto reemplaza es el archivo de configuración que hay que abrir
// con un editor de texto para saber si uno puso la clave y cuál.
//
// El valor no vive en el corpus. Se guarda en una tabla que no entra al log, no
// se proyecta a Markdown y no se indexa, porque un log append-only no sabe
// olvidar: una clave escrita ahí se queda escrita aunque uno la rote y aunque
// borre el bloque. Ver packages/store/src/secrets.ts y
// specs/service-connections.allium.
//
// Se dibuja con la misma tabla que «Objetos», «Propiedades» y la puerta MCP. Ver
// table.ts: tres páginas que se leen igual tienen que dibujarse con el mismo
// código y no con tres códigos parecidos.

import { api, type Change, type ServiceCheck, type ServiceItem, type ServiceView } from './api.ts';
import { icon } from './icons.ts';
import { when } from './dates.ts';
import { cellIn, editableCell, observedCell, rowIn, section } from './table.ts';

export type Write = (change: Change) => Promise<boolean>;

/** Un botón de los de esta tabla: pequeño, en línea con lo que hay al lado. */
function button(label: string, title = label): HTMLButtonElement {
  const one = document.createElement('button');
  one.type = 'button';
  one.className = 'service-button';
  one.textContent = label;
  one.title = title;
  return one;
}

/**
 * Dibuja el panel de una conexión dentro de su página.
 *
 * Devuelve null cuando esa página no es un servicio, que es lo que permite
 * llamarlo sin preguntar antes.
 */
export async function renderService(
  pageId: string,
  notify: (message: string) => void,
  write: Write,
): Promise<HTMLElement | null> {
  const all = await api.services().catch(() => null);
  const service = all?.find((one) => one.id === pageId);
  if (service === undefined || service === null) return null;

  const panel = document.createElement('section');
  panel.className = 'service governing-tables';

  const head = document.createElement('div');
  head.className = 'service-head';
  const name = document.createElement('span');
  name.className = 'service-name';
  name.textContent = service.service;
  const state = document.createElement('span');
  state.className = 'service-state';
  head.append(name, state);
  panel.append(head);

  const table = section(panel, { headers: ['Qué', 'Cómo está'] });

  /** Escribir una propiedad de la página, o quitarla si queda vacía. */
  const put = (key: string) => async (next: string): Promise<boolean> =>
    write(
      next.trim() === ''
        ? { kind: 'remove_property', page: service.id, propertyKey: key }
        : { kind: 'set_property', page: service.id, propertyKey: key, propertyValue: next.trim() },
    );

  const named = (label: string): HTMLTableCellElement => {
    const row = rowIn(table);
    const key = cellIn(row, 0);
    key.className = 'governing-col-0 service-key';
    key.textContent = label;
    return cellIn(row, 1);
  };

  /*
   * La fila de la clave.
   *
   * Enseña que hay una y cuál es —por sus últimos cuatro caracteres, que es lo
   * que hace falta para saber cuál de las tres puso uno— y su valor sólo cuando
   * se pide. El campo donde se escribe es de contraseña: lo que se pega ahí no
   * se queda escrito en la pantalla de nadie.
   */
  const keyCell = named('clave');
  keyCell.classList.add('service-value');
  const keyState = document.createElement('span');
  const shown = document.createElement('code');
  shown.className = 'service-secret';
  shown.hidden = true;

  const look = document.createElement('button');
  look.type = 'button';
  look.className = 'service-eye';
  const change = button('poner');
  const forget = button('olvidar', 'borrarla de verdad: aquí olvidar es olvidar');

  const field = document.createElement('input');
  field.type = 'password';
  field.className = 'service-field';
  field.placeholder = 'pega aquí la clave de la API';
  field.autocomplete = 'off';
  field.hidden = true;
  const save = button('guardar');
  save.hidden = true;

  let secret = service.secrets.find((one) => one.name === 'clave') ?? null;
  let looking = false;

  const drawEye = (): void => {
    look.innerHTML = icon(looking ? 'eye-off' : 'eye');
    look.title = looking ? 'esconder la clave' : 'ver la clave';
    look.setAttribute('aria-label', look.title);
    look.setAttribute('aria-pressed', String(looking));
  };

  const draw = (): void => {
    keyState.textContent =
      secret === null
        ? 'sin guardar'
        : `guardada ${when(secret.savedAt)}${secret.tail === '' ? '' : ` · …${secret.tail}`}` +
          ` · usada ${when(secret.lastUsedAt)}`;
    change.textContent = secret === null ? 'poner' : 'cambiar';
    forget.hidden = secret === null;
    look.hidden = secret === null;
    if (secret === null) {
      looking = false;
      shown.hidden = true;
      shown.textContent = '';
    }
    keyState.hidden = looking;
    drawEye();
    state.textContent = secret === null ? 'sin conectar' : 'con clave guardada';
  };
  drawEye();
  draw();

  keyCell.append(keyState, shown, look, change, forget, field, save);

  look.addEventListener('click', () => {
    if (looking) {
      looking = false;
      shown.hidden = true;
      shown.textContent = '';
      draw();
      return;
    }
    // Se pide al pulsar y no antes: así la clave no viaja con la página ni queda
    // en la respuesta que el navegador guarda.
    void api.revealSecret(service.id).then((clear) => {
      if (typeof clear !== 'string') {
        notify(clear.error);
        return;
      }
      looking = true;
      shown.textContent = clear;
      shown.hidden = false;
      draw();
    });
  });

  change.addEventListener('click', () => {
    field.hidden = !field.hidden;
    save.hidden = field.hidden;
    if (!field.hidden) field.focus();
  });

  const store = async (): Promise<void> => {
    const said = field.value.trim();
    if (said === '') return;
    const done = await api.saveSecret(service.id, said);
    field.value = '';
    field.hidden = true;
    save.hidden = true;
    if ('error' in done) {
      notify(done.error);
      return;
    }
    secret = done.find((one) => one.name === 'clave') ?? null;
    looking = false;
    shown.hidden = true;
    draw();
    notify('clave guardada, fuera del registro');
  };
  save.addEventListener('click', () => void store());
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void store();
    }
  });

  forget.addEventListener('click', () => {
    void api.forgetSecret(service.id).then((gone) => {
      if (!gone) {
        notify('no se pudo olvidar la clave');
        return;
      }
      secret = null;
      draw();
      notify('la clave se borró: aquí olvidar es olvidar');
    });
  });

  /*
   * Lo que la página declara, y ahora se corrige aquí mismo.
   *
   * Estaba escrito en el frontmatter y sólo se leía; que se pueda cambiar desde
   * la tabla es lo que hace de esto gobierno y no un informe. Escribe en la
   * propiedad de la página, que es de donde salió.
   */
  editableCell(
    named('biblioteca'),
    {
      shows: service.library ?? '',
      label: 'con qué biblioteca hablar',
      placeholder: 'sin declarar — se le pregunta al servicio al conectar',
    },
    put('biblioteca'),
  );

  editableCell(
    named('colecciones'),
    {
      shows: service.collections.join(', '),
      label: 'qué colecciones se traen',
      placeholder: 'todas',
    },
    put('colecciones'),
  );

  /* La capacidad de la clave y la autoridad concedida por Vera son distintas. */
  const accessCell = named('acceso');
  const access = document.createElement('select');
  access.className = 'service-access';
  access.setAttribute('aria-label', 'Acceso permitido para esta conexión');
  access.append(new Option('Sólo lectura', 'read'), new Option('Lectura y escritura', 'read-write'));
  access.value = service.access;
  access.addEventListener('change', () => {
    access.disabled = true;
    const next = access.value === 'read-write' ? 'lectura y escritura' : 'lectura';
    void put('acceso')(next).then((saved) => {
      access.disabled = false;
      if (!saved) {
        access.value = service.access;
        notify('no se pudo cambiar el acceso de la conexión');
        return;
      }
      service.access = next === 'lectura y escritura' ? 'read-write' : 'read';
      notify(`acceso de Zotero: ${next}`);
    });
  });
  const accessNote = document.createElement('small');
  accessNote.className = 'service-access-note';
  accessNote.textContent = 'Esta política limita a Vera. La prueba muestra por separado lo que permite la clave de Zotero.';
  accessCell.append(access, accessNote);

  observedCell(
    named('traído'),
    service.pages === 0
      ? 'todavía ninguna página'
      : `${service.pages} ${service.pages === 1 ? 'página' : 'páginas'} del corpus vinieron de aquí`,
  );

  /*
   * Probar la conexión.
   *
   * Pregunta quién es el dueño de la clave y qué puede hacer, que es lo único
   * que distingue una clave mala de una biblioteca vacía. No trae nada.
   */
  const test = document.createElement('button');
  test.type = 'button';
  test.className = 'service-button probe';
  test.innerHTML = `${icon('check')} probar la conexión`;
  const result = document.createElement('div');
  result.className = 'service-result';
  test.addEventListener('click', () => {
    result.textContent = 'preguntando…';
    void api.checkService(service.id).then((said) => {
      if ('error' in said) {
        result.textContent = said.error;
        result.classList.add('bad');
        return;
      }
      result.classList.remove('bad');
      result.textContent = describe(said, service.access);
      state.textContent = `conectada como ${said.identity.username}`;
    });
  });
  panel.append(test, result);

  return panel;
}

function describe(said: ServiceCheck, access: ServiceView['access']): string {
  const can = [
    said.identity.access.library ? 'lee la biblioteca' : null,
    said.identity.access.notes ? 'lee las notas' : null,
    said.identity.access.write ? 'la clave permite escribir' : 'la clave no permite escribir',
    said.identity.access.groups > 0 ? `${said.identity.access.groups} grupos` : null,
  ].filter((one): one is string => one !== null);
  const library = said.declared ? said.library : `${said.library} (no declarada; se dedujo)`;
  const policy = access === 'read-write' ? 'Vera autoriza lectura y escritura' : 'Vera autoriza sólo lectura';
  return `conectada como ${said.identity.username} · ${library} · ${can.join(', ')} · ${policy}`;
}

/** ¿Esta página gobierna un servicio? Se responde con lo que ya trae la página. */
export function isServicePage(
  properties: readonly { key: string; value: string }[],
): boolean {
  return properties.some(
    (one) => one.key === 'special-kind' && one.value.trim().toLowerCase() === 'service',
  );
}

export type { ServiceView };


/*
 * Buscar en la bibliografía desde donde se está escribiendo.
 *
 * Es lo que hace `/zotero`: se busca por autor, título o año, se elige, y lo que
 * queda escrito es un enlace a la página del ítem —que nace si no estaba y se
 * refresca si Zotero tiene algo más nuevo—. Citar y traer son el mismo gesto:
 * separarlos obligaría a irse de lo que uno estaba escribiendo para volver
 * después, y lo que se estaba escribiendo era justamente la frase que cita.
 */

/** Cómo se lee un ítem en una lista de resultados. */
function describeItem(item: ServiceItem): string {
  const who = item.creators.slice(0, 3).join('; ');
  const when = (item.date ?? '').match(/\d{4}/)?.[0] ?? '';
  const where = item.publication ?? item.publisher ?? '';
  return [who, when, where].filter((one) => one !== '').join(' · ');
}

export interface PickedItem {
  page: string;
  title: string;
  created: boolean;
}

/**
 * Abre el buscador bibliográfico junto a lo que se está escribiendo.
 *
 * Sin página de servicio no se abre y se dice por qué: una conexión que no
 * existe no puede fallar en silencio, porque quien escribió `/zotero` está
 * esperando una lista.
 */
export async function pickBibliography(
  anchor: HTMLElement,
  notify: (message: string) => void,
  onPick: (picked: PickedItem) => void,
): Promise<void> {
  const all = await api.services().catch(() => null);
  const service = all?.find((one) => one.service === 'zotero') ?? null;
  if (service === null) {
    notify('no hay ninguna página de servicio para Zotero: créala con special-kind:: service y servicio:: zotero');
    return;
  }
  if (!service.secrets.some((one) => one.name === 'clave')) {
    notify(`«${service.title}» todavía no tiene clave guardada: ponla en su página`);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'zotero-picker';
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  panel.style.top = `${Math.round(rect.bottom + window.scrollY + 4)}px`;

  const field = document.createElement('input');
  field.type = 'search';
  field.className = 'zotero-field';
  field.placeholder = 'autor, título o año';
  const list = document.createElement('ul');
  list.className = 'zotero-results';
  const state = document.createElement('div');
  state.className = 'zotero-state';
  state.textContent = `buscando en ${service.title}`;
  panel.append(field, state, list);
  document.body.append(panel);
  field.focus();

  const dismiss = (): void => {
    panel.remove();
    document.removeEventListener('mousedown', outside, true);
  };
  function outside(event: MouseEvent): void {
    if (!panel.contains(event.target as Node)) dismiss();
  }
  document.addEventListener('mousedown', outside, true);

  const take = (item: ServiceItem): void => {
    state.textContent = item.alreadyHere === null ? 'trayendo…' : 'ya estaba; comprobando…';
    void api.bringItem(service.id, item.key).then((brought) => {
      if ('error' in brought) {
        state.textContent = brought.error;
        return;
      }
      dismiss();
      notify(
        brought.created
          ? `traído: ${brought.title}`
          : brought.refreshed
            ? `refrescado: ${brought.title}`
            : `ya estaba: ${brought.title}`,
      );
      onPick({ page: brought.page, title: brought.title, created: brought.created });
    });
  };

  const draw = (items: ServiceItem[], total: number): void => {
    list.innerHTML = '';
    if (items.length === 0) {
      state.textContent = 'nada con eso';
      return;
    }
    state.textContent =
      total > items.length ? `${items.length} de ${total}` : `${items.length} resultados`;
    for (const item of items) {
      const row = document.createElement('li');
      row.className = item.alreadyHere === null ? 'zotero-item' : 'zotero-item here';
      const title = document.createElement('div');
      title.className = 'zotero-title';
      title.textContent = item.title;
      const meta = document.createElement('div');
      meta.className = 'zotero-meta';
      // Que ya esté en el corpus se dice aquí y no después: sin eso, citar dos
      // veces el mismo libro es dos páginas y nadie se entera hasta que pasó.
      meta.textContent = describeItem(item) + (item.alreadyHere === null ? '' : ' · ya está aquí');
      row.append(title, meta);
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        take(item);
      });
      list.append(row);
    }
  };

  let asked = 0;
  const look = (): void => {
    const text = field.value.trim();
    if (text.length < 2) {
      list.innerHTML = '';
      state.textContent = `buscando en ${service.title}`;
      return;
    }
    const mine = (asked += 1);
    state.textContent = 'buscando…';
    void api.searchService(service.id, text).then((found) => {
      // Lo que llega tarde de una búsqueda vieja no pisa lo que se está mirando.
      if (mine !== asked) return;
      if ('error' in found) {
        state.textContent = found.error;
        return;
      }
      draw(found.items, found.total);
    });
  };

  let waiting: ReturnType<typeof setTimeout> | null = null;
  field.addEventListener('input', () => {
    if (waiting !== null) clearTimeout(waiting);
    // Se espera a que la persona deje de escribir: cada pulsación era una
    // petición a un servidor de fuera, y eso es tráfico y es un registro allá.
    waiting = setTimeout(look, 400);
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (waiting !== null) clearTimeout(waiting);
      look();
    }
  });
}
