# Seguridad

La explicación pública del modelo de seguridad vive en
[VERA — Seguridad](https://vera.mediafranca.net/vera-seguridad/). Este documento
conserva las advertencias operativas y el canal de reporte del repositorio.

Vera custodia memoria personal. Un defecto de aislamiento, credenciales,
alcances, publicación o procedencia puede exponer el corpus o atribuir una
operación a la mano equivocada.

## Estado de esta versión

La versión publicada más reciente y la rama `main` son una alfa de investigación.
La aplicación privada escucha en
`127.0.0.1` por defecto y debe permanecer allí, detrás de una frontera de red
con autenticación. **No expongas el puerto privado directamente a Internet ni
cambies `VERA_HOST` a una interfaz pública:** las personas todavía no se
autentican ante Vera y una petición sin credencial que alcance esa puerta opera
como la persona propietaria.

El sitio público usa una puerta distinta, de sólo lectura, y proyecta únicamente
las páginas publicadas de manera explícita. Esa separación es una garantía del
servidor; ocultar botones en la interfaz no cuenta como control de acceso.

## Reportar una vulnerabilidad

No abras un issue público. Escribe a **hspencer@ead.cl** con:

- la versión o commit afectado;
- el comportamiento observado y el esperado;
- pasos mínimos para reproducirlo;
- alcance estimado y cualquier mitigación conocida.

Se acusará recibo, se verificará el hallazgo y se acordará con quien reporta el
momento de divulgarlo. No incluyas datos personales, credenciales ni fragmentos
de un corpus real si no son imprescindibles.

## Zonas especialmente sensibles

- la separación entre servidor privado y sitio público;
- la identidad derivada de credenciales y la revocación;
- los alcances de lectura, escritura y descarte;
- la puerta MCP y su registro de exposición;
- el confinamiento de incrustaciones, Mermaid y contenido activo;
- importación, exportación, copias y restauración;
- cualquier camino que escriba fuera de `POST /operations`.

## Versiones soportadas

Mientras Vera siga en alfa, sólo `main`, `dev` y la versión alfa publicada más
reciente reciben correcciones de seguridad. `dev` recibe primero el arreglo y
`main` lo recibe mediante una promoción extraordinaria si la gravedad no admite
esperar a la siguiente versión. No se prometen parches para ramas históricas.
