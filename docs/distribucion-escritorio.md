# Distribución de Vera Desktop

Vera se distribuye como una aplicación instalable para Windows, macOS y Linux.
El programa y la memoria son piezas distintas: actualizar o desinstalar el
primero no borra la segunda.

## Dos niveles de confianza, formalizados en la spec

`specs/desktop-distribution.allium` distingue dos categorías de release, cada
una con sus propias garantías — ninguna finge tener las garantías de la otra:

- **`StableRelease`** — cada plataforma es confiable por sí sola. Windows exige
  firma Authenticode; macOS exige firma con Developer ID y notarización; Linux
  no exige ninguna de las dos porque no existe un bloqueo de sistema operativo
  equivalente a SmartScreen o Gatekeeper para AppImage/deb. Solo estas
  releases participan de la actualización automática.
- **`AlphaRelease`** — Windows y/o macOS sin firma comercial, mientras esa
  firma no sea alcanzable para quien mantiene Vera. Exige checksum verificable
  y divulgación explícita del riesgo en las notas de la release. Nunca ofrece
  actualización automática: pasar de una versión sin firmar a la siguiente es
  una descarga manual.

Cuál de las dos aplica a cada plataforma, en cada release, se decide sin
intervención humana: el workflow firma si encuentra los secretos de Windows o
de Apple, y publica sin firmar si no los encuentra — nunca falla en silencio
ni dejan de existir instaladores por eso.

## Artefactos de una release

| Plataforma | Primera instalación | Actualización | Arquitectura |
| --- | --- | --- | --- |
| Windows (firmado) | `Vera Setup <versión>.exe` | NSIS + `latest.yml` | x64 |
| Windows (sin firmar) | `Vera Setup <versión> (sin firmar).exe` | descarga manual, sin `latest.yml` | x64 |
| Windows portable | `Vera <versión>.exe` | sustitución manual | x64 |
| macOS (firmado) | `Vera-<versión>-universal.dmg` | ZIP + `latest-mac.yml` | Intel + Apple Silicon |
| macOS (sin firmar) | `Vera-<versión>-universal (sin firmar).dmg` | descarga manual, sin ZIP ni `latest-mac.yml` | Intel + Apple Silicon |
| Linux | `Vera-<versión>.AppImage`, `.deb` | descarga manual | x64 |

El ZIP de macOS no es otro instalador para la persona: solo existe para que el
actualizador genere `latest-mac.yml`, así que un build sin firmar (que nunca
ofrece auto-actualización) no lo incluye. El DMG sigue siendo la descarga
humana de primera instalación en ambos casos.

## Instalar sin firma

**Windows:** ver [Instalación en Windows](instalacion-windows.md#instalar-sin-firma).

**macOS:** al abrir `Vera-<versión>-universal (sin firmar).dmg` y arrastrar la
app a Aplicaciones, Gatekeeper va a bloquear la primera apertura directa
("Vera no se puede abrir porque su desarrollador no se puede verificar", o
directamente sin ofrecer un botón para abrirla igual). Para continuar:

1. Clic derecho (o Control+clic) sobre `Vera.app` → **"Abrir"**.
2. Confirmar **"Abrir"** en el diálogo que aparece (distinto del de doble clic:
   este sí ofrece la opción).
3. Si macOS igual la bloquea: Ajustes del Sistema → Privacidad y Seguridad →
   bajar hasta el aviso sobre Vera → **"Abrir de todas formas"**.

Alternativa por Terminal, quitando el atributo de cuarentena que macOS agrega
a todo lo descargado del navegador:

```sh
xattr -cr /Applications/Vera.app
```

Antes de instalar, podés verificar el archivo contra el `SHA256SUMS-macos.txt`
de esa misma release:

```sh
shasum -a 256 "Vera-<versión>-universal (sin firmar).dmg"
```

## Qué ocurre en cada push

`.github/workflows/desktop.yml` se ejecuta para pushes, pull requests y de forma
manual. En todos ellos instala de cero, comprueba las specs Allium, ejecuta las
pruebas y tipos y compila la interfaz. Eso acusa recibo de cada cambio sin
convertir cada commit en software instalado automáticamente.

Sólo un tag que coincide exactamente con la versión de `package.json` abre el
circuito de distribución:

1. Windows construye NSIS y portable x64; firma con Authenticode si encuentra
   `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD`, o construye sin firmar
   si no los encuentra.
2. macOS construye DMG y ZIP universales; firma con Developer ID y notariza si
   encuentra las cinco credenciales de Apple, o construye solo el DMG sin
   firmar si no las encuentra.
3. Linux construye AppImage y deb x64 — nunca requiere firma.
4. cada runner genera checksums; los builds sin firmar además pierden su
   manifiesto de actualización (`latest.yml`/`latest-mac.yml`) para que
   `electron-updater` nunca los ofrezca como actualización automática.
5. un trabajo final reúne todo en una única GitHub Release, con notas que
   dejan explícito qué plataformas están firmadas y cuáles no.

Nada se degrada en silencio: si falta una credencial, el instalador de esa
plataforma sale marcado "(sin firmar)" y la release lo dice en sus notas, en
vez de fallar sin publicar nada (que era el comportamiento anterior) o de
pretender la confianza de un instalador firmado.

## Secretos requeridos en GitHub Actions

Windows:

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

macOS:

- `MAC_CERTIFICATE`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Los certificados, contraseñas y credenciales de Apple viven sólo como secretos
de Actions. Nunca se guardan en el repositorio ni dentro del instalador.

## Flujo de una actualización

La comprobación está activa únicamente en una aplicación empaquetada e
instalada de Windows o macOS. Desarrollo, Linux y la edición portable quedan
fuera.

1. Vera espera diez segundos tras arrancar para no bloquear la primera lectura.
2. Comprueba el canal estable y vuelve a hacerlo cada seis horas mientras siga
   abierta.
3. Si hay una versión nueva, informa su número y pide permiso para descargar.
4. La descarga ocurre en segundo plano y su progreso aparece en la aplicación.
5. La persona elige «Reiniciar e instalar» o «Instalar al cerrar».
6. Vera cierra primero su servidor local y SQLite; después entrega el proceso al
   actualizador.

Los errores de red no impiden usar la versión instalada. Las versiones
preliminares no entran al canal estable. La memoria permanece en su directorio:

- Windows: `%LOCALAPPDATA%\Vera`;
- macOS: `~/Library/Application Support/Vera/data`;
- Windows portable: `VeraData` junto al ejecutable.

Esto vale también para la actualización manual de una release sin firmar:

- **Windows instalado:** se ejecuta el NSIS nuevo sobre la instalación anterior,
  con la misma cuenta; no hace falta desinstalar. `%LOCALAPPDATA%\Vera` queda
  fuera del payload y se vuelve a abrir al terminar.
- **macOS:** se reemplaza `Vera.app` en Aplicaciones; la memoria permanece en
  Application Support.
- **Linux:** se instala el `.deb` nuevo o se sustituye el AppImage; ninguno de
  los dos lleva una base de datos ni borra la configuración de la persona.
- **Windows portable:** se reemplaza el ejecutable dentro de su carpeta y se
  conserva `VeraData`. Un portable abierto en otra carpeta verá otra ubicación;
  no borra la anterior, pero tampoco la descubre automáticamente.

Como Vera todavía cambia con rapidez y las releases alfa no reciben avisos
automáticos, la documentación pública debe llevar siempre a
[`releases/latest`](https://github.com/mediafranca/vera/releases/latest) y pedir
que se revisen con frecuencia las notas de versión.

## Crear una release

Antes del tag:

```sh
npm ci
npm run spec
npm test -- --test-concurrency=1
npm run typecheck
npm run build:desktop
npm version <versión> --no-git-tag-version
npm run release:verify-tag -- v<versión>
```

Después se revisa y compromete el cambio de versión. Crear y empujar el tag es
una operación humana deliberada; GitHub Actions hace el resto. Nunca se reutiliza
un número de versión retirado: una corrección lleva un número mayor.

## Prueba de aceptación A → B

Antes de habilitar el canal para terceros hay que demostrar en Windows 11 y en
macOS Intel/Apple Silicon que:

1. A se instala y crea una memoria;
2. A detecta B y permite aplazarla;
3. B se descarga y verifica;
4. cerrar o reiniciar instala B;
5. la misma memoria abre íntegra en B;
6. una interrupción de red deja A utilizable;
7. una release inválida o sin firma no se instala;
8. desinstalar no elimina el corpus.

La conducta observable está formalizada en
[`specs/desktop-distribution.allium`](../specs/desktop-distribution.allium). La
firma macOS y el ZIP requerido por el actualizador siguen las guías oficiales de
[notarización](https://www.electron.build/docs/notarization/) y
[actualización](https://www.electron.build/docs/features/auto-update/) de
electron-builder.
