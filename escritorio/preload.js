/* =========================================================================
   OpenBOQ escritorio — puente
   -------------------------------------------------------------------------
   Corre ANTES que cualquier script de la página, en contexto aislado y con
   sandbox. Deja `window.OPENBOQ_ESCRITORIO` con:

     · los datos de esta instalación (versión, canal, plataforma…), para que
       index.html sepa que está adentro de la aplicación y NO registre el
       service worker: los archivos ya son locales, el paquete ni siquiera
       lleva sw.js, y registrarlo solo reviviría la trampa de la caché con
       la versión vieja del ?v=N;

     · `menu(def)`, con el que la propia aplicación arma la barra de menús
       NATIVA de Windows. La define la página —es la misma lista que usa el
       menú de adentro— y el proceso principal solo la dibuja y devuelve la
       acción elegida por `alAccion`. Así hay UNA sola definición de menú y
       no dos que se separan con el tiempo;

     · `entrar(url)` y `alSesion(cb)`, las dos mitades del login con
       proveedor: la primera abre el navegador del sistema, la segunda
       recibe la sesión cuando vuelve.

   No expone nada de Node ni del sistema de archivos. Todo lo que sale de
   acá son DATOS y avisos; ninguna capacidad.

   TRAMPA YA PAGADA: con sandbox activo, el `process` del preload es una
   versión recortada. NO tiene `process.argv`, así que leer los datos de ahí
   hacía fallar el preload entero y la marca nunca aparecía — la página
   quedaba idéntica a la del navegador y volvía a registrar el service
   worker. Los datos se piden por IPC, que sí está disponible.

   La marca se pone en un `finally`: aunque la consulta al proceso principal
   falle, la marca tiene que existir igual. Es lo único de lo que depende el
   comportamiento de la página.
   ========================================================================= */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let datos = {};
try {
  datos = ipcRenderer.sendSync('openboq-datos') || {};
} catch (e) {
  datos = {};
} finally {
  contextBridge.exposeInMainWorld('OPENBOQ_ESCRITORIO', {
    version: datos.version || '',
    canal: datos.canal || '',
    plataforma: datos.plataforma || '',
    arquitectura: datos.arquitectura || '',
    electron: datos.electron || '',
    chromium: datos.chromium || '',
    puerto: datos.puerto || 0,
    portable: !!datos.portable,

    /* ---- menú nativo ----
       `def` es [{ titulo, items:[{ etiqueta, acc, atajo } | { sep:true }] }].
       Solo texto: ninguna función cruza el puente. */
    menu(def) {
      try { ipcRenderer.send('openboq-menu', JSON.parse(JSON.stringify(def))); }
      catch (e) { /* la página se queda con su menú de adentro */ }
    },
    alAccion(cb) {
      ipcRenderer.on('openboq-accion', (e, acc) => { try { cb(String(acc)); } catch (x) { } });
    },

    /* ---- login con proveedor ----
       `entrar` devuelve la dirección de vuelta que hay que pedirle al
       proveedor: el proceso principal le agrega la llave de un solo uso que
       después exige para aceptar la sesión. */
    entrar(proveedor) {
      try { return ipcRenderer.sendSync('openboq-entrar', String(proveedor)) || null; }
      catch (e) { return null; }
    },
    abrirLogin(url) {
      try { ipcRenderer.send('openboq-abrir-login', String(url)); return true; }
      catch (e) { return false; }
    },
    alSesion(cb) {
      ipcRenderer.on('openboq-sesion', (e, s) => { try { cb(s); } catch (x) { } });
    }
  });
}
