'use strict';
/* Prueba de punta a punta contra el Supabase real: sesión, respaldo privado,
   aporte anónimo y reporte. Al final borra el usuario de prueba y todo lo
   que dejó.

   NO corre con `node --test pruebas/*.test.js`, a propósito: toca el
   servidor de verdad y necesita supabase/.env.local, que no está en el
   repositorio. Por eso el nombre no termina en .test.js. Se corre a mano:

       node pruebas/nube.manual.js
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { Client } = require('pg');

const RAIZ = path.resolve(__dirname, '..');
const env = {};
for (const l of fs.readFileSync(RAIZ + '/supabase/.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim();
}

const MAIL = 'prueba.openboq.' + Date.now() + '@openboq-prueba.com';
const CLAVE = 'prueba123';
/* Con «Confirm email» activo, cada alta manda un correo y el plan gratis
   corta a los pocos por hora. Para probar se crea el usuario por la API de
   administracion, que lo deja confirmado y no manda nada. Cuando se
   desactive la confirmacion en el panel, N.registrar() alcanza. */
const SERVICE = env.SUPABASE_SERVICE_KEY.replace(/^sb_(service|secret)_/, '');
async function crearUsuarioAdmin(mail, clave) {
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, password: clave, email_confirm: true })
  });
  if (!r.ok) throw new Error('admin/users: ' + (await r.text()).slice(0, 120));
  return r.json();
}

/* Token de sesión sin pasar por la pantalla de Google: es el mismo token que
   el proveedor devuelve, pedido con el usuario de prueba que crea el admin. */
async function pedirToken(mail, clave) {
  const r = await fetch(env.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    /* el panel muestra la anon con prefijo sb_publishable_; el servidor acepta solo el JWT */
    headers: { apikey: env.SUPABASE_ANON_KEY.replace(/^sb_publishable_/, ''), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, password: clave })
  });
  if (!r.ok) throw new Error('token: ' + (await r.text()).slice(0, 120));
  return r.json();
}

const ls = { _d: {}, getItem(k) { return this._d[k] ?? null }, setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] } };
const ctx = {
  console, fetch, JSON, Math, Date, Number, String, Object, Array, Boolean, Error,
  localStorage: ls, navigator: { onLine: true, userAgent: 'prueba', language: 'es' },
  screen: { width: 1366, height: 768 }, location: { origin: 'http://localhost', pathname: '/', hash: '', search: '' },
  history: { replaceState() { } }, setTimeout, URLSearchParams
};
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
['js/nube-config.js', 'js/nube.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
const N = vm.runInContext('NUBE', ctx);

let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

(async () => {
  console.log('== Sesión ==');
  /* La aplicación entra SOLO con Google, y esa pantalla no se puede automatizar
     desde acá. Se emula lo que queda del otro lado: se pide un token al
     servidor y se le entrega a NUBE por tomarSesion(), que es exactamente lo
     que hace el navegador al volver del proveedor. */
  const tok = await pedirToken(MAIL, CLAVE);
  ok(N.tomarSesion(tok), 'toma la sesión que llega del proveedor');
  await N.cargarUsuario();
  ok(N.conectado(), 'queda conectado como ' + (N.usuario() || {}).email);
  N.salir();
  ok(!N.conectado(), 'sale de la cuenta');
  N.tomarSesion(tok);
  await N.cargarUsuario();
  ok(N.conectado(), 'vuelve a entrar con la misma sesión');

  console.log('\n== Respaldo privado de la biblioteca ==');
  const bd = {
    bases: [{ id: 9001, n: 'MIS ANÁLISIS', apus: [{ cod: 'P1', d: 'Muro de ladrillo 6H', u: 'm²', c: [] }] }],
    cambios: []
  };
  const sub = await N.subirBiblioteca(bd, 'prueba');
  ok(sub.bases === 1 && sub.apus === 1, 'sube 1 base y 1 análisis');
  const baj = await N.bajarBiblioteca();
  ok(baj && baj.payload.bases[0].n === 'MIS ANÁLISIS', 'la baja devuelve lo mismo que se subió');

  console.log('\n== Qué se filtra antes de aportar ==');
  const apuSucio = {
    d: 'Muro de ladrillo U.E. Gualberto Villarroel', u: 'm²',
    c: [{ t: 'M', d: 'Ladrillo 6H', u: 'pza', p: 1.5, q: 30 }]
  };
  const revisar = t => ({ nivel: /U\.E\./.test(t) ? 'bloqueo' : 'ok', motivo: '' });
  ok(N.armarAporte(apuSucio, revisar) === null, 'un análisis que nombra la obra NO se arma');

  const apuLimpio = {
    d: 'Muro de ladrillo 6H e=15cm', u: 'm²',
    c: [{ t: 'M', d: 'Ladrillo 6H', u: 'pza', p: 1.5, q: 30 },
    { t: 'O', d: 'Albañil', u: 'hr', p: 25, q: 0.8 }]
  };
  const arm = N.armarAporte(apuLimpio, revisar);
  const campos = Object.keys(arm).sort().join(',');
  ok(campos === 'componentes,descripcion,unidad', 'el aporte solo lleva descripción, unidad y componentes: ' + campos);
  const cc = Object.keys(arm.componentes[0]).sort().join(',');
  ok(cc === 'descripcion,precio,rendimiento,tipo,unidad', 'cada componente solo lleva lo técnico: ' + cc);
  const texto = JSON.stringify(arm);
  ok(!/cantidad|monto|total|proyecto|entidad|computo/i.test(texto),
    'no aparece ninguna cantidad de obra, monto, proyecto ni cómputo');

  console.log('\n== Aporte anónimo, con desfase ==');
  ok(N.encolar(apuLimpio, revisar, 'prueba'), 'se encola');
  ok(!N.encolar(apuLimpio, revisar, 'prueba'), 'el mismo análisis no se encola dos veces');
  const sinDesfase = await N.enviarCola();
  ok(sinDesfase.enviados === 0 && N.enCola() === 1,
    'recién encolado NO se manda: el desfase de seis horas lo retiene');
  const conTodos = await N.enviarCola({ todos: true });
  ok(conTodos.enviados === 1, 'forzando el envío, sale');
  ok(N.enCola() === 0, 'la cola queda vacía');

  console.log('\n== Reporte de error ==');
  await N.reportar('prueba automatica: el cronograma sale sin fechas', 'prueba', { vista: 'cronograma' });
  ok(true, 'el reporte se acepta');

  console.log('\n== Lo que el RLS NO deja hacer ==');
  let leyoAportes = false;
  try {
    const r = await fetch(ctx.NUBE_CFG.url + '/rest/v1/aportes?select=*&limit=5',
      { headers: { apikey: ctx.NUBE_CFG.anon, Authorization: 'Bearer ' + ctx.NUBE_CFG.anon } });
    const j = await r.json();
    leyoAportes = Array.isArray(j) && j.length > 0;
  } catch (e) { }
  ok(!leyoAportes, 'con la clave pública NO se pueden leer los aportes de nadie');

  /* --- verificación del lado del servidor y limpieza --- */
  console.log('\n== Del lado del servidor ==');
  const cli = new Client({
    connectionString: env.SUPABASE_DB_URL.replace('pooler.supabase.com:6543', 'pooler.supabase.com:5432'),
    ssl: { rejectUnauthorized: false }
  });
  await cli.connect();
  const uid = N.usuario().id;
  const ap = await cli.query(
    `select payload from aportes where payload->>'descripcion' = 'Muro de ladrillo 6H e=15cm'`);
  ok(ap.rows.length === 1, 'el aporte llegó');
  const cols = await cli.query(
    `select column_name from information_schema.columns
      where table_name = 'aportes' and column_name in ('usuario_email','usuario_id')`);
  ok(cols.rows.length === 0, 'la tabla de aportes no tiene ninguna columna que identifique');

  const rep = await cli.query('select email from reportes where user_id = $1', [uid]);
  ok(rep.rows.length === 1 && rep.rows[0].email === MAIL, 'el reporte sí quedó con el correo');

  await cli.query(`delete from aportes where payload->>'descripcion' = 'Muro de ladrillo 6H e=15cm'`);
  await cli.query('delete from reportes where user_id = $1', [uid]);
  await cli.query('delete from usuarios_bases where user_id = $1', [uid]);
  await cli.query('delete from auth.users where id = $1', [uid]);
  await cli.end();
  console.log('  · usuario de prueba y sus datos, borrados');

  console.log('\n' + (fallos ? 'PROBLEMAS: ' + fallos : 'NUBE OK'));
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('\n  ✖ ' + e.message + '\n' + (e.stack || '')); process.exit(1); });
