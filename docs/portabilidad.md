# Portabilidad — hacer tuyo este repositorio

La entrada pública para probar e instalar está en
[VERA — Probar e instalar](https://vera.mediafranca.net/vera-probar-e-instalar/).
Este documento conserva el procedimiento técnico para levantar, adaptar,
respaldar y mover una instancia.

Este documento es para quien recibe acceso a Vera y quiere levantarla en su
máquina, hacerla suya y empezar a probar. Está escrito para leerse entero antes
de tocar nada, y también para que un agente pueda seguirlo paso a paso.

Vera se dice soberana. Una herramienta soberana que sólo corre en la máquina de
quien la escribió no lo es, así que este archivo es la prueba de esa afirmación:
qué hace falta, qué está resuelto y qué todavía no.

---

## 0. Antes que nada: haz un fork

No clones directamente. **Haz un fork** en GitHub y trabaja sobre él.

La razón no es burocrática. Vera está en alfa y cambia rápido; lo que descubras
al instalarla en otra máquina —dependencias que faltan, supuestos que no se
cumplen, cosas que sólo funcionan aquí— es exactamente lo que este repositorio no
puede ver desde dentro. Con un fork, cada arreglo tuyo vuelve como *pull
request*, se discute sobre el diff y queda en la historia. Sin fork, se pierde en
una conversación.

```sh
# en GitHub: Fork
git clone git@github.com:TU-USUARIO/vera.git && cd vera
git remote add upstream git@github.com:mediafranca/vera.git
```

`upstream` te deja traer cambios de aquí sin perder los tuyos:

```sh
git fetch upstream && git merge upstream/v0-implementacion
```

---

## 1. Qué necesitas instalado

| Requisito | Para qué | Obligatorio |
| --- | --- | --- |
| **Node.js 24+** y npm | todo | sí |
| **allium** | validar y analizar las especificaciones | sí, ver §2 |
| **ffmpeg** | normalizar el audio capturado | sólo para voz |
| **whisper.cpp** (`whisper-cli`) + un modelo `.bin` | transcribir en local | sólo para voz |
| un modelo local vía **Ollama** o equivalente | que el bibliotecario lea páginas | opcional |
| **Tailscale** | alcanzar tu instancia desde otros aparatos | opcional, ver §6 |

Vera arranca sin voz y sin modelo: lo dice al iniciar y sigue funcionando. Lo que
no puede faltar es Node y —si vas a tocar las specs, que es el método— allium.

---

## 2. Instala Allium

**Esto no es opcional si vas a escribir o modificar especificaciones.** Sin
allium tus specs no se validan, y una spec que no se valida no es una spec: es
una intención escrita en un archivo.

Allium se distribuye como plugin de Claude Code, desde el marketplace de JUXT:

```
/plugin marketplace add juxt/claude-plugins
/plugin install allium@juxt-plugins
```

Deja el binario `allium` en tu `PATH` (aquí vive en `~/.local/bin/allium`).
Comprueba que quedó y qué versión del lenguaje habla:

```sh
allium --version        # p. ej. allium 3.5.0 (language versions: 1, 2, 3)
npm run spec            # allium check specs/
```

**Fija la misma versión mayor de lenguaje que usa este repositorio.** Las specs
declaran su versión; si tu allium habla una distinta, `check` fallará o —peor—
aceptará algo que aquí no vale, y tus pull requests traerán specs incompatibles.
Si `npm run spec` falla recién clonado, es de versión: dilo antes de tocar nada.

El plugin trae además seis skills que son el método en funcionamiento:

| Skill | Qué hace |
| --- | --- |
| `elicit` | conversación estructurada para sacar una spec nueva de la nada |
| `tend` | escribir, corregir y refactorizar specs; discute requisitos vagos |
| `weed` | encontrar dónde spec e implementación divergieron |
| `distill` | extraer una spec de código que ya existe |
| `propagate` | derivar tests desde las obligaciones de una spec |
| `allium` | el lenguaje en sí |

---

## 3. El método: por qué las specs van primero

Esto no es un detalle de estilo del repositorio. Es cómo se trabaja aquí, y si
mandas un pull request se va a revisar con este criterio.

**Primero se especifica el comportamiento y sus casos límite en Allium. Después
se elige arquitectura e implementación.** Las decisiones técnicas sirven a las
garantías del producto; no las sustituyen.

En la práctica:

1. **Antes de escribir código nuevo**, mira si hay una spec en `specs/` que lo
   cubra. Si la hay, léela: es la fuente de verdad, no el código.
2. **Si no la hay**, la spec se escribe primero — con `elicit` si el
   comportamiento aún no está claro, con `tend` si ya lo está.
3. **Los invariantes y garantías se citan en el código** que los cumple, con
   `@invariant NombreDelInvariante` o `@guarantee NombreDeLaGarantía` en un
   comentario. Así se puede ir del código a la razón, y de la razón al código.
4. **Las preguntas abiertas se dejan escritas**, como `open question "…"` dentro
   de la spec. Son el estado real del trabajo de elicitación, no defectos que
   haya que esconder. Una spec sin preguntas abiertas suele ser una spec que no
   se pensó lo suficiente.
5. **`npm run spec` antes de cada commit** que toque `specs/`.

```sh
npm run spec           # allium check specs/ — validación estructural
npm run spec:analyse   # flujo de datos, alcanzabilidad, conflictos
npm run typecheck
npm test
```

Lo que las specs cubren y lo que deliberadamente no, está en
[test-obligations.md](test-obligations.md). Léelo: dice dónde están los huecos.

---

## 4. Qué tienes que reemplazar para que sea tuyo

El repositorio **no contiene ningún corpus**. `data/` (la base SQLite),
`objects/` (los binarios) y `.env` están fuera de git desde el primer commit y
nunca estuvieron dentro. Clonar Vera te da el programa, no la memoria de nadie.

Lo que sí queda son referencias al autor y a su instalación. Ninguna es un
secreto, pero todas hay que cambiarlas para que tu instancia hable de ti.

### 4.1 Obligatorio — sin esto no funciona bien

**`.env` — de quién es el grafo.**

```sh
cp .env.example .env
```

y edita al menos:

```sh
VERA_OWNER=participant:tu-nombre
VERA_OWNER_NAME=Tu Nombre
```

Esto no es cosmético: sin credencial, **todo lo que escribas se firma como el
dueño**, y la procedencia de cada bloque es de lo que Vera trata. El servidor lo
dice al arrancar:

```
dueño:    Tu Nombre (participant:tu-nombre)
```

Ponlo **antes de escribir nada**. Un grafo que ya tiene dueño lo conserva —
cambiarlo después sería reescribir de quién es lo ya escrito, y Vera no lo hace.
Si arrancas con un grafo vacío y sin declarar dueño, Vera se planta con un error
en vez de inventarte una identidad.

### 4.2 Lo que queda del autor original

El grueso ya está despersonalizado: nombres de máquina, tamaños del corpus
original, rutas locales y la identidad cableada en el servidor, el cliente y el
importador. Lo que queda son **comentarios y prosa**, y está a propósito.

Búscalo así, para verlo tú mismo:

```sh
git grep -InE 'herbert|hspencer|bibliotecario'
```

| Dónde | Qué es | Qué hacer |
| --- | --- | --- |
| `specs/*.allium` | «Herbert» y «el bibliotecario» como personas del dominio | dejarlo, ver abajo |
| comentarios en `packages/**` | ejemplos que nombran a esas mismas personas | dejarlo o reescribir al pasar |
| `README.md` línea del manifiesto | cita a un texto publicado del autor | dejarlo: es una referencia, no configuración |
| `docs/architecture.md` | URLs históricas del sitio personal que se proyecta | reemplazar por el tuyo si vas a publicar |
| `packages/*/test/*.ts` | `participant:herbert` como fixture | datos de prueba; cámbialos si te estorban |

**Sobre las specs:** están escritas nombrando a las personas concretas para
quienes se especificó el sistema. Eso es deliberado en el método —una spec habla
de gente, no de «el usuario»— y reescribirlas en masa te haría perder el
razonamiento que contienen. Déjalas mientras estudias el sistema, y usa tus
propias personas cuando escribas specs nuevas. Si mandas un pull request tocando
specs, no las renombres: sería un diff ilegible que esconde el cambio real.

**Sobre el agente:** «el bibliotecario» es un rol de esta instancia, no una parte
fija de Vera. El tuyo tendrá otro nombre y otras instrucciones — son páginas del
corpus, no código.

### 4.3 La ontología

El vocabulario con que Vera clasifica vive en **páginas rectoras del corpus**,
no en el código: `VERA: Objetos` declara las clases, `VERA: Propiedades` las
preguntas estructuradas y `VERA: Relaciones` los tipos de arista. La política
para contenido ejecutable externo vive aparte en `VERA: Incrustaciones`, porque
es seguridad y no ontología. Lo que el código trae es un juego
mínimo de tipos por defecto (`STARTER_TYPES` en `packages/server/src/model.ts`:
Persona, Organización, Lugar, Idea, Pregunta, Afirmación, Nota, Proyecto, Tarea,
Trámite, Entrada diaria, Bitácora, Evento…) que rige mientras esa página no
existan declaraciones y que éstas pisan cuando aparecen — `@invariant DefaultsLiveInTheCode`.

Es deliberado que sea así: la ontología de una memoria personal es una decisión
de quien la habita, no del programa. Tu instancia arranca con el mínimo y lo hace
crecer escribiendo sus propias páginas rectoras. **No heredas las categorías de
nadie**, y para un uso donde las categorías describen la vida de alguien, eso es
el punto entero.

---

## 5. Levantarla

```sh
npm install
cp .env.example .env          # y editarlo: VERA_OWNER primero
npm run build                 # la PWA a packages/web/dist
npm run serve                 # http://localhost:4173
```

El servidor sirve la PWA **ya construida**, así que `build` va antes de `serve`.
Si editas código del cliente y no reconstruyes, el navegador sigue con la versión
vieja: el servidor te avisa al arrancar si `dist` quedó atrás de las fuentes.

Para desarrollo, `make dev` levanta el servidor y un `vite build --watch`
juntos, así el `dist` se rehace solo. Para convivir con él —dejarlo corriendo y
alcanzarlo desde el teléfono— están `make start`, `make status`, `make restart`
y `make stop`, que lo llevan en segundo plano y dejan su registro en
`.vera-server.log`.

**Cuándo hay que reiniciar.** El cliente se recompila y el servidor lo relee
solo; el dominio no. `@vera/core` y `@vera/store` se cargan al arrancar, así que
un cambio en las reglas no llega hasta que el proceso vuelve a nacer, y no avisa:
la aplicación sigue respondiendo con las reglas viejas. Tras tocar
`packages/core` o `packages/store`, `make restart`.

Y para publicar, `make deploy m="qué cambió"`: comprueba, compila, commitea,
empuja y verifica que el servidor sirve la huella recién compilada — que es la
condición para que un aparato instalado la reciba.

Una instancia vacía es utilizable desde el primer momento: abre en el día de hoy
y el día empieza a existir con lo primero que escribas. No hace falta importar
nada.

### Traer un corpus de Logseq

```sh
npm run import -- /ruta/a/tu/grafo
```

Lee el mismo `.env` que el servidor, así que el dueño sale de ahí. Si no lo
declaraste, se niega a importar en vez de firmar decenas de miles de operaciones
a nombre de nadie.

El importador reporta explícitamente lo que no pudo traer. Léelo: no es un log,
es la lista de lo que se perdió.

### Instalarla como aplicación

Vera es una PWA: en el navegador, «Instalar aplicación». No pasa por ninguna
tienda ni depende de que un proveedor siga existiendo.

---

## 6. Exponerla fuera de tu máquina

**Las personas todavía no se autentican ante Vera.**
[`identity-access.allium`](../specs/identity-access.allium) lo declara como
pregunta abierta. Mientras siga así, **cualquiera que alcance el puerto escribe
como el dueño**.

Por eso `VERA_HOST` se queda en `127.0.0.1` y delante se pone algo que termine
TLS y controle quién llega. En estas instalaciones, Tailscale:

```sh
tailscale serve --bg 4173     # sólo para los aparatos de tu tailnet
```

Así se usa desde el teléfono y desde otra máquina sin abrir nada a internet. El
servidor avisa al arrancar si le pides escuchar fuera de loopback; no es una
advertencia decorativa: hoy es la única puerta.

Si instalaste Vera como aplicación de escritorio en vez de levantarla desde el
código fuente, el mismo procedimiento —con capturas y sin terminal salvo por un
comando— está en
[Acceder desde tu teléfono u otro equipo](acceso-remoto-tailscale.md).

---

## 7. Llevarte el corpus entre máquinas

| Vía | Qué mueve | Cuándo |
| --- | --- | --- |
| copiar `data/` y `objects/` | el grafo entero, con su registro de operaciones y su procedencia | mudarte de máquina |
| la proyección Markdown a git | el texto, legible y versionable, sin el op-log | compartir, publicar, respaldar en frío |
| `npm run import -- <ruta>` | un grafo Logseq de archivos Markdown | venir de otra herramienta |

La base canónica es SQLite y **no tiene usuario ni contraseña**: quien puede leer
el archivo puede leer el grafo. Su control de acceso son los permisos del sistema
de archivos. Eso es la decisión, no un pendiente — la raíz de confianza de una
instancia soberana es tener el disco.

---

## 8. Lo que todavía falta

Honestamente, hoy la instalación pide leer este archivo y editar un `.env` a
mano. Lo que falta, y son buenos primeros pull requests:

- **Un asistente de instalación** (`npm run setup`) que pregunte lo poco que hay
  que decidir —quién es el dueño, dónde vive el corpus, si hay voz— y escriba el
  `.env`. Hoy se copia y se edita.
- **Comprobación de dependencias al instalar.** El servidor ya diagnostica
  `ffmpeg`, `whisper.cpp` y el modelo local al arrancar, pero eso es después de
  haber instalado todo lo demás.
- **Verificación de que el corpus llegó entero** al mudarse de máquina.
- **Una ontología inicial sembrable**, para no empezar siempre desde el mínimo
  del código.

Y en el producto, lo grande: que las personas se autentiquen. Hasta entonces,
Vera es de un solo dueño y se protege con la red, no consigo misma.
