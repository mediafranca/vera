// Iconos de la interfaz.
//
// La interfaz migra a Tabler Icons (https://tabler.io/icons), bajo licencia
// MIT. Los pictogramas nuevos conservan el lienzo original de 24 × 24 y Vera
// gobierna su trazo fino de forma centralizada.
//
// Van aquí dentro y no en una CDN, por lo mismo que las tipografías: una
// memoria privada no debería pedirle nada a un tercero cada vez que se abre.
// Son unos cientos de bytes, así que tampoco hay razón para que viajen aparte.
//
// El trazo usa `currentColor`, de modo que un icono toma el color de donde se
// pone y sigue respondiendo al tema sin que haya que pintarlo dos veces.

/** El interior de cada icono, tal como viene en `feather-icons@4.29.2`. */
const SHAPES = {
  // La marca de VERA: tres nodos y los vínculos entre ellos. Girado, una V.
  'share-2':
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
    '<circle cx="18" cy="19" r="3"/>' +
    '<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>' +
    '<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',

  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',

  // «Hoy» es un calendario y no una casa: lo que hay al otro lado del botón es
  // el día en curso, no un tablero ni una portada.
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>' +
    '<line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>' +
    '<line x1="3" y1="10" x2="21" y2="10"/>',

  // La lupa. En un teléfono el campo de búsqueda ocupa media barra para estar
  // esperando; plegado en su icono, ocupa lo que ocupa un botón.
  search:
    '<circle cx="11" cy="11" r="7"/>' +
    '<line x1="21" y1="21" x2="16.65" y2="16.65"/>',

  settings:
    '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/>' +
    '<path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',

  'layout-navbar-expand':
    '<path d="M4 18v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2"/>' +
    '<path d="M4 9h16"/><path d="M10 14l2 2l2 -2"/>',

  sun:
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>' +
    '<line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>' +
    '<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>' +
    '<line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>' +
    '<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',

  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',

  mic:
    '<path d="M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5"/>' +
    '<path d="M5 10a7 7 0 0 0 14 0"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/>',

  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',

  // El visto. Va con la cruz: aceptar y descartar son dos gestos, no uno con dos
  // estados, y se dibujan como los dos que son.
  check: '<polyline points="20 6 9 17 4 12"/>',
  /*
   * El lápiz sobre la hoja: lo andado se convierte en algo que hay que escribir.
   *
   * Va en el rastro, donde se guarda un recorrido, y dice lo que de verdad pasa
   * al pulsarlo: no se archiva un paseo, se abre un texto a medio hacer. Lo que
   * nace tiene todas sus paradas y ninguna frase entre ellas, y esas frases son
   * el argumento entero.
   */
  edit:
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',

  /*
   * Tres pasos unidos: convertir el rastro del mapa en un recorrido.
   *
   * Es Steps 1 de Streamline Plump, llevado de su lienzo 48 × 48 al de 24 de
   * Vera. El grosor no viaja con el dibujo: lo hereda de la misma variable que
   * gobierna el resto de la familia.
   */
  'steps-1':
    '<circle cx="4" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/>' +
    '<circle cx="20" cy="12" r="2.5"/>' +
    '<line x1="6.5" y1="12" x2="9.5" y2="12"/>' +
    '<line x1="14.5" y1="12" x2="17.5" y2="12"/>',

  /*
   * El lápiz solo, sin la hoja debajo: entrar a un dibujo que ya existe.
   *
   * El otro lleva hoja porque abre algo que hay que escribir desde cero. Aquí lo
   * que hay ya está dibujado y el gesto es volver a la mano, no empezar un
   * documento. Que sean dos iconos y no uno es lo que hace que en una misma
   * página se distingan de reojo.
   */
  'edit-2': '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  eraser:
    '<path d="M19 19h-11l-4 -4a2 2 0 0 1 0 -3l7 -7a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-6 6"/>' +
    '<path d="M18 12.3l-6.3 -6.3"/>',
  // El lápiz macizo: una acción secundaria pequeña se reconoce por su silueta,
  // sin necesitar fondo ni el doble trazo de un icono calado.
  'edit-filled':
    '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>' +
    '<path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',

  // La pluma: explicar por qué esta página y aquélla se tocan es escribir.
  feather:
    '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',

  // Verticales y no horizontales: el menú cae hacia abajo, y tres puntos en
  // columna dicen hacia dónde se abre lo que hay detrás.
  'more-vertical':
    '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',

  eye:
    '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/>' +
    '<path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',

  // Tabler affiliate: la vista del grafo y sus relaciones.
  affiliate:
    '<path d="M5.931 6.936l1.275 4.249m5.607 5.609l4.251 1.275"/>' +
    '<path d="M11.683 12.317l5.759 -5.759"/>' +
    '<path d="M4 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"/>' +
    '<path d="M17 5.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"/>' +
    '<path d="M17 18.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"/>' +
    '<path d="M4 15.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0"/>',

  // El ojo tachado: lo que está guardado y no se está mirando. La raya cruza
  // entero el icono para que la diferencia se vea de reojo y no haya que fijarse.
  'eye-off':
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',

  // --- La familia propia de Vera -------------------------------------------
  //
  // Estos cuatro no son Feather: los dibujó Herbert, y están en
  // `packages/web/public/assets/vera_*.svg` sobre un lienzo de 64 con trazo 4.
  // Aquí van llevados al lienzo de 24 de la familia (×0.375), para que un icono
  // propio y uno prestado se pongan uno al lado del otro sin desalinearse.

  // La marca: tres nodos en V y los vínculos entre ellos. Dice lo que Vera es —
  // cosas, y lo que las une.
  vera:
    '<circle cx="6.75" cy="7.5" r="2.25"/><circle cx="12" cy="16.5" r="2.25"/>' +
    '<circle cx="17.25" cy="7.5" r="2.25"/>' +
    '<line x1="13.13" y1="14.55" x2="16.13" y2="9.45"/>' +
    '<line x1="7.88" y1="9.45" x2="10.88" y2="14.55"/>',

  // Tabler topology-star-3: la vista del mapa.
  map:
    '<path d="M10 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M18 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M10 5a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M6 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M18 19a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M14 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M22 12a2 2 0 1 0 -4 0a2 2 0 0 0 4 0"/>' +
    '<path d="M6 12h4M14 12h4M15 7l-2 3M9 7l2 3M11 14l-2 3M13 14l2 3"/>',

  // Tabler book: la vista híbrida.
  spread:
    '<path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/>' +
    '<path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"/>' +
    '<path d="M3 6l0 13M12 6l0 13M21 6l0 13"/>',

  // Tabler book: un volumen cerrado que sale del sistema como documento.
  // `spread` queda reservado a la interfaz híbrida, que sí abre dos hojas.
  book:
    '<path d="M3 19a2 2 0 0 0 2 2h14"/>' +
    '<path d="M3 19v-14a2 2 0 0 1 2 -2h14v18"/>' +
    '<path d="M13 13h4M13 17h4"/>',

  // Salir hacia allá. En el mapa, la flecha que aparece al lado de un nombre:
  // señalar un nodo es mirarlo, y esto es lo que hay que pulsar para entrar.
  'arrow-up-right':
    '<line x1="7" y1="17" x2="17" y2="7"/>' +
    '<polyline points="7 7 17 7 17 17"/>',

  // Tabler article: la vista de sólo texto.
  text:
    '<path d="M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12"/>' +
    '<path d="M7 8h10M7 12h10M7 16h10"/>',

  // Tabler wash-dryclean-off: vaciar el rastro local.
  'wash-dryclean-off':
    '<path d="M20.048 16.033a9 9 0 0 0 -12.094 -12.075m-2.321 1.682a9 9 0 0 0 12.733 12.723"/>' +
    '<path d="M3 3l18 18"/>',

  'align-left':
    '<line x1="5" y1="6" x2="19" y2="6"/>' +
    '<line x1="5" y1="10" x2="15" y2="10"/>' +
    '<line x1="5" y1="14" x2="19" y2="14"/>' +
    '<line x1="5" y1="18" x2="13" y2="18"/>',

  // --- El menú de un bloque -------------------------------------------------
  //
  // Un icono aquí no adorna: es lo que hace que los grupos se distingan de
  // reojo. Tres flechas juntas dicen «esto mueve» antes de que nadie lea las
  // etiquetas, y por eso las acciones de un mismo grupo comparten familia de
  // forma —flechas para el sitio, cuadrados para lo que se copia.

  // La glosa: alguien dice algo *sobre* el bloque, al margen. Un bocadillo, que
  // es como se dibuja desde siempre lo dicho aparte.
  'message-square':
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',

  /*
   * Procesar: el circuito, no el rayo.
   *
   * El rayo promete magia instantánea; esto es un modelo que corre en esta
   * máquina y se toma su tiempo. El dibujo dice de qué clase de cosa se trata,
   * que es lo que conviene saber antes de pulsarlo.
   */
  cpu:
    '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>' +
    '<rect x="9" y="9" width="6" height="6"/>' +
    '<line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>' +
    '<line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>' +
    '<line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>' +
    '<line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',

  'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  'arrow-down': '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',

  'arrows-maximize':
    '<path d="M16 4l4 0l0 4"/><path d="M14 10l6 -6"/>' +
    '<path d="M8 20l-4 0l0 -4"/><path d="M4 20l6 -6"/>' +
    '<path d="M16 20l4 0l0 -4"/><path d="M14 14l6 6"/>' +
    '<path d="M8 4l-4 0l0 4"/><path d="M4 4l6 6"/>',

  'arrows-minimize':
    '<path d="M5 9l4 0l0 -4"/><path d="M3 3l6 6"/>' +
    '<path d="M5 15l4 0l0 4"/><path d="M3 21l6 -6"/>' +
    '<path d="M19 9l-4 0l0 -4"/><path d="M15 9l6 -6"/>' +
    '<path d="M19 15l-4 0l0 4"/><path d="M15 15l6 6"/>',

  'corner-up-left':
    '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  'corner-up-right':
    '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'file-text':
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' +
    '<line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',

  // La lista, para numerar los hijos y para devolverlos a la viñeta. El mismo
  // icono en los dos sentidos: lo que se señala es la lista, y en qué estado
  // está lo dice la etiqueta, que para eso cambia.
  list:
    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>' +
    '<line x1="8" y1="18" x2="21" y2="18"/>' +
    '<line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>' +
    '<line x1="3" y1="18" x2="3.01" y2="18"/>',

  // La mira: enfocar es dejar fuera todo lo demás y quedarse con esto.
  crosshair:
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/>' +
    '<line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="18" x2="12" y2="22"/>',

  // El eslabón: una referencia es lo que ata este bloque a donde se pegue.
  'link-2':
    '<path d="M15 7h3a5 5 0 0 1 5 5 5 5 0 0 1-5 5h-3m-6 0H6a5 5 0 0 1-5-5 5 5 0 0 1 5-5h3"/>' +
    '<line x1="8" y1="12" x2="16" y2="12"/>',

  // Dos pares de corchetes: la sintaxis propia con que Vera enlaza sus páginas.
  brackets:
    '<path d="M7 4H4v16h3M17 4h3v16h-3"/>' +
    '<path d="M10 7H8v10h2M14 7h2v10h-2"/>',

  // Un enlace que sale del espacio de Vera hacia la web.
  'external-link':
    '<path d="M14 3h7v7M10 14L21 3"/>' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',

  // La almohadilla: el identificador desnudo, que no es un enlace sino un nombre.
  hash:
    '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/>' +
    '<line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',

  // Las dos hojas: copiar el texto tal cual, que es de lo que se hace una copia.
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',

  // El reloj: la historia de un bloque es su tiempo, no una pila de versiones.
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',

  // El cesto. Va solo al final del menú y detrás de una raya, porque es lo único
  // de ahí que quita algo.
  'trash-2':
    '<polyline points="3 6 5 6 21 6"/>' +
    '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
    '<line x1="10" y1="11" x2="10" y2="13"/><line x1="14" y1="11" x2="14" y2="13"/>',
} as const;

export type IconName = keyof typeof SHAPES;

export interface IconOptions {
  /** Grados de giro sobre el centro del lienzo. La marca usa -90. */
  rotate?: number;
  /** Clase extra para poder posicionarlo desde la hoja de estilo. */
  className?: string;
}

/**
 * El marcado de un icono, listo para poner dentro de un botón.
 *
 * No lleva medidas: el tamaño lo decide el CSS, para que un icono crezca junto
 * al control que lo contiene en vez de quedar clavado a un número escrito aquí.
 *
 * @invariant IconsAreDecorative: el icono se marca `aria-hidden`. Lo que se lee
 * en voz alta es la etiqueta del control, no el dibujo; anunciar los dos diría
 * dos veces lo mismo, y un icono a solas no dice nada útil.
 */
export function icon(name: IconName, options: IconOptions = {}): string {
  // Girar sobre el centro del lienzo de 24 y no sobre el del trazo: así la
  // marca conserva su caja y no se descuadra respecto de los demás iconos.
  const turn = options.rotate === undefined ? '' : ` transform="rotate(${options.rotate} 12 12)"`;
  const extra = options.className === undefined ? '' : ` ${options.className}`;
  return (
    `<svg class="icon icon-${name}${extra}" viewBox="0 0 24 24" fill="none" ` +
    'stroke="currentColor" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false"><g${turn}>${SHAPES[name]}</g></svg>`
  );
}

/**
 * La marca: `share-2` girado un cuarto de vuelta a la izquierda.
 *
 * El giro no es un adorno. Los tres nodos de `share-2` están en (18,5), (6,12)
 * y (18,19); girar -90° sobre el centro los manda a (5,6), (12,18) y (19,6), y
 * eso es una V. Vera queda dicha con el mismo icono que dice qué es: tres cosas
 * y los vínculos entre ellas.
 */
export function brandMark(): string {
  return icon('vera', { className: 'brand-mark' });
}
