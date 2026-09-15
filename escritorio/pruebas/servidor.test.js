/* =========================================================================
   Prueba del servidor interno — entrega de la sesión
   -------------------------------------------------------------------------
   Lo que se comprueba acá es el camino por donde vuelve el login: el
   navegador del sistema termina de entrar, la página de vuelta manda el
   token por POST a 127.0.0.1 y la aplicación lo recibe. Es el punto donde
   antes se perdía la sesión —quedaba guardada en el navegador y la
   aplicación seguía como invitada—, así que conviene tenerlo cubierto.

   Corre sin Electron: `servidor.js` es Node puro a propósito.

       node pruebas/servidor.test.js       (o: npm run probar:servidor)

   Usa el puerto 18731 para no pelear con una copia de OpenBOQ abierta.
   ========================================================================= */
'use strict';

const path = require('path');
const http = require('http');
const servidor = require(path.join(__dirname, '..', 'servidor.js'));

const RAIZ = path.resolve(__dirname, '..', '..');     /* la aplicación web */
const PUERTO = 18731;

/* Hace de proceso principal: acepta la llave que espera y guarda lo que
   llegó, igual que recibirSesion() en main.js. */
let recibido = null;
const entregar = d => { recibido = d; return d.llave === 'buena' || !d.llave; };

function pedir(ruta, metodo, cuerpo) {
  return new Promise(res => {
    const r = http.request({
      host: '127.0.0.1', port: PUERTO, path: ruta, method: metodo,
      headers: cuerpo
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo) }
        : {}
    }, resp => {
      let t = '';
      resp.on('data', c => t += c);
      resp.on('end', () => res({ codigo: resp.statusCode, cuerpo: t }));
    });
    r.on('error', e => res({ codigo: 0, cuerpo: String(e.message) }));
    if (cuerpo) r.write(cuerpo);
    r.end();
  });
}

let fallas = 0;
const ok = (c, m) => { console.log((c ? '  ok     ' : '  FALLA  ') + m); if (!c) fallas++; };

servidor.iniciar(RAIZ, { puerto: PUERTO, entregarSesion: entregar }).then(async s => {
  console.log('servidor interno — entrega de la sesión\n');

  let r = await pedir('/entrar', 'GET');
  ok(r.codigo === 200 && r.cuerpo.indexOf('/entrar/recibir') > 0, 'GET /entrar sirve la página de vuelta');

  r = await pedir('/entrar?e=buena', 'GET');
  ok(r.codigo === 200, 'GET /entrar con parámetros también');

  r = await pedir('/entrar/recibir', 'GET');
  ok(r.codigo === 405, 'GET a /entrar/recibir se rechaza');

  r = await pedir('/entrar/recibir', 'POST', JSON.stringify({ access_token: 'T', llave: 'buena' }));
  ok(r.codigo === 200 && JSON.parse(r.cuerpo).ok === true, 'POST con la llave buena entrega la sesión');
  ok(recibido && recibido.access_token === 'T', 'el token llega entero al proceso principal');

  r = await pedir('/entrar/recibir', 'POST', JSON.stringify({ access_token: 'T', llave: 'mala' }));
  ok(r.codigo === 400 && JSON.parse(r.cuerpo).ok === false, 'POST con la llave mala se rechaza');

  r = await pedir('/entrar/recibir', 'POST', JSON.stringify({ llave: 'buena' }));
  ok(r.codigo === 400, 'POST sin token se rechaza');

  r = await pedir('/entrar/recibir', 'POST', 'esto no es json');
  ok(r.codigo === 400, 'POST con basura se rechaza');

  r = await pedir('/', 'GET');
  ok(r.codigo === 200 && r.cuerpo.indexOf('OpenBOQ') > 0, 'la aplicación se sigue sirviendo');

  r = await pedir('/js/ui.js', 'GET');
  ok(r.codigo === 200, 'los archivos de la aplicación se sirven');

  r = await pedir('/entrar/otra', 'POST', '{}');
  ok(r.codigo === 404, 'no cuelga nada más de /entrar');

  /* `..` de más: la ruta se normaliza contra la raíz de la aplicación y no
     puede terminar afuera. Con el servidor sirviendo en 127.0.0.1 esto es lo
     único que separa la carpeta de la aplicación del resto del disco. */
  r = await pedir('/../../../../Windows/win.ini', 'GET');
  ok(r.codigo === 403 || r.codigo === 404, 'no se sale de la carpeta de la aplicación');

  r = await pedir('/%2e%2e%2f%2e%2e%2fWindows%2fwin.ini', 'GET');
  ok(r.codigo === 403 || r.codigo === 404, 'tampoco con la ruta codificada');

  await s.cerrar();
  console.log(fallas ? '\n' + fallas + ' falla(s)\n' : '\ntodo bien\n');
  process.exit(fallas ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
