<p align="center">
  <img src="https://vera.mediafranca.net/assets/vera_vera-logo.svg" width="112" alt="Logo de Vera">
</p>

# Vera

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

Vera es actualmente una **alfa de investigación**: funciona sobre un corpus
real, pero está destinada por ahora a una persona y un grafo. No es todavía un
servicio multiusuario listo para producción.

> [!WARNING]
> La aplicación privada escucha en loopback por omisión. No expongas directamente
> ese puerto a Internet: las personas aún no se autentican ante Vera. Lee
> [Seguridad](SECURITY.md) y [Exponer Vera](docs/exponer-vera.md) antes de cambiar
> la frontera de red.

## Instalación

Hay dos caminos, según qué se necesite.

### Aplicación de escritorio (Windows, macOS y Linux)

La vía más simple para probar Vera sin tocar código: memoria inicial ya
cargada y, donde hay firma comercial, actualización automática por canal
estable.

**[Descargar la última versión](https://github.com/mediafranca/vera/releases/latest)**
desde GitHub Releases. El instalador de **Linux** (AppImage o deb) es siempre
confiable — no requiere firma de código. Los de **Windows y macOS** hoy se
publican **sin firmar**, marcados "(sin firmar)": conseguir una identidad
Authenticode o notarización de Apple no es viable ahora mismo para quien
mantiene Vera. El sistema operativo va a advertirlo (SmartScreen o Gatekeeper)
antes de dejarte abrirlo; las instrucciones para instalar de todas formas
están en [Instalación en Windows](docs/instalacion-windows.md#instalar-sin-firma)
y en [Distribución de Vera Desktop](docs/distribucion-escritorio.md#instalar-sin-firma).

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

## Conectar una IA a tu Vera

Vera no se usa sólo desde su interfaz: cualquier cliente que hable
[MCP](https://modelcontextprotocol.io/) —Claude Code, Claude Desktop, Codex,
Gemini CLI, LM Studio y otros— se conecta a la misma puerta y opera el corpus
con su propia identidad y credencial. La guía completa, con los cinco valores
de conexión y un caso por cada forma de desplegar el cliente, está en
[Conectar una IA](docs/conectar-una-ia.md).

## Documentación del código

El [índice técnico](docs/README.md) reúne arquitectura de implementación,
conexión MCP, portabilidad, exposición, obligaciones de prueba y planes de
trabajo. Las [especificaciones Allium](specs/) son la fuente de verdad del
comportamiento.

## Proyectos relacionados

[Vera Conecta](https://github.com/mediafranca/vera-conecta) es el puente
opcional entre una instalación local de Vera y clientes MCP en Internet, sin
abrir puertos, IP pública ni Tailscale. Vive en un repositorio propio porque
es infraestructura de red con su propio ciclo de despliegue; hoy es un walking
skeleton (M0/M1), sin ambiente desplegado.

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
