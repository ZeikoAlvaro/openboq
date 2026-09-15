/* =========================================================================
   OpenBOQ — respaldo en el Drive del propio usuario
   -------------------------------------------------------------------------
   La segunda pata del guardado. La primera —los aportes anónimos que
   alimentan la base común— vive en js/nube.js y NO se toca acá.

   QUÉ RESUELVE. Los proyectos y las bases propias son lo único que crece
   con la cantidad de usuarios: un proyecto de 250 ítems pesa 350 KB y una
   biblioteca de 400 análisis unos 220 KB. Guardados en el Postgres de
   Supabase, 200 usuarios llenan los 500 MB del plan gratuito. Guardados en
   el Drive de cada usuario no cuestan nada, con diez usuarios o con cien
   mil: 3,7 MB contra los 15 GB que Google ya le da a cada cuenta es el
   0,025 % de su espacio.

   Y resuelve algo más importante que el espacio: el archivo deja de pasar
   por un servidor ajeno. Hasta ahora el contenido guardado en la nube
   viajaba en claro bajo RLS, y por eso existía el candado con frase —quien
   administra el servidor puede, técnicamente, abrirlo—. Lo que vive en el
   Drive del usuario no lo ve nadie más.

   POR QUÉ NO SE USA EL SDK DE GOOGLE. js/nube.js habla con Supabase por
   `fetch` pelado a propósito: el proyecto no tiene dependencias y no quiere
   sumar cadena de suministro. El SDK de Google (`accounts.google.com/gsi/
   client`) es un script de un CDN que envuelve exactamente el mismo flujo
   que está acá abajo. Son dos URLs y un `fetch`: no vale un CDN.

   POR QUÉ NO SE GUARDA NINGÚN TOKEN DE DRIVE. Supabase no sirve para esto:
   entrega el `provider_token` una sola vez, al volver del login, y no lo
   renueva ni lo persiste. La salida obvia sería pedir `access_type=offline`,
   quedarse con el `provider_refresh_token` y guardarlo — pero eso es
   guardar una llave del Drive de cada usuario en un servidor, que es
   justamente el problema que este archivo viene a sacar.

   Así que el permiso de Drive se pide APARTE del login, con el flujo
   implícito: vuelve un token de una hora en el fragmento de la URL y se usa
   desde la memoria. No hay refresh token y en el servidor no queda nada.

   DÓNDE VIVE ESE TOKEN, Y POR QUÉ NO SOLO EN MEMORIA. Guardarlo únicamente
   en una variable tenía un costo que el usuario sí siente: recargar la
   página lo borraba, y la aplicación volvía a mostrar «Todavía no conectó su
   Drive» aunque el permiso siguiera dado y la sesión de Google siguiera
   iniciada —esa vive en localStorage, la pone Supabase—. Reconectar a mano
   después de cada F5 no es una medida de seguridad, es una molestia.

   Va entonces en `sessionStorage`, y la elección entre los dos almacenes es
   deliberada:
     · sobrevive a la recarga y a la navegación dentro de la misma pestaña,
       que es exactamente lo que hacía falta;
     · muere al cerrar la pestaña, y no se comparte con otras pestañas ni con
       otro perfil del navegador. En un equipo compartido —el caso normal en
       una oficina— nadie hereda un token vivo de la persona anterior.
   Lo que se guarda es el token de acceso de UNA hora, con alcance
   `drive.file`: da acceso solo a los archivos que esta aplicación creó, y
   caduca solo. El refresh token sigue sin existir, que es el punto.

   Lo que cuesta ese enfoque, dicho sin adornos: el token dura una hora y
   renovarlo necesita abrir una ventana, y una ventana necesita un GESTO del
   usuario. No existe la renovación eterna en segundo plano — el navegador no
   la permite. Lo que sí se puede, y es lo que hace `autorizar`, es montar la
   renovación en el clic que la necesita: al guardar en Drive, si el token
   venció, la ventana se abre y se cierra sola en menos de un segundo porque
   el permiso ya está dado. Invisible en la práctica, pero por ir pegada a
   una acción del usuario y no por magia.

   EL ALCANCE ES `drive.file`, Y ES DELIBERADO. Da acceso solo a los
   archivos que esta aplicación crea — no puede ver ni tocar el resto del
   Drive. Google lo clasifica como alcance NO SENSIBLE: no exige proceso de
   verificación, a diferencia de `drive` o `drive.readonly`, que son
   restringidos y arrastran auditoría de seguridad.

   No se usa `drive.appdata` —la carpeta oculta— por una razón práctica: el
   usuario no vería sus propios archivos, no podría copiarlos a mano, y si
   algún día desinstala la aplicación se los lleva. Con `drive.file` los ve
   en una carpeta «OpenBOQ» de su Drive y son suyos de verdad.
   ========================================================================= */
'use strict';

const DRIVE = (() => {

  const CFG = typeof DRIVE_CFG !== 'undefined' ? DRIVE_CFG : null;

  const ALCANCE = 'https://www.googleapis.com/auth/drive.file';
  const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = 'https://www.googleapis.com/drive/v3';
  const SUBIR = 'https://www.googleapis.com/upload/drive/v3';
  const CARPETA_MIME = 'application/vnd.google-apps.folder';
  const CARPETA = 'OpenBOQ';

  /* El id de la carpeta sí se guarda: no es un secreto, no sirve sin token,
     y evita una búsqueda por nombre en cada arranque. */
  const LS_CARPETA = 'openboq_drive_carpeta';

  /* Con qué cuenta se autorizó la última vez. Tampoco es un secreto —es el
     correo con el que ya entró a OpenBOQ— y sirve para dos cosas, las dos
     medibles:

       1. Saber que el permiso YA está dado, y entonces poder renovar con
          `prompt=none`, que no muestra ninguna pantalla.
       2. Ir como `login_hint`, para que Google no pregunte cuál de las
          cuentas abiertas usar.

     Sin esto la renovación tardaba 4,8 segundos y mostraba el selector de
     cuenta; con esto no muestra nada. La diferencia entre «invisible» y
     «una pantalla en medio del trabajo» es literalmente este renglón. */
  const LS_CUENTA = 'openboq_drive_cuenta';

  const cuentaVista = () => {
    try { return localStorage.getItem(LS_CUENTA) || null; } catch (e) { return null; }
  };
  const recordarCuenta = c => {
    if (!c) return;
    try {
      /* CAMBIO DE CUENTA. El id de la carpeta se guarda por NAVEGADOR, no por
         cuenta: si entra otra persona en el mismo equipo —o la misma persona
         con otro Google— hereda el id de un Drive que no es el suyo. Con el
         alcance `drive.file` ese id ni siquiera se puede mirar, así que todo
         termina en «Drive 404 · File not found». Al cambiar de cuenta se tira
         la carpeta recordada y se busca o se crea la que corresponde. */
      if (localStorage.getItem(LS_CUENTA) !== c) localStorage.removeItem(LS_CARPETA);
      localStorage.setItem(LS_CUENTA, c);
    } catch (e) { }
  };
  const olvidarCuenta = () => {
    try { localStorage.removeItem(LS_CUENTA); } catch (e) { }
  };

  const hay = () => !!(CFG && CFG.client_id);

  /* ------------------------------------------------------------- el token */
  /* En memoria y, espejado, en `sessionStorage` de la pestaña: ver el
     encabezado. Recargar ya no lo pierde; cerrar la pestaña sí. */
  const SS_TOKEN = 'openboq_drive_token';

  let token = null;
  let vence = 0;

  const vigente = () => !!token && Date.now() < vence - 60000;   // 1 min de aire

  /* `sessionStorage` no existe en el banco de pruebas —ni en un navegador con
     el almacenamiento bloqueado—, así que todo acceso va envuelto y el módulo
     sigue funcionando sin él, igual que antes: solo en memoria. */
  const almacen = () => {
    try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; }
    catch (e) { return null; }   // Chrome tira SecurityError con cookies bloqueadas
  };

  function anotarToken() {
    const a = almacen(); if (!a) return;
    try {
      if (token && vence) a.setItem(SS_TOKEN, JSON.stringify({ at: token, vence }));
      else a.removeItem(SS_TOKEN);
    } catch (e) { }
  }

  /**
   * Recupera el token de la pestaña al arrancar el módulo.
   *
   * Se descarta si ya venció —o si le queda menos del minuto de aire que usa
   * `vigente()`—: un token muerto en el almacén hace que la interfaz se pinte
   * como conectada y falle recién en el primer pedido a Drive.
   */
  (function recuperarToken() {
    const a = almacen(); if (!a) return;
    let g = null;
    try { g = JSON.parse(a.getItem(SS_TOKEN) || 'null'); } catch (e) { g = null; }
    if (g && g.at && Number(g.vence) > Date.now() + 60000) {
      token = String(g.at);
      vence = Number(g.vence);
      return;
    }
    try { a.removeItem(SS_TOKEN); } catch (e) { }
  })();

  function guardarToken(at, segundos) {
    token = at || null;
    vence = at ? Date.now() + (Number(segundos) || 3600) * 1000 : 0;
    anotarToken();
  }

  /** Suelta el token. No revoca el permiso: el usuario sigue autorizado. */
  function olvidar() {
    guardarToken(null, 0);
  }

  /* --------------------------------------------------------------- pedirlo */
  const azar = () => {
    const u = new Uint8Array(16);
    crypto.getRandomValues(u);
    return Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  function urlAutorizacion(estado, modo, correo) {
    const p = new URLSearchParams({
      client_id: CFG.client_id,
      redirect_uri: location.origin + '/drive.html',
      response_type: 'token',
      scope: ALCANCE,
      include_granted_scopes: 'true',
      state: estado
    });
    /* `none` es el reintento invisible: si el permiso ya está dado, Google
       devuelve el token sin mostrar nada; si no, contesta con un error y
       recién ahí se abre la ventana. */
    if (modo) p.set('prompt', modo);
    /* Sin esto, quien tiene varias cuentas de Google abiertas termina
       autorizando con la que no es y sus archivos van a parar a otro Drive.
       Se manda solo si es un correo: `cuentaVista()` puede devolver la marca
       suelta, y un login_hint basura hace fallar el pedido. */
    if (correo && correo.indexOf('@') > 0) p.set('login_hint', correo);
    return AUTORIZAR + '?' + p.toString();
  }

  /**
   * Consigue un token de Drive.
   *
   * UNA SOLA VENTANA POR LLAMADA, y esa es la regla que ordena todo esto.
   * El navegador permite abrir una ventana emergente por GESTO del usuario:
   * la segunda, aunque el código la pida enseguida, llega cuando el gesto ya
   * venció y queda bloqueada sin aviso. La primera versión probaba en
   * silencio y, si eso fallaba, abría la ventana de permiso — o sea que la
   * autorización inicial de CUALQUIER usuario iba a morir bloqueada.
   *
   * De ahí los dos modos, que no son intercambiables:
   *
   *   interactivo   hay un clic recién hecho. Se gasta el gesto en la
   *                 ventana que sirve, sin `prompt` forzado: si el permiso
   *                 ya está dado y hay una sola cuenta, Google devuelve el
   *                 token y la ventana se cierra en menos de un segundo.
   *
   *   sin más       no hay gesto. Solo se puede intentar `prompt=none`, que
   *                 funciona si el navegador todavía permite la ventana.
   *                 Si no, devuelve null y no rompe nada.
   *
   * Qué significa para el usuario: el token dura una hora, y la renovación
   * ocurre en el clic que la necesita —guardar, respaldar—. No es «invisible
   * para siempre»: es invisible PORQUE va montada en una acción suya.
   *
   * @param {{interactivo?:boolean, correo?:string}} [op]
   * @returns {Promise<string|null>} el token, o null si no se consiguió
   */
  async function autorizar(op) {
    if (!hay()) return null;
    if (vigente()) return token;

    /* El correo que pide quien llama manda; si no da ninguno, se usa el de
       la última autorización. */
    const correo = (op && op.correo) || cuentaVista();
    const yaAutorizado = !!cuentaVista();

    if (op && op.interactivo) {
      /* Renovación: el permiso ya está dado, así que `none` alcanza y no
         muestra nada. Se hace DENTRO del gesto, que es lo que la habilita. */
      if (yaAutorizado) {
        try { return await conRegistro(pedirEnVentana('none', correo), correo); }
        catch (e) {
          /* El permiso ya no vale: lo revocaron, o el consentimiento de
             prueba venció a los 7 días. No se puede abrir una segunda
             ventana —el gesto se gastó—, así que se limpia la marca y se
             devuelve null: el próximo clic pedirá el permiso de nuevo. */
          olvidarCuenta();
          return null;
        }
      }
      /* Primera vez: pantalla de permiso, una sola ventana. */
      return conRegistro(pedirEnVentana('', correo), correo);
    }

    try { return await conRegistro(pedirEnVentana('none', correo), correo); }
    catch (e) { return null; }
  }

  /**
   * Deja anotada la autorización en cuanto sale bien.
   *
   * Si quien llamó dio un correo, se guarda ese —sirve de `login_hint` y
   * ahorra el selector de cuenta—. Si no, se guarda una marca sola: alcanza
   * para saber que el permiso está dado, que es lo que habilita renovar con
   * `prompt=none`.
   */
  async function conRegistro(promesa, correo) {
    const at = await promesa;
    if (at) recordarCuenta(correo || cuentaVista() || 'si');
    return at;
  }

  /**
   * Lo que devuelve Google, dicho de forma que se pueda actuar.
   *
   * Existe por un caso real: una persona que no estaba en la lista de
   * usuarios de prueba intentó conectar su Drive y lo único que vio fue
   * «Drive: access_denied». No hay forma de que alguien deduzca de eso que el
   * problema no es suyo sino de cómo está publicada la aplicación.
   *
   * Los códigos son los de OAuth 2.0 de Google. No se traducen los que no
   * conocemos: se devuelven tal cual, que es más útil que inventar.
   */
  function explicarError(codigo) {
    const c = String(codigo || '').trim();
    switch (c) {
      case 'access_denied':
        return 'No se concedió el permiso de Drive. Puede ser que lo haya ' +
               'rechazado en la pantalla de Google, o que esta cuenta todavía no ' +
               'esté habilitada para usar OpenBOQ.';
      case 'admin_policy_enforced':
        return 'El administrador de su cuenta de Google no permite conectar ' +
               'aplicaciones externas al Drive. Suele pasar con las cuentas ' +
               'institucionales: hay que pedírselo a quien administra el dominio.';
      case 'org_internal':
        return 'Esta aplicación está limitada a otra organización y su cuenta ' +
               'no pertenece a ella.';
      case 'redirect_uri_mismatch':
        return 'La dirección de vuelta no coincide con la que está registrada ' +
               'en Google. Es un problema de configuración de OpenBOQ, no suyo.';
      case 'invalid_client':
        return 'Google no reconoce esta instalación de OpenBOQ. Es un problema ' +
               'de configuración, no suyo.';
      case 'interaction_required':
      case 'consent_required':
      case 'login_required':
        return 'Hace falta volver a dar el permiso: la autorización anterior ' +
               'ya no vale.';
      default:
        return c ? 'Google respondió: ' + c : 'Google no devolvió token';
    }
  }

  /**
   * Abre la ventana de Google y espera la vuelta.
   *
   * Con `prompt=none` la ventana no muestra nada y se cierra sola en menos
   * de un segundo; se abre igual porque el flujo implícito necesita un
   * contexto de navegación donde aterrizar el fragmento. Un iframe no
   * serviría: Google manda `X-Frame-Options` y lo bloquea.
   *
   * `modo` vacío deja decidir a Google: muestra el selector de cuenta o la
   * pantalla de permiso solo si hacen falta.
   */
  function pedirEnVentana(modo, correo) {
    return new Promise((listo, falla) => {
      const estado = azar();
      const url = urlAutorizacion(estado, modo, correo);

      const silencioso = modo === 'none';
      const medidas = silencioso
        ? 'width=1,height=1,left=-2000,top=-2000'
        : 'width=520,height=680,menubar=no,toolbar=no,location=yes,resizable=yes';

      let v = null;
      try { v = window.open(url, 'openboq_drive_' + (silencioso ? 's' : 'i'), medidas); }
      catch (e) { v = null; }
      if (!v || v.closed) { falla(new Error('El navegador bloqueó la ventana de permiso')); return; }
      if (!silencioso) { try { v.focus(); } catch (e) { } }

      let cerrado = false;
      const limpiar = () => {
        cerrado = true;
        window.removeEventListener('message', alMensaje);
        clearInterval(vigilia);
        clearTimeout(reloj);
        try { if (v && !v.closed) v.close(); } catch (e) { }
      };

      function alMensaje(ev) {
        if (ev.origin !== location.origin) return;
        const d = ev.data;
        if (!d || d.openboq !== 'drive' || d.state !== estado) return;
        limpiar();
        if (d.error) {
          const e = new Error(explicarError(d.error));
          e.codigo = d.error;          // el crudo, para poder diagnosticar
          falla(e); return;
        }
        if (!d.access_token) { falla(new Error('Google no devolvió token')); return; }
        guardarToken(d.access_token, d.expires_in);
        listo(token);
      }
      window.addEventListener('message', alMensaje);

      /* Si el usuario cierra la ventana con la cruz no llega ningún mensaje:
         sin esto la promesa queda colgada para siempre. */
      const vigilia = setInterval(() => {
        if (cerrado) return;
        let seCerro = false;
        try { seCerro = !!(v && v.closed); } catch (e) { seCerro = false; }
        if (seCerro) { limpiar(); falla(new Error('Se cerró la ventana de permiso')); }
      }, 400);

      const reloj = setTimeout(() => {
        if (cerrado) return;
        limpiar();
        falla(new Error(silencioso ? 'interaction_required' : 'Se agotó el tiempo de espera'));
      }, silencioso ? 8000 : 180000);
    });
  }

  /* ------------------------------------------------------------- la API */
  /**
   * Un pedido a Drive con el token puesto.
   *
   * Si Google contesta 401 el token venció antes de tiempo: se tira y se
   * reintenta UNA vez. Sin ese reintento, una sesión larga empieza a fallar
   * justo cuando el usuario está guardando.
   */
  async function pedir(url, op, reintento) {
    const at = await autorizar(op && op.auth);
    if (!at) throw new Error('Sin permiso de Drive');

    const cab = Object.assign({ Authorization: 'Bearer ' + at }, (op && op.headers) || {});
    const r = await fetch(url, {
      method: (op && op.method) || 'GET',
      headers: cab,
      body: op && op.body
    });

    if (r.status === 401 && !reintento) {
      olvidar();
      return pedir(url, op, true);
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('Drive ' + r.status + ' ' + t.slice(0, 160));
    }
    if (op && op.crudo) return r;
    if (r.status === 204) return null;
    return r.json();
  }

  /* --------------------------------------------------------- la carpeta */
  /**
   * Id de la carpeta «OpenBOQ», creándola si no está.
   *
   * OJO con el id guardado: si el usuario borra la carpeta desde el Drive,
   * el id sigue en localStorage y todo pedido contra él devuelve 404. Por
   * eso se verifica antes de usarlo, y si no responde se busca de nuevo.
   */
  async function carpeta(op) {
    let id = null;
    try { id = localStorage.getItem(LS_CARPETA); } catch (e) { }

    if (id) {
      try {
        const f = await pedir(API + '/files/' + id + '?fields=id,trashed', op);
        if (f && f.id && !f.trashed) return f.id;
      } catch (e) { /* ya no existe: se busca de nuevo */ }
      try { localStorage.removeItem(LS_CARPETA); } catch (e) { }
      /* SIN ESTA LINEA el id muerto sobrevive: el `if (!id)` de abajo da falso,
         no se crea ninguna carpeta y se devuelve el id que acaba de fallar. El
         guardado revienta con «Drive 404 · File not found: <id>» y no hay forma
         de salir, porque el id ya no esta en localStorage para volver a
         limpiarlo. Pasa en dos casos normales: el usuario borro la carpeta
         desde su Drive, u OTRA cuenta entro en el mismo navegador —el id es de
         un Drive ajeno y con `drive.file` ni siquiera se puede mirar—. */
      id = null;
    }

    const q = "name='" + CARPETA + "' and mimeType='" + CARPETA_MIME + "' and trashed=false";
    const bus = await pedir(API + '/files?q=' + encodeURIComponent(q) +
      '&fields=files(id,name)&pageSize=1', op);
    if (bus && bus.files && bus.files.length) id = bus.files[0].id;

    if (!id) {
      const nueva = await pedir(API + '/files?fields=id', Object.assign({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: CARPETA, mimeType: CARPETA_MIME })
      }, op));
      id = nueva.id;
    }

    try { localStorage.setItem(LS_CARPETA, id); } catch (e) { }
    return id;
  }

  /* -------------------------------------------------------- los archivos */
  const CAMPOS = 'id,name,size,modifiedTime,appProperties';

  /** Cuerpo multipart: metadatos + contenido en un solo pedido. */
  function multipart(meta, texto) {
    const b = '===openboq' + azar() + '===';
    const cuerpo =
      '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) + '\r\n' +
      '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      texto + '\r\n' +
      '--' + b + '--';
    return { cuerpo, tipo: 'multipart/related; boundary=' + b };
  }

  /**
   * Escribe un archivo en la carpeta. Si ya existe uno con ese nombre lo
   * reemplaza, en vez de dejar dos con el mismo nombre —cosa que Drive
   * permite y que confunde a cualquiera que mire su carpeta—.
   *
   * @param {string} nombre  p. ej. 'proyecto-1.boq.json'
   * @param {Object} obj     lo que se guarda, tal cual
   * @param {Object} [etiquetas]  metadatos chicos (n_items, version…)
   */
  async function escribir(nombre, obj, etiquetas, op, reintento) {
    const car = await carpeta(op);
    const texto = JSON.stringify(obj);
    const ya = await buscar(nombre, op);

    const props = {};
    Object.keys(etiquetas || {}).forEach(k => { props[k] = String(etiquetas[k]); });
    props.actualizado = new Date().toISOString();

    if (ya) {
      const { cuerpo, tipo } = multipart({ name: nombre, appProperties: props }, texto);
      return pedir(SUBIR + '/files/' + ya.id + '?uploadType=multipart&fields=' + CAMPOS,
        Object.assign({ method: 'PATCH', headers: { 'Content-Type': tipo }, body: cuerpo }, op));
    }

    const { cuerpo, tipo } = multipart(
      { name: nombre, parents: [car], appProperties: props }, texto);
    try {
      return await pedir(SUBIR + '/files?uploadType=multipart&fields=' + CAMPOS,
        Object.assign({ method: 'POST', headers: { 'Content-Type': tipo }, body: cuerpo }, op));
    } catch (e) {
      /* La carpeta se verificó hace un instante, pero pudo desaparecer entre
         medio —el usuario la borró desde su Drive mientras esto corría—. Un
         404 del padre no es motivo para perder el guardado: se olvida la
         carpeta y se rehace el circuito UNA vez. */
      if (reintento || !/404/.test(String(e.message))) throw e;
      try { localStorage.removeItem(LS_CARPETA); } catch (x) { }
      return escribir(nombre, obj, etiquetas, op, true);
    }
  }

  /** El archivo con ese nombre en la carpeta, o null. */
  async function buscar(nombre, op) {
    const car = await carpeta(op);
    const q = "'" + car + "' in parents and name='" +
      String(nombre).replace(/'/g, "\\'") + "' and trashed=false";
    const r = await pedir(API + '/files?q=' + encodeURIComponent(q) +
      '&fields=files(' + CAMPOS + ')&pageSize=1', op);
    return (r && r.files && r.files[0]) || null;
  }

  /** Todo lo que hay en la carpeta, lo más reciente primero. */
  async function listar(op) {
    const car = await carpeta(op);
    const q = "'" + car + "' in parents and trashed=false";
    const r = await pedir(API + '/files?q=' + encodeURIComponent(q) +
      '&fields=files(' + CAMPOS + ')&orderBy=modifiedTime desc&pageSize=100', op);
    const archivos = (r && r.files) || [];
    /* Cada listado deja al día el resumen de uso del panel: cuántos proyectos
       y cuánto pesan, sin nombres ni contenido. Toda lista pasa por acá —al
       abrir la pantalla de inicio, «Mi cuenta» y después de cada guardado o
       borrado—, así que no hace falta engancharlo en ningún otro lado. */
    try {
      if (typeof NUBE !== 'undefined' && NUBE.reportarUso)
        NUBE.reportarUso({ drive: NUBE.resumirDrive(archivos) });
    } catch (e) { }
    return archivos;
  }

  /** El contenido de un archivo, ya parseado. */
  async function leer(id, op) {
    const r = await pedir(API + '/files/' + id + '?alt=media',
      Object.assign({ crudo: true }, op));
    return r.json();
  }

  /** Manda un archivo a la papelera del usuario. No lo borra del todo: si
      se equivocó, lo recupera él desde su Drive. */
  async function borrar(id, op) {
    await pedir(API + '/files/' + id, Object.assign({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    }, op));
    return true;
  }

  /**
   * Para pintar el estado en CONFIGURACIÓN sin disparar ninguna ventana.
   *
   * `recordado` es lo que separa dos situaciones que se veían iguales y no lo
   * son: quien nunca dio el permiso, y quien lo dio pero se le venció el token
   * de la hora. Al segundo no hay que ofrecerle «Conectar con mi Drive» como
   * si empezara de cero — un clic suyo renueva con `prompt=none`, sin
   * pantallas.
   */
  function estado() {
    return {
      hay: hay(),
      autorizado: vigente(),
      recordado: !!cuentaVista(),
      vence: vence || null
    };
  }

  return {
    hay, autorizar, olvidar, estado,
    carpeta, escribir, buscar, listar, leer, borrar,
    ALCANCE
  };
})();
