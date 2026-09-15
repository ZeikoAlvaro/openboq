/* NADA se guarda solo. Cualquier cambio del proyecto entra como «cambio en
   prueba» y espera «✔ Guardar cambios» o «↺ Descartar».

   Esta prueba existe por lo que reportó Alvaro: agregar un albañil y un
   contramaestre a un B-2 se guardaba en el acto, sin dar opción de deshacerlo.
   Lo mismo pasaba al crear un ítem, traerlo de la Base de Datos, duplicarlo,
   borrarlo, crear un insumo en el B-3 o actualizar precios.

   Acá se comprueba lo que interfaz.test.js no puede: que «Descartar» de verdad
   revierte. Descartar reconstruye el proyecto entero (M.deserializar), así que
   toda referencia tomada antes queda apuntando a objetos viejos — por eso todo
   se vuelve a leer por id después de cada descarte. */
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
try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const $ = s => w.document.querySelector(s);
const clic = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const boton = re => Array.from(w.document.querySelectorAll('#modalPie button')).find(b => re.test(b.textContent));
const M = w.MOTOR;
const hayEnsayo = () => $('#accEnsayo').style.display !== 'none';
const guardar = () => clic(w.document.querySelector('[data-acc="guardarCambios"]'));
/** «Descartar» de la barra de estado pide confirmación en su propio aviso. */
const descartar = () => { clic(w.document.querySelector('[data-acc="descartarCambios"]')); clic(boton(/Descartar/)); };
const nItems = () => M.proyecto().modulos.reduce((s, m) => s + m.items.length, 0);
const nInsumos = () => Object.keys(M.proyecto().insumos).length;

/** Trae el primer resultado de la Base de Datos al presupuesto. */
function traerDeLaBase(texto) {
  clic(w.document.querySelector('#tabs button[data-v="base"]'));
  $('#buscaBase').value = texto;
  $('#buscaBase').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  clic(w.document.querySelector('#listaBase li'));
  clic(w.document.querySelector('[data-acc="insertarApu"]'));
  clic(boton(/Traer al presupuesto/));
}

console.log('== Traer un ítem de la Base de Datos ==');
{
  const antes = nItems();
  traerDeLaBase('revoque');
  ok(nItems() === antes + 1, 'el ítem entró: ' + nItems());
  ok(hayEnsayo(), 'y queda en prueba, no guardado');
  descartar();
  ok(nItems() === antes, '«Descartar» lo saca: ' + nItems());
  ok(!hayEnsayo(), 'y cierra el ensayo');
  // ahora en serio, para tener con qué seguir
  traerDeLaBase('revoque');
  guardar();
  ok(!hayEnsayo() && nItems() === antes + 1, 'guardado, queda un ítem para el resto');
}

console.log('== Agregar mano de obra al B-2 ==');
{
  const id = M.proyecto().modulos[0].items[0].id;
  M.proyecto().itemSel = id;
  clic(w.document.querySelector('#tabs button[data-v="analisis"]'));
  $('#selItemAnalisis').value = id;
  $('#selItemAnalisis').dispatchEvent(new w.Event('change', { bubbles: true }));
  const antes = M.getItem(id).comp.length;

  clic(w.document.querySelector('[data-acc="addInsumo"]'));
  $('#aDesc').value = 'CONTRAMAESTRE'; $('#aUnd').value = 'hr';
  $('#aPrecio').value = '30'; $('#aRend').value = '2';
  clic(boton(/Agregar al análisis/));
  ok(M.getItem(id).comp.length === antes + 1, 'el contramaestre entró al análisis');
  ok(hayEnsayo(), 'y NO se guardó solo: queda en prueba');
  ok($('#lblEnsayo').textContent === 'ANÁLISIS (B-2)', 'la barra dice ANÁLISIS (B-2)');

  descartar();
  ok(M.getItem(id).comp.length === antes, '«Descartar» lo saca del análisis: ' + M.getItem(id).comp.length);
}

console.log('== Crear un insumo en el B-3 ==');
{
  clic(w.document.querySelector('#tabs button[data-v="insumos"]'));
  const antes = nInsumos();
  clic(w.document.querySelector('[data-acc="nuevoInsumo"]'));
  $('#nT').value = 'O'; $('#nD').value = 'ALBAÑIL'; $('#nU').value = 'hr'; $('#nP').value = '25';
  clic(boton(/Crear/));
  ok(nInsumos() === antes + 1, 'el albañil se creó: ' + nInsumos());
  ok(hayEnsayo() && $('#lblEnsayo').textContent === 'INSUMOS (B-3)', 'queda en prueba en INSUMOS (B-3)');
  descartar();
  ok(nInsumos() === antes, '«Descartar» lo saca: ' + nInsumos());
}

console.log('== Ítems del presupuesto: crear, duplicar y borrar ==');
{
  clic(w.document.querySelector('#tabs button[data-v="presupuesto"]'));
  const antes = nItems();

  clic(w.document.querySelector('[data-acc="nuevoItem"]'));
  $('#niD').value = 'EXCAVACIÓN MANUAL DE PRUEBA';
  clic(boton(/Crear y analizar/));
  ok(nItems() === antes + 1, 'ítem nuevo creado: ' + nItems());
  ok(hayEnsayo(), 'crear un ítem tampoco se guarda solo');
  descartar();
  ok(nItems() === antes, '«Descartar» lo saca: ' + nItems());

  M.proyecto().itemSel = M.proyecto().modulos[0].items[0].id;
  clic(w.document.querySelector('#tabs button[data-v="presupuesto"]'));
  clic(w.document.querySelector('[data-acc="dupItem"]'));
  ok(nItems() === antes + 1 && hayEnsayo(), 'duplicar queda en prueba');
  descartar();
  ok(nItems() === antes, '«Descartar» deshace el duplicado');

  M.proyecto().itemSel = M.proyecto().modulos[0].items[0].id;
  clic(w.document.querySelector('[data-acc="delItem"]'));
  clic(boton(/Eliminar/));
  ok(nItems() === antes - 1 && hayEnsayo(), 'borrar un ítem queda en prueba');
  descartar();
  ok(nItems() === antes, '«Descartar» devuelve el ítem borrado');
}

console.log('== Incidencias: volver a los valores por defecto ==');
{
  const P = M.proyecto();
  P.params.gg = 25;
  clic(w.document.querySelector('#tabs button[data-v="incidencias"]'));
  clic(w.document.querySelector('[data-acc="incidenciasDef"]'));
  clic(boton(/Aplicar/));
  ok(M.proyecto().params.gg === M.PARAMS_DEF.gg, 'los porcentajes volvieron al valor por defecto');
  ok(hayEnsayo(), 'y queda en prueba');
  descartar();
  ok(M.proyecto().params.gg === 25, '«Descartar» devuelve el 25 %: ' + M.proyecto().params.gg);
}

if (errores.length) { console.log('\n' + errores.length + ' fallo(s):'); errores.forEach(e => console.log(' - ' + e)); w.close(); process.exit(1); }
console.log('\ntodo en orden');
w.close();
process.exit(0);
