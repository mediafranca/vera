import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  /*
   * Lo compilado vive en `/build/`, aparte de `/assets/`.
   *
   * Vite pone su salida con huella en `assets/`, que es también donde `public/`
   * deja los SVG copiados tal cual. Mezclados, no hay forma de mirar una ruta y
   * saber si su nombre garantiza su contenido: `index-BMdgMbJP.css` no puede
   * cambiar sin cambiar de nombre, `vera_map.svg` sí. De esa distinción depende
   * qué se puede guardar para siempre y qué hay que volver a preguntar, y
   * adivinarla por la forma del nombre falla justo en los casos raros
   * —`LICENSE-IBM-Plex.txt` parece llevar huella y no lleva—.
   *
   * Separarlos convierte la pregunta en el prefijo de la ruta, que no se
   * equivoca. El servidor y el service worker leen los dos la misma regla.
   */
  /*
   * Una PWA ya abierta puede conservar por unos segundos el `index.html`
   * anterior mientras el service worker toma el nuevo. Ese documento pide sus
   * assets por huella, y son válidos para siempre; borrarlos en cada build
   * convierte una actualización normal en «Vera no pudo arrancar».
   *
   * Conservamos las generaciones anteriores. Una futura recolección puede
   * retirar sólo huellas que ya no estén referidas por ningún shell retenido;
   * Vite no dispone de ese conocimiento al compilar.
   */
  build: {
    outDir: 'dist',
    assetsDir: 'build',
    emptyOutDir: false,
    target: 'es2023',
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        mapFrame: new URL('./map-frame.html', import.meta.url).pathname,
      },
    },
  },
  publicDir: 'public',
  server: {
    // En desarrollo el cliente habla con el servidor local de Vera.
    proxy: Object.fromEntries(
      ['/operations', '/pages', '/search', '/graph', '/ops', '/health', '/invariants'].map((p) => [
        p,
        { target: 'http://localhost:4173', changeOrigin: true },
      ]),
    ),
  },
});
