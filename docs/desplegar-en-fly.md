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

La imagen base instala `ffmpeg` y el runtime Python necesario para una instalación
explícita, pero no descarga modelos durante el build. En **Centro de Vera →
Conexiones → Voz** el dueño activa por separado escuchar (STT) y hablar (TTS),
y ve qué binario o modelo falta. Para instalar ambos sobre el volumen durable:

```sh
fly ssh console -C "npm run voice:setup -- /data/models"
```

El comando prepara `whisper.cpp` y Kokoro y al terminar imprime las variables
`VERA_WHISPER`, `VERA_WHISPER_MODEL` y `VERA_TTS_RUNTIME` que deben declararse
en la aplicación. El navegador no ejecuta esta instalación: compila código,
descarga modelos grandes y requiere autoridad del host. Los modelos viven bajo
`/data/models`; desplegar una imagen nueva no los borra.

No se descargan silenciosamente al arrancar: cambian tamaño, tiempo y costo del
servicio. En la prueba del 1 de noviembre de 2026, una primera síntesis local en
Alexei llevó el cgroup de Vera + Kokoro a 2,49 GiB de pico y luego quedó cerca de
1,86 GiB. Por eso 2 GiB queda como perfil base sin TTS local y la plantilla
reserva 4 GiB cuando la voz está activa. El piloto de Vera + Lucienne todavía
debe medir latencia, concurrencia y audios largos antes de fijar un perfil
comercial.

## Límites deliberados

- Una Vera con SQLite y un volumen de Fly corre en una sola Machine.
- No se escala horizontalmente clonando la Machine: dos procesos no comparten el volumen.
- Snapshot de Fly y backup externo son cosas distintas.
- `VERA_OWNER` y `VERA_OWNER_NAME` sólo siembran una base vacía; cambiar esas
  variables después no reescribe la autoría existente.
