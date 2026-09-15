/* =========================================================================
   Comparar contra otro .boq y llevárselo en Excel
   -------------------------------------------------------------------------
   El resumen por módulos dice CUÁNTO cambió. Estas dos hojas dicen DÓNDE:
   una pone el presupuesto ítem contra ítem y la otra los insumos, insumo
   contra insumo, marcando en cada uno si hubo incremento o decremento.

   Lo que no se puede romper:
     · comparar NO abre ni reemplaza el proyecto que se está trabajando —el
       archivo se lee, se calcula con SUS precios y se lo suelta—;
     · los renglones que están en un solo archivo se marcan, no se pierden;
     · un ítem que se llama igual pero mueve la cantidad, el precio o los dos
       tiene que salir con la diferencia correcta.
   ========================================================================= */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errores.push(m); };

const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///app/index.html' });
const w = dom.window;
w.alert = m => errores.push('ALERT: ' + m);
w.onerror = m => errores.push('ONERROR: ' + m);
['Blob', 'URL', 'TextEncoder', 'TextDecoder'].forEach(k => { if (!w[k]) w[k] = globalThis[k]; });
let bajado = null;
w.URL.createObjectURL = b => { bajado = b; return 'blob:x'; };
w.URL.revokeObjectURL = () => { };
const src = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;window.MOTOR=MOTOR;window.REP=REP;window.XLSX=XLSX;';
try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); console.log('EVAL ERROR', e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $ = s => w.document.querySelector(s);
const M = w.MOTOR, REP = w.REP;
const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* ---------------- el proyecto abierto ---------------- */
const P = M.proyecto();
P.nombre = 'MURO DE CONTENCIÓN — REVISIÓN 1';
const cem = M.agregarInsumo('M', 'CEMENTO PORTLAND IP-30', 'kg', 1.45, false);
const fie = M.agregarInsumo('M', 'FIERRO CORRUGADO', 'kg', 8.50, false);
const alb = M.agregarInsumo('O', 'ALBAÑIL', 'hr', 22.50, false);
const mez = M.agregarInsumo('E', 'MEZCLADORA', 'hr', 35.00, false);
const nadie = M.agregarInsumo('M', 'INSUMO QUE NADIE USA', 'pza', 999, false);

const zap = M.addItem({ cod: '1', desc: 'ZAPATA DE HORMIGÓN', und: 'm3', cant: 10 });
zap.comp = [{ ins: cem.id, rend: 325 }, { ins: alb.id, rend: 8 }, { ins: mez.id, rend: 1.2 }];
const mur = M.addItem({ cod: '2', desc: 'MURO DE HORMIGÓN ARMADO', und: 'm3', cant: 25 });
mur.comp = [{ ins: cem.id, rend: 350 }, { ins: fie.id, rend: 90 }, { ins: alb.id, rend: 12 }];
const dre = M.addItem({ cod: '3', desc: 'DREN DE GRAVA', und: 'm3', cant: 8 });
dre.comp = [{ ins: alb.id, rend: 2 }];

const totalAbierto = M.totalProyecto();
const puZapata = M.analisis(zap).pu;
const textoOriginal = M.serializar();

/* ---------------- el archivo con el que se compara ----------------
   cemento más caro, fierro más barato, el muro con más cantidad, el dren
   borrado y un ítem nuevo que el proyecto abierto no tiene. */
const o = JSON.parse(textoOriginal);
o.P.nombre = 'MURO DE CONTENCIÓN — REVISIÓN 2';
o.P.insumos[cem.id].p = 2.10;                      // sube
o.P.insumos[fie.id].p = 7.90;                      // baja
o.P.modulos[0].items.find(x => /MURO/.test(x.desc)).cant = 30;
o.P.modulos[0].items = o.P.modulos[0].items.filter(x => !/DREN/.test(x.desc));
o.P.modulos[0].items.push({ id: 'x-nuevo', cod: '4', desc: 'BARANDA METÁLICA', und: 'ml', cant: 40,
  comp: [{ ins: fie.id, rend: 6 }], computos: [] });
const textoOtro = JSON.stringify(o);

console.log('== La comparación empareja por nombre ==');
const otro = M.leerProyecto(textoOtro);
const C = M.compararProyectos(M.proyecto(), otro);

ok(M.proyecto().nombre === 'MURO DE CONTENCIÓN — REVISIÓN 1',
  'el proyecto abierto sigue siendo el mismo: ' + M.proyecto().nombre);
ok(M.totalProyecto() === totalAbierto, 'con su total intacto: ' + M.fmt(totalAbierto, 2));
ok(M.analisis(zap).pu === puZapata, 'y sus precios unitarios sin tocar: ' + M.fmt(puZapata, 2));

const porItem = d => C.items.find(x => new RegExp(d, 'i').test((x.a || x.b).desc));
ok(C.items.length === 4, 'cuatro renglones: los 3 del proyecto más el que solo está en el archivo (' +
  C.items.length + ')');

console.log('== Ítem contra ítem ==');
const zapF = porItem('ZAPATA');
ok(zapF.a && zapF.b, 'la zapata está en los dos');
ok(zapF.estado === 'subio', 'la zapata sube con el cemento más caro (' + zapF.estado + ')');
ok(M.r2(zapF.b.total - zapF.a.total) === zapF.dTot.d,
  'la diferencia del total es la resta de los dos lados: ' + zapF.dTot.d.toFixed(2));
ok(zapF.dTot.pct !== null && zapF.dTot.pct > 0, 'con su porcentaje: ' + zapF.dTot.pct + ' %');

const murF = porItem('MURO');
ok(murF.dCant.d === 5, 'el muro cambió de cantidad: +' + murF.dCant.d + ' m3 (25 → 30)');
ok(murF.estado === 'subio', 'y por eso su total sube (' + murF.estado + ')');

const dreF = porItem('DREN');
ok(dreF.estado === 'soloA' && dreF.b === null, 'el dren borrado queda marcado «solo en este proyecto»');
const barF = porItem('BARANDA');
ok(barF.estado === 'soloB' && barF.a === null, 'la baranda nueva queda marcada «solo en el archivo»');
ok(C.items.indexOf(barF) === C.items.length - 1, 'y lo que está en un solo archivo va al final');

console.log('== Insumo contra insumo ==');
const porIns = d => C.insumos.find(x => new RegExp(d, 'i').test((x.a || x.b).d));
ok(!porIns('NADIE USA'), 'el insumo que no entra en ningún análisis no se compara');

const cemF = porIns('CEMENTO');
ok(cemF.estado === 'subio', 'el cemento es un incremento (' + cemF.estado + ')');
ok(cemF.dP.d === 0.65, 'de 0,65 Bs por kg (1,45 → 2,10): ' + cemF.dP.d);
ok(Math.abs(cemF.dP.pct - 44.83) < 0.01, 'un 44,83 % más caro: ' + cemF.dP.pct + ' %');

const fieF = porIns('FIERRO');
ok(fieF.estado === 'bajo', 'el fierro es un decremento (' + fieF.estado + ')');
ok(fieF.dP.d === -0.6, 'de 0,60 Bs por kg (8,50 → 7,90): ' + fieF.dP.d);
ok(fieF.dP.pct < 0, 'con el porcentaje en negativo: ' + fieF.dP.pct + ' %');
/* el monto no sigue al precio: el fierro bajó de precio pero la obra consume
   más (el muro creció y encima apareció la baranda) */
ok(fieF.dMonto.d > 0, 'y aun así la obra gasta MÁS fierro que antes: ' +
  fieF.dMonto.d.toFixed(2) + ' Bs');

const albF = porIns('ALBAÑIL');
ok(albF.estado === 'igual' && albF.dP.d === 0, 'el albañil no cambió de precio');

const mezF = porIns('MEZCLADORA');
ok(mezF.a && mezF.b, 'la mezcladora sigue en los dos');

console.log('== Los totales de la comparación ==');
const t = C.totales;
ok(t.itemsA === 3 && t.itemsB === 3, 'tres ítems de cada lado (' + t.itemsA + '/' + t.itemsB + ')');
ok(t.totalA === totalAbierto, 'el total de este proyecto es el del proyecto abierto: ' + t.totalA.toFixed(2));
ok(t.totalB === M.resumenProyecto(otro).total,
  'y el del archivo, el que da el archivo con SUS precios: ' + t.totalB.toFixed(2));

console.log('== El libro de Excel sale con las dos hojas ==');
const hojas = [];
const libroReal = w.XLSX.libro;
w.XLSX.libro = hs => { hs.forEach(h => hojas.push(h)); return libroReal(hs); };
REP.excelComparacion(otro, 'revision-2.boq');
w.XLSX.libro = libroReal;
ok(hojas.length === 2, 'dos hojas (' + hojas.length + ')');
ok(hojas[0].n === 'Presupuesto comparado' && hojas[1].n === 'Insumos comparados',
  'con sus nombres: ' + hojas.map(h => h.n).join(' · '));
ok(!!bajado, 'y se bajó el archivo');

const texto = h => h.filas.map(f => f.map(c => (c && c.v !== undefined) ? String(c.v) : '').join('\t')).join('\n');
const t1 = texto(hojas[0]), t2 = texto(hojas[1]);
ok(/MURO DE CONTENCIÓN — REVISIÓN 1/.test(t1) && /MURO DE CONTENCIÓN — REVISIÓN 2/.test(t1),
  'la hoja del presupuesto nombra los dos proyectos');
ok(/revision-2\.boq/.test(t1), 'y dice de qué archivo salió el segundo');
ok(/ZAPATA DE HORMIGÓN/.test(t1) && /BARANDA METÁLICA/.test(t1), 'lista los ítems de los dos lados');
ok(/solo en este proyecto/.test(t1) && /solo en el archivo/.test(t1),
  'y marca los que están en uno solo');
ok(/incremento/.test(t2) && /decremento/.test(t2),
  'la hoja de insumos marca incrementos y decrementos');
ok(/CEMENTO PORTLAND IP-30/.test(t2) && /FIERRO CORRUGADO/.test(t2), 'con los insumos de los dos lados');
ok(!/INSUMO QUE NADIE USA/.test(t2), 'y sin los que no entran en ningún análisis');

console.log('== Comparar dos veces da lo mismo ==');
const C2 = M.compararProyectos(M.proyecto(), otro);
ok(C2.items.length === C.items.length && C2.totales.totalA === C.totales.totalA,
  'la comparación no se ensucia a sí misma');
ok(M.proyecto().nombre === 'MURO DE CONTENCIÓN — REVISIÓN 1' && M.totalProyecto() === totalAbierto,
  'y el proyecto abierto sigue intacto después de todo');

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ')
  : 'LA COMPARACIÓN EN EXCEL FUNCIONA'));
process.exit(errores.length ? 1 : 0);
