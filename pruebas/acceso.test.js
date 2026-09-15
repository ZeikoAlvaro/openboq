/* Estado de la conexión y bases de datos propias.

   El estado de la conexión es solo un punto de color: NO bloquea nada.
   Lo único que necesita clave es la Base de Datos de precios, y el usuario
   puede además armar sus propias bases. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = path.join(__dirname, '..');
const errores = [];
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', url: 'https://openboq.local/' });
const w = dom.window;
w.alert = m => errores.push('ALERT: ' + m);
w.confirm = () => true;
['TextEncoder', 'TextDecoder'].forEach(k => { if (!w[k]) w[k] = globalThis[k]; });
/* jsdom define window.crypto como propiedad de solo lectura */
Object.defineProperty(w, 'crypto', {
  value: { subtle: crypto.webcrypto.subtle, getRandomValues: b => crypto.webcrypto.getRandomValues(b) },
  configurable: true, writable: true
});

/* --- servidor simulado --- */
const CODIGO = 'CLAVE-DE-PRUEBA-2026';
const sal = crypto.randomBytes(16);
const ITER = 1000;
const h = crypto.pbkdf2Sync(CODIGO, sal, ITER, 32, 'sha256').toString('hex');
let servidor = {
  ok: true,
  cuerpo: {
    v: 1, revisarMin: 10, toleranciaMin: 45,
    codigos: [{ n: 'probador 1', sal: sal.toString('hex'), it: ITER, h }]
  }
};
w.fetch = async () => {
  if (!servidor.ok) throw new Error('sin red');
  return { ok: true, status: 200, json: async () => servidor.cuerpo };
};

const src = ['data/catalogo.js', 'js/motor.js', 'js/acceso.js',
  'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;window.MOTOR=MOTOR;window.ACCESO=ACCESO;window.REP=REP;';
try { w.eval(src); } catch (e) { console.log('EVAL ERROR', e); process.exit(1); }

const $ = s => w.document.querySelector(s);
const $$ = s => Array.from(w.document.querySelectorAll(s));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errores.push(m); };
const A = w.ACCESO, M = w.MOTOR;
const esperar = ms => new Promise(r => setTimeout(r, ms));
const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const botonModal = t => $$('#modalPie button').find(b => b.textContent.includes(t));

(async () => {

  console.log('== El estado de la conexión es solo un punto de color ==');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await esperar(400);
  const el = $('#stAcceso');
  ok(el.style.display !== 'none', 'el indicador se muestra');
  ok(el.textContent.trim() === '●', 'es un punto, sin texto: «' + el.textContent.trim() + '»');
  ok(!/prueba|probador|min|tolerancia/i.test(el.textContent),
    'no dice nombres de prueba ni tiempos');

  console.log('== Con conexión, el punto va en verde ==');
  A.guardarCodigo(CODIGO);
  await A.verificar(); await esperar(80);
  ok(A.estado().estado === 'activo', 'estado activo');
  ok(A.estado().habilitado, 'y el código figura habilitado en acceso.json');
  ok(/rgb\(30, 158, 74\)|#1e9e4a/.test(el.style.color), 'punto verde: ' + el.style.color);

  console.log('== Sin conexión NO se bloquea nada ==');
  servidor.ok = false;
  w.localStorage.setItem('openboq_ultima_senal', String(Date.now() - 5 * 60 * 60000));
  await A.verificar(); await esperar(120);
  ok(A.estado().estado === 'bloqueado', 'el punto pasa a rojo');
  ok(!w.document.body.classList.contains('sin-acceso'), 'el área de trabajo NO se apaga');
  ok(!$('#overlay').classList.contains('on'), 'no salta ningún aviso');
  const btnExcel = $$('#v-reportes button[data-acc="exportarXls"]')[0];
  ok(btnExcel && !btnExcel.disabled, 'el botón de exportar a Excel sigue habilitado');
  ok($$('#v-reportes button[data-acc]').every(b => !b.disabled),
    'los 9 botones de reportes siguen habilitados');
  servidor.ok = true;
  await A.verificar();

  console.log('== La aplicación arranca sin pedir la clave de la Base de Datos ==');
  ok(!$('#overlay').classList.contains('on') || $('#modalTitulo').textContent !== 'Base de Datos de precios',
    'no aparece el pedido de clave al arrancar');
  ok(!!$('#v-base [data-acc="nuevaBasePropia"]'), 'hay botón para crear una base propia');
  /* El catalogo ya no lleva clave: viaja en claro y esta cargado desde el
     arranque, asi que no debe quedar ningun resto del flujo de la clave. */
  ok(!$('[data-acc="abrirCatalogo"]'), 'no queda ningun boton de clave');
  ok(!$('[data-acc="olvidarClave"]'), 'ni la opcion de olvidar la clave');
  ok(typeof w.CIFRADO === 'undefined', 'la app ya no carga js/cifrado.js');

  console.log('== Crear una base de datos propia ==');
  clic($('#v-base [data-acc="nuevaBasePropia"]'));
  $('#nbN').value = 'PRECIOS ORURO 2026';
  botonModal('Crear').click();
  await esperar(200);
  let L = M.basesPropias();
  ok(L.length === 1 && L[0].n === 'PRECIOS ORURO 2026', 'la base quedó creada: ' + JSON.stringify(L));
  ok(M.BD.bases.some(b => b.n === 'PRECIOS ORURO 2026'), 'y aparece en la lista de bases');
  ok($$('#selBase option').some(o => o.textContent.includes('PRECIOS ORURO 2026')),
    'también en el selector de la cabecera');

  console.log('== Guardar el presupuesto en una base propia ==');
  const it = M.addItem({ desc: 'MURO DE LADRILLO 6H', und: 'm²', cant: 10 });
  const cem = M.agregarInsumo('M', 'CEMENTO PORTLAND', 'bolsa', 56, false);
  const alb = M.agregarInsumo('O', 'ALBAÑIL', 'hr', 23, false);
  it.comp.push({ ins: cem.id, rend: 0.35 }, { ins: alb.id, rend: 1.2 });
  clic($('.menubar .m[data-menu="herramientas"]'));
  clic($('.menu-pop div[data-acc="proyectoABase"]'));
  await esperar(120);
  botonModal('Guardar en la base').click();
  await esperar(200);
  L = M.basesPropias();
  ok(L[0].apus === 1, 'el ítem entró a la base: ' + L[0].apus + ' análisis');
  const bd = M.BD.bases.find(b => b.n === 'PRECIOS ORURO 2026');
  ok(bd && bd.apus[0].d === 'MURO DE LADRILLO 6H', 'con su descripción: ' + (bd && bd.apus[0].d));
  ok(bd && Math.abs(M.costoBase(bd, bd.apus[0]) - (0.35 * 56 + 1.2 * 23)) < 0.01,
    'y su costo directo: ' + (bd && M.costoBase(bd, bd.apus[0])));
  ok(bd.ins.length === 2, 'con sus dos insumos: ' + bd.ins.length);

  console.log('== Se busca y se trae como cualquier otra base ==');
  const res = M.buscarEnBase(bd.id, 'muro', false, 50);
  ok(res.length === 1, 'la búsqueda la encuentra: ' + res.length + ' resultado(s)');

  console.log('== Sobrevive al recargar la aplicación ==');
  M.cargarCatalogo(w.OPENBOQ_DB);
  const bd2 = M.BD.bases.find(b => b.n === 'PRECIOS ORURO 2026');
  ok(!!bd2 && bd2.apus.length === 1, 'la base propia se vuelve a armar sola al arrancar');

  console.log('== Renombrar y eliminar bases propias ==');
  ok(M.renombrarBasePropia(bd.id, 'PRECIOS ORURO 2027'), 'se renombra');
  ok(M.BD.bases.some(b => b.n === 'PRECIOS ORURO 2027'), 'con el nombre nuevo');
  ok(M.eliminarBasePropia(bd.id), 'se elimina');
  ok(!M.BD.bases.some(b => /PRECIOS ORURO/.test(b.n)), 'y desaparece de la lista');
  ok(M.basesPropias().length === 0, 'no quedan bases propias');

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'CONEXIÓN Y BASES PROPIAS CORRECTO'));
  process.exit(errores.length ? 1 : 0);
})();
