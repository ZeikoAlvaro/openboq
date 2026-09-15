/* =========================================================================
   OpenBOQ — estado de la conexión
   -------------------------------------------------------------------------
   La aplicación consulta `acceso.json` en el servidor al arrancar y cada
   `revisarMin` minutos, con `cache: 'no-store'` para que el chequeo sea real
   y no lo resuelva una copia guardada.

   El resultado se muestra únicamente como un punto de color en la barra de
   estado. NO bloquea nada: el presupuesto, los análisis, los cómputos, el
   cronograma, los reportes y las exportaciones funcionan igual. Lo único que
   necesita clave es la Base de Datos de precios, y esa se escribe cuando el
   usuario quiere, desde la pestaña BASE DE DATOS o desde CONFIGURACIÓN.

     activo     el servidor respondió                              verde
     espera     no respondió, pero hubo señal hace poco            amarillo
     bloqueado  hace rato que no hay señal                         rojo

   `acceso.json` además trae la lista de códigos habilitados —hash
   PBKDF2-SHA256 con sal, nunca en claro, generados con
   herramientas/generar_acceso.js—. Hoy eso NO habilita ni deshabilita nada:
   queda registrado en `estado().habilitado` por si más adelante se decide
   usarlo. El color del punto depende solo de si hay conexión.
   ========================================================================= */
'use strict';

const ACCESO = (() => {

  const ARCHIVO = 'acceso.json';
  const LS_CODIGO = 'openboq_codigo_acceso';
  const LS_ULTIMA = 'openboq_ultima_senal';

  const REVISAR_MIN = 10;      // cada cuánto se vuelve a verificar
  const TOLERANCIA_MIN = 45;   // desde cuándo el punto pasa de amarillo a rojo

  let cfg = null;
  let estadoActual = 'espera';
  let habilitado = false;      // el código figura en acceso.json (informativo)
  let timer = null;
  let alCambiar = null;

  /* En la versión portable (file://) no hay servidor: no se muestra nada. */
  const aplica = () => typeof location !== 'undefined' &&
    /^https?:$/.test(location.protocol) &&
    typeof crypto !== 'undefined' && !!crypto.subtle;

  /* Código de este equipo, si alguna vez se guardó uno. Antes salía de la
     clave de la Base de Datos; esa clave ya no existe —el catálogo viaja en
     claro— así que hoy queda vacío salvo que se cargue a mano. No habilita
     ni bloquea nada: solo se informa en estado().habilitado. */
  function codigo() {
    try { return localStorage.getItem(LS_CODIGO) || ''; }
    catch (e) { return ''; }
  }
  const guardarCodigo = c => { try { localStorage.setItem(LS_CODIGO, c); } catch (e) { } };
  const olvidarCodigo = () => { try { localStorage.removeItem(LS_CODIGO); } catch (e) { } };

  const ultimaSenal = () => {
    try { return Number(localStorage.getItem(LS_ULTIMA)) || 0; } catch (e) { return 0; }
  };
  const marcarSenal = () => {
    try { localStorage.setItem(LS_ULTIMA, String(Date.now())); } catch (e) { }
  };

  const hex = buf => Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const bytes = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));

  /** PBKDF2-SHA256 del código, en hexadecimal. */
  async function huella(cod, salHex, iter) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(cod).trim()), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: bytes(salHex), iterations: iter || 200000, hash: 'SHA-256' },
      base, 256);
    return hex(bits);
  }

  /**
   * Consulta el servidor y actualiza el estado.
   * @returns {Promise<{estado:string, ultima:number}>}
   */
  async function verificar() {
    if (!aplica()) return fijar('activo');

    let datos;
    try {
      const r = await fetch(ARCHIVO + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      datos = await r.json();
    } catch (e) {
      return sinSenal();
    }
    cfg = datos;
    /* El servidor contestó: hay conexión, y con eso alcanza para el punto. */
    marcarSenal();
    habilitado = await estaHabilitado(datos);
    return fijar('activo');
  }

  /** ¿El código de este equipo figura en la lista y sigue vigente?
      Se registra, pero hoy no cambia el color ni bloquea nada. */
  async function estaHabilitado(datos) {
    const cod = codigo();
    if (!cod) return false;
    const lista = Array.isArray(datos.codigos) ? datos.codigos : [];
    const hoy = new Date().toISOString().slice(0, 10);
    for (const c of lista) {
      if (c.hasta && c.hasta < hoy) continue;
      try { if (await huella(cod, c.sal, c.it) === c.h) return true; } catch (e) { }
    }
    return false;
  }

  function sinSenal() {
    const min = (Date.now() - ultimaSenal()) / 60000;
    const tol = Number(cfg && cfg.toleranciaMin) > 0 ? Number(cfg.toleranciaMin) : TOLERANCIA_MIN;
    return fijar(!ultimaSenal() || min > tol ? 'bloqueado' : 'espera');
  }

  function fijar(e) {
    estadoActual = e;
    if (alCambiar) alCambiar(estado());
    return estado();
  }

  const estado = () => ({
    estado: estadoActual,
    ultima: ultimaSenal(),
    hayCodigo: !!codigo(),
    habilitado,
    aplica: aplica()
  });

  /** ¿Hay conexión con el servidor? Solo informativo: no bloquea nada. */
  const enLinea = () => !aplica() || estadoActual === 'activo';

  /**
   * Arranca el ciclo de verificación.
   * @param {Function} cb se llama con el estado cada vez que cambia
   */
  function iniciar(cb) {
    alCambiar = cb || null;
    if (!aplica()) { fijar('activo'); return Promise.resolve(estado()); }
    const cada = () => {
      const min = Number(cfg && cfg.revisarMin) > 0 ? Number(cfg.revisarMin) : REVISAR_MIN;
      clearTimeout(timer);
      timer = setTimeout(() => verificar().then(cada), min * 60000);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => verificar().then(cada));
      window.addEventListener('offline', () => sinSenal());
    }
    return verificar().then(r => { cada(); return r; });
  }

  return { iniciar, verificar, estado, enLinea, aplica, codigo, guardarCodigo, olvidarCodigo, ARCHIVO };
})();
