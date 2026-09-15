/* =========================================================================
   OpenBOQ — corre todas las pruebas
   -------------------------------------------------------------------------
   `node --test pruebas/*.test.js` no sirve acá por dos motivos: cada prueba
   termina en process.exit y en Windows el shell no expande el comodín. Este
   archivo las corre una por una, en su propio proceso, y resume al final.

   Uso:
       npm test
       node herramientas/probar.js
       node herramientas/probar.js interfaz         (solo las que digan «interfaz»)
       node herramientas/probar.js --detalle        (muestra la salida completa)
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const DIR = path.join(RAIZ, 'pruebas');

const args = process.argv.slice(2);
const DETALLE = args.includes('--detalle');
const filtro = args.filter(a => !a.startsWith('--'))[0] || '';

const archivos = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !filtro || f.includes(filtro))
  .sort();

if (!archivos.length) {
  console.error('\nNo hay pruebas que coincidan con «' + filtro + '»\n');
  process.exit(1);
}

/* jsdom se resuelve desde node_modules del proyecto; si alguien lo tiene
   instalado en otro lado, NODE_PATH sigue funcionando igual. */
if (!fs.existsSync(path.join(RAIZ, 'node_modules', 'jsdom')) && !process.env.NODE_PATH) {
  console.error('\nFalta jsdom. Instalarlo con:  npm install\n');
  process.exit(1);
}

console.log('\nOpenBOQ — ' + archivos.length + ' prueba(s)\n');

/* Archivos que no están en el repositorio público: el catálogo sin cifrar, el
   panel de administración, la lista de códigos de acceso y el módulo de
   PRESCOM. Quien los tenga corre todas las pruebas; quien no, ve omitidas las
   que los necesitan, en vez de verlas fallar por algo que no depende de su
   cambio. */
const OPCIONALES = ['data/catalogo.js', 'panel.html', 'acceso.json',
  'js/importador.js', 'js/exportador.js'];
const faltantes = OPCIONALES.filter(a => !fs.existsSync(path.join(RAIZ, a)));

const fallaron = [];
const omitidas = [];
const arranque = Date.now();

for (const f of archivos) {
  const fuente = fs.readFileSync(path.join(DIR, f), 'utf8');
  const falta = faltantes.find(a => fuente.includes(a) || fuente.includes(path.basename(a)));
  if (falta) {
    omitidas.push(f);
    console.log('  –  ' + f.replace('.test.js', '').padEnd(26) + '  omitida: falta ' + falta);
    continue;
  }
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8', cwd: RAIZ });
  const ms = Date.now() - t;
  const bien = r.status === 0;
  if (!bien) fallaron.push(f);

  console.log('  ' + (bien ? '✔' : '✖') + '  ' + f.replace('.test.js', '').padEnd(26) +
    String(ms).padStart(6) + ' ms');

  const salida = (r.stdout || '') + (r.stderr || '');
  if (DETALLE) console.log(salida.split('\n').map(l => '        ' + l).join('\n'));
  else if (!bien) {
    /* de lo que falló, solo las líneas que dicen qué falló */
    salida.split('\n')
      .filter(l => /✗|PROBLEMAS|Error|error:/i.test(l))
      .slice(0, 8)
      .forEach(l => console.log('        ' + l.trim()));
  }
}

const seg = ((Date.now() - arranque) / 1000).toFixed(1);
const corridas = archivos.length - omitidas.length;
console.log('\n  ' + (corridas - fallaron.length) + '/' + corridas +
  ' en ' + seg + ' s' + (omitidas.length ? '   (' + omitidas.length + ' omitidas)' : '') +
  (fallaron.length ? '   ✖ fallaron: ' + fallaron.join(', ') : '   todo en orden'));
console.log('');

process.exit(fallaron.length ? 1 : 0);
