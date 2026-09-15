/* La pestaña INSUMOS es un RESUMEN, no un lugar donde borrar.

   Un insumo se elimina desde el análisis del ítem que lo usa: borrarlo desde
   el B-3 sería borrar hacia atrás. Acá se fija que no vuelva ningún botón de
   eliminar a esa tabla, y que el doble clic sobre la descripción despliegue el
   detalle de usos con las mismas cantidades que ya calcula el motor.        */
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

/* un presupuesto chico armado a mano: el mismo insumo en dos ítems con
   rendimientos distintos, que es el caso que se quiere ver desplegado */
const cem = M.agregarInsumo('M', 'CEMENTO PORTLAND IP-30', 'kg', 1.45, false);
const are = M.agregarInsumo('M', 'ARENA COMÚN', 'm3', 120, false);
const a = M.addItem({ cod: '1', desc: 'ZAPATAS', und: 'm3', cant: 10 });
const b = M.addItem({ cod: '2', desc: 'COLUMNAS', und: 'm3', cant: 4 });
a.comp = [{ ins: cem.id, rend: 325 }, { ins: are.id, rend: 0.5 }];
b.comp = [{ ins: cem.id, rend: 340 }];

console.log('== La tabla de INSUMOS no ofrece borrar ==');
w.document.querySelector('#tabs button[data-v="insumos"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const tbl = $('#tblInsumos');
ok(tbl.innerHTML.includes('CEMENTO PORTLAND'), 'la tabla se renderizó');
ok(!tbl.querySelector('[data-delins]'), 'ninguna fila trae el botón ✕');
ok(!tbl.querySelector('.b-del'), 'ni ningún otro botón de eliminar');
ok(!w.document.querySelector('[data-acc="limpiarInsumos"]'), 'tampoco está «Quitar insumos sin uso» en la barra');
const ui = fs.readFileSync(path.join(dir, 'js/ui.js'), 'utf8');
ok(!/'limpiarInsumos'/.test(ui), 'ni en el menú HERRAMIENTAS ni como acción');

console.log('== En el B-3 solo se edita el precio ==');
ok(!tbl.querySelector('input[data-ins-d]'), 'la descripción no es editable');
ok(!tbl.querySelector('input[data-ins-u]'), 'la unidad tampoco');
ok(!!tbl.querySelector(`input[data-ins-p="${cem.id}"]`), 'el precio sí');
{
  const p = tbl.querySelector(`input[data-ins-p="${cem.id}"]`);
  p.value = '2'; p.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok(M.proyecto().insumos[cem.id].p === 2, 'y el precio editado llega al proyecto: ' + M.proyecto().insumos[cem.id].p);
  p.value = '1.45'; p.dispatchEvent(new w.Event('input', { bubbles: true }));
}

console.log('== Doble clic en la descripción: en qué ítems se usa ==');
const desc = tbl.querySelector(`[data-ins-d="${cem.id}"]`);
ok(!!desc, 'la descripción lleva el ancla del detalle');
desc.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
const det = $('#tblInsumos tr.uso');
ok(!!det, 'se desplegó la fila de detalle');
const txt = det ? det.textContent : '';
ok(/ZAPATAS/.test(txt) && /COLUMNAS/.test(txt), 'lista los dos ítems que lo usan');
ok(!/ARENA COMÚN/.test(txt), 'y no mezcla otros insumos');

console.log('== Las cantidades del detalle son las mismas del motor ==');
const D = M.detalleInsumo(cem.id);
ok(D.length === 2, 'detalleInsumo devuelve dos renglones: ' + D.length);
ok(D[0].cant === 3250 && D[1].cant === 1360, 'cantidad por ítem = cantidad × rendimiento: ' + D.map(x => x.cant).join(' / '));
const req = M.requerimiento().find(x => x.ins.id === cem.id);
const suma = D.reduce((s, x) => s + x.cant, 0);
ok(Math.abs(suma - req.cant) < 1e-6, 'la suma del detalle es el requerimiento total: ' + suma + ' contra ' + req.cant);
ok(Math.abs(D.reduce((s, x) => s + x.monto, 0) - req.monto) < 0.01, 'y los montos también: ' + req.monto);

console.log('== La descripción se corrige desde el detalle, no en la rejilla ==');
{
  const bt = $('#tblInsumos [data-acc="renombrarInsumo"]');
  ok(!!bt && bt.dataset.accArg === cem.id, 'el detalle ofrece «Renombrar…» del insumo abierto');
  clic(bt);
  ok(/2 ítem\(s\)/.test($('#modalCuerpo').textContent), 'avisa a cuántos ítems afecta');
  $('#riD').value = 'CEMENTO IP-40';
  $('#riU').value = 'kg';
  Array.from(w.document.querySelectorAll('#modalPie button')).find(b => b.textContent === 'Renombrar').click();
  ok(M.proyecto().insumos[cem.id].d === 'CEMENTO IP-40', 'el nombre cambió: ' + M.proyecto().insumos[cem.id].d);
  ok(M.analisis(a).grupos.M.some(x => x.ins.d === 'CEMENTO IP-40'), 'y el análisis del ítem lo muestra renombrado');
  ok(M.proyecto().insumos[cem.id].p === 1.45, 'el precio quedó intacto: ' + M.proyecto().insumos[cem.id].p);
}

console.log('== El detalle se cierra, y se pueden abrir varios a la vez ==');
tbl.querySelector(`[data-ins-d="${are.id}"]`).dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
ok(w.document.querySelectorAll('#tblInsumos tr.uso').length === 2, 'dos detalles abiertos al mismo tiempo');
tbl.querySelector(`[data-cerraruso="${cem.id}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
ok(w.document.querySelectorAll('#tblInsumos tr.uso').length === 1, '«Cerrar» cierra solo el suyo');
tbl.querySelector(`[data-ins-d="${are.id}"]`).dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
ok(!w.document.querySelector('#tblInsumos tr.uso'), 'el segundo doble clic lo cierra');

console.log('== Los insumos sin uso no salen en la rejilla ==');
const suelto = M.agregarInsumo('E', 'MEZCLADORA SIN USO', 'hr', 30, false);
$('#buscaInsumo').dispatchEvent(new w.Event('input', { bubbles: true }));   // refresca la tabla sin cambiar de pestaña
ok(!$('#tblInsumos').querySelector(`[data-ins-d="${suelto.id}"]`),
  'un insumo que no entra en ningún análisis no aparece en el B-3');
ok(/1 sin uso, ocultos/.test($('#lblInsCuenta').textContent),
  'la cuenta dice cuántos quedaron ocultos: ' + $('#lblInsCuenta').textContent);

console.log('== …salvo que se pidan, y entonces dicen que no se usan ==');
$('#verSinUso').checked = true;
$('#verSinUso').dispatchEvent(new w.Event('change', { bubbles: true }));
ok(!!$('#tblInsumos').querySelector(`[data-ins-d="${suelto.id}"]`), 'con la casilla marcada vuelve a la lista');
$('#tblInsumos').querySelector(`[data-ins-d="${suelto.id}"]`)
  .dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
ok(/No participa en ningún análisis/.test($('#tblInsumos tr.uso').textContent), 'avisa que no participa en ningún análisis');
ok(M.detalleInsumo('no-existe').length === 0, 'un id inexistente devuelve lista vacía');

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
process.exit(errores.length ? 1 : 0);
