/* Interfaz simple para quien nunca usó PRESCOM.

   La primera vez la pantalla de inicio pregunta; «No, es mi primera vez» deja
   cuatro pasos a la vista y el botón ⇄ vuelve a la completa. Acá se fija que
   la pregunta salga una sola vez, que la respuesta quede guardada, que el modo
   sobreviva a recargar y que la interfaz completa siga siendo la de siempre
   para quien no contestó.                                                  */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const src = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;window.MOTOR=MOTOR;';

/** Arranca la aplicación; `almacen` es lo que ya había en localStorage. */
function arrancar(almacen, nube) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://openboq.pages.dev/index.html' });
  const w = dom.window;
  w.alert = m => errores.push('ALERT: ' + m);
  w.onerror = m => errores.push('ONERROR: ' + m);
  if (nube) w.NUBE = nube;
  Object.entries(almacen || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));
  try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));
const clic = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const visible = (w, sel) => { const e = w.document.querySelector(sel); return !!e && w.getComputedStyle(e).display !== 'none'; };

(async () => {
  console.log('== Sin respuesta: la interfaz completa de siempre ==');
  let w = arrancar();
  await dormir(500);
  const $ = s => w.document.querySelector(s);
  ok(!w.document.body.classList.contains('modo-simple'), 'arranca en la completa');
  ok(!!$('#iniPerfil [data-perfil="nuevo"]') && !!$('#iniPerfil [data-perfil="prescom"]'),
    'la pantalla de inicio pregunta si ya usó PRESCOM');
  ok($('#tabs button[data-v="base"]').textContent.trim() === 'BASE DE DATOS', 'las pestañas conservan su nombre');

  console.log('== «No, es mi primera vez» ==');
  clic(w, $('#iniPerfil [data-perfil="nuevo"]'));
  ok(w.document.body.classList.contains('modo-simple'), 'pasa a la interfaz simple');
  ok($('#inicio').classList.contains('on'), 'y la pantalla de inicio sigue abierta para elegir cómo empezar');
  const perfil = JSON.parse(w.localStorage.getItem('openboq_perfil') || 'null');
  ok(perfil && perfil.modo === 'simple' && perfil.usa_prescom === false, 'guarda la respuesta: ' + JSON.stringify(perfil));
  ok(!$('#iniPerfil [data-perfil]'), 'la pregunta no se repite');
  ok(/Buscar ítems/.test($('#tabs button[data-v="base"]').textContent), 'el paso ① se llama «Buscar ítems»');
  ok(/Mi presupuesto/.test($('#tabs button[data-v="presupuesto"]').textContent), 'el paso ② se llama «Mi presupuesto»');
  ok(/Interfaz completa/.test($('#btnModo').textContent), 'el botón ⇄ ofrece la interfaz completa');
  ok(!!$('#tblPresupuesto .guia-simple [data-acc="irBase"]'), 'el presupuesto vacío muestra la guía con «Buscar ítems»');

  console.log('== Recargar conserva el modo ==');
  const guardado = w.localStorage.getItem('openboq_perfil');
  w = arrancar({ openboq_perfil: guardado });
  await dormir(500);
  ok(w.document.body.classList.contains('modo-simple'), 'vuelve en modo simple');
  ok(!w.document.querySelector('#iniPerfil [data-perfil]'), 'sin volver a preguntar');

  console.log('== El botón ⇄ vuelve a la completa ==');
  clic(w, w.document.querySelector('#btnModo'));
  ok(!w.document.body.classList.contains('modo-simple'), 'sale del modo simple');
  ok(w.document.querySelector('#tabs button[data-v="base"]').textContent.trim() === 'BASE DE DATOS', 'las pestañas recuperan su nombre');
  ok(JSON.parse(w.localStorage.getItem('openboq_perfil')).modo === 'completo', 'y lo recuerda');
  ok(JSON.parse(w.localStorage.getItem('openboq_perfil')).usa_prescom === false, 'sin olvidar que no usaba PRESCOM');

  console.log('== Con una pestaña oculta abierta, el modo simple lleva al presupuesto ==');
  clic(w, w.document.querySelector('#tabs button[data-v="cronograma"]'));
  clic(w, w.document.querySelector('#btnModo'));
  ok(w.document.querySelector('#v-presupuesto').classList.contains('on'), 'queda en el presupuesto, no en una vista escondida');

  console.log('== Otro equipo (o caché borrada): la cuenta ya contestó ==');
  const enviados = [];
  const usuario = { id: 'u1', email: 'nuevo@ejemplo.com' };
  w = arrancar({}, {
    hay: () => true, hayToken: () => true, recogerRedireccion: () => null,
    cargarUsuario: async () => usuario, conectado: () => true, usuario: () => usuario,
    alEntrar() { }, alFallarLogin() { }, enviarCola: async () => ({}), origenAjeno: () => false,
    bajarBiblioteca: async () => null,
    reportarUso: async p => { enviados.push(p); return true; },
    miPerfil: async () => ({ modo: 'simple', usa_prescom: false, fecha: '2026-09-15' })
  });
  await dormir(1200);
  ok(w.document.body.classList.contains('modo-simple'), 'toma la interfaz simple guardada en la cuenta');
  ok(!w.document.querySelector('#iniPerfil [data-perfil]'), 'y no vuelve a preguntar');
  ok(/"modo":"simple"/.test(w.localStorage.getItem('openboq_perfil') || ''), 'la deja guardada en este navegador');
  ok(!w.document.querySelector('[href="panel.html"]'), 'la aplicación no enlaza el panel de administración');
  ok(w.document.querySelector('#stPriv').target === '_blank', '«Privacidad» se abre en otra ventana');

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'MODO SIMPLE EN ORDEN'));
  process.exit(errores.length ? 1 : 0);
})();
