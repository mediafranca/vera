# Vera: bazar de catedrales

> **Estado:** arquitectura rectora y primer corte experimental. Este documento
> distingue lo ya construido en `experiment/bazar-de-catedrales` de la
> federación que todavía debe probarse. No convierte una metáfora en consenso
> distribuido por decreto.

## Tesis

La unidad soberana de Vera es una persona, no una cuenta ni un modelo. Una
**Vera Personal** reúne a esa persona, su espacio íntimo, las superficies que
decide compartir o publicar y cero, uno o varios agentes constituidos por ella.
El agente no es el LLM: es un oficio situado, una memoria autorizada, un conjunto
de herramientas y una historia. El modelo local o remoto es un motor
reemplazable.

Una **Vera Colectiva** no agranda una Vera Personal hasta volverla institución.
Reúne varias personas soberanas y, por tanto, varios bibliotecarios situados.
Cada agente conserva principal humano, mandato, contexto y procedencia propios.
El MCP compone para cada solicitud una vista autorizada por identidad, espacio y
propósito; no entrega un «cerebro colectivo» indiferenciado.

La catedral es la coherencia que una persona o institución cuida: vocabulario,
reglas, historia, cargos, procedimientos y compromisos. El bazar son sus ramas,
voces, propuestas y Veras federadas. Git ofrece una gramática útil —ramificar,
comparar, integrar, revertir—, pero no resuelve por sí mismo autoridad,
privacidad ni reconciliación semántica.

## Dos interfaces de una misma soberanía

### Gobierno visual *round-trip*

`VERA: Objetos`, `VERA: Propiedades` y `VERA: Relaciones` siguen siendo las
tres fuentes canónicas. Se leen como facetas de un mismo gobierno: declaración
textual a la izquierda y esquema a la derecha. Una manipulación visual veraz
produce una operación canónica, reaparece en el texto y conserva diff, autoría,
validación y reversión. En teléfono el espejo es temporal —**Declaración ↔
Esquema**— y mantiene la misma selección; no intenta comprimir dos paneles hasta
volver ambos ilegibles.

### Bibliotecario embebido

El bibliotecario custodia el formato, compone contexto y acompaña la evolución
del modelo. Su constitución no vive como prompt privado del proveedor ni como
copia de páginas dentro de una configuración. Vera selecciona páginas
constitutivas reales, registra su revisión, construye un manifiesto inmutable y
permite a la persona principal activar o revertir versiones. La credencial de
un agente sólo lee su propio manifiesto activo mediante MCP.

Esto preserva la reflexividad que hizo nacer Vera: conversar sobre la casa,
modificar páginas rectoras, especificaciones y código, ejecutar pruebas y
proponer despliegues. No se automatiza el devenir como una lista cerrada de
reglas. La transformación vuelve siempre como diff, evidencia, decisión,
versión y punto de retorno.

## Capas que no deben confundirse

1. **Persona principal:** constituye agentes y puede retirar su autoridad.
2. **Participante agente:** identidad estable, autoría e historia; no es una
   credencial.
3. **Constitución:** páginas gobernadas y manifiestos versionados dentro de
   Vera.
4. **Runtime:** Gateway, sesiones, automatizaciones, canales y adaptadores. Se
   reemplaza sin reescribir la constitución.
5. **Modelo:** uno o varios LLM locales o de servicios externos. Ninguno es por
   sí solo el agente.
6. **Secretos:** permanecen en custodia segura fuera del corpus; Vera guarda
   referencias y estado, nunca sus valores.

El arranque conserva una paradoja deliberada: hace falta un runtime mínimo
externo capaz de despertar y leer la constitución de Vera. «Embebido» significa
que Vera gobierna el agente y puede distribuir su adaptador con Desktop, no que
la biblioteca deba fingir que se ejecuta a sí misma desde la nada.

## Espacios y federación

- **Íntimo:** sólo la persona y los agentes que ella autorice.
- **Compartido:** participantes humanos nombrados y sus agentes, con autoridad
  derivada de personas, roles y espacios concretos.
- **Público:** proyección deliberada; publicar no entrega el resto del grafo ni
  convierte una URL en identidad.
- **Federado:** varias Veras participan en un registro común sin entregar sus
  interiores ni subordinarse a un dueño mayor.

El registro público co-construido no necesita, por ahora, una blockchain. La
propiedad requerida es más precisa: operaciones firmadas por identidad,
ordenables, direccionables, replicables, verificables y no reescribibles en
silencio. El contenido privado sigue en su Vera de origen; el espacio federado
replica sólo declaraciones autorizadas y su procedencia. Cuando dos ramas
discrepan, la divergencia permanece visible hasta un acto de reconciliación
humano o institucional. El mecanismo concreto —log firmado, Git, Merkle DAG u
otro— se decide después de demostrar ese protocolo con dos Veras reales.

## Lo construido en este corte

- visor facetado sobre las tres páginas rectoras, sin una cuarta ontología;
- esquema ELK sin solapamientos, navegación por teclado y edición mínima
  *round-trip* por operaciones `drawn`;
- alternancia móvil entre declaración y esquema;
- relación explícita agente → principal humano, independiente de credenciales;
- páginas constitutivas, manifiestos inmutables, activación y rollback;
- mesa `/agentes` con carga progresiva y búsqueda acotada de páginas;
- puerta `/agent-manifest` y herramienta MCP `vera_mi_constitucion`, cercadas a
  la identidad que porta la credencial;
- migración 28 ensayada sobre una copia completa del corpus real.

## Lo que este corte no proclama resuelto

- trasladar Gateway, Telegram, sesiones, automatizaciones y credenciales desde
  OpenClaw sin interrupción;
- ejecutar varios modelos bajo un mismo agente y explicar sus relevos;
- revocación transitiva de tareas delegadas;
- gobierno colectivo de cambios constitutivos y del código;
- sincronización y reconciliación entre dos Veras soberanas;
- identidad institucional de la PUCV como historia gobernada y no como dueño
  mayor;
- análisis de impacto antes de editar cardinalidad, dominio o rango dibujando.

El siguiente corte debe probar una mudanza en coexistencia: este runtime sigue
vivo mientras Vera Desktop despierta un bibliotecario, lee su manifiesto,
responde por un canal, registra una intervención y vuelve a la versión anterior
si cualquiera de esas garantías falla. Después, dos Veras Personales deberán
trabajar en un espacio común conservando contextos distintos. Sólo entonces la
federación deja de ser promesa arquitectónica.

## Evidencia

- [`specs/ontology-roundtrip.allium`](../specs/ontology-roundtrip.allium)
- [`specs/agent-manifest.allium`](../specs/agent-manifest.allium)
- [`docs/experimento-gobierno-ontologico-visual.md`](experimento-gobierno-ontologico-visual.md)
- [`docs/plan-maestro/protocolo-agentes-contribuyentes.md`](plan-maestro/protocolo-agentes-contribuyentes.md)

