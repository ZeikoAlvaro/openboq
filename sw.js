/* OpenBOQ — service worker.

   DECISIÓN (2026-07-31): la aplicación ya NO se guarda entera para funcionar
   sin conexión. Antes este archivo precargaba el programa y la Base de Datos
   y los servía desde el caché cuando no había red, con lo cual una vez
   abierta seguía andando sola por tiempo indefinido.

   Ahora todo se pide a la red en cada carga: sin internet la aplicación no
   arranca. Una vez cargada funciona entera —presupuesto, análisis, cómputos,
   cronograma, reportes y exportaciones—; `js/acceso.js` solo consulta
   `acceso.json` para pintar el punto de color del estado de la conexión.

   Este service worker queda solo para que la aplicación se pueda instalar
   como PWA y para borrar los cachés que dejaron las versiones anteriores.

   Al publicar una versión nueva, subir el número de CACHE.                */
const CACHE = 'openboq-v75';
const V = '75';                       // mismo número que el ?v= de index.html

self.addEventListener('install', e => {
  /* nada que precargar: se instala y pasa a activo enseguida */
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    /* se borran TODOS los cachés, incluidos los de versiones anteriores que
       todavía tuvieran la aplicación completa guardada */
    caches.keys()
      .then(ks => Promise.all(ks.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Sin manejador de `fetch`: cada pedido va directo a la red, como si el
   service worker no existiera. Si no hay conexión, el navegador muestra su
   propio aviso y la aplicación no carga — que es exactamente lo que se
   busca con este modelo. */
