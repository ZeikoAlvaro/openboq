/* =========================================================================
   OpenBOQ — cuenta, respaldo, aportes y reportes
   -------------------------------------------------------------------------
   Habla con Supabase por HTTP plano. No hay librería: la API de Auth y la
   de PostgREST son unas pocas rutas, y `fetch` alcanza. El proyecto ya
   escribe su propio .xlsx y su propio cifrado sin dependencias; agregar un
   CDN para esto rompería eso y sumaría cadena de suministro por nada.

   TRES COSAS SEPARADAS, y la separación es el punto:

     1. RESPALDO  la biblioteca del usuario —sus bases, sus análisis— va a
                  su cuenta. Identificada y privada: el RLS de Postgres no
                  deja que la vea nadie más, ni otro usuario logueado.

     2. APORTES   los análisis que arma alimentan la base común. ANÓNIMOS:
                  la tabla no tiene ni correo ni id de usuario. Además se
                  encolan y se mandan DESFASADOS, en la sesión siguiente,
                  para que cruzar timestamps con el respaldo no una las dos
                  cosas.

     3. REPORTES  errores y observaciones. Acá sí va el correo: un reporte
                  sin forma de repreguntar no sirve.

   Qué NUNCA sale de este equipo, y está filtrado acá y no solo en la
   interfaz: cantidades de obra, montos, cómputos métricos, nombre del
   proyecto y nombre de la entidad. Solo viaja la parte técnica —qué insumo,
   en qué unidad, a qué precio y con qué rendimiento—, que es lo único que
   sirve para armar una base de precios.
   ========================================================================= */
'use strict';

const NUBE = (() => {

  const CFG = typeof NUBE_CFG !== 'undefined' ? NUBE_CFG : null;
  const LS_SESION = 'openboq_sesion';
  const LS_COLA = 'openboq_cola_aportes';
  const LS_ULT_SYNC = 'openboq_ultimo_respaldo';

  const hay = () => !!(CFG && CFG.url && CFG.anon);

  /* ---------------------------------------------------------------- sesión */
  let sesion = null;
  try { sesion = JSON.parse(localStorage.getItem(LS_SESION) || 'null'); } catch (e) { }

  const guardarSesion = s => {
    sesion = s;
    try {
      if (s) localStorage.setItem(LS_SESION, JSON.stringify(s));
      else localStorage.removeItem(LS_SESION);
    } catch (e) { }
  };

  const usuario = () => sesion && sesion.user
    ? { id: sesion.user.id, email: sesion.user.email }
    : null;
  const conectado = () => !!usuario();

  /* Hay token guardado, aunque todavía no se haya traído el perfil. Es lo
     que distingue «entró» de «ya se sabe quién es»: al volver del proveedor
     el token llega primero y el perfil se pide después. Se lee del navegador
     y no de la copia en memoria, porque puede haberlo escrito otra ventana. */
  function hayToken() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_SESION) || 'null');
      return !!(s && s.access_token);
    } catch (e) { return false; }
  }

  /* --------------------------------------------------------------- HTTP */
  async function pedir(ruta, opciones) {
    if (!hay()) throw new Error('SIN_SERVIDOR');
    const o = opciones || {};
    const cab = {
      'apikey': CFG.anon,
      'Authorization': 'Bearer ' + ((sesion && sesion.access_token) || CFG.anon),
      'Content-Type': 'application/json'
    };
    Object.assign(cab, o.headers || {});
    const r = await fetch(CFG.url + ruta, {
      method: o.method || 'GET',
      headers: cab,
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    const txt = await r.text();
    let datos = null;
    try { datos = txt ? JSON.parse(txt) : null; } catch (e) { datos = txt; }
    if (!r.ok) {
      const msg = (datos && (datos.msg || datos.message || datos.error_description ||
        datos.error || datos.hint)) || ('HTTP ' + r.status);
      const err = new Error(msg); err.status = r.status; err.datos = datos;
      throw err;
    }
    return datos;
  }

  /** Reintenta una vez renovando el token: la sesión dura una hora. */
  async function pedirConSesion(ruta, opciones) {
    try { return await pedir(ruta, opciones); }
    catch (e) {
      if (e.status !== 401 || !sesion || !sesion.refresh_token) throw e;
      await renovar();
      return pedir(ruta, opciones);
    }
  }

  async function renovar() {
    const s = await pedir('/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', body: { refresh_token: sesion.refresh_token } });
    guardarSesion(s);
    return s;
  }

  /* ===================================================================
     CUENTA
     =================================================================== */

  /* Alta y entrada con correo y contraseña: SACADAS.
     El único ingreso es con proveedor (Google), en entrarCon(). Motivos:
     no había verificación de correo, el plan gratuito de Supabase corta los
     envíos («email rate limit exceeded») y la contraseña sumaba un secreto
     propio que administrar sin ganar nada. Si alguna vez vuelve, va acá y
     con confirmación de correo activada en el panel de Supabase. */

  /**
   * Google y demás: se abre EN UNA VENTANA APARTE y no en la misma pestaña.
   *
   * Yendo en la misma pestaña, el usuario pierde lo que tenía en pantalla y,
   * si cancela en Google, vuelve a una aplicación recargada de cero. En una
   * ventana propia el presupuesto se queda donde estaba y, al terminar, la
   * ventana se cierra sola y la sesión aparece en la que ya estaba abierta.
   *
   * Si el navegador bloquea las ventanas emergentes se usa la misma pestaña,
   * que es peor pero funciona.
   *
   * @returns {'navegador'|'ventana'|'misma-pestaña'|false}
   */
  function entrarCon(proveedor) {
    if (!hay()) return false;

    /* --- Aplicación de escritorio ---
       Google rechaza su propia pantalla de login dentro de una ventana de
       Electron (`disallowed_useragent`), así que ahí el login sale al
       navegador del sistema. La dirección de vuelta la da la aplicación:
       apunta a su servidor interno, que atrapa el token y lo mete en la
       ventana. Sin eso, la sesión terminaba guardada en el navegador y la
       aplicación seguía como invitada. */
    const ESC = typeof window !== 'undefined' ? window.OPENBOQ_ESCRITORIO : null;
    if (ESC && ESC.entrar && ESC.abrirLogin) {
      const vuelta = ESC.entrar(proveedor);
      if (vuelta) {
        const dir = CFG.url + '/auth/v1/authorize?provider=' + encodeURIComponent(proveedor) +
          '&redirect_to=' + encodeURIComponent(vuelta);
        if (ESC.abrirLogin(dir)) return 'navegador';
      }
    }

    const destino = location.origin + location.pathname;
    const url = CFG.url + '/auth/v1/authorize?provider=' + encodeURIComponent(proveedor) +
      '&redirect_to=' + encodeURIComponent(destino);
    let v = null;
    try {
      v = window.open(url, 'openboq_login',
        'width=520,height=680,menubar=no,toolbar=no,location=yes,resizable=yes');
    } catch (e) { v = null; }
    if (!v || v.closed) { location.href = url; return 'misma-pestaña'; }
    try { v.focus(); } catch (e) { }
    vigilarLogin(v);
    return 'ventana';
  }

  /**
   * ¿Estamos en una dirección desde la que el login NO puede volver?
   *
   * Devuelve la dirección oficial si la actual no es ni esa ni una de
   * desarrollo; null si todo está en orden. El caso real: las direcciones
   * que Cloudflare Pages arma por despliegue (`a14b47b1.openboq.pages.dev`)
   * sirven la aplicación perfectamente, pero Supabase no las tiene en su
   * lista, y entonces manda la sesión al Site URL. La ventana emergente
   * termina en otro origen, con la sesión, y la que abrió el login se queda
   * como invitada. Sin este aviso no hay forma de darse cuenta.
   */
  function origenAjeno() {
    const oficial = (CFG && CFG.sitio) || '';
    if (!oficial) return null;
    if (typeof location === 'undefined') return null;
    if (location.origin === oficial) return null;
    /* Desarrollo: esas direcciones se cargan a mano en el panel. */
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(location.origin)) return null;
    /* La aplicación de escritorio sirve desde su propio servidor interno. */
    if (typeof window !== 'undefined' && window.OPENBOQ_ESCRITORIO) return null;
    return oficial;
  }

  /* ------------------------------------------------- el login que no llega */
  /* Quién quiere enterarse de que el login terminó sin sesión. */
  let avisarFalla = null;

  /**
   * Registra el aviso de «la ventana se fue y acá no quedó nada».
   *
   * Existe por un modo de falla que costó una tarde: el proveedor valida la
   * dirección de vuelta CONTRA SU PROPIA LISTA, y si no está **no avisa** —
   * manda al usuario al Site URL del proyecto—. La ventana termina en otro
   * origen, guarda ahí la sesión y se queda abierta mostrando la cuenta
   * iniciada, mientras la ventana que la abrió sigue como invitada. Los tres
   * caminos de `alEntrar` no pueden ayudar: `postMessage` no cruza orígenes,
   * `storage` tampoco, y el sondeo lee otro `localStorage`.
   *
   * Sin esto el usuario ve dos ventanas que se contradicen y ningún mensaje.
   */
  function alFallarLogin(cb) { avisarFalla = cb; }

  /**
   * Mira la ventana de login y avisa si se termina sin sesión.
   *
   * No corta nada ni cierra nada: solo informa. Se apaga sola en cuanto
   * aparece el token, por cualquiera de los caminos de `alEntrar`.
   */
  function vigilarLogin(v) {
    if (hayToken()) return;
    const arranque = Date.now();
    const reloj = setInterval(() => {
      if (hayToken()) { clearInterval(reloj); return; }

      let cerrada = false;
      try { cerrada = !!(v && v.closed); } catch (e) { cerrada = false; }
      /* Dos minutos: pasado ese rato el circuito con el proveedor ya
         terminó, salga como salga. */
      const vencido = Date.now() - arranque > 120000;
      if (!cerrada && !vencido) return;

      clearInterval(reloj);
      /* Última lectura: el token pudo entrar entre el `if` de arriba y acá. */
      if (hayToken()) return;
      if (avisarFalla) avisarFalla({ origen: location.origin, cerrada, vencido });
    }, 1000);
  }

  /**
   * Al volver del proveedor, el token llega en el fragmento de la URL.
   * Se lee, se guarda y se limpia la barra de direcciones — si no, el token
   * queda a la vista y en el historial.
   *
   * Si esto corre en la ventana de login, además le avisa a la que la abrió
   * y se cierra sola.
   *
   * @returns {'popup'|true|false}
   */
  function recogerRedireccion() {
    if (!location.hash || location.hash.indexOf('access_token') < 0) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const at = p.get('access_token');
    if (!at) return false;
    guardarSesion({
      access_token: at,
      refresh_token: p.get('refresh_token'),
      token_type: p.get('token_type'),
      user: null
    });
    history.replaceState(null, '', location.pathname + location.search);

    const esVentana = (() => {
      try { return !!(window.opener && window.opener !== window && !window.opener.closed); }
      catch (e) { return false; }
    })();
    if (esVentana) {
      try { window.opener.postMessage({ openboq: 'sesion' }, location.origin); } catch (e) { }
      setTimeout(() => { try { window.close(); } catch (e) { } }, 150);
      return 'popup';
    }
    return true;
  }

  /**
   * Guarda una sesión que llegó de afuera de la página.
   *
   * La usa la aplicación de escritorio: el login terminó en el navegador
   * del sistema y el token entró por el servidor interno, no por la URL de
   * esta ventana. Es lo mismo que hace recogerRedireccion(), sin fragmento
   * que leer.
   *
   * @returns {boolean} si había algo que guardar
   */
  function tomarSesion(s) {
    if (!s || !s.access_token) return false;
    guardarSesion({
      access_token: s.access_token,
      refresh_token: s.refresh_token || null,
      token_type: s.token_type || 'bearer',
      user: null
    });
    return true;
  }

  /**
   * Vuelve a leer la sesión del navegador: la escribió la otra ventana.
   *
   * Devuelve si hay TOKEN, no si hay usuario. Al volver del proveedor la
   * sesión se guarda con `user: null` —el perfil se pide después, en
   * cargarUsuario()—, así que preguntar por el usuario acá daba siempre que
   * no y la pestaña principal nunca se enteraba de que ya había entrado.
   */
  function releerSesion() {
    try { sesion = JSON.parse(localStorage.getItem(LS_SESION) || 'null'); }
    catch (e) { sesion = null; }
    return !!(sesion && sesion.access_token);
  }

  /**
   * Avisa cuando la ventana de login terminó.
   *
   * Se escucha por dos caminos porque ninguno es seguro solo: `message` no
   * llega si el navegador perdió la referencia a la ventana que abrió, y
   * `storage` no se dispara si el login termina en la misma pestaña. Con los
   * dos, algún camino avisa.
   */
  function alEntrar(cb) {
    if (typeof window === 'undefined') return;

    /* CLAVE: esto avisa cuando alguien ENTRA, no cuando HAY sesión.
       Si al registrarse ya había token, no hay nada que avisar y se queda
       callado para siempre. Sin esta distinción, al arrancar con la sesión
       ya guardada el aviso se disparaba solo; y como quien lo escucha recarga
       la página, la aplicación quedaba recargando sin parar. */
    const habiaToken = hayToken();
    let avisado = habiaToken;

    const listo = () => {
      if (avisado) return;
      if (!releerSesion()) return;
      avisado = true;
      clearInterval(reloj);
      cb();
    };

    window.addEventListener('message', e => {
      if (e.origin !== location.origin) return;              // solo de nuestro propio sitio
      if (e.data && e.data.openboq === 'sesion') listo();
    });
    window.addEventListener('storage', e => {
      if (e.key === LS_SESION && e.newValue) listo();
    });

    /* Red de seguridad para cuando el navegador corta el vínculo con la
       ventana de login: ni el mensaje ni el evento llegan. Solo se arma si
       NO había sesión, y se apaga a los dos minutos: pasado ese rato, el
       login no está en curso y seguir mirando no tiene sentido. */
    let reloj = null;
    if (!habiaToken) {
      reloj = setInterval(() => { if (hayToken()) listo(); }, 1000);
      setTimeout(() => clearInterval(reloj), 120000);
    }
  }

  /** Completa los datos del usuario cuando la sesión vino del hash. */
  async function cargarUsuario() {
    if (!sesion || !sesion.access_token) return null;
    if (sesion.user) return usuario();
    try {
      const u = await pedirConSesion('/auth/v1/user');
      guardarSesion(Object.assign({}, sesion, { user: u }));
    } catch (e) { guardarSesion(null); }
    return usuario();
  }

  function salir() {
    guardarSesion(null);
    try { localStorage.removeItem(LS_ULT_SYNC); } catch (e) { }
  }

  /* ===================================================================
     RESPALDO DE LA BIBLIOTECA — identificado y privado
     =================================================================== */

  const ultimoRespaldo = () => {
    try { return localStorage.getItem(LS_ULT_SYNC) || ''; } catch (e) { return ''; }
  };

  /**
   * Sube la biblioteca completa del usuario.
   * @param {object} bd  el openboq_bd_propia entero
   */
  async function subirBiblioteca(bd, version) {
    if (!conectado()) throw new Error('SIN_SESION');
    const u = usuario();
    const bases = (bd && bd.bases) || [];
    const fila = {
      user_id: u.id,
      payload: bd || { bases: [], cambios: [] },
      n_bases: bases.length,
      n_apus: bases.reduce((s, b) => s + ((b.apus && b.apus.length) || 0), 0),
      app_version: version || '',
      actualizado_en: new Date().toISOString()
    };
    await pedirConSesion('/rest/v1/usuarios_bases?on_conflict=user_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: fila
    });
    try { localStorage.setItem(LS_ULT_SYNC, new Date().toISOString()); } catch (e) { }
    return { bases: fila.n_bases, apus: fila.n_apus };
  }

  /** Baja la biblioteca guardada. Devuelve null si no hay ninguna. */
  /** Lo que hay guardado, SIN bajar el contenido: para escribir el estado de
      la cuenta sin arrastrar toda la biblioteca por la red. */
  async function infoBiblioteca() {
    if (!conectado()) throw new Error('SIN_SESION');
    const r = await pedirConSesion(
      '/rest/v1/usuarios_bases?select=n_bases,n_apus,actualizado_en&limit=1');
    return (r && r.length) ? r[0] : null;
  }

  async function bajarBiblioteca() {
    if (!conectado()) throw new Error('SIN_SESION');
    const r = await pedirConSesion(
      '/rest/v1/usuarios_bases?select=payload,n_bases,n_apus,actualizado_en&limit=1');
    return (r && r.length) ? r[0] : null;
  }

  async function borrarBiblioteca() {
    if (!conectado()) throw new Error('SIN_SESION');
    await pedirConSesion('/rest/v1/usuarios_bases?user_id=eq.' + usuario().id,
      { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    try { localStorage.removeItem(LS_ULT_SYNC); } catch (e) { }
  }

  /* ===================================================================
     APORTES — anónimos, en cola, desfasados
     =================================================================== */

  const leerCola = () => {
    try { return JSON.parse(localStorage.getItem(LS_COLA) || '[]'); } catch (e) { return []; }
  };
  const escribirCola = c => {
    try { localStorage.setItem(LS_COLA, JSON.stringify(c.slice(-500))); } catch (e) { }
  };
  const enCola = () => leerCola().length;

  /** Huella estable del contenido, para no mandar dos veces lo mismo. */
  function huella(o) {
    const s = JSON.stringify(o);
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  /**
   * Arma el aporte a partir de un análisis, dejando afuera todo lo que no
   * sea técnico. Devuelve null si el análisis no debe salir del equipo.
   *
   * El filtro de la descripción está ACÁ y no solo en el diálogo de la
   * interfaz, porque los ítems creados antes de esa regla ya existen y la
   * base común no tiene por qué heredarlos.
   *
   * @param {{d:string,u:string,c:Array}} apu  descripción, unidad y componentes
   * @param {Function} revisar  MOTOR.revisarDescripcion
   */
  function armarAporte(apu, revisar) {
    if (!apu || !apu.d) return null;
    if (revisar && revisar(apu.d).nivel === 'bloqueo') return null;

    const comps = (apu.c || [])
      .filter(c => c && c.d && Number(c.q) > 0)
      .map(c => ({
        tipo: c.t === 'O' ? 'O' : c.t === 'E' ? 'E' : 'M',
        descripcion: String(c.d).trim().slice(0, 120),
        unidad: String(c.u || '').trim().slice(0, 12),
        precio: Number(c.p) || 0,
        rendimiento: Number(c.q) || 0
      }))
      /* un insumo sin precio no aporta nada a una base de precios */
      .filter(c => c.precio > 0);

    if (!comps.length) return null;

    /* Solo esto viaja. No hay cantidad de obra, ni monto, ni nombre de
       proyecto, ni entidad, ni cómputos: no están en el objeto. */
    return {
      descripcion: String(apu.d).trim().slice(0, 120),
      unidad: String(apu.u || '').trim().slice(0, 12),
      componentes: comps
    };
  }

  /** Encola un análisis. No manda nada todavía. */
  function encolar(apu, revisar, version) {
    const p = armarAporte(apu, revisar);
    if (!p) return false;
    const h = huella(p);
    const cola = leerCola();
    if (cola.some(x => x.hash === h)) return false;
    cola.push({ hash: h, payload: p, app_version: version || '', creado: Date.now() });
    escribirCola(cola);
    return true;
  }

  /**
   * Manda la cola.
   *
   * `soloViejos` deja pasar únicamente lo encolado hace más de `horas`. Es
   * lo que rompe la correlación con el respaldo: si el aporte saliera en el
   * mismo momento en que el usuario guarda su biblioteca, los dos
   * timestamps lo delatarían aunque la tabla no tenga su nombre.
   */
  async function enviarCola(opciones) {
    const o = opciones || {};
    if (!hay() || !navigator.onLine) return { enviados: 0, pendientes: enCola() };
    const corte = o.todos ? Infinity : Date.now() - (o.horas === undefined ? 6 : o.horas) * 3600000;
    const cola = leerCola();
    const listos = cola.filter(x => x.creado <= corte);
    if (!listos.length) return { enviados: 0, pendientes: cola.length };

    const lote = listos.slice(0, 50).map(x => ({
      payload: x.payload, hash: x.hash, estado: 'pendiente', app_version: x.app_version
    }));

    /* Se manda como INSERT puro, sin `resolution=`.
       `resolution=ignore-duplicates` convertiría esto en un UPSERT, y un
       UPSERT necesita permiso de UPDATE. Dárselo a la clave pública dejaría
       que cualquiera reescriba aportes ajenos —incluso marcarlos como
       aprobados—, así que la política es solo INSERT y el duplicado se
       resuelve acá: si el lote choca, se reintenta de a uno y el que ya
       estaba se descarta de la cola igual, porque ya llegó. */
    const idos = new Set();
    try {
      await pedir('/rest/v1/aportes',
        { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: lote });
      lote.forEach(x => idos.add(x.hash));
    } catch (e) {
      if (!esDuplicado(e)) return { enviados: 0, pendientes: cola.length, error: e.message };
      for (const fila of lote) {
        try {
          await pedir('/rest/v1/aportes',
            { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: [fila] });
          idos.add(fila.hash);
        } catch (e2) {
          if (esDuplicado(e2)) idos.add(fila.hash);   // ya estaba: fuera de la cola
        }
      }
    }
    escribirCola(cola.filter(x => !idos.has(x.hash)));
    return { enviados: idos.size, pendientes: enCola() };
  }

  /** ¿El servidor rechazó por hash repetido? Postgres: 23505. */
  const esDuplicado = e =>
    !!(e && e.datos && (e.datos.code === '23505' ||
      /duplicate key|already exists/i.test(e.datos.message || '')));

  const vaciarCola = () => escribirCola([]);

  /* ===================================================================
     PROYECTOS EN LA NUBE — hasta tres por cuenta

     La biblioteca (arriba) son los ANÁLISIS que el usuario armó. Esto es
     otra cosa: el PROYECTO entero —ítems, cantidades, cómputos, cronograma—
     para poder seguirlo en otro equipo.

     Tres reglas que vienen del servidor y no de acá (ver supabase/07):

       el tope es la propia tabla   `unique (user_id, slot)` con slot 1..3.
                                    No hay forma de guardar un cuarto.
       la etiqueta la pone Postgres  llega siempre como «Proyecto N»: el
                                    nombre de la obra no queda en ninguna
                                    columna legible desde el panel.
       el RLS decide                 solo el dueño lee, escribe y borra.

     EL CONTENIDO VA EN CLARO, protegido por RLS. Quien administra la base
     tiene, técnicamente, cómo abrir ese JSON; está escrito en la aplicación
     junto con el compromiso de para qué se usa. Quien no quiera confiar en
     eso pone el CANDADO: una frase suya cifra en su navegador el nombre, la
     entidad, la ubicación y los cómputos antes de subir.
     =================================================================== */

  const TOPE_PROYECTOS = 10;
  const RUTA_PROY = '/rest/v1/usuarios_proyectos';

  /* Columnas de la lista. El nombre se pide como un campo del JSON para no
     bajar el proyecto entero solo para escribir el listado; en los que
     tienen candado ese campo viene vacío a propósito. */
  const COLS_PROY = 'slot,etiqueta,protegido,n_items,bytes,app_version,' +
    'actualizado_en,nombre:payload->P->>nombre';

  async function listarProyectos() {
    if (!conectado()) throw new Error('SIN_SESION');
    const r = await pedirConSesion(RUTA_PROY + '?select=' + COLS_PROY + '&order=slot');
    return Array.isArray(r) ? r : [];
  }

  async function bajarProyecto(slot) {
    if (!conectado()) throw new Error('SIN_SESION');
    const r = await pedirConSesion(
      RUTA_PROY + '?select=slot,payload,protegido,actualizado_en&slot=eq.' + Number(slot) + '&limit=1');
    return (r && r.length) ? r[0] : null;
  }

  /**
   * Guarda (o reemplaza) el proyecto de un casillero.
   * @param {number} slot     1, 2 o 3
   * @param {object} payload  el proyecto serializado, ya empaquetado
   * @param {object} meta     {protegido, nItems, version}
   */
  async function guardarProyecto(slot, payload, meta) {
    if (!conectado()) throw new Error('SIN_SESION');
    const n = Number(slot);
    if (!(n >= 1 && n <= TOPE_PROYECTOS)) throw new Error('SLOT_FUERA_DE_RANGO');
    const m = meta || {};
    await pedirConSesion(RUTA_PROY + '?on_conflict=user_id,slot', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: usuario().id,
        slot: n,
        /* la manda igual por prolijidad; el servidor la reescribe */
        etiqueta: 'Proyecto ' + n,
        payload: payload,
        protegido: !!m.protegido,
        n_items: Number(m.nItems) || 0,
        app_version: m.version || ''
      }
    });
    return { slot: n };
  }

  async function borrarProyecto(slot) {
    if (!conectado()) throw new Error('SIN_SESION');
    await pedirConSesion(RUTA_PROY + '?slot=eq.' + Number(slot),
      { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  }

  /* ------------------------------------------------------------------
     EL CANDADO — opcional, y apagado salvo que el usuario lo pida

     AES-256-GCM con la clave derivada de la frase por PBKDF2-SHA256. Mismo
     criterio que el catálogo cifrado de la versión portable (js/cifrado.js),
     pero acá el paquete es un texto en base64 que viaja dentro del JSON:

         bytes 0..3    "OBQ2"
         bytes 4..19   sal (16)
         bytes 20..31  nonce (12)
         bytes 32..35  iteraciones (uint32 LE)
         bytes 36..    cifrado + etiqueta GCM

     ADVERTENCIA HONESTA, la misma de siempre: esto protege del volcado de la
     base y de quien la administra, no de quien sirve la aplicación. Si la
     frase se pierde, esos campos no los recupera nadie.
     ------------------------------------------------------------------ */

  const ITERACIONES = 200000;
  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  const hayCandado = () => !!subtle();

  function aB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  function deB64(b64) {
    const s = atob(String(b64).replace(/\s+/g, ''));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  async function clave(frase, sal, uso) {
    const base = await subtle().importKey(
      'raw', new TextEncoder().encode(String(frase).trim()), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: ITERACIONES, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, [uso]);
  }

  async function cerrarTexto(txt, frase) {
    if (!hayCandado()) throw new Error('SIN_CRIPTO');
    const sal = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await clave(frase, sal, 'encrypt');
    const c = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k,
      new TextEncoder().encode(txt)));
    const out = new Uint8Array(36 + c.length);
    out.set(new TextEncoder().encode('OBQ2'), 0);
    out.set(sal, 4);
    out.set(iv, 20);
    new DataView(out.buffer).setUint32(32, ITERACIONES, true);
    out.set(c, 36);
    return aB64(out);
  }

  async function abrirTexto(paquete, frase) {
    if (!hayCandado()) throw new Error('SIN_CRIPTO');
    const b = deB64(paquete);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'OBQ2')
      throw new Error('CANDADO_DESCONOCIDO');
    const sal = b.slice(4, 20), iv = b.slice(20, 32);
    const iter = new DataView(b.buffer, b.byteOffset + 32, 4).getUint32(0, true);
    const base = await subtle().importKey(
      'raw', new TextEncoder().encode(String(frase).trim()), 'PBKDF2', false, ['deriveKey']);
    const k = await subtle().deriveKey(
      { name: 'PBKDF2', salt: sal, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plano;
    try { plano = await subtle().decrypt({ name: 'AES-GCM', iv }, k, b.slice(36)); }
    catch (e) { throw new Error('FRASE_INCORRECTA'); }
    return new TextDecoder().decode(plano);
  }

  /**
   * Deja el proyecto listo para subir.
   *
   * Sin frase devuelve el mismo objeto. Con frase saca del JSON el nombre,
   * la entidad, la ubicación y TODOS los cómputos métricos, los mete en un
   * sobre cifrado y deja los campos vacíos: lo que llega al servidor no
   * dice de qué obra se trata ni qué se midió.
   *
   * @param {object} obj   lo que devuelve MOTOR.serializar(), ya parseado
   * @param {string} frase vacía = sin candado
   */
  async function empaquetarProyecto(obj, frase) {
    const copia = JSON.parse(JSON.stringify(obj));
    if (!frase) return { payload: copia, protegido: false };
    const P = copia.P || {};
    const sobre = { n: P.nombre || '', e: P.entidad || '', u: P.ubicacion || '', c: {} };
    (P.modulos || []).forEach(m => (m.items || []).forEach(it => {
      if (it.computos && it.computos.length) { sobre.c[it.id] = it.computos; it.computos = []; }
    }));
    P.nombre = '(protegido)'; P.entidad = ''; P.ubicacion = '';
    copia.candado = await cerrarTexto(JSON.stringify(sobre), frase);
    return { payload: copia, protegido: true };
  }

  /** Devuelve el proyecto a como estaba. Sin candado, lo deja igual. */
  async function desempaquetarProyecto(payload, frase) {
    if (!payload || !payload.candado) return payload;
    const sobre = JSON.parse(await abrirTexto(payload.candado, frase));
    const copia = JSON.parse(JSON.stringify(payload));
    delete copia.candado;
    const P = copia.P || {};
    P.nombre = sobre.n; P.entidad = sobre.e; P.ubicacion = sobre.u;
    (P.modulos || []).forEach(m => (m.items || []).forEach(it => {
      if (sobre.c && sobre.c[it.id]) it.computos = sobre.c[it.id];
    }));
    return copia;
  }

  /* ===================================================================
     REPORTES — identificados
     =================================================================== */
  async function reportar(mensaje, version, contexto) {
    const t = String(mensaje || '').trim();
    if (!t) throw new Error('MENSAJE_VACIO');
    const u = usuario();
    await pedir('/rest/v1/reportes', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: {
        user_id: u ? u.id : null,
        email: u ? u.email : null,
        mensaje: t.slice(0, 4900),
        version: version || '',
        estado: 'nuevo',
        contexto: Object.assign({
          navegador: navigator.userAgent.slice(0, 200),
          pantalla: (screen.width || 0) + 'x' + (screen.height || 0),
          idioma: navigator.language || ''
        }, contexto || {})
      }
    });
    return true;
  }

  /* ===================================================================
     USO — resumen para el administrador, sin contenido
     =================================================================== */
  /**
   * Manda un resumen de uso de la cuenta con sesión: cuántos proyectos tiene
   * en su Drive y cuánto pesan, si ya usó PRESCOM, qué interfaz eligió y la
   * versión. NUNCA un nombre de archivo ni un dato del proyecto: los proyectos
   * son del usuario y el servidor no tiene llave para abrirlos.
   *
   * Se manda solo si cambió algo o pasaron 12 horas, y cualquier falla se
   * traga: esto no le puede romper nada a quien está trabajando.
   *
   * @param {{drive?:Object, perfil?:Object, version?:string}} parcial
   */
  async function reportarUso(parcial) {
    const u = usuario();
    if (!hay() || !u || !parcial) return false;
    const clave = 'openboq_uso_' + u.id + '_' + Object.keys(parcial).sort().join('-');
    const firma = JSON.stringify(parcial);
    try {
      const prev = JSON.parse(localStorage.getItem(clave) || 'null');
      if (prev && prev.f === firma && Date.now() - prev.t < 12 * 3600e3) return false;
    } catch (e) { }
    try {
      await pedirConSesion('/rest/v1/rpc/obq_uso_reportar', { method: 'POST', body: { p: parcial } });
      try { localStorage.setItem(clave, JSON.stringify({ f: firma, t: Date.now() })); } catch (e) { }
      return true;
    } catch (e) { return false; }
  }

  /** El perfil guardado en la cuenta ({modo, usa_prescom}), o null si no hay o falla. */
  async function miPerfil() {
    if (!hay() || !usuario()) return null;
    try {
      const p = await pedirConSesion('/rest/v1/rpc/obq_uso_mi_perfil', { method: 'POST', body: {} });
      return p && typeof p === 'object' && p.modo ? p : null;
    } catch (e) { return null; }
  }

  /** El resumen de la carpeta de Drive, a partir de lo que devuelve DRIVE.listar. */
  function resumirDrive(archivos) {
    const r = { proyectos: 0, bytes: 0, items: 0, bibliotecas: 0, apus: 0, ultimo: null };
    (archivos || []).forEach(f => {
      const p = f.appProperties || {};
      r.bytes += Number(f.size) || 0;
      /* la biblioteca lleva `bases`; un proyecto lleva `items` */
      if (p.bases != null) { r.bibliotecas++; r.apus += Number(p.apus) || 0; }
      else { r.proyectos++; r.items += Number(p.items) || 0; }
      if (f.modifiedTime && (!r.ultimo || f.modifiedTime > r.ultimo)) r.ultimo = f.modifiedTime;
    });
    return r;
  }

  /* ===================================================================
     PANEL DE ADMINISTRACIÓN — solo para saber si mostrar el enlace
     =================================================================== */
  /**
   * ¿La cuenta con la sesión iniciada administra OpenBOQ?
   *
   * Lo decide el servidor (obq_admin_estado mira el correo firmado en el
   * token contra admin_config), así que el correo del administrador no
   * viaja en el código publicado. Esto solo pinta un enlace: la seguridad del
   * panel no depende de esta respuesta, cada función del panel vuelve a
   * preguntar. Ante cualquier error, no.
   */
  async function esAdmin() {
    if (!hay() || !hayToken()) return false;
    try {
      const r = await pedirConSesion('/rest/v1/rpc/obq_admin_estado', { method: 'POST', body: {} });
      return !!(r && r.admin);
    } catch (e) { return false; }
  }

  return {
    esAdmin,
    hay, conectado, usuario, hayToken,
    entrarCon, salir, recogerRedireccion, tomarSesion, cargarUsuario,
    alEntrar, alFallarLogin, releerSesion, origenAjeno,
    subirBiblioteca, bajarBiblioteca, infoBiblioteca, borrarBiblioteca, ultimoRespaldo,
    listarProyectos, bajarProyecto, guardarProyecto, borrarProyecto,
    empaquetarProyecto, desempaquetarProyecto, hayCandado, TOPE_PROYECTOS,
    encolar, enviarCola, enCola, vaciarCola, armarAporte,
    reportar, reportarUso, resumirDrive, miPerfil
  };
})();
