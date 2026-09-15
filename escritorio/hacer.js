/* =========================================================================
   OpenBOQ escritorio — armador de instaladores
   -------------------------------------------------------------------------
   Genera los instaladores de Windows. Un solo comando por canal.

       node hacer.js todos
       node hacer.js universal
       node hacer.js x64 arm64

   LOS TRES CANALES Y POR QUÉ SON TRES
   -----------------------------------
   Windows 7 y Windows 11 ARM no se cubren con un solo ejecutable:

   · universal → Electron 22.3.27, 32 bits (ia32).
       Electron 22 es la ÚLTIMA versión que arranca en Windows 7 SP1 y 8.1;
       de la 23 en adelante exigen Windows 10. Y al ser de 32 bits corre
       también en todo Windows de 64 bits (por WOW64) y en Windows 10/11 ARM
       (por la emulación de x86 que traen). O sea: este solo instalador cubre
       Windows 7 SP1, 8, 8.1, 10 y 11, en x86, x64 y ARM64.
       Es el que se entrega cuando no se sabe qué máquina hay del otro lado.

   · x64 → Electron actual, 64 bits.
       Windows 10 y 11 de 64 bits. Más rápido, más memoria disponible y con
       Chromium al día. Es el que conviene en las máquinas de la oficina.

   · arm64 → Electron actual, ARM 64 bits.
       Windows 11 ARM (Surface, portátiles Snapdragon) sin emulación.

   AVISO DE SEGURIDAD SOBRE EL CANAL UNIVERSAL
   -------------------------------------------
   Electron 22 dejó de recibir actualizaciones en enero de 2023: lleva
   Chromium 108 sin los parches posteriores. Es el precio de soportar
   Windows 7, que tampoco recibe parches desde 2020. Ese canal se entrega
   solo a quien de verdad tiene Windows 7 u 8; en Windows 10/11 va el x64.
   La ventana corre con contextIsolation, sandbox y sin integración de Node,
   y solo carga contenido local, así que la superficie expuesta es chica —
   pero no es cero.

   REQUISITOS PARA ARMAR
   ---------------------
   · Node 18 o más nuevo en la máquina que arma (no en la que instala).
   · `npm install` hecho dentro de esta carpeta.
   · Internet la primera vez: electron-builder descarga cada versión de
     Electron y las guarda en caché (%LOCALAPPDATA%\electron\Cache).
   · recursos/icono.ico. Si falta, este script lo genera solo.
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AQUI = __dirname;
const WEB = path.resolve(AQUI, '..');            /* la aplicación web */
const SALIDA = path.join(AQUI, 'salida');
const BASE = path.join(AQUI, 'electron-builder.base.json');
const ICONO = path.join(AQUI, 'recursos', 'icono.ico');

/* Dónde se publican los instaladores y su `latest.yml`. Cada canal cuelga de
   su propia carpeta: un equipo con el paquete de 32 bits NO puede recibir el
   de 64, así que los feeds no se mezclan nunca. */
const PUBLICACION = 'https://openboq.pages.dev/descargas/';

/* FIRMA DEL EJECUTABLE
   ---------------------
   Un .exe sin firmar es lo que hace que Avast, Defender y SmartScreen
   protesten en cada arranque: no tienen forma de saber quién lo hizo, así
   que juzgan por heurística y OpenBOQ —que escribe archivos y levanta un
   servidor local— da todas las señales de algo sospechoso. No hay bandera
   que apagar ni línea de código que cambie eso: la única cura de raíz es
   firmar.

   electron-builder firma solo si encuentra el certificado en el ambiente:

       CSC_LINK            ruta al .pfx (o su contenido en base64)
       CSC_KEY_PASSWORD    la contraseña del .pfx

   Con esas dos variables puestas, `npm run armar` sale firmado sin cambiar
   nada más. Sin ellas sale sin firma y se avisa al final del armado.
   Detalles y de dónde sacar un certificado: LEEME-ANTIVIRUS.md */
const FIRMADO = !!(process.env.CSC_LINK || process.env.WIN_CSC_LINK);

/* Tope de tamaño por archivo de Cloudflare Pages: 25 MiB. Los instaladores
   pesan del orden de 90 MB, así que NO entran ahí. Es la razón por la que el
   feed de actualizaciones no puede vivir en openboq.pages.dev y hay que
   apuntarlo a un lugar que acepte archivos grandes. Se avisa al armar. */
const TOPE_PAGES = 25 * 1024 * 1024;

/* Electron 22.3.27: última con Windows 7/8.1. No subir sin perder Windows 7. */
const ELECTRON_LEGADO = '22.3.27';

const CANALES = {
  universal: {
    electron: ELECTRON_LEGADO,
    arch: 'ia32',
    cubre: 'Windows 7 SP1 a 11 — x86, x64 y ARM64 por emulación'
  },
  x64: {
    electron: null,                 /* el instalado en node_modules */
    arch: 'x64',
    cubre: 'Windows 10 y 11 de 64 bits'
  },
  arm64: {
    electron: null,
    arch: 'arm64',
    cubre: 'Windows 11 ARM'
  }
};

/* ------------------------------------------------------------------ apoyo */

function electronInstalado() {
  try {
    const p = path.join(AQUI, 'node_modules', 'electron', 'package.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch (e) {
    return null;
  }
}

/* Las claves que empiezan con $ son comentarios nuestros. electron-builder
   valida el esquema y rechaza cualquier propiedad que no conozca, así que
   hay que sacarlas antes de escribir la configuración real. */
function sinComentarios(obj) {
  if (Array.isArray(obj)) return obj.map(sinComentarios);
  if (obj && typeof obj === 'object') {
    const salida = {};
    Object.keys(obj).forEach(k => { if (k[0] !== '$') salida[k] = sinComentarios(obj[k]); });
    return salida;
  }
  return obj;
}

/* Número de la aplicación web: el `?v=N` de index.html.
   Es OTRA numeración que la del programa (package.json). Se lee acá, se
   comprueba contra sw.js y se estampa en el paquete, para que «Acerca de»
   diga exactamente qué versión de la aplicación trae ese .exe adentro.

   Si index.html y sw.js no coinciden, se corta el armado. Ese desajuste es
   justo el que hace que un usuario siga viendo la versión anterior, y
   empaquetarlo lo dejaría congelado dentro del instalador. */
function versionWeb(raiz) {
  const base = raiz || WEB;
  const indice = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  const marcas = (indice.match(/\?v=\d+/g) || []).map(s => s.slice(3));
  const unicas = marcas.filter((v, i) => marcas.indexOf(v) === i);

  if (!unicas.length) throw new Error('index.html no tiene ningún ?v=N');
  if (unicas.length > 1) {
    throw new Error('index.html mezcla varios ?v=: ' + unicas.join(', ') +
      '. Todos los archivos propios tienen que llevar el mismo número.');
  }

  const sw = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
  const cache = (sw.match(/openboq-v(\d+)/) || [])[1];
  const constante = (sw.match(/const V = '(\d+)'/) || [])[1];

  [['CACHE', cache], ['V', constante]].forEach(par => {
    if (par[1] === undefined) throw new Error('sw.js: no se encontró ' + par[0]);
    if (par[1] !== unicas[0]) {
      throw new Error('desajuste de versión: index.html dice ?v=' + unicas[0] +
        ' y sw.js dice ' + par[0] + '=' + par[1] + '.\n' +
        'Los dos tienen que subir juntos, o el navegador sigue sirviendo la\n' +
        'versión vieja de su caché. Corregir antes de empaquetar.');
    }
  });

  return 'v' + unicas[0];
}

function asegurarIcono() {
  if (fs.existsSync(ICONO)) return;
  console.log('  · falta recursos/icono.ico — generándolo');
  const r = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File',
    path.join(AQUI, 'recursos', 'hacer-icono.ps1')], { stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(ICONO)) {
    throw new Error('no se pudo generar recursos/icono.ico');
  }
}

/* --------------------------------------------------------------- armado */

function configurar(canal) {
  const c = CANALES[canal];
  const base = sinComentarios(JSON.parse(fs.readFileSync(BASE, 'utf8')));

  const electron = c.electron || electronInstalado();
  if (!electron) {
    throw new Error('no hay Electron instalado. Correr `npm install` en esta carpeta.');
  }

  base.electronVersion = electron;
  base.extraMetadata = { openboqCanal: canal, openboqWeb: versionWeb() };

  /* Cada canal en su propia carpeta: si compartieran salida, el `latest.yml`
     de uno pisaría al del otro y un equipo de 32 bits terminaría recibiendo
     el instalador de 64. */
  base.directories = Object.assign({}, base.directories, { output: 'salida/' + canal });
  base.publish = [{ provider: 'generic', url: PUBLICACION + canal + '/' }];

  base.win = Object.assign({}, base.win, {
    target: [
      { target: 'nsis', arch: [c.arch] },
      { target: 'portable', arch: [c.arch] }
    ]
  });
  base.nsis = Object.assign({}, base.nsis, {
    artifactName: 'OpenBOQ-${version}-' + canal + '-instalador.${ext}',
    uninstallDisplayName: 'OpenBOQ ${version} (' + canal + ')'
  });
  base.portable = Object.assign({}, base.portable, {
    artifactName: 'OpenBOQ-${version}-' + canal + '-portable.${ext}'
  });

  fs.mkdirSync(SALIDA, { recursive: true });
  const ruta = path.join(SALIDA, 'config-' + canal + '.json');
  fs.writeFileSync(ruta, JSON.stringify(base, null, 2), 'utf8');
  /* Ruta relativa: el cwd del proceso hijo ya es esta carpeta, y así la
     configuración se lee igual esté donde esté el proyecto. */
  return { ruta: 'salida/config-' + canal + '.json', electron, arch: c.arch, cubre: c.cubre };
}

/* Borra los entregables anteriores de ESE canal. Sin esto, al cambiar el
   número de versión quedan conviviendo el instalador viejo y el nuevo en la
   misma carpeta, y el `latest.yml` apunta a uno solo: es fácil subir el que
   no va. Solo toca .exe, .yml y .blockmap; lo demás lo maneja
   electron-builder. */
function limpiarCanal(canal) {
  const dir = path.join(SALIDA, canal);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir)
    .filter(f => /\.(exe|yml|blockmap)$/i.test(f) || f === 'SHA256.txt')
    .forEach(f => fs.rmSync(path.join(dir, f), { force: true }));
}

function armar(canal) {
  const cfg = configurar(canal);
  limpiarCanal(canal);
  console.log('');
  console.log('== canal ' + canal + ' ==');
  console.log('   Electron:      ' + cfg.electron);
  console.log('   arquitectura:  ' + cfg.arch);
  console.log('   cubre:         ' + cfg.cubre);
  console.log('');

  /* Se llama al CLI de electron-builder con el mismo Node que corre esto, en
     vez de pasar por npx con shell. Con shell, Windows parte la ruta de este
     proyecto en los espacios de «Program Files» y el comando llega roto. */
  const cli = path.join(AQUI, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw new Error('falta electron-builder. Correr `npm install` en esta carpeta.');
  }

  const r = spawnSync(
    process.execPath,
    [cli, '--config', cfg.ruta, '--publish', 'never'],
    { cwd: AQUI, stdio: 'inherit' }
  );
  if (r.status !== 0) throw new Error('electron-builder falló en el canal ' + canal);
}

/* SHA-256 de cada entregable, al lado de los entregables.
   No reemplaza a la firma —quien se baja un .exe adulterado también se
   bajaría el SHA256.txt adulterado si el sitio estuviera comprometido—, pero
   sirve para lo que pasa de verdad: comprobar que la copia que alguien tiene
   en el escritorio es la misma que salió de acá, y no una que el antivirus
   dejó a medio bajar. */
function huellas(dir) {
  const crypto = require('crypto');
  const lineas = fs.readdirSync(dir)
    .filter(f => /\.exe$/i.test(f))
    .sort()
    .map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex') +
      '  ' + f);
  if (!lineas.length) return;
  fs.writeFileSync(path.join(dir, 'SHA256.txt'), lineas.join('\n') + '\n', 'utf8');
}

function main() {
  const pedidos = process.argv.slice(2).filter(a => a[0] !== '-');
  let canales = pedidos.length ? pedidos : ['todos'];
  if (canales.indexOf('todos') !== -1) canales = Object.keys(CANALES);

  const desconocido = canales.find(c => !CANALES[c]);
  if (desconocido) {
    console.error('canal desconocido: ' + desconocido);
    console.error('canales: ' + Object.keys(CANALES).join(', ') + ', todos');
    process.exit(1);
  }

  const web = versionWeb();          /* corta acá si index.html y sw.js no coinciden */
  const propia = JSON.parse(fs.readFileSync(path.join(AQUI, 'package.json'), 'utf8')).version;

  console.log('OpenBOQ escritorio — armando ' + canales.join(', '));
  console.log('   programa:        ' + propia + '   (escritorio/package.json)');
  console.log('   aplicación web:  ' + web + '   (?v= de index.html, igual en sw.js)');
  console.log('   firma:           ' + (FIRMADO ? 'sí (CSC_LINK)' : 'NO — el antivirus va a protestar'));

  asegurarIcono();
  canales.forEach(armar);

  console.log('\nListo. En ' + SALIDA + ':');
  let grandes = 0;
  canales.forEach(canal => {
    const dir = path.join(SALIDA, canal);
    if (!fs.existsSync(dir)) return;
    console.log('   ' + canal + '/');
    fs.readdirSync(dir)
      .filter(f => /\.(exe|yml|blockmap)$/i.test(f) && f.indexOf('builder-debug') !== 0)
      .forEach(f => {
        const bytes = fs.statSync(path.join(dir, f)).size;
        if (/\.exe$/i.test(f) && bytes > TOPE_PAGES) grandes++;
        console.log('      ' + f.padEnd(42) + (bytes / 1048576).toFixed(1) + ' MB');
      });
    huellas(dir);
  });

  console.log('\nPara que la actualización automática funcione, subir el contenido de');
  console.log('cada carpeta a  ' + PUBLICACION + '<canal>/');
  console.log('Los tres archivos, incluido el .blockmap: sin él la actualización se');
  console.log('baja entera en vez de solo los pedazos que cambiaron.');

  if (grandes) {
    console.log('');
    console.log('OJO: Cloudflare Pages no acepta archivos de más de 25 MiB y hay ' + grandes);
    console.log('     instalador(es) por encima de ese tope. El sitio de OpenBOQ está en');
    console.log('     Pages, así que los .exe NO se pueden subir ahí: mientras el feed');
    console.log('     apunte a ' + PUBLICACION);
    console.log('     «Buscar actualizaciones» va a decir siempre que no hay nada');
    console.log('     publicado. Hay que poner los instaladores en un lugar que acepte');
    console.log('     archivos grandes —R2 o las Releases de un repositorio— y apuntar');
    console.log('     PUBLICACION ahí. Ver LEEME-INSTALACION.md.');
  }

  if (!FIRMADO) {
    console.log('');
    console.log('SIN FIRMA: estos .exe no llevan certificado, así que el antivirus va a');
    console.log('           protestar en cada máquina donde se instalen. Junto a cada');
    console.log('           instalador quedó SHA256.txt para poder verificar que lo que');
    console.log('           se descargó es lo que salió de acá. Ver LEEME-ANTIVIRUS.md.');
  }
  console.log('');
}

/* Se exporta versionWeb para poder probar el guardia de versiones sin tener
   que armar un instalador entero. Ver pruebas/version.test.js. */
module.exports = { versionWeb };

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('\n' + e.message + '\n'); process.exit(1); }
}
