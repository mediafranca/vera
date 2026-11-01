# Desplegar una Vera personal en Fly.io

La imagen contiene el programa y la interfaz compilada. El volumen contiene la
Vera: SQLite, objetos y, cuando corresponda, modelos locales. Una imagen nunca
incluye una base personal ni credenciales.

## Primer despliegue

1. Copiar `deploy/fly.toml.example` como `fly.toml` y elegir un nombre único.
2. Crear la aplicación sin desplegar: `fly launch --no-deploy`.
3. Crear el único volumen de la instancia: `fly volumes create vera_data --region gru --size 10`.
4. Desplegar: `fly deploy`.
5. Desde la consola privada de la Machine, emitir una matrícula de passkey:
   `fly ssh console -C "npm run owner:enroll-passkey -- /data/vera.sqlite"`.
6. Abrir la ruta de matrícula que imprime el comando y registrar la passkey del dueño.

La base se crea en el primer arranque. Las migraciones siguientes ocurren al
abrirla, sobre el mismo volumen; un `release_command` de Fly no sirve para esto
porque su Machine temporal no monta el volumen persistente.

## Voz local

La imagen base instala `ffmpeg`, pero no descarga modelos durante el build. La
transcripción necesita `whisper.cpp` y un modelo GGML; la síntesis necesita el
runtime Kokoro. Ambos son opcionales en Vera y deben vivir bajo `/data/models`
o en una futura imagen de voz versionada. No se deben descargar silenciosamente
al arrancar: cambian tamaño, tiempo y costo del servicio. El piloto de
Vera + Lucienne debe medirlos antes de fijar esa imagen.

## Límites deliberados

- Una Vera con SQLite y un volumen de Fly corre en una sola Machine.
- No se escala horizontalmente clonando la Machine: dos procesos no comparten el volumen.
- Snapshot de Fly y backup externo son cosas distintas.
- `VERA_OWNER` y `VERA_OWNER_NAME` sólo siembran una base vacía; cambiar esas
  variables después no reescribe la autoría existente.
