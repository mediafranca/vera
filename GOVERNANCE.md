# Gobernanza de Vera

Vera es un proyecto de investigación y software libre publicado por
[MediaFranca](https://mediafranca.net/). Su gobierno debe proteger dos cosas a
la vez: la posibilidad real de que otras personas contribuyan y la cadena de
soberanía, procedencia y responsabilidad que el propio proyecto exige a una
memoria personal.

Este documento describe el modelo vigente. No promete una comunidad que todavía
no existe: establece un camino público para formarla.

## Principios

1. **La spec gobierna el comportamiento.** Las garantías Allium se discuten
   antes que su implementación.
2. **La procedencia se conserva.** Una contribución declara su origen y tiene
   personas que deciden y responden por ella, incluso cuando usaron agentes.
3. **La custodia no equivale a propiedad de las contribuciones.** Cada persona
   conserva su autoría y aporta bajo AGPL-3.0-only.
4. **Las decisiones importantes dejan rastro público.** Issue, Discussion, PR,
   spec o registro de decisión; nunca sólo una conversación privada.
5. **La seguridad y la intimidad prevalecen sobre la velocidad.** Los reportes
   sensibles siguen el canal privado de [SECURITY.md](SECURITY.md).

## Roles actuales

### Persona contribuidora

Cualquiera que mejora documentación, pruebas, diseño, investigación, soporte o
código. Una contribución aceptada no convierte automáticamente a su autora en
mantenedora ni exige una cesión adicional de derechos.

### Persona autora

Quien responde por una aportación original sustantiva según el proceso de
[AUTHORS.md](AUTHORS.md). Autoría y permisos de mantenimiento son dimensiones
distintas.

### Persona mantenedora

Puede clasificar issues, revisar pull requests y sostener áreas concretas. La
custodia nombra mantenedores mediante una decisión pública que indica alcance y
fecha. Un mantenedor puede retirarse cuando quiera; su autoría permanece.

### Custodia

La custodia mantiene la continuidad del proyecto: administra el repositorio y
las publicaciones, decide promociones a `main`, coordina respuestas de seguridad
y resuelve empates que no pudieron cerrarse por consenso. Hoy la ejerce Herbert
Spencer González bajo MediaFranca.

La custodia no puede apropiarse de la autoría de terceros ni cambiar la licencia
de sus contribuciones sin el consentimiento necesario.

## Cómo se decide

| Decisión | Lugar | Cierre |
| --- | --- | --- |
| Duda, propuesta temprana o experiencia de uso | Discussion | Consenso documentado o traslado a issue/spec |
| Defecto o tarea acotada | Issue | Criterio de aceptación acordado |
| Comportamiento nuevo | Spec Allium + PR | Revisión de garantías y CI verde |
| Implementación ordinaria | PR hacia `dev` | Revisión mantenedora y CI verde |
| Publicación estable | PR de `dev` hacia `main` | Custodia |
| Seguridad | Canal privado | Custodia y reportante coordinan divulgación |
| Gobernanza, licencia o autoría | PR separado y discusión explícita | Custodia y titulares afectados |

Se busca consenso. Cuando no lo hay, la custodia decide y deja por escrito las
alternativas consideradas y la razón. Las decisiones se pueden reabrir con nueva
evidencia; no se reabren por repetición.

## Ramas y publicación

- `dev` es la rama predeterminada y de integración. Todo pull request ordinario
  apunta a ella.
- `main` representa el último corte estable y publicable. No recibe desarrollo
  directo: sólo promociones desde `dev` o arreglos de seguridad excepcionales
  que luego se reconcilian con `dev`.
- Las ramas de trabajo son breves y nombran su propósito (`feat/…`, `fix/…`,
  `docs/…`, `spec/…`). Se eliminan después de integrarse.
- Las ramas históricas de hitos anteriores se conservan mientras tengan valor
  documental, pero no son destinos de pull requests.

La protección técnica de GitHub exige pull request y CI en `dev` y `main`. Como
el proyecto tiene hoy una sola persona mantenedora, la política no exige todavía
una aprobación externa imposible de obtener; sí exige que el cambio y sus
comprobaciones sean públicos. Al incorporarse una segunda persona mantenedora,
la custodia revisará ese umbral.

## Incorporación de mantenedores

No hay ascenso automático por cantidad de commits. Se considera a quien ha
mostrado durante varias contribuciones criterio sobre las specs, cuidado por la
procedencia, capacidad de revisión y trato consistente con el código de
conducta. La propuesta se publica en Discussions y la custodia registra:

- ámbito que puede mantener;
- permisos concedidos;
- fecha y personas que participaron en la decisión.

## Conflictos y apelación

Los desacuerdos técnicos se resuelven con la spec, evidencia reproducible y una
decisión registrada. Los problemas de conducta se reportan según
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); quien esté involucrado en el conflicto
no decide solo su resolución. Mientras exista una sola persona en la custodia,
un conflicto que la involucre puede elevarse a MediaFranca por el mismo canal de
cumplimiento.

## Continuidad

La custodia debe mantener al menos una persona o entidad capaz de recuperar el
repositorio, las publicaciones y los canales de seguridad. Un cambio de custodia
se anuncia públicamente y conserva licencia, historial, autoría y decisiones
previas. La inactividad no transfiere derechos ni autoridad por omisión.
