/* =========================================================================
   Prueba del guardia de versiones de hacer.js
   -------------------------------------------------------------------------
   El `?v=N` de index.html y el número de sw.js tienen que subir juntos. Si se
   separan, el navegador sigue sirviendo la versión vieja de su caché — y
   empaquetarlos así congela el desajuste adentro del instalador.

   Se arman carpetas de mentira en el directorio temporal y se comprueba que
   el guardia acepte lo correcto y corte lo demás.

       node pruebas/version.test.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { versionWeb } = require('../hacer.js');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'openboq-version-'));
let fallos = 0;

function carpeta(nombre, indice, sw) {
  const dir = path.join(RAIZ, nombre);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), indice, 'utf8');
  fs.writeFileSync(path.join(dir, 'sw.js'), sw, 'utf8');
  return dir;
}

function comprobar(titulo, fn, esperado) {
  let obtenido;
  try { obtenido = 'ok:' + fn(); }
  catch (e) { obtenido = 'corta:' + e.message.split('\n')[0]; }

  const bien = obtenido.indexOf(esperado) === 0;
  if (!bien) fallos++;
  console.log((bien ? '  ok   ' : '  FALLA') + '  ' + titulo);
  if (!bien) console.log('          esperado que empiece con: ' + esperado + '\n          y fue: ' + obtenido);
}

const SW = n => "const CACHE = 'openboq-v" + n + "';\nconst V = '" + n + "';\n";

console.log('\nguardia de versiones\n');

comprobar('index.html y sw.js coinciden', () => versionWeb(
  carpeta('bien', '<script src="js/ui.js?v=46"></script><link href="css/e.css?v=46">', SW(46))
), 'ok:v46');

comprobar('sw.js quedó atrás', () => versionWeb(
  carpeta('atrasado', '<script src="js/ui.js?v=47"></script>', SW(46))
), 'corta:desajuste de versión');

comprobar('index.html mezcla dos números', () => versionWeb(
  carpeta('mezcla', '<script src="js/ui.js?v=46"></script><script src="js/x.js?v=45"></script>', SW(46))
), 'corta:index.html mezcla varios');

comprobar('index.html sin ningún ?v=', () => versionWeb(
  carpeta('sinv', '<script src="js/ui.js"></script>', SW(46))
), 'corta:index.html no tiene');

comprobar('sw.js sin la constante V', () => versionWeb(
  carpeta('sinV', '<script src="js/ui.js?v=46"></script>', "const CACHE = 'openboq-v46';\n")
), 'corta:sw.js: no se encontró V');

comprobar('el proyecto de verdad', () => versionWeb(), 'ok:v');

fs.rmSync(RAIZ, { recursive: true, force: true });

console.log('\n' + (fallos ? fallos + ' FALLA(S)\n' : 'todo bien\n'));
process.exit(fallos ? 1 : 0);
