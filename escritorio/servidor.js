/* =========================================================================
   OpenBOQ escritorio — servidor interno
   -------------------------------------------------------------------------
   La aplicación es HTML/JS estático. Cargarla con file:// rompe el fetch de
   acceso.json y las rutas relativas, así que la ventana de Electron carga
   http://127.0.0.1:<puerto>, servido por este módulo desde dentro del propio
   proceso.

   PUERTO FIJO, A PROPÓSITO (8731).
   Los proyectos, la biblioteca y las preferencias viven en localStorage, y
   localStorage se guarda por ORIGEN — protocolo, host y PUERTO. Con un
   puerto al azar en cada arranque, cada sesión estrenaría un almacenamiento
   vacío y el usuario vería sus proyectos desaparecer. Si 8731 está ocupado
   se prueban los siguientes, pero main.js avisa: los datos guardados antes
   están en el puerto anterior.

   127.0.0.1 además cuenta como origen seguro para el navegador, así que
   crypto.subtle y todo lo que exige contexto seguro sigue funcionando igual
   que en la versión publicada.

   Escucha SOLO en 127.0.0.1: nada sale de la máquina y Windows no levanta el
   aviso del cortafuegos.

   Gemelo de `herramientas/servir.js`, que hace lo mismo para probar en el
   navegador. Si se toca uno, mirar el otro: no comparten código a propósito,
   porque este viaja empaquetado dentro del .exe y aquel no.

   ENTREGA DE LA SESIÓN (login con Google)
   ---------------------------------------
   El proveedor no acepta que el login corra dentro de una ventana de
   Electron —Google lo rechaza con `disallowed_useragent`—, así que se abre
   en el navegador del sistema. El proveedor devuelve el token en el
   FRAGMENTO de la URL (`#access_token=…`), que el navegador NUNCA manda al
   servidor: solo lo ve el JavaScript de la página.

   Por eso la entrega es en dos tiempos:
     1. El navegador aterriza en 127.0.0.1:<puerto> — el mismo servidor que
        atiende a la aplicación de escritorio.
     2. La página lee su propio fragmento y lo manda acá por POST a
        `/entrar/recibir`. Recién ahí el token cruza del navegador a la
        aplicación, sin pasar por ninguna red.

   Hay dos aterrizajes posibles y los dos terminan en el mismo POST:
     · `/entrar`  página mínima que sirve este módulo. Es la buena, pero
                  exige que esa dirección esté en la lista de redirecciones
                  permitidas de Supabase.
     · `/`        la aplicación entera. El script del principio de
                  index.html reconoce el caso y entrega igual, sin arrancar
                  el resto. Sirve sin tocar la configuración del servidor.
   ========================================================================= */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO_ESTANDAR = 8731;
const INTENTOS = 10;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.boq': 'application/json; charset=utf-8'
};

/* Página de aterrizaje del login. No carga nada: lee el fragmento, lo manda
   por POST y avisa que se puede cerrar. Va acá adentro, en texto, para que
   viaje dentro del asar y no dependa de ningún archivo suelto. */
const PAGINA_ENTRAR = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>OpenBOQ</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#eceae5;color:#1f3864;font:15px/1.5 "Segoe UI",Arial,sans-serif}
.c{max-width:380px;text-align:center;padding:28px}
.l{width:56px;height:56px;border-radius:12px;background:#1f3864;color:#fff;font-weight:700;
font-size:22px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
h1{font-size:19px;margin:0 0 8px}p{margin:0;color:#4a5568}</style></head>
<body><div class="c"><div class="l">BQ</div>
<h1 id="t">Entrando…</h1><p id="d">Un momento.</p></div>
<script>
(function(){
  var t=document.getElementById('t'),d=document.getElementById('d');
  var p=new URLSearchParams(location.hash.slice(1));
  function mal(m){t.textContent='No se pudo entrar';d.textContent=m;}
  if(!p.get('access_token')){mal(p.get('error_description')||'El proveedor no devolvió ninguna sesión.');return;}
  fetch('/entrar/recibir',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({access_token:p.get('access_token'),refresh_token:p.get('refresh_token'),
      token_type:p.get('token_type'),expires_in:p.get('expires_in'),
      llave:new URLSearchParams(location.search).get('e')||''})})
   .then(function(r){return r.json();})
   .then(function(r){
      if(!r||!r.ok){mal('OpenBOQ no aceptó la sesión. Volver a intentar desde la aplicación.');return;}
      history.replaceState(null,'','/entrar');
      t.textContent='Listo';d.textContent='Ya puede cerrar esta pestaña y volver a OpenBOQ.';
   })
   .catch(function(){mal('OpenBOQ ya no está escuchando. Abrirlo y volver a intentar.');});
})();
<\/script></body></html>`;

function crear(RAIZ, entregar) {
  return http.createServer((req, res) => {
    /* ---- entrega de la sesión: antes que nada, no es un archivo ---- */
    const soloRuta = req.url.split('?')[0];

    if (soloRuta === '/entrar' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGINA_ENTRAR);
    }

    if (soloRuta === '/entrar/recibir') {
      if (req.method !== 'POST') { res.writeHead(405); return res.end('405'); }
      let cuerpo = '';
      let cortado = false;
      req.on('data', t => {
        cuerpo += t;
        /* un token de Supabase no llega a 8 KB; más que eso no es un login */
        if (cuerpo.length > 16384) { cortado = true; req.destroy(); }
      });
      req.on('end', () => {
        if (cortado) return;
        let datos = null;
        try { datos = JSON.parse(cuerpo); } catch (e) { datos = null; }
        const ok = !!(datos && datos.access_token && entregar && entregar(datos));
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok }));
      });
      return;
    }

    let ruta;
    try { ruta = decodeURIComponent(req.url.split('?')[0]); }
    catch (e) { res.writeHead(400); return res.end('400'); }
    if (ruta === '/') ruta = '/index.html';

    /* nada fuera de la carpeta de la aplicación */
    const destino = path.resolve(RAIZ, '.' + path.normalize(ruta).split(path.sep).join('/'));
    if (destino !== RAIZ && destino.indexOf(RAIZ + path.sep) !== 0) {
      res.writeHead(403); return res.end('403');
    }

    fs.readFile(destino, (err, datos) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 — no está ' + ruta);
      }
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(datos);
    });
  });
}

/* Devuelve { puerto, url, estandar, cerrar() }.
   `opciones.entregarSesion(datos)` recibe el token que manda la pestaña del
   navegador al volver del proveedor; devuelve true si lo aceptó.
   `estandar` es false cuando hubo que correrse de 8731: main.js lo usa para
   avisar que los proyectos anteriores no van a aparecer. */
function iniciar(raiz, opciones) {
  const RAIZ = path.resolve(raiz);
  const primero = (opciones && opciones.puerto) || PUERTO_ESTANDAR;
  const entregar = (opciones && opciones.entregarSesion) || null;

  return new Promise((resolver, rechazar) => {
    let intento = 0;

    (function probar(puerto) {
      const servidor = crear(RAIZ, entregar);
      servidor.once('error', err => {
        if ((err.code === 'EADDRINUSE' || err.code === 'EACCES') && ++intento < INTENTOS) return probar(puerto + 1);
        rechazar(err);
      });
      servidor.listen(puerto, '127.0.0.1', () => {
        resolver({
          puerto,
          url: 'http://127.0.0.1:' + puerto + '/',
          estandar: puerto === primero,
          cerrar: () => new Promise(r => servidor.close(r))
        });
      });
    })(primero);
  });
}

module.exports = { iniciar, PUERTO_ESTANDAR };
