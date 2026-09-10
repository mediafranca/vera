# vera-mcp

La puerta MCP de Vera. Un proceso por cliente, lanzado por el cliente, hablando
por entrada y salida estándar. Sin puerto propio ni nada escuchando. La
[explicación pública](https://vera.mediafranca.net/vera-puerta-mcp/) vive en
Vera; aquí queda el contrato operativo del paquete.

La puerta ofrece lectura y escritura no destructiva. Cada lectura queda en el
registro de exposición y cada escritura pasa por `POST /operations`, con la
identidad y los alcances de la credencial.

## Qué ofrece

| Herramienta | Qué hace |
| --- | --- |
| `vera_quien_soy` | Comprueba la conexión, la identidad y los alcances. La primera llamada. |
| `vera_buscar` | Extractos de todo el corpus, con la página y el bloque de donde salieron. |
| `vera_leer_pagina` | Una página entera, con su sangría, sus propiedades y su vecindad. |
| `vera_historia_bloque` | Todo lo que un bloque dijo alguna vez, incluido lo borrado. |
| `vera_vecindario` | El mapa alrededor de una página. |
| `vera_indice` | Los títulos del corpus. |
| `vera_preparar_escritura` | Lee juntas las reglas vivas para agentes y la ontología antes de escribir. |
| `vera_escribir` | Crea páginas o bloques y gestiona propiedades mediante una operación atribuida e idempotente. |
| `vera_ontologia` | Cómo está clasificada esta memoria. |

## Cómo se conecta cada cliente

La guía completa —el método general, válido para cualquier proveedor, con la
tabla de qué pide cada formulario y qué hacer cuando falla— está en
[docs/conectar-una-ia.md](../../docs/conectar-una-ia.md). Aquí quedan las cuatro
recetas de siempre.

Vera tiene que estar corriendo (`npm run serve`, por omisión en el 4173).

No hay una forma «más nueva» que deba sustituir a todas las demás. En la máquina
donde vive Vera, `stdio` evita una vuelta innecesaria por Internet. En otro
equipo, Streamable HTTP elimina el repositorio, SSH y Tailscale. El contrato, la
identidad y los alcances son los mismos; cambia sólo el recorrido.

**Claude Code** — ya está: el `.mcp.json` de la raíz del repositorio lo declara.
Al abrir Claude Code aquí, pregunta si se confía en el servidor del proyecto.
Para tenerlo en cualquier directorio y no sólo en éste:

```sh
claude mcp add vera --scope user -- \
  node --experimental-strip-types --no-warnings \
  /home/hspencer/Sites/vera/packages/mcp/src/main.ts
```

**Claude Desktop** — en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vera": {
      "command": "node",
      "args": ["--experimental-strip-types", "--no-warnings",
               "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"],
      "env": { "VERA_URL": "http://127.0.0.1:4173", "VERA_CLIENT": "claude-desktop" }
    }
  }
}
```

**Claude Code por la puerta pública** — desde cualquier red, sin Tailscale ni
SSH. La variable se expande al cargar la configuración y el secreto no entra en
Git:

```json
{
  "mcpServers": {
    "vera": {
      "type": "http",
      "url": "https://vera.mediafranca.net/mcp",
      "headers": { "Authorization": "Bearer ${VERA_CLAUDE_TOKEN}" }
    }
  }
}
```

En alcance personal, el mismo bloque se registra así:

```sh
claude mcp add-json --scope user vera \
  '{"type":"http","url":"https://vera.mediafranca.net/mcp","headers":{"Authorization":"Bearer ${VERA_CLAUDE_TOKEN}"}}'
```

Después: `claude mcp list`, `claude mcp get vera`, `/mcp` y
`vera_quien_soy`. La identidad debe ser la de Claude, nunca
`participant:herbert`.

**LM Studio** — desde 0.3.17 admite servidores remotos en `mcp.json`. Abre
Program → Install → Edit mcp.json y añade:

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

Su documentación no promete expansión de variables dentro de `headers`: el
bearer queda escrito en ese archivo. Usa una credencial exclusiva, protege el
archivo y no generes un deeplink con esa configuración, porque transportaría el
secreto dentro de la URL. Con un modelo capaz de usar herramientas, prueba
`vera_quien_soy`, luego `vera_preparar_escritura` y una escritura pequeña. En
Alexei conviene la declaración `stdio` de arriba: es más rápida y puede leer un
`VERA_TOKEN_FILE` privado.

**Codex local** — en `~/.codex/config.toml`, siempre con una credencial propia:

```toml
[mcp_servers.vera]
command = "/usr/bin/node"
args = ["--experimental-strip-types", "--no-warnings",
        "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"]
env = { VERA_URL = "http://127.0.0.1:4173", VERA_CLIENT = "codex", VERA_TOKEN_FILE = "/ruta/privada/vera-codex.token" }
```

**Codex en otro equipo** — no copies el secreto ni el repositorio. Abre
«VERA: Puerta MCP», elige «otro equipo» y copia el bloque TOML calculado para
esa conexión. En el despliegue de Alexei, `codex-andrei` arranca la puerta por
SSH y descifra allí `vera-codex.cred`; el bloque deja la conexión como
`required = true` y evita aprobaciones MCP redundantes. Comprueba el resultado
con `codex mcp list`, luego `/mcp`, y llama primero a `vera_quien_soy`: debe
responder `participant:codex`. Otra identidad es un fallo de configuración.

**Codex y OpenAI por la puerta pública** — desde cualquier red, sin Tailscale ni
SSH:

```sh
export VERA_CODEX_TOKEN='el secreto de la credencial de Codex'
codex mcp add vera --url https://vera.mediafranca.net/mcp \
  --bearer-token-env-var VERA_CODEX_TOKEN
```

El secreto vive en el equipo cliente como variable protegida; no se escribe en
`config.toml`. La URL es pública, el corpus no: sin bearer válido la puerta
responde `401` antes de inicializar MCP o enumerar herramientas.

Codex CLI, la extensión y la aplicación de escritorio comparten esta
configuración. ChatGPT no lee `~/.codex/config.toml`: se configura por separado
en «MCP personalizado». Desde otro equipo, selecciona `HTTP secuenciable`, usa
`https://vera.mediafranca.net/mcp`, elige autenticación `Ninguna` y añade la
cabecera `authorization` con valor `Bearer <TOKEN_EXCLUSIVO_DE_CHATGPT>`. No
añadas `x-vera-client`; Vera deriva la identidad del token. La guía campo por
campo está en [docs/conectar-una-ia.md](../../docs/conectar-una-ia.md).

El token lo genera Vera al crear la conexión en «VERA: Puerta MCP» y se muestra
una sola vez. Para la conexión ya existente «Codex en Andrei» hay una copia
cifrada en Alexei; no hace falta emitir otra. Si el secreto se pierde, no se
recupera: se revoca la credencial y se crea una nueva. La instalación pública en
Andrei queda pendiente hasta tener acceso a ese equipo.

**Gemini CLI** — en `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vera": {
      "command": "node",
      "args": ["--experimental-strip-types", "--no-warnings",
               "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"],
      "env": { "VERA_URL": "http://127.0.0.1:4173", "VERA_CLIENT": "gemini" }
    }
  }
}
```

No uses una receta sin credencial como configuración normal: en loopback puede
caer silenciosamente al dueño y atribuirle a Herbert las lecturas o escrituras
del agente.

Los clientes configurables ya pueden conectarse por Streamable HTTP.
«Públicamente alcanzable» no significa publicar la aplicación privada ni
permitir lecturas anónimas. OAuth sigue siendo M6 para los servicios alojados
que lo exijan; no es requisito de Codex, Claude Code ni ChatGPT cuando el
formulario permite proporcionar el bearer como cabecera propia.

## Latencia: pública no significa local

Medición real desde Alexei, 2026-08-26, treinta llamadas consecutivas a
`vera_quien_soy`:

| Transporte | Arranque | Mediana por herramienta | p95 |
| --- | ---: | ---: | ---: |
| `stdio` local | 152 ms | 12,3 ms | 14,8 ms |
| HTTPS pública | 1.171 ms | 293,2 ms | 487,6 ms |

La diferencia está en el recorrido TLS/Cloudflare, no en el corpus ni en MCP.
Por eso el bibliotecario y los clientes que corren en Alexei conservan el camino local.
La puerta pública se usa donde compra algo concreto: acceso desde otra red sin
SSH, tailnet ni copia del código. En otro equipo hay que medir allí antes de
retirar el transporte anterior.

## El entorno

| Variable | Para qué | Por omisión |
| --- | --- | --- |
| `VERA_URL` | Dónde está la API. | `http://127.0.0.1:4173` |
| `VERA_TOKEN_FILE` | Archivo con el secreto de la credencial. | — |
| `VERA_TOKEN` | El secreto, si no hay archivo. | — |
| `VERA_SYSTEMD_CREDENTIAL_FILE` | Credencial cifrada que se abre donde corre la puerta. | — |
| `VERA_SYSTEMD_CREDENTIAL_NAME` | Nombre embebido de esa credencial cifrada. | — |
| `VERA_CLIENT` | Cómo se declara el cliente en el registro de exposición. | `vera-mcp` |

La credencial no se pasa nunca por argumentos: los argumentos de un proceso los
lee cualquiera con un `ps`. `VERA_TOKEN_FILE` antes que `VERA_TOKEN`, porque una
variable de entorno se hereda a todo lo que el proceso lance y un archivo con
permisos no.

Para una puerta lanzada por ssh, la pareja `VERA_SYSTEMD_CREDENTIAL_*` tiene
precedencia y falla cerrada: si no puede descifrarse, el servidor MCP no inicia
y nunca cae a la identidad del dueño por loopback.

Sin credencial se entra como el dueño, que es lo que hoy es cierto en casa. El
registro de exposición lo anota como lo que es —una lectura sin credencial— en
vez de disimular la ausencia.

## Lo que queda anotado

Cada lectura escribe una fila en el registro de exposición de VERA: quién,
con qué credencial, qué cliente dijo ser, qué se entregó y cuánto medía. Se
mira en `GET /exposures`, y al revés —quién ha leído esto— en
`GET /exposures?subject=page:1234`.
