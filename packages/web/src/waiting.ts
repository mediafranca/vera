// Lo que está pasando ahora, y cuánto lleva pasando.
//
// El panel de procesar tiene decidido desde el principio que no se anima: «lo
// que cuenta no es que algo avanza —para eso basta una animación, y una
// animación miente cuando el proceso se cuelga— sino qué está haciendo». Eso
// sigue siendo verdad y esto no lo contradice; lo completa.
//
// Porque faltaba la otra mitad: un paso que lleva doce segundos se veía idéntico
// a uno que lleva doscientos milisegundos, y el silencio entre dos líneas no se
// distinguía de un proceso muerto. Lo que se añade no es movimiento sino un
// número que sube, y un número que sube no puede mentir: si el proceso se
// cuelga, el número sigue subiendo, y eso es exactamente la verdad —sigue
// esperando—. Una rueda girando dice lo mismo esté viva o muerta.
//
// Y lo que tarda se recuerda. La segunda vez que se llama al modelo local, Vera
// ya sabe cuánto tardó las anteriores y lo dice: «6 s · suele tardar ~20 s».
// Convierte una espera desconocida en una esperada, que es casi todo el
// malestar. Es medido y no inventado: nunca un porcentaje, que sería fingir que
// se sabe cuánto falta.

/** Dónde se recuerda cuánto tardó cada cosa. */
const STORE = 'vera.durations';

/** Cuántas medidas se guardan de cada paso. Las suficientes para una mediana. */
const REMEMBERED = 7;

/**
 * Antes de esto, nada.
 *
 * Un contador que aparece en cada paso instantáneo convierte el registro en un
 * parpadeo de números. Lo que hay que ver es lo que tarda, y lo que tarda menos
 * de un segundo no tarda.
 */
const THRESHOLD = 900;

// Una sola conciencia periférica para todas las esperas visibles. No explica el
// trabajo —eso sigue ocurriendo junto al gesto—: sólo hace perceptible que Vera
// todavía sostiene algo. El contador evita que dos procesos simultáneos apaguen
// el marco cuando termina sólo uno de ellos.
let activeWork = 0;
let slowWork: ReturnType<typeof setTimeout> | null = null;

export function beginActivity(): () => void {
  let open = true;
  activeWork += 1;
  if (activeWork === 1 && typeof document !== 'undefined') {
    document.documentElement.dataset['working'] = 'true';
    slowWork = setTimeout(() => {
      if (activeWork > 0) document.documentElement.dataset['workingSlow'] = 'true';
    }, THRESHOLD);
  }
  return () => {
    if (!open) return;
    open = false;
    activeWork = Math.max(0, activeWork - 1);
    if (activeWork > 0 || typeof document === 'undefined') return;
    if (slowWork !== null) clearTimeout(slowWork);
    slowWork = null;
    delete document.documentElement.dataset['working'];
    delete document.documentElement.dataset['workingSlow'];
  };
}

type Durations = Record<string, number[]>;

function stored(): Durations {
  try {
    const said = localStorage.getItem(STORE);
    return said === null ? {} : (JSON.parse(said) as Durations);
  } catch {
    return {};
  }
}

/** Cuánto suele tardar esto, en milisegundos, o null si nunca se ha medido. */
export function usuallyTakes(key: string): number | null {
  const held = stored()[key] ?? [];
  if (held.length === 0) return null;
  /*
   * La mediana y no la media.
   *
   * Una llamada al modelo que un día se fue a noventa segundos porque la máquina
   * estaba ocupada no debe cambiar lo que se le promete a nadie las veinte veces
   * siguientes. La mediana la ignora; la media la arrastra.
   */
  const sorted = [...held].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Cómo salió lo que se estaba esperando.
 *
 * Importa para recordar: sólo se anota lo que terminó bien. Un proceso que falló
 * al segundo segundo no tardó dos segundos en hacerse —tardó dos segundos en
 * fallar—, y guardarlo como lo primero prometería una velocidad que Vera no tiene.
 * Ver rule RememberWhatTheWorkTook en specs/waiting.allium.
 */
export type Outcome = 'succeeded' | 'failed';

/** Anota lo que tardó, para poder decirlo la próxima vez. */
export function remember(key: string, took: number): void {
  if (key === '' || took < THRESHOLD) return;
  try {
    const all = stored();
    const held = [...(all[key] ?? []), Math.round(took)];
    all[key] = held.slice(-REMEMBERED);
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    // Sin almacenamiento se sigue contando; sólo se pierde la memoria de ayer.
  }
}

/** Segundos, dichos como los diría alguien. */
export function saySeconds(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * Lo que se lee de una espera en curso: cuánto lleva, y cuánto suele durar.
 *
 * Devuelve la cadena vacía mientras no haya nada que decir, que es el umbral
 * hecho valor de retorno: quien la use no tiene que acordarse de la regla.
 */
export function elapsedSaid(took: number, key: string | null): string {
  if (took < THRESHOLD) return '';
  const usual = key === null ? null : usuallyTakes(key);
  /*
   * Lo que suele tardar se dice mientras se está dentro de lo normal, y se calla
   * cuando se pasa: repetir «suele tardar 20 s» en el segundo cuarenta es la
   * máquina insistiendo en algo que ya no es cierto, y quien mira lo lee como
   * burla. A partir de ahí sólo queda el número, que es lo que hay.
   */
  const say = usual !== null && took < usual * 1.5 ? ` · suele tardar ~${saySeconds(usual)}` : '';
  return `${saySeconds(took)}${say}`;
}

/**
 * Contar dentro de un elemento cualquiera.
 *
 * `pendingLine` cuenta en el registro de procesar, que es una lista de pasos. Casi
 * todas las esperas de Vera no son eso: son un botón que se quedó pulsado, una
 * pregunta que aún no tiene respuesta, una página que todavía no llega. Este es el
 * mismo mecanismo sin la lista.
 *
 * El elemento pasa a ser suyo mientras dura: se le escribe el texto entero. La
 * cuenta aparece donde estaba la mano —el botón que se pulsó, el sitio donde va a
 * salir la respuesta— y no en un rincón de estado de la máquina. @guarantee
 * TheCountIsWhereTheGestureWas.
 */
export interface Counting {
  /** Cuánto lleva. */
  elapsed(): number;
  /** Se acabó. Anota lo que tardó si salió bien, y deja de escribir. */
  close(outcome?: Outcome): void;
}

export function countInto(
  element: HTMLElement,
  label: string,
  key: string | null = null,
  options: {
    now?: () => number;
    /**
     * Desde cuándo se cuenta, si el trabajo empezó antes que la cuenta.
     *
     * Lo que se espera de una página empieza a esperarse al pedirla, y el aviso
     * sólo se pinta si tarda. Contando desde el aviso, una espera de cuatro
     * segundos se anunciaría como de tres, y la que Vera recordara sería la que
     * no ocurrió.
     */
    since?: number;
  } = {},
): Counting {
  const endActivity = beginActivity();
  const now = options.now ?? Date.now;
  const started = options.since ?? now();
  let ticking: ReturnType<typeof setInterval> | null = null;

  const draw = (): void => {
    const said = elapsedSaid(now() - started, key);
    element.textContent = said === '' ? label : label === '' ? said : `${label} · ${said}`;
  };

  // Cifras de ancho fijo mientras cuenta: sin esto el número empuja lo que tenga
  // al lado al pasar de 9 a 10, y un renglón que se mueve solo es una animación
  // disfrazada, que es justamente lo que esto viene a no hacer.
  element.classList.add('counting');
  draw();
  // Cada medio segundo y no cada segundo: con un segundo justo, el número salta
  // de 3 a 5 cuando el reloj y la cuenta van desfasados.
  ticking = setInterval(draw, 500);

  return {
    elapsed: () => now() - started,
    close(outcome = 'succeeded') {
      if (ticking !== null) clearInterval(ticking);
      ticking = null;
      element.classList.remove('counting');
      if (key !== null && outcome === 'succeeded') remember(key, now() - started);
      endActivity();
    },
  };
}

/**
 * La línea de abajo del registro: qué se está esperando, y desde cuándo.
 *
 * Vive al final y siempre al final: lo que se ha hecho se acumula encima y lo
 * que falta está en un solo sitio, que es donde se mira. Cuando el proceso
 * termina, se va —una línea de espera que sobrevive al proceso es la peor forma
 * de mentir, porque parece que sigue habiendo algo—.
 */
export interface Pending {
  /**
   * Cambia lo que se está esperando y reinicia la cuenta.
   *
   * `key` es cómo se recuerda: dos llamadas al modelo local son la misma espera
   * aunque su texto diga «parte 2 de 3», y tienen que promediarse juntas.
   *
   * Sin `key` se cuenta y no se recuerda, y eso no es pereza sino la regla:
   * **se cuenta siempre y se recuerda sólo lo que se puede nombrar**. Entre dos
   * hitos, lo que el servidor está haciendo es una conjetura de quien mira; si
   * esa conjetura se guardara como medida, Vera acabaría prometiendo «suele
   * tardar 12 s» de una espera que era de otra cosa. Contar no puede
   * equivocarse —el tiempo pasó— y nombrar sí.
   */
  say(text: string, key?: string | null, outcome?: Outcome): void;
  /** Cuánto lleva esperándose lo de ahora. */
  elapsed(): number;
  /**
   * Se acabó. Anota lo que tardó lo último —si salió bien— y quita la línea.
   *
   * Lo que se cortó a mitad no se anota: si perder la conexión al segundo tres
   * contara como una medida, unas cuantas caídas convencerían a Vera de que
   * procesar una página tarda tres segundos, y lo prometería.
   */
  close(outcome?: Outcome): void;
  /** El elemento, para poder insertar los pasos hechos por encima de él. */
  element: HTMLElement;
}

export function pendingLine(host: HTMLElement, now: () => number = Date.now): Pending {
  const endActivity = beginActivity();
  const line = document.createElement('li');
  line.className = 'process-step doing pending';
  const what = document.createElement('span');
  const elapsed = document.createElement('span');
  elapsed.className = 'process-elapsed';
  line.append(what, elapsed);
  host.append(line);

  let started = now();
  /** Nulo cuando lo que se espera no se sabe nombrar, y entonces no se recuerda. */
  let key: string | null = null;
  let ticking: ReturnType<typeof setInterval> | null = null;

  const draw = (): void => {
    const said = elapsedSaid(now() - started, key);
    elapsed.textContent = said === '' ? '' : ` … ${said}`;
  };

  return {
    element: line,
    elapsed: () => now() - started,
    say(text, next = null, outcome = 'succeeded') {
      if (key !== null && outcome === 'succeeded') remember(key, now() - started);
      key = next;
      started = now();
      what.textContent = text;
      elapsed.textContent = '';
      if (ticking !== null) clearInterval(ticking);
      // Cada medio segundo y no cada segundo: con un segundo justo, el número
      // salta de 3 a 5 cuando el reloj y la cuenta van desfasados.
      ticking = setInterval(draw, 500);
      draw();
    },
    close(outcome = 'succeeded') {
      // Idempotente: se cierra desde el `finally` y puede haberse cerrado antes
      // en una salida temprana, y anotar dos veces la misma espera falsearía la
      // memoria de cuánto tarda.
      if (key !== null && outcome === 'succeeded') remember(key, now() - started);
      key = null;
      if (ticking !== null) clearInterval(ticking);
      ticking = null;
      line.remove();
      endActivity();
    },
  };
}
