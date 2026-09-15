/* Insumos repetidos: al traer una actividad nueva a un proyecto que ya tiene
   insumos cargados, y al depurar los que quedaron duplicados. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', url: 'file:///app/index.html' });
const w = dom.window;
const errs = [];
w.alert = m => errs.push('ALERT: ' + m);
['Blob', 'TextDecoder', 'TextEncoder', 'URL'].forEach(k => { if (!w[k]) w[k] = globalThis[k]; });
w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => { };
const src = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;window.MOTOR=MOTOR;';
try { w.eval(src); } catch (e) { console.log('EVAL ERROR', e); process.exit(1); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $ = s => w.document.querySelector(s);
const $$ = s => Array.from(w.document.querySelectorAll(s));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errs.push(m); };
const M = w.MOTOR;
const clic = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const traer = () => { clic($('[data-acc="insertarApu"]')); };
const aceptar = () => $$('#modalPie button')[1].click();

console.log('== Un proyecto con un ítem ya cargado ==');
$('#buscaBase').value = 'hormigon';
$('#buscaBase').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
clic(w.document.querySelectorAll('#listaBase li')[0]);
traer(); aceptar();
const n1 = Object.keys(M.proyecto().insumos).length;
ok(n1 > 0, 'insumos del proyecto: ' + n1);

/* se le corrige el precio a un insumo, como hace el usuario en la obra */
const ins0 = M.insumosOrdenados()[0];
const precioBase = ins0.p;
ins0.p = Math.round((precioBase * 1.4 + 1) * 100) / 100;
console.log('   «' + ins0.d + '» pasa de ' + precioBase + ' a ' + ins0.p);

console.log('== Se trae otra actividad que usa el mismo insumo ==');
traer();
const conf = $('#iConf');
ok(conf && conf.innerHTML.includes('ya están en el proyecto a otro precio'), 'avisa del insumo repetido');
ok(conf.innerHTML.includes(M.fmt(ins0.p, 2)), 'muestra el precio del proyecto: ' + M.fmt(ins0.p, 2));
const radios = $$('#iConf input[name="iConfR"]');
ok(radios.length === 3, 'tres opciones: usar los del proyecto, actualizar, dejar los dos');
ok(radios[0].checked, 'por defecto usa los precios del proyecto');
const fila = $$('#tApu tr').find(tr => tr.textContent.includes(ins0.d));
ok(!!fila && Number(fila.querySelector('[data-p]').value) === ins0.p,
  'la tabla ya trae el precio del proyecto');
aceptar();
ok(Object.keys(M.proyecto().insumos).length === n1, 'no se duplicó ningún insumo');
ok(M.duplicadosInsumo().length === 0, 'no quedan insumos repetidos');

console.log('== Opción: actualizar el proyecto con los precios de la Base de Datos ==');
traer();
$$('#iConf input[name="iConfR"]')[1].checked = true;
$$('#iConf input[name="iConfR"]')[1].dispatchEvent(new w.Event('change', { bubbles: true }));
aceptar();
ok(Math.abs(M.proyecto().insumos[ins0.id].p - precioBase) < 0.005,
  'el insumo del proyecto quedó con el precio de la Base de Datos: ' + M.proyecto().insumos[ins0.id].p);
ok(Object.keys(M.proyecto().insumos).length === n1, 'sigue sin duplicados');

console.log('== Opción: dejar los dos, y después depurarlos ==');
ins0.p = Math.round((precioBase * 1.4 + 1) * 100) / 100;    // se vuelve a separar el precio
traer();
$$('#iConf input[name="iConfR"]')[2].checked = true;
$$('#iConf input[name="iConfR"]')[2].dispatchEvent(new w.Event('change', { bubbles: true }));
aceptar();
ok(Object.keys(M.proyecto().insumos).length > n1,
  'quedan dos versiones del mismo insumo: ' + Object.keys(M.proyecto().insumos).length);
const G = M.duplicadosImportado = M.duplicadosInsumo();
ok(G.length > 0, 'el depurador los encuentra: ' + G.length + ' grupo(s)');
clic($('[data-acc="depurarInsumos"]'));
ok($('#modalCuerpo').innerHTML.includes('SE QUEDA'), 'el diálogo de depuración lista los repetidos');
aceptar();
ok(M.duplicadosInsumo().length === 0, 'después de unificar no quedan repetidos');
ok(Object.keys(M.proyecto().insumos).length === n1, 'vuelve a ' + n1 + ' insumos');
/* los análisis siguen apuntando a insumos que existen */
let colgados = 0;
M.proyecto().modulos.forEach(m => m.items.forEach(it =>
  it.comp.forEach(c => { if (!M.proyecto().insumos[c.ins]) colgados++; })));
ok(colgados === 0, 'ningún análisis quedó apuntando a un insumo borrado');

console.log('\n' + (errs.length ? 'PROBLEMAS:\n - ' + errs.join('\n - ') : 'INSUMOS REPETIDOS CORRECTO'));
process.exit(errs.length ? 1 : 0);
