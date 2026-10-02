#!/usr/bin/env node
'use strict';

/* Publica los instaladores y el feed de actualizaciones como una RELEASE de
   GitHub en el repositorio público. Reemplaza al viejo «subir a Cloudflare
   Pages», que no servía porque Pages rechaza archivos de más de 25 MiB.
 *
 * Sube, a una sola release con la etiqueta v<version>:
 *   - los tres instaladores  OpenBOQ-<v>-<canal>-instalador.exe
 *   - los tres feeds          latest.yml (x64), universal.yml, arm64.yml
 *   - los .blockmap           para que la actualización baje solo los cambios
 *
 * Cada canal estampa su propio *.yml, así que conviven sin pisarse y cada
 * copia instalada lee el suyo. electron-updater (provider github) busca la
 * última release y baja el *.yml de su canal.
 *
 * Uso:
 *   node publicar_release.js            crea/actualiza la release de esta versión
 *   node publicar_release.js --borrador la deja como borrador (no la ven aún)
 *
 * Requiere el CLI `gh` autenticado (gh auth status).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AQUI = __dirname;
const SALIDA = path.join(AQUI, 'salida');
const OWNER = 'ZeikoAlvaro';
const REPO = 'openboq';
const CANALES = ['x64', 'universal', 'arm64'];

const VERSION = JSON.parse(fs.readFileSync(path.join(AQUI, 'package.json'), 'utf8')).version;
const TAG = 'v' + VERSION;
const BORRADOR = process.argv.includes('--borrador');

function gh(args, opciones) {
  const r = spawnSync('gh', args, Object.assign({ encoding: 'utf8' }, opciones || {}));
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
}

/* Reúne los archivos a subir de todos los canales. */
function reunir() {
  const archivos = [];
  CANALES.forEach(canal => {
    const dir = path.join(SALIDA, canal);
    if (!fs.existsSync(dir)) { console.log('   (falta el canal ' + canal + ', se omite)'); return; }
    fs.readdirSync(dir).forEach(f => {
      if (f.indexOf('builder-debug') === 0) return;
      if (/\.(exe|yml|blockmap)$/i.test(f)) archivos.push(path.join(dir, f));
    });
  });
  return archivos;
}

function main() {
  console.log('OpenBOQ — publicar release ' + TAG + ' en ' + OWNER + '/' + REPO);

  if (gh(['--version']).codigo !== 0) {
    console.error('No se encontró el CLI `gh`. Instalarlo y correr `gh auth login`.');
    process.exit(1);
  }

  const archivos = reunir();
  const yml = archivos.filter(f => /\.yml$/i.test(f)).map(f => path.basename(f));
  const exe = archivos.filter(f => /instalador\.exe$/i.test(f)).map(f => path.basename(f));
  if (!exe.length || !yml.length) {
    console.error('No hay instaladores o feeds en ' + SALIDA + '. Correr antes `npm run armar`.');
    process.exit(1);
  }
  console.log('   ' + exe.length + ' instalador(es), ' + yml.length + ' feed(s), '
    + archivos.length + ' archivos en total.');

  /* ¿Ya existe la release? */
  const existe = gh(['release', 'view', TAG, '--repo', OWNER + '/' + REPO]).codigo === 0;

  if (!existe) {
    console.log('   creando la release…');
    const args = ['release', 'create', TAG,
      '--repo', OWNER + '/' + REPO,
      '--title', 'OpenBOQ ' + VERSION,
      '--notes', 'Versión ' + VERSION + ' del OpenBOQ de escritorio. Instaladores '
        + 'para Windows y feed de actualización automática.'];
    if (BORRADOR) args.push('--draft');
    const r = gh(args);
    if (r.codigo !== 0) { console.error(r.salida); process.exit(1); }
  } else {
    console.log('   la release ya existe: se reemplazan los archivos.');
  }

  /* Subir (reemplazando) cada archivo. */
  const r = gh(['release', 'upload', TAG, '--repo', OWNER + '/' + REPO, '--clobber'].concat(archivos),
    { stdio: 'inherit' });
  if (r.codigo !== 0) { console.error('Falló la subida de archivos.'); process.exit(1); }

  console.log('\nListo. Feed de actualización activo en:');
  console.log('   https://github.com/' + OWNER + '/' + REPO + '/releases/tag/' + TAG);
  console.log('Las copias instaladas la van a encontrar solas al buscar actualizaciones.');
}

main();
