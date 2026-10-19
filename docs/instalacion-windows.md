# Instalación de Vera en Windows

Estado: instalador empaquetable y cliente de actualización implementados.
Conseguir una identidad Authenticode no es viable ahora mismo para quien
mantiene Vera (ver [Distribución de Vera Desktop](distribucion-escritorio.md)),
así que las releases actuales para Windows se publican **sin firmar**, como
`AlphaRelease` en `specs/desktop-distribution.allium`. El archivo es exactamente
el mismo código que tendría una versión firmada; lo único que falta es la
identidad comercial que Windows verifica.

## Instalar sin firma

Al ejecutar `Vera Setup <versión> (sin firmar).exe` vas a ver una pantalla azul
de **Windows SmartScreen**: "Windows protegió su PC". Esto es exactamente lo
que se espera de un instalador sin Authenticode, no un indicio de que el
archivo esté dañado o alterado. Para continuar:

1. Clic en **"Más información"** (aparece dentro del mismo aviso).
2. Clic en **"Ejecutar de todas formas"**.

Antes de instalar, podés verificar que el archivo no fue alterado comparándolo
con el `SHA256SUMS-windows.txt` que acompaña esa misma release en GitHub:

```sh
certutil -hashfile "Vera Setup <versión> (sin firmar).exe" SHA256
```

El resultado debe coincidir con la línea correspondiente en `SHA256SUMS-windows.txt`.

Una release sin firmar **no ofrece actualización automática** (no se genera
`latest.yml`): actualizar de una versión sin firmar a la siguiente significa
volver a descargar el instalador desde
[GitHub Releases](https://github.com/mediafranca/vera/releases/latest).

Vera recibe versiones frecuentes. Conviene revisar periódicamente esa página y
leer las notas de la versión antes de actualizar; una descarga nueva reemplaza
el programa, no la memoria.

## Actualizar sin perder la memoria

### Instalación normal

1. Descarga `Vera Setup <versión> (sin firmar).exe` desde la última release.
2. Verifica su SHA-256 como se explica arriba.
3. Ejecuta el instalador con la misma cuenta de Windows y elige la misma
   instalación. **No desinstales Vera primero.**
4. Abre Vera: Desktop encuentra la base existente en
   `%LOCALAPPDATA%\Vera\data\vera.sqlite` y omite la creación de una memoria
   inicial.

El instalador no contiene una base `vera.sqlite` y no tiene nada que copiar
encima del corpus. El desinstalador también está configurado para conservar los
datos de la aplicación. Una versión nueva puede aplicar migraciones de esquema
pendientes al abrir, pero cada migración se ejecuta dentro de una transacción:
un fallo no deja media migración aplicada.

### Edición portable

El portable busca la memoria en `VeraData` junto al ejecutable. Para actualizar,
reemplaza el `.exe` anterior por el nuevo **dentro de la misma carpeta** y deja
`VeraData` intacto. Si pones el ejecutable nuevo en otro directorio, Vera no
pisará la memoria antigua: sencillamente no la encontrará y mostrará la primera
apertura. Volver a la carpeta anterior —o mover `VeraData` completa junto al
nuevo ejecutable— recupera esa memoria.

## Artefactos

- `Vera Setup <versión>.exe`: instalación por persona mediante NSIS. El corpus
  queda fuera del programa y el desinstalador no lo elimina.
- `Vera <versión>.exe`: edición portable. Crea `VeraData` junto al ejecutable.

Ambos contienen el mismo payload: Electron, el servidor local de Vera, la
interfaz web compilada, el esquema SQLite y los recursos de presentación.

## Primera apertura

Si no existe una memoria, Vera pide el nombre de la persona propietaria. No lo
deduce de Windows: esa identidad firma las futuras contribuciones humanas y
debe ser una declaración consciente.

Después crea una memoria inicial versionada con ocho páginas:

1. `Vera`, portada y orientación;
2. `VERA — Primeros pasos`;
3. `VERA — Manual`;
4. `VERA — Teclado y atajos`;
5. `VERA — Acceder desde tus otros dispositivos`;
6. `VERA — Página de ejemplo`;
7. `VERA — Conectar una inteligencia artificial`;
8. `VERA — Principios`.

Estas páginas no se copian desde una base binaria. Son operaciones canónicas,
idempotentes y auditables firmadas por `participant:vera-distribution`. La
persona puede editarlas o borrarlas; reiniciar Vera no las recrea.

## Datos

- Instalación normal: `%LOCALAPPDATA%\Vera`.
- Portable: `VeraData` junto al ejecutable.

El programa es reemplazable. La base SQLite, los objetos y la configuración no
forman parte del paquete ni deben borrarse al actualizar o desinstalar.

## Construir

```sh
npm ci
npm run build:desktop
npm run pack:windows
```

Alexei puede compilar el payload y producir el portable x64 directamente desde
Debian. NSIS necesita Wine cuando se construye localmente en Linux. La vía
reproducible principal es `.github/workflows/desktop.yml`. Cada push verifica el
repositorio; un tag `v<versión>` coherente con `package.json` construye los
artefactos firmados y crea el GitHub Release multiplataforma.

## Actualización

La instalación NSIS consulta el canal estable de GitHub Releases diez segundos
después de abrir y luego cada seis horas. Si encuentra una versión mayor:

1. pregunta antes de descargar;
2. muestra el progreso en la aplicación;
3. verifica el manifiesto y la firma mediante `electron-updater`;
4. permite reiniciar inmediatamente o instalar al cerrar;
5. cierra el servidor SQLite antes de reemplazar el programa.

La edición portable no se reemplaza sola. Los pushes corrientes nunca actualizan
aplicaciones: sólo las releases estables creadas por tag alimentan `latest.yml`.

## Pendiente antes del alfa

- probar instalación, primera apertura, reinicio y desinstalación en Windows 11
  limpio;
- diseñar icono y metadatos finales;
- conseguir una identidad Authenticode viable (hoy bloqueada por costo/trámite
  para quien mantiene Vera) y cargarla a los secretos protegidos del workflow;
- respaldo previo y prueba de migración entre dos versiones;
- probar el ciclo completo versión A → versión B en Windows 11 limpio;
- diagnóstico exportable sin secretos;
- medir arranque, RAM y corpus grandes en el hardware mínimo declarado.
