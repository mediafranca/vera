/**
 * El arrastre se mide en la mano y se dibuja con resistencia.
 *
 * Separar ambas distancias evita que el indicador persiga al dedo píxel por
 * píxel —se sentiría como mover una pieza, no como tirar de una superficie— y
 * permite probar el umbral sin depender del DOM.
 */
export const PULL_REFRESH_THRESHOLD = 56;
export const PULL_REFRESH_MAX = 88;

export interface PullMeasure {
  offset: number;
  ready: boolean;
  turn: number;
}

export function measurePull(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
): PullMeasure | null {
  const horizontal = currentX - startX;
  const vertical = currentY - startY;
  if (vertical <= 0) return null;

  // Una intención claramente lateral pertenece a la barra, al navegador o a
  // otro control. Una pequeña deriva del pulgar sigue siendo un arrastre hacia
  // abajo y no debe volver el gesto caprichoso.
  if (Math.abs(horizontal) > 14 && Math.abs(horizontal) > vertical * 0.7) return null;

  const offset = Math.min(PULL_REFRESH_MAX, vertical * 0.5);
  return {
    offset,
    ready: offset >= PULL_REFRESH_THRESHOLD,
    turn: Math.min(300, (offset / PULL_REFRESH_THRESHOLD) * 300),
  };
}

interface PullToRefreshOptions {
  container: HTMLElement;
  indicator: HTMLElement;
  canRefresh: () => boolean;
  refresh: () => Promise<void>;
  failed: (message: string) => void;
}

/**
 * Instala el gesto sobre el verdadero contenedor desplazable.
 *
 * No se desactiva el desplazamiento táctil de `#text`: el oyente sólo reclama
 * el movimiento cuando la lectura ya está exactamente arriba y la mano baja.
 * En cualquier otra dirección el navegador conserva el gesto completo.
 */
export function wirePullToRefresh(options: PullToRefreshOptions): () => void {
  const { container, indicator } = options;
  const label = indicator.querySelector<HTMLElement>('.pull-refresh-label');
  let gesture: { x: number; y: number; ready: boolean } | null = null;
  let refreshing = false;
  let retreatTimer: number | undefined;

  const say = (message: string): void => {
    if (label !== null) label.textContent = message;
  };

  const hide = (): void => {
    indicator.hidden = true;
    indicator.classList.remove('ready', 'refreshing', 'failed', 'retreating');
    indicator.style.removeProperty('--pull-distance');
    indicator.style.removeProperty('--pull-turn');
    say('Arrastra hacia abajo para actualizar');
  };

  const retreat = (delay = 0): void => {
    window.clearTimeout(retreatTimer);
    indicator.classList.remove('ready');
    indicator.classList.add('retreating');
    indicator.style.setProperty('--pull-distance', '0px');
    retreatTimer = window.setTimeout(hide, delay + 180);
  };

  const start = (event: TouchEvent): void => {
    if (
      refreshing || event.touches.length !== 1 || container.scrollTop > 0 ||
      !options.canRefresh()
    ) return;
    const touch = event.touches[0];
    if (touch === undefined) return;
    gesture = { x: touch.clientX, y: touch.clientY, ready: false };
  };

  const move = (event: TouchEvent): void => {
    if (gesture === null || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch === undefined || container.scrollTop > 0) {
      gesture = null;
      retreat();
      return;
    }
    const measured = measurePull(gesture.x, gesture.y, touch.clientX, touch.clientY);
    if (measured === null) {
      // Una bajada todavía minúscula puede convertirse en gesto. Una subida o
      // una intención lateral ya decidió otra cosa y libera la escucha.
      if (touch.clientY < gesture.y || Math.abs(touch.clientX - gesture.x) > 14) {
        gesture = null;
        retreat();
      }
      return;
    }
    if (measured.offset < 4) return;

    event.preventDefault();
    gesture.ready = measured.ready;
    indicator.hidden = false;
    indicator.classList.remove('retreating');
    indicator.classList.toggle('ready', measured.ready);
    indicator.style.setProperty('--pull-distance', `${measured.offset}px`);
    indicator.style.setProperty('--pull-turn', `${measured.turn}deg`);
    say(measured.ready ? 'Suelta para actualizar' : 'Arrastra hacia abajo para actualizar');
  };

  const finish = (): void => {
    const shouldRefresh = gesture?.ready === true;
    gesture = null;
    if (refreshing) return;
    if (!shouldRefresh) {
      retreat();
      return;
    }

    refreshing = true;
    indicator.hidden = false;
    indicator.classList.add('refreshing');
    indicator.classList.remove('ready', 'failed', 'retreating');
    indicator.style.setProperty('--pull-distance', `${PULL_REFRESH_THRESHOLD}px`);
    say('Actualizando la página');

    void options.refresh().then(() => {
      say('Página actualizada');
      retreat(180);
    }).catch((error: unknown) => {
      indicator.classList.remove('refreshing');
      indicator.classList.add('failed');
      say('No se pudo actualizar');
      options.failed(error instanceof Error ? error.message : 'error desconocido');
      retreat(900);
    }).finally(() => {
      refreshing = false;
    });
  };

  const cancel = (): void => {
    gesture = null;
    if (!refreshing) retreat();
  };

  container.addEventListener('touchstart', start, { passive: true });
  container.addEventListener('touchmove', move, { passive: false });
  container.addEventListener('touchend', finish, { passive: true });
  container.addEventListener('touchcancel', cancel, { passive: true });

  return () => {
    window.clearTimeout(retreatTimer);
    container.removeEventListener('touchstart', start);
    container.removeEventListener('touchmove', move);
    container.removeEventListener('touchend', finish);
    container.removeEventListener('touchcancel', cancel);
  };
}
