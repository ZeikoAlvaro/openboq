/* El Drive queda conectado: refresh token en el navegador, canje en el Worker.

   POR QUÉ EXISTE ESTA PRUEBA. Con el flujo implícito el Drive «se cerraba»
   cada hora y al cerrar la pestaña. Decisión del 10/10/2026 (opción B): el
   permiso se pide una vez con flujo de código + PKCE, el Worker
   drive-canje/ lo canjea con el client_secret, y el refresh token vuelve a
   ESTE navegador. Lo que se fija:

     · la primera vez: UNA ventana, con `code`, `offline`, `consent` y el
       desafío PKCE; el canje lleva el verificador; queda el refresh token
       atado a la cuenta;
     · una pestaña nueva (sin sessionStorage) arranca autorizada y renueva
       SIN ventana, una sola vez aunque haya pedidos a la par;
     · si Google dice que el permiso ya no vale, el refresh token se tira;
     · el refresh token de otra cuenta no se usa;
     · `desconectar()` no deja nada.

   No toca la red: `fetch` y `window.open` están simulados.                  */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const LS_RT = 'openboq_drive_rt';
const CORREO = 'alguien@gmail.com';

function almacen(inicial) {
  return {
    _d: Object.assign({}, inicial || {}),
    getItem(k) { return this._d[k] ?? null },
    setItem(k, v) { this._d[k] = String(v) },
    removeItem(k) { delete this._d[k] }
  };
}

/** Una pestaña con el Worker simulado. `renovar` decide qué contesta /renovar. */
function cargar(ls, renovar) {
  const ventanas = [], canjes = [];
  const oyentes = {};
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, Error, Uint8Array,
    URLSearchParams, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, crypto: webcrypto,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    localStorage: ls,
    sessionStorage: almacen(),
    location: { origin: 'https://openboq.pages.dev', pathname: '/' },
    fetch: (url, o) => {
      const u = String(url);
      const cuerpo = o && o.body ? JSON.parse(o.body) : null;
      const r = (status, d) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(d), text: () => Promise.resolve(JSON.stringify(d)) });
      if (/\/canje$/.test(u)) { canjes.push({ ruta: 'canje', cuerpo }); return r(200, { access_token: 'AT-1', expires_in: 3599, refresh_token: 'RT-1' }); }
      if (/\/renovar$/.test(u)) {
        canjes.push({ ruta: 'renovar', cuerpo });
        return new Promise(res => setTimeout(() => res(renovar ? renovar(r) : r(200, { access_token: 'AT-REN', expires_in: 3599 })), 10));
      }
      return r(200, { files: [] });
    }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); };
  ctx.removeEventListener = (t, f) => { oyentes[t] = (oyentes[t] || []).filter(x => x !== f); };
  ctx.open = url => {
    ventanas.push(String(url));
    const q = new URLSearchParams(String(url).split('?')[1] || '');
    setTimeout(() => (oyentes.message || []).slice().forEach(f => f({
      origin: ctx.location.origin,
      data: q.get('response_type') === 'code'
        ? { openboq: 'drive', state: q.get('state'), code: 'CODIGO' }
        : { openboq: 'drive', state: q.get('state'), access_token: 'AT-IMPLICITO', expires_in: 3600 }
    })), 5);
    return { closed: false, focus() { }, close() { } };
  };
  vm.createContext(ctx);
  ['js/nube-config.js', 'js/drive.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
  return { D: vm.runInContext('DRIVE', ctx), ventanas, canjes };
}

const tic = () => new Promise(r => setTimeout(r, 30));   // PKCE se arma asíncrono

(async () => {
  console.log('== Primera vez: una ventana de código y el refresh token queda ==');
  const ls = almacen();
  {
    const { D, ventanas, canjes } = cargar(ls);
    await tic();
    const at = await D.autorizar({ interactivo: true, correo: CORREO });
    ok(at === 'AT-1', 'devuelve el token del canje: ' + at);
    ok(ventanas.length === 1, 'una sola ventana');
    const q = new URLSearchParams(ventanas[0].split('?')[1]);
    ok(q.get('response_type') === 'code' && q.get('access_type') === 'offline' &&
       q.get('prompt') === 'consent', 'pide código, offline y consentimiento');
    ok(q.get('code_challenge_method') === 'S256' && !!q.get('code_challenge'), 'con desafío PKCE');
    ok(canjes[0].cuerpo.code === 'CODIGO' && canjes[0].cuerpo.code_verifier &&
       canjes[0].cuerpo.redirect_uri === 'https://openboq.pages.dev/drive.html', 'el canje lleva código, verificador y retorno');
    const g = JSON.parse(ls.getItem(LS_RT));
    ok(g.rt === 'RT-1' && g.cuenta === CORREO, 'refresh token guardado con su cuenta');
    ok(D.estado().permanente, 'estado: permanente');
  }

  console.log('\n== Pestaña nueva: autorizada y renueva sin ventana, una vez ==');
  {
    const { D, ventanas, canjes } = cargar(ls);
    ok(D.estado().autorizado, 'arranca autorizada aunque no haya token de la hora');
    const [a, b] = await Promise.all([D.autorizar(), D.autorizar()]);
    ok(a === 'AT-REN' && b === 'AT-REN', 'los dos pedidos reciben el token renovado');
    ok(canjes.filter(c => c.ruta === 'renovar').length === 1, 'una sola renovación');
    ok(ventanas.length === 0, 'cero ventanas — esto es lo que el usuario veía cerrarse');
    ok(canjes[0].cuerpo.refresh_token === 'RT-1', 'con el refresh token guardado');
  }

  console.log('\n== Permiso quitado en Google: el refresh token se tira ==');
  {
    const ls2 = almacen({ [LS_RT]: JSON.stringify({ rt: 'RT-MUERTO', cuenta: CORREO }) });
    const { D } = cargar(ls2, r => r(400, { error: 'invalid_grant' }));
    await D.autorizar({ correo: CORREO }).catch(() => null);
    ok(!ls2.getItem(LS_RT), 'ya no está');
    ok(!D.estado().permanente, 'y no se pinta como permanente');
  }

  console.log('\n== Sin red: el refresh token se conserva ==');
  {
    const ls3 = almacen({ [LS_RT]: JSON.stringify({ rt: 'RT-BUENO', cuenta: CORREO }) });
    const { D } = cargar(ls3, () => Promise.reject(new Error('Failed to fetch')));
    let fallo = null;
    try { await D.autorizar({ correo: CORREO }); } catch (e) { fallo = e; }
    ok(!!fallo, 'el pedido falla');
    ok(!!ls3.getItem(LS_RT), 'pero el permiso sigue guardado');
  }

  console.log('\n== El refresh token de otra cuenta no se usa ==');
  {
    const ls4 = almacen({ [LS_RT]: JSON.stringify({ rt: 'RT-AJENO', cuenta: 'otra@gmail.com' }) });
    const { D, canjes } = cargar(ls4);
    await tic();
    await D.autorizar({ interactivo: true, correo: CORREO });
    ok(!canjes.some(c => c.cuerpo && c.cuerpo.refresh_token === 'RT-AJENO'), 'no se mandó a renovar');
    ok(JSON.parse(ls4.getItem(LS_RT)).cuenta === CORREO, 'queda el de la cuenta que entró');
  }

  console.log('\n== desconectar() no deja nada ==');
  {
    const { D } = cargar(ls);
    D.desconectar();
    ok(!ls.getItem(LS_RT) && !ls.getItem('openboq_drive_cuenta'), 'sin refresh token ni cuenta');
    ok(!D.estado().autorizado && !D.estado().recordado, 'estado limpio');
  }

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nsin fallos');
  process.exit(fallos ? 1 : 0);
})();
