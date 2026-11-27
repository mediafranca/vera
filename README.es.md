<p align="center">
  <img src="https://vera.mediafranca.net/assets/vera_vera-logo.svg" width="112" alt="Logo de Vera">
</p>

# Vera

*[English](README.md) · Español*

> Una infraestructura para conservar y recorrer una memoria intelectual propia,
> y trabajar con inteligencias artificiales sin entregarles su gobierno.

![Vera muestra una página y su grafo de relaciones](https://vera.mediafranca.net/assets/vera-interface.png)

VERA no busca construir otra inteligencia artificial ni sustituir las plataformas
existentes. Investiga y materializa una capa que hoy falta entre la persona y
esas plataformas: una memoria intelectual longitudinal, soberana y trazable,
gobernada por su autora o autor, sobre la cual distintas inteligencias pueden
trabajar sin apropiarse de ella.

La pregunta universitaria que organiza el proyecto es ésta: **¿cómo conservar la
agencia, la memoria, la autoría y la capacidad crítica de una persona cuando
múltiples inteligencias artificiales participan durante años en su formación e
investigación?** VERA es simultáneamente el instrumento experimental para
investigar esa pregunta y el artefacto tecnológico sometido a prueba. No se
presupone que la respuesta ya esté resuelta ni que el software produzca por sí
solo mejores aprendizajes.

## Una cadena de soberanía

VERA es más que una aplicación aislada. Es una cadena de decisiones y garantías:

1. la persona conserva su corpus en formatos legibles y trasladables;
2. cada intervención mantiene identidad, procedencia, autoría e historia;
3. la persona decide qué puede leer, escribir o publicar cada agente;
4. cambiar de dispositivo, institución, interfaz o proveedor de IA no exige
   abandonar la memoria acumulada;
5. los grafos soberanos pueden colaborar mediante estándares compartidos sin
   fundirse en una base central.

Lo decisivo no es solamente el texto final. Es también el **recorrido
intelectual**: fuentes, preguntas, relaciones, revisiones, desacuerdos y aportes
humanos o maquínicos que hicieron posible una idea. En el ámbito universitario,
ese recorrido puede ser objeto de estudio, reflexión y evaluación sin reducir la
autoría a la falsa pregunta de si una frase fue escrita enteramente por una
persona o por una máquina.

Técnicamente, VERA es una wiki personal *local-first*, mantenible por personas y
agentes. El proyecto se documenta desde su propio corpus para no sostener
versiones paralelas de la misma explicación.

## Nacida desde dentro

VERA comenzó en una situación individual: su propio corpus sirvió para pensar,
discutir y documentar el sistema mientras éste se construía. En esa primera
etapa, un **Bibliotecario** instalado por separado —una instancia de OpenClaw—
trabajó como agente sobre la memoria mediante las mismas puertas que VERA ofrece
a otros agentes. El desarrollo posterior también ha usado otras herramientas,
entre ellas Codex, directamente sobre el repositorio.

El Bibliotecario no viene incorporado en VERA y no es una autoridad privilegiada.
Es una configuración posible: un agente con identidad, permisos y procedencia
explícitos. Quien replique el sistema puede conectarle otro agente, darle otro
nombre o no instalar ninguno. La capacidad transferible no es ese personaje,
sino la separación entre el corpus soberano, la aplicación que lo gobierna y los
agentes sustituibles autorizados para colaborar con él.

Ahora el proyecto busca llevar esa experiencia situada a una conversación
colectiva y contrastable. Que el sistema haya servido para examinar su propia
construcción es un antecedente valioso; no demuestra por sí solo que la
configuración se generalice sin fricciones. Esa cuestión debe comprobarse con
otras personas, corpus y contextos universitarios.

## Conocer Vera

- [Presentación](https://vera.mediafranca.net/vera/)
- [Manual](https://vera.mediafranca.net/vera-manual/)
- [Principios](https://vera.mediafranca.net/vera-principios/) y [postura ética](https://vera.mediafranca.net/vera-postura-etica/)
- [Hoja de ruta](https://vera.mediafranca.net/vera-roadmap-de-producto-y-desarrollo/)
- [Arquitectura](https://vera.mediafranca.net/vera-arquitectura/)
- [Seguridad](https://vera.mediafranca.net/vera-seguridad/)
- [Probar e instalar](https://vera.mediafranca.net/vera-probar-e-instalar/)

Vera es actualmente una **alfa de investigación**: funciona sobre corpus reales
y una biblioteca puede constituirse como personal o colectiva. Cada instalación
conserva un grafo soberano; la colaboración usa personas autenticadas,
superficies delimitadas y permisos explícitos. No es todavía un servicio
multiusuario general listo para producción.

> [!WARNING]
> La aplicación privada escucha en loopback por omisión. No expongas directamente
> ese puerto a Internet: las passkeys y sesiones humanas no reemplazan una
> frontera de red revisada, TLS ni una política de exposición. Lee
> [Seguridad](SECURITY.md) y [Exponer Vera](docs/exponer-vera.md) antes de cambiar
> la frontera de red.

## Instalar Vera

### En tres pasos

1. **Descarga Vera Desktop** para Windows, macOS o Linux desde la
   [última versión](https://github.com/mediafranca/vera/releases/latest).
2. **Constituye la biblioteca.** Vera pregunta cómo quieres aparecer, el nombre
   de la biblioteca, si será personal o colectiva y el nombre editable de su
   bibliotecaria. Con ella nace la ontología inicial gobernada.
3. **Inicia la bibliotecaria** en **Centro de Vera → Agente de biblioteca**.
   Elige un modelo local o un endpoint compatible con OpenAI, revisa sus
   permisos y activa el runtime. Otros agentes pueden entrar por **MCP** con su
   propia identidad y credencial revocable.

La IA debe ejecutar primero `vera_quien_soy`: así compruebas la identidad y los
alcances con que entró antes de dejarla leer o escribir. Una URL de Conecta no
abre la biblioteca por sí sola; cada cliente necesita su propia credencial
revocable.

Hay dos formas de instalar, según qué se necesite.

### Aplicación de escritorio (recomendada)

La vía más simple para probar Vera sin tocar código: biblioteca constituida,
runtime de agente embebido y una búsqueda explícita de actualizaciones en
**Centro de Vera → Biblioteca → Vera Desktop**.

**[Descargar la última versión](https://github.com/mediafranca/vera/releases/latest)**
desde GitHub Releases. El instalador de **Linux** no requiere firma de
plataforma. Cada instalador distribuido incluye una **firma Sigstore sin clave
persistente**, una attestation de GitHub y sumas SHA-256 para verificar su
procedencia e integridad. Las aplicaciones de **Windows y macOS** siguen
publicándose **sin Authenticode ni notarización de Apple**, marcadas
"(sin firmar)": conseguir esas identidades de plataforma no es viable ahora para quien
mantiene Vera. El sistema operativo va a advertirlo (SmartScreen o Gatekeeper)
antes de dejarte abrirlo; las instrucciones para instalar de todas formas
están en [Instalación en Windows](docs/instalacion-windows.md#instalar-sin-firma)
y en [Distribución de Vera Desktop](docs/distribucion-escritorio.md#instalar-sin-firma).

Vera todavía evoluciona deprisa. Mientras Windows y macOS carezcan de firma de
plataforma, Vera no se reemplaza automáticamente. Usa **Buscar actualizaciones**
dentro de Vera Desktop; si existe una release estable posterior, el control abre
su página de descarga. Lee sus notas e instálala encima de la anterior.
**Actualizar el programa no reemplaza
la memoria:** Windows, macOS y Linux guardan el corpus fuera de los archivos de
la aplicación y vuelven a abrir la misma base después de la actualización.

En Windows, usa nuevamente `Vera Setup <versión> (sin firmar).exe`; no hace
falta desinstalar primero. La edición portable es la excepción que requiere
cuidado: `VeraData` vive junto al ejecutable, así que hay que sustituir el
portable dentro de la misma carpeta o conservar esa carpeta al moverlo. Abrir
el portable nuevo en otro directorio no borra la memoria anterior, pero Vera no
la encontrará allí y se presentará como una instalación nueva.

### Desde el código fuente

Requiere Node.js 24 o posterior.

```sh
git clone https://github.com/mediafranca/vera.git
cd vera
npm install
cp .env.example .env          # define VERA_OWNER y VERA_OWNER_NAME
npm run build
npm run serve                 # http://127.0.0.1:4173
```

Antes de escribir en una instancia propia, sigue la guía de
[portabilidad](docs/portabilidad.md): la identidad inicial determina quién firma
las operaciones del grafo, y explica por qué conviene **hacer un fork** antes de
clonar. Para desarrollar también hacen falta el validador de Allium y los pasos
de [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
npm run spec
npm run typecheck
npm test
```

## Hacer que Vera funcione con IA

La bibliotecaria es una identidad gobernada, no un modelo cautivo. Vera Desktop
incluye un runtime sustituible que carga su constitución activa, usa el modelo
elegido y registra recibos de su trabajo. Cualquier cliente externo que hable
[MCP](https://modelcontextprotocol.io/) —Claude Code, Claude Desktop, Codex,
Gemini CLI, LM Studio y otros— también puede entrar por la misma puerta con su
propia identidad y credencial. La guía completa está en
[Conectar una IA](docs/conectar-una-ia.md).

- **Cliente local:** conecta por `stdio` o por loopback; los datos no necesitan
  salir a un relay.
- **Cliente remoto con bearer:** activa
  [Vera Conecta](https://vera.mediafranca.net/vera-conecta/), autoriza un acceso
  desde Vera Desktop y configura la URL `https://conecta.mediafranca.net/v/<id>/mcp`.
- **Cliente que exige OAuth:** todavía no es compatible con Vera Conecta. La
  documentación lo marca expresamente en vez de fingir una integración.

Vera Conecta transporta solicitudes mientras Desktop está conectado. No aloja
una copia del grafo. Cloudflare y el relay forman parte del trayecto y pueden
procesar el contenido en tránsito, pero el servicio no persiste páginas,
bloques, prompts ni respuestas MCP.

## Capturar desde el navegador

[Vera Clip](https://github.com/mediafranca/vera-clip) deposita selecciones y
artículos directamente en la Vera local. Actúa como herramienta delegada de la
persona propietaria —no como otro autor— mediante una capacidad revocable que
sólo permite capturar. La ruta ordinaria usa `localhost` y no pasa por Internet;
[Vera Conecta](https://vera.mediafranca.net/vera-conecta/) queda como respaldo
cuando el navegador está en otro equipo. La guía está en
[Vera Clip: capturar en la Vera local](docs/vera-clip.md).

## Accesibilidad

Vera apunta al nivel AA de [WCAG 2.2](https://www.w3.org/TR/WCAG22/) en su
interfaz web y de escritorio. **Todavía no declara conformidad:** no se ha
hecho una auditoría completa.

Práctica actual: elementos HTML semánticos nativos (`<button>`, `<nav>`,
`<input type="search">`) en lugar de widgets propios, atributos ARIA donde la
semántica nativa no alcanza, foco visible y respeto por
`prefers-reduced-motion`. Hueco conocido: reubicar un bloque arrastrando su
viñeta aún no tiene equivalente por teclado. Las barreras de accesibilidad se
tratan como defectos; repórtalas como
[issues](https://github.com/mediafranca/vera/issues/new/choose).

## Documentación del código

El [índice técnico](docs/README.md) reúne arquitectura de implementación,
conexión MCP, portabilidad, exposición, obligaciones de prueba y planes de
trabajo. Las [especificaciones Allium](specs/) son la fuente de verdad del
comportamiento.

## Participar

Vera necesita personas que prueben la aplicación, describan defectos, mejoren
la documentación, contrasten las especificaciones y contribuyan código. No hace
falta empezar programando:

- usa [Discussions](https://github.com/mediafranca/vera/discussions) para
  preguntas, propuestas tempranas y conversaciones de diseño;
- abre un [issue](https://github.com/mediafranca/vera/issues/new/choose) cuando
  haya un defecto reproducible o una tarea ya suficientemente definida;
- lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un pull request: todo PR
  ordinario apunta a `dev` y debe preservar las garantías Allium;
- consulta [GOVERNANCE.md](GOVERNANCE.md) para saber cómo se toman decisiones,
  [SUPPORT.md](SUPPORT.md) para pedir ayuda y
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) para las reglas de convivencia.

Los reportes de seguridad siguen un canal privado descrito en
[SECURITY.md](SECURITY.md).

## Proyectos relacionados

[Vera Conecta](https://vera.mediafranca.net/vera-conecta/) es el puente
compartido entre una instalación local de Vera y clientes MCP en Internet, sin
abrir puertos, IP pública ni Tailscale. Vive en un repositorio propio porque
es infraestructura de red con su propio ciclo de despliegue. El relay y su
interfaz Desktop están probados extremo a extremo y el servicio comunitario
opera en [conecta.mediafranca.net](https://conecta.mediafranca.net). El
[código y el contrato técnico](https://github.com/mediafranca/vera-conecta)
permanecen abiertos; cada instalación conserva localmente su corpus y autoriza
por separado a cada cliente remoto.

Vera se publica bajo [GNU AGPL-3.0-only](LICENSE). Consulta también
[LICENCIA.md](LICENCIA.md), [AUTHORS.md](AUTHORS.md),
[CONTRIBUTING.md](CONTRIBUTING.md) y [NOTICE](NOTICE).

<p align="center">
  <img src="https://vera.mediafranca.net/assets/raised-fist.svg" width="104" alt="Puño alzado">
</p>

<p align="center"><strong>Soberanía digital</strong></p>

<p align="center">
  <small>Puño alzado: Eugenio Hansen, OFS — trabajo propio,
  <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, vía
  <a href="https://commons.wikimedia.org/w/index.php?curid=65787095">Wikimedia Commons</a>.</small>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mediafranca/mediafranca.github.io/refs/heads/main/assets/logo/mf.svg" width="72" alt="MediaFranca">
</p>

<p align="center">Vera forma parte de <a href="https://mediafranca.net/">MediaFranca</a>.</p>
