/* Comparar el proyecto abierto contra otro .boq guardado.

   Lo que no se puede romper: el archivo que se elige para comparar NO
   reemplaza el proyecto que se está trabajando. Acá se arma un proyecto, se
   guarda su texto, se lo modifica, y se comprueba que la comparación muestre
   las diferencias por módulo y deje el proyecto abierto intacto.          */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///app/index.html' });
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

/* ---------- el proyecto abierto: dos módulos ---------- */
const P = M.proyecto();
P.nombre = 'PUENTE CHORO — REVISIÓN 1';
const cem = M.agregarInsumo('M', 'CEMENTO PORTLAND IP-30', 'kg', 1.45, false);
const alb = M.agregarInsumo('O', 'ALBAÑIL', 'hr', 22.5, false);
const a = M.addItem({ cod: '1', desc: 'ZAPATAS', und: 'm3', cant: 10 });
a.comp = [{ ins: cem.id, rend: 325 }, { ins: alb.id, rend: 8 }];
P.modulos.push({ n: 'M-02 SUPERESTRUCTURA', items: [] });
P.moduloActivo = 1;
const b = M.addItem({ cod: '2', desc: 'LOSA', und: 'm2', cant: 40 });
b.comp = [{ ins: cem.id, rend: 12 }];
P.moduloActivo = 0;
P.modulos[0].n = 'M-01 OBRAS PRELIMINARES';

const totalAbierto = M.totalProyecto();
const textoOriginal = M.serializar();

/* ---------- el archivo: el mismo proyecto con el cemento más caro y un
     módulo que el abierto no tiene ---------- */
const otro = JSON.parse(textoOriginal);
otro.P.nombre = 'PUENTE CHORO — REVISIÓN 2';
otro.P.insumos[cem.id].p = 2.10;
otro.P.modulos.push({ n: 'M-03 OBRAS COMPLEMENTARIAS', items: [] });
const textoOtro = JSON.stringify(otro);

console.log('== Leer un proyecto sin abrirlo ==');
const leido = M.leerProyecto(textoOtro);
ok(leido.nombre === 'PUENTE CHORO — REVISIÓN 2', 'lee el archivo: ' + leido.nombre);
ok(M.proyecto().nombre === 'PUENTE CHORO — REVISIÓN 1',
  'y el proyecto abierto sigue siendo el mismo: ' + M.proyecto().nombre);
ok(M.totalProyecto() === totalAbierto, 'con su total intacto: ' + M.fmt(totalAbierto, 2));

console.log('== Los totales del archivo salen con SUS precios ==');
const R = M.resumenProyecto(leido);
ok(R.total > totalAbierto, 'el archivo es más caro (cemento 1,45 → 2,10): ' +
  M.fmt(totalAbierto, 2) + ' contra ' + M.fmt(R.total, 2));
ok(R.modulos.length === 3, 'y tiene tres módulos, uno más que el abierto');
ok(M.totalProyecto() === totalAbierto, 'sacar ese total no movió el proyecto abierto');

console.log('== La comparación, desde el menú HERRAMIENTAS ==');
/* se reemplaza el selector de archivos del sistema por uno que devuelve el
   texto de arriba: así se recorre el camino entero, menú incluido */
w.showOpenFilePicker = async () => [{
  getFile: async () => ({ name: 'revision-2.boq', text: async () => textoOtro })
}];
clic($('.menubar .m[data-menu="herramientas"]'));
const op = Array.from(w.document.querySelectorAll('.menu-pop div'))
  .find(d => d.dataset.acc === 'compararProyecto');
ok(!!op, 'HERRAMIENTAS → Comparar con otro proyecto está en el menú');
clic(op);

(async () => {
  await new Promise(r => setTimeout(r, 200));
  const t = $('#modalCuerpo').textContent;
  ok($('#overlay').classList.contains('on'), 'el diálogo de comparación se abrió');
  ok(/revision-2\.boq/.test(t), 'dice qué archivo leyó');
  ok(/PUENTE CHORO — REVISIÓN 1/.test(t) && /PUENTE CHORO — REVISIÓN 2/.test(t),
    'nombra los dos proyectos');
  ok(/M-01 OBRAS PRELIMINARES/.test(t) && /M-02 SUPERESTRUCTURA/.test(t),
    'lista los módulos emparejados');
  ok(/M-03 OBRAS COMPLEMENTARIAS/.test(t) && /solo en el archivo/.test(t),
    'y marca el módulo que está solo en el archivo');
  ok(/TOTAL DEL PROYECTO/.test(t), 'con el total del proyecto abajo');
  ok(!!$('#modalCuerpo td.sube'), 'la diferencia que sube va marcada');

  console.log('== Comparar no reemplaza nada ==');
  ok(M.proyecto().nombre === 'PUENTE CHORO — REVISIÓN 1', 'el proyecto abierto no cambió de nombre');
  ok(M.totalProyecto() === totalAbierto, 'ni de total');
  ok(M.proyecto().modulos.length === 2, 'ni le entró el módulo del archivo');

  console.log('== Un archivo que no es un proyecto ==');
  w.showOpenFilePicker = async () => [{
    getFile: async () => ({ name: 'lista.txt', text: async () => '{"hola":1}' })
  }];
  clic($('.menubar .m[data-menu="herramientas"]'));
  clic(Array.from(w.document.querySelectorAll('.menu-pop div'))
    .find(d => d.dataset.acc === 'compararProyecto'));
  await new Promise(r => setTimeout(r, 200));
  ok(/no contiene un proyecto válido|No se pudo leer/.test($('#modalCuerpo').textContent),
    'lo dice en vez de romperse');
  ok(M.proyecto().modulos.length === 2, 'y el proyecto abierto sigue entero');

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
  process.exit(errores.length ? 1 : 0);
})();
