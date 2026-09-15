/* NUBE.alFallarLogin: avisar cuando la ventana de acceso se va sin dejar sesión.

   Esta prueba existe por un fallo que costó una tarde y que NO daba ningún
   mensaje. El proveedor valida la dirección de vuelta contra su propia lista
   y, cuando no está, **no avisa**: manda al usuario al Site URL del proyecto.
   La ventana emergente termina entonces en OTRO origen, guarda ahí la sesión
   y se queda abierta mostrando la cuenta iniciada, mientras la ventana que la
   abrió sigue como invitada.

   Lo que hace difícil de ver el problema es que los tres caminos de
   `alEntrar` están bien y aun así ninguno puede ayudar: `postMessage` no
   cruza orígenes, el evento `storage` tampoco, y el sondeo de respaldo lee un
   `localStorage` que no es el que se escribió. Todo «funciona» y el usuario
   ve dos ventanas que se contradicen.

   Pasa siempre al probar en `localhost`, porque esa dirección no suele estar
   cargada en el panel del proveedor.

   No toca la red: navegador simulado, igual que sesion.test.js. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Navegador simulado con `window.open` bajo control de la prueba. */
function armar(origen) {
  const guardado = {};
  const oyentes = {};
  /* La ventana que devuelve `open`: la prueba decide cuándo se cierra. */
  const ventana = { closed: false, focus() { }, close() { this.closed = true; } };

  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, Error,
    fetch: () => Promise.reject(new Error('sin red en esta prueba')),
    localStorage: {
      _d: guardado,
      getItem(k) { return this._d[k] ?? null },
      setItem(k, v) { this._d[k] = String(v) },
      removeItem(k) { delete this._d[k] }
    },
    navigator: { onLine: true, userAgent: 'prueba', language: 'es' },
    location: { origin: origen || 'http://localhost:8731', pathname: '/', hash: '', search: '', href: '' },
    history: { replaceState() { } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.open = () => ventana;
  ctx.addEventListener = (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); };
  ctx.disparar = (t, e) => (oyentes[t] || []).forEach(f => f(e));
  vm.createContext(ctx);
  ['js/nube-config.js', 'js/nube.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
  return { N: vm.runInContext('NUBE', ctx), ctx, ventana };
}

const SESION = { access_token: 'tok', refresh_token: 'ref', user: null };
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== La ventana se cierra sin dejar sesión: avisa ==');
  {
    const { N, ventana } = armar();
    const avisos = [];
    N.alFallarLogin(d => avisos.push(d));

    ok(N.entrarCon('google') === 'ventana', 'el login abre una ventana aparte');
    await espera(1200);
    ok(avisos.length === 0, 'mientras la ventana sigue abierta, no molesta');

    ventana.closed = true;                 // el usuario la cierra, o quedó en otro origen
    await espera(1400);
    ok(avisos.length === 1, 'al cerrarse sin sesión, un aviso: ' + avisos.length);
    ok(avisos[0] && avisos[0].cerrada === true, 'el aviso dice que la ventana se cerró');
    ok(avisos[0] && avisos[0].origen === 'http://localhost:8731',
      'y trae el origen, que es lo que hay que cargar en el panel: ' +
      (avisos[0] || {}).origen);

    await espera(1200);
    ok(avisos.length === 1, 'y avisa UNA sola vez, no en cada vuelta del reloj');
  }

  console.log('\n== Si la sesión llega, no avisa nada ==');
  {
    const { N, ctx, ventana } = armar();
    const avisos = [];
    N.alFallarLogin(d => avisos.push(d));
    N.entrarCon('google');

    /* el caso bueno: la vuelta aterrizó en NUESTRO origen y escribió la sesión */
    ctx.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
    ventana.closed = true;
    await espera(1600);
    ok(avisos.length === 0, 'con sesión guardada no hay aviso: ' + avisos.length);
  }

  console.log('\n== Entrar con la sesión ya iniciada no arma ninguna vigilancia ==');
  {
    const { N, ctx, ventana } = armar();
    ctx.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
    const avisos = [];
    N.alFallarLogin(d => avisos.push(d));
    N.entrarCon('google');
    ventana.closed = true;
    await espera(1400);
    ok(avisos.length === 0, 'quien ya tenía sesión y reabre el login no recibe avisos');
  }

  console.log('\n== origenAjeno: la direccion desde la que el login no puede volver ==');
  {
    /* El caso real, y van tres veces que muerde: cada despliegue de Cloudflare
       Pages arma ademas una direccion propia —`a14b47b1.openboq.pages.dev`— que
       sirve la aplicacion igual de bien. Supabase no la tiene autorizada, asi
       que manda la sesion al Site URL: la ventana emergente se queda con la
       sesion y la que lanzo el login sigue como invitada, sin ningun mensaje. */
    const oficial = 'https://openboq.pages.dev';

    ok(armar(oficial).N.origenAjeno() === null,
      'en la direccion oficial no avisa nada');
    ok(armar('https://a14b47b1.openboq.pages.dev').N.origenAjeno() === oficial,
      'en la direccion de un despliegue devuelve la oficial, para poder avisar');
    ok(armar('http://localhost:8731').N.origenAjeno() === null,
      'en localhost se calla: esa direccion se carga a mano en el panel');
    ok(armar('http://127.0.0.1:8731').N.origenAjeno() === null,
      'y en 127.0.0.1 tambien');
  }

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nsin fallos');
  process.exit(fallos ? 1 : 0);
})();
