/* Prueba de la versión portable: el ZIP se arma, trae la Base de Datos EN
   CLARO —OpenBOQ es de acceso libre y ya no hay clave— y la aplicación
   levanta con el catálogo cargado desde el arranque, sin pedir nada.

   Lo que sigue importando es qué NO entra al paquete: las muestras de
   proyectos reales y las herramientas de armado. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const raiz = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errores.push(m); };

console.log('== Empaquetado ==');
const tmp = require('os').tmpdir();
cp.execSync('node ' + JSON.stringify(path.join(raiz, 'herramientas', 'empaquetar.js')) + ' TEST',
  { cwd: raiz, stdio: 'pipe', env: Object.assign({}, process.env, { OPENBOQ_SALIDA: tmp }) });
const dir = path.join(tmp, 'OpenBOQ-Portable-vTEST');
const zip = dir + '.zip';
ok(fs.existsSync(zip), 'se generó el ZIP');

const esperados = ['index.html', 'OpenBOQ.bat', 'LEEME PRIMERO.txt', 'GUIA DE PRUEBAS.md',
  'data/catalogo.js', 'js/motor.js', 'css/estilo.css', 'ejemplos/demo-aula-escolar.boq'];
esperados.forEach(f => ok(fs.existsSync(path.join(dir, f)), 'incluye ' + f));

ok(!fs.existsSync(path.join(dir, 'js', 'cifrado.js')), 'ya no lleva js/cifrado.js');
ok(!fs.existsSync(path.join(dir, 'datos', 'catalogo.obq.js')), 'ya no lleva el catálogo cifrado');
ok(!fs.existsSync(path.join(dir, 'muestras')), 'NO incluye la carpeta muestras');
ok(!fs.existsSync(path.join(dir, 'herramientas')), 'NO incluye las herramientas de armado');
ok(!fs.existsSync(path.join(dir, 'supabase')), 'NO incluye las credenciales de Supabase');

const cat = fs.readFileSync(path.join(dir, 'data', 'catalogo.js'), 'utf8');
ok(/window\.OPENBOQ_DB\s*=/.test(cat), 'la Base de Datos va en claro y legible');

console.log('== La aplicación levanta sin pedir clave ==');
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///portable/index.html' });
const w = dom.window;
w.alert = m => errores.push('ALERT: ' + m);
try { Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true }); }
catch (e) { w.crypto = globalThis.crypto; }
['TextEncoder', 'TextDecoder', 'atob', 'URL', 'Blob'].forEach(k => { if (!w[k]) w[k] = globalThis[k]; });

const src = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/exportador.js', 'js/xlsx.js',
  'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;window.MOTOR=MOTOR;';
w.eval(src);
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const M = w.MOTOR;
ok(typeof w.CIFRADO === 'undefined', 'no hay rastro del módulo de cifrado');
ok(M.BD.bases.length > 0, 'el catálogo está cargado desde el arranque: ' + M.BD.bases.length + ' bases');
ok(M.BD.stats.apus > 0, M.BD.stats.apus + ' análisis disponibles sin escribir ninguna clave');
ok(!w.document.querySelector('[data-acc="abrirCatalogo"]'), 'no queda ningún botón de clave');

const r = M.buscarEnBase(M.BD.bases[0].id, 'hormigon', true, 20);
ok(r.length > 0, 'la búsqueda funciona (' + r.length + ' resultados)');
M.proyectoNuevo('T');
const it = M.importarApu(r[0].base, r[0].apu, 1);
ok(M.analisis(it).pu > 0, 'se puede insertar un ítem del catálogo (PU ' + M.analisis(it).pu + ')');

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'VERSIÓN PORTABLE CORRECTA'));
fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(zip, { force: true });
process.exit(errores.length ? 1 : 0);
