# Conectar una IA a Vera

La [Puerta MCP](https://vera.mediafranca.net/vera-puerta-mcp/) presenta esta
capacidad desde Vera. Aquí permanecen los pasos operativos, credenciales y
límites necesarios para conectar clientes concretos.

Cómo enchufar cualquier servicio de inteligencia artificial —Anthropic, OpenAI,
Google, Microsoft, DeepSeek, Mistral o el que aparezca el mes que viene— a esta
memoria.

> La puerta local ofrece lectura y escritura no destructiva bajo credencial. Lo
> que todavía no existe está marcado como tal en [Lo que no hay](#lo-que-no-hay),
> al final.

---

## La idea, en una frase

**Vera no tiene una integración por proveedor.** Tiene una sola puerta —un
servidor [MCP](https://modelcontextprotocol.io/)— y todos los formularios de
«agregar servidor MCP» piden exactamente lo mismo con nombres distintos: cinco
valores. Vera los calcula, y tú los pegas.

Eso es todo el método. Lo demás de este documento es cómo se llaman esos cinco
valores en cada formulario, de dónde se sacan, y qué hacer cuando no funciona.

---

## Paso 0 — ¿este servicio puede conectarse?

Lo que decide no es la marca. Es **dónde corre el cliente**.

| Dónde corre | ¿Se conecta hoy? | Cómo |
| --- | --- | --- |
| **En este equipo** — una app de escritorio o una CLI | Sí | [Caso A](#caso-a--el-cliente-corre-en-este-equipo) |
| **En otro equipo tuyo** de la tailnet | Sí | [Caso B](#caso-b--el-cliente-corre-en-otro-equipo) |
| **Cliente configurable desde cualquier red** | Sí | [Caso C](#caso-c--url-https-pública) |
| **En la nube del proveedor** — una pestaña del navegador | Depende de si acepta bearer o exige OAuth | Ver [Lo que no hay](#lo-que-no-hay) |

Vera ofrece dos transportes para el mismo contrato: **stdio** dentro de casa y
**Streamable HTTP** en `https://vera.mediafranca.net/mcp`. La segunda dirección
es públicamente alcanzable, pero no anónima: exige una credencial bearer válida
antes de inicializar el protocolo.

La pregunta correcta ante un servicio nuevo es si acepta MCP por stdio o una URL
Streamable HTTP con bearer. Si exige OAuth, queda para M6.

Al día de hoy, aplicado a los servicios más habituales:

| Proveedor | Cliente que entra | Cliente que no |
| --- | --- | --- |
| Anthropic | Claude Code y clientes de escritorio con HTTP + bearer | claude.ai cuando exige un conector alojado |
| OpenAI | Codex CLI, extensión y app; ChatGPT web en un espacio Business, Enterprise o Edu con modo desarrollador | ChatGPT no lee la configuración local de Codex; las cuentas personales no admiten hoy MCP personalizados |
| LM Studio | la app 0.3.17 o posterior, con un modelo capaz de usar herramientas | — |
| Google | Gemini CLI | Gemini en el navegador |
| Microsoft | VS Code / Copilot (`mcp.json`) | Copilot en el navegador |
| DeepSeek, Mistral, otros | cualquier cliente suyo que corra en tu equipo | sus interfaces web |

Esta tabla envejece: los proveedores añaden y quitan clientes. La regla de
arriba —**dónde corre**— no envejece, y es la que conviene aplicar.

---

## Los cinco valores

Todo formulario local de «agregar servidor MCP por stdio» pide estos cinco, con
distintos nombres. Un archivo JSON los llama `type`, `command`, `args`, `env` y
`cwd`. Son lo mismo. ChatGPT no pertenece a este caso: necesita una URL HTTPS
de Streamable HTTP que sus servidores puedan alcanzar.

| Lo que te pide el formulario | Qué es | Valor |
| --- | --- | --- |
| **Tipo** · Transport · Type | Cómo se habla con el servidor | `stdio` (siempre, hoy) |
| **Comando** · Command · Comando para iniciar | El binario de Node, con ruta absoluta | `connect.command` |
| **Argumentos** · Args | Tres, en este orden | `connect.args` |
| **Directorio de trabajo** · cwd · Working directory | La raíz del repositorio | `connect.cwd` |
| **Variables de entorno** · env · Environment | Qué tiene que saber el proceso | [ver abajo](#las-variables-de-entorno) |

Dos avisos sobre las variantes:

- Algunos formularios piden **una sola línea de comando** en vez de comando y
  argumentos por separado. Entonces se pegan juntos, separados por espacios.
- Otros ofrecen «paso de variables de entorno»: heredar las del sistema. No hace
  falta. Vera necesita las suyas, declaradas explícitamente.

### Por qué la ruta de Node y no la palabra `node`

Porque el `PATH` del cliente no es el tuyo. Una app de escritorio lanzada desde
el menú no hereda lo que tu shell configuró, y `node` a secas falla con un
«command not found» que el cliente reporta como «el servidor MCP se cayó al
arrancar». La ruta absoluta no depende de nada.

Lo mismo con `cwd` y con la ruta de la puerta: absolutas siempre.

---

## De dónde se sacan los valores

**De la página «VERA: la puerta MCP»**, dentro de la aplicación, en la sección
«Cómo se enchufa una IA a esta Vera». Escribes ahí cómo se va a llamar la
conexión, eliges si el cliente corre aquí o en otro equipo, y la página dicta lo
que hay que pegar.

Esos valores **no están escritos: se calculan** de este despliegue —dónde está
el binario de Node, dónde está el repositorio, en qué puerto escucha Vera—. Una
prosa con la ruta y el puerto dentro mentiría con toda confianza el día de la
primera mudanza.

Si prefieres la terminal, salen del mismo sitio:

```sh
curl -s http://127.0.0.1:4173/mcp | jq .connect
```

```json
{
  "transport": "stdio",
  "command": "/usr/bin/node",
  "args": ["--experimental-strip-types", "--no-warnings",
           "/ruta/a/vera/packages/mcp/src/main.ts"],
  "cwd": "/ruta/a/vera",
  "url": "http://127.0.0.1:4173",
  "reachableAt": "https://vera.tu-tailnet.ts.net",
  "login": "usuario@equipo",
  "node": "v24.18.0",
  "present": true
}
```

`present: false` significa que la puerta no está donde se dice que está —el
repositorio se movió—. Los valores se calculan igual, pero no van a funcionar.

---

## Las variables de entorno

| Variable | Para qué | Por omisión |
| --- | --- | --- |
| `VERA_URL` | Dónde está la API | `http://127.0.0.1:4173` |
| `VERA_CLIENT` | Cómo se declara este cliente en el registro | `vera-mcp` |
| `VERA_TOKEN_FILE` | Archivo con el secreto de la credencial | — |
| `VERA_TOKEN` | El secreto, si el cliente no sabe pasar archivos | — |

- **`VERA_CLIENT` es la única decisión de las cinco.** Los demás valores son
  hechos del despliegue; éste es cómo va a aparecer esa IA en la tabla de
  conexiones y en el registro de exposición. Sin él, todas caen juntas en «sin
  declarar» y no hay forma de saber cuál leyó qué.
- **El secreto nunca va en los argumentos.** Los argumentos de un proceso los lee
  cualquiera con un `ps`. `VERA_TOKEN_FILE` antes que `VERA_TOKEN`, porque una
  variable de entorno se hereda a todo lo que el proceso lance y un archivo con
  permisos no.
- **Sin credencial se entra como el dueño.** Esa compatibilidad local todavía
  existe, pero no es una receta aceptable para agentes: atribuye a Herbert lo
  que leyó o escribió otro proceso. Para que una IA tenga identidad propia,
  [emítele una credencial](#emitir-una-credencial) y trata cualquier caída al
  dueño como un fallo de configuración.

---

## Caso A — el cliente corre en este equipo

La forma canónica, que la mayoría de los clientes acepta tal cual:

```json
{
  "mcpServers": {
    "vera": {
      "command": "/usr/bin/node",
      "args": ["--experimental-strip-types", "--no-warnings",
               "/ruta/a/vera/packages/mcp/src/main.ts"],
      "env": {
        "VERA_URL": "http://127.0.0.1:4173",
        "VERA_CLIENT": "como-se-llama-esta-conexion"
      }
    }
  }
}
```

Cambian el nombre del archivo y, en dos casos, el dialecto:

| Cliente | Dónde va | Diferencia |
| --- | --- | --- |
| Claude Code | ya está: el `.mcp.json` de la raíz lo declara | — |
| Claude Desktop | `claude_desktop_config.json` | ninguna |
| Gemini CLI | `~/.gemini/settings.json` | ninguna |
| Codex | `~/.codex/config.toml` | TOML, ver abajo |
| VS Code / Copilot | `.vscode/mcp.json` | la clave es `servers`, y lleva `"type": "stdio"` |

Para tener Vera en Claude Code fuera de este directorio:

```sh
claude mcp add vera --scope user -- \
  /usr/bin/node --experimental-strip-types --no-warnings \
  /ruta/a/vera/packages/mcp/src/main.ts
```

Y el mismo bloque en TOML, para Codex:

```toml
[mcp_servers.vera]
command = "/usr/bin/node"
args = ["--experimental-strip-types", "--no-warnings",
        "/ruta/a/vera/packages/mcp/src/main.ts"]
env = { VERA_URL = "http://127.0.0.1:4173", VERA_CLIENT = "codex" }
```

Ese bloque sólo muestra el dialecto TOML. Para usarlo, añade
`VERA_TOKEN_FILE = "/ruta/privada/vera-codex.token"` al `env`, o copia el bloque
completo que genera «VERA: Puerta MCP» después de crear la conexión. No dejes
Codex sin credencial.

**Vera tiene que estar corriendo** (`npm run serve`). El proceso de la puerta no
abre la base de datos: le pregunta a la API como cualquiera.

---

## Caso B — el cliente corre en otro equipo

Un portátil de la tailnet, con la IA instalada ahí y Vera aquí. Hay dos maneras,
y la buena no es la obvia.

**Lo que se hace:** que el cliente lance `ssh` y la puerta corra *aquí*, al lado
de Vera.

Para Codex, pega en `~/.codex/config.toml` el bloque TOML que dicta
«VERA: Puerta MCP». En esta instancia ya sale preparado para `codex-andrei`: la
credencial permanece cifrada en Alexei, se abre al iniciar la puerta y nunca se
copia a Andrei. `required = true` hace visible un fallo de conexión y
`default_tools_approval_mode = "auto"` evita una segunda confirmación por cada
escritura: el límite efectivo sigue siendo la concesión de Vera, que no ofrece
borrado.

Después ejecuta `codex mcp list` y, dentro de Codex, `/mcp`. La primera llamada
debe ser `vera_quien_soy` y responder `participant:codex`; cualquier otra
identidad es un fallo, no una conexión degradada.

```json
{
  "mcpServers": {
    "vera": {
      "command": "/usr/bin/ssh",
      "args": ["-q", "-o", "BatchMode=yes", "usuario@equipo",
               "VERA_CLIENT=mi-portatil /usr/bin/node --experimental-strip-types --no-warnings /ruta/a/vera/packages/mcp/src/main.ts"]
    }
  }
}
```

Nota que la parte remota es **una orden en una línea**, no un arreglo de
argumentos: un shell remoto recibe texto. Y que `VERA_URL` no aparece: el
proceso nace en la misma máquina que Vera, así que el loopback por omisión ya es
el correcto.

El JSON anterior sirve para clientes que lo esperan. Codex no usa ese formato:
su configuración vigente es TOML o `codex mcp add`.

**Lo que también funciona pero cuesta más:** tener el repositorio también en el
otro equipo y apuntar `VERA_URL` a `connect.reachableAt` —la dirección de
`tailscale serve`—. Entonces hay dos copias del código que mantener al día, y el
día que difieran fallará la que menos mires.

La página de la puerta dicta las dos formas, rellenas. `ssh` con `BatchMode=yes`
exige que la clave esté ya autorizada: un `ssh` que pide contraseña se cuelga sin
decir nada, porque nadie está mirando esa terminal.

---

## Caso C — URL HTTPS pública

Para Codex, Claude Code o cualquier cliente que acepte Streamable HTTP y bearer,
la puerta es:

```text
https://vera.mediafranca.net/mcp
```

Codex puede registrarla sin guardar el secreto en `config.toml`:

```sh
export VERA_CODEX_TOKEN='el secreto emitido para Codex'
codex mcp add vera --url https://vera.mediafranca.net/mcp \
  --bearer-token-env-var VERA_CODEX_TOKEN
```

La URL se alcanza desde cualquier red y no requiere Tailscale, SSH ni una copia
del repositorio. La credencial conserva la identidad y los mismos alcances que
en stdio. Una petición sin bearer o con una credencial retirada obtiene `401`
antes de ver el catálogo. Comprueba con `codex mcp list`, `/mcp` y
`vera_quien_soy`.

Claude Code puede guardar la referencia a una variable sin copiar el secreto al
archivo de configuración:

```sh
export VERA_CLAUDE_TOKEN='el secreto emitido para Claude'
claude mcp add-json --scope user vera \
  '{"type":"http","url":"https://vera.mediafranca.net/mcp","headers":{"Authorization":"Bearer ${VERA_CLAUDE_TOKEN}"}}'
```

Comprueba con `claude mcp list`, `claude mcp get vera`, `/mcp` y
`vera_quien_soy`. La respuesta debe ser la identidad propia de Claude, nunca
`participant:herbert`.

LM Studio 0.3.17 o posterior también acepta servidores MCP remotos. En
**Program → Install → Edit mcp.json**, añade una conexión con credencial propia:

```json
{
  "mcpServers": {
    "vera": {
      "url": "https://vera.mediafranca.net/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN_EXCLUSIVO_DE_LM_STUDIO>"
      }
    }
  }
}
```

LM Studio documenta el bearer literal y no documenta expansión de variables en
`headers`. Por eso esa credencial debe pertenecer sólo a LM Studio, el archivo
debe quedar con permisos restrictivos y no se debe compartir mediante un
deeplink —el secreto quedaría embebido en la URL—. Reinicia la integración,
elige un modelo capaz de llamar herramientas y pídele explícitamente ejecutar
`vera_quien_soy`; debe responder la identidad de LM Studio y sus alcances. Para
escribir, comprueba primero `vera_preparar_escritura` y luego una contribución
pequeña con `vera_escribir`.

En Alexei también puede declararse la puerta local `stdio` con `command`,
`args`, `env.VERA_URL`, `env.VERA_CLIENT` y `env.VERA_TOKEN_FILE`. Es la opción
más rápida y evita guardar el bearer en `mcp.json`; la pública corresponde a un
LM Studio remoto.

Codex CLI, la extensión y la aplicación comparten `~/.codex/config.toml`.
ChatGPT no lee esa configuración. Un formulario que ofrece `STDIO`, `Comando
para iniciar`, `Argumentos`, variables de entorno y directorio de trabajo es de
**Codex**, aunque ambas aplicaciones sean de OpenAI. Configurar Vera allí sólo
la vuelve disponible para Codex en ese equipo.

### ChatGPT web: crear y habilitar la aplicación MCP

ChatGPT admite aplicaciones MCP personalizadas actualmente sólo en la web y en
espacios Business, Enterprise o Edu. Hace falta ser administrador o propietario
en Business; Enterprise/Edu también puede conceder acceso de desarrollador por
rol. Una cuenta personal no muestra este recorrido.

Primero activa el modo desarrollador en la configuración del espacio de trabajo.
Luego entra a **Configuración → Aplicaciones → Crear** y completa la aplicación:

| Campo | Valor |
| --- | --- |
| **Nombre** | `Vera` |
| **URL / endpoint MCP** | `https://vera.mediafranca.net/mcp` |
| **Autenticación** | `Ninguna` |
| **Cabecera adicional · nombre** | `authorization` |
| **Cabecera adicional · valor** | `Bearer <TOKEN_EXCLUSIVO_DE_CHATGPT>` |

`Bearer` lleva mayúscula inicial, luego **un espacio** y luego la credencial
completa, sin comillas, corchetes ni signos `< >`. Los nombres de cabecera HTTP
no distinguen mayúsculas, de modo que `authorization` y `Authorization` son
equivalentes. No añadas `x-vera-client`: la identidad la deriva Vera del token.

Si ves una selección `STDIO`/`HTTP secuenciable` y campos de comando, estás en
Codex, no en ChatGPT. En ChatGPT pulsa **Escanear herramientas**, espera a que
aparezcan las herramientas de Vera y después pulsa **Crear**. La aplicación
queda como borrador; crearla no la incorpora retroactivamente a chats abiertos.

Abre un chat nuevo en la web. En el botón **+**, entra a **Más** y selecciona
Vera; también puedes invocarla mediante `@Vera` si aparece disponible. Sólo
entonces pide ejecutar `vera_quien_soy`. Que el modelo diga que no encuentra una
app llamada Vera significa que esa conversación no la tiene seleccionada, o que
la aplicación quedó en otro espacio de trabajo. Debe responder la identidad
destinada a ChatGPT y sus alcances; `participant:herbert` u otra identidad es un
fallo. Un `401` indica un bearer incompleto o retirado.

ChatGPT aloja esta conexión: la URL debe ser alcanzable desde Internet. La
configuración de una aplicación MCP personalizada y la disponibilidad de sus
acciones dependen del plan y de las políticas del espacio de trabajo de ChatGPT.
La documentación oficial vigente se mantiene en [Developer mode and MCP apps in
ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta).

### Elegir transporte por su costo real

La puerta pública compra portabilidad, no velocidad local. Desde Alexei, treinta
llamadas consecutivas a `vera_quien_soy` dieron 12,3 ms de mediana y 14,8 ms de
p95 por `stdio`; por HTTPS pública dieron 293,2 ms y 487,6 ms. El costo está en
la vuelta TLS/Cloudflare. Por eso el bibliotecario y los clientes que viven junto a Vera
conservan el camino local; los clientes remotos usan HTTPS cuando evitar SSH,
Tailscale y una copia del repositorio compensa esa vuelta.

### Pendiente: instalarla y medirla en Andrei

No hace falta emitir otra credencial si se reutiliza la conexión «Codex en
Andrei»: su secreto ya fue emitido y está cifrado en Alexei como
`vera-codex.cred`. Cuando Andrei esté disponible, se descifra **una sola vez en
Alexei** y se transfiere por un canal directo; no se pega en una conversación,
un commit ni `config.toml`.

En Andrei, `VERA_CODEX_TOKEN` debe existir en el entorno desde el que se inicia
Codex. El registro sólo contiene el nombre de la variable:

```sh
codex mcp add vera --url https://vera.mediafranca.net/mcp \
  --bearer-token-env-var VERA_CODEX_TOKEN
```

Al terminar, `codex mcp list` y `/mcp` deben mostrar `vera`; la primera llamada
debe ser `vera_quien_soy` y responder `participant:codex`, con alcances `read` y
`write`. Un `401` significa que la variable no llegó, que el secreto está mal o
que la credencial fue retirada. La configuración SSH anterior se retira sólo
después de medir treinta lecturas y una escritura real, y sólo si identidad,
alcances y latencia resultan aceptables. La URL pública no es por sí sola una
razón para sacrificar el transporte persistente más rápido. Esta instalación
queda deliberadamente pendiente.

---

## Emitir una credencial

En la página «VERA: la puerta MCP», sección **«Conectar una IA»**:

1. **Nombre** — cómo la vas a reconocer: «Claude Desktop», «Mistral en el
   portátil».
2. **Se declara como** — el `VERA_CLIENT`. Se deriva del nombre, y se puede
   corregir.
3. **Qué se le permite** — «Sólo leer», «Escribe en lo suyo», «Todo».
4. **Clase que puede crear** — sólo si eliges «escribe en lo suyo»: la clase de
   página dentro de la cual queda cercada.

Vera admite al participante, emite la credencial y escribe la fila de la
conexión, todo junto. **El secreto se muestra una vez.** Guárdalo en un archivo
y apunta `VERA_TOKEN_FILE` ahí:

```sh
install -m 600 /dev/null ~/.config/vera/claude-desktop.token
# pegar el secreto dentro
```

Para una credencial nueva de Codex, abre [[VERA: Puerta MCP]], crea «Codex en
Andrei», elige los alcances `read` y `write`, y copia el secreto que Vera muestra
al terminar. El token no se calcula en Andrei ni se obtiene de la URL: Vera lo
genera aleatoriamente, guarda sólo su digest y nunca puede volver a mostrarlo.
Si se pierde, se revoca esa credencial y se emite otra.

```json
"env": {
  "VERA_CLIENT": "claude-desktop",
  "VERA_TOKEN_FILE": "/home/usuario/.config/vera/claude-desktop.token"
}
```

**La identidad sale de la credencial**, no del nombre del cliente. `VERA_CLIENT`
es algo que el cliente dice de sí mismo y Vera lo anota como tal; quién es de
verdad lo decide el secreto.

Sobre «escribe en lo suyo» —el cerco—: esa credencial sólo puede crear páginas de
la clase concedida y escribir dentro de las que ella misma creó, y **no puede
borrar nada**; para pedir que algo se vaya le escribe la propiedad `por borrar`
con el motivo, y una persona decide. El cerco se comprueba en `POST /operations`,
que es la única puerta de escritura, y no en la herramienta MCP: un límite que
sólo comprueba la herramienta es una sugerencia dirigida a quien ya decidió
obedecerla. Ver [`confined-writing.allium`](../specs/confined-writing.allium).

---

## Comprobar que quedó

1. **Desde la IA**, pídele que llame a `vera_quien_soy`. Contesta con qué
   identidad entró y con qué alcances. Si dice el nombre del dueño y esperabas el
   de la IA, la credencial no está llegando.
2. **Desde Vera**, la página de la puerta muestra la conexión con su última
   lectura y cuánta memoria se llevó. Lo que sale en «Sin declarar» es alguien
   que entró sin `VERA_CLIENT`.
3. **El detalle completo** está en el registro de exposición: `GET /exposures`, y
   al revés —quién ha leído esto— en `GET /exposures?subject=page:1234`.

---

## Cuando no funciona

| Síntoma | Causa habitual |
| --- | --- |
| «El servidor se cerró al arrancar» | `node` sin ruta absoluta: el `PATH` del cliente no es el de tu shell |
| «no hay nadie escuchando en http://127.0.0.1:4173» | Vera no está corriendo, o escucha en otro puerto |
| Arranca y no ofrece herramientas | Faltan `--experimental-strip-types` y `--no-warnings`; sin el segundo, el aviso de Node en la salida de error se lee como un fallo |
| Rutas relativas que a veces van | El cliente lanza el proceso desde su propio directorio. Todo absoluto |
| Todas las lecturas salen a nombre del dueño | No hay credencial, o `VERA_TOKEN_FILE` apunta a un archivo que el proceso no puede leer |
| Todo cae en «sin declarar» | Falta `VERA_CLIENT` |
| Por ssh se cuelga sin decir nada | La clave no está autorizada y `BatchMode=yes` está esperando una contraseña que nadie va a escribir |

---

## Lo que no hay

Dicho aparte para no confundir lo construido con lo previsto.

- **Edición y descarte completos desde la IA.** MCP permite crear páginas y
  bloques y gestionar propiedades mediante operaciones atribuidas e idempotentes.
  Todavía no edita, mueve ni descarta páginas o bloques.
- **OAuth para servicios alojados que no aceptan cabeceras propias.** La puerta pública con bearer ya existe en
  `https://vera.mediafranca.net/mcp`. Los clientes que no permiten declarar un
  bearer y exigen descubrir y completar OAuth todavía necesitan M6. No bloquea
  Codex, Claude Code ni el formulario de ChatGPT cuando admite una cabecera
  `authorization` propia.
- **Publicar toda Vera con Tailscale Funnel.** Sigue siendo un error: M5 expone
  únicamente `/mcp` mediante el frente HTTPS existente. La aplicación privada,
  `POST /operations` y el resto de la API no forman parte de esa puerta.
- **OAuth.** Es M6. Para los formularios HTTP que aceptan un bearer y cabeceras
  propias no hace falta, así que no bloquea M5.
- **Una puerta pública sin montar un túnel a mano.** El caso C de este documento
  asume un frente HTTPS ya configurado, como el de esta instancia. El producto
  complementario [Vera Conecta](https://github.com/mediafranca/vera-conecta)
  construye ese mismo camino sin abrir puertos, sin IP pública y sin instalar
  Tailscale, para quien no quiere montar su propio túnel. Hoy es un walking
  skeleton (M0/M1): no hay ningún ambiente desplegado todavía.

---

## Ver también

- [`specs/mcp-server.allium`](../specs/mcp-server.allium) — la spec que gobierna
  la puerta. Manda ella si algo de aquí la contradice.
- [`specs/confined-writing.allium`](../specs/confined-writing.allium) — el cerco.
- [`packages/mcp/README.md`](../packages/mcp/README.md) — las herramientas, una
  por una.
- [`docs/exponer-vera.md`](exponer-vera.md) — la misma pregunta para Vera entera:
  privado, público de lectura, público de acceso, y qué exige cada uno.
- [`docs/portabilidad.md`](portabilidad.md) — levantar una instancia propia y
  exponerla con Tailscale.
- [Vera Conecta](https://github.com/mediafranca/vera-conecta) — el puente
  opcional para clientes MCP en Internet sin túnel propio. En desarrollo.
