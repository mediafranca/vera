# Línea base privada del contexto para agentes

La línea base mide los operadores que hoy componen una lectura para una IA:
búsqueda, consulta estructurada, página, vecindario e historia. No evalúa si un
modelo redacta bonito; separa primero si Vera encontró y entregó la evidencia
correcta, cuánto costó y si cruzó el territorio permitido.

## Dos capas

El ejecutor y su contrato son públicos. Las preguntas reales, identidades
esperadas y páginas de control son privadas: viven fuera del repositorio, junto
al corpus que evalúan. Un manifiesto privado nunca se añade a Git.

Cada manifiesto fija `corpus.sequence`. Si la secuencia efectiva difiere, el
ejecutor se niega a comparar resultados: una línea base sobre un corpus móvil
es una anécdota con decimales. `--allow-sequence-drift` existe sólo para explorar
y deja de ser una medición reproducible.

## Contrato mínimo

```json
{
  "schemaVersion": 1,
  "name": "Contexto de Vera 2026-11-12",
  "corpus": { "sequence": 114469 },
  "defaults": { "budgetCharacters": 60000 },
  "cases": [
    {
      "id": "persona-ward-cunningham",
      "class": "direct",
      "question": "¿Quién es Ward Cunningham?",
      "calls": [
        { "tool": "search", "query": "Ward Cunningham", "limit": 12 },
        { "tool": "page", "page": "page:ward-cunningham", "limit": 80 }
      ],
      "expected": {
        "requiredIds": ["page:ward-cunningham", "block:ward-cunningham-0"],
        "relevantIds": ["page:ward-cunningham", "block:ward-cunningham-0"],
        "forbiddenIds": ["page:private-control"],
        "textIncludes": ["deuda técnica"]
      }
    }
  ]
}
```

Las herramientas admitidas son:

- `search`: `query`, `limit`;
- `query`: `source`, `cursor`, `limit`;
- `page`: `page`, `cursor`, `limit`;
- `neighborhood`: `page`, `depth`;
- `history`: `block`.

`requiredIds` mide cobertura mínima. `relevantIds` debe ser exhaustivo para que
la precisión sea interpretable; si se omite, el informe no inventa una cifra.
`forbiddenIds` y `textExcludes` fijan controles de filtración. `abstain: true`
exige que no viaje ninguna identidad. `textIncludes` comprueba que el pasaje
necesario sigue dentro de la respuesta, no sólo que aparezca su página.

El informe conserva métricas e identidades, pero no copia el texto recibido.
Así puede compartirse la forma de la evaluación sin crear otra versión del
corpus dentro del repositorio.

## Ejecución

La credencial entra por `VERA_TOKEN`, nunca por argumentos ni por el manifiesto:

```sh
VERA_TOKEN="$(fuente-segura)" npm run benchmark:context -- \
  --manifest /ruta/privada/context-baseline.json \
  --output /ruta/privada/context-baseline-report.json
```

El proceso sale con estado distinto de cero si falla una llamada, falta evidencia,
se excede el presupuesto, aparece una identidad prohibida o una prueba de
abstención devuelve algo.

El resumen separa `leakChecks` de `leaked`: `leaked: 0` con `leakChecks: 0` no
demuestra aislamiento, sólo dice que el manifiesto todavía no lo puso a prueba.

## Qué falta medir antes de comparar recuperadores

La primera batería real debe tener entre 20 y 30 casos: hechos directos,
estructura, relaciones multi-salto, historia, contradicción, ausencia y al menos
dos credenciales con territorios distintos. Debe registrar aparte exactitud de
la respuesta final de un modelo: recuperar evidencia y razonar sobre ella son
fallos diferentes.
