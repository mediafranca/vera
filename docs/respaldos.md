# Respaldos de Vera

La base viva `data/vera.sqlite` no se copia directamente. `npm run backup:data`
usa la API de backup en línea de SQLite, comprueba la integridad de la copia y
la entrega a un repositorio cifrado de restic. Restic fragmenta y deduplica los
snapshots: las ejecuciones posteriores conservan los bloques nuevos o cambiados
en vez de añadir otra base completa.

En Alexei el repositorio está fuera del proyecto, en
`~/.local/share/vera-backups/restic`, y su contraseña está cifrada como
credencial de usuario `~/.openclaw/credentials/vera-restic.cred`. Ninguno de los
dos se versiona. La retención automática conserva siete diarios, cuatro
semanales y seis mensuales.

El temporizador de usuario `vera-backup.timer` ejecuta el respaldo cada día. Se
puede comprobar con:

```sh
systemctl --user status vera-backup.timer
journalctl --user -u vera-backup.service
```

El repositorio local protege contra errores humanos. Una segunda tarea,
`vera-backup-andrei.timer`, replica esos snapshots a un repositorio Restic
cifrado en Andrei mediante SFTP sobre Tailscale. La réplica tiene límites de
CPU, memoria, E/S y ancho de banda, y su fallo no invalida el respaldo local.

```sh
systemctl --user status vera-backup-andrei.timer
journalctl --user -u vera-backup-andrei.service
```

El repositorio remoto vive en `~/Backups/vera-restic` de Andrei. Usa la misma
credencial cifrada de Restic conservada en Alexei; ni la contraseña ni la base
descifrada se almacenan en el portátil remoto. La retención replica la política
local: siete diarios, cuatro semanales y seis mensuales.

Los snapshots etiquetados `pre-exposure-compaction` son puntos de recuperación
manuales y quedan fuera de la poda temporal ordinaria.
