/* NUBE.alEntrar: avisa cuando alguien ENTRA, no cuando HAY sesión.

   Esta prueba existe por un bug que dejó la aplicación inutilizable. El
   aviso se disparaba con solo encontrar un token guardado, y quien lo
   escucha recarga la página: al arrancar con la sesión ya iniciada,
   arrancaba → veía el token → recargaba → arrancaba… sin parar.

   La distinción es sutil y por eso se prueba: «hay sesión» es un estado y
   «entró» es una transición. El aviso es de lo segundo.

   No toca la red: solo el manejo de sesión contra un localStorage simulado. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

/** Un entorno de navegador nuevo, con lo que haya en localStorage. */
function armar(sesionGuardada) {
  const guardado = {};
  if (sesionGuardada) guardado['openboq_sesion'] = JSON.stringify(sesionGuardada);
  const oyentes = {};
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
    location: { origin: 'http://x', pathname: '/', hash: '', search: '' },
    history: { replaceState() { } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.addEventListener = (t, f) => { (oyentes[t] = oyentes[t] || []).push(f); };
  ctx.disparar = (t, e) => (oyentes[t] || []).forEach(f => f(e));
  vm.createContext(ctx);
  ['js/nube-config.js', 'js/nube.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f }));
  return { N: vm.runInContext('NUBE', ctx), ctx };
}

const SESION = { access_token: 'tok', refresh_token: 'ref', user: null };
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== Arrancar CON sesión guardada no dispara el aviso ==');
  {
    const { N, ctx } = armar(SESION);
    let avisos = 0;
    N.alEntrar(() => avisos++);
    await espera(2600);          // más que dos vueltas del reloj de respaldo
    ok(avisos === 0, 'con la sesión ya guardada, ningún aviso: ' + avisos +
      ' (si fuera >0, la aplicación quedaría recargando sin parar)');
    /* y tampoco lo dispara un evento suelto de otra pestaña */
    ctx.disparar('storage', { key: 'openboq_sesion', newValue: JSON.stringify(SESION) });
    await espera(100);
    ok(avisos === 0, 'ni siquiera si otra pestaña reescribe la misma sesión');
  }

  console.log('\n== Arrancar SIN sesión y entrar después sí avisa ==');
  {
    const { N, ctx } = armar(null);
    let avisos = 0;
    N.alEntrar(() => avisos++);
    await espera(300);
    ok(avisos === 0, 'antes de entrar, nada');
    ctx.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
    ctx.disparar('message', { origin: 'http://x', data: { openboq: 'sesion' } });
    await espera(100);
    ok(avisos === 1, 'al entrar, un aviso');
    ctx.disparar('message', { origin: 'http://x', data: { openboq: 'sesion' } });
    ctx.disparar('storage', { key: 'openboq_sesion', newValue: 'x' });
    await espera(1400);
    ok(avisos === 1, 'y uno solo, aunque lleguen los tres caminos: ' + avisos);
  }

  console.log('\n== El reloj de respaldo avisa si no llega ni mensaje ni evento ==');
  {
    const { N, ctx } = armar(null);
    let avisos = 0;
    N.alEntrar(() => avisos++);
    ctx.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));   // sin avisar
    await espera(1600);
    ok(avisos === 1, 'el reloj lo detecta solo: ' + avisos);
  }

  console.log('\n== Un mensaje de otro sitio se ignora ==');
  {
    const { N, ctx } = armar(null);
    let avisos = 0;
    N.alEntrar(() => avisos++);
    ctx.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
    ctx.disparar('message', { origin: 'http://malo', data: { openboq: 'sesion' } });
    await espera(100);
    ok(avisos === 0, 'de otro origen, no se acepta');
  }

  console.log('\n' + (fallos ? 'PROBLEMAS: ' + fallos : 'SESIÓN OK'));
  process.exit(fallos ? 1 : 0);
})();
