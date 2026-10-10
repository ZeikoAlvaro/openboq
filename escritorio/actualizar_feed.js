#!/usr/bin/env node
'use strict';

/* Recalcula el feed de actualización de un canal DESPUÉS de firmar.

   electron-builder escribe en `latest.yml` / `universal.yml` / `arm64.yml` la
   huella (sha512) y el tamaño del instalador recién armado. Si SignPath lo
   firma después, el .exe cambia y el feed queda mintiendo: electron-updater
   bajaría el instalador, vería que la huella no coincide y lo rechazaría.

   Este script, para cada `*-instalador.exe` de la carpeta del canal:
     1. rehace su `.blockmap` con app-builder (el mismo binario que usa
        electron-builder) y toma de ahí la huella y el tamaño nuevos;
     2. los escribe en el *.yml del canal (entrada de `files` y `sha512` de
        arriba).

   Uso:  node actualizar_feed.js x64|universal|arm64 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AQUI = __dirname;
const canal = process.argv[2];
const FEED = { x64: 'latest.yml', universal: 'universal.yml', arm64: 'arm64.yml' };
if (!FEED[canal]) { console.error('uso: node actualizar_feed.js x64|universal|arm64'); process.exit(1); }

const carpeta = path.join(AQUI, 'salida', canal);
const rutaYml = path.join(carpeta, FEED[canal]);
if (!fs.existsSync(rutaYml)) { console.error('no está ' + rutaYml); process.exit(1); }

/* app-builder viene con electron-builder (paquete app-builder-bin) */
const appBuilder = require('app-builder-bin').appBuilderPath;

let yml = fs.readFileSync(rutaYml, 'utf8');
const exes = fs.readdirSync(carpeta).filter(f => /-instalador\.exe$/.test(f));
if (!exes.length) { console.error('no hay instaladores en ' + carpeta); process.exit(1); }

for (const exe of exes) {
  const ruta = path.join(carpeta, exe);
  const r = JSON.parse(execFileSync(appBuilder,
    ['blockmap', '--input', ruta, '--output', ruta + '.blockmap'], { encoding: 'utf8' }));

  /* la entrada de `files` de este .exe: url, sha512, size */
  const esc = exe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entrada = new RegExp('(- url: ' + esc + '\\r?\\n\\s+sha512: )\\S+(\\r?\\n\\s+size: )\\d+');
  if (!entrada.test(yml)) { console.error(exe + ' no figura en ' + FEED[canal]); process.exit(1); }
  yml = yml.replace(entrada, '$1' + r.sha512 + '$2' + r.size);

  /* el `path:` de arriba apunta al instalador principal; su sha512 va debajo */
  const arriba = new RegExp('(\\npath: ' + esc + '\\r?\\nsha512: )\\S+');
  yml = yml.replace(arriba, '$1' + r.sha512);

  console.log('  ' + exe + '  ' + (r.size / 1048576).toFixed(1) + ' MB  sha512 ' + r.sha512.slice(0, 16) + '…');
}

fs.writeFileSync(rutaYml, yml);
console.log('Feed ' + FEED[canal] + ' al día con los instaladores firmados.');
