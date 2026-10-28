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

export const DESIGN_LIBRARY_FORMAT = 'vera.designs';
export const DESIGN_LIBRARY_VERSION = 1;
export const DEFAULT_DESIGN_NAME = 'Vera';

export interface SavedDesign {
  id: string;
  name: string;
  tokens: DesignToken[];
}

export interface DesignLibrary {
  format: typeof DESIGN_LIBRARY_FORMAT;
  version: typeof DESIGN_LIBRARY_VERSION;
  active: string;
  designs: SavedDesign[];
}

// @guarantee NamedDesignsAreOperable: la biblioteca es de la persona, un
// diseño reúne los dos esquemas y la selección nunca se confunde con el esquema
// que el dispositivo muestra ahora.

export const DESIGN_TOKEN_PACKAGE_FORMAT = 'vera.design-tokens';
export const DESIGN_TOKEN_PACKAGE_VERSION = 1;

export interface DesignTokenPackage {
  format: typeof DESIGN_TOKEN_PACKAGE_FORMAT;
  version: typeof DESIGN_TOKEN_PACKAGE_VERSION;
  exportedAt: string;
  name: string;
  tokens: DesignToken[];
}

export type TokenImportMode = 'new' | 'merge' | 'replace';

export interface ParsedDesignTokenPackage {
  package: DesignTokenPackage;
  supported: DesignToken[];
  unsupported: string[];
}

export interface DesignTokenChange {
  name: string;
  before: { light: string; dark: string };
  after: { light: string; dark: string };
}

export interface DesignTokenImportPlan {
  mode: TokenImportMode;
  tokens: DesignToken[];
  changes: DesignTokenChange[];
  unsupported: string[];
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
 * dejó fijados el 15 de octubre de 2026 —fondo ciruela en oscuro, verde pálido en
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
  { name: '--bg-raised', light: '#e8ebf1', dark: '#390e30' },
  { name: '--text', light: '#454f6e', dark: '#cde0cf' },
  { name: '--text-dim', light: '#6b7080', dark: '#a4a696' },
  { name: '--rule', light: '#454f6e21', dark: '#5220606e' },
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
  { name: '--text-size', light: '15px', dark: '16px' },
  // La interlínea: cada cuánto cae una línea de texto.
  //
  // Es la retícula de base de toda la aplicación. De ella salen el ritmo de la
  // prosa y también el aire de lo que la interrumpe: un encabezado se separa de
  // lo anterior exactamente una línea, y así lo que empieza abajo sigue cayendo
  // donde habría caído. Sin número aquí, ese ritmo lo fijaban ocho valores
  // sueltos repartidos por la hoja y ajustarlo pedía recompilar.
  //
  // Sin unidad, para que multiplique al tamaño de letra de cada sitio: 1.744 en
  // el cuerpo son 1.744 veces el tamaño vigente, y en un teléfono, 1.744 veces lo que
  // `--phone-scale` haya dejado.
  { name: '--line-height', light: '1.744', dark: '1.744' },
  // Hasta dónde llega una línea de prosa.
  //
  // Una línea muy ancha se lee mal: el ojo pierde el comienzo de la siguiente al
  // volver del final de la anterior. Con el texto a pantalla completa las líneas
  // llegaban al borde. No lo cumplen las tablas, las imágenes, los diagramas ni
  // el código, que necesitan el ancho que necesitan y no son prosa.
  { name: '--content-width', light: '45em', dark: '40em' },
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

const IMPORT_BACKUP_KEY = 'vera.tokens.importBackup';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A token travels as text, but it cannot carry another resource or escape into
 * a second CSS declaration. `style.setProperty` already keeps the value inside
 * one property; these checks also make the portable file safe to inspect and
 * apply in older clients that may serialise it differently.
 */
function safeTokenValue(value: unknown, token: DesignToken): value is string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) return false;
  if (/[\u0000-\u001f\u007f{};]/.test(value) || /url\s*\(|@import/i.test(value)) return false;
  if (kindOf(token) === 'color') return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value.trim());
  return true;
}

export function designTokenPackage(
  tokens: DesignToken[],
  exportedAt = new Date(),
  name = DEFAULT_DESIGN_NAME,
): DesignTokenPackage {
  return {
    format: DESIGN_TOKEN_PACKAGE_FORMAT,
    version: DESIGN_TOKEN_PACKAGE_VERSION,
    exportedAt: exportedAt.toISOString(),
    name,
    tokens: tokens.map((token) => ({ ...token })),
  };
}

export function serialiseDesignTokenPackage(
  tokens: DesignToken[],
  exportedAt = new Date(),
  name = DEFAULT_DESIGN_NAME,
): string {
  return `${JSON.stringify(designTokenPackage(tokens, exportedAt, name), null, 2)}\n`;
}

/**
 * Lee primero y no toca estado. Ésta es la puerta común de la importación y del
 * respaldo de deshacer, para que ninguno pueda saltarse la validación.
 */
export function parseDesignTokenPackage(source: string): ParsedDesignTokenPackage {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  if (!isRecord(value) || value['format'] !== DESIGN_TOKEN_PACKAGE_FORMAT) {
    throw new Error('El archivo no es un respaldo de tokens de Vera.');
  }
  if (value['version'] !== DESIGN_TOKEN_PACKAGE_VERSION) {
    throw new Error(`Vera no conoce la versión ${String(value['version'])} de este respaldo.`);
  }
  if (typeof value['exportedAt'] !== 'string' || !Number.isFinite(Date.parse(value['exportedAt']))) {
    throw new Error('El respaldo no declara una fecha de exportación válida.');
  }
  if (!Array.isArray(value['tokens']) || value['tokens'].length === 0) {
    throw new Error('El respaldo no contiene tokens.');
  }

  const defaults = new Map(DEFAULT_TOKENS.map((token) => [token.name, token]));
  const seen = new Set<string>();
  const supported: DesignToken[] = [];
  const unsupported: string[] = [];

  for (const entry of value['tokens']) {
    if (!isRecord(entry) || typeof entry['name'] !== 'string') {
      throw new Error('El respaldo contiene un token sin nombre.');
    }
    const name = entry['name'];
    if (seen.has(name)) throw new Error(`El token ${name} aparece más de una vez.`);
    seen.add(name);

    const known = defaults.get(name);
    if (known === undefined) {
      unsupported.push(name);
      continue;
    }
    if (!safeTokenValue(entry['light'], known) || !safeTokenValue(entry['dark'], known)) {
      throw new Error(`El token ${name} contiene un valor claro u oscuro inválido.`);
    }
    supported.push({ name, light: entry['light'].trim(), dark: entry['dark'].trim() });
  }
  if (supported.length === 0) {
    throw new Error('El respaldo no contiene ningún token compatible con esta versión de Vera.');
  }

  return {
    package: {
      format: DESIGN_TOKEN_PACKAGE_FORMAT,
      version: DESIGN_TOKEN_PACKAGE_VERSION,
      exportedAt: value['exportedAt'],
      name: typeof value['name'] === 'string' && value['name'].trim() !== ''
        ? value['name'].trim()
        : DEFAULT_DESIGN_NAME,
      tokens: supported.map((token) => ({ ...token })),
    },
    supported,
    unsupported,
  };
}

export function planDesignTokenImport(
  current: DesignToken[],
  imported: ParsedDesignTokenPackage,
  mode: TokenImportMode,
): DesignTokenImportPlan {
  const base = mode === 'merge' ? current : DEFAULT_TOKENS;
  const incoming = new Map(imported.supported.map((token) => [token.name, token]));
  const tokens = base.map((token) => ({ ...(incoming.get(token.name) ?? token) }));
  const before = new Map(current.map((token) => [token.name, token]));
  const changes = tokens.flatMap((token): DesignTokenChange[] => {
    const held = before.get(token.name);
    if (held === undefined || (held.light === token.light && held.dark === token.dark)) return [];
    return [{
      name: token.name,
      before: { light: held.light, dark: held.dark },
      after: { light: token.light, dark: token.dark },
    }];
  });
  return { mode, tokens, changes, unsupported: [...imported.unsupported] };
}

export function saveTokenImportBackup(tokens: DesignToken[]): void {
  localStorage.setItem(IMPORT_BACKUP_KEY, serialiseDesignTokenPackage(tokens));
}

export function loadTokenImportBackup(): DesignToken[] | null {
  const held = localStorage.getItem(IMPORT_BACKUP_KEY);
  if (held === null) return null;
  try {
    return parseDesignTokenPackage(held).supported;
  } catch {
    return null;
  }
}

export function clearTokenImportBackup(): void {
  localStorage.removeItem(IMPORT_BACKUP_KEY);
}

const TOKENS_KEY = 'vera.tokens';
const DESIGNS_KEY = 'vera.designs';
const SCHEME_KEY = 'vera.scheme';
const PUBLIC_SCHEME_KEY = 'vera.publicScheme';
const PUBLIC_VIEW_KEY = 'vera.publicGraphView';
const FRONT_MATTER_KEY = 'vera.frontMatterOpen';
const DIVIDER_KEY = 'vera.divider';
const LAYOUT_KEY = 'vera.layout';
const VIEW_KEY = 'vera.graphView';
const REACH_KEY = 'vera.graphReach';
const JOURNALS_KEY = 'vera.graphJournals';
const AUTO_ROTATE_KEY = 'vera.graphAutoRotate';

export type ColourScheme = 'light' | 'dark';
export type WorkspaceLayout = 'text_only' | 'graph_only' | 'split';
export type GraphViewMode = 'graph_2d' | 'graph_3d' | 'graph_d4';

/**
 * D4 siempre entra por el anillo inmediato.
 *
 * Es una frontera de coste y no una preferencia de presentación: una consulta
 * que era razonable en 2D o 3D puede ser demasiado pesada al componer todas las
 * columnas y conectivas de D4. Una vez entregado el primer anillo, la persona
 * conserva el control y puede ampliar el alcance normalmente.
 */
export function reachForGraphViewChange(
  from: GraphViewMode,
  to: GraphViewMode,
  reach: number,
): number {
  return to === 'graph_d4' && from !== 'graph_d4' ? 1 : reach;
}

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
function normaliseTokens(value: unknown): DesignToken[] {
  try {
    const saved = typeof value === 'string' ? JSON.parse(value) as unknown : value;
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

function safeDesignName(wanted: string, held: readonly SavedDesign[], except?: string): string {
  const base = wanted.trim() || DEFAULT_DESIGN_NAME;
  const taken = new Set(held.filter((one) => one.id !== except).map((one) => one.name));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function newDesignId(): string {
  return `design:${crypto.randomUUID()}`;
}

function parsedLibrary(source: string | null): DesignLibrary | null {
  if (source === null) return null;
  try {
    const value = JSON.parse(source) as Partial<DesignLibrary>;
    if (value.format !== DESIGN_LIBRARY_FORMAT || value.version !== DESIGN_LIBRARY_VERSION) return null;
    if (!Array.isArray(value.designs) || value.designs.length === 0) return null;
    const designs = value.designs.flatMap((candidate): SavedDesign[] => {
      if (candidate === null || typeof candidate !== 'object') return [];
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
      return [{
        id: candidate.id,
        name: candidate.name.trim() || DEFAULT_DESIGN_NAME,
        tokens: normaliseTokens(candidate.tokens),
      }];
    });
    if (designs.length === 0) return null;
    const active = designs.some((one) => one.id === value.active) ? value.active! : designs[0]!.id;
    return { format: DESIGN_LIBRARY_FORMAT, version: DESIGN_LIBRARY_VERSION, active, designs };
  } catch {
    return null;
  }
}

/** Lo antiguo se vuelve el primer diseño sin borrar su respaldo legible. */
export function loadDesignLibrary(): DesignLibrary {
  const held = parsedLibrary(localStorage.getItem(DESIGNS_KEY));
  if (held !== null) return held;
  return {
    format: DESIGN_LIBRARY_FORMAT,
    version: DESIGN_LIBRARY_VERSION,
    active: 'design:vera',
    designs: [{
      id: 'design:vera',
      name: DEFAULT_DESIGN_NAME,
      tokens: normaliseTokens(localStorage.getItem(TOKENS_KEY)),
    }],
  };
}

function storeDesignLibrary(library: DesignLibrary): void {
  const serialised = JSON.stringify(library);
  localStorage.setItem(DESIGNS_KEY, serialised);
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  localStorage.setItem(TOKENS_KEY, JSON.stringify(active.tokens));
  void push({ designTokens: serialised });
}

export function loadTokens(): DesignToken[] {
  const library = loadDesignLibrary();
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  return structuredClone(active.tokens);
}

export function saveTokens(tokens: DesignToken[]): void {
  const library = loadDesignLibrary();
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  active.tokens = normaliseTokens(tokens);
  storeDesignLibrary(library);
  // Y viajan. El sistema de diseño es de quien lo ajustó, no del aparato desde
  // el que lo ajustó. Si el servidor no responde no pasa nada: lo local ya está
  // escrito y se reintentará al próximo cambio.
}

export function selectDesign(id: string): DesignToken[] {
  const library = loadDesignLibrary();
  if (library.designs.some((one) => one.id === id)) library.active = id;
  storeDesignLibrary(library);
  return loadTokens();
}

export function createDesign(copyCurrent: boolean): DesignToken[] {
  const library = loadDesignLibrary();
  const current = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  const design: SavedDesign = {
    id: newDesignId(),
    name: safeDesignName(copyCurrent ? `Copia de ${current.name}` : 'Diseño', library.designs),
    tokens: copyCurrent ? structuredClone(current.tokens) : structuredClone(DEFAULT_TOKENS),
  };
  library.designs.push(design);
  library.active = design.id;
  storeDesignLibrary(library);
  return structuredClone(design.tokens);
}

export function importDesign(name: string, tokens: DesignToken[]): DesignToken[] {
  const library = loadDesignLibrary();
  const design: SavedDesign = {
    id: newDesignId(),
    name: safeDesignName(name, library.designs),
    tokens: normaliseTokens(tokens),
  };
  library.designs.push(design);
  library.active = design.id;
  storeDesignLibrary(library);
  return structuredClone(design.tokens);
}

export function renameActiveDesign(name: string): string {
  const library = loadDesignLibrary();
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  active.name = safeDesignName(name, library.designs, active.id);
  storeDesignLibrary(library);
  return active.name;
}

export function removeActiveDesign(): DesignToken[] | null {
  const library = loadDesignLibrary();
  if (library.designs.length < 2) return null;
  library.designs = library.designs.filter((one) => one.id !== library.active);
  library.active = library.designs[0]!.id;
  storeDesignLibrary(library);
  return structuredClone(library.designs[0]!.tokens);
}

export function resetActiveDesign(): DesignToken[] {
  const library = loadDesignLibrary();
  const active = library.designs.find((one) => one.id === library.active) ?? library.designs[0]!;
  active.tokens = structuredClone(DEFAULT_TOKENS);
  storeDesignLibrary(library);
  return structuredClone(active.tokens);
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

  if (remote.designTokens !== null) {
    if (parsedLibrary(remote.designTokens) !== null) adopt(DESIGNS_KEY, remote.designTokens);
    else {
      adopt(TOKENS_KEY, remote.designTokens);
      if (localStorage.getItem(DESIGNS_KEY) !== null) {
        localStorage.removeItem(DESIGNS_KEY);
        changed = true;
      }
    }
  }
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

  /** La cámara 3D sólo gira sola cuando la persona lo ha pedido. */
  graphAutoRotate: (): boolean => localStorage.getItem(AUTO_ROTATE_KEY) === 'true',
  setGraphAutoRotate: (rotating: boolean) =>
    localStorage.setItem(AUTO_ROTATE_KEY, String(rotating)),

  graphView: (): GraphViewMode =>
    (localStorage.getItem(VIEW_KEY) as GraphViewMode | null) ?? 'graph_2d',
  setGraphView: (view: GraphViewMode) => {
    localStorage.setItem(VIEW_KEY, view);
    void push({ graphView: view });
  },
};
