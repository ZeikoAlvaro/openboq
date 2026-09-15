/* La pantalla de inicio sale SIEMPRE al abrir, con la sesión anterior arriba.

   Es lo primero que ve el probador, así que tiene que decir de qué se parte y,
   sobre todo, dejarse cerrar: si se traba, la aplicación entera queda tapada.
   Acá se fija que aparezca sola, que muestre el proyecto recuperado, que la
   cierre cualquier opción y que vuelva desde ARCHIVO.                       */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

/* La dirección es https y no file:// porque con file:// el origen es opaco y
   localStorage tira SecurityError: el tema se guarda ahí y no habría cómo
   comprobarlo. Ningún archivo con red (nube.js, acceso.js) se carga acá. */
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://openboq.pages.dev/index.html' });
const w = dom.window;
w.alert = m => errores.push('ALERT: ' + m);
w.onerror = m => errores.push('ONERROR: ' + m);
const src = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;window.MOTOR=MOTOR;';
try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); console.log('EVAL ERROR', e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $ = s => w.document.querySelector(s);
const M = w.MOTOR;
const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const abierta = () => $('#inicio').classList.contains('on');

/** Abre la pantalla desde el menú ARCHIVO, como lo haría el usuario. */
function desdeElMenu() {
  clic($('.menubar .m[data-menu="archivo"]'));
  const op = Array.from(w.document.querySelectorAll('.menu-pop div'))
    .find(d => d.dataset.acc === 'pantallaInicio');
  ok(!!op, 'ARCHIVO → Pantalla de inicio está en el menú');
  if (op) clic(op);
}

(async () => {
  console.log('== Sale sola al abrir ==');
  await new Promise(r => setTimeout(r, 500));
  ok(abierta(), 'la pantalla de inicio se muestra al arrancar');
  ok(/No hay ningún proyecto abierto/.test($('#iniSesion').textContent),
    'sin trabajo guardado lo dice en vez de ofrecer continuar');
  ok(!$('#iniSesion [data-ini-cerrar]'), 'y no ofrece «Continuar»');

  console.log('== Las tres formas de empezar ==');
  ['nuevo', 'abrir', 'importarDDP'].forEach(a =>
    ok(!!$(`#inicio .ini-op[data-acc="${a}"]`), 'ofrece ' + a));
  /* Los archivos sueltos (.PRE .IND .DAT) son el rescate de un proyecto que
     no tiene .ddp: se sacaron de la pantalla de inicio para no ofrecer cuatro
     caminos parecidos, pero la acción sigue viva en el menú ARCHIVO. */
  ok(!$('#inicio .ini-op[data-acc="importarSueltos"]'),
    'los archivos sueltos ya no están en la pantalla de inicio');

  console.log('== El tema claro / oscuro ==');
  const raiz = w.document.documentElement;
  const btnTema = $('#inicio #btnTema');
  ok(!!btnTema, 'la pantalla de inicio tiene el botón del tema');
  ok(raiz.dataset.tema !== 'oscuro', 'arranca en claro');
  clic(btnTema);
  ok(raiz.dataset.tema === 'oscuro', 'un clic la pone en oscuro');
  ok(abierta(), 'y la pantalla NO se cierra: el tema se elige mirándolo');
  ok(/[Cc]laro/.test($('#btnTemaTexto').textContent),
    'el botón ahora ofrece volver al claro: ' + $('#btnTemaTexto').textContent);
  ok(w.localStorage.getItem('openboq_tema') === 'oscuro', 'queda guardado en el navegador');
  clic(btnTema);
  ok(raiz.dataset.tema !== 'oscuro', 'otro clic vuelve al claro');
  ok(w.localStorage.getItem('openboq_tema') === 'claro', 'y también se guarda');

  console.log('== Se cierra con Esc ==');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(!abierta(), 'Esc la cierra');

  console.log('== Con proyecto abierto, arriba va la sesión ==');
  const ins = M.agregarInsumo('M', 'LADRILLO 6H', 'pza', 1.5, false);
  const it = M.addItem({ cod: '1', desc: 'MURO DE LADRILLO', und: 'm2', cant: 20 });
  it.comp = [{ ins: ins.id, rend: 40 }];
  M.proyecto().nombre = 'PUENTE DE PRUEBA';
  desdeElMenu();
  ok(abierta(), 'vuelve a abrirse desde ARCHIVO');
  const t = $('#iniSesion').textContent;
  ok(/PUENTE DE PRUEBA/.test(t), 'nombra el proyecto: ' + t.slice(0, 60).replace(/\s+/g, ' '));
  ok(/1 ítem\(s\)/.test(t), 'dice cuántos ítems tiene');
  const total = M.fmt(M.conv(M.totalProyecto()));
  ok(t.includes(total), 'y el total con incidencias, el mismo del motor: ' + total);

  console.log('== Cualquier opción la cierra ==');
  clic($('#iniSesion [data-ini-cerrar]'));
  ok(!abierta(), '«Continuar» cierra y deja trabajar');
  ok(!$('#overlay').classList.contains('on'), 'y no abre ningún diálogo encima');
  desdeElMenu();
  clic($('#inicio .ini-x'));
  ok(!abierta(), 'la ✕ también');
  desdeElMenu();
  clic($('#inicio .ini-op[data-acc="nuevo"]'));
  ok(!abierta(), 'elegir «Empezar en blanco» la cierra antes de abrir su diálogo');
  ok($('#overlay').classList.contains('on'), 'y el diálogo de proyecto nuevo queda a la vista');

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
  process.exit(errores.length ? 1 : 0);
})();
