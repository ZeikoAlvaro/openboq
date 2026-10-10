/* La sesión de la cuenta no se pierde sola al renovarse.

   POR QUÉ EXISTE ESTA PRUEBA. Medido en `auth.sessions` el 10/10/2026: el
   servidor nunca vence una sesión por tiempo, y aun así los usuarios
   «se desconectaban a los días». La renovación del token tenía tres huecos:
   solo renovaba después de un 401, no miraba si otra pestaña ya había
   renovado (Supabase rota el refresh token y, si el viejo se reusa, anula la
   sesión entera) y no distinguía «sin red» de «la sesión ya no vale».

   Lo que se fija:
     · con el token vencido se renueva ANTES de pedir, una sola vez aunque
       haya varios pedidos a la par;
     · si otra pestaña ya renovó, se toma su sesión y no se gasta el token;
     · un 400 al renovar cierra la sesión y avisa;
     · sin red, la sesión se CONSERVA.

   No toca la red: `fetch` está simulado.                                    */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

const LS = 'openboq_sesion';
const ahora = () => Math.floor(Date.now() / 1000);
const USUARIO = { id: 'u-1', email: 'alguien@gmail.com', user_metadata: {} };
const sesion = (rt, vence) => ({ access_token: 'AT-' + rt, refresh_token: rt, expires_at: vence, user: USUARIO });

/** Un navegador con lo que haya en localStorage y un servidor de mentira. */
function armar(guardada, servidor) {
  const d = {};
  if (guardada) d[LS] = JSON.stringify(guardada);
  const pedidos = [];
  const ctx = {
    console, JSON, Math, Date, Number, String, Object, Array, Boolean, Error, Promise,
    URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: {
      _d: d,
      getItem(k) { return this._d[k] ?? null },
      setItem(k, v) { this._d[k] = String(v) },
      removeItem(k) { delete this._d[k] }
    },
    navigator: { onLine: true, userAgent: 'prueba', language: 'es' },
    location: { origin: 'https://openboq.pages.dev', pathname: '/', hash: '', search: '' },
    history: { replaceState() { } },
    fetch: (url, o) => {
      pedidos.push({ url: String(url), cuerpo: o && o.body });
      return servidor(String(url), o || {});
    }
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.addEventListener = () => { };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/nube-config.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/nube.js'), 'utf8'), ctx);
  return { N: vm.runInContext('NUBE', ctx), ctx, pedidos };
}

const resp = (status, obj) => Promise.resolve({
  ok: status >= 200 && status < 300, status,
  text: () => Promise.resolve(JSON.stringify(obj))
});

/** Servidor que renueva bien y responde [] a todo lo demás. */
const servidorBueno = (url, o) => /grant_type=refresh_token/.test(url)
  ? new Promise(r => setTimeout(() => r(resp(200, sesion('RT-NUEVO', ahora() + 3600))), 10))
  : resp(200, []);

const renovaciones = p => p.filter(x => /grant_type=refresh_token/.test(x.url)).length;

(async () => {
  console.log('== Token vencido: se renueva antes de pedir, una sola vez ==');
  {
    const { N, ctx, pedidos } = armar(sesion('RT-VIEJO', ahora() - 10), servidorBueno);
    await Promise.all([N.listarProyectos(), N.listarProyectos(), N.listarProyectos()]);
    ok(renovaciones(pedidos) === 1, 'tres pedidos a la par, una renovación: ' + renovaciones(pedidos));
    ok(JSON.parse(pedidos[0].cuerpo).refresh_token === 'RT-VIEJO', 'con el refresh token guardado');
    const g = JSON.parse(ctx.localStorage.getItem(LS));
    ok(g.refresh_token === 'RT-NUEVO', 'la sesión nueva quedó guardada');
    const datos = pedidos.filter(x => !/grant_type/.test(x.url));
    ok(datos.length === 3 && pedidos.indexOf(datos[0]) > 0, 'y los pedidos salen DESPUÉS de renovar');
  }

  console.log('\n== Otra pestaña ya renovó: se toma su sesión ==');
  {
    const { N, ctx, pedidos } = armar(sesion('RT-VIEJO', ahora() - 10), servidorBueno);
    /* La otra pestaña escribió sin que esta se enterara (sin evento). */
    ctx.localStorage._d[LS] = JSON.stringify(sesion('RT-DE-LA-OTRA', ahora() + 3000));
    await N.listarProyectos();
    ok(renovaciones(pedidos) === 0, 'no gasta el refresh token viejo — eso anulaba la sesión');
    ok(JSON.parse(ctx.localStorage.getItem(LS)).refresh_token === 'RT-DE-LA-OTRA', 'usa la de la otra pestaña');
  }

  console.log('\n== La sesión ya no vale: se cierra y se avisa ==');
  {
    let avisado = 0;
    const { N, ctx } = armar(sesion('RT-MUERTO', ahora() - 10), url =>
      /grant_type/.test(url) ? resp(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }) : resp(200, []));
    N.alVencerSesion(() => { avisado++; });
    let fallo = null;
    try { await N.listarProyectos(); } catch (e) { fallo = e; }
    ok(!!fallo, 'el pedido falla');
    ok(!ctx.localStorage.getItem(LS), 'la sesión muerta se saca del navegador');
    ok(avisado === 1, 'y la interfaz se entera');
    ok(!N.conectado(), 'ya no figura como conectado');
  }

  console.log('\n== Sin red: la sesión se conserva ==');
  {
    let avisado = 0;
    const { N, ctx } = armar(sesion('RT-BUENO', ahora() - 10), () => Promise.reject(new Error('Failed to fetch')));
    N.alVencerSesion(() => { avisado++; });
    try { await N.listarProyectos(); } catch (e) { }
    ok(JSON.parse(ctx.localStorage.getItem(LS) || 'null')?.refresh_token === 'RT-BUENO', 'sigue guardada');
    ok(avisado === 0, 'sin avisos falsos');
    ok(N.conectado(), 'sigue conectado');
  }

  console.log('\n== Token vigente: no se renueva nada ==');
  {
    const { N, pedidos } = armar(sesion('RT-BUENO', ahora() + 3000), servidorBueno);
    await N.listarProyectos();
    ok(renovaciones(pedidos) === 0, 'cero renovaciones');
  }

  console.log('\n== Sesión vieja sin expires_at: el vencimiento sale del JWT ==');
  {
    const jwt = 'x.' + Buffer.from(JSON.stringify({ exp: ahora() - 10 })).toString('base64') + '.y';
    const vieja = { access_token: jwt, refresh_token: 'RT-VIEJO', user: USUARIO };
    const { N, pedidos } = armar(vieja, servidorBueno);
    await N.listarProyectos();
    ok(renovaciones(pedidos) === 1, 'lo ve vencido y renueva');
  }

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nsin fallos');
  process.exit(fallos ? 1 : 0);
})();
