/** Un bloque visible y dónde estaba respecto del borde superior del visor. */
export interface ViewportSeat {
  block: string;
  top: number;
}

export interface HeldViewport {
  scrollTop: number;
  seats: ViewportSeat[];
}

interface RememberedViewport {
  page: string;
  route: string;
  viewport: HeldViewport;
}

const RELOAD_VIEWPORT = 'vera-reading-viewport';

/**
 * Guarda varios testigos, no uno solo: el gesto puede borrar justamente el
 * bloque que estaba más cerca del borde. El siguiente superviviente conserva
 * entonces el lugar y la página no salta.
 */
export function holdViewport(container: HTMLElement): HeldViewport {
  const frame = container.getBoundingClientRect();
  const seats = [...container.querySelectorAll<HTMLElement>('.block[data-id]')]
    .map((block) => {
      const rect = block.getBoundingClientRect();
      return {
        block: block.dataset['id'] ?? '',
        top: rect.top - frame.top,
        bottom: rect.bottom - frame.top,
      };
    })
    .filter((seat) => seat.block !== '' && seat.bottom >= 0 && seat.top <= frame.height)
    .sort((a, b) => Math.abs(a.top) - Math.abs(b.top))
    .slice(0, 12)
    .map(({ block, top }) => ({ block, top }));
  return { scrollTop: container.scrollTop, seats };
}

/** Devuelve cuánto corregir el scroll para que el primer testigo vivo no se mueva. */
export function viewportDelta(
  held: HeldViewport,
  now: ReadonlyMap<string, number>,
): number | null {
  for (const seat of held.seats) {
    const top = now.get(seat.block);
    if (top !== undefined) return top - seat.top;
  }
  return null;
}

export function restoreViewport(container: HTMLElement, held: HeldViewport): void {
  const frame = container.getBoundingClientRect();
  const now = new Map<string, number>();
  for (const block of container.querySelectorAll<HTMLElement>('.block[data-id]')) {
    const id = block.dataset['id'];
    if (id !== undefined) now.set(id, block.getBoundingClientRect().top - frame.top);
  }
  const delta = viewportDelta(held, now);
  container.scrollTop = delta === null ? held.scrollTop : container.scrollTop + delta;
}

/**
 * Conserva el lugar también mientras una página entra por lotes.
 *
 * El primer lote de una composición progresiva puede no contener todavía
 * ninguno de los bloques que estaban a la vista. En ese instante `scrollTop`
 * queda necesariamente acotado por un documento demasiado corto. Volvemos a
 * aplicar el mismo testigo en cada pintura hasta que termina la composición;
 * cuando el bloque reaparece, su identidad estable recupera el lugar exacto.
 *
 * Una nueva restauración invalida la anterior. Sin esa generación, dos
 * redibujados cercanos podrían corregir el mismo visor desde recuerdos
 * distintos y producir un segundo salto.
 */
const viewportRestorations = new WeakMap<HTMLElement, number>();

export function restoreViewportThroughComposition(
  container: HTMLElement,
  held: HeldViewport,
): void {
  const generation = (viewportRestorations.get(container) ?? 0) + 1;
  viewportRestorations.set(container, generation);

  const restore = (): void => {
    if (viewportRestorations.get(container) !== generation || !container.isConnected) return;
    restoreViewport(container, held);
    if (container.querySelector('.page-compose-progress') !== null) {
      window.requestAnimationFrame(restore);
    }
  };
  restore();
}

/**
 * Deja un testigo antes de que el documento entero desaparezca.
 *
 * `sessionStorage` limita el recuerdo a esta pestaña: otra ventana puede estar
 * leyendo la misma página en otro lugar y no tiene por qué heredar éste.
 */
export function rememberViewportForReload(
  storage: Storage,
  page: string,
  route: string,
  viewport: HeldViewport,
): void {
  const remembered: RememberedViewport = { page, route, viewport };
  try {
    storage.setItem(RELOAD_VIEWPORT, JSON.stringify(remembered));
  } catch {
    // La lectura sigue funcionando aunque el navegador niegue almacenamiento.
  }
}

/**
 * Consume el testigo una sola vez y sólo en la misma página y dirección.
 *
 * Consumir también los recuerdos que no coinciden evita que una navegación
 * posterior restaure por accidente un lugar perteneciente a una recarga vieja.
 */
export function takeViewportAfterReload(
  storage: Storage,
  page: string,
  route: string,
): HeldViewport | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(RELOAD_VIEWPORT);
    storage.removeItem(RELOAD_VIEWPORT);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const remembered = JSON.parse(raw) as Partial<RememberedViewport>;
    const viewport = remembered.viewport as Partial<HeldViewport> | undefined;
    if (
      remembered.page !== page || remembered.route !== route || viewport === undefined ||
      typeof viewport.scrollTop !== 'number' || !Array.isArray(viewport.seats)
    ) return null;
    const seats = viewport.seats.filter((seat): seat is ViewportSeat =>
      typeof seat === 'object' && seat !== null &&
      typeof (seat as Partial<ViewportSeat>).block === 'string' &&
      typeof (seat as Partial<ViewportSeat>).top === 'number',
    );
    return { scrollTop: viewport.scrollTop, seats };
  } catch {
    return null;
  }
}
