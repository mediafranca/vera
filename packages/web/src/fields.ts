// Los campos breves con los que se corrige algo sin salir de donde está.
//
// Tres cosas y ningún estado propio: colocar algo flotante dentro de la ventana,
// editar un texto en su sitio, y editarlo ofreciendo mientras se escribe. Viven
// aparte del outliner porque no son suyos: la tabla de una página especial
// corrige sus celdas con exactamente los mismos gestos con que el outliner
// corrige el título de una página o el valor de una propiedad, y dos copias de
// un campo de texto acaban comportándose distinto.

import { readFieldValue, titleKey, type FieldKind } from '@vera/core';

/**
 * Deja algo flotante junto a su ancla, dentro de la ventana.
 *
 * Un desplegable cabe en la pantalla o no sirve: el de un control pegado al
 * borde derecho salía fuera y sus opciones quedaban inalcanzables, y el de un
 * bloque al pie de la página se abría por debajo del fondo. Hay que medirlo
 * antes de colocarlo, y para medirlo hay que haberlo puesto en el documento: va
 * invisible primero y se sitúa después, que es cosa de quien llama.
 *
 * Estaba escrito tres veces con las mismas cuentas y tres constantes iguales.
 */
export function placeNear(
  floating: HTMLElement,
  anchor: HTMLElement,
  options: { gap: number; alignRight: boolean },
): void {
  const at = anchor.getBoundingClientRect();
  const box = floating.getBoundingClientRect();
  const margin = 8;

  // Se alinea por la izquierda del ancla; si no cabe y se permite, por su
  // derecha; y si tampoco, se pega al borde. Nunca se sale.
  let left = at.left;
  if (options.alignRight && left + box.width > window.innerWidth - margin) {
    left = at.right - box.width;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));

  // Abajo del ancla, salvo que no quepa: entonces encima, que es donde queda el
  // hueco.
  let top = at.bottom + options.gap;
  if (
    top + box.height > window.innerHeight - margin &&
    at.top - box.height - options.gap > margin
  ) {
    top = at.top - box.height - options.gap;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));

  floating.style.left = `${Math.round(left + window.scrollX)}px`;
  floating.style.top = `${Math.round(top + window.scrollY)}px`;
}


export function editInPlace(
  host: HTMLElement,
  original: string,
  label: string,
  commit: (next: string) => Promise<boolean>,
): void {
  if (host.querySelector('input') !== null) return;

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'inline-edit';
  field.value = original;
  field.setAttribute('aria-label', label);

  const held = host.innerHTML;
  host.innerHTML = '';
  host.append(field);
  field.focus();
  field.select();

  let settled = false;
  const finish = (accept: boolean): void => {
    if (settled) return;
    settled = true;
    const next = field.value;
    if (!accept || next === original) {
      host.innerHTML = held;
      return;
    }
    void commit(next).then((applied) => {
      // Aplicar recarga la página entera, así que sólo hay que restituir esto
      // cuando el cambio no llegó a ocurrir.
      if (!applied) host.innerHTML = held;
    });
  };

  field.addEventListener('blur', () => finish(true));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    // Aquí Escape sí descarta: nada se ha guardado todavía, porque un campo de
    // una línea no tiene guardado al reposar.
    if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      host.innerHTML = held;
    }
  });
}

/**
 * Edita una sola línea semántica sin esconder sus pliegues visuales.
 *
 * Un título puede ocupar varias líneas cuando el panel es angosto, aunque no
 * contenga saltos de línea. Un `input` obliga a desplazarlo horizontalmente y
 * hace desaparecer casi todo el título justo cuando se intenta corregirlo. El
 * `textarea` conserva el ancho del encabezado y crece con sus pliegues; Enter
 * sigue significando guardar, no introducir una segunda línea en el nombre.
 */
export function editWrappedInPlace(
  host: HTMLElement,
  original: string,
  label: string,
  commit: (next: string) => Promise<boolean>,
): void {
  if (host.querySelector('textarea') !== null) return;

  const field = document.createElement('textarea');
  field.className = 'inline-edit inline-edit-wrapped';
  field.value = original;
  field.rows = 1;
  field.wrap = 'soft';
  field.setAttribute('aria-label', label);

  const held = host.innerHTML;
  host.innerHTML = '';
  host.append(field);

  const fit = (): void => {
    field.style.height = 'auto';
    const border = field.offsetHeight - field.clientHeight;
    field.style.height = `${field.scrollHeight + border}px`;
  };
  field.addEventListener('input', fit);

  let observedWidth = -1;
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width;
    if (width === undefined || width === observedWidth) return;
    observedWidth = width;
    fit();
  });
  observer?.observe(host);

  field.focus();
  field.select();
  fit();

  let settled = false;
  const restore = (): void => {
    observer?.disconnect();
    host.innerHTML = held;
  };
  const finish = (accept: boolean): void => {
    if (settled) return;
    settled = true;
    observer?.disconnect();
    // Pegar texto desde otro lugar puede traer retornos aunque Enter esté
    // reservado para guardar. El nombre sigue siendo una sola línea canónica.
    const next = field.value.replace(/\s*[\r\n]+\s*/g, ' ');
    if (!accept || next === original) {
      restore();
      return;
    }
    void commit(next).then((applied) => {
      // Aplicar recarga la página entera. Si la puerta rechazó el cambio,
      // restituimos exactamente el encabezado que había antes de editar.
      if (!applied) restore();
    });
  };

  field.addEventListener('blur', () => finish(true));
  field.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
}

/**
 * Edita un valor con el mismo contrato que lo valida y proyecta el servidor.
 *
 * Fechas, números y booleanos no vuelven a inventar su gramática en cada
 * formulario. Los campos de vocabulario y referencias conservan
 * `completeInPlace`, porque además de tipo necesitan opciones del corpus.
 */
export function editFieldInPlace(
  host: HTMLElement,
  original: string,
  label: string,
  kind: FieldKind | null,
  commit: (next: string) => Promise<boolean>,
): void {
  if (kind === null || kind === 'texto' || kind === 'enlace' || kind === 'una de' || kind === 'posición geográfica') {
    editInPlace(host, original, label, commit);
    return;
  }
  if (host.querySelector('input') !== null) return;

  const held = host.innerHTML;
  host.innerHTML = '';

  if (kind === 'sí/no') {
    const reading = readFieldValue(kind, original);
    const control = document.createElement('label');
    control.className = 'inline-boolean';
    const field = document.createElement('input');
    field.type = 'checkbox';
    field.role = 'switch';
    field.checked = reading.canonical === 'sí';
    field.setAttribute('aria-label', label);
    const word = document.createElement('span');
    const say = (): void => { word.textContent = field.checked ? 'sí' : 'no'; };
    say();
    control.append(field, word);
    host.append(control);
    field.focus();
    let settled = false;
    const finish = (accept: boolean): void => {
      if (settled) return;
      settled = true;
      if (!accept) {
        host.innerHTML = held;
        return;
      }
      const next = field.checked ? 'sí' : 'no';
      if (next === reading.canonical) {
        host.innerHTML = held;
        return;
      }
      void commit(next).then((applied) => {
        if (!applied) host.innerHTML = held;
      });
    };
    field.addEventListener('change', () => {
      say();
      finish(true);
    });
    field.addEventListener('blur', () => finish(false));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    return;
  }

  const originalReading = readFieldValue(kind, original);
  const fullDate = kind === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(originalReading.canonical ?? '');
  const field = document.createElement('input');
  // Un año o mes bibliográfico tiene precisión legítimamente menor. El
  // calendario sólo representa días completos; convertir `2024` en un input
  // date vacío escondería el dato y un blur podría borrarlo.
  field.type = kind === 'fecha'
    ? (original === '' || fullDate ? 'date' : 'text')
    : kind === 'número' ? 'number' : 'url';
  field.className = 'inline-edit inline-edit-typed';
  field.value = original;
  field.setAttribute('aria-label', label);
  if (kind === 'número') {
    field.step = 'any';
    field.inputMode = 'decimal';
  }
  if (kind === 'fecha' && field.type === 'text') {
    field.inputMode = 'numeric';
    field.placeholder = 'AAAA, AAAA-MM o AAAA-MM-DD';
  }
  host.append(field);
  field.focus();
  if (kind !== 'fecha') field.select();

  let settled = false;
  const finish = (accept: boolean): void => {
    if (settled) return;
    if (!accept || field.value === original) {
      settled = true;
      host.innerHTML = held;
      return;
    }
    const reading = readFieldValue(kind, field.value);
    if (reading.state === 'invalid' || reading.canonical === null) {
      field.setCustomValidity(reading.reason ?? 'valor inválido');
      field.reportValidity();
      field.focus();
      return;
    }
    settled = true;
    void commit(reading.canonical).then((applied) => {
      if (!applied) host.innerHTML = held;
    });
  };
  field.addEventListener('input', () => field.setCustomValidity(''));
  field.addEventListener('blur', () => finish(true));
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      settled = true;
      host.innerHTML = held;
    }
  });
  if (kind === 'fecha' && field.type === 'date') {
    try {
      (field as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // WebKit puede exigir otro gesto; el campo enfocado sigue siendo usable.
    }
  }
}

/** Una respuesta que se ofrece mientras se escribe. */
export interface Choice {
  value: string;
  /** Lo que se lee en gris al lado: por qué está ahí, o qué se sabe de ella. */
  hint?: string;
  /**
   * Se ofrece antes que todo lo demás, y sin haber escrito nada.
   *
   * Es la única sugerencia con fundamento cuando el campo está vacío: lo que a
   * esta clase de cosa le falta. El resto es una lista de lo que existe, y una
   * lista de lo que existe no es una sugerencia.
   */
  first?: boolean;
}

/** Cuántas se enseñan de una vez sin que la lista deje de leerse. */
const SUGGESTED_AT_MOST = 8;

/**
 * Un campo de una línea que ofrece mientras se escribe.
 *
 * `editInPlace` con una lista debajo, y son dos cosas distintas por una razón:
 * un menú obliga a reconocer un nombre entre los que le enseñan, y un campo deja
 * escribir el que uno ya tiene en la cabeza. Con treinta y tres propiedades
 * declaradas y ochenta y seis más que el corpus usa sin declarar, reconocer
 * dejó de ser viable hace tiempo: el menú era a la vez demasiado largo para
 * leerlo y ciego a casi todo lo escrito.
 *
 * Lo que se escriba vale aunque no esté en la lista. @guarantee
 * AVocabularyGrowsAtThePointOfUse: un vocabulario que no crece donde se usa deja
 * de crecer, y con él deja de etiquetarse.
 *
 * Las opciones pueden llegar después de abrirse el campo —vienen del servidor— y
 * por eso se devuelve `offer`. Abrir un campo no puede esperar a una petición:
 * quien pulsó ya sabe lo que va a escribir.
 */
export interface CompleteOptions {
  /**
   * Lo que la celda dice ahora, cuando se está corrigiendo algo que ya existe.
   *
   * Distingue las dos cosas que un campo vacío puede significar. Con `initial`
   * vacío, dejarlo vacío es no haber escrito nada y no pasa nada; con un valor
   * dentro, vaciarlo es borrarlo, que es una decisión y se aplica. Sin la
   * distinción no habría forma de quitarle el papel a una propiedad sin
   * inventar un botón aparte para eso.
   */
  initial?: string;
  /** Lo que se ofrece de entrada, cuando ya se sabe y no hay que ir a pedirlo. */
  choices?: readonly Choice[];
  /** Se llama cuando se salió sin cambiar nada, para deshacer lo que se preparó. */
  onCancel?: () => void;
  /**
   * Edita una respuesta dentro de una lista escrita en el mismo campo.
   *
   * `concepto` guarda varias respuestas separadas por comas. El autocompletado
   * tiene que buscar y sustituir sólo la respuesta donde está el cursor: tratar
   * `diseño, memoria` como una consulta única no puede encontrar ninguna de las
   * dos y escoger una sugerencia no debe borrar la otra.
   */
  separatedBy?: string;
}

/** El trozo separado que se está escribiendo en un campo de una línea. */
export function separatedQuery(value: string, cursor: number, separator: string): string {
  const before = value.lastIndexOf(separator, Math.max(0, cursor - 1));
  const after = value.indexOf(separator, cursor);
  return value.slice(before + separator.length, after < 0 ? value.length : after).trim();
}

/** Sustituye sólo el trozo del cursor y conserva las demás respuestas. */
export function replaceSeparated(
  value: string,
  cursor: number,
  choice: string,
  separator: string,
): { value: string; cursor: number } {
  const before = value.lastIndexOf(separator, Math.max(0, cursor - 1));
  const after = value.indexOf(separator, cursor);
  const start = before < 0 ? 0 : before + separator.length;
  const end = after < 0 ? value.length : after;
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const leading = start > 0 ? ' ' : '';
  const next = `${prefix}${leading}${choice.trim()}${suffix}`;
  return { value: next, cursor: prefix.length + leading.length + choice.trim().length };
}

export function completeInPlace(
  host: HTMLElement,
  label: string,
  commit: (next: string) => Promise<boolean>,
  options: CompleteOptions = {},
): { offer(choices: readonly Choice[]): void } {
  const initial = options.initial ?? '';
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'inline-edit';
  field.value = initial;
  field.setAttribute('aria-label', label);
  /*
   * Lo que se espera, escrito en el hueco.
   *
   * El campo abría vacío y mudo: nada decía qué va ahí, y lo único que lo
   * sugería era la lista, que llega cuando el servidor contesta. Entre pulsar y
   * ver la lista había un cuadro en blanco sin explicación, que es justo el
   * momento en que alguien duda de si pulsó lo que quería.
   *
   * Es la misma frase que ya lee en voz alta el lector de pantalla, y no otra:
   * dos textos distintos para lo mismo acaban diciendo cosas distintas.
   */
  field.placeholder = label;
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-expanded', 'false');
  field.setAttribute('autocomplete', 'off');

  const held = host.innerHTML;
  host.innerHTML = '';
  host.append(field);
  field.focus();
  if (options.separatedBy === undefined) field.select();
  else field.setSelectionRange(field.value.length, field.value.length);

  let choices: readonly Choice[] = options.choices ?? [];
  /** Si todavía no se ha tecleado nada desde que se abrió. Ver `matching`. */
  let fresh = true;
  let shown: Choice[] = [];
  let highlighted = -1;
  let list: HTMLElement | null = null;
  let settled = false;

  const closeList = (): void => {
    list?.remove();
    list = null;
    shown = [];
    highlighted = -1;
    field.setAttribute('aria-expanded', 'false');
  };

  /*
   * Qué se ofrece para lo que se lleva escrito.
   *
   * Sin nada escrito, sólo lo que esta clase de cosa echa en falta, y detrás lo
   * más usado hasta llenar la lista. Escribiendo, se busca en todo: primero lo
   * que falta, luego lo que empieza por lo tecleado y luego lo que lo lleva
   * dentro. El orden dentro de cada tramo lo puso quien llama, que es quien sabe
   * cuánto se usa cada una.
   */
  const matching = (): Choice[] => {
    /*
     * Recién abierto sobre un valor que ya existe, se ofrece todo.
     *
     * Lo que hay dentro está seleccionado y desaparece con la primera tecla, así
     * que filtrar por ello dejaría la lista con un solo renglón —el valor
     * actual— justo cuando alguien la abre para cambiarlo. Se ofrece el
     * vocabulario entero, y en cuanto se teclea algo vuelve a filtrarse.
     */
    const query = fresh
      ? ''
      : titleKey(
          options.separatedBy === undefined
            ? field.value
            : separatedQuery(field.value, field.selectionStart ?? field.value.length, options.separatedBy),
        );
    const missing = choices.filter((one) => one.first === true);
    if (query === '') {
      const rest = choices.filter((one) => one.first !== true);
      return [...missing, ...rest].slice(0, SUGGESTED_AT_MOST);
    }
    const starts: Choice[] = [];
    const holds: Choice[] = [];
    const first: Choice[] = [];
    for (const one of choices) {
      const key = titleKey(one.value);
      if (!key.includes(query)) continue;
      if (one.first === true) first.push(one);
      else if (key.startsWith(query)) starts.push(one);
      else holds.push(one);
    }
    return [...first, ...starts, ...holds].slice(0, SUGGESTED_AT_MOST);
  };

  const draw = (): void => {
    shown = matching();
    /*
     * Lo ya escrito no se ofrece a sí mismo.
     *
     * Una lista de un solo renglón que dice exactamente lo que hay en el campo
     * no ofrece nada: sólo tapa lo que está debajo y hace dudar de si hay que
     * pulsarla para que valga.
     */
    if (!fresh && shown.length === 1 && titleKey(shown[0]?.value ?? '') === titleKey(field.value)) {
      shown = [];
    }
    if (shown.length === 0) {
      closeList();
      return;
    }
    if (highlighted >= shown.length) highlighted = shown.length - 1;

    if (list === null) {
      list = document.createElement('div');
      list.className = 'complete narrow';
      list.setAttribute('role', 'listbox');
      document.body.append(list);
      field.setAttribute('aria-expanded', 'true');
    }
    /*
     * Tan ancha como el campo del que cuelga, medido y no supuesto.
     *
     * Es lo que hace que se lea como parte del campo y no como un cartel que
     * aparece cerca. Se remide en cada dibujado porque la ventana puede haber
     * cambiado de tamaño entre uno y otro, y en un teléfono eso pasa con sólo
     * girar el aparato.
     */
    list.style.width = `${Math.round(field.getBoundingClientRect().width)}px`;
    list.innerHTML = '';
    for (const [at, choice] of shown.entries()) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = at === highlighted ? 'complete-item selected' : 'complete-item';
      item.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.textContent = choice.value;
      item.append(name);
      if (choice.hint !== undefined) {
        const hint = document.createElement('span');
        hint.className = 'complete-hint';
        hint.textContent = choice.hint;
        item.append(hint);
      }
      // `mousedown` y no `click`: el clic llegaría después del blur, que ya
      // habría cerrado el campo y guardado lo que hubiera escrito.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        finishChoice(choice.value);
      });
      list.append(item);
    }
    placeNear(list, field, { gap: 2, alignRight: false });
  };

  function finish(next: string): void {
    if (settled) return;
    settled = true;
    closeList();
    const said = next.trim();
    /*
     * Lo que no cambió no se escribe.
     *
     * Cubre los dos casos de un campo que se cierra sin novedad: el que nació
     * vacío y sigue vacío —nadie escribió nada— y el que dice exactamente lo que
     * decía. Mandar el cambio igual gastaría una operación en el log por haber
     * pasado el cursor por encima, y el registro dejaría de contar lo que pasó
     * para contar por dónde anduvo alguien.
     */
    if (said === initial.trim()) {
      host.innerHTML = held;
      options.onCancel?.();
      return;
    }
    void commit(said).then((applied) => {
      // Aplicar rehace la página entera, así que sólo hay que restituir esto
      // cuando el cambio no llegó a ocurrir.
      if (!applied) host.innerHTML = held;
    });
  }

  const finishChoice = (choice: string): void => {
    if (options.separatedBy === undefined) {
      finish(choice);
      return;
    }
    const replaced = replaceSeparated(
      field.value,
      field.selectionStart ?? field.value.length,
      choice,
      options.separatedBy,
    );
    finish(replaced.value);
  };

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    closeList();
    host.innerHTML = held;
    options.onCancel?.();
  };

  field.addEventListener('input', () => {
    // Escribir deshace la elección: lo resaltado era una respuesta a otra
    // pregunta. Enter con nada resaltado vale lo escrito, que es lo que quien
    // teclea un nombre nuevo espera que pase.
    highlighted = -1;
    fresh = false;
    draw();
  });

  field.addEventListener('blur', () => finish(field.value));

  field.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (shown.length === 0) {
        if (event.key === 'ArrowDown') draw();
        return;
      }
      event.preventDefault();
      /*
       * Las flechas pasan por «ninguna».
       *
       * Los estados son las opciones más una: la de no haber elegido, que es
       * donde vale lo escrito. Sin ella, bajar desde el último saltaría al
       * primero y no habría forma de volver a lo tecleado sin borrar una letra
       * —justo lo que hace quien escribe un nombre que todavía no existe.
       */
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const states = shown.length + 1;
      highlighted = ((highlighted + 1 + step + states) % states) - 1;
      draw();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = shown[highlighted]?.value;
      if (chosen === undefined) finish(field.value);
      else finishChoice(chosen);
      return;
    }
    if (event.key === 'Tab' && highlighted >= 0) {
      // Completar sin cerrar: se rellena el campo y se sigue.
      event.preventDefault();
      const chosen = shown[highlighted]?.value;
      if (chosen !== undefined && options.separatedBy !== undefined) {
        const replaced = replaceSeparated(
          field.value,
          field.selectionStart ?? field.value.length,
          chosen,
          options.separatedBy,
        );
        field.value = replaced.value;
        field.setSelectionRange(replaced.cursor, replaced.cursor);
      } else {
        field.value = chosen ?? field.value;
      }
      highlighted = -1;
      draw();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // La lista primero y el campo después: con la lista abierta, Escape es lo
      // que se pulsa para dejar de verla, no para renunciar a lo escrito.
      if (list !== null) {
        closeList();
        return;
      }
      cancel();
    }
  });

  // Con lo que se ofrece ya sabido, la lista se abre con el campo: quien pulsa
  // una celda para cambiarla no debería tener que pulsar otra cosa para ver
  // entre qué puede elegir. Cuando llega después, la abre `offer`.
  if (choices.length > 0) draw();

  return {
    offer(next: readonly Choice[]): void {
      if (settled) return;
      choices = next;
      // Sólo se abre sola si nadie ha escrito todavía: la lista llega tarde y no
      // puede tapar lo que se esté tecleando en ese momento.
      if (document.activeElement === field) draw();
    },
  };
}
