/* =========================================================================
   OpenBOQ — servidor local para probar la aplicación
   -------------------------------------------------------------------------
   Sirve la carpeta del proyecto por HTTP. Hace falta porque el service
   worker, la PWA y el `fetch` de acceso.json no funcionan abriendo el
   index.html con doble clic (protocolo file://).

   Sin dependencias: solo el `http` de Node. Manda `no-store` en todo, para
   que el navegador no sirva de su caché la versión anterior mientras se
   está probando un cambio.

   Uso:
       npm run servir
       node herramientas/servir.js --puerto=8080
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const a = args.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const PUERTO = Number(arg('puerto', '8731'));

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(req.url.split('?')[0]);
  if (ruta === '/') ruta = '/index.html';

  /* nada fuera de la carpeta del proyecto */
  const destino = path.join(RAIZ, path.normalize(ruta).replace(/^([/\\])+/, ''));
  if (!destino.startsWith(RAIZ)) { res.writeHead(403); return res.end('403'); }

  fs.readFile(destino, (err, datos) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — no está ' + ruta);
    }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(datos);
  });
});

servidor.listen(PUERTO, () => {
  console.log('\nOpenBOQ sirviéndose en  http://localhost:' + PUERTO + '/');
  console.log('  carpeta: ' + RAIZ);
  console.log('  Ctrl+C para cortar\n');
});
