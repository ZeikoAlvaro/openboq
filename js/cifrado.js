/* =========================================================================
   OpenBOQ — apertura del catálogo cifrado
   -------------------------------------------------------------------------
   El catálogo de la versión portable viaja cifrado con AES-256-GCM y una
   clave derivada de una frase con PBKDF2-HMAC-SHA256. La frase no está en
   ningún archivo del paquete: la entrega quien distribuye la versión.

   Formato del contenido de datos/catalogo.obq.js (base64):

     bytes 0..5    "OBQ1" + versión (2 bytes, uint16 LE)
     bytes 6..21   sal (16 bytes)
     bytes 22..33  nonce / IV (12 bytes)
     bytes 34..37  iteraciones PBKDF2 (uint32 LE)
     bytes 38..     texto cifrado + etiqueta GCM (16 bytes al final)

   El texto en claro es el JSON del catálogo comprimido con deflate-raw.

   ADVERTENCIA HONESTA: esto protege el archivo mientras nadie tenga la
   frase, y evita que el catálogo circule suelto. No protege del usuario
   que sí recibe la frase: al escribirla, la tiene. Es control de acceso
   para una prueba cerrada, no un candado contra quien ya está adentro.
   ========================================================================= */
'use strict';

const CIFRADO = (() => {

  const MAGIA = 'OBQ1';
  const LS_CLAVE = 'openboq_clave_catalogo';

  /* ---------- la clave con la que la aplicación abre su propio catálogo ----------
     El sitio publicado no le pide nada al usuario: el catálogo viaja cifrado
     para que no se lo puedan llevar pidiendo la dirección, y la aplicación lo
     abre sola. Esta rutina es gemela de herramientas/lib/clave_app.js y las
     dos tienen que dar la misma cadena; si una cambia sin la otra, el
     catálogo no abre y la aplicación arranca sin Base de Datos.

     Que quede dicho: la clave está acá, en un archivo que cualquiera puede
     leer. Esto detiene el raspado automático y la copia de un comando, no a
     quien se siente a mirar el código. La versión portable sigue usando una
     frase de verdad, que no está en ningún archivo (ver `abrir`). */
  const SEMILLA = ['q3', 'boq', '7m', 'catalogo', 'x9', 'openboq', '2026', 'kv'];
  const ORDEN = [5, 1, 3, 6, 0, 4, 7, 2];
  const claveDeLaApp = () => ORDEN.map(i => SEMILLA[i]).join('-');

  const disponible = () =>
    typeof crypto !== 'undefined' && crypto.subtle && typeof TextDecoder !== 'undefined';

  const hayCatalogoCifrado = () =>
    typeof window !== 'undefined' && typeof window.OPENBOQ_CIFRADO === 'string' && window.OPENBOQ_CIFRADO.length > 64;

  function b64aBytes(b64) {
    const s = atob(b64.replace(/\s+/g, ''));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  async function inflar(u8) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('Este navegador no puede descomprimir la Base de Datos. Use Chrome o Edge actualizado.');
    const rs = new ReadableStream({ start(c) { c.enqueue(u8); c.close(); } });
    const ab = await new Response(rs.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new TextDecoder('utf-8').decode(ab);
  }

  /**
   * Descifra el catálogo empaquetado.
   * @param {string} frase clave entregada por quien distribuye la versión
   * @returns {Promise<Object>} objeto del catálogo, listo para MOTOR.cargarCatalogo
   */
  async function abrir(frase) {
    if (!disponible())
      throw new Error('El navegador no expone WebCrypto (crypto.subtle). Abra la aplicación con Chrome o Edge actualizado.');
    if (!hayCatalogoCifrado()) throw new Error('No hay Base de Datos cifrada en este paquete.');
    if (!frase) throw new Error('Escriba la clave.');

    const b = b64aBytes(window.OPENBOQ_CIFRADO);
    const cab = new TextDecoder('latin1').decode(b.slice(0, 4));
    if (cab !== MAGIA) throw new Error('El archivo de la Base de Datos no tiene el formato esperado.');

    const sal = b.slice(6, 22);
    const iv = b.slice(22, 34);
    const iter = new DataView(b.buffer, b.byteOffset + 34, 4).getUint32(0, true);
    const datos = b.slice(38);

    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(frase.trim()), 'PBKDF2', false, ['deriveKey']);
    const clave = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);

    let plano;
    try {
      plano = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, clave, datos);
    } catch (e) {
      throw new Error('CLAVE_INCORRECTA');
    }
    return JSON.parse(await inflar(new Uint8Array(plano)));
  }

  /* --- recordar la clave en este equipo (opcional, decisión del usuario) --- */
  const claveGuardada = () => { try { return localStorage.getItem(LS_CLAVE) || ''; } catch (e) { return ''; } };
  const guardarClave = f => { try { localStorage.setItem(LS_CLAVE, f); } catch (e) { } };
  const olvidarClave = () => { try { localStorage.removeItem(LS_CLAVE); } catch (e) { } };

  /**
   * Abre el catálogo del sitio publicado, sin pedirle nada al usuario.
   * Devuelve `null` —en vez de tirar el error— cuando no hay catálogo cifrado
   * o el navegador no puede descifrar: la aplicación tiene que arrancar igual,
   * sin Base de Datos, como cuando el archivo del catálogo no está. Un error
   * acá dejaría la pantalla en blanco por un archivo que es opcional.
   * @returns {Promise<Object|null>}
   */
  async function abrirDeLaApp() {
    if (!hayCatalogoCifrado() || !disponible()) return null;
    try { return await abrir(claveDeLaApp()); }
    catch (e) {
      /* CLAVE_INCORRECTA acá significa que se publicó data/catalogo.obq.js y
         js/cifrado.js con semillas distintas. Se avisa en la consola porque no
         hay otra forma de enterarse: la aplicación abre igual, vacía. */
      console.warn('OpenBOQ: no se pudo abrir la Base de Datos cifrada (' +
        (e && e.message) + '). La aplicación arranca sin catálogo.');
      return null;
    }
  }

  return { abrir, abrirDeLaApp, disponible, hayCatalogoCifrado,
           claveGuardada, guardarClave, olvidarClave, MAGIA };
})();
