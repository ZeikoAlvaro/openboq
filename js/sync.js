/* =========================================================================
   OpenBOQ — la Base de Datos se pone al día sola
   -------------------------------------------------------------------------
   La aplicación arranca con `data/catalogo.js`, el archivo que viaja con
   ella: instantáneo, y funciona igual sin conexión. Este módulo le agrega lo
   único que a ese archivo le falta, que es envejecer: pregunta al
   repositorio central qué precios cambiaron desde que se generó el archivo y
   se trae SOLO eso.

   POR QUÉ NO SE CONSULTA TODO EN VIVO. Buscar entre 7.974 análisis contra un
   array en memoria es instantáneo; contra el servidor son 150 ms por tecla.
   Y si el proyecto de Supabase se pausa —el plan gratis lo hace a los siete
   días sin actividad—, en vivo la aplicación deja de funcionar; así, solo
   deja de actualizarse. Ver docs/ARQUITECTURA.md.

   CÓMO FUNCIONA, en orden:

     1. lo que ya se bajó otras veces vive en IndexedDB y se aplica ANTES de
        tocar la red, así el usuario nunca espera por esto;
     2. se le pregunta al servidor si hay algo nuevo desde la última marca;
     3. si lo hay, se baja de a mil filas, se guarda y se aplica.

   DE DÓNDE SALE LA PRIMERA MARCA. Del propio catálogo: `generado_en` dice
   con qué estado del repositorio se armó el archivo. Sin ese campo no se
   sincroniza nada —preguntar «desde el principio» haría bajar las 9.803
   filas, que es exactamente lo que este módulo existe para evitar—.

   LA MARCA ES DEL SERVIDOR, NUNCA DEL NAVEGADOR. Se guarda tal cual llega y
   se manda tal cual. El reloj del equipo puede estar corrido, y una hora
   local leída como UTC se va cuatro husos atrás: el servidor contestaría que
   cambió el catálogo entero.
   ========================================================================= */
'use strict';

const SINCRO = (() => {

  const CFG = typeof NUBE_CFG !== 'undefined' ? NUBE_CFG : null;
  const BD_NOMBRE = 'openboq';
  const ALMACEN = 'catalogo';
  const PAGINA = 1000;              // filas por pedido
  const ESPERA = 12000;             // ms antes de dar la red por perdida

  const hay = () => !!(CFG && CFG.url && CFG.anon && typeof indexedDB !== 'undefined');

  /* ------------------------- IndexedDB, mínima ------------------------- */
  let _bd = null;
  function abrir() {
    if (_bd) return Promise.resolve(_bd);
    return new Promise((ok, no) => {
      const req = indexedDB.open(BD_NOMBRE, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN);
      };
      req.onsuccess = () => { _bd = req.result; ok(_bd); };
      req.onerror = () => no(req.error);
    });
  }

  function leer(clave) {
    return abrir().then(db => new Promise((ok, no) => {
      const t = db.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(clave);
      t.onsuccess = () => ok(t.result);
      t.onerror = () => no(t.error);
    }));
  }

  function escribir(clave, valor) {
    return abrir().then(db => new Promise((ok, no) => {
      const tx = db.transaction(ALMACEN, 'readwrite');
      tx.objectStore(ALMACEN).put(valor, clave);
      tx.oncomplete = () => ok(true);
      tx.onerror = () => no(tx.error);
    }));
  }

  /* ------------------------------ la red ------------------------------ */
  function pedir(ruta, opciones) {
    const o = opciones || {};
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reloj = ctl ? setTimeout(() => ctl.abort(), ESPERA) : null;
    return fetch(CFG.url + ruta, {
      method: o.method || 'GET',
      headers: Object.assign({
        apikey: CFG.anon,
        Authorization: 'Bearer ' + CFG.anon,
        'Content-Type': 'application/json'
      }, o.headers || {}),
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: ctl ? ctl.signal : undefined
    }).then(r => {
      if (reloj) clearTimeout(reloj);
      if (!r.ok) return r.text().then(t => { throw new Error(r.status + ' ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  /** Cuántos precios cambiaron desde `marca`, y hasta qué marca. */
  function hayCambios(marca) {
    return pedir('/rest/v1/rpc/obq_hay_cambios', { method: 'POST', body: { desde: marca || null } })
      .then(r => (Array.isArray(r) ? r[0] : r) || { cambios: 0, ultima: null });
  }

  /** Trae los precios posteriores a `marca`, de a PAGINA filas. */
  function bajar(marca, cuantos) {
    const campos = 'base,tipo,descripcion,unidad,precio,actualizado_en';
    const filtro = '&actualizado_en=gt.' + encodeURIComponent(marca);
    const orden = '&order=actualizado_en.asc,insumo_id.asc';
    const total = Math.min(Number(cuantos) || 0, 20000);   // techo de sanidad
    const paginas = [];
    for (let i = 0; i < total; i += PAGINA) paginas.push(i);

    return paginas.reduce((cadena, desde) => cadena.then(acc =>
      pedir('/rest/v1/v_catalogo_precios?select=' + campos + filtro + orden +
        '&limit=' + PAGINA + '&offset=' + desde).then(filas => acc.concat(filas || []))
    ), Promise.resolve([]));
  }

  /* --------------------------- lo guardado --------------------------- */
  /* Se guarda el delta acumulado, no el catálogo entero: si un precio cambia
     tres veces, queda la última. La clave es base + tipo + descripción +
     unidad, la misma con la que el motor empareja. */
  function fusionar(viejo, nuevo) {
    const m = new Map();
    (viejo || []).concat(nuevo || []).forEach(c => {
      if (!c || !c.base) return;
      m.set([c.base, c.tipo, c.descripcion, c.unidad].join('|'), c);
    });
    return Array.from(m.values());
  }

  /* ------------------------------ arranque ------------------------------ */
  /**
   * Pone la Base de Datos al día. No corta nunca la aplicación: cualquier
   * problema —sin red, servidor pausado, IndexedDB bloqueada en modo
   * privado— termina en un estado 'sin-conexion' y la aplicación sigue
   * andando con el catálogo que trae.
   *
   * @param {Object} catalogo  el window.OPENBOQ_DB ya cargado
   * @param {Function} [alAplicar]  recibe {insumos, apus, bases} si algo cambió
   * @returns {Promise<{estado:string, insumos?:number, apus?:number, cambios?:number}>}
   */
  function arrancar(catalogo, alAplicar) {
    if (!hay()) return Promise.resolve({ estado: 'sin-nube' });

    const marcaArchivo = catalogo && catalogo.generado_en;
    if (!marcaArchivo) return Promise.resolve({ estado: 'catalogo-sin-marca' });

    let guardado = null;

    return leer('delta').then(g => {
      guardado = g || { marca: marcaArchivo, cambios: [] };

      /* si el archivo que trae la aplicación es MÁS nuevo que lo guardado,
         lo guardado ya está adentro del archivo y se tira */
      if (guardado.marca < marcaArchivo) guardado = { marca: marcaArchivo, cambios: [] };

      /* primero lo de casa: se aplica sin esperar a la red */
      const previo = guardado.cambios.length
        ? MOTOR.aplicarDelta(guardado.cambios)
        : { insumos: 0, apus: 0, bases: 0 };
      if (previo.insumos && alAplicar) alAplicar(previo);

      return hayCambios(guardado.marca);
    }).then(r => {
      const cuantos = Number(r.cambios) || 0;
      if (!cuantos) return { estado: 'al-dia', cambios: 0 };

      return bajar(guardado.marca, cuantos).then(filas => {
        if (!filas.length) return { estado: 'al-dia', cambios: 0 };

        const cambios = fusionar(guardado.cambios, filas);
        /* la marca sale de las filas que llegaron, no del reloj de acá */
        const marca = filas.reduce((m, f) => (f.actualizado_en > m ? f.actualizado_en : m),
          guardado.marca);

        const res = MOTOR.aplicarDelta(filas);
        return escribir('delta', { marca, cambios }).catch(() => false).then(() => {
          if (res.insumos && alAplicar) alAplicar(res);
          return { estado: 'actualizado', cambios: filas.length, insumos: res.insumos, apus: res.apus };
        });
      });
    }).catch(e => ({ estado: 'sin-conexion', error: String(e && e.message || e) }));
  }

  /** Olvida lo bajado: la próxima vez se vuelve a pedir desde el archivo. */
  function olvidar() {
    return escribir('delta', null).catch(() => false);
  }

  /** Qué tiene guardado, para mostrarlo en CONFIGURACIÓN. */
  function estado() {
    if (!hay()) return Promise.resolve({ hay: false });
    return leer('delta').then(g => ({
      hay: true,
      marca: g && g.marca || null,
      cambios: g && g.cambios ? g.cambios.length : 0
    })).catch(() => ({ hay: false }));
  }

  return { hay, arrancar, olvidar, estado, fusionar };
})();
