/* DRIVE.carpeta(): qué pasa cuando la carpeta recordada ya no sirve.

   Esta prueba existe por un fallo que llegó a un usuario real. El id de la
   carpeta se guarda en el navegador para no buscarla por nombre en cada
   arranque. Cuando ese id deja de valer, `carpeta()` lo borra de
   localStorage — pero NO limpiaba la variable, así que el `if (!id)` de más
   abajo daba falso, no se creaba ninguna carpeta y se devolvía el id que
   acababa de fallar. El guardado moría con:

       Drive 404 · File not found: 1qtgUivN_gSn7zcpUZxIqBHe12scinZx8

   y no había forma de salir, porque el id ya no estaba en localStorage para
   volver a limpiarlo. Dos caminos normales llegan ahí:

     · el usuario borró la carpeta «OpenBOQ» desde su propio Drive;
     · OTRA cuenta de Google entró en el mismo navegador y heredó el id de un
       Drive ajeno — con el alcance `drive.file` ese id ni siquiera se puede
       mirar, así que Drive contesta 404.

   No toca la red ni abre ventanas: `fetch` y `window.open` están simulados.
   La ventana falsa contesta con un token, que es lo que deja ejercitar el
   camino real de `autorizar()` sin depender de Google.                      */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const CARPETA_VIEJA = '1qtgUivN_gSn7zcpUZxIqBHe12scinZx8';   // el id real del reporte
const CARPETA_NUEVA = 'CARPETA_NUEVA_999';

/**
 * Navegador simulado.
 * @param {Object} guardado    lo que ya hay en localStorage
 * @param {Function} responder (url, opciones) -> {ok, status, cuerpo}
 */
function armar(guardado, responder) {
  const pedidos = [];
  const oyentes = {};

  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, Error,
    URLSearchParams, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; } },
    localStorage: {
      _d: Object.assign({}, guardado),
      getItem(k) { return this._d[k] ?? null },
      setItem(k, v) { this._d[k] = String(v) },
      removeItem(k) { delete this._d[k] }
    },
    location: { origin: 'https://openboq.pages.dev', pathname: '/' },
    fetch: (url, o) => {
      pedidos.push({ url, metodo: (o && o.method) || 'GET' });
      const r = responder(url, o);
      return Promise.resolve({
        ok: r.ok !== false,
        status: r.status || 200,
        json: () => Promise.resolve(r.cuerpo || {}),
        text: () => Promise.resolve(JSON.stringify(r.cuerpo || {}))
      });
    }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); };
  ctx.removeEventListener = (t, f) => {
    oyentes[t] = (oyentes[t] || []).filter(x => x !== f);
  };

  /* La ventana de Google, simulada: devuelve el token enseguida, como haría
     `prompt=none` con el permiso ya dado. */
  ctx.open = url => {
    const estado = new URLSearchParams(String(url).split('?')[1] || '').get('state');
    setTimeout(() => {
      (oyentes.message || []).slice().forEach(f => f({
        origin: ctx.location.origin,
        data: { openboq: 'drive', state: estado, access_token: 'TOKEN_DE_PRUEBA', expires_in: 3600 }
      }));
    }, 5);
    return { closed: false, focus() { }, close() { } };
  };

  vm.createContext(ctx);
  ['js/nube-config.js', 'js/drive.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));

  return { D: vm.runInContext('DRIVE', ctx), ctx, pedidos };
}

/** Contesta como Drive: la carpeta vieja no existe, la búsqueda no encuentra
    nada, y crear devuelve una carpeta nueva. */
function comoDrive(url, o) {
  if (url.indexOf('/files/' + CARPETA_VIEJA) >= 0)
    return {
      ok: false, status: 404,
      cuerpo: { error: { code: 404, message: 'File not found: ' + CARPETA_VIEJA } }
    };
  if (url.indexOf('/files?q=') >= 0) return { cuerpo: { files: [] } };
  if ((o && o.method) === 'POST') return { cuerpo: { id: CARPETA_NUEVA } };
  return { cuerpo: {} };
}

const OP = { auth: { interactivo: true, correo: 'alguien@gmail.com' } };

(async () => {
  console.log('== La carpeta recordada ya no existe: se crea otra ==');
  {
    const { D, ctx } = armar({ openboq_drive_carpeta: CARPETA_VIEJA }, comoDrive);
    let id = null, error = null;
    try { id = await D.carpeta(OP); } catch (e) { error = e; }

    ok(!error, 'no revienta: ' + (error ? error.message : 'sin error'));
    ok(id === CARPETA_NUEVA, 'devuelve la carpeta NUEVA: ' + id);
    ok(id !== CARPETA_VIEJA, 'y NO el id que acababa de dar 404 — ese era el fallo');
    ok(ctx.localStorage.getItem('openboq_drive_carpeta') === CARPETA_NUEVA,
      'deja recordada la nueva');
  }

  console.log('\n== Si la carpeta recordada sirve, no se toca nada ==');
  {
    const { D, pedidos } = armar({ openboq_drive_carpeta: 'BUENA_1' },
      url => url.indexOf('/files/BUENA_1') >= 0
        ? { cuerpo: { id: 'BUENA_1', trashed: false } }
        : { cuerpo: {} });
    const id = await D.carpeta(OP);
    ok(id === 'BUENA_1', 'devuelve la que ya estaba: ' + id);
    ok(!pedidos.some(p => p.metodo === 'POST'), 'y no crea ninguna carpeta de más');
  }

  console.log('\n== Otra cuenta en el mismo navegador no hereda la carpeta ==');
  {
    /* El id se guarda por NAVEGADOR. Sin la limpieza al cambiar de cuenta, la
       segunda persona que entra en el mismo equipo se lleva el id del Drive de
       la primera — y con `drive.file` ni siquiera puede mirarlo: 404. */
    const { D, ctx } = armar({
      openboq_drive_carpeta: CARPETA_VIEJA,
      openboq_drive_cuenta: 'primera@gmail.com'
    }, comoDrive);

    await D.autorizar({ interactivo: true, correo: 'segunda@gmail.com' });

    ok(ctx.localStorage.getItem('openboq_drive_cuenta') === 'segunda@gmail.com',
      'queda anotada la cuenta nueva');
    ok(!ctx.localStorage.getItem('openboq_drive_carpeta'),
      'y la carpeta de la cuenta anterior NO sobrevive al cambio');

    const id = await D.carpeta(OP);
    ok(id === CARPETA_NUEVA, 'la cuenta nueva termina con su propia carpeta: ' + id);
  }

  console.log('\n== La misma cuenta conserva su carpeta ==');
  {
    const { D, ctx } = armar({
      openboq_drive_carpeta: 'BUENA_1',
      openboq_drive_cuenta: 'primera@gmail.com'
    }, url => url.indexOf('/files/BUENA_1') >= 0
      ? { cuerpo: { id: 'BUENA_1', trashed: false } }
      : { cuerpo: {} });

    await D.autorizar({ interactivo: true, correo: 'primera@gmail.com' });
    ok(ctx.localStorage.getItem('openboq_drive_carpeta') === 'BUENA_1',
      'volver a autorizar con la MISMA cuenta no tira la carpeta');
  }

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nsin fallos');
  process.exit(fallos ? 1 : 0);
})();
