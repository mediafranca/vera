# Solid en Vera — resultado del spike de nivel 1

Fecha de ejecución: 2026-09-20

Rama: `spike/solid-membrane`

Servidor probado: Community Solid Server `7.2.0`

## Pregunta de la prueba

¿Puede Vera proyectar una publicación deliberada y un recorrido a almacenamiento
Solid sin convertir el Pod en corpus canónico, sin filtrar páginas privadas y
sin depender todavía de identidad o sincronización bidireccional?

## Contrato

La prueba implementa `specs/solid-projection.allium`:

- sólo cruza una `Publication` explícita cuya página sigue siendo pública;
- un recorrido sólo cruza si todas sus paradas son publicaciones explícitas del
  mismo sitio;
- cada representación tiene una URL estable y otra revisión inmutable cuyo
  nombre contiene el SHA-256 de los bytes;
- el JSON-LD lleva identidad estable, URL humana, revisión, fechas, procedencia,
  autoría por bloque y rol epistémico cuando existe;
- la escritura es unidireccional; nada leído del Pod se convierte en operación,
  autoridad ni edición de Vera.

## Montaje reproducible

El servidor se levantó en memoria, con autorización deshabilitada, mediante la
configuración de ensayo
`packages/store/test/fixtures/css-open-memory.json`:

```sh
npx --yes @solid/community-server@7.2.0 \
  -c packages/store/test/fixtures/css-open-memory.json \
  -b http://127.0.0.1:3456/ -p 3456 -l warn
```

Esa configuración es deliberadamente insegura y sólo sirve para una prueba
local efímera. No es una receta de despliegue.

## Resultados observados

### Publicación real del corpus

Se proyectó `VERA — Principios`, ya publicada en
`https://vera.mediafranca.net/vera-principios/`:

```sh
npm run project:solid -- data/vera.sqlite http://127.0.0.1:3456/ \
  https://vera.mediafranca.net 'VERA — Principios'
```

- recurso estable: `/vera/vera-principios.jsonld`;
- revisión: `/vera/revisions/vera-principios.660df16f…a6c61.jsonld`;
- SHA-256 completo:
  `660df16f68ddd094dbf491449f6d136d6fad8551f3cdbfc5d3518e9ee02a6c61`;
- primera ejecución: dos `PUT` con estado `201`, seguidos de lectura idéntica;
- segunda ejecución: dos `PUT` con estado `205`, mismas URLs, mismo hash y
  lectura idéntica.

### Página y recorrido

El ensayo automatizado construye un grafo Vera en memoria con tres publicaciones:
dos paradas y una página `tipo:: argumento`. Proyecta dos representaciones —la
página y su recorrido—, cada una en URL estable y revisión inmutable:

```sh
VERA_SOLID_CSS_URL=http://127.0.0.1:3456/ \
  node --test packages/store/test/solid-projection.test.ts
```

Resultado: cuatro pruebas aprobadas. El caso CSS escribió, releyó y repitió
cuatro entregas por ejecución; los hashes de ambas rondas coincidieron. Otro
caso confirmó que el adaptador rechaza un recorrido si una de sus paradas deja
de estar publicada.

## Qué queda probado

1. Vera puede hablar el protocolo de almacenamiento de Solid mediante HTTP y
   JSON-LD sin un SDK específico.
2. La frontera de publicación de Vera puede gobernar qué sale.
3. Una URL mutable de “estado actual” puede coexistir con revisiones inmutables
   content-addressed.
4. La exportación repetida es idempotente en el estado final y verificable por
   relectura byte a byte.
5. Un recorrido puede viajar como estructura enlazada sin abrir destinos
   privados o no publicados.

## Qué no queda probado

- Solid-OIDC, WebID, WAC o ACP;
- escritura en un Pod remoto autenticado;
- descubrimiento entre personas o instancias Vera;
- importación, edición remota, reconciliación o conflictos;
- borrado y retractación propagados;
- que el vocabulario RDF provisional de Vera sea ya un contrato público estable;
- durabilidad: el CSS usado guardó todo sólo en memoria.

## Decisión

El spike alcanza **nivel 1: proyección unidireccional verificada contra CSS**.
Solid sigue siendo una membrana opcional; SQLite y el registro de operaciones de
Vera continúan siendo la fuente canónica. El siguiente corte, si se autoriza,
debe probar identidad y autorización contra un Pod persistente antes de hablar
de federación o colaboración.
