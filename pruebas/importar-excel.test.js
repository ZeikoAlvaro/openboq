/* =========================================================================
   Importar un presupuesto desde Excel
   -------------------------------------------------------------------------
   Lo que se cuida:

   1. El lector (js/lector_excel.js) lee lo mismo que se escribió: se arma un
      libro con js/xlsx.js —el escritor de la propia aplicación— y se lee.
   2. Un presupuesto armado como «una hoja por ítem» (Formulario B-2 del DBC)
      entra con los precios unitarios que da el motor, que tienen que ser los
      del archivo. El importador no calcula plata: lo hace js/motor.js.
   3. Casos reales (cinco formatos de consultores distintos, .xls y .xlsx):
      total, cantidad de ítems y los defectos del archivo que hay que
      encontrar. No se versionan: van en muestras/excel/<obra>/ y la lista
      en pruebas/casos-reales.local.json («importarExcel»). Sin la lista,
      esa parte se omite.
   ========================================================================= */
'use strict';

const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errores.push(m); };

const ctx = { console, TextDecoder, TextEncoder, DecompressionStream, Response, ReadableStream, Blob,
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } } };
ctx.window = ctx;
vm.createContext(ctx);
const G = { 'js/motor.js': 'MOTOR', 'js/xlsx.js': 'XLSX', 'js/lector_excel.js': 'LECTOR_EXCEL', 'js/importar_excel.js': 'IMPORTAR_EXCEL' };
for (const f in G) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8') + `;window.${G[f]}=${G[f]};`, ctx, { filename: f });
const { MOTOR: M, XLSX, LECTOR_EXCEL: L, IMPORTAR_EXCEL: I } = ctx;

/* ---------------- un presupuesto chico, «una hoja por ítem» ---------------- */
const PCT = { cargas: 55, ivaMO: 14.94, herr: 6, gg: 5, util: 7, it: 3.09 };
const ITEMS = [
  { d: 'Excavación de hoyos', u: 'Hoyo', cant: 120, M: [['Estacas', 'Pza.', 2, 10]], O: [['Peón', 'Hr.', 1.5, 12], ['Capataz', 'Hr.', 0.2, 25]], E: [['Camioneta 4x4', 'Hr.', 0.5, 80]] },
  { d: 'Plantado de postes de 9 m', u: 'Pza.', cant: 35, M: [['Poste de eucalipto 9 m', 'Pza.', 1, 850.5], ['Grava', 'm3', 0.12, 180]], O: [['Liniero', 'Hr.', 2, 19]], E: [] }
];
/* el precio unitario como lo calcula la planilla (la cadena del SABS) */
function puPlanilla(it) {
  const s = l => l.reduce((t, x) => t + x[2] * x[3], 0);
  const m = s(it.M), o = s(it.O), e = s(it.E);
  const tmo = o * (1 + PCT.cargas / 100) * (1 + PCT.ivaMO / 100);
  const teq = e + tmo * PCT.herr / 100;
  const sub = m + tmo + teq;
  const p1 = sub * (1 + PCT.gg / 100), p2 = p1 * (1 + PCT.util / 100);
  return Math.round(p2 * (1 + PCT.it / 100) * 100) / 100;
}
const T = v => ({ v, t: 's' }), N = v => ({ v, t: 'n' });
function libroDePrueba() {
  const hojas = [];
  const b1 = new XLSX.Hoja('PRESUP. GRAL.');
  b1.fila([T('PRESUPUESTO GENERAL DE LA OBRA')]).fila([T('Proyecto: Prueba de importación')]).blanco();
  b1.fila([T('ÍTEM'), T('Descripción'), T('Unidad'), T('Cantidad'), T('Precio Unitario (Bs.)'), T('Precio Total (Bs.)')]);
  let total = 0;
  ITEMS.forEach((it, i) => {
    const pu = puPlanilla(it); total += Math.round(pu * it.cant * 100) / 100;
    b1.fila([N(i + 1), T(it.d), T(it.u), N(it.cant), N(pu), N(Math.round(pu * it.cant * 100) / 100)]);
  });
  b1.fila([null, null, null, null, T('TOTAL GENERAL BOLIVIANOS'), N(total)]);
  hojas.push(b1);
  ITEMS.forEach((it, i) => {
    const h = new XLSX.Hoja('APU ' + (i + 1));
    h.fila([T('Análisis de Precios Unitarios')]);
    h.fila([T('Ítem: ' + it.d), null, null, null, T('Unidad:'), T(it.u)]).blanco();
    const sec = (n, titulo, l) => {
      h.fila([T(n + '.-'), T(titulo)]);
      h.fila([T('Descripción'), null, T('Unidad'), T('Cantidad'), T('Precio Unit.'), T('Sub Total')]);
      l.forEach(x => h.fila([null, T(x[0]), T(x[1]), N(x[2]), N(x[3]), N(x[2] * x[3])]));
    };
    sec(1, 'MATERIALES:', it.M);
    h.fila([null, T('TOTAL MATERIALES'), null, null, null, N(it.M.reduce((t, x) => t + x[2] * x[3], 0))]);
    sec(2, 'MANO DE OBRA:', it.O);
    h.fila([null, T('SUBTOTAL MANO DE OBRA'), null, null, null, N(it.O.reduce((t, x) => t + x[2] * x[3], 0))]);
    h.fila([null, T('Cargas Sociales = (% del Subtotal de Mano de Obra)'), null, N(PCT.cargas)]);
    h.fila([null, T('Impuestos IVA Mano de Obra = (% de suma de Subtotal de Mano')]);
    h.fila([null, T('de Obra + Cargas Sociales)'), null, N(PCT.ivaMO)]);
    sec(3, 'EQUIPO, MAQUINARIA Y HERRAMIENTAS:', it.E);
    h.fila([null, T('Herramientas = (% del Total de Mano de Obra)'), N(PCT.herr), T('%')]);
    h.fila([T('4.-'), T('GASTOS GENERALES Y ADMINISTRATIVOS:')]);
    h.fila([null, T('Gastos Generales = % de 1 + 2 + 3'), N(PCT.gg), T('%')]);
    h.fila([T('5.-'), T('UTILIDAD:')]);
    h.fila([null, T('Utilidad = % de 1 + 2 + 3 + 4'), N(PCT.util), T('%')]);
    h.fila([T('6.-'), T('IMPUESTOS:')]);
    h.fila([null, T('Impuestos IT = % de 1 + 2 + 3 + 4 + 5'), N(PCT.it), T('%')]);
    h.fila([T('TOTAL PRECIO UNITARIO ADOPTADO'), null, null, null, null, N(puPlanilla(it))]);
    hojas.push(h);
  });
  return { datos: XLSX.libro(hojas), total };
}

(async () => {
  console.log('== El lector lee lo que escribe la aplicación ==');
  const { datos, total } = libroDePrueba();
  const lib = await L.leer(datos);
  ok(lib.tipo === 'xlsx' && lib.hojas.length === 3, 'tres hojas en un .xlsx');
  ok(L.texto(lib.hojas[0].filas[0][0]) === 'PRESUPUESTO GENERAL DE LA OBRA', 'texto de la primera celda');
  ok(lib.hojas[0].filas[4][3].v === 120 && lib.hojas[0].filas[4][3].t === 'n', 'número como número');
  ok(I.numTexto('1.652,2395') === 1652.2395 && I.numTexto('0,5000') === 0.5 && I.numTexto('18373.97') === 18373.97,
    'números escritos como texto, con coma o con punto decimal');

  console.log('== «Una hoja por ítem»: el motor da los precios del archivo ==');
  const r = await I.importar(M, [{ nombre: 'prueba.xlsx', datos }]);
  const s = r.resumen;
  ok(s.formato === 'hoja', 'formato reconocido: ' + s.formato);
  ok(s.items === 2 && s.sinApu.length === 0, 'dos ítems, cada uno con su análisis');
  ok(JSON.stringify(s.params) === JSON.stringify(PCT), 'recargos leídos del análisis, IVA con la etiqueta en dos filas');
  ok(s.deArchivo.length === 0, 'ningún ítem necesita el P.U. del archivo');
  ok(Math.abs(s.totalRecalculado - total) < 0.005, `total ${s.totalRecalculado} = ${M.r2(total)}`);
  const it0 = M.proyecto().modulos[0].items[0];
  ok(it0.comp.length === 4, 'el primer análisis trae sus cuatro insumos');
  it0.comp[0].rend = 3;
  ok(!M.analisis(it0).deArchivo && M.analisis(it0).pu > puPlanilla(ITEMS[0]), 'al editar el análisis manda el cálculo');

  console.log('== No es un presupuesto ==');
  let error = '';
  try { await I.importar(M, [{ nombre: 'x.xlsx', datos: XLSX.libro([new XLSX.Hoja('Hoja1').fila([T('hola')])]) }]); }
  catch (e) { error = e.message; }
  ok(/No se reconoce el formato/.test(error), 'un Excel cualquiera se rechaza con un mensaje claro');

  /* ---------------- casos reales ---------------- */
  const lista = path.join(__dirname, 'casos-reales.local.json');
  const casos = fs.existsSync(lista) ? (JSON.parse(fs.readFileSync(lista, 'utf8')).importarExcel || []) : [];
  if (!casos.length) console.log('== Casos reales: omitidos (sin «importarExcel» en casos-reales.local.json) ==');
  for (const c of casos) {
    const d = path.join(dir, c.dir);
    if (!fs.existsSync(d)) { console.log('  –  ' + c.dir + ': no está, se omite'); continue; }
    const arch = fs.readdirSync(d).filter(f => /\.xlsx?$/i.test(f)).map(f => ({ nombre: f, datos: fs.readFileSync(path.join(d, f)) }));
    const x = (await I.importar(M, arch)).resumen;
    console.log('== ' + c.dir + ' (' + x.formato + ') ==');
    ok(x.formato === c.formato, 'formato ' + x.formato);
    ok(x.items === c.items && x.sinApu.length === 0, `${x.items} ítems, todos con análisis`);
    ok(Math.abs(x.totalRecalculado - c.total) < 0.005, `total ${x.totalRecalculado} (esperado ${c.total})`);
    ok(x.deArchivo.length === c.deArchivo, `${x.deArchivo.length} ítem(s) con el P.U. del archivo (esperado ${c.deArchivo})`);
    if (c.incoherentes !== undefined) ok(x.incoherentes.length === c.incoherentes, `${x.incoherentes.length} análisis que no suman su total`);
    if (c.monedaCruzada !== undefined) ok(x.monedaCruzada.length === c.monedaCruzada, `${x.monedaCruzada.length} precio(s) en Bs copiados como $US`);
  }

  console.log(errores.length ? '\nPROBLEMAS: ' + errores.length : '\nTodo en orden');
  process.exit(errores.length ? 1 : 0);
})().catch(e => { console.log('Error: ' + (e && e.stack || e)); process.exit(1); });
