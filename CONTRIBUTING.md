# Cómo se trabaja en Vera

Vera se escribe con un método, y el método es más importante que cualquier
cambio concreto. Este archivo lo dice entero. Léelo antes del primer commit: casi
todo lo que aquí se rechaza se rechaza por la forma, no por el fondo, y la forma
se puede saber de antemano.

Contribuir a VERA no es solamente ampliar un programa. Es intervenir en una
infraestructura que media entre una persona, su memoria intelectual y los agentes
que trabajan sobre ella. Por eso una mejora de comodidad nunca puede borrar
procedencia; una automatización no puede apropiarse de una decisión; y una
integración no puede volver cautivo el corpus. El criterio rector es preservar la
cadena de soberanía completa, no optimizar una pieza a costa de las demás.

Una contribución debe poder explicar qué capacidad humana protege o amplía, qué
garantía mantiene y cómo podría comprobarse que no dañó las anteriores. Las
afirmaciones pedagógicas o epistemológicas se formulan como hipótesis cuando aún
no existe evidencia: VERA es también un instrumento de investigación y debe poder
producir resultados negativos sin ocultarlos.

**Lo esencial, en cuatro líneas:**

1. **Primero la spec, después el código.** Si no hay spec que lo cubra, se
   escribe la spec.
2. **Cada tarea en su rama.** Nunca se trabaja sobre `main` ni sobre la rama de
   integración.
3. **Nadie hace merge a `main`.** `main` está protegida y la mueve sólo la
   custodia.
4. **`make check` en verde antes de proponer.** Sin excepciones y sin «es que
   sólo…».

---

## 1. El método: Allium antes que código

Primero se especifica el comportamiento y sus casos límite en
[Allium](specs/). Después se elige arquitectura e implementación. Las
decisiones técnicas sirven a las garantías del producto; no las sustituyen.

Esto no es una preferencia de estilo. **Es el criterio con que se revisa un
pull request**, y es lo primero que se mira.

### El ciclo

1. **Antes de escribir código nuevo, busca la spec que lo cubra.** Si existe, la
   spec es la fuente de verdad y el código es lo que está mal.
2. **Si no existe, se escribe primero.** `elicit` cuando el comportamiento
   todavía no está claro; `tend` cuando ya lo está.
3. **Los invariantes y garantías se citan en el código** que los cumple:
   `@invariant …`, `@guarantee …`. Sirve para ir del código a su razón y de la
   razón al código, y sin eso la spec envejece en silencio.
4. **Las preguntas abiertas se dejan escritas** (`open question "…"`). Son el
   estado real de la elicitación, no defectos que ocultar. **No se cierra una
   pregunta abierta implementando algo y no diciéndolo.**
5. **`npm run spec` antes de cada commit** que toque `specs/`.

### Instalar allium

Se distribuye como plugin de Claude Code, desde el marketplace de JUXT:

```
/plugin marketplace add juxt/claude-plugins
/plugin install allium@juxt-plugins
```

```sh
allium --version       # comprueba qué versión de lenguaje habla el binario
npm run spec           # allium check specs/ — validación estructural
npm run spec:analyse   # flujo de datos, alcanzabilidad, conflictos
```

Fija la **misma versión mayor de lenguaje** que usan estas specs. Con otra,
`check` falla o —peor— acepta algo que aquí no vale.

Las seis skills del plugin son el método en funcionamiento: `elicit` (sacar una
spec de la nada), `tend` (escribirlas y corregirlas), `weed` (encontrar dónde
spec e implementación divergieron), `distill` (extraer una spec de código que ya
existe), `propagate` (derivar tests desde las obligaciones de una spec) y
`allium` (el lenguaje).

### Cuándo un cambio no necesita spec

Corregir una errata, afinar un margen, actualizar una dependencia, arreglar un
enlace roto. La regla práctica: **si alguien puede quedar sorprendido por el
comportamiento nuevo, hay comportamiento nuevo, y hay spec.**

Cambiar un mensaje de error *sí* es comportamiento: es lo que la persona lee
cuando algo salió mal.

## 2. Ramas

### Antes de empezar o retomar

```sh
npm run preflight
```

El preflight hace `git fetch --prune`, descubre la rama remota que esta rama
realmente sigue —sin suponer que se llama `main`— y falla si el trabajo quedó
detrás. También comprueba que la matriz tenga exactamente una fila por spec.
Se repite antes de publicar: otra persona puede haber movido la referencia
durante la sesión. Integrar puede ser merge o rebase según la rama; ocultar la
divergencia con un force-push no es una integración.

### El mapa

| Rama | Qué es | Quién la mueve |
| --- | --- | --- |
| `main` | La línea protegida. | **Sólo la custodia.** |
| `v0-implementacion` | La rama de integración. Es a donde apuntan los pull requests. | Por PR revisado. |
| `vN.M-tema` | Una tanda de trabajo con nombre. `v0.4-local-first`, `v0.2-consultas`. | Quien la abrió. |

### Las reglas

- **Nunca se hace merge a `main`.** Está protegida y así se queda. La custodia
  decide qué llega y cuándo, y por ahora esa custodia es una persona. No es
  desconfianza: es que `main` es la referencia con la que se compara todo lo
  demás, y una referencia que cualquiera mueve no es una referencia.
- **Nunca se trabaja sobre la rama de integración.** Se abre una rama propia,
  aunque el cambio sea de una línea.
- **Nunca se fuerza el empuje sobre una rama compartida.** `--force-with-lease`
  sobre tu propia rama antes de que la revise alguien, sí. Después, no.
- **Una rama, un asunto.** Si a mitad de camino encuentras otra cosa que
  arreglar, anótala y ábrele su rama. Un pull request que hace dos cosas se
  revisa mal y se revierte peor.
- **Se rebasa sobre la integración antes de proponer**, para que el historial
  quede legible y el diff diga lo que hiciste tú.

### El nombre de la rama

`vN.M-tema-en-dos-o-tres-palabras`, en español, sin el nombre de quien la abre.
La rama es del trabajo, no de la persona.

```
v0.4-local-first          v0.3-frontera          v0.2-consultas
```

### Dos cosas a la vez

Trabajar dos tareas en el mismo directorio no falla ruidosamente: **falla al
confirmar**. `git add -A` se lleva los archivos de la otra tarea, y como cada una
compila con los archivos de la otra delante, el defecto no aparece hasta que
alguien clona el repositorio y descubre que la rama importa un módulo que nunca
se agregó al índice.

```sh
make worktree n=tareas        # ../vera-tareas, en su propia rama
cd ../vera-tareas             # ahí vale todo lo que no publica
git merge v0.3-tareas         # y para juntar, desde el principal
```

El árbol aparte instala sus propias dependencias en vez de enlazar las del
principal: dentro de `node_modules` los paquetes del monorepo son enlaces
relativos, así que compartirlo hace que el árbol aparte pruebe el código del
principal sin decirlo.

**Lo que no se hace en un árbol aparte es levantar un segundo servidor.** El
corpus es uno, y dos procesos con su propio grafo en memoria sobre la misma base
acabarían escribiendo cada uno sobre lo que el otro no vio.

## 3. Commits

### La forma

```
tipo(ámbito): qué es verdad ahora que antes no lo era
```

- `feat` `fix` `refactor` `docs` `spec` `chore` `test`
- El ámbito es el paquete: `core`, `store`, `web`, `server`, `mcp`, `importer`.
  Se omite si el cambio los cruza.
- **En español, en minúscula, sin punto final.**

### El asunto dice el efecto, no la acción

Es la convención de la casa y vale la pena entenderla. El asunto no describe lo
que hizo el commit: describe **el mundo después del commit**.

```
✓ feat(web): lo pendiente sobrevive a cerrar, y sale solo cuando vuelve la red
✓ feat(web): la mano deja de esperar a la red
✓ fix(store): poner una propiedad en una página dejaba sin ella al resto del corpus
✓ docs: medir el hueco entre la spec local-first y el código

✗ feat(web): agregar persistencia en IndexedDB
✗ fix: arreglar bug de propiedades
✗ refactor: mejoras varias
```

Se escribe así porque quien lee el historial dentro de un año no busca qué se
tocó —eso lo dice el diff— sino **qué cambió para quien usa Vera**. Un asunto que
nombra el archivo obliga a abrir el commit para saber si importa.

### El cuerpo dice por qué

Si el cambio tiene una razón que no se lee en el diff, va en el cuerpo: qué se
intentó antes, qué invariante lo obligaba, qué se decidió no hacer. Los commits
de este repositorio son documentación y se leen como tal.

### Lo que nunca entra en un commit

- **Secretos.** `.env` está fuera de git desde el primer commit, y así sigue. Un
  secreto en git no se borra borrándolo: queda en el historial, en cada clon y en
  cada fork.
- **El corpus.** `data/`, `objects/` y todo `*.sqlite` están fuera. El
  repositorio da el programa, no la memoria de nadie.
- **`node_modules/`, `dist/`, `.claude/`.**
- **Cambios de formato mezclados con cambios de fondo.** Si hay que reformatear,
  va en su propio commit y el asunto lo dice.
- **[`AUTHORS.md`](AUTHORS.md) dentro de un commit que además hace otra cosa.**
  Cambiar ese archivo cambia quién cobra; va solo.

## 4. Antes de proponer un cambio

```sh
make check      # typecheck + pruebas + allium check, sin publicar nada
npm run preflight # remoto vigente + cobertura de trazabilidad
```

En verde. Los tres.

- **`npm run typecheck`** — `tsc --noEmit`, raíz y PWA.
- **`npm test`** — `node --test`, sin build.
- **`npm run spec`** — `allium check specs/`.
- **`npm run traceability:check`** — toda spec aparece una vez en la matriz.

Si cambió comportamiento, implementación o pruebas, revisa además la fila
correspondiente en `docs/plan-maestro/matriz-trazabilidad.md`. La CI detecta
specs ausentes o duplicadas; decidir si algo está VERIFICADO, PARCIAL o todavía
es aspiracional exige el ciclo `weed` y no puede delegarse a un contador.

Y a mano, lo que ninguna de las tres ve:

- **Ábrelo en el navegador.** Varios de los defectos de este repositorio no los
  encontró ninguna prueba: los encontró abrir la aplicación. Si tocaste
  `packages/web`, míralo también en un teléfono.
- **Reinicia si tocaste el dominio.** `@vera/core` y `@vera/store` se cargan una
  sola vez al arrancar. Un cambio en las reglas no llega hasta que el proceso
  vuelve a nacer, **y no avisa**: la aplicación sigue respondiendo con las reglas
  viejas. `make restart`.

## 5. El pull request

- **Apunta a la rama de integración** (`v0-implementacion`), nunca a `main`.
- **El título sigue la forma del commit.** Si el PR trae un solo commit, es el
  mismo texto.
- **El cuerpo dice tres cosas:** qué spec gobierna este cambio, qué se comprobó a
  mano, y qué quedó fuera a propósito.
- **Si tocaste `specs/`, pega la salida de `npm run spec`.**
- **Si es un cambio de comportamiento sin spec, se pide primero la spec.** No es
  burocracia: es que discutir el comportamiento sobre una implementación ya
  escrita hace que la implementación gane la discusión.

### Qué mira la revisión, en este orden

1. **¿Hay una spec que lo gobierne, y dice esto?**
2. **¿Los invariantes que toca están citados en el código?**
3. **¿Lo que la spec dejaba abierto sigue abierto, o se cerró en silencio?**
4. **¿La procedencia se conserva?** Todo cambio conserva participante, canal,
   instante y evidencia de origen. Ninguna escritura tiene una segunda puerta.
5. **¿Se puede leer dentro de un año?**
6. Y después, lo de siempre: que funcione, que no repita, que no sobre.

### Cuánto tarda

Hoy revisa una persona, con otro trabajo encima. Un cambio pequeño y bien
formado, días. Un cambio grande sin spec previa puede no revisarse nunca, y ese
es exactamente el caso que el punto 1 del método viene a evitar: **habla antes de
escribir**. Abre un issue, propón la spec, y el código después.

## 6. Etiqueta

- **Se discute el trabajo, no a quien lo hizo.** «Esto rompe el invariante X» y
  no «no entendiste el invariante X».
- **Se explica la negativa.** Rechazar sin decir por qué es hacerle perder el
  tiempo a alguien dos veces.
- **La duda se escribe.** Una pregunta abierta anotada vale más que una decisión
  tomada por cansancio. El repositorio entero está construido sobre esa idea.
- **La procedencia no se disimula.** Lo escrito con asistencia de un modelo se
  puede decir sin problema; presentarlo como otra cosa, no. Vera aplica el mismo
  criterio a su corpus y a su código: es autor quien decide, dirige y responde.
- **Nada de trabajo grande sin avisar.** Aparecer con seis mil líneas y esperar
  que se revisen es pedirle a otro que cargue con una decisión que ya tomaste
  solo.

## 7. Seguridad

**Un defecto de seguridad no se abre como issue público.** Vera custodia la
memoria personal de quien la usa; un fallo de aislamiento, de credenciales, de
alcance MCP o de escritura sin autoría es una llave ajena.

Escribe directamente a **hspencer@ead.cl**, con qué encontraste, cómo se
reproduce y qué versión. Se responde con lo que se sepa, y se acuerda cuándo se
hace público.

Zonas donde mirar con especial cuidado, por si sirve de mapa: la puerta MCP y su
registro de exposición; el cerco de escritura confinada; el aislamiento de las
incrustaciones; y todo lo que decide qué página es pública.

## 8. Contribuir y autoría

Al enviar un cambio declaras tres cosas, sin CLA ni cesión adicional:

1. **Tu contribución entra bajo la licencia del proyecto:** `AGPL-3.0-only`.
2. **Conservas tu autoría** sobre lo que escribiste, y puedes pasar a figurar en
   [`AUTHORS.md`](AUTHORS.md).
3. **Tienes derecho a aportar ese material** y a conceder esos permisos; no
   incorporas código incompatible ni secretos o corpus de terceros.

No hay cesión de derechos patrimoniales a MediaFranca por contribuir. Quién entra
al registro de autoría y con qué criterio está en [`AUTHORS.md`](AUTHORS.md).
Por qué la licencia es la que es está en
[`LICENCIA.md`](LICENCIA.md).

El proyecto aplica *inbound = outbound*: las contribuciones aceptadas reciben la
misma licencia AGPL que el resto. No existe hoy licencia dual. Relicenciar una
contribución bajo términos incompatibles requeriría el consentimiento de su
titular.

## 9. Levantar una instancia para trabajar

```sh
git clone git@github.com:TU-USUARIO/vera.git && cd vera
npm install
cp .env.example .env          # y editarlo: VERA_OWNER es lo primero
npm run build
npm run serve                 # http://localhost:4173
```

Hace falta **Node.js 24 o posterior**. La transcripción de voz y la clasificación
ontológica usan binarios locales opcionales —`whisper.cpp` y `llama.cpp`—; donde
no los haya, Vera hace la parte que no los necesita y dice cuál no pudo.

`VERA_OWNER` no es cosmético: sin credencial, todo lo que se escriba se firma
como la persona propietaria, y la procedencia es de lo que Vera trata.

El instructivo completo está en [`docs/portabilidad.md`](docs/portabilidad.md).

## 10. Meta deseable: proponer un cambio en diálogo con tu agente

Esto no existe todavía. Se anota aquí porque es una dirección, no una tarea:
**que quien conversa con su propia IA sobre su propia Vera pueda, en esa misma
conversación, terminar proponiendo una mejora a Vera** —sin salir del diálogo a
manejar git a mano— y que ese cambio llegue como un pull request normal,
revisado por la custodia igual que cualquier otro.

Parte del camino ya está construido, y no por este objetivo sino porque ya hacía
falta:

- [`docs/portabilidad.md`](docs/portabilidad.md) empieza por hacer un fork antes
  de clonar, exactamente para que cualquier arreglo vuelva como pull request en
  vez de perderse en una conversación, y está escrito **para que un agente lo
  pueda seguir paso a paso**.
- El método de este archivo —spec antes que código, una rama por asunto, la
  forma del commit, la plantilla del punto 5— ya es tan legible para un agente
  como para una persona: son reglas escritas, no criterio tácito.
- Las skills de Allium (`elicit`, `tend`, `weed`, ver [§1](#1-el-método-allium-antes-que-código))
  son en sí mismas agentes que ya recorren la mitad del ciclo: convierten una
  conversación en una spec.

Lo que falta no es el método — es la distancia entre **usar Vera** (hablarle a
través de la puerta MCP, con la identidad y el alcance de quien pregunta) y
**proponer un cambio a Vera** (que vive en GitHub, con la identidad de esa misma
persona ahí, no en el corpus). Cerrar esa distancia implica, sin resolverlo
todavía:

- **De qué identidad sale el commit.** No la credencial MCP de Vera —esa firma
  el corpus, no el código— sino la cuenta de GitHub de quien lo pide, sobre su
  propio fork. El [cerco de escritura confinada](specs/confined-writing.allium)
  es la referencia de diseño más cercana, aplicada a un sistema distinto.
- **Qué se automatiza y qué sigue exigiendo a alguien mirar.** `make check` antes
  de proponer, sí; saltarse la spec porque el agente escribe rápido, no. La
  plantilla del punto 5 —qué spec gobierna, qué se comprobó a mano, qué quedó
  fuera— tendría que llenarla el agente, no omitirla.
- **Que la procedencia quede tan clara como en el corpus.** El punto 6 ya dice
  que lo escrito con asistencia de un modelo se declara; un pull request abierto
  por un agente en nombre de alguien no es una excepción a esa regla, es el caso
  que la prueba.

No hay spec todavía porque el comportamiento no está claro: es exactamente el
caso del punto 1 de este método. Antes de construirlo, se elicita.

---

*Este archivo describe cómo se trabaja hoy, con un autor y una custodia. Cuando
haya más manos, cambiará — y el cambio se discutirá aquí, en su propia rama, como
todo lo demás.*
