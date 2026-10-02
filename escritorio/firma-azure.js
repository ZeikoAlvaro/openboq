'use strict';

/* Firma con Azure Trusted Signing — firma confiable en la nube, sin token
 * físico y SIN tener que hacer público el código (a diferencia de SignPath
 * Foundation, que exige repositorio abierto). Es el camino más barato
 * (~10 US$/mes) que hace que Avast, Defender y SmartScreen dejen de protestar,
 * porque el ejecutable pasa a estar firmado por un editor verificado.
 *
 * NO es un truco para esquivar al antivirus: es lo contrario. Un binario
 * firmado prueba quién lo hizo; la heurística `IDP.Generic` se dispara
 * justamente porque el .exe es anónimo. Firmar quita la causa, no la esconde.
 *
 * electron-builder 24.x no trae `azureSignOptions` (eso es 25+), así que se
 * engancha esta función a mano con `win.sign` desde hacer.js. Se activa sola
 * cuando existen las variables de entorno; sin ellas, el armado sale sin
 * firma como hasta ahora.
 *
 * Requisitos en la máquina que arma (o en el runner de CI):
 *   - Windows SDK con `signtool.exe`.
 *   - El paquete Azure.CodeSigning.Dlib (la DLL que signtool usa como
 *     proveedor); su ruta va en AZURE_TS_DLIB.
 *   - Una cuenta de Azure Trusted Signing con su perfil de certificado.
 *
 * Variables de entorno (todas obligatorias para que firme):
 *   AZURE_TS_DLIB          ruta a Azure.CodeSigning.Dlib.dll
 *   AZURE_TS_METADATA      ruta al metadata.json (endpoint, cuenta, perfil)
 *   AZURE_TENANT_ID        \
 *   AZURE_CLIENT_ID         > credenciales del service principal que firma
 *   AZURE_CLIENT_SECRET    /
 * Opcional:
 *   SIGNTOOL               ruta a signtool.exe si no está en el PATH
 *
 * El metadata.json típico:
 *   {
 *     "Endpoint": "https://eus.codesigning.azure.net/",
 *     "CodeSigningAccountName": "mi-cuenta",
 *     "CertificateProfileName": "mi-perfil"
 *   }
 */

const { spawnSync } = require('child_process');

/* electron-builder llama a esto una vez por archivo a firmar. Recibe la
   configuración con `path` = el .exe. Devuelve nada; lanza si falla. */
exports.default = async function firmar(configuration) {
  const archivo = configuration.path;

  const dlib = process.env.AZURE_TS_DLIB;
  const metadata = process.env.AZURE_TS_METADATA;
  const signtool = process.env.SIGNTOOL || 'signtool.exe';

  if (!dlib || !metadata) {
    /* Sin credenciales no se firma. No es error: es el modo de siempre.
       hacer.js solo engancha esta función cuando decide que hay que firmar,
       así que si se llega acá sin variables, se avisa y se sigue. */
    console.warn('   [firma-azure] faltan AZURE_TS_DLIB/AZURE_TS_METADATA: ' + archivo + ' queda SIN firmar.');
    return;
  }

  const args = [
    'sign',
    '/v',
    '/debug',
    '/fd', 'SHA256',
    '/tr', 'http://timestamp.acs.microsoft.com',
    '/td', 'SHA256',
    '/dlib', dlib,
    '/dmdf', metadata,
    archivo
  ];

  const r = spawnSync(signtool, args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('signtool salió con código ' + r.status + ' firmando ' + archivo);
  console.log('   [firma-azure] firmado: ' + archivo);
};
