# Gobierno ontológico visual: corte experimental

Este experimento mejora las tres superficies rectoras que Vera ya tiene:
`VERA: Objetos`, `VERA: Propiedades` y `VERA: Relaciones`. No introduce una
aplicación, una ruta ni una ontología paralelas. Cada faceta sigue siendo su
página canónica, con sus bloques, tablas, operaciones e historia.

## Hipótesis

Una interfaz de gobierno puede ampliar los estilos cognitivos admitidos si la
declaración textual y el esquema visual son dos inscripciones sincronizadas del
mismo acto. La manipulación directa sólo es veraz cuando produce una operación
canónica que puede leerse, auditarse, deshacerse y volver a proyectarse en ambos
lados.

En estas páginas la declaración aparece a la izquierda y su figura a la
derecha. Es una excepción deliberada al orden del mapa ordinario de Vera: aquí
no se observa un vecindario documental, sino dos notaciones de una misma regla.

## Qué demuestra el primer corte

- Las tres páginas forman un visor facetado. Cambiar de faceta abre la página
  rectora correspondiente; no cambia un estado oculto dentro de una cuarta
  superficie.
- La API `/ontology` proyecta objetos, propiedades y relaciones sin mantener
  otro almacén semántico en el navegador.
- Las relaciones aparecen como entidades gobernables entre dominio y rango,
  no como cables mudos.
- ELK calcula una geometría determinista por capas, con rutas ortogonales y
  cajas medidas. D3 y el DOM conservan la interacción y la accesibilidad.
- Seleccionar una fila enfoca la misma entidad en el esquema; seleccionar una
  tarjeta revela su fila exacta.
- Renombrar desde la figura emite la misma operación `edit_block` que la tabla,
  por el canal `drawn`. Al volver la respuesta canónica, tabla y esquema se
  redibujan desde ella.
- La ruta no visual permanece completa: tabla editable, teclado, rótulos
  accesibles y movimiento reducido.
- En teléfono las dos inscripciones no se reducen hasta quedar ilegibles: una
  alternancia explícita **Declaración ↔ Esquema** conserva el mismo bloque y
  permite volver al otro lado del gesto.

## Prueba sobre el corpus real

El prototipo se ejecutó contra una copia temporal de la base activa, nunca
contra producción. En `VERA: Relaciones`, renombrar visualmente `profundiza`
produjo una sola operación `drawn`; el nuevo nombre reapareció tanto en la tabla
como en el esquema y `/invariants` permaneció vacío. Cambiar a Propiedades abrió
`VERA: Propiedades`, y el foco de una fila seleccionó la tarjeta con el mismo
identificador de bloque.

La verificación automatizada cubre las tres facetas, la relación como entidad,
la conservación del vocabulario de operaciones, el orden texto–figura y la
ruta accesible. El corte convergente que lo integra con el bibliotecario
embebido pasa 1.817 pruebas.

## Límites deliberados

- Sólo el nombre de la entidad activa se edita directamente en el esquema.
- Crear objetos, propiedades o relaciones sigue ocurriendo en la tabla.
- Dominio, rango, cardinalidad y restricciones todavía no se editan dibujando.
- No existe aún una vista previa del impacto sobre páginas del corpus.
- La posición espacial se deriva cada vez; no es una preferencia persistente ni
  parte de la ontología.
- El prototipo no adopta RDF, OWL, SHACL ni un triple store. Toma de SHACL la
  idea de contrato verificable, no su serialización antes de necesitarla.

## Próximo corte justificable

La siguiente prueba debería permitir cambiar dominio y rango conectando una
relación con objetos existentes. El gesto debe crear un borrador, mostrar el
texto exacto que cambiaría, validar la cardinalidad y anticipar las instancias
afectadas antes de ofrecer su aprobación. Si no puede conservar esas garantías,
el cable sólo debe orientar: no gobernar.

La especificación ejecutable de este experimento vive en
[`specs/ontology-roundtrip.allium`](../specs/ontology-roundtrip.allium).
