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

/* Dónde se publican los instaladores y sus `*.yml`. El feed vive en las
   RELEASES de GitHub del repositorio público, no en Cloudflare Pages: Pages
   rechaza archivos de más de 25 MiB y cada instalador pesa ~110 MB.

   Los tres canales van en la MISMA release, sin chocar, porque cada uno
   estampa su propio archivo de feed (un `channel` distinto → `latest.yml`,
   `universal.yml`, `arm64.yml`). Un equipo con el paquete de 32 bits lee
   `universal.yml` y nunca ve el de 64: los feeds no se mezclan. */
const GH_OWNER = 'ZeikoAlvaro';
const GH_REPO = 'openboq';

/* Cada canal a su archivo de feed. electron-updater arma el nombre del `.yml`
   a partir del `channel`, así que basta con darle uno distinto a cada canal
   para que convivan en una sola release. El `x64` se queda con `latest` para
   que sea el nombre canónico. */
const CANAL_FEED = { x64: 'latest', universal: 'universal', arm64: 'arm64' };

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
/* Certificado propio en firma-local/: si el usuario lo creó (con
   firma-local/1-crear-certificado.ps1) y no puso CSC_LINK a mano, se usa
   solo. Así `npm run armar` sale firmado sin tener que setear variables.
   La carpeta firma-local/ está fuera del repo (lleva la clave privada). */
(function detectarPfxLocal() {
  if (process.env.CSC_LINK || process.env.WIN_CSC_LINK) return;
  const pfx = path.join(AQUI, 'firma-local', 'openboq-firma.pfx');
  const clave = path.join(AQUI, 'firma-local', 'clave.txt');
  if (fs.existsSync(pfx) && fs.existsSync(clave)) {
    process.env.CSC_LINK = pfx;
    process.env.CSC_KEY_PASSWORD = fs.readFileSync(clave, 'utf8').trim();
    console.log('   (usando el certificado propio de firma-local/)');
  }
})();

const AZURE = !!(process.env.AZURE_TS_DLIB && process.env.AZURE_TS_METADATA);
const FIRMADO = !!(process.env.CSC_LINK || process.env.WIN_CSC_LINK || AZURE);

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
  /* Sin comentarios HTML ni de bloque de JS: un comentario que cuenta la
     historia de un número viejo (el `?v=62` fijo del cargador) no es una
     marca y no tiene que cortar el armado. */
  const indice = fs.readFileSync(path.join(base, 'index.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
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
  base.publish = [{
    provider: 'github',
    owner: GH_OWNER,
    repo: GH_REPO,
    channel: CANAL_FEED[canal] || canal,
    releaseType: 'release'
  }];

  base.win = Object.assign({}, base.win, {
    target: [
      { target: 'nsis', arch: [c.arch] },
      { target: 'portable', arch: [c.arch] }
    ]
  });

  /* Ofuscar PRESCOM dentro del paquete SIEMPRE. El escritorio empaqueta la
     web como archivos sueltos en resources/openboq/js; sin esto, importador.js
     y exportador.js viajarían en claro dentro del .exe y una release pública
     los dejaría a la vista. Ruta con `/` para que electron-builder la resuelva
     igual en Windows. */
  base.afterPack = path.join(AQUI, 'ofuscar-prescom.js').replace(/\\/g, '/');

  /* Firma en la nube con Azure Trusted Signing cuando hay credenciales. No
     necesita token físico ni hacer público el código (lo que sí exige
     SignPath). Si además está CSC_LINK, electron-builder firma solo y no hace
     falta este gancho. */
  if (AZURE) {
    base.win.sign = path.join(AQUI, 'firma-azure.js').replace(/\\/g, '/');
  }
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
  console.log('   firma:           ' + (AZURE ? 'sí (Azure Trusted Signing)'
    : FIRMADO ? 'sí (CSC_LINK)' : 'NO — el antivirus va a protestar'));

  asegurarIcono();
  canales.forEach(armar);

  console.log('\nListo. En ' + SALIDA + ':');
  canales.forEach(canal => {
    const dir = path.join(SALIDA, canal);
    if (!fs.existsSync(dir)) return;
    console.log('   ' + canal + '/');
    fs.readdirSync(dir)
      .filter(f => /\.(exe|yml|blockmap)$/i.test(f) && f.indexOf('builder-debug') !== 0)
      .forEach(f => {
        const bytes = fs.statSync(path.join(dir, f)).size;
        console.log('      ' + f.padEnd(42) + (bytes / 1048576).toFixed(1) + ' MB');
      });
    huellas(dir);
  });

  console.log('\nPara publicar la actualización automática, subir TODO a una release de');
  console.log('GitHub en ' + GH_OWNER + '/' + GH_REPO + ' con la etiqueta v' + propia + ':');
  console.log('   node publicar_release.js');
  console.log('Sube los .exe, cada *.yml de canal y los .blockmap a la misma release.');
  console.log('El .blockmap importa: sin él la actualización se baja entera en vez de');
  console.log('solo los pedazos que cambiaron.');

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
