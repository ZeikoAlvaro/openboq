'use strict';

/* Hook afterPack de electron-builder: ofusca el módulo de PRESCOM
 * (importador.js y exportador.js) DENTRO del paquete, antes de que se arme
 * el instalador.
 *
 * Por qué: el escritorio empaqueta la aplicación web en resources/openboq/js
 * como archivos sueltos. Sin esto, `importador.js` y `exportador.js` —el
 * formato .ddp descifrado por ingeniería inversa— viajan EN CLARO dentro del
 * .exe. Mientras el instalador se pasaba a mano a probadores conocidos daba
 * igual; el momento en que se publica en una release pública de GitHub para
 * la actualización automática, cualquiera lo baja y lo lee. El sitio web ya
 * publica estos dos archivos ofuscados (preparar_sitio.js); el escritorio
 * tiene que hacer lo mismo o abre el mismo agujero por otro lado.
 *
 * Misma configuración de ofuscación que el sitio, para que el resultado sea
 * el ya probado contra las pruebas de PRESCOM.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ARCHIVOS = ['importador.js', 'exportador.js'];

/* Igual que herramientas/preparar_sitio.js. */
const OPCIONES = {
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  numbersToExpressions: true,
  simplify: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  unicodeEscapeSequence: false
};
const CABECERA = '/*! OpenBOQ · módulo PRESCOM · © 2026 Alvaro Oczachoque · Todos los derechos reservados. ' +
  'Prohibida su copia, modificación o redistribución sin autorización. */\n';

exports.default = async function ofuscar(context) {
  const Ofuscador = require('javascript-obfuscator');
  const dirJs = path.join(context.appOutDir, 'resources', 'openboq', 'js');

  for (const nombre of ARCHIVOS) {
    const ruta = path.join(dirJs, nombre);
    if (!fs.existsSync(ruta)) {
      throw new Error('[ofuscar-prescom] no está ' + ruta + ' — no se puede armar sin ofuscar PRESCOM');
    }
    const original = fs.readFileSync(ruta, 'utf8');

    /* Ya ofuscado (rearmado sobre una salida previa): no lo toco de nuevo. */
    if (original.indexOf('módulo PRESCOM') > 0 && original.length && /_0x/.test(original)) {
      console.log('   [ofuscar-prescom] ' + nombre + ' ya estaba ofuscado, se deja.');
      continue;
    }

    const global = (original.match(/^const (\w+) = /m) || [])[1];
    const codigo = CABECERA + Ofuscador.obfuscate(original, OPCIONES).getObfuscatedCode();

    /* Sigue siendo JavaScript válido y sigue definiendo su global. */
    try {
      const ctx = vm.createContext({
        console, TextDecoder, TextEncoder,
        DecompressionStream: function () {}, Blob: function () {},
        Response: function () {}, window: {}
      });
      vm.runInContext(codigo + '\n;globalThis.__g = typeof ' + global + ';', ctx);
      if (global && ctx.__g !== 'object') throw new Error(global + ' quedó como ' + ctx.__g);
    } catch (e) {
      throw new Error('[ofuscar-prescom] ' + nombre + ' no quedó utilizable tras ofuscar: ' + e.message);
    }

    /* Comprobación dura: si el nombre de una función interna sobrevivió, la
       ofuscación no se aplicó y NO se sigue (evita publicar PRESCOM en claro). */
    const fn = (original.match(/function (\w{6,})/) || [])[1];
    if (fn && codigo.indexOf('function ' + fn + '(') >= 0) {
      throw new Error('[ofuscar-prescom] ' + nombre + ' conserva nombres internos: NO se aplicó la ofuscación');
    }

    fs.writeFileSync(ruta, codigo);
    console.log('   [ofuscar-prescom] ofuscado ' + nombre
      + '  ' + (original.length / 1024).toFixed(0) + ' KB → ' + (codigo.length / 1024).toFixed(0) + ' KB');
  }
};
