# Fundamentos epistémicos y recorridos argumentales

Esta guía es la entrada para quien necesite entender o continuar el trabajo que
une procedencia, rol epistémico y recorrido argumental en Vera. Describe el
estado verificable del programa al 21 de septiembre de 2026; las
especificaciones citadas siguen mandando sobre el comportamiento.

## La distinción central

Vera conserva tres preguntas distintas. Mezclarlas vuelve impreciso el corpus:

1. **¿Qué es esta página?** Su clase semántica se expresa mediante la propiedad
   gobernada que cumple el papel `kind` —por ejemplo, concepto o argumento.
2. **¿Qué función cumple aquí?** El `rol epistémico` orienta la lectura de la
   página completa: fuente, testimonio, análisis, síntesis, pregunta o
   afirmación. No certifica que sus frases sean verdaderas.
3. **¿Cómo se llegó a sostener algo?** Un recorrido conserva paradas,
   conectivas, citas y procedencia. Al promoverlo nace una página argumento;
   las páginas citadas conservan su propia clase y su propio rol.

Una fuente puede intervenir en muchos argumentos sin convertirse en argumento.
Una síntesis puede citar testimonios y análisis sin apropiarse de su autoría. El
recorrido hace visible esa composición sin reescribir sus materiales.

## Qué existe hoy

- El vocabulario de `rol epistémico` está declarado en `VERA: Propiedades`. El
  editor recibe el dominio gobernado aunque algunos valores todavía no tengan
  usos y conserva separados declaración y frecuencia observada.
- Cada cambio de propiedad usa el registro ordinario de operaciones: identidad,
  autoría, fecha, canal, revisión y deshacer permanecen auditables.
- El rastro de navegación conserva gesto y repetición, puede ordenarse y
  podarse, y se puede promover a una página privada de tipo argumento.
- Las páginas argumento se leen como recorridos; sus paradas y cruces se derivan
  del contenido, las conectivas y las revisiones citadas.
- `VERA: Registro de Actividad` es la lectura humana del log canónico. Agrupa la
  actividad por día, distingue persona y agente, cuenta páginas creadas y enlaza
  tanto cada página viva como las contribuciones de cada participante.

## Qué está especificado pero no cerrado

`specs/epistemic-provenance.allium` admite que el bibliotecario proponga un rol
epistémico y que una persona lo acepte o rechace. El vocabulario y su edición
gobernada ya existen; la cola visible de propuestas y su decisión explícita aún
no tienen una superficie completa.

El recorrido funciona como composición, pero sigue abierto el trabajo editorial
y visual más fino: explicar mejor la fuerza de cada cruce, advertir cambios en
premisas citadas y decidir cómo viaja un recorrido publicado. Estas preguntas no
autorizan a convertir automáticamente enlaces o popularidad en evidencia.

## Mapa para continuar

| Pregunta | Autoridad | Implementación principal | Pruebas |
| --- | --- | --- | --- |
| Rol epistémico de una página | `specs/epistemic-provenance.allium` | `packages/server/src/server.ts`, `packages/web/src/outliner.ts` | `packages/server/test/server.test.ts` |
| Composición de recorridos | `specs/trail.allium` | `packages/core/src/trail.ts`, `packages/web/src/promote.ts`, `packages/web/src/main.ts` | `packages/core/test/trail.test.ts`, `packages/web/test/trace.test.ts` |
| Lectura del recorrido | `specs/workspace-interface.allium` | `packages/web/src/trail-page.ts`, `packages/web/src/outliner.ts` | `packages/web/test/trail-booklet.test.ts`, `packages/web/test/trace.test.ts` |
| Autoría y actividad | `specs/core.allium`, `specs/workspace-interface.allium` | `packages/server/src/activity.ts`, `packages/web/src/activity-page.ts` | `packages/server/test/server.test.ts`, `packages/web/test/activity-page.test.ts` |

`docs/plan-recorridos.md` conserva el diagnóstico y la secuencia histórica con
que se construyó el recorrido. No debe leerse como inventario vigente: varios de
sus pasos ya están implementados. Para comprobar el presente hay que seguir la
spec, el código y las pruebas de la tabla anterior.

## Criterio para la pasada bibliotecológica

La curaduría de páginas nuevas no consiste en añadir enlaces hasta que el grafo
parezca denso. Para cada página se revisa, en este orden:

1. título e identidad no duplicados;
2. clase semántica y rol epistémico, si corresponde declararlos;
3. procedencia y fuente primaria distinguibles de la lectura de Vera;
4. enlaces explícitos hacia conceptos, proyectos y personas ya existentes;
5. conectivas sólo cuando hay una afirmación que explique la relación;
6. pertenencia a un recorrido cuando aporta a un argumento, sin reclasificarla.

Toda intervención del bibliotecario pasa por operaciones autenticadas y queda
resumida en la única `**Bitácora de Cotito:**` del día. La ausencia de un rol no
es un defecto que deba rellenarse masivamente: se clasifica al crear, revisar o
usar una página como fundamento.

## Próximo corte recomendable

El siguiente corte debe juntar dos trabajos que se validan mutuamente:

1. una superficie de propuestas de rol epistémico, atribuida y decidible;
2. una lectura argumental que muestre por qué cada fuente, testimonio o análisis
   ocupa ese lugar en el recorrido.

Así el rol no queda como metadato ornamental y el recorrido no queda como una
secuencia sin estatuto epistémico.
