// Sistema de diseño de Vera.
//
// @guarantee EditableDesignSystem: los tokens se editan desde dentro de Vera y
// siguen siendo fuente legible, no estado opaco de la aplicación. Las hojas CSS
// gobernadas viven en páginas del corpus; ver governed-stylesheet.allium.
//
// @invariant DualColourScheme: cada token declara su valor claro y su oscuro.

/** Qué clase de valor es, para saber con qué control se edita. */
export type TokenKind = 'color' | 'font' | 'text';

export interface DesignToken {
  name: string;
  light: string;
  dark: string;
}

const PLEX_SANS = "'IBM Plex Sans', system-ui, sans-serif";
const PLEX_MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

/** Las pilas que Vera sirve, para ofrecerlas en vez de pedir que se escriban. */
export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'IBM Plex Sans', value: PLEX_SANS },
  { label: 'IBM Plex Mono', value: PLEX_MONO },
  { label: 'la del sistema', value: 'system-ui, sans-serif' },
  { label: 'serif del sistema', value: 'Georgia, "Times New Roman", serif' },
  { label: 'monoespaciada del sistema', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

/**
 * De qué clase es cada token.
 *
 * Se deduce del valor y no de una lista aparte, para que un token nuevo nazca
 * con el control correcto sin que nadie tenga que acordarse de registrarlo.
 */
export function kindOf(token: DesignToken): TokenKind {
  if (token.name.startsWith('--font-')) return 'font';
  if (/^#[0-9a-f]{3,8}$/i.test(token.light.trim())) return 'color';
  return 'text';
}

/*
 * La reserva del sistema de diseño.
 *
 * No son valores neutros de fábrica: son los que Herbert ajustó usando Vera y
 * dejó fijados el 8 de agosto de 2026 —fondo ciruela en oscuro, verde pálido en
 * los nodos, naranja quemado de acento—. @guarantee EditableDesignSystem dice
 * que el sistema se ajusta desde dentro; esto es el otro extremo del mismo
 * gesto: lo ajustado vuelve al código, así que una instancia nueva y un
 * navegador sin nada guardado nacen ya con el aspecto de Vera y no con un gris
 * de biblioteca.
 *
 * Quien tenga tokens propios guardados no se entera: `loadTokens` los superpone
 * a éstos token a token. Esto es lo que se ve cuando no hay nada superpuesto, y
 * es también a lo que vuelve «restablecer».
 */
export const DEFAULT_TOKENS: DesignToken[] = [
  { name: '--bg', light: '#e6ebe9', dark: '#2e0024' },
  { name: '--bg-raised', light: '#e8ebf1', dark: '#351725' },
  { name: '--text', light: '#454f6e', dark: '#cde0cf' },
  { name: '--text-dim', light: '#6b7080', dark: '#a4a696' },
  { name: '--rule', light: '#d1d1d2', dark: '#24001c' },
  { name: '--accent', light: '#a84a0b', dark: '#ee895d' },
  { name: '--node-central', light: '#045591', dark: '#ec5f22' },
  { name: '--node-fill', light: '#393a3c', dark: '#acc8af' },
  { name: '--link-stroke', light: '#c5c8c1', dark: '#54273c' },
  // Las dos direcciones de un enlace, con un color cada una.
  //
  // Una arista sin dirección dice que dos páginas se tocan y calla lo único que
  // hace falta saber: quién nombró a quién. El par se usa en los dos sitios
  // donde esa pregunta aparece —el filete de «La nombran» y «Nombra a» al pie de
  // la página, y las aristas que se encienden al señalar un nodo del mapa— para
  // que el código de color se aprenda en uno y sirva en el otro.
  //
  // Lo entrante va frío y lo saliente cálido: lo que sale de esta página es de
  // esta página, y por eso lleva el calor del acento.
  { name: '--link-in', light: '#045591', dark: '#6fa8d0' },
  { name: '--link-out', light: '#a84a0b', dark: '#ee895d' },
  { name: '--warm', light: '#e6706a', dark: '#ec9d98' },
  // Grabando. El rojo se reserva para cuando la grabación está corriendo, que
  // es lo que significa en toda grabadora desde antes de que existiera esta
  // aplicación. En reposo el botón va perfilado: un rojo permanente deja de
  // decir nada por costumbre, y entonces no queda color con que avisar el día
  // que hace falta saber de un vistazo si se está oyendo.
  { name: '--voice', light: '#c0392b', dark: '#e05545' },
  // Cuánto se agranda todo en una pantalla de teléfono.
  //
  // Un token y no un número en la hoja: la talla cómoda depende del aparato y de
  // la vista de quien lo sostiene, y esto es exactamente la clase de cosa que
  // @guarantee EditableDesignSystem existe para poder ajustar sin recompilar.
  // Multiplica el tamaño de base, así que arrastra todo lo medido en `rem` — la
  // interfaz y el texto a la vez, que es como debe crecer.
  { name: '--phone-scale', light: '1.35', dark: '1.35' },
  // De qué tamaño se lee.
  //
  // Un token porque es la primera cosa que alguien quiere ajustar y la última
  // que debería pedir recompilar. Rige el texto y sólo el texto: la interfaz la
  // mide `--phone-scale` sobre la raíz, que son dos cosas distintas aunque
  // durante un tiempo pareciera que eran una.
  { name: '--text-size', light: '16px', dark: '16px' },
  // La interlínea: cada cuánto cae una línea de texto.
  //
  // Es la retícula de base de toda la aplicación. De ella salen el ritmo de la
  // prosa y también el aire de lo que la interrumpe: un encabezado se separa de
  // lo anterior exactamente una línea, y así lo que empieza abajo sigue cayendo
  // donde habría caído. Sin número aquí, ese ritmo lo fijaban ocho valores
  // sueltos repartidos por la hoja y ajustarlo pedía recompilar.
  //
  // Sin unidad, para que multiplique al tamaño de letra de cada sitio: 1.55 en
  // el cuerpo son 1.55 veces 16 px, y en un teléfono, 1.55 veces lo que
  // `--phone-scale` haya dejado.
  { name: '--line-height', light: '1.55', dark: '1.55' },
  // Hasta dónde llega una línea de prosa.
  //
  // Una línea muy ancha se lee mal: el ojo pierde el comienzo de la siguiente al
  // volver del final de la anterior. Con el texto a pantalla completa las líneas
  // llegaban al borde. No lo cumplen las tablas, las imágenes, los diagramas ni
  // el código, que necesitan el ancho que necesitan y no son prosa.
  { name: '--content-width', light: '45em', dark: '45em' },
  // Cuánto se mete hacia dentro cada nivel del esquema.
  //
  // Un token porque la talla cómoda depende de la pantalla: en un teléfono, todo
  // está medido en `rem` y `--phone-scale` lo agranda, así que un nivel cuesta
  // ahí casi el doble de píxeles que en un escritorio y cuatro niveles se comen
  // media columna. La hoja lo encoge sola en pantallas estrechas —ver
  // `--indent-scale` en styles.css—; este número es el de partida.
  { name: '--indent', light: '1.25rem', dark: '1.25rem' },
  // La reserva del sistema no sobra: el subconjunto latino que Vera sirve no
  // cubre el griego ni el árabe que el corpus también trae, y es mejor que se
  // lean en otra letra a que no se lean.
  { name: '--font-body', light: PLEX_SANS, dark: PLEX_SANS },
  { name: '--font-ui', light: 'system-ui, sans-serif', dark: PLEX_SANS },
  { name: '--font-mono', light: PLEX_MONO, dark: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

const TOKENS_KEY = 'vera.tokens';
const SCHEME_KEY = 'vera.scheme';
const PUBLIC_SCHEME_KEY = 'vera.publicScheme';
const PUBLIC_VIEW_KEY = 'vera.publicGraphView';
const FRONT_MATTER_KEY = 'vera.frontMatterOpen';
const DIVIDER_KEY = 'vera.divider';
const LAYOUT_KEY = 'vera.layout';
const VIEW_KEY = 'vera.graphView';
const REACH_KEY = 'vera.graphReach';
const JOURNALS_KEY = 'vera.graphJournals';

export type ColourScheme = 'light' | 'dark';
export type WorkspaceLayout = 'text_only' | 'graph_only' | 'split';
export type GraphViewMode = 'graph_2d' | 'graph_3d' | 'graph_d4';

/**
 * Los tokens de este participante.
 *
 * Lo guardado se superpone a los valores por defecto, no los reemplaza. Antes se
 * devolvía la lista guardada tal cual, así que un token nuevo —`--content-width`
 * fue el primero— no existía para nadie que ya hubiera tocado su tema: ni se
 * aplicaba ni aparecía en Ajustes. Ahora un token nuevo nace con su valor por
 * defecto sin que nadie pierda lo que ajustó.
 *
 * También descarta los que ya no existen: un token retirado del código deja de
 * arrastrarse en el navegador de quien lo tuviera guardado.
 */
export function loadTokens(): DesignToken[] {
  const held = localStorage.getItem(TOKENS_KEY);
  if (held === null) return structuredClone(DEFAULT_TOKENS);
  try {
    const saved = JSON.parse(held) as DesignToken[];
    if (!Array.isArray(saved)) return structuredClone(DEFAULT_TOKENS);
    const byName = new Map(saved.filter((t) => typeof t?.name === 'string').map((t) => [t.name, t]));
    return DEFAULT_TOKENS.map((token) => {
      const mine = byName.get(token.name);
      return mine === undefined
        ? { ...token }
        : {
            name: token.name,
            light: typeof mine.light === 'string' ? mine.light : token.light,
            dark: typeof mine.dark === 'string' ? mine.dark : token.dark,
          };
    });
  } catch {
    return structuredClone(DEFAULT_TOKENS);
  }
}

export function saveTokens(tokens: DesignToken[]): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  // Y viajan. El sistema de diseño es de quien lo ajustó, no del aparato desde
  // el que lo ajustó. Si el servidor no responde no pasa nada: lo local ya está
  // escrito y se reintentará al próximo cambio.
  void push({ designTokens: JSON.stringify(tokens) });
}

/**
 * Lo recordado del participante, guardado en el servidor.
 *
 * Se escribe sin esperar respuesta y sin avisar de un fallo: es preferencia, no
 * contenido. Que se pierda un ajuste porque el servidor estaba caído es
 * molesto; interrumpir a quien escribe para contárselo lo sería más.
 */
async function push(patch: Record<string, unknown>): Promise<void> {
  try {
    await fetch('/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    // Sin conexión con el servidor. Lo local sigue en pie.
  }
}

export interface RemotePresentation {
  layout: WorkspaceLayout;
  dividerPosition: number;
  graphView: GraphViewMode;
  colourScheme: ColourScheme;
  designTokens: string | null;
  graphReach?: number;
}

/**
 * Trae lo recordado y lo deja en local.
 *
 * El arranque no espera a esto: dibuja con lo que hay en el navegador —que es
 * instantáneo y casi siempre correcto— y esto llega después. Es lo que evita
 * que abrir Vera empiece con un destello del tema equivocado mientras se
 * consulta al servidor, y lo que la deja usable sin él.
 *
 * Devuelve si algo cambió, para que quien llama repinte sólo entonces.
 */
export async function syncPresentation(): Promise<boolean> {
  let remote: RemotePresentation;
  try {
    const answer = await fetch('/workspace');
    if (!answer.ok) return false;
    remote = (await answer.json()) as RemotePresentation;
  } catch {
    return false;
  }

  let changed = false;
  const adopt = (key: string, value: string): void => {
    if (localStorage.getItem(key) === value) return;
    localStorage.setItem(key, value);
    changed = true;
  };

  if (remote.designTokens !== null) adopt(TOKENS_KEY, remote.designTokens);
  adopt(SCHEME_KEY, remote.colourScheme);
  adopt(LAYOUT_KEY, remote.layout);
  adopt(VIEW_KEY, remote.graphView);
  adopt(DIVIDER_KEY, String(remote.dividerPosition));
  if (typeof remote.graphReach === 'number') adopt(REACH_KEY, String(remote.graphReach));
  return changed;
}

export function applyTokens(tokens: DesignToken[], scheme: ColourScheme): void {
  const root = document.documentElement;
  for (const token of tokens) {
    root.style.setProperty(token.name, scheme === 'dark' ? token.dark : token.light);
  }
  root.dataset['scheme'] = scheme;
}

/**
 * @guarantee RememberedSessionPresentation. La vista dividida arranca repartida
 * por igual cuando no hay preferencia guardada; después se recuerda.
 */
export const session = {
  // No pertenece a una página: es cómo esta persona decidió leer todas.
  // Ausente significa cerrado, que sigue siendo el estado inicial sobrio. Una
  // vez tocado, nada salvo el mismo interruptor vuelve a decidir por ella.
  frontMatterOpen: (): boolean => localStorage.getItem(FRONT_MATTER_KEY) === 'true',
  setFrontMatterOpen: (open: boolean) => localStorage.setItem(FRONT_MATTER_KEY, String(open)),

  scheme: (): ColourScheme =>
    (localStorage.getItem(SCHEME_KEY) as ColourScheme | null) ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  setScheme: (scheme: ColourScheme) => {
    localStorage.setItem(SCHEME_KEY, scheme);
    void push({ colourScheme: scheme });
  },

  // La lectura pública nace oscura y recuerda su elección sólo en este origen.
  // No comparte ni escribe la preferencia del dueño.
  publicScheme: (): ColourScheme =>
    (localStorage.getItem(PUBLIC_SCHEME_KEY) as ColourScheme | null) ?? 'dark',
  setPublicScheme: (scheme: ColourScheme) => localStorage.setItem(PUBLIC_SCHEME_KEY, scheme),

  // La cara publicada nace como mapa espacial. Su elección se recuerda sólo
  // para lectores anónimos y no pisa la vista de trabajo del dueño.
  publicGraphView: (): GraphViewMode =>
    (localStorage.getItem(PUBLIC_VIEW_KEY) as GraphViewMode | null) ?? 'graph_3d',
  setPublicGraphView: (view: GraphViewMode) => localStorage.setItem(PUBLIC_VIEW_KEY, view),

  divider: (): number => Number(localStorage.getItem(DIVIDER_KEY) ?? '0.5'),
  setDivider: (at: number) => {
    localStorage.setItem(DIVIDER_KEY, String(at));
    void push({ dividerPosition: at });
  },

  layout: (): WorkspaceLayout =>
    (localStorage.getItem(LAYOUT_KEY) as WorkspaceLayout | null) ?? 'split',
  setLayout: (layout: WorkspaceLayout) => {
    localStorage.setItem(LAYOUT_KEY, layout);
    void push({ layout });
  },

  /**
   * Cuántos saltos alcanza el mapa desde la página en foco: uno, dos o tres.
   * Un cuatro guardado de antes se recorta a tres en vez de descartarse, que es
   * lo que quería decir quien lo dejó ahí: lo más lejos que se pueda.
   */
  reach: (): number => {
    const held = Number(localStorage.getItem(REACH_KEY) ?? '2');
    if (!Number.isFinite(held)) return 2;
    return Math.min(3, Math.max(1, Math.round(held)));
  },
  setReach: (hops: number) => {
    localStorage.setItem(REACH_KEY, String(hops));
    void push({ graphReach: hops });
  },

  /** Los días no pueblan la vecindad; el interruptor sólo permite ver el día en foco. */
  graphJournals: (): boolean => localStorage.getItem(JOURNALS_KEY) === 'true',
  setGraphJournals: (shown: boolean) => localStorage.setItem(JOURNALS_KEY, String(shown)),

  graphView: (): GraphViewMode =>
    (localStorage.getItem(VIEW_KEY) as GraphViewMode | null) ?? 'graph_2d',
  setGraphView: (view: GraphViewMode) => {
    localStorage.setItem(VIEW_KEY, view);
    void push({ graphView: view });
  },
};
