# Anatomía de la interfaz

El [Manual de Vera](https://vera.mediafranca.net/vera-manual/) explica la
interfaz para quien la usa. Este inventario se mantiene cerca del código para
orientar cambios de implementación.

Inventario de lo que hay hoy en pantalla, para poder reestructurarlo sabiendo qué
se mueve y qué arrastra consigo. Levantado del código, no de la memoria:
`packages/web/index.html`, `main.ts`, `outliner.ts`, `settings.ts`, `styles.css`.

## El armazón

`#vera-root` es una rejilla CSS de 4 columnas × 2 filas.

```
┌──────────────────────────────────────────────────────────────┐
│ bar                                                          │
├───────────┬──────────────────┬───┬───────────────────────────┤
│ sidebar   │ text             │ ⇔ │ graph                     │
│ 15rem     │ variable         │6px│ el resto                  │
└───────────┴──────────────────┴───┴───────────────────────────┘
```

El ancho de `text` y `graph` lo reparte `--divider` (0.15–0.85), que el
participante arrastra y queda recordado.

Tres disposiciones cambian sólo el ancho de las columnas:

| Disposición  | sidebar | text | divisor | graph |
| ------------ | ------- | ---- | ------- | ----- |
| `split`      | 15rem   | ×    | 6px     | ×     |
| `text_only`  | 15rem   | todo | —       | —     |
| `graph_only` | 15rem   | —    | —       | todo  |

En ≤640 px la rejilla pasa a una sola columna, `sidebar` y `divider` desaparecen,
y sólo se ve texto **o** grafo.

---

## 1 · Barra superior `#bar`

Persistente. Nunca depende de la página abierta.

```
Vera │ migas │ ················ │ buscador │ texto ambos grafo │ 2D 3D │ ◐ tokens
```

| Elemento          | Qué es                          | Qué hace                                                                 | Estado |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------ | ------ |
| `#brand`          | Marca                           | Sólo rótulo. **No navega a ninguna parte** — no hay «inicio».             | —      |
| `#breadcrumbs`    | Rastro de navegación            | Últimas 4 páginas visitadas; cada una vuelve a ella                       | Historial en memoria, hasta 50; **se pierde al recargar**. Oculto en móvil |
| `#search`         | Campo de búsqueda               | Texto libre sobre títulos y contenido; con espera de 250 ms y por turnos  | — |
| `#results`        | Desplegable de hallazgos        | Página + extracto; abre la página                                         | Flotante sobre `#search-wrap` |
| `texto/ambos/grafo` | Disposición                   | Cambia el reparto de columnas                                            | Recordada |
| `2D / 3D`         | Modo del mapa                   | Fuerza dirigida en D3 o en tres dimensiones                               | Recordado |
| `#scheme` `◐`     | Claro/oscuro                    | Alterna esquema y **redibuja la página** (los diagramas llevan sus colores dentro) | Recordado |
| `#edit-tokens`    | Configuración                   | Abre el panel de dos secciones                                            | — |

**Para reestructurar:** son ocho botones más marca, migas y buscador en una
línea. En un teléfono ya no caben y van en dos filas con los controles
desplazándose. La barra lleva `env(safe-area-inset-top)` porque el contenido pasa
bajo la barra de estado del teléfono.

---

## 2 · Listado de páginas `#sidebar`

| Elemento     | Qué es              | Qué hace                                                                   |
| ------------ | ------------------- | -------------------------------------------------------------------------- |
| `#status`    | Cifras del grafo    | Páginas, bloques y secuencia del registro. Sólo lectura                     |
| `#index`     | Índice de páginas   | **Las 200 páginas más conectadas**, con su número de enlaces. Abre la página |

Ordenado por conectividad y no por tamaño: la página más grande del corpus es una
transcripción sin un solo enlace, y abrirla de entrada mostraría un mapa vacío.

**Lo que no tiene:** no se puede buscar dentro, ni filtrar, ni ver las otras 804
páginas, ni crear una página nueva, ni agrupar por nada. Se oculta entero en
móvil, así que ahí no hay forma de listar el grafo.

---

## 3 · Texto de la página `#text`

Lo dibuja `renderOutliner()`. Es la única parte que cambia con la página.

```
· page-header
    · h1.page-title ......................... editable → rename_page
    · dl.properties ......................... el «front matter»
        · dt.property-key ................... editable → quitar + poner
        · dd.property-value ................. editable → set_property
            · button.property-drop .......... quita la propiedad
    · button.property-add ................... agrega una propiedad
    · div.page-actions ...................... + página · copiar Markdown · exportar .md
    · span.visibility ....................... «privada» / «pública». Sólo lectura
· div.focused ............................... sólo si la vista está enfocada en un bloque
    · texto del bloque raíz
    · button.focused-out .................... salir del enfoque
· div.blocks
    · div.block  (una por bloque visible, sangrada por profundidad)
        · button.fold ....................... plegar/desplegar. Vacío si es hoja
        · button.bullet ..................... abre el menú del bloque
        · div.body .......................... Markdown renderizado; al pulsar, editor
· section.references ....................... si hay referencias en cualquier dirección
    · h2 «Referencias (n)»
    · section.reference-in «La nombran» ..... páginas que apuntan a ésta
    · section.reference-out «Nombra a» ...... páginas a las que ésta apunta
        · li.reference ...................... página + extracto; abre la página
            · div.relation-said ............. tipo y explicación, cuando existen
```

### El bloque, por dentro

| Estado        | Qué se ve                                                                    |
| ------------- | ---------------------------------------------------------------------------- |
| En reposo     | Markdown renderizado: encabezados, listas, citas, código, tablas, imágenes, notas al pie, referencias, diagramas Mermaid |
| En edición    | `textarea.editor` con la fuente exacta, alto ajustado al contenido            |
| Autocompletado| `div.complete` flotante con las sugerencias                                   |

### El menú del bullet

Copiar referencia · Copiar identificador · Copiar el Markdown · Subir · Bajar ·
Enfocar en este bloque · Eliminar bloque.

Las acciones imposibles se muestran atenuadas con su motivo.

### Teclas (mientras se edita)

`Enter` parte · `Shift+Enter` salto de línea · `Tab` / `Shift+Tab` indenta y
desindenta · `Retroceso` al inicio fusiona · `↑ ↓` cambian de bloque · `Escape`
sale guardando. `[[` `((` `#` `/` abren el autocompletado.

**Para reestructurar:** el panel scrollea entero, cabecera incluida. No hay
índice de la página, ni ancho de lectura máximo —el texto se estira con la
columna—. Una página vacía sí ofrece escribir su primer bloque.

---

## 4 · Mapa `#graph`

| Modo   | Qué es                          |
| ------ | ------------------------------- |
| `2D`   | Fuerza dirigida en D3           |
| `3D`   | `3d-force-graph`, dibujo en un iframe aislado |

Muestra la **vecindad** de la página abierta, hasta profundidad 2. El nodo
central destaca; los últimos cinco visitados se tiñen. Tocar un nodo abre su
página, y en un teléfono además cambia a la vista de texto.

**Lo que no tiene:** la profundidad está fija en 2 y no se puede cambiar desde la
interfaz. No hay leyenda, ni filtros, ni búsqueda dentro del mapa, ni forma de
fijar un nodo. No se puede ver el grafo completo, sólo vecindades.

---

## Lo que flota por encima de la rejilla

Nada de esto ocupa una celda: se posiciona por su cuenta y por eso sobrevive a
cualquier reestructuración de columnas.

| Elemento        | Dónde aparece                    | Qué es                                    |
| --------------- | -------------------------------- | ----------------------------------------- |
| `#tokens`       | Fijo, arriba a la derecha        | Configuración: Teclado y Apariencia       |
| `.block-menu`   | Bajo el bullet pulsado           | Acciones del bloque                       |
| `.complete`     | Bajo el campo en edición         | Sugerencias del autocompletado            |
| `.toast`        | Fijo, abajo al centro            | Avisos breves y negativas                 |
| `#results`      | Bajo el buscador                 | Hallazgos                                 |
| `#sin-arranque` | Cubre todo                       | Sólo si el guion no llegó a ejecutarse    |
| `p.notice`      | Dentro de `#text`                | Errores de carga, con reintento           |

---

## Qué se recuerda y dónde

| Qué                      | Dónde                    | Alcance                          |
| ------------------------ | ------------------------ | -------------------------------- |
| Esquema claro/oscuro     | `localStorage`           | Este navegador                   |
| Disposición y divisor    | `localStorage`           | Este navegador                   |
| Modo 2D/3D               | `localStorage`           | Este navegador                   |
| Tokens de diseño         | `localStorage`           | Este navegador                   |
| Bloques plegados         | Servidor, por participante | **Todos sus aparatos**          |
| Historial de navegación  | Memoria                  | Se pierde al recargar            |
| Página abierta           | **La URL**               | Enlazable, con atrás y adelante  |

**El enrutado ya existe.** La dirección es `/p/<título>?focus=<bloque>#<bloque>`,
resuelve también por identidad estable, y atrás/adelante funcionan.

---

## Lo que la interfaz todavía no ofrece

- Borrar una página
- Cambiar de privada a pública
- Ver o recorrer el registro de operaciones
- Editar propiedades **de un bloque** (sólo de la página)
- Ver las 804 páginas que no entran en el índice
