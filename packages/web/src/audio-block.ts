// El audio dentro del texto.
//
// Una grabación pegada a un bloque, y el texto de ese bloque debajo. El audio se
// oye ahí mismo mientras exista, el texto se edita como cualquier otro texto, y
// ninguna de las dos cosas consume a la otra.
//
// @guarantee ThreeThingsAndNoMore: transcribir, volver a transcribir, borrar el
// audio. No hay estado que avanzar ni paso que completar antes de poder seguir
// escribiendo; lo demás es la edición ordinaria de un bloque ordinario.

import { audioUrl, startRecording, voice, type Recording } from './voice.ts';
import { countInto } from './waiting.ts';

export interface AudioBlockHandlers {
  /** Volver a traer la página: transcribir escribe el texto del bloque. */
  onSettled(): void;
  notify(message: string): void;
  /** La grabación cambió sin que el árbol se mueva. */
  onChanged(recording: Recording): void;
  /** La transcripción cambió a la vez la grabación y el texto de su bloque. */
  onTranscribed(recording: Recording, block: string, text: string): void;
}

/*
 * Si hay una grabación en curso, y quién quiere enterarse.
 *
 * Vive aquí porque aquí es donde se sabe. La barra necesita decirlo —el botón de
 * hablar se pone verde mientras se graba— y sin esto tendría que adivinarlo
 * mirando el DOM, que es preguntarle a la consecuencia por la causa.
 *
 * Se enciende cuando la grabación ha empezado de verdad, no al pulsar: entre una
 * cosa y otra está el permiso del micrófono, que puede negarse. Un botón que se
 * pone verde antes de que haya micrófono está diciendo algo que todavía no es
 * cierto, y en una interfaz de voz esa mentira cuesta lo que se dijo creyéndola.
 */
let live = false;
const watchers = new Set<(on: boolean) => void>();
let activeOverlay: HTMLElement | null = null;

/** Avisa cuando una grabación empieza o termina. */
export function onRecording(watcher: (on: boolean) => void): void {
  watchers.add(watcher);
  watcher(live);
}

function setLive(on: boolean): void {
  if (live === on) return;
  live = on;
  for (const watcher of watchers) watcher(on);
}

/** Lo que duró, en minutos y segundos. */
function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function action(label: string, kind: 'plain' | 'primary' | 'quiet' = 'plain'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'plain' ? 'audio-action' : `audio-action ${kind}`;
  button.textContent = label;
  return button;
}

/*
 * Por debajo de esto no hubo voz.
 *
 * Una pista muda da exactamente 0. Una habitación callada con un micrófono vivo
 * ronda 0,002–0,01 de ruido de fondo, y hablar bajito ya pasa de 0,02. El umbral
 * va en medio, más cerca del silencio que del susurro: avisar de más enseña a no
 * leer los avisos, que es peor que no avisar.
 */
const SILENCIO = 0.012;

/**
 * Graba en el sitio, y al detener deja el audio pegado a este bloque.
 *
 * Empieza sola: escribir `/audio` o pulsar el micrófono es haber decidido
 * hablar, y pedir un segundo clic para lo ya decidido sólo pone tiempo entre la
 * intención y la voz.
 */
export function renderRecorder(
  host: HTMLElement,
  block: string,
  handlers: AudioBlockHandlers,
  destination = 'este bloque',
): void {
  if (activeOverlay !== null) {
    activeOverlay.focus();
    return;
  }
  const overlay = document.createElement('section');
  overlay.className = 'recording-overlay';
  overlay.tabIndex = -1;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Grabación activa');

  const box = document.createElement('div');
  box.className = 'audio-block recording';
  host.innerHTML = '';
  const heading = document.createElement('strong');
  heading.className = 'recording-title';
  heading.textContent = 'Grabando';
  const where = document.createElement('span');
  where.className = 'recording-destination';
  where.textContent = `se guardará en ${destination}`;
  overlay.append(heading, box, where);
  document.body.append(overlay);
  activeOverlay = overlay;
  overlay.focus();

  const closeOverlay = (): void => {
    overlay.remove();
    if (activeOverlay === overlay) activeOverlay = null;
  };

  const dot = document.createElement('span');
  dot.className = 'audio-dot';

  const elapsed = document.createElement('span');
  elapsed.className = 'audio-time';
  elapsed.textContent = '0:00';

  /*
   * El medidor no es adorno: es la única prueba de que hay alguien al otro lado.
   *
   * Grabar una pista muda produce una grabación perfecta y vacía, y sin esto no
   * se nota hasta leer la transcripción. Aquí se ve moverse mientras se habla, y
   * si no se mueve, se sabe antes de decir nada importante.
   */
  const meter = document.createElement('span');
  meter.className = 'audio-meter';
  const bar = document.createElement('span');
  bar.className = 'audio-meter-fill';
  meter.append(bar);

  const stop = action('detener', 'primary');
  const cancel = action('descartar', 'quiet');
  box.append(dot, elapsed, meter, stop, cancel);

  const began = Date.now();
  const tick = window.setInterval(() => {
    elapsed.textContent = clock(Date.now() - began);
  }, 500);

  void startRecording().then((started) => {
    if ('error' in started) {
      window.clearInterval(tick);
      setLive(false);
      handlers.notify(started.error);
      host.innerHTML = '';
      closeOverlay();
      return;
    }

    // Hay micrófono. Si además está entrando sonido lo dice el medidor, que es
    // otra cosa: tener permiso y estar oyendo no son lo mismo.
    setLive(true);

    // Raíz cuadrada y no el valor crudo: la voz de alguien hablando normal se
    // mueve entre 0,02 y 0,2, y dibujada lineal esa franja es una barra que casi
    // no se despega del borde. Comprimida se ve el habla y se distingue del
    // silencio, que es para lo que está.
    const meterTick = window.setInterval(() => {
      const now = Math.min(1, Math.sqrt(started.level()));
      bar.style.width = `${Math.round(now * 100)}%`;
    }, 100);
    const stopMeter = (): void => window.clearInterval(meterTick);

    cancel.addEventListener('click', () => {
      window.clearInterval(tick);
      stopMeter();
      setLive(false);
      started.cancel();
      // Nada que guardar: no llegó a haber grabación.
      host.innerHTML = '';
      closeOverlay();
      handlers.onSettled();
    });

    stop.addEventListener('click', () => {
      window.clearInterval(tick);
      stopMeter();
      // Se apaga al detener y no al terminar de guardar: lo que el verde dice es
      // «te estoy oyendo», y ya no.
      setLive(false);
      stop.disabled = true;
      cancel.disabled = true;
      elapsed.textContent = 'guardando…';
      /*
       * Detener no puede dejar la interfaz esperando para siempre.
       *
       * No había `catch`: si detener fallaba —y fallaba, cuando el sistema ya
       * había parado la captura con la pantalla apagada— la promesa se rompía
       * sin que nadie la recogiera y el botón se quedaba en «guardando…» con el
       * audio dentro y sin forma de sacarlo. Ahora cualquier final, bueno o
       * malo, devuelve el bloque a un estado del que se pueda seguir.
       */
      void started
        .stop()
        .then(async ({ audio, durationMs, peak }) => {
          if (audio.size === 0) {
            handlers.notify('El teléfono cerró el micrófono antes de entregar el audio. La grabación quedó vacía; vuelve a intentarlo con Vera en primer plano.');
            host.innerHTML = '';
            closeOverlay();
            handlers.onSettled();
            return;
          }
          const captured = await voice.capture(audio, durationMs, block);
          if ('error' in captured) {
            handlers.notify(captured.error);
            host.innerHTML = '';
            closeOverlay();
            return;
          }
          /*
           * Si no entró sonido se dice ahora, no al leer la transcripción.
           *
           * El audio se guarda igual —descartarlo sería decidir por quien habló—
           * pero callar aquí es dejar que la pérdida se descubra media hora
           * después, cuando ya no se puede repetir lo que se dijo. Y se nombra la
           * causa probable, porque «no se oyó nada» sin más no dice qué tocar:
           * el navegador ofrece las salidas del sistema como si fueran
           * micrófonos, y cada uno guarda esa elección por su cuenta.
           */
          if (peak < SILENCIO) {
            handlers.notify(
              'No entró sonido: la grabación quedó muda. Revisa qué micrófono tiene elegido este navegador.',
            );
          }
          closeOverlay();
          // `capture` devuelve la grabación canónica recién asociada. Entregarla
          // a la vista permite incorporarla antes de redibujar; `onSettled`
          // reconstruía desde la réplica estructural, que aún no conoce medios,
          // y dejaba el bloque vacío hasta salir y volver a la página.
          handlers.onChanged(captured);
        })
        .catch(() => {
          handlers.notify('no se pudo cerrar la grabación; lo dicho hasta ahí se ha perdido');
          host.innerHTML = '';
          closeOverlay();
          handlers.onSettled();
        });
    });
  });
}

/**
 * El audio de un bloque: reproductor y tres botones.
 *
 * Se dibuja *encima* del texto del bloque, no en su lugar. El bloque se sigue
 * leyendo y editando como cualquier otro, y esto es lo que tiene pegado.
 *
 * @invariant TheRecordingStaysUntilItIsDiscarded: nada de aquí consume la
 * grabación. Sólo la borra el botón que dice que la borra.
 */
export function renderAudioBlock(
  host: HTMLElement,
  recording: Recording,
  handlers: AudioBlockHandlers,
  /** Lo que el bloque dice ahora, para saber si alguien lo editó a mano. */
  blockText = '',
): void {
  const box = document.createElement('div');
  box.className = 'audio-block';
  host.append(box);

  const fail = (outcome: unknown): boolean => {
    if (outcome !== null && typeof outcome === 'object' && 'error' in outcome) {
      handlers.notify(String((outcome as { error: string }).error));
      return true;
    }
    return false;
  };

  const url = audioUrl(recording);
  if (url !== null) {
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = url;
    player.className = 'audio-player';
    box.append(player);
  } else {
    // El audio se borró. La grabación sigue existiendo y lo dice, en vez de
    // desaparecer y dejar el bloque sin explicación de por qué está marcado.
    const gone = document.createElement('span');
    gone.className = 'audio-meta';
    gone.textContent = 'el audio se borró · queda lo que dice y de dónde vino';
    box.append(gone);
  }

  const row = document.createElement('div');
  row.className = 'audio-row';

  const said = document.createElement('span');
  said.className = 'audio-meta';
  said.textContent =
    recording.durationMs === null
      ? new Date(recording.capturedAt).toLocaleString('es')
      : `${clock(recording.durationMs)} · ${new Date(recording.capturedAt).toLocaleString('es')}`;
  row.append(said);

  if (recording.audioHash !== null) {
    // Transcribir por primera vez, o volver a hacerlo. Es el mismo acto: escribe
    // el texto del bloque y no toca el audio.
    const again = recording.transcript !== null;
    const ask = action(again ? 'retranscribir' : 'transcribir', again ? 'plain' : 'primary');
    ask.addEventListener('click', () => {
      // @guarantee WhatWillBeLostIsSaidBeforeItIsLost: lo que se pierde al
      // retranscribir es lo que una persona escribió encima. Sólo se advierte si
      // de verdad hay algo así: avisar siempre enseña a no leer los avisos.
      const edited =
        again && blockText.trim() !== '' && blockText.trim() !== (recording.transcript ?? '').trim();
      if (edited && !window.confirm('El texto de este bloque se editó a mano. Retranscribir lo reemplaza. ¿Seguir?')) {
        return;
      }
      ask.disabled = true;
      /*
       * La espera más larga de Vera, y hasta ahora la que menos decía.
       *
       * «transcribiendo…» se lee igual a los dos segundos que a los tres minutos:
       * un modelo local sobre diez minutos de audio tarda lo que tarda, y quien
       * pulsó no tenía forma de distinguir eso de un proceso muerto. Ahora la
       * cuenta va en el botón que se pulsó, y a partir de la segunda vez el
       * aparato ya sabe cuánto suele tardar y lo dice. Ver waiting.ts.
       */
      const counting = countInto(ask, 'transcribiendo…', 'voice:transcribe');
      void voice.transcribe(recording.id).then((next) => {
        if ('error' in next) {
          handlers.notify(next.error);
          counting.close('failed');
          ask.disabled = false;
          ask.textContent = again ? 'retranscribir' : 'transcribir';
          return;
        }
        counting.close();
        /*
         * La respuesta ya trae las dos verdades que acaban de cambiar.
         *
         * Esperar a que la replica local alcance la operación hacía que iOS
         * redibujara primero el estado anterior: desaparecía la espera, volvía
         * el botón «transcribir» y el texto parecía perdido, aunque el servidor
         * sí lo había escrito. Se incorporan ambos resultados canónicos antes
         * de repintar; la sincronización posterior sólo los confirma.
         */
        handlers.onTranscribed(next.recording, next.block, next.text);
      });
    });
    row.append(ask);

    const drop = action('borrar el audio', 'quiet');
    drop.title = 'La grabación deja de poder oírse. Lo escrito sigue escrito.';
    drop.addEventListener('click', () => {
      // Sin transcripción, borrar el audio no deja nada. Con ella, deja el texto.
      const nothingKept = recording.transcript === null && blockText.trim() === '';
      const warning = nothingKept
        ? 'Este audio no se ha transcrito: al borrarlo no queda nada de lo que se dijo. ¿Seguir?'
        : 'El audio deja de poder oírse. El texto y su procedencia se quedan. ¿Seguir?';
      if (!window.confirm(warning)) return;
      drop.disabled = true;
      void voice.discardAudio(recording.id).then((next) => {
        if ('error' in next) {
          handlers.notify(next.error);
          drop.disabled = false;
          return;
        }
        // La grabación cambió, no el árbol. Volver a cargar desde la réplica
        // del outliner resucita aquí el `audioHash` anterior, porque esa réplica
        // sólo proyecta bloques y propiedades. Entregar el resultado canónico
        // permite pintar inmediatamente exactamente lo que el servidor guardó.
        handlers.onChanged(next);
      });
    });
    row.append(drop);
  } else {
    const restore = action('recuperar audio', 'plain');
    restore.title = 'Recuperar el reproductor si los bytes todavía están en el almacén';
    restore.addEventListener('click', () => {
      restore.disabled = true;
      void voice.restoreAudio(recording.id).then((next) => {
        if ('error' in next) {
          handlers.notify(next.error);
          restore.disabled = false;
          return;
        }
        handlers.onChanged(next);
      });
    });
    row.append(restore);
  }

  box.append(row);
}
