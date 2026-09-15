/* El token de Drive sobrevive a la recarga de la página.

   POR QUÉ EXISTE ESTA PRUEBA. El token de Drive vivía SOLO en una variable
   del módulo. La sesión de Google no: Supabase la guarda en localStorage, así
   que al recargar la aplicación quedaba «con la sesión iniciada» pero «sin
   Drive», y había que apretar «Conectar con mi Drive» después de cada F5.
   Reconectar a mano no protegía de nada — el permiso de Google ya estaba
   dado— y molestaba en cada recarga.

   El token de acceso pasó entonces a `sessionStorage`: sobrevive a la recarga
   de la pestaña y muere al cerrarla. Lo que esta prueba fija:

     · una recarga con el token todavía vigente NO pide nada a Google;
     · un token vencido en el almacén se descarta, en vez de pintar la
       interfaz como conectada y reventar en el primer pedido a Drive;
     · sin `sessionStorage` —el almacenamiento bloqueado, o el banco de
       pruebas— el módulo sigue andando como antes, solo en memoria.

   No toca la red: `fetch` y `window.open` están simulados.                  */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const SS = 'openboq_drive_token';

/** Un almacén de los dos, con la misma cara que el del navegador. */
function almacen(inicial) {
  return {
    _d: Object.assign({}, inicial || {}),
    getItem(k) { return this._d[k] ?? null },
    setItem(k, v) { this._d[k] = String(v) },
    removeItem(k) { delete this._d[k] }
  };
}

/**
 * Carga el módulo como lo cargaría una pestaña.
 *
 * `ss` se pasa entre cargas para simular la RECARGA: el mismo almacén de
 * sesión, un módulo nuevo. `ss = null` es el navegador sin sessionStorage.
 */
function cargar(ls, ss) {
  const ventanas = [];
  const oyentes = {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, Error,
    URLSearchParams, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; } },
    localStorage: ls,
    location: { origin: 'https://openboq.pages.dev', pathname: '/' },
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ files: [] }),
      text: () => Promise.resolve('{}')
    })
  };
  if (ss) ctx.sessionStorage = ss;
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); };
  ctx.removeEventListener = (t, f) => { oyentes[t] = (oyentes[t] || []).filter(x => x !== f); };
  ctx.open = url => {
    ventanas.push(String(url));
    const estado = new URLSearchParams(String(url).split('?')[1] || '').get('state');
    setTimeout(() => {
      (oyentes.message || []).slice().forEach(f => f({
        origin: ctx.location.origin,
        data: { openboq: 'drive', state: estado, access_token: 'TOKEN_NUEVO', expires_in: 3600 }
      }));
    }, 5);
    return { closed: false, focus() { }, close() { } };
  };

  vm.createContext(ctx);
  ['js/nube-config.js', 'js/drive.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));

  return { D: vm.runInContext('DRIVE', ctx), ctx, ventanas };
}

const CUENTA = { openboq_drive_cuenta: 'alguien@gmail.com' };

(async () => {
  console.log('== Autorizar deja el token en sessionStorage ==');
  const ls = almacen(CUENTA);
  const ss = almacen();
  {
    const { D, ventanas } = cargar(ls, ss);
    const at = await D.autorizar({ interactivo: true, correo: 'alguien@gmail.com' });
    ok(at === 'TOKEN_NUEVO', 'devuelve el token: ' + at);
    ok(ventanas.length === 1, 'abrió una sola ventana');
    const g = JSON.parse(ss.getItem(SS) || 'null');
    ok(g && g.at === 'TOKEN_NUEVO', 'el token quedó anotado en la pestaña');
    ok(g && g.vence > Date.now(), 'con su vencimiento');
  }

  console.log('\n== La recarga lo recupera sin pedirle nada a Google ==');
  {
    const { D, ventanas } = cargar(ls, ss);        // misma pestaña, módulo nuevo
    ok(D.estado().autorizado, 'arranca ya autorizado — esto era el fallo');
    const at = await D.autorizar({ interactivo: true });
    ok(at === 'TOKEN_NUEVO', 'reusa el token guardado');
    ok(ventanas.length === 0, 'y NO abre ninguna ventana');
  }

  console.log('\n== Un token vencido no se usa ==');
  {
    const viejo = almacen({
      [SS]: JSON.stringify({ at: 'TOKEN_VIEJO', vence: Date.now() - 1000 })
    });
    const { D } = cargar(almacen(CUENTA), viejo);
    ok(!D.estado().autorizado, 'no se pinta como conectado');
    ok(!viejo.getItem(SS), 'y el token muerto se limpia del almacén');
    ok(D.estado().recordado, 'pero se recuerda que el permiso ya está dado');
  }

  console.log('\n== Al que nunca conectó no se le promete nada ==');
  {
    const { D } = cargar(almacen(), almacen());
    ok(!D.estado().autorizado && !D.estado().recordado,
      'ni autorizado ni recordado');
  }

  console.log('\n== `olvidar()` también lo saca de la pestaña ==');
  {
    const s2 = almacen();
    const { D } = cargar(almacen(CUENTA), s2);
    await D.autorizar({ interactivo: true, correo: 'alguien@gmail.com' });
    ok(!!s2.getItem(SS), 'estaba guardado');
    D.olvidar();
    ok(!s2.getItem(SS), 'y después de olvidar no queda nada');
  }

  console.log('\n== Sin sessionStorage el módulo sigue andando ==');
  {
    const { D, ventanas } = cargar(almacen(CUENTA), null);
    const at = await D.autorizar({ interactivo: true, correo: 'alguien@gmail.com' });
    ok(at === 'TOKEN_NUEVO', 'autoriza igual: ' + at);
    ok(ventanas.length === 1, 'con su ventana, como antes');
    ok(D.estado().autorizado, 'y queda autorizado en memoria');
  }

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nsin fallos');
  process.exit(fallos ? 1 : 0);
})();
