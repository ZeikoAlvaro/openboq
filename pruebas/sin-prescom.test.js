/* La aplicación sin el módulo de PRESCOM.

   Importar y exportar a PRESCOM viven en dos archivos aparte que no viajan en
   el repositorio público. Sin ellos la aplicación tiene que arrancar igual,
   sin errores, y sin ofrecer opciones que no puede cumplir: ni la tarjeta
   «Traer de PRESCOM» de la pantalla de inicio ni las entradas del menú.

   Con los módulos presentes, todo tiene que seguir apareciendo.

   Los nombres de los dos archivos se arman en tiempo de ejecución a propósito:
   herramientas/probar.js omite las pruebas que nombran un archivo ausente, y
   esta es justamente la que tiene que correr cuando faltan.              */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const MOD_IMP = 'js/' + ['import', 'ador.js'].join('');
const MOD_EXP = 'js/' + ['export', 'ador.js'].join('');

function arrancar(conPrescom) {
  const archivos = ['js/motor.js', ...(conPrescom ? [MOD_IMP, MOD_EXP] : []),
    'js/xlsx.js', 'js/reportes.js', 'js/ui.js'];
  const src = archivos.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
    '\n;window.MOTOR=MOTOR;window.HAY_IMP=(typeof IMPORTADOR!=="undefined");';
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://openboq.pages.dev/index.html' });
  const w = dom.window;
  w.alert = m => errores.push('ALERT: ' + m);
  w.onerror = m => errores.push('ONERROR: ' + m);
  try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

/** Texto de todas las entradas de un menú de la barra, abriéndolo como el usuario. */
function textoMenu(w, nombre) {
  const boton = w.document.querySelector(`[data-menu="${nombre}"]`);
  if (!boton) return null;
  boton.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const pop = w.document.querySelector('.menu-pop');
  const t = pop ? pop.textContent : '';
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return t;
}

const tarjetaVisible = w => {
  const b = w.document.querySelector('.ini-op[data-acc="importarDDP"]');
  return !!b && b.style.display !== 'none';
};

(async () => {
  console.log('== Sin el módulo de PRESCOM ==');
  let w = arrancar(false);
  await dormir(400);
  ok(w.HAY_IMP === false, 'el módulo no está cargado');
  ok(!!w.document.querySelector('#tabs button[data-v="presupuesto"]'), 'la aplicación arranca');
  ok(!tarjetaVisible(w), 'la pantalla de inicio no ofrece «Traer de PRESCOM»');
  const archivo = textoMenu(w, 'archivo');
  ok(archivo !== null, 'el menú ARCHIVO se abre');
  if (archivo !== null) {
    ok(!/Importar proyecto|archivos sueltos|Exportar a PRESCOM/.test(archivo),
      'ARCHIVO no muestra importar ni exportar a PRESCOM');
    ok(/Nuevo proyecto/.test(archivo) && /Exportar a Excel/.test(archivo),
      'y conserva el resto de sus opciones');
  }
  const herr = textoMenu(w, 'herramientas');
  if (herr !== null) ok(!/archivo importado/.test(herr), 'HERRAMIENTAS no ofrece recalcular los precios del archivo importado');
  ok(w.MOTOR.totalProyecto() >= 0, 'el motor calcula sin el módulo');

  const hay = [MOD_IMP, MOD_EXP].every(f => fs.existsSync(path.join(dir, f)));
  if (hay) {
    console.log('== Con el módulo de PRESCOM ==');
    w = arrancar(true);
    await dormir(400);
    ok(tarjetaVisible(w), 'la pantalla de inicio ofrece «Traer de PRESCOM»');
    const a2 = textoMenu(w, 'archivo');
    ok(/Importar proyecto/.test(a2 || '') && /Exportar a PRESCOM/.test(a2 || ''),
      'ARCHIVO muestra importar y exportar a PRESCOM');
  } else {
    console.log('  · el módulo de PRESCOM no está en esta copia: se omite la segunda mitad');
  }

  const reales = errores.filter(e => !/^ALERT: /.test(e));
  console.log(reales.length ? '\nPROBLEMAS:\n - ' + reales.join('\n - ') : '\nSIN ERRORES');
  process.exit(reales.length ? 1 : 0);
})();
