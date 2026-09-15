/* =========================================================================
   OpenBOQ — armado de la versión portable
   -------------------------------------------------------------------------
   Genera una carpeta portable con la aplicación y la Base de Datos, y la
   comprime en un .zip listo para pasar a los probadores.

   El catálogo va EN CLARO y sin clave: OpenBOQ pasó a ser de acceso libre.
   Antes viajaba cifrado y había que entregar la frase por otro canal.

   Uso:
       node herramientas/empaquetar.js [versión]

   Solo usa módulos incluidos en Node (crypto, zlib, fs). Sin dependencias.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const RAIZ = path.resolve(__dirname, '..');

const VERSION = process.argv[2] || '1.0';
const DESTINO = process.env.OPENBOQ_SALIDA || path.join(RAIZ, '..');
const SALIDA = path.join(DESTINO, 'OpenBOQ-Portable-v' + VERSION);

/* --------------------------------- ZIP ---------------------------------- */
function crearZip(archivos, destino) {          // archivos: [{nombre, datos}]
  const partes = [], central = [];
  let off = 0;
  const fecha = () => {
    const d = new Date();
    const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const f = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { t, f };
  };
  const { t, f } = fecha();

  archivos.forEach(a => {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const crudo = a.datos;
    const comp = zlib.deflateRawSync(crudo, { level: 9 });
    const usar = comp.length < crudo.length ? comp : crudo;
    const metodo = usar === comp ? 8 : 0;
    const crc = crc32(crudo);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(metodo, 8); lh.writeUInt16LE(t, 10); lh.writeUInt16LE(f, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(usar.length, 18); lh.writeUInt32LE(crudo.length, 22);
    lh.writeUInt16LE(nombre.length, 26); lh.writeUInt16LE(0, 28);
    partes.push(lh, nombre, usar);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(metodo, 10); cd.writeUInt16LE(t, 12); cd.writeUInt16LE(f, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(usar.length, 20); cd.writeUInt32LE(crudo.length, 24);
    cd.writeUInt16LE(nombre.length, 28); cd.writeUInt32LE(off, 42);
    central.push(cd, nombre);
    off += 30 + nombre.length + usar.length;
  });

  const cdIni = off;
  let cdLen = 0;
  central.forEach(c => cdLen += c.length);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(cdLen, 12); fin.writeUInt32LE(cdIni, 16);
  fs.writeFileSync(destino, Buffer.concat(partes.concat(central, [fin])));
}

const TABLA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLA[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* --------------------------------- armado -------------------------------- */
const INCLUIR = [
  'index.html', 'icono.svg', 'manifest.webmanifest', 'sw.js', 'OpenBOQ.bat',
  'css/estilo.css',
  /* acceso.js va incluido, pero en la versión portable no hace nada: al
     abrirse con file:// no hay servidor contra el cual verificar. */
  'js/motor.js', 'js/acceso.js', 'js/importador.js', 'js/exportador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js',
  'ejemplos/demo-aula-escolar.boq'
];

function copiar(rel, destino) {
  const dst = path.join(destino, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, rel), dst);
}

function main() {
  console.log('OpenBOQ — armando la versión portable v' + VERSION + '\n');

  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });

  INCLUIR.forEach(r => {
    if (!fs.existsSync(path.join(RAIZ, r))) { console.log('  · falta (se omite): ' + r); return; }
    copiar(r, SALIDA);
  });

  /* La Base de Datos, en claro. Si no está generada se avisa y el paquete
     sale igual: la aplicación arranca sin ella. */
  const catOrigen = path.join(RAIZ, 'data', 'catalogo.js');
  let catBytes = 0;
  if (fs.existsSync(catOrigen)) {
    fs.mkdirSync(path.join(SALIDA, 'data'), { recursive: true });
    fs.copyFileSync(catOrigen, path.join(SALIDA, 'data', 'catalogo.js'));
    catBytes = fs.statSync(catOrigen).size;
  } else {
    console.log('  · sin data/catalogo.js: el paquete sale sin Base de Datos');
  }

  /* textos para el probador */
  const leeme = fs.readFileSync(path.join(__dirname, 'plantillas', 'LEEME.txt'), 'utf8')
    .replace(/\{VERSION\}/g, VERSION);
  fs.writeFileSync(path.join(SALIDA, 'LEEME PRIMERO.txt'), leeme, 'utf8');
  fs.copyFileSync(path.join(__dirname, 'plantillas', 'GUIA-DE-PRUEBAS.md'),
    path.join(SALIDA, 'GUIA DE PRUEBAS.md'));

  /* zip */
  const archivos = [];
  (function recorrer(dir, base) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      const rel = (base ? base + '/' : '') + e.name;
      if (e.isDirectory()) recorrer(p, rel);
      else archivos.push({ nombre: 'OpenBOQ-Portable-v' + VERSION + '/' + rel, datos: fs.readFileSync(p) });
    });
  })(SALIDA, '');
  const zipDest = SALIDA + '.zip';
  crearZip(archivos, zipDest);

  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  if (catBytes) console.log('  catálogo:  ' + mb(catBytes) + ' (en claro)');
  console.log('  carpeta:   ' + SALIDA);
  console.log('  archivos:  ' + archivos.length);
  console.log('  ZIP:       ' + zipDest + '  (' + mb(fs.statSync(zipDest).size) + ')');
  console.log('\n  El paquete no lleva clave: se abre index.html y funciona.\n');
}

main();
