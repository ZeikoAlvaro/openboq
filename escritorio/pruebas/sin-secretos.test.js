/* El paquete del escritorio NUNCA puede llevar la firma.

   Pasó el 10/10/2026: la lista `files` de electron-builder.base.json
   empaquetaba todo escritorio/ y metió firma-local/ (el .pfx y su clave)
   dentro del app.asar de los instaladores publicados en GitHub. Esta prueba
   revisa la configuración y, si hay un armado en salida/, el asar mismo. */
'use strict';

const fs = require('fs');
const path = require('path');

const AQUI = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => console.log((c ? '  ok     ' : '  FALLA  ') + m) || (c ? 0 : errores.push(m));

const cfg = JSON.parse(fs.readFileSync(path.join(AQUI, 'electron-builder.base.json'), 'utf8'));
const files = cfg.files || [];
ok(files.includes('!firma-local${/*}') && files.includes('!firma-local'), 'files excluye firma-local/');
ok(files.includes('!*.pfx') && files.includes('!clave*.txt'), 'files excluye .pfx y clave*.txt');

/* y al revés: lo que el paquete SÍ tiene que llevar. drive.html es la página
   de vuelta del permiso de Google Drive (registrada en Google como
   http://127.0.0.1:8731/drive.html); hasta la 2.7.1 no viajaba y Drive no
   podía volver nunca en el escritorio. */
const extra = (cfg.extraResources || []).map(x => x.from);
for (const f of ['../index.html', '../drive.html', '../privacidad.html'])
  ok(extra.includes(f), 'el paquete lleva ' + f.slice(3));

/* si hay algún armado, mirar adentro del asar */
let asar = null;
try { asar = require('@electron/asar'); } catch (e) { try { asar = require('asar'); } catch (e2) { /* sin asar */ } }
const PROHIBIDO = /(^|[\\/])(firma-local|[^\\/]*\.pfx|clave[^\\/]*\.txt)([\\/]|$)/i;
for (const canal of ['x64', 'universal', 'arm64']) {
  const dir = path.join(AQUI, 'salida', canal);
  if (!asar || !fs.existsSync(dir)) continue;
  for (const sub of fs.readdirSync(dir)) {
    const ruta = path.join(dir, sub, 'resources', 'app.asar');
    if (!fs.existsSync(ruta)) continue;
    const malos = asar.listPackage(ruta).filter(f => PROHIBIDO.test(f));
    ok(!malos.length, canal + '/' + sub + ': app.asar sin secretos' + (malos.length ? ' — tiene ' + malos.slice(0, 3).join(', ') : ''));
  }
}

if (errores.length) { console.log('\n' + errores.length + ' falla(s)'); process.exit(1); }
console.log('\ntodo bien');
