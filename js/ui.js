/* =========================================================================
   OpenBOQ — interfaz de usuario
   ========================================================================= */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = REP.esc;
  const M = MOTOR;

  let vista = 'presupuesto';
  let baseSelId = 1;
  let apuSel = null;      // {base, apu} de la base de datos
  let sinGuardar = false;

  /* ===================== ARRANQUE ===================== */
  function init() {
    /* sin el módulo de PRESCOM, la tarjeta «Traer de PRESCOM» no se muestra */
    if (!HAY_IMPORTADOR) $$('[data-acc="importarDDP"]').forEach(b => { b.style.display = 'none'; });
    const recuperado = M.cargarLocal();
    if (!recuperado) M.proyectoNuevo('Sin nombre');
    $('#lUnidades').innerHTML = M.UNIDADES.map(u => `<option value="${esc(u)}">`).join('');
    llenarBases();
    conectarEventos();
    armarEscritorio();
    pintarTema();
    aplicarModo((leerPerfil() || {}).modo === 'simple');
    render();
    arrancarAcceso();
    arrancarSincro();
    /* el autoguardado no toca nada mientras se están probando cambios */
    setInterval(() => {
      if (sinGuardar && !ensayo) { M.guardarLocal(); marcarGuardado('Autoguardado ' + hora()); sinGuardar = false; }
    }, 20000);
    /* La Base de Datos de precios ya no lleva clave: viaja en claro con la
       aplicación y está cargada desde el arranque. Si el archivo no está,
       OpenBOQ funciona igual y el usuario puede armar su propia base. */
    /* ---------- cuenta y aportes ----------
       La cola se manda AL ARRANCAR y solo lo encolado hace más de seis
       horas. Ese desfase es a propósito: si el aporte saliera en el mismo
       momento en que el usuario guarda su biblioteca, los dos timestamps lo
       identificarían aunque la tabla de aportes no guarde su nombre. */
    if (hayNube()) {
      const vuelta = NUBE.recogerRedireccion();
      /* 'popup' = esta pestaña ES la ventana de login y se está por cerrar
         sola; no tiene sentido armar nada acá. */
      if (vuelta && vuelta !== 'popup')
        NUBE.cargarUsuario().then(u => {
          render();
          if (u) marcarGuardado('Conectado como ' + u.email);
          reportarArranque();
          /* Recién acá se sabe quién entró, y el correo es lo que evita que
             Google pregunte con cuál cuenta autorizar el Drive. */
          setTimeout(invitarDrive, 1500);
        });
      /* Se pregunta por el TOKEN y no por conectado(): conectado() exige
         tener ya el perfil, y al volver de Google el token llega primero y
         el perfil se pide recién acá. Preguntando por el perfil, quien entra
         con Google se quedaba viendo «Invitado» con la sesión iniciada. */
      else if (!vuelta && NUBE.hayToken()) NUBE.cargarUsuario().then(() => {
        render();
        reportarArranque();
        setTimeout(invitarDrive, 1500);
        /* Equipo nuevo: hay biblioteca guardada y acá no hay nada. Es el
           único caso en que preguntar sirve; si ya tiene bases propias, se
           calla y el usuario decide desde CONFIGURACIÓN → Mi cuenta. */
        if (M.basesPropias().length) return;
        NUBE.bajarBiblioteca().then(r => {
          if (!r || !r.n_apus) return;
          modal('Biblioteca guardada', `
            <p>Esta cuenta tiene <b>${r.n_bases}</b> base(s) y <b>${r.n_apus}</b> análisis,
            del ${new Date(r.actualizado_en).toLocaleString('es-BO')}.</p>`,
            [['Ahora no', null, 'sec'], ['Traerla', () => {
              M.importarBDU(r.payload); llenarBases(); buscarBase(); render();
              marcarGuardado('Biblioteca restaurada · ' + r.n_apus + ' análisis');
            }]]);
        }).catch(() => { });
      });

      /* Login en ventana aparte: cuando termina, se recarga.
         Recargar y no repintar a mano: al entrar cambia el estado de media
         aplicación —la cuenta, la biblioteca, lo que hay para respaldar— y
         armar todo eso a mano deja rincones sin actualizar. Como el proyecto
         vive en el navegador, no se pierde nada. */
      NUBE.alEntrar(recargarPorLogin);
      NUBE.alFallarLogin(avisarLoginSinSesion);
      setTimeout(() => { NUBE.enviarCola().catch(() => { }); }, 8000);
      window.addEventListener('online', () => { NUBE.enviarCola().catch(() => { }); });
    }

    if (recuperado && hayContenido()) {
      sinArchivo = true;
      marcarGuardado('Proyecto recuperado de este navegador');
    }
    /* Si la recarga vino de entrar a la cuenta, el usuario acaba de hacer otra
       cosa y su proyecto nunca estuvo en riesgo: la pantalla estorbaría. */
    if (!seRecargoPorLogin()) setTimeout(abrirInicio, 250);
  }

  /* ===================== BASE DE DATOS AL DÍA =====================
     La Base de Datos que viaja con la aplicación envejece: un precio
     corregido en el repositorio central no llega hasta republicar. `sync.js`
     se trae solo lo que cambió desde que se generó el archivo.

     Va DESPUÉS de render() y sin esperar a que termine: el usuario ya está
     trabajando mientras esto ocurre, y si no hay conexión no pasa nada. */
  /* Lo que contestó la última consulta al repositorio, para poder mostrarlo
     en CONFIGURACIÓN. Es del arranque de esta sesión, no se guarda. */
  let ultimoSincro = null;

  function arrancarSincro() {
    if (typeof SINCRO === 'undefined' || !SINCRO.hay()) return Promise.resolve(null);
    const cat = typeof window !== 'undefined' ? window.OPENBOQ_DB : null;

    return SINCRO.arrancar(cat, () => {
      /* llegaron precios nuevos: se repinta lo que los muestra */
      llenarBases();
      if (vista === 'base') buscarBase();
    }).then(r => {
      ultimoSincro = Object.assign({ hora: hora() }, r || {});
      if (!r || r.estado !== 'actualizado') return r;
      marcarGuardado('Base de Datos al día · ' + r.insumos + ' precio(s) actualizado(s)');
      return r;
    }).catch(e => {
      /* nunca corta la aplicación */
      ultimoSincro = { hora: hora(), estado: 'sin-conexion', error: String(e && e.message || e) };
      return ultimoSincro;
    });
  }

  /* ===================== ESTADO DE LA BASE DE DATOS =====================
     `SINCRO` trabaja callado a propósito: si el repositorio está pausado o no
     hay red, la aplicación sigue andando con el catálogo que trae y no avisa
     nada. El costo de ese silencio es que, cuando un precio no aparece, no
     hay forma de saber si el catálogo está al día o hace un mes que no se
     actualiza. Esta pantalla lo dice, y deja volver a preguntar y borrar lo
     bajado sin abrir la consola del navegador. */

  const TEXTO_SINCRO = {
    'al-dia': ['ok', 'Al día. El repositorio no tiene nada nuevo desde la marca del catálogo.'],
    'actualizado': ['ok', 'Se bajaron precios nuevos y ya están aplicados.'],
    'sin-nube': ['adv', 'Esta copia no tiene repositorio configurado: la Base de Datos es la que ' +
      'viaja con la aplicación y no se actualiza sola.'],
    'catalogo-sin-marca': ['adv', 'El catálogo no dice cuándo se generó, así que no hay desde ' +
      'dónde pedir los cambios. Se arregla al regenerar el catálogo.'],
    'sin-conexion': ['err', 'No se pudo consultar el repositorio. Puede ser que no haya conexión, ' +
      'o que el proyecto de Supabase esté pausado: se pausa a los siete días sin actividad. ' +
      'La aplicación sigue funcionando con el catálogo que trae.']
  };

  function panelSincro(est, ult) {
    const fila = (a, b) => `<tr><td class="et">${a}</td><td>${b}</td></tr>`;
    const cat = (typeof window !== 'undefined' && window.OPENBOQ_DB) || {};
    const e = (ult && ult.estado) || (est && est.hay ? 'al-dia' : 'sin-nube');
    const [clase, texto] = TEXTO_SINCRO[e] || ['adv', 'Estado desconocido: ' + e];
    const color = clase === 'ok' ? 'var(--ok)' : (clase === 'err' ? 'var(--err)' : 'var(--texto-tenue)');
    return `<p style="color:${color}"><b>${esc(texto)}</b></p>
      <table class="rej" style="margin-bottom:10px"><tbody>
        ${fila('Catálogo de la aplicación', 'generado el ' + esc(cat.generado_en || '—') +
          (cat.stats ? ' · ' + cat.stats.bases + ' bases · ' + cat.stats.apus + ' análisis · ' +
            cat.stats.insumos + ' insumos' : ''))}
        ${fila('Última consulta al repositorio', ult ? esc(ult.hora) +
          (ult.cambios ? ' · ' + ult.cambios + ' cambio(s)' : ' · sin novedades') +
          (ult.error ? ' · ' + esc(ult.error) : '') : 'todavía no se consultó en esta sesión')}
        ${fila('Guardado en este navegador', est && est.hay
          ? (est.cambios || 0) + ' cambio(s) bajado(s)' +
            (est.marca ? ', hasta ' + esc(est.marca) : '')
          : 'nada')}
      </tbody></table>
      <p class="mini">Lo bajado vive en este navegador y se vuelve a aplicar cada vez que abre la
        aplicación, también sin conexión. <b>Olvidar lo bajado</b> lo borra y deja el catálogo como
        vino con la aplicación; no se pierde nada: en la próxima consulta se vuelve a pedir.</p>`;
  }

  /** Abre el diálogo con lo que sabe SINCRO, y lo vuelve a pintar solo. */
  function abrirEstadoSincro(mensaje) {
    if (typeof SINCRO === 'undefined') {
      return modal('Base de Datos al día',
        '<p>Esta copia de OpenBOQ no trae el módulo de actualización.</p>', [['Cerrar', null, 'sec']]);
    }
    Promise.resolve(SINCRO.estado()).catch(() => ({ hay: false })).then(est => {
      modal('Base de Datos al día',
        (mensaje ? `<p style="color:var(--ok)"><b>${esc(mensaje)}</b></p>` : '') +
        panelSincro(est, ultimoSincro),
        [['Cerrar', null, 'sec'],
        ['Olvidar lo bajado', () => {
          if (!est || !est.hay) { abrirEstadoSincro('No había nada guardado.'); return false; }
          Promise.resolve(SINCRO.olvidar())
            .then(() => { ultimoSincro = null; abrirEstadoSincro('Se borró lo que estaba guardado.'); })
            .catch(e => abrirEstadoSincro('No se pudo borrar: ' + (e && e.message || e)));
          return false;
        }, 'sec'],
        ['Consultar ahora', () => {
          arrancarSincro().then(r => abrirEstadoSincro(
            !r ? 'Esta copia no tiene repositorio configurado.'
              : (r.estado === 'actualizado'
                ? 'Se bajaron ' + (r.insumos || 0) + ' precio(s).'
                : (r.estado === 'al-dia' ? 'Ya estaba al día.' : ''))));
          return false;
        }]]);
    });
  }

  /* ===================== TEMA CLARO U OSCURO =====================
     El tema es del equipo, no del proyecto: no viaja en el .boq ni en la
     nube, se guarda aparte en este navegador. Se aplica en el <html> con
     data-tema y toda la hoja de estilo cuelga de ahí; acá no se pinta ningún
     color a mano. El arranque ya lo dejó puesto un script en el <head> de
     index.html —antes de que se pinte nada, para que no haya un destello
     blanco—, así que esto solo lo cambia y lo guarda. */

  const CLAVE_TEMA = 'openboq_tema';
  /* La entidad no viene fijada por el programa: cada usuario escribe la suya
     la primera vez y queda recordada en este navegador para los proyectos
     siguientes. Si no hay nada guardado, el campo sale vacío. */
  const CLAVE_ENTIDAD = 'openboq_entidad';
  const entidadRecordada = () => {
    try { return localStorage.getItem(CLAVE_ENTIDAD) || ''; } catch (e) { return ''; }
  };
  const recordarEntidad = (v) => {
    try {
      if (v) localStorage.setItem(CLAVE_ENTIDAD, v);
      else localStorage.removeItem(CLAVE_ENTIDAD);
    } catch (e) { /* sin almacenamiento */ }
  };

  const temaActual = () => document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro';

  function fijarTema(t) {
    const oscuro = t === 'oscuro';
    if (oscuro) document.documentElement.dataset.tema = 'oscuro';
    else delete document.documentElement.dataset.tema;
    /* la barra del navegador en el celular acompaña al tema */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', oscuro ? '#14161a' : '#1f3864');
    try { localStorage.setItem(CLAVE_TEMA, oscuro ? 'oscuro' : 'claro'); } catch (e) { /* sin almacenamiento */ }
    pintarTema();
  }

  /** Deja el botón diciendo a qué tema se pasa si se lo pulsa. */
  function pintarTema() {
    const oscuro = temaActual() === 'oscuro';
    const b = $('#btnTema'), i = $('#btnTemaIcono'), t = $('#btnTemaTexto');
    if (i) i.textContent = oscuro ? '☀' : '🌙';
    if (t) t.textContent = oscuro ? 'Modo claro' : 'Modo oscuro';
    if (b) b.setAttribute('aria-pressed', oscuro ? 'true' : 'false');
  }

  /* ===================== MODO SIMPLE =====================
     La interfaz completa copia el orden de PRESCOM: quien viene de ahí la
     reconoce, y a quien nunca armó un presupuesto lo abruma —un probador lo
     dijo con esas palabras: «demasiado pesada»—.

     La primera vez, la pantalla de inicio pregunta si ya usó PRESCOM. Si dice
     que no, la aplicación queda en cuatro pasos: buscar ítems con precio,
     ponerles cantidad, ver el detalle del precio e imprimir. Lo demás no se
     borra ni se desactiva: se oculta con body.modo-simple, y la opción
     «Interfaz simple / completa» de CONFIGURACIÓN vuelve a la completa en
     cualquier momento. Estuvo también como botón ⇄ en la barra lateral y se
     sacó: hacía lo mismo y se apretaba sin querer.

     Es del equipo, igual que el tema: no viaja en el .boq. Sin respuesta, la
     interfaz es la completa de siempre. */
  const CLAVE_PERFIL = 'openboq_perfil';
  const VISTAS_SIMPLE = ['base', 'presupuesto', 'analisis', 'reportes'];
  /* nombre de cada paso en modo simple; en el completo vuelve el original */
  const NOMBRE_SIMPLE = { base: '① Buscar ítems', presupuesto: '② Mi presupuesto', analisis: '③ Detalle del precio', reportes: '④ Imprimir' };

  function leerPerfil() {
    try {
      const p = JSON.parse(localStorage.getItem(CLAVE_PERFIL) || 'null');
      return p && typeof p === 'object' ? p : null;
    } catch (e) { return null; }
  }
  const modoSimple = () => document.body.classList.contains('modo-simple');

  function aplicarModo(simple) {
    document.body.classList.toggle('modo-simple', !!simple);
    $$('#tabs button[data-v]').forEach(b => {
      if (!b.dataset.nombre) b.dataset.nombre = b.textContent.trim();
      b.textContent = simple && NOMBRE_SIMPLE[b.dataset.v] ? NOMBRE_SIMPLE[b.dataset.v] : b.dataset.nombre;
      b.title = b.textContent;
    });
    const bt = $('#btnModo');
    if (bt) {
      bt.querySelector('.txt').textContent = simple ? 'Interfaz completa' : 'Interfaz simple';
      bt.title = simple ? 'Ver todas las pestañas y menús (como PRESCOM)' : 'Solo los cuatro pasos básicos';
    }
    /* quien empieza no sabe qué base elegir: se busca en todas */
    const todas = $('#chkTodasBases');
    if (simple && todas && !todas.checked) { todas.checked = true; resBase = []; }
    if (simple && VISTAS_SIMPLE.indexOf(vista) < 0) irVista('presupuesto');
  }

  /** Guarda la elección (y, si la hay, la respuesta sobre PRESCOM) y la aplica. */
  function fijarModo(modo, usaPrescom) {
    const p = Object.assign({}, leerPerfil() || {}, { modo });
    if (typeof usaPrescom === 'boolean') p.usa_prescom = usaPrescom;
    try { localStorage.setItem(CLAVE_PERFIL, JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ }
    aplicarModo(modo === 'simple');
    render();
    if (hayNube() && NUBE.reportarUso) NUBE.reportarUso({ perfil: p });
  }

  /* La pregunta, arriba de todo en la pantalla de inicio, mientras no haya respuesta. */
  function pintarPerfilInicio() {
    const caja = $('#iniPerfil'); if (!caja) return;
    const p = leerPerfil();
    if (p && p.modo) { caja.innerHTML = ''; caja.className = ''; return; }
    caja.className = 'ini-perfil';
    caja.innerHTML = `
      <b>¿Ya usó PRESCOM u otro programa de presupuestos de obra?</b>
      <div class="ini-bts">
        <button class="btn" data-ini-queda data-perfil="nuevo">No, es mi primera vez</button>
        <button class="btn sec" data-ini-queda data-perfil="prescom">Sí, ya lo usé</button>
      </div>
      <span class="mini">Si es su primera vez, OpenBOQ arranca en <b>cuatro pasos simples</b>.
        Puede cambiar de interfaz cuando quiera desde <b>CONFIGURACIÓN → Interfaz simple / completa</b>.</span>`;
  }

  /* ===================== PANTALLA DE INICIO =====================
     Al abrir no se cae directo en el presupuesto: primero se muestra de qué
     se parte. Arriba la sesión anterior —el proyecto vive en el navegador
     entre sesiones y conviene decirlo, porque recién se pierde al crear otro
     o abrir otro archivo— y abajo las cuatro formas de empezar. Las acciones
     son las mismas del menú ARCHIVO: acá solo se muestran juntas. */

  function abrirInicio() {
    const P = M.proyecto();
    const hay = hayContenido();
    const n = P.modulos.reduce((s, m) => s + m.items.length, 0);
    $('#iniSesion').className = 'ini-sesion' + (hay ? '' : ' vacia');
    $('#iniSesion').innerHTML = hay
      ? `<h4>Continuar donde lo dejó</h4>
         <div class="proy"><b>${esc(P.nombre)}</b> — ${n} ítem(s), total
           ${M.fmt(M.conv(M.totalGeneral()))} ${P.moneda}</div>
         <div class="ini-bts">
           <button class="btn" data-ini-cerrar>Continuar</button>
           <button class="btn sec" data-acc="guardarComo">Guardar una copia…</button></div>`
      : `<h4>No hay ningún proyecto abierto</h4>
         <div class="mini">Este navegador no tiene trabajo guardado. Empiece por una de las
           cuatro opciones de abajo.</div>`;
    $('#iniPie').innerHTML = hay
      ? `El avance queda guardado en este navegador aunque cierre la pestaña o apague el equipo.
         Solo se reemplaza cuando crea un proyecto nuevo, abre otro <code>.boq</code> o importa un
         <code>.ddp</code>. Para tener una copia fuera del navegador use <b>ARCHIVO → Guardar</b>.
         Esta pantalla vuelve con <b>ARCHIVO → Pantalla de inicio</b>.`
      : `Lo que cargue queda guardado en este navegador hasta que lo reemplace.
         Esta pantalla vuelve con <b>ARCHIVO → Pantalla de inicio</b>.`;
    pintarNubeInicio();
    pintarPerfilInicio();
    pintarTema();
    $('#inicio').classList.add('on');
  }
  const cerrarInicio = () => $('#inicio').classList.remove('on');

  /* ---------- la caja de la cuenta, dentro de la pantalla de inicio ----------
     Sin sesión: la invitación a entrar. Con sesión: los diez «Proyecto N» de
     proyectos, que se piden al servidor y se pintan cuando llegan. Si esta
     copia no tiene servidor configurado, la caja no existe. */
  function pintarNubeInicio() {
    const caja = $('#iniNube'); if (!caja) return;
    if (!hayNube()) { caja.innerHTML = ''; caja.className = ''; return; }

    if (!NUBE.conectado()) {
      caja.className = 'ini-nube';
      caja.innerHTML = `
        <div class="ini-nube-t"><span>📂</span>
          <div><b>Tu base de datos, siempre disponible.</b>
            <em>Inicia sesión para sincronizar tus proyectos y acceder a ellos desde
            cualquier lugar.</em></div>
          <button class="btn" data-acc="cuenta">Iniciar sesión</button>
        </div>
        <p class="mini">Sin cuenta OpenBOQ funciona igual: todo queda en este equipo.</p>`;
      return;
    }

    /* Desde el 2026-09-10 el respaldo del usuario es SU Drive y nada más.
       Lo que se guardaba en el servidor —los diez proyectos y la biblioteca—
       salió de la interfaz: ver el comentario de miCuenta(). */
    caja.className = 'ini-nube dentro';
    caja.innerHTML = `
      <div class="ini-nube-t"><span>📁</span>
        <div><b>Mis proyectos en mi Drive</b>
          <em>${esc(NUBE.usuario().email || '')} — carpeta «OpenBOQ» de su Google Drive</em></div>
        <button class="btn sec" data-acc="driveGuardarProyecto">⬆ Guardar este proyecto</button>
      </div>
      <div class="ini-slots" id="iniDrive"><span class="mini">Buscando…</span></div>`;
    pintarDriveInicio();
  }

  /* Lo que se promete, escrito donde se decide subir algo y no escondido en
     un «acerca de». Va en la caja de guardar y en la de la lista. */
  const PIE_NUBE = `<p class="mini pie-nube">Los proyectos se guardan en su cuenta y solo usted
    los ve. <b>Los datos nunca serán utilizados para fines ajenos: OpenBOQ es de acceso libre y
    así se mantendrá siempre.</b></p>`;

  /** Repinta las dos listas de proyectos de la nube que pueden estar a la vista. */
  function refrescarNube() {
    const cajas = [$('#iniSlots'), $('#mpSlots')].filter(x => x && x.isConnected);
    if (!cajas.length || !hayNube() || !NUBE.conectado()) return;
    NUBE.listarProyectos()
      .then(L => cajas.forEach(c => { c.innerHTML = filasProyectos(L); }))
      .catch(e => cajas.forEach(c => {
        c.innerHTML = `<span class="mini">No se pudo consultar la nube: ${esc(e.message)}</span>`;
      }));
  }

  /* ================== RESPALDO EN EL DRIVE DEL USUARIO ==================
     La otra mitad del guardado. Los proyectos en la nube siguen donde
     estaban —hasta diez, en el servidor— y esto se suma al lado: el archivo
     completo en el Drive de la propia persona.

     Por qué importa acá y no es solo «otra opción de guardado»: lo que se
     guarda en el servidor lo puede abrir, técnicamente, quien lo administra,
     y por eso existe el candado con frase. Lo que va al Drive del usuario no
     lo ve nadie más. Además no consume el espacio del plan gratuito, que es
     lo único que crece con la cantidad de usuarios.

     LA REGLA QUE NO SE PUEDE ROMPER: toda llamada a DRIVE.autorizar tiene
     que salir DENTRO del clic del usuario. El navegador solo deja abrir la
     ventana de permiso con un gesto vivo; si se hace después de un `await`
     o desde un temporizador, la bloquea sin avisar. Por eso acá no se
     «prepara» nada antes: se llama derecho y se encadena con .then().
     ===================================================================== */
  const hayDrive = () => typeof DRIVE !== 'undefined' && DRIVE.hay();
  const LS_DRIVE_INVITADO = 'openboq_drive_invitado';

  const correoDrive = () => { const u = NUBE.usuario(); return (u && u.email) || null; };
  /* El correo va siempre: sin él Google pregunta con cuál de las cuentas
     abiertas autorizar, y los archivos terminan en el Drive equivocado. */
  const opDrive = () => ({ auth: { interactivo: true, correo: correoDrive() } });

  /* El archivo de la biblioteca. Nombre propio para que no choque con un
     proyecto que se llame parecido, y descriptivo para quien lo mire desde
     su Drive sin saber qué es. */
  const ARCHIVO_BDU = 'Mis bases y cambios.boq';

  /** Nombre del proyecto abierto como archivo de Drive. */
  function nombreDrive() {
    const P = M.proyecto();
    const n = String((P && P.nombre) || '').trim()
      .replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
    return (n && n !== 'Sin nombre' ? n : 'proyecto') + '.boq';
  }

  /* Cómo se muestra un archivo del Drive en la interfaz: sin la extensión.
     Adentro sigue siendo `.boq` —hace falta para no pisar otros archivos y
     para que se reconozca— pero al usuario le alcanza con el nombre. */
  const nombreVisible = n => String(n || '').replace(/\.(boq|json)$/i, '');

  /** Qué hay en la carpeta OpenBOQ del Drive, para el diálogo Mi cuenta. */
  function pintarDrive() {
    const c = $('#ctaDrive');
    if (!c) return;
    if (!hayDrive()) {
      c.innerHTML = '<p class="mini">Esta copia de OpenBOQ no tiene Drive configurado.</p>';
      return;
    }
    const dv = DRIVE.estado();
    if (!dv.autorizado) {
      /* El permiso de Google no vence, pero el token de una hora sí. A quien
         ya conectó no se le vuelve a explicar todo como si empezara de cero:
         se le dice qué pasó y que es un clic, que además no muestra ninguna
         pantalla porque va con `prompt=none`. */
      c.innerHTML = dv.recordado
        ? `<p class="mini">Su Drive está conectado, pero el permiso de esta sesión
        caducó (dura una hora). Un clic lo reanuda, sin pantallas de Google.</p>
        <button class="btn" data-acc="driveConectar">Reanudar mi Drive</button>`
        : `<p class="mini">Todavía no conectó su Drive. Los archivos quedan en
        <b>su</b> cuenta, en una carpeta «OpenBOQ», y OpenBOQ no puede ver nada más de su Drive.</p>
        <button class="btn" data-acc="driveConectar">Conectar con mi Drive</button>`;
      return;
    }
    c.innerHTML = '<p class="mini">Buscando…</p>';
    /* Se lista solo con el token vigente: así no hace falta ninguna ventana
       y esto puede correr sin que haya un clic detrás. */
    DRIVE.listar().then(fs => {
      const cc = $('#ctaDrive'); if (!cc) return;
      const filas = !fs.length
        ? '<p class="mini">La carpeta está vacía.</p>'
        : '<table class="rej comp cta"><tbody>' + fs.map(f => `<tr>
             <td>${esc(nombreVisible(f.name))}</td>
             <td class="mini">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('es-BO') : ''}</td>
             <td><button class="btn sec" data-drive-abrir="${esc(f.id)}">Abrir</button>
                 <button class="btn sec" data-drive-borrar="${esc(f.id)}" title="Mandar a la papelera de su Drive">Quitar</button></td>
           </tr>`).join('') + '</tbody></table>';
      cc.innerHTML = filas + `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn sec" data-acc="driveGuardarProyecto">⬆ Este proyecto a mi Drive</button>
          <button class="btn sec" data-acc="driveGuardarBiblioteca">⬆ Respaldar mis bases y cambios</button>
        </div>`;
    }).catch(e => {
      const cc = $('#ctaDrive'); if (!cc) return;
      cc.innerHTML = `<p class="mini">No se pudo consultar el Drive: ${esc(e.message)}</p>
        <button class="btn sec" data-acc="driveConectar">Volver a conectar</button>`;
    });
  }

  /**
   * Sube el proyecto abierto al Drive. Devuelve si salió bien.
   *
   * Lo usan el botón de «Mi cuenta», la caja de la pantalla de inicio y el
   * aviso de cambios sin guardar. Tiene que llamarse DENTRO del clic.
   */
  function respaldarProyectoEnDrive() {
    if (!hayDrive()) return Promise.resolve(false);
    return escribirProyectoDrive(nombreDrive());
  }

  /**
   * Escribe el proyecto en el Drive con el nombre que se le diga.
   * Separado del diálogo para que el que pregunta y el que escribe no se
   * mezclen: acá ya está decidido qué se pisa y qué no.
   */
  function escribirProyectoDrive(nombre) {
    const P = M.proyecto();
    const nItems = P.modulos.reduce((s, m) => s + m.items.length, 0);
    const obj = JSON.parse(M.serializar());
    marcarGuardado('Guardando en su Drive…');
    return DRIVE.escribir(nombre, obj, { items: nItems, version: VERSION }, opDrive())
      .then(f => {
        marcarGuardado('Guardado en su Drive · ' + nombreVisible(f.name));
        pintarDrive(); pintarDriveInicio();
        return true;
      })
      .catch(e => { marcarGuardado('No se pudo guardar en Drive: ' + e.message, true); return false; });
  }

  /**
   * Diálogo de guardado en Drive.
   *
   * Dos cosas que antes no se decían y por eso están acá: DÓNDE va el
   * archivo —la carpeta «OpenBOQ» de su Drive, y con qué cuenta— y si va a
   * PISAR uno que ya está. Antes se guardaba de una y el usuario se enteraba
   * después, o no se enteraba.
   *
   * @param {string} nombre   nombre propuesto, con extensión
   * @param {Object|null} ya  el archivo existente con ese nombre, si lo hay
   */
  function dialogoGuardarDrive(nombre, ya) {
    const pisa = !!ya;
    const cuerpo = `
      <p class="mini" style="margin:0 0 12px">Se guarda en la carpeta <b>OpenBOQ</b>
        de su Google Drive${correoDrive() ? ' — ' + esc(correoDrive()) : ''}.</p>
      <div class="form-g"><label>Nombre del archivo</label>
        <input id="dvNom" value="${esc(nombreVisible(nombre))}"></div>
      ${pisa ? `<p class="mini" style="color:var(--rojo,#b4232a)">
        <b>Ya existe «${esc(nombreVisible(ya.name))}» en su Drive</b>
        ${ya.modifiedTime ? '(del ' + new Date(ya.modifiedTime).toLocaleString('es-BO') + ')' : ''}.
        Si guarda con ese mismo nombre, <b>se reemplaza</b>. Para conservar el anterior,
        cambie el nombre acá arriba.</p>` : ''}`;

    modal('Guardar en mi Google Drive', cuerpo,
      [['Cancelar', null, 'sec'],
       [pisa ? 'Reemplazar' : 'Guardar', () => {
         const escrito = ($('#dvNom').value || '').trim();
         if (!escrito) { alert('Poné un nombre para el archivo.'); return false; }
         const nuevo = escrito.replace(/\.(boq|json)$/i, '') + '.boq';

         /* Mismo nombre que el que ya se consultó: la advertencia ya se dio
            y el usuario la aceptó. Se escribe sin más vueltas. */
         if (nuevo === nombre) { escribirProyectoDrive(nuevo); return; }

         /* Nombre distinto: hay que volver a mirar, porque ESE otro también
            puede existir y estaríamos pisando algo sin avisar. */
         DRIVE.buscar(nuevo, opDrive()).then(otro => {
           if (!otro) return escribirProyectoDrive(nuevo);
           setTimeout(() => modal('Ese nombre ya existe', `
             <p>En su Drive ya hay un archivo llamado <b>${esc(nombreVisible(nuevo))}</b>
             ${otro.modifiedTime ? ', del ' + new Date(otro.modifiedTime).toLocaleString('es-BO') : ''}.</p>
             <p>Si continúa, <b>se reemplaza</b>.</p>`,
             [['Cancelar', null, 'sec'],
              ['Reemplazar', () => { escribirProyectoDrive(nuevo); }, 'rojo']]), 60);
         }).catch(e => marcarGuardado('No se pudo consultar el Drive: ' + e.message, true));
       }, pisa ? 'rojo' : '']]);

    setTimeout(() => { const i = $('#dvNom'); if (i) { i.focus(); i.select(); } }, 60);
  }

  /** Los archivos del Drive en la caja de la pantalla de inicio. */
  function pintarDriveInicio() {
    const c = $('#iniDrive');
    if (!c || !c.isConnected) return;
    if (!hayDrive()) { c.innerHTML = '<span class="mini">Esta copia no tiene Drive configurado.</span>'; return; }
    const dvi = DRIVE.estado();
    if (!dvi.autorizado) {
      c.innerHTML = (dvi.recordado
        ? `<span class="mini">Su Drive está conectado; el permiso de esta sesión caducó
        (dura una hora). Un clic lo reanuda, sin pantallas.</span>
        <div style="margin-top:8px"><button class="btn" data-acc="driveConectar">Reanudar mi Drive</button></div>`
        : `<span class="mini">Todavía no conectó su Drive. Sus proyectos quedan
        en <b>su</b> cuenta y no los ve nadie más.</span>
        <div style="margin-top:8px"><button class="btn" data-acc="driveConectar">Conectar con mi Drive</button></div>`);
      return;
    }
    DRIVE.listar().then(fs => {
      const cc = $('#iniDrive'); if (!cc || !cc.isConnected) return;
      cc.innerHTML = !fs.length
        ? '<span class="mini">Todavía no guardó nada en su Drive.</span>'
        : '<table class="rej comp cta"><tbody>' + fs.map(f => `<tr>
             <td>${esc(nombreVisible(f.name))}</td>
             <td class="mini">${f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('es-BO') : ''}</td>
             <td><button class="btn sec" data-drive-abrir="${esc(f.id)}">Abrir</button>
                 <button class="btn sec" data-drive-borrar="${esc(f.id)}" title="Mandar a la papelera de su Drive">Quitar</button></td>
           </tr>`).join('') + '</tbody></table>';
    }).catch(e => {
      const cc = $('#iniDrive'); if (!cc || !cc.isConnected) return;
      cc.innerHTML = `<span class="mini">No se pudo consultar el Drive: ${esc(e.message)}</span>`;
    });
  }

  /**
   * Ofrece conectar el Drive, una sola vez por navegador.
   *
   * Se calla si ya hay otro diálogo abierto: al volver del login puede estar
   * la oferta de traer la biblioteca guardada, y encimar dos ventanas es la
   * forma más rápida de que el usuario cierre las dos sin leer ninguna.
   */
  function invitarDrive() {
    if (!hayDrive() || !hayNube() || !NUBE.conectado()) return;
    /* `recordado` también corta: si ya dio el permiso alguna vez, la oferta
       sobra aunque el token de la hora se haya vencido. */
    if (DRIVE.estado().autorizado || DRIVE.estado().recordado) return;
    try { if (localStorage.getItem(LS_DRIVE_INVITADO)) return; } catch (e) { }
    const ov = $('#overlay');
    if (ov && ov.classList.contains('on')) return;

    const marcar = () => { try { localStorage.setItem(LS_DRIVE_INVITADO, '1'); } catch (e) { } };
    modal('Guardar en su propio Google Drive', `
      <p>OpenBOQ puede guardar sus proyectos y sus bases propias <b>en el Google Drive de
      su cuenta</b>, en una carpeta llamada «OpenBOQ».</p>
      <p class="mini">Los archivos son suyos: los ve, los copia y los borra desde su Drive.
      OpenBOQ <b>solo puede tocar los archivos que él mismo crea</b> — no puede ver ni abrir
      nada más de su Drive. Y a diferencia de los proyectos guardados en el servidor, estos
      no los puede leer nadie más, ni quien administra OpenBOQ.</p>
      <p class="mini">Google le va a pedir permiso una vez. Puede quitarlo cuando quiera
      desde su cuenta de Google.</p>`,
      [['Ahora no', marcar, 'sec'],
       ['Conectar mi Drive', () => { marcar(); ACC.driveConectar(); }]]);
  }

  /** Empaqueta el proyecto abierto y lo sube al lugar que se le diga. */
  async function subirProyecto(slot, frase, nItems) {
    const obj = JSON.parse(M.serializar());
    const paq = await NUBE.empaquetarProyecto(obj, frase);
    await NUBE.guardarProyecto(slot, paq.payload,
      { protegido: paq.protegido, nItems: nItems, version: VERSION });
    marcarGuardado('Guardado en la nube · Proyecto ' + slot +
      (paq.protegido ? ' · con candado' : ''));
    return paq;
  }

  /** Los diez lugares de la nube, ocupados o no. Cada uno se llama
      «Proyecto N» en toda la interfaz: es la etiqueta que escribe el
      servidor y la única que se ve desde el panel. */
  function filasProyectos(L) {
    const por = {};
    (L || []).forEach(p => { por[p.slot] = p; });
    let h = '';
    for (let s = 1; s <= NUBE.TOPE_PROYECTOS; s++) {
      const p = por[s];
      if (!p) {
        h += `<div class="slot vacio"><b>Proyecto ${s}</b>
          <span class="mini">libre</span>
          <button class="btn sec" data-nube-guardar="${s}">Guardar acá</button></div>`;
        continue;
      }
      const crudo = p.protegido ? '🔒 ' + (p.etiqueta || '') : (p.nombre || p.etiqueta || '');
      const nom = esc(crudo);
      /* el nombre se recorta con puntos suspensivos si no entra en el
         recuadro: el title lo muestra entero sin romper la rejilla */
      h += `<div class="slot"><b title="${nom}">${nom}</b>
        <span class="mini">${p.n_items || 0} ítem(s) · ${Math.round((p.bytes || 0) / 1024)} KB ·
          ${new Date(p.actualizado_en).toLocaleString('es-BO')}</span>
        <span class="slot-bts">
          <button class="btn" data-nube-abrir="${s}">Abrir</button>
          <button class="btn sec" data-nube-guardar="${s}" title="Reemplazar con el proyecto abierto">⬆</button>
          <button class="btn sec" data-nube-borrar="${s}" title="Quitar de la nube">🗑</button>
        </span></div>`;
    }
    return h;
  }


  /* ===================== CONTROL DE ACCESO EN LÍNEA =====================
     OpenBOQ necesita comunicarse con el servidor cada tanto para seguir
     habilitada. Sin señal se puede seguir cargando el proyecto y guardarlo
     en un .boq —para que nadie pierda trabajo—, pero no exportar ni sacar
     reportes. Pasada la tolerancia, queda solo el guardado. */

  const hayAcceso = () => typeof ACCESO !== 'undefined' && ACCESO.aplica();

  function arrancarAcceso() {
    if (typeof ACCESO === 'undefined') return;
    ACCESO.iniciar(pintarAcceso);
  }

  /**
   * Estado de la conexión: solo un punto de color en la barra, sin texto.
   * Verde comunicado, amarillo sin señal, rojo sin conexión hace rato.
   * No bloquea nada: la aplicación funciona igual, lo único que necesita
   * clave es la Base de Datos de precios.
   */
  function pintarAcceso(e) {
    const el = $('#stAcceso');
    if (!el) return;
    if (!hayAcceso()) { el.style.display = 'none'; return; }
    const color = { activo: '#1e9e4a', espera: '#d8a300', bloqueado: '#c0392b' }[e.estado] || '#999';
    el.style.display = '';
    el.style.color = color;
    el.textContent = '●';
    el.title = { activo: 'Conectado', espera: 'Sin conexión', bloqueado: 'Sin conexión' }[e.estado] || '';
  }

  /* =====================================================================
     CUENTA, RESPALDO Y APORTES

     La cuenta existe para el usuario, no para el servidor: su biblioteca de
     análisis deja de vivir solo en este navegador y sobrevive a un formateo
     o a un cambio de equipo. Sin cuenta, la aplicación funciona igual.

     Aparte de eso, y por separado, los análisis que arma alimentan la base
     de precios común. Eso va ANÓNIMO —la tabla no guarda quién lo mandó— y
     desfasado en el tiempo, para que no se pueda cruzar con el respaldo.
     ===================================================================== */
  const VERSION = '2.6';
  const hayNube = () => typeof NUBE !== 'undefined' && NUBE.hay();

  /* Al entrar con la cuenta: versión y perfil para el panel de administración
     (NUBE.reportarUso no manda nada si no cambió y no pasaron 12 horas). */
  function reportarArranque() {
    if (!hayNube() || !NUBE.reportarUso) return;
    const p = leerPerfil();
    if (p && p.modo) return NUBE.reportarUso({ version: VERSION, perfil: p });
    NUBE.reportarUso({ version: VERSION });
    /* Este navegador no sabe nada (equipo nuevo, o se borró la caché), pero la
       cuenta quizá ya contestó: se toma de ahí y no se vuelve a preguntar. */
    if (NUBE.miPerfil) NUBE.miPerfil().then(r => {
      if (!r || (leerPerfil() || {}).modo) return;
      try { localStorage.setItem(CLAVE_PERFIL, JSON.stringify(r)); } catch (e) { /* sin almacenamiento */ }
      aplicarModo(r.modo === 'simple');
      render();
      pintarPerfilInicio();
    });
  }

  /* Entrar recarga la página: al iniciar sesión cambia el estado de media
     aplicación y repintar a mano deja rincones sin actualizar. La marca
     sirve para que el arranque sepa de dónde viene y no repita avisos que
     no corresponden. Se borra al leerla. */
  /**
   * La ventana de acceso terminó y acá no quedó sesión.
   *
   * El caso que hay que poder diagnosticar sin leer código: el proveedor
   * valida la dirección de vuelta contra su lista y, si no está, manda al
   * usuario al Site URL del proyecto en vez de avisar. La ventana queda
   * abierta mostrando la cuenta iniciada —pero en OTRO origen— y esta se
   * queda como invitada. Pasa siempre al probar en `localhost`, porque esa
   * dirección no suele estar cargada en el panel.
   *
   * El detalle técnico solo se muestra cuando estamos en una dirección de
   * prueba: al usuario final no le sirve y lo asusta.
   */
  function avisarLoginSinSesion(d) {
    const oficial = NUBE.origenAjeno && NUBE.origenAjeno();
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(d.origen);

    /* Tres situaciones distintas y tres mensajes distintos. El peor de todos
       era el silencio: la ventana emergente con la cuenta iniciada y esta
       pantalla como invitada, sin una sola palabra que explicara por qué. */
    let pista = '';
    if (oficial) {
      pista = `<p class="mini">Está usando <b>${esc(d.origen)}</b>, una dirección de prueba
        de un despliegue. El proveedor no la tiene autorizada, así que mandó la sesión a
        <b>${esc(oficial)}</b> — y por eso quedó en la otra ventana.<br>
        Entre por <a href="${esc(oficial)}" target="_blank" rel="noopener"><b>${esc(oficial)}</b></a>.</p>`;
    } else if (local) {
      pista = `<p class="mini">Si la ventana llegó a mostrar la cuenta pero acá sigue como
        invitado, la vuelta terminó en otra dirección. En Supabase →
        <b>Authentication → URL Configuration → Redirect URLs</b> tiene que estar
        <code>${esc(d.origen)}/**</code>. Sin eso el proveedor no avisa: manda la sesión
        al Site URL del proyecto.</p>`;
    }
    modal('No se completó el acceso', `
      <p>La ventana de acceso se cerró sin dejar una sesión iniciada acá.</p>
      ${pista}`, [['Entendido', null]]);
  }

  const MARCA_LOGIN = 'openboq_recarga_login';
  function recargarPorLogin() {
    try { sessionStorage.setItem(MARCA_LOGIN, '1'); } catch (e) { }
    location.reload();
  }
  function seRecargoPorLogin() {
    try {
      const s = sessionStorage.getItem(MARCA_LOGIN);
      if (s) sessionStorage.removeItem(MARCA_LOGIN);
      return !!s;
    } catch (e) { return false; }
  }

  /** Encola los análisis del presupuesto para la base común. */
  function aportarDelProyecto() {
    if (!hayNube()) return 0;
    let n = 0;
    M.proyecto().modulos.forEach(m => m.items.forEach(it => {
      if (!it.comp || !it.comp.length) return;
      const a = M.analisis(it);
      const c = [].concat(a.grupos.M, a.grupos.O, a.grupos.E)
        .map(x => ({ t: x.ins.t, d: x.ins.d, u: x.ins.u, p: x.ins.p, q: x.rend }));
      if (NUBE.encolar({ d: it.desc, u: it.und, c }, M.revisarDescripcion, VERSION)) n++;
    }));
    return n;
  }

  /* El ingreso es solo con Google (NUBE.entrarCon). El alta con correo y
     contraseña se sacó: no había verificación de correo, el plan gratuito de
     Supabase corta los envíos por hora, y una contraseña más que administrar
     no aporta nada frente al proveedor. */

  /**
   * Quién está usando la aplicación. Se pinta en los DOS lugares donde figura:
   * la barra de estado (`#stCuenta`) y el pie de la barra lateral
   * (`#btnCuenta`). El del pie decía «Invitado» fijo en el HTML y no se
   * actualizaba nunca: con la sesión iniciada seguía diciendo «Invitado» y
   * recién al hacer clic aparecían los datos de la cuenta.
   *
   * Sin cuenta dice «Invitado» y no «Sin cuenta»: la aplicación funciona
   * igual sin entrar, así que no corresponde que parezca una carencia.
   */
  function pintarCuenta() {
    const el = $('#stCuenta'), bt = $('#btnCuenta');
    if (!el && !bt) return;
    if (!hayNube()) {
      if (el) el.style.display = 'none';
      if (bt) bt.style.display = 'none';
      return;
    }
    const u = NUBE.usuario();
    const titulo = u
      ? 'Conectado como ' + u.email + ' — clic para ver la cuenta'
      : 'Entrar con una cuenta para guardar su biblioteca en el servidor';

    if (el) {
      el.style.display = '';
      el.textContent = '👤 ' + (u ? u.email : 'Invitado');
      el.classList.toggle('dentro', !!u);
      el.title = titulo;
    }
    if (bt) {
      bt.style.display = '';
      /* Solo el texto: el 👤 vive en su propio <span class="i"> porque es lo
         único que queda visible con la barra lateral plegada. */
      const txt = bt.querySelector('.txt');
      if (txt) txt.textContent = u ? u.email : 'Invitado';
      bt.classList.toggle('dentro', !!u);
      bt.title = titulo;
    }
  }

  /* ---------- descripciones genéricas ----------
     El ítem describe una actividad, no una obra. `MOTOR.revisarDescripcion`
     decide; acá solo se muestra. El aviso se pinta mientras se escribe para
     que la persona corrija antes de terminar y no descubra el problema
     recién al apretar el botón. */
  function mostrarRevision(idInput, idAviso, rev) {
    const caja = $('#' + idAviso), inp = $('#' + idInput);
    if (!caja) return;
    if (!rev || rev.nivel === 'ok') {
      caja.innerHTML = '';
      if (inp) inp.style.borderColor = '';
      return;
    }
    const bloquea = rev.nivel === 'bloqueo';
    const color = bloquea ? 'var(--err)' : 'var(--aviso)';
    caja.innerHTML = `<p class="mini" style="color:${color};margin:6px 0 0">
      <b>${bloquea ? 'No se puede usar esta descripción' : 'Revise la descripción'}:</b>
      ${esc(rev.motivo)}.</p>`;
    if (inp && bloquea) { inp.style.borderColor = color; inp.focus(); }
  }

  /** Revisa la descripción a medida que se escribe. */
  function revisarMientrasEscribe(idInput, idAviso) {
    const inp = $('#' + idInput);
    if (!inp) return;
    inp.addEventListener('input', () => {
      const t = inp.value.trim();
      mostrarRevision(idInput, idAviso, t ? M.revisarDescripcion(t) : null);
    });
  }

  const hora = () => new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  function marcarGuardado(t, alerta) {
    const el = $('#stGuardado');
    el.textContent = t;
    el.style.color = alerta ? 'var(--err)' : '';
    el.style.fontWeight = alerta ? '700' : '';
  }
  function tocar() { sinGuardar = true; sinArchivo = true; marcarGuardado('Cambios sin guardar en archivo…'); }

  /* ===================== GUARDADO EN ARCHIVO =====================
     Con Chrome/Edge se guarda directo en la ruta que elija el usuario y se
     recuerda el archivo, así «Guardar» vuelve a escribir sobre el mismo.
     En los navegadores que no tienen esa API, se descarga como siempre. */
  let manejo = null;        // FileSystemFileHandle del .boq en uso
  let sinArchivo = false;   // hay cambios que todavía no fueron a un archivo

  const hayContenido = () => M.proyecto().modulos.some(m => m.items.length) ||
    Object.keys(M.proyecto().insumos).length > 0;

  const nombreArchivo = () => ((M.proyecto().nombre || 'proyecto').trim()
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'proyecto') + '.boq';

  /**
   * Escribe el proyecto en un archivo .boq.
   * @param {boolean} pedirRuta fuerza el diálogo «Guardar como»
   * @returns {Promise<boolean>} false si el usuario canceló
   */
  async function guardarArchivo(pedirRuta) {
    M.guardarLocal();
    const texto = M.serializar();
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        if (pedirRuta || !manejo) {
          manejo = await window.showSaveFilePicker({
            suggestedName: nombreArchivo(),
            types: [{ description: 'Proyecto OpenBOQ', accept: { 'application/json': ['.boq'] } }]
          });
        }
        const w = await manejo.createWritable();
        await w.write(texto); await w.close();
        sinGuardar = false; sinArchivo = false;
        marcarGuardado('Guardado en ' + manejo.name + ' · ' + hora());
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;   // el usuario canceló
        manejo = null;                                     // sin permiso: se descarga
      }
    }
    REP.descargar(nombreArchivo(), texto, 'application/json;charset=utf-8');
    sinGuardar = false; sinArchivo = false;
    marcarGuardado('Guardado ' + hora());
    return true;
  }

  /** Carga un proyecto ya leído y avisa qué entró. */
  function abrirTexto(txt, archivo, h) {
    try { M.deserializar(txt); }
    catch (err) { alert('No se pudo abrir el archivo: ' + err.message); return false; }
    manejo = h || null; sinGuardar = false; sinArchivo = false;
    M.guardarLocal(); render(); irVista('presupuesto');
    marcarGuardado('Proyecto abierto ' + hora());
    avisoApertura(archivo);
    return true;
  }

  /* El nombre del archivo no forma parte del proyecto: se puede renombrar o
     mover el .boq y abre igual. Se avisa cuando difiere del nombre interno. */
  function avisoApertura(archivo) {
    const P = M.proyecto();
    const base = (archivo || '').replace(/\.[^.]+$/, '');
    const n = P.modulos.reduce((s, m) => s + m.items.length, 0);
    const distinto = base && M.norm(base) !== M.norm(P.nombre);
    modal('Proyecto abierto', `
      <p><b>${esc(P.nombre)}</b> — ${n} ítem(s), ${Object.keys(P.insumos).length} insumo(s),
      total ${M.fmt(M.conv(M.totalGeneral()))} ${P.moneda}.</p>
      ${distinto ? `<p class="mini">El archivo se llama <code>${esc(archivo)}</code> y el proyecto que
        tiene adentro, <b>${esc(P.nombre)}</b>. El nombre del archivo no afecta en nada: puede
        renombrarlo o cambiarlo de carpeta y abre igual.</p>
        <label style="display:block;margin-top:6px"><input type="checkbox" id="abNom">
        Usar <b>${esc(base)}</b> como nombre del proyecto</label>` : ''}`,
      [['Aceptar', () => {
        const c = $('#abNom');
        if (c && c.checked) { M.proyecto().nombre = base; aplicar(); render(); }
      }]]);
  }

  /* ===================== CAMBIOS EN PRUEBA =====================
     En TODAS las pestañas los cambios que se escriben a mano son un ensayo: se
     ven en el acto —precios, totales, duraciones, fechas— pero no se guardan.
     Se confirman con «✔ Guardar cambios» de la barra de estado, con cualquier
     botón de aplicar, o respondiendo al aviso que sale al cambiar de pestaña. */
  const ETIQUETA_ENSAYO = {
    presupuesto: 'PRESUPUESTO', analisis: 'ANÁLISIS (B-2)', insumos: 'INSUMOS (B-3)',
    incidencias: 'INCIDENCIAS', computos: 'CÓMPUTOS', base: 'BASE DE DATOS',
    recursos: 'RECURSOS', cronograma: 'CRONOGRAMA'
  };
  let ensayo = null;         // { clave, copia } — copia del proyecto antes de tocar nada

  /** Muestra u oculta los botones de confirmar/descartar de la barra de estado. */
  function estadoEnsayo() {
    const el = $('#accEnsayo'); if (!el) return;
    el.style.display = ensayo ? '' : 'none';
    const et = $('#lblEnsayo');
    if (et && ensayo) et.textContent = ETIQUETA_ENSAYO[ensayo.clave] || ensayo.clave;
  }

  /** Marca que se está probando: guarda el estado previo la primera vez. */
  function probando(clave) {
    if (!ensayo || ensayo.clave !== clave) ensayo = { clave, copia: M.serializar() };
    sinArchivo = true;
    marcarGuardado('Probando cambios en ' + (ETIQUETA_ENSAYO[clave] || clave) +
      ' — todavía sin guardar', true);
    estadoEnsayo();
  }
  /** Aplica al proyecto lo que se venía probando. */
  function guardarEnsayo() {
    if (!ensayo) return;
    ensayo = null;
    sinGuardar = false; sinArchivo = true;
    M.guardarLocal();
    marcarGuardado('Cambios guardados ' + hora());
    estadoEnsayo();
  }
  /** Los botones de aplicar (crear, generar, recalcular, ajustar…) confirman la prueba. */
  function aplicar() {
    ensayo = null;
    sinGuardar = false; sinArchivo = true;
    M.guardarLocal();
    marcarGuardado('Cambios aplicados ' + hora());
    estadoEnsayo();
  }
  /** Vuelve al estado anterior a la prueba. */
  function descartarEnsayo() {
    if (!ensayo) return;
    try { M.deserializar(ensayo.copia); } catch (e) { /* la copia siempre es válida */ }
    ensayo = null;
    render();
    marcarGuardado('Cambios descartados');
    estadoEnsayo();
  }
  /**
   * Pregunta qué hacer con lo que se estaba probando antes de irse.
   * @param {Function} seguir lo que se hace después de decidir
   */
  function salirDeEnsayo(seguir) {
    if (!ensayo) return seguir();
    const et = ETIQUETA_ENSAYO[ensayo.clave] || ensayo.clave;
    modal('Cambios sin guardar en ' + et, `
      <p>Estuvo probando cambios en <b>${et}</b>. Se ven en pantalla, pero todavía
      <b>no se aplicaron al proyecto</b>.</p>
      <p>¿Los guarda?</p>`,
      [['Seguir editando', null, 'sec'],
      ['Descartar', () => { descartarEnsayo(); seguir(); }, 'rojo'],
      ['Guardar cambios', () => { guardarEnsayo(); seguir(); }]]);
  }

  /** Avisa antes de reemplazar el proyecto abierto por otro. */
  function confirmarDescartar(titulo, seguir) {
    if (ensayo) return salirDeEnsayo(() => confirmarDescartar(titulo, seguir));
    if (!hayContenido() || !sinArchivo) return seguir();
    const P = M.proyecto();

    /* POR QUE `seguir` VA DIFERIDO, y no llamado derecho.
       `modal()` cierra el overlay apenas vuelve el manejador del boton, y
       `seguir` casi siempre abre OTRO dialogo: el nuevo se pintaba y se
       ocultaba en el mismo instante. Sintoma: ARCHIVO -> Nuevo proyecto no
       hacia absolutamente nada si habia un proyecto con cambios sin guardar
       —o sea, casi siempre—. Mismo truco que usa finVolcado(). */
    const luego = () => setTimeout(seguir, 60);

    const botones = [['Cancelar', null, 'sec'],
      ['Guardar en el equipo…', () => { guardarArchivo(false).then(ok => { if (ok) luego(); }); }]];

    /* El respaldo en Drive va acá y no solo en un menú: este es el momento en
       que el usuario está por perder algo, y es cuando de verdad importa
       ofrecérselo. DRIVE.escribir se llama DENTRO del clic, sin ningún await
       delante, o el navegador bloquea la ventana de permiso. */
    if (hayDrive() && hayNube() && NUBE.conectado()) {
      botones.push(['Respaldar en mi Drive', () => {
        respaldarProyectoEnDrive().then(ok => { if (ok) luego(); });
      }]);
    }

    botones.push(['Continuar sin guardar', luego, 'rojo']);

    modal(titulo, `<p>El proyecto <b>${esc(P.nombre)}</b> tiene cambios que todavía no guardó en un
      archivo <code>.boq</code>.</p>
      <p>Si continúa, se reemplaza por el otro proyecto y <b>se pierde todo lo que no haya
      guardado</b>.</p>`, botones);
  }

  function llenarBases() {
    const hay = M.BD.bases.length > 0;
    const ops = hay
      ? M.BD.bases.map(b => `<option value="${b.id}">${esc(b.n)} (${b.apus.length} ítems)</option>`).join('')
      : '<option value="">— sin Base de Datos cargada —</option>';
    $('#selBase').innerHTML = ops;
    $('#selBaseFiltro').innerHTML = ops;
    const s = M.BD.stats;
    $('#pillStats').textContent = hay
      ? `${s.bases || M.BD.bases.length} bases · ${(s.apus || 0).toLocaleString('es-BO')} ítems · ${(s.insumos || 0).toLocaleString('es-BO')} insumos`
      : 'Sin Base de Datos de precios';
    if (!hay)
      $('#detApu').innerHTML = `<div class="vacio" style="max-width:620px;margin:0 auto;text-align:left">
        <p style="text-align:center"><b>Todavía no hay ninguna base de datos cargada.</b></p>
        <p>OpenBOQ funciona igual sin ella: puede cargar los ítems a mano en <b>PRESUPUESTO</b> o
        importar un proyecto con <b>ARCHIVO → Importar proyecto (.ddp)</b>.</p>
        <p>También puede armar la suya y usarla como cualquier otra:</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
          <button class="btn" data-acc="nuevaBasePropia">➕ Crear mi propia base de datos</button>
        </div></div>`;
  }

  /* ===================== RENDER GENERAL ===================== */
  function render() {
    const P = M.proyecto();
    $('#lblProyecto').textContent = P.nombre;
    $('#selPrecision').value = P.precision;
    $('#selMoneda').value = P.moneda;
    $('#inpTC').value = P.tc;
    $('#inpPlazo').value = P.plazo;
    $('#inpInicioObra').value = P.inicioObra || '';
    renderModulos();
    renderPresupuesto();
    renderInsumos();
    renderIncidencias();
    renderRecursos();
    renderSelectItems();
    renderAnalisis();
    renderComputos();
    renderCrono();
    barraEstado();
    pintarCuenta();
  }

  function barraEstado() {
    const P = M.proyecto();
    const n = P.modulos.reduce((s, m) => s + m.items.length, 0);
    $('#stItems').textContent = n;
    $('#stInsumos').textContent = Object.keys(P.insumos).length;
    $('#stModulo').textContent = M.modulo().n;
    $('#stTotal').textContent = M.fmt(M.conv(M.totalGeneral()));
    $('#stMoneda').textContent = P.moneda;
    $('#lblCuenta').textContent = `${n} ítem(s) · ${M.fmt(M.conv(M.totalGeneral()))} ${P.moneda}`;
    estadoEnsayo();
  }

  /* ===================== MÓDULOS ===================== */
  function renderModulos() {
    const P = M.proyecto();
    $('#selModulo').innerHTML = P.modulos.map((m, k) =>
      `<option value="${k}" ${k === P.moduloActivo ? 'selected' : ''}>${esc(m.n)}</option>`).join('');
    /* Todas las cajas miden lo mismo: el nombre se recorta con puntos
       suspensivos y va entero en el title. Con el ancho libre, «M-05
       PAISAJISMO» y «M-04 ARQUITECTURA EXTERIOR» daban cajas de alto y ancho
       distintos y la fila quedaba desprolija. */
    /* Las cajas van en su propio carril que se desplaza: con diez módulos de
       ancho fijo ya no entran en la pantalla, y el total del módulo tiene que
       quedar a la vista y no al final de la fila. */
    $('#barraModulos').innerHTML = '<div class="mtabs">' + P.modulos.map((m, k) =>
      `<div class="mtab ${k === P.moduloActivo ? 'on' : ''}" data-mod="${k}" title="${esc(m.n)}">
        <span class="mn">${esc(m.n)}</span><span class="mini">(${m.items.length})</span></div>`)
      .join('') + '<div class="mtab nueva" data-mod="nuevo" title="Agregar un módulo">＋</div></div>' +
      `<span class="mini tot-mod">Total módulo: <b>${M.fmt(M.conv(M.subtotalGeneral(M.modulo())))} ${P.moneda}</b></span>`;
  }

  /* ===================== VISTA PRESUPUESTO ===================== */
  function renderPresupuesto() {
    const P = M.proyecto();
    const filtro = M.norm($('#buscaPres').value || '');
    const L = M.items();
    let h = `<thead><tr>
      <th style="width:40px">N°</th><th>DESCRIPCIÓN DE LA ACTIVIDAD</th>
      <th style="width:70px">UND.</th><th style="width:95px">CANTIDAD</th>
      <th style="width:105px">UNITARIO</th><th style="width:115px">PARCIAL</th>
      <th style="width:95px">MATERIAL</th><th style="width:95px">OBRERO</th>
      <th style="width:95px">EQUIPO</th><th style="width:60px">%</th><th style="width:34px"></th>
    </tr></thead><tbody>`;
    const tot = M.totalProyecto() || 1;
    /* El N° no reinicia en cada módulo: sigue la cuenta del presupuesto, igual
       que en el B-1 impreso y en el Excel. Así el número que se ve en pantalla
       es el mismo con el que el ítem sale en el documento que se presenta. */
    const desde = M.itemsAntesDelModulo();
    /* los totales que se MUESTRAN usan M.totalGeneral / subtotalGeneral: en un
       proyecto importado de PRESCOM coinciden con su B-1; el cálculo interno
       (porcentajes, recálculo) sigue con totalProyecto */
    let sm = 0, so = 0, se = 0;
    if (!L.length && modoSimple()) {
      h += `<tr><td colspan="11" class="vacio guia-simple">
        <b>¿Por dónde empiezo?</b>
        <ol>
          <li><b>Busque un ítem con precio</b> — por ejemplo «muro de ladrillo» o «excavación».
            Hay ${(M.BD.stats.apus || 0).toLocaleString('es-BO')} análisis listos.</li>
          <li><b>Póngale la cantidad</b> en esta tabla: el precio y el total se calculan solos.</li>
          <li><b>Imprima el presupuesto</b> (Formulario B-1) desde el paso ④.</li>
        </ol>
        <button class="btn" data-acc="irBase">🔎 Buscar ítems</button></td></tr>`;
    } else if (!L.length) {
      h += `<tr><td colspan="11" class="vacio">Módulo vacío. Use <b>➕ Nuevo ítem</b> o traiga ítems desde la
            pestaña <b>BASE DE DATOS</b> (${(M.BD.stats.apus || 0).toLocaleString('es-BO')} análisis disponibles).</td></tr>`;
    }
    L.forEach((it, k) => {
      const a = M.analisis(it);
      sm += a.mat * it.cant; so += a.totalMO * it.cant; se += a.totalEQ * it.cant;
      if (filtro && M.norm(it.desc).indexOf(filtro) < 0) return;
      h += `<tr data-item="${it.id}" class="${P.itemSel === it.id ? 'sel' : ''}">
        <td class="ctr">${desde + k + 1}</td>
        <td><input class="txt" data-campo="desc" value="${esc(it.desc)}"></td>
        <td><input class="txt" data-campo="und" list="lUnidades" value="${esc(it.und)}" style="text-align:center"></td>
        <td><input type="number" step="any" data-campo="cant" value="${it.cant}"></td>
        <td class="num">${M.fmt(M.conv(a.pu))}</td>
        <td class="num"><b>${M.fmt(M.conv(M.parcialGeneral(it)))}</b></td>
        <td class="num">${M.fmt(M.conv(a.mat * it.cant))}</td>
        <td class="num">${M.fmt(M.conv(a.totalMO * it.cant))}</td>
        <td class="num">${M.fmt(M.conv(a.totalEQ * it.cant))}</td>
        <td class="num">${(a.total / tot * 100).toFixed(1)}</td>
        <td class="ctr"><button class="b-del" data-del="${it.id}" title="Eliminar">✕</button></td></tr>`;
    });
    h += `</tbody><tfoot><tr>
      <td colspan="5" class="num">TOTAL ${esc(M.modulo().n)} (${P.moneda})</td>
      <td class="num">${M.fmt(M.conv(M.subtotalGeneral(M.modulo())))}</td>
      <td class="num">${M.fmt(M.conv(sm))}</td>
      <td class="num">${M.fmt(M.conv(so))}</td>
      <td class="num">${M.fmt(M.conv(se))}</td><td colspan="2"></td></tr></tfoot>`;
    $('#tblPresupuesto').innerHTML = h;
  }

  /* ===================== VISTA BASE DE DATOS ===================== */
  let resBase = [];
  function buscarBase() {
    const txt = $('#buscaBase').value.trim();
    const todas = $('#chkTodasBases').checked;
    baseSelId = Number($('#selBaseFiltro').value) || 1;
    resBase = M.buscarEnBase(baseSelId, txt, todas, 500);
    $('#listaBase').innerHTML = resBase.map((x, k) => {
      const c = M.costoBase(x.base, x.apu);
      return `<li data-k="${k}"><span class="cod">${esc(x.apu.cod || x.apu.seq)}</span>${esc(x.apu.d)}
        <span class="pu">${M.fmt(c, 2)}</span>
        <div class="mini">${esc(x.apu.u)} · ${esc(x.base.n)} · ${x.apu.c.length} insumo(s)</div></li>`;
    }).join('');
    $('#lblBaseCuenta').textContent = resBase.length + (resBase.length >= 500 ? '+ resultados (refine la búsqueda)' : ' resultado(s)');
  }

  function mostrarApuBase(k) {
    const x = resBase[k]; if (!x) return;
    apuSel = x;
    $$('#listaBase li').forEach(li => li.classList.toggle('sel', li.dataset.k == k));
    $('#lblApuSel').textContent = x.apu.d + ' (' + x.apu.u + ')';
    const nom = { M: '1. MATERIALES', O: '2. MANO DE OBRA', E: '3. EQUIPO, MAQUINARIA Y HERRAMIENTAS' };
    const g = { M: [], O: [], E: [] };
    x.apu.c.forEach(c => {
      const i = x.base.imap[c[0]]; if (!i) return;
      (g[i.t] || g.M).push({ i, q: c[1] });
    });
    /* mismo orden que en el resto de la aplicación: A-Z dentro de cada grupo */
    ['M', 'O', 'E'].forEach(t => g[t].sort((p, q) => M.cmpTexto(p.i.d, q.i.d) || M.cmpTexto(p.i.u, q.i.u)));
    let h = `<table class="rej"><thead><tr><th style="width:34px">N°</th><th>DESCRIPCIÓN</th>
      <th style="width:60px">UND.</th><th style="width:90px">CANTIDAD</th>
      <th style="width:95px">P. UNIT.</th><th style="width:105px">PARCIAL</th></tr></thead><tbody>`;
    let gran = 0;
    ['M', 'O', 'E'].forEach(t => {
      h += `<tr class="grupo"><td colspan="6">${nom[t]}</td></tr>`;
      if (!g[t].length) h += '<tr><td colspan="6" class="mini" style="padding-left:14px">(sin insumos)</td></tr>';
      let s = 0;
      g[t].forEach((r, n) => {
        const p = M.r2(r.q * r.i.p); s += p;
        h += `<tr><td class="ctr">${n + 1}</td><td>${esc(r.i.d)}</td><td class="ctr">${esc(r.i.u)}</td>
          <td class="num">${M.fmt(r.q, 4)}</td><td class="num">${M.fmt(r.i.p, 2)}</td>
          <td class="num">${M.fmt(p, 2)}</td></tr>`;
      });
      gran += s;
      h += `<tr><td colspan="5" class="num"><b>Subtotal</b></td><td class="num"><b>${M.fmt(s, 2)}</b></td></tr>`;
    });
    h += `</tbody><tfoot><tr><td colspan="5" class="num">COSTO DIRECTO (sin recargos) — Bs</td>
      <td class="num">${M.fmt(gran, 2)}</td></tr></tfoot></table>
      <div class="panel mini">Al traerlo al presupuesto se le aplican los recargos configurados
      (cargas sociales, IVA, herramientas, gastos generales, utilidad e IT). Cantidades y precios se
      pueden ajustar en ese momento.</div>`;
    $('#detApu').innerHTML = h;
  }

  /* ===================== VISTA ANÁLISIS (B-2) ===================== */
  function renderSelectItems() {
    const P = M.proyecto();
    /* mismo número corrido que la rejilla y el B-1: el desplegable lista los
       ítems de todos los módulos, y reiniciar la cuenta en cada uno mostraba
       varios «N° 1» en la misma lista */
    let nOp = 0;
    const ops = P.modulos.flatMap(m => m.items.map(it =>
      `<option value="${it.id}">${esc(m.n)} · ${++nOp}. ${esc(it.desc)}</option>`)).join('');
    ['#selItemAnalisis', '#selItemComputo'].forEach(s => {
      const el = $(s); const ant = el.value;
      el.innerHTML = ops || '<option value="">— sin ítems —</option>';
      if (P.itemSel && M.getItem(P.itemSel)) el.value = P.itemSel;
      else if (ant) el.value = ant;
    });
  }

  function renderAnalisis() {
    const id = $('#selItemAnalisis').value;
    const it = M.getItem(id);
    const cont = $('#cuerpoB2');
    if (!it) { cont.innerHTML = '<div class="vacio">No hay ítems para analizar. Cree uno o tráigalo de la Base de Datos.</div>'; return; }
    const P = M.proyecto(), a = M.analisis(it);
    const nom = { M: '1. MATERIALES', O: '2. MANO DE OBRA', E: '3. EQUIPO, MAQUINARIA Y HERRAMIENTAS' };
    const oficial = M.formatoEsOficial();
    let h = `<div class="encab"><h2>${esc(it.desc)}</h2><div class="rej-datos">
      <div><label>Unidad</label><input data-b2="und" list="lUnidades" value="${esc(it.und)}" style="width:100%"></div>
      <div><label>Cantidad</label><input data-b2="cant" type="number" step="any" value="${it.cant}" style="width:100%"></div>
      <div><label>Código</label><input data-b2="cod" value="${esc(it.cod || '')}" style="width:100%"></div>
      <div><label>Moneda</label><input value="${esc(P.moneda)}" disabled style="width:100%"></div>
      </div></div>`;

    ['M', 'O', 'E'].forEach(t => {
      h += `<h3 style="display:flex;align-items:center;gap:10px">${nom[t]}
        <button class="btn sec" style="margin-left:auto;font-weight:400"
          data-acc="addInsumo" data-acc-arg="${t}">➕ Agregar</button></h3>
        <table class="rej"><thead><tr>
        <th style="width:34px">N°</th><th>DESCRIPCIÓN</th><th style="width:64px">UND.</th>
        <th style="width:100px">CANTIDAD</th><th style="width:100px">P. UNITARIO</th>
        <th style="width:110px">COSTO TOTAL</th><th style="width:34px"></th></tr></thead><tbody>`;
      if (!a.grupos[t].length) h += `<tr><td colspan="7" class="mini" style="padding:6px 12px">
        (sin insumos — use <b>➕ Agregar</b>, arriba a la derecha de esta sección)</td></tr>`;
      a.grupos[t].forEach((x, k) => {
        h += `<tr><td class="ctr">${k + 1}</td>
          <td>${esc(x.ins.d)}</td><td class="ctr">${esc(x.ins.u)}</td>
          <td><input type="number" step="any" data-rend="${x.ins.id}" value="${x.rend}"></td>
          <td><input type="number" step="any" data-precio="${x.ins.id}" value="${x.ins.p}"></td>
          <td class="num">${M.fmt(M.conv(x.parcial))}</td>
          <td class="ctr"><button class="b-del" data-quita="${x.ins.id}">✕</button></td></tr>`;
      });
      const sub = t === 'M' ? a.mat : t === 'O' ? a.mo : a.eq;
      h += `</tbody><tfoot><tr><td colspan="5" class="num">SUBTOTAL</td>
        <td class="num">${M.fmt(M.conv(sub))}</td><td></td></tr></tfoot></table>`;
      /* Los recargos intercalados entre los grupos —cargas e IVA después de la
         mano de obra, herramientas después del equipo— son la forma del B-2
         oficial. Con un formato propio no hay manera de adivinar dónde va cada
         fila, así que los grupos salen limpios y la cadena entera se imprime
         abajo, en orden. */
      if (oficial && t === 'O') {
        h += filaRes('Cargas sociales', 'cargas', a.cargas) +
          filaRes('IVA mano de obra', 'ivaMO', a.ivaMO) +
          `<div class="res"><div class="fila sub"><span>TOTAL MANO DE OBRA</span><span class="val">${M.fmt(M.conv(a.totalMO))}</span></div></div>`;
      }
      if (oficial && t === 'E') {
        h += filaRes('Herramientas menores (% sobre mano de obra)', 'herr', a.herr) +
          `<div class="res"><div class="fila sub"><span>TOTAL EQUIPO, MAQUINARIA Y HERRAMIENTAS</span><span class="val">${M.fmt(M.conv(a.totalEQ))}</span></div></div>`;
      }
    });

    const cierreOficial = `
      <div class="fila sub"><span>SUBTOTAL (1 + 2 + 3)</span><span class="val">${M.fmt(M.conv(a.subtotal))}</span></div>
      <div class="fila"><span>4. Gastos generales y administrativos <b>${M.fmt(P.params.gg, 2)} %</b></span><span class="val">${M.fmt(M.conv(a.gg))}</span></div>
      <div class="fila sub"><span>PARCIAL</span><span class="val">${M.fmt(M.conv(a.parcial2))}</span></div>
      <div class="fila"><span>5. Utilidad <b>${M.fmt(P.params.util, 2)} %</b></span><span class="val">${M.fmt(M.conv(a.util))}</span></div>
      <div class="fila sub"><span>PARCIAL</span><span class="val">${M.fmt(M.conv(a.parcial3))}</span></div>
      <div class="fila"><span>6. Impuestos IT <b>${M.fmt(P.params.it, 2)} %</b></span><span class="val">${M.fmt(M.conv(a.it))}</span></div>`;

    /* Con formato propio se imprime la cadena tal como está escrita, sin la
       última fila: esa es el precio unitario y ya tiene su propio renglón. */
    const cierrePropio = (a.cadena || []).filter(f => f.k !== 'ent')
      .slice(0, -1)
      .map(f => `<div class="fila${f.k === 'sum' ? ' sub' : ''}">
        <span>${f.i}. ${esc(f.n)}${f.k === 'pct' ? ` <b>${M.fmt(f.pct, 2)} %</b>` : ''}</span>
        <span class="val">${M.fmt(M.conv(M.r2(f.valor)))}</span></div>`).join('');

    h += `<div class="res" style="margin-top:18px">
      ${oficial ? cierreOficial : cierrePropio}
      ${a.ajuste ? `<div class="fila" title="El archivo de PRESCOM guarda los subtotales con 3 decimales y el precio unitario con 2: los dígitos que descarta deciden el centavo y no se pueden recuperar. Se conserva el precio del archivo para que el presupuesto cierre igual que el original; al editar este análisis vuelve el calculado (${M.fmt(M.conv(a.puCalculado))}).">
        <span>Redondeo del archivo de origen</span><span class="val">${M.fmt(M.conv(a.ajuste))}</span></div>` : ''}
      <div class="fila tot"><span>TOTAL PRECIO UNITARIO (${P.moneda})</span><span class="val">${M.fmt(M.conv(a.pu))}</span></div>
      <div class="fila sub"><span>PRECIO TOTAL DEL ÍTEM (${M.fmt(it.cant, 2)} ${esc(it.und)})</span><span class="val">${M.fmt(M.conv(M.parcialGeneral(it)))}</span></div>
    </div>
    <p class="mini" style="margin-top:8px">La cadena de recargos es del <b>proyecto</b>
    —formato <b>${esc(M.formato().n)}</b>—: vale para todos los ítems y se cambia en la pestaña
    <b style="color:var(--azul-txt);cursor:pointer;text-decoration:underline" data-acc="paramsGlobal">INCIDENCIAS</b>,
    no ítem por ítem.</p>`;
    cont.innerHTML = h;
  }
  const filaRes = (t, p, v) => `<div class="res"><div class="fila"><span>${t}
      <b>${M.fmt(M.proyecto().params[p], 2)} %</b></span>
      <span class="val">${M.fmt(M.conv(v))}</span></div></div>`;

  /* ===================== VISTA INSUMOS (B-3) ===================== */
  /* Insumos con el detalle de usos abierto (doble clic en la descripción).
     Se guardan acá y no en el proyecto: es estado de la vista, no del presupuesto.
     Pueden quedar varios abiertos a la vez para comparar. */
  const usosAbiertos = new Set();

  /**
   * La fecha del precio, como se muestra en el B-3.
   * En blanco cuando el precio llegó de un archivo, del catálogo o de una
   * versión anterior a la v2.6: ahí no se sabe de cuándo es y se dice así,
   * en vez de poner una fecha que no significa nada.
   * @param {string} f 'AAAA-MM-DD' o vacío
   */
  function fechaPrecio(f) {
    if (!f) return '<span class="mini sin-fecha" title="Precio sin fecha: vino de un archivo, del catálogo o de antes de que se guardara la fecha">—</span>';
    const [a, m, d] = String(f).slice(0, 10).split('-');
    return d && m && a ? `<span title="Precio fijado el ${esc(f.slice(0, 10))}">${d}/${m}/${a}</span>` : esc(f);
  }

  function renderInsumos() {
    const P = M.proyecto();
    const q = M.norm($('#buscaInsumo').value || '');
    const ft = $('#filtroTipoInsumo').value;
    const req = {}; M.requerimiento().forEach(x => req[x.ins.id] = x);
    /* Los usos salen de una sola pasada. Preguntarlos insumo por insumo
       recorría el presupuesto entero cada vez: con los 1.194 insumos y 250
       ítems de un PRESCOM importado, la pestaña tardaba en dibujarse. */
    const usos = M.usosPorInsumo();
    /* Un insumo que no entra en ningún análisis no aporta cantidad ni monto:
       en el B-3 solo agrega renglones vacíos y ensucia cualquier comparación
       entre dos presupuestos. Se ocultan salvo que se pidan. La casilla hace
       falta igual: un insumo recién creado todavía no se usa y, sin ella,
       desaparecería apenas se lo crea. */
    const verSinUso = !!($('#verSinUso') && $('#verSinUso').checked);
    const todos = M.insumosOrdenados();
    const sinUso = todos.filter(x => !usos[x.id]).length;
    const L = todos.filter(x =>
      (verSinUso || usos[x.id] > 0) &&
      (!ft || x.t === ft) && (!q || M.norm(x.d).indexOf(q) >= 0));
    const nom = { M: 'Material', O: 'Mano de obra', E: 'Equipo' };
    usosAbiertos.forEach(id => { if (!P.insumos[id]) usosAbiertos.delete(id); });
    let h = `<thead><tr><th style="width:40px">N°</th><th style="width:100px">TIPO</th>
      <th>DESCRIPCIÓN DEL INSUMO</th><th style="width:70px">UND.</th>
      <th style="width:110px">PRECIO (${P.moneda})</th>
      <th style="width:104px" title="Día en que se fijó este precio dentro de OpenBOQ. En blanco: el precio vino de un archivo o del catálogo y no se sabe de cuándo es.">FECHA PRECIO</th>
      <th style="width:110px">CANT. OBRA</th>
      <th style="width:120px">MONTO OBRA</th><th style="width:70px">USOS</th></tr></thead><tbody>`;
    if (!L.length) h += '<tr><td colspan="9" class="vacio">' + (sinUso && !verSinUso
      ? 'Ningún insumo entra en un análisis. Marque «Ver los que no se usan» para ver los ' + sinUso + ' que están cargados.'
      : 'Sin insumos. Se cargan solos al traer ítems de la Base de Datos o al importar un proyecto.') + '</td></tr>';
    L.forEach((x, k) => {
      const r = req[x.id];
      const ab = usosAbiertos.has(x.id);
      h += `<tr${ab ? ' class="sel"' : ''}><td class="ctr">${k + 1}</td>
        <td class="ctr"><span class="badge ${x.t}">${nom[x.t]}</span></td>
        <td class="ins-d" data-ins-d="${x.id}"
          title="Doble clic: en qué ítems se usa este insumo">${esc(x.d)}</td>
        <td class="ctr">${esc(x.u)}</td>
        <td><input type="number" step="any" data-ins-p="${x.id}" value="${x.p}"></td>
        <td class="ctr fecha-precio">${fechaPrecio(x.f)}</td>
        <td class="num">${r ? M.fmt(r.cant, 3) : '—'}</td>
        <td class="num">${r ? M.fmt(M.conv(r.monto)) : '—'}</td>
        <td class="num${usos[x.id] ? '' : ' sin-uso'}">${usos[x.id] || 0}</td></tr>`;
      if (ab) h += filaUsos(x);
    });
    h += '</tbody>';
    $('#tblInsumos').innerHTML = h;
    $('#lblInsCuenta').textContent = L.length + ' de ' + todos.length + ' insumos' +
      (sinUso ? (verSinUso ? ' · ' + sinUso + ' sin uso' : ' · ' + sinUso + ' sin uso, ocultos') : '');
    const lbl = $('#lblSinUso');
    if (lbl) lbl.style.display = sinUso ? '' : 'none';
  }

  /**
   * Fila desplegable con el detalle de un insumo: en qué ítems entra, con qué
   * rendimiento, cuánto aporta cada uno a la cantidad de obra y con qué monto.
   * @param {Object} ins insumo del proyecto
   * @returns {string} el `<tr>` completo, para insertarlo debajo de la fila del insumo
   */
  function filaUsos(ins) {
    const P = M.proyecto();
    const L = M.detalleInsumo(ins.id);
    const cab = `<div class="uso-cab"><b>${esc(ins.d)}</b>
      <span class="mini">${esc(ins.u)} · ${M.fmt(M.conv(ins.p))} ${P.moneda}</span>
      <button class="btn sec" data-acc="renombrarInsumo" data-acc-arg="${ins.id}">Renombrar…</button>
      <button class="btn sec" data-cerraruso="${ins.id}">Cerrar</button></div>`;
    if (!L.length) {
      return `<tr class="uso"><td colspan="9">${cab}
        <p class="mini">No participa en ningún análisis: no aporta cantidad ni monto a la obra.</p></td></tr>`;
    }
    let tot = 0, totM = 0;
    const filas = L.map(u => {
      tot += u.cant; totM += u.monto;
      return `<tr><td class="mini">${esc(u.modulo.n || '')}</td>
        <td>${esc(u.item.cod || '')} ${esc(u.item.desc)}</td>
        <td class="ctr">${esc(u.item.und)}</td>
        <td class="num">${M.fmt(Number(u.item.cant) || 0, 2)}</td>
        <td class="num">${M.fmt(u.rend, 4)}</td>
        <td class="num">${M.fmt(u.cant, 3)}</td>
        <td class="num">${M.fmt(M.conv(u.monto))}</td></tr>`;
    }).join('');
    return `<tr class="uso"><td colspan="9">${cab}
      <div class="uso-scroll"><table class="rej uso-det"><thead><tr>
        <th style="width:120px">MÓDULO</th><th>ÍTEM</th><th style="width:56px">UND.</th>
        <th style="width:90px">CANT. ÍTEM</th><th style="width:90px">REND.</th>
        <th style="width:100px">CANT. INSUMO</th>
        <th style="width:110px">MONTO (${P.moneda})</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><td colspan="5">TOTAL EN ${L.length} ÍTEM(S)</td>
        <td class="num">${M.fmt(M.r(tot, 4), 3)}</td>
        <td class="num">${M.fmt(M.conv(M.r2(totM)))}</td></tr></tfoot></table></div></td></tr>`;
  }

  /* ===================== VISTA INCIDENCIAS =====================
     Antes esta pestaña eran seis casillas de porcentaje. Desde la v2.6 es el
     editor de la CADENA DE CÁLCULO: qué filas tiene el B-2, en qué orden y
     sobre qué se calcula cada una. El motor la corre tal como esté escrita
     (ver «FORMATOS DE INCIDENCIAS» en motor.js).

     Dos modos, y la diferencia importa:

     · FORMATO OFICIAL (SABS). Se editan los porcentajes, como siempre. La
       estructura está bloqueada porque es la del DS 0181 y es la única que el
       exportador sabe escribir de vuelta en un .ddp de PRESCOM.

     · FORMATO PROPIO. Sale de duplicar el oficial, arranca idéntico —ningún
       ítem cambia de precio al duplicar— y ahí sí se agregan, se quitan, se
       renombran y se reordenan filas.                                        */

  /**
   * Lee el campo «sobre qué»: «2, 4» → [2, 4]. Tolera espacios, punto y coma
   * y el signo +, que es como mucha gente escribe una suma de filas.
   */
  function leerSobre(txt) {
    return String(txt || '').split(/[^0-9]+/)
      .map(x => parseInt(x, 10)).filter(n => n > 0);
  }

  /**
   * Mueve o quita filas sin romper las referencias.
   *
   * «Sobre qué» se escribe con números de fila porque es como se lee en
   * pantalla, pero esos números dejan de valer apenas la cadena se reordena:
   * la fila 7 pasa a ser la 6 y todo lo que la nombraba apunta a otra cosa.
   * Acá se traducen a los identificadores de cada fila, se hace el cambio y
   * se vuelven a escribir como números. Lo que apuntaba a una fila borrada
   * desaparece, y si algo queda apuntando hacia adelante lo dice
   * `M.validarFormato` en la misma pantalla.
   * @param {Array} F filas del formato (se modifica en el lugar)
   * @param {Function} cambio qué hacer con el arreglo
   */
  function conReferenciasEstables(F, cambio) {
    const ids = F.map(f => (f.sobre || []).map(n => (F[Number(n) - 1] || {}).id).filter(Boolean));
    F.forEach((f, i) => { f._ref = ids[i]; });
    cambio();
    F.forEach(f => {
      if (!f._ref) return;
      f.sobre = f._ref.map(id => F.findIndex(x => x.id === id) + 1).filter(n => n > 0);
      delete f._ref;
    });
  }


  /** Nombre legible de la base de una fila: «(2 + 4)» o «todo lo anterior». */
  function baseEnPalabras(f, filas) {
    if (f.k === 'ent') return 'entrada del análisis';
    const ns = (f.sobre || []).map(n => 'N° ' + n);
    if (!ns.length) return '—';
    const nom = (f.sobre || []).map(n => {
      const x = filas[Number(n) - 1];
      return x ? x.n : '?';
    }).join(' + ');
    return ns.join(' + ') + '  ·  ' + nom;
  }

  function renderIncidencias() {
    const P = M.proyecto();
    const fmt = M.formato();
    const oficial = M.formatoEsOficial();
    const n = P.modulos.reduce((s, m) => s + m.items.length, 0);
    const filas = fmt.filas || [];
    const ult = filas.length - 1;

    /* ---------- panel izquierdo: el listado ----------
       El oficial está siempre y no se puede borrar; los propios se renombran,
       se duplican y se sacan. Un clic cambia el formato del proyecto y
       recalcula los precios unitarios en el acto. */
    const L = M.formatos();
    const listado = L.map(f => {
      const act = f.id === fmt.id;
      const esOf = f.id === M.ID_SABS;
      return `<li class="fmt-li${act ? ' on' : ''}" data-usarfmt="${esc(f.id)}"
          title="${act ? 'Es el formato que est\u00e1 aplicado' : 'Aplicar este formato al presupuesto'}">
        <span class="fmt-li-n">${esc(f.n)}</span>
        <span class="fmt-li-d">${esOf ? 'Oficial · no se edita la estructura'
          : (f.filas || []).length + ' filas · formato propio'}</span>
        ${act ? '<span class="fmt-li-chk" title="Aplicado">●</span>' : ''}
        ${esOf ? '' : `<span class="fmt-li-acc">
            <button class="b-mini" data-renfmt="${esc(f.id)}" title="Cambiar el nombre">✎</button>
            <button class="b-del" data-delfmt="${esc(f.id)}" title="Quitar del listado">✕</button>
          </span>`}
      </li>`;
    }).join('');

    let h = `<div class="fmt-caja">
      <aside class="fmt-lista">
        <h3>Listado de incidencias</h3>
        <p class="mini">Los formatos de este proyecto. El que está marcado es el que se aplica;
        los otros siguen disponibles y se vuelven a poner con un clic.</p>
        <ul class="fmt-ul">${listado}</ul>
        <button class="btn sec fmt-nuevo" data-acc="duplicarFormato">⧉ Duplicar el aplicado</button>
        <p class="mini">La copia arranca idéntica: duplicar no cambia ningún precio.</p>
      </aside>

      <section class="fmt-cadena">
        <div class="fmt-cab">
          <div>
            <h2 style="color:var(--rojo-txt);margin:0 0 2px">${esc(fmt.n)}</h2>
            <p class="mini" style="margin:0">${oficial
        ? 'Formato oficial de Bolivia — DS 0181. Los porcentajes se editan; la estructura, no. Para otra estructura, duplíquelo.'
        : 'Formato propio de este proyecto. Se edita entero: filas, nombres, bases y porcentajes.'}</p>
          </div>
        </div>
        <p class="mini">La cadena se aplica a <b>todos los ítems</b> del presupuesto: lo que se
        cambie acá recalcula los ${n} análisis y el total de la obra. La <b>última fila es el precio
        unitario</b>.</p>`;

    h += `<table class="rej fmt-tabla"><thead><tr>
        <th style="width:36px">N°</th>
        <th>FILA</th>
        <th style="width:96px">CÓMO</th>
        <th style="width:190px">SOBRE QUÉ</th>
        <th style="width:100px">PORCENTAJE</th>
        ${oficial ? '' : '<th style="width:92px"></th>'}
      </tr></thead><tbody>`;

    filas.forEach((f, i) => {
      const nro = i + 1;
      const esEnt = f.k === 'ent';
      const clase = esEnt ? ' class="fmt-ent"' : (i === ult ? ' class="fmt-pu"' : '');
      const nombre = (oficial || esEnt)
        ? esc(f.n)
        : `<input class="txt" data-fmt="${nro}" data-f="n" value="${esc(f.n)}">`;
      const como = esEnt ? '<span class="mini">entrada</span>'
        : (oficial ? (f.k === 'pct' ? 'porcentaje' : 'subtotal')
          : `<select data-fmt="${nro}" data-f="k">
               <option value="pct"${f.k === 'pct' ? ' selected' : ''}>porcentaje</option>
               <option value="sum"${f.k === 'sum' ? ' selected' : ''}>subtotal</option>
             </select>`);
      const sobre = esEnt ? '<span class="mini">materiales · mano de obra · equipo</span>'
        : (oficial
          ? `<span class="mini">${esc(f.ayuda || baseEnPalabras(f, filas))}</span>`
          : `<input class="txt mono" data-fmt="${nro}" data-f="sobre" value="${esc((f.sobre || []).join(', '))}"
               placeholder="2, 4" title="Números de fila, separados por coma. Solo filas anteriores a esta.">`);
      const pct = (f.k === 'pct')
        ? `<input type="number" step="0.01" inputmode="decimal" data-fmt="${nro}" data-f="pct" value="${f.pct}">`
        : '<span class="mini">—</span>';
      const acc = oficial ? '' : `<td class="ctr fmt-btn">${esEnt ? '' : `
        <button class="b-mini" data-fmtmov="${nro}" data-dir="-1" title="Subir">▲</button>
        <button class="b-mini" data-fmtmov="${nro}" data-dir="1" title="Bajar">▼</button>
        <button class="b-del" data-fmtdel="${nro}" title="Quitar esta fila">✕</button>`}</td>`;

      h += `<tr${clase}><td class="ctr">${nro}</td><td>${nombre}</td>
        <td class="ctr">${como}</td><td>${sobre}</td><td>${pct}</td>${acc}</tr>`;
    });
    h += '</tbody></table>';

    if (!oficial) {
      h += `<div class="fmt-pie">
        <button class="btn sec" data-acc="agregarFilaFormato">＋ Agregar fila</button>
        <span class="mini">La fila nueva entra antes del precio unitario. «Sobre qué» son números
        de fila anteriores, separados por coma.</span>
      </div>`;
      const v = M.validarFormato(fmt);
      if (!v.ok) h += `<div class="aviso-caja"><b>La cadena todavía no cierra:</b><ul>` +
        v.errores.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
    }

    h += `<div class="res">
        <div class="fila sub"><span>TOTAL DEL PRESUPUESTO con esta cadena (${P.moneda})</span>
        <span class="val">${M.fmt(M.conv(M.totalGeneral()))}</span></div>
      </div>`;

    if (!oficial) h += `<p class="mini" style="max-width:70ch">
      <b>Exportar a PRESCOM:</b> el archivo <code>.ddp</code> solo sabe guardar los seis recargos
      del formato oficial. Con un formato propio la exportación avisa antes y escribe los seis que
      pueda; el resto de la cadena no viaja en ese formato.</p>`;

    h += '</section></div>';
    $('#cuerpoIncidencias').innerHTML = h;
  }

  /* ===================== VISTA CÓMPUTOS ===================== */
  function renderComputos() {
    const it = M.getItem($('#selItemComputo').value);
    const c = $('#cuerpoComputos');
    if (!it) { c.innerHTML = '<div class="vacio">No hay ítems cargados.</div>'; return; }
    /* medidas de la fila: las tres dimensiones más el área y el volumen
       tomados directamente del plano. Las vacías no multiplican. */
    const MED = [['n', 'N° VECES', ''], ['l', 'LARGO', 'm'], ['a', 'ANCHO', 'm'],
    ['h', 'ALTO / ESP.', 'm'], ['ar', 'ÁREA', 'm²'], ['vo', 'VOLUMEN', 'm³']];
    let h = `<h3 style="margin-top:0;color:var(--rojo-txt)">${esc(it.desc)} — unidad ${esc(it.und)}</h3>
      <table class="rej"><thead><tr><th style="width:40px">N°</th><th>DESCRIPCIÓN / UBICACIÓN</th>` +
      MED.map(([, t, u]) => `<th style="width:88px">${t}${u ? ' <span class="und">(' + u + ')</span>' : ''}</th>`).join('') +
      `<th style="width:110px">PARCIAL</th><th style="width:34px"></th></tr></thead><tbody>`;
    const nCols = MED.length + 3;
    if (!it.computos.length) h += `<tr><td colspan="${nCols}" class="mini" style="padding:8px">Sin filas. Use «Agregar fila».</td></tr>`;
    it.computos.forEach((x, k) => {
      h += `<tr><td class="ctr">${k + 1}</td>
        <td><input class="txt" data-comp="${k}" data-c="d" value="${esc(x.d || '')}"></td>` +
        MED.map(([campo]) =>
          `<td><input type="number" step="any" inputmode="decimal" data-comp="${k}" data-c="${campo}" value="${x[campo] ?? ''}"></td>`).join('') +
        `<td class="num">${M.fmt(M.parcialComputo(x), 3)}</td>
        <td class="ctr"><button class="b-del" data-delcomp="${k}">✕</button></td></tr>`;
    });
    h += `</tbody><tfoot><tr><td colspan="${nCols - 2}" class="num">TOTAL CÓMPUTO (${esc(it.und)})</td>
      <td class="num">${M.fmt(M.totalComputos(it), 3)}</td><td></td></tr>
      <tr><td colspan="${nCols - 2}" class="num">Cantidad actual del ítem en el presupuesto</td>
      <td class="num">${M.fmt(it.cant, 3)}</td><td></td></tr></tfoot></table>
      <p class="mini">Las celdas vacías no multiplican, así que se cargan solo las medidas que
      correspondan. Un muro: n° veces × largo × alto. Un volumen de hormigón: largo × ancho × alto.
      Si el área ya está medida del plano, se carga en <b>ÁREA (m²)</b> —y multiplicada por el
      <b>ALTO / ESP.</b> da el volumen—; si lo que está medido es el volumen, va en
      <b>VOLUMEN (m³)</b> y las demás casillas quedan vacías.</p>`;
    c.innerHTML = h;
  }

  /* ===================== VISTA CRONOGRAMA =====================
     Un solo cronograma para toda la obra, con el módulo como tarea resumen y
     cada ítem como actividad. Duración, fechas y predecesoras al estilo
     MS Project: el número de actividad es el que se usa como predecesora. */
  const barraCrono = (inicio, dias, plazo, resumen) => {
    const izq = ((Number(inicio) || 0) / (plazo || 1) * 100).toFixed(2);
    const anc = Math.max(0.4, (Number(dias) || 0) / (plazo || 1) * 100).toFixed(2);
    return `<div style="position:relative;height:15px"><div class="barra" style="position:absolute;
      left:${izq}%;width:${anc}%;${resumen ? 'background:var(--azul);height:7px;top:4px' : ''}"></div></div>`;
  };
  /* rayado semanal de fondo, para poder leer las barras */
  const rejillaGantt = plazo => {
    const s = (100 / Math.max(1, plazo) * 7).toFixed(3);
    return `background:repeating-linear-gradient(to right,var(--zebra-a) 0,var(--zebra-a) calc(${s}% - 1px),` +
      `var(--zebra-b) calc(${s}% - 1px),var(--zebra-b) ${s}%)`;
  };

  function renderCrono() {
    const P = M.proyecto();
    const c = $('#cuerpoCrono');
    $('#inpJornada').value = P.crono.jornada;
    $('#inpDiasSemana').value = P.crono.diasSemana;
    const est = M.estructuraCrono();
    if (!est.some(x => x.hijas.length)) {
      c.innerHTML = '<div class="vacio">No hay ítems para programar.</div>';
      $('#pieCrono').innerHTML = '';
      $('#lblPlazo').textContent = '—';
      return;
    }
    const plazo = P.plazo || 1;
    const fFin = M.fechasDe(0, plazo);
    $('#lblPlazo').innerHTML = `Plazo <b>${plazo}</b> días · termina el <b>${M.fmtFecha(fFin.fin)}</b>`;

    /* La escala del Gantt va por semanas calendario: cada casilla de arriba es
       una semana, desde la 1 hasta la que haga falta. Las barras se posicionan
       sobre esas semanas completas, no sobre el plazo exacto. */
    const semanas = Math.max(1, Math.ceil(plazo / 7));
    const diasEscala = semanas * 7;
    const anchoSem = semanas <= 12 ? 46 : semanas <= 30 ? 30 : semanas <= 60 ? 20
      : semanas <= 120 ? 13 : 9;
    const rejilla = rejillaGantt(diasEscala);      // una franja por semana
    const anchoGantt = Math.max(460, semanas * anchoSem);
    const anchoFijo = 32 + 44 + 300 + 66 + 86 + 86 + 108 + 96 + 96;   // columnas de la izquierda
    const cada = anchoSem < 16 ? 4 : 1;   // con semanas angostas se rotula 1 de cada 4
    let h = `<table class="rej crono" style="min-width:${anchoFijo + anchoGantt}px">
      <thead><tr>
      <th rowspan="2" style="width:32px">N°</th><th rowspan="2" style="width:44px">EDT</th>
      <th rowspan="2" style="min-width:300px">ACTIVIDAD</th>
      <th rowspan="2" style="width:66px">DURACIÓN</th><th rowspan="2" style="width:86px">COMIENZO</th>
      <th rowspan="2" style="width:86px">FIN</th>
      <th rowspan="2" style="width:108px">PREDECESORAS</th><th rowspan="2" style="width:96px">RECURSOS</th>
      <th rowspan="2" style="width:96px">MONTO</th>
      <th colspan="${semanas}" style="min-width:${anchoGantt}px">PROGRAMACIÓN · ${semanas} semanas ·
        ${M.fmtFecha(M.fechaDia(0))} a ${M.fmtFecha(fFin.fin)}</th>
      </tr><tr class="sem">`;
    for (let s = 0; s < semanas; s++) {
      const ini = M.fechaDia(s * 7);
      h += `<th style="width:${anchoSem}px" title="Semana ${s + 1} · desde el ${M.fmtFecha(ini)}">${
        (s % cada === 0 || s === semanas - 1) ? (s + 1) : ''}</th>`;
    }
    h += '</tr></thead><tbody>';

    est.forEach(mod => {
      const fm = M.fechasDe(mod.inicio, mod.dias);
      h += `<tr class="grupo"><td class="ctr"></td><td class="ctr">${mod.edt}</td>
        <td><b>${esc(mod.m.n)}</b></td>
        <td class="ctr">${mod.hijas.length ? mod.dias + ' d' : '—'}</td>
        <td class="ctr">${mod.hijas.length ? M.fmtFecha(fm.ini) : '—'}</td>
        <td class="ctr">${mod.hijas.length ? M.fmtFecha(fm.fin) : '—'}</td>
        <td></td><td></td><td class="num">${M.fmt(M.conv(M.totalModulo(mod.m)))}</td>
        <td class="celda" colspan="${semanas}" style="${rejilla}">${barraCrono(mod.inicio, mod.dias, diasEscala, true)}</td></tr>`;
      mod.hijas.forEach(a => {
        const it = a.it;
        const f = M.fechasDe(it.inicio, it.dias);
        const hm = M.horasManoObra(it);
        h += `<tr data-tarea="${it.id}">
          <td class="ctr">${a.n}</td><td class="ctr mini">${a.edt}</td>
          <td style="padding-left:18px">${esc(it.desc)}
            <div class="mini">${M.fmt(it.cant, 2)} ${esc(it.und)} · ${hm.mayor
            ? M.fmt(hm.mayor, 1) + ' h de la especialidad que más tarda'
            : 'sin mano de obra en el análisis'}</div></td>
          <td><input type="number" step="1" min="1" inputmode="numeric" data-dur="${it.id}" value="${Math.max(1, Number(it.dias) || 1)}"></td>
          <td class="ctr">${M.fmtFecha(f.ini)}</td><td class="ctr">${M.fmtFecha(f.fin)}</td>
          <td><input class="txt" data-pred="${it.id}" value="${esc(it.pred || '')}" placeholder="${a.n > 1 ? a.n - 1 : '—'}"></td>
          <td class="ctr mini">${esc(M.trenDe(it).n)}</td>
          <td class="num">${M.fmt(M.conv(M.analisis(it).total))}</td>
          <td class="celda" colspan="${semanas}" style="${rejilla}">${barraCrono(it.inicio, it.dias, diasEscala)}</td></tr>`;
      });
    });
    h += '</tbody></table>';
    c.innerHTML = h;

    /* pie: nota y curva S plegadas, para no comerle alto a la tabla */
    let pie = `<details><summary class="mini"><b>Cómo se calculan las duraciones y cómo se escriben
      las predecesoras</b></summary>
      <p class="mini" style="margin-top:4px">La duración sale de las horas de mano de obra del
      análisis: manda la especialidad que más horas necesita, dividida entre la jornada y el
      <b>% de recursos</b> del tren de trabajo (pestaña RECURSOS), y estirada por los días no trabajados
      de la semana. Los ítems sin mano de obra quedan en 1 día.
      <b>Predecesoras</b>: el N° de la actividad anterior — <code>5</code> (fin&nbsp;a&nbsp;comienzo),
      <code>5FC-1</code> (el mismo día en que termina la 5, lo que se usa para las actividades de un
      día), <code>5CC</code> (empiezan juntas), <code>5+3</code> (3 días después), varias separadas
      por <code>;</code>. Al cambiar duración o predecesoras se recalculan las fechas de toda la obra.</p>
      </details>`;

    const S = M.curvaS();
    pie += '<details><summary class="mini"><b style="color:var(--rojo-txt)">Curva "S" — avance programado ' +
      'acumulado</b></summary>';
    pie += '<div style="overflow-x:auto;margin-top:4px"><table class="rej"><thead><tr><th>PERÍODO (mes)</th>' +
      S.map(x => '<th>' + x.i + '</th>').join('') +
      '</tr></thead><tbody><tr><td>Monto del período</td>' +
      S.map(x => '<td class="num">' + M.fmt(M.conv(x.monto)) + '</td>').join('') + '</tr>' +
      '<tr><td>Acumulado</td>' + S.map(x => '<td class="num">' + M.fmt(M.conv(x.acum)) + '</td>').join('') + '</tr>' +
      '<tr><td>% acumulado</td>' + S.map(x => '<td class="num">' + x.pct.toFixed(2) + '</td>').join('') +
      '</tr></tbody></table></div></details>';
    $('#pieCrono').innerHTML = pie;
  }

  /* ===================== VISTA RECURSOS =====================
     Trenes de trabajo: cada tren es una cuadrilla que ejecuta sus actividades
     una tras otra; trenes distintos avanzan en paralelo. Los recursos van en
     porcentaje — 100 % una cuadrilla, 50 % media, 200 % dos. */
  function renderRecursos() {
    const P = M.proyecto();
    $('#inpTope').value = P.crono.topeDias;
    const L = M.trenes();
    const acts = M.actividades();
    let h = `<h2 style="color:var(--rojo-txt);margin-top:0">Trenes de trabajo</h2>
      <p class="mini">Cada tren es una cuadrilla que hace sus actividades una tras otra; los trenes
      trabajan en paralelo. Los <b>recursos</b> van en porcentaje: <b>100 %</b> = una cuadrilla,
      <b>50 %</b> = media, <b>200 %</b> = dos cuadrillas (la mitad de tiempo).
      Todas las actividades entran al <b>TREN 0</b>, donde el porcentaje se carga
      <b>actividad por actividad</b>. En los trenes que cree después manda el porcentaje del tren.</p>
      <table class="rej" style="max-width:860px"><thead><tr>
        <th style="width:36px">N°</th><th>TREN</th><th style="width:110px">RECURSOS (%)</th>
        <th style="width:110px">ACTIVIDADES</th><th style="width:120px">DÍAS DEL TREN</th>
        <th style="width:34px"></th></tr></thead><tbody>`;
    L.forEach((t, k) => {
      const base = M.esTrenBase(t);
      const suyas = acts.filter(a => M.trenDe(a.it).id === t.id);
      const dias = suyas.reduce((s, a) => s + Math.max(1, Number(a.it.dias) || 1), 0);
      h += `<tr><td class="ctr">${k}</td>
        <td><input class="txt" data-tren-n="${t.id}" value="${esc(t.n)}">
          ${base ? '<div class="mini">el % se define por actividad, abajo</div>' : ''}</td>
        <td>${base ? '<span class="mini" style="padding-left:6px">por actividad</span>'
          : `<input type="number" step="25" min="1" inputmode="numeric" data-tren-r="${t.id}" value="${t.rec}">`}</td>
        <td class="num">${suyas.length}</td><td class="num">${dias}</td>
        <td class="ctr">${base ? '' : `<button class="b-del" data-deltren="${t.id}" title="Eliminar tren">✕</button>`}</td></tr>`;
    });
    h += `</tbody></table>
      <h2 style="color:var(--rojo-txt)">Asignación de las actividades</h2>
      <p class="mini">En el <b>TREN 0</b> cada actividad lleva su propio porcentaje (vacío = 100 %).
      Si la pasa a otro tren, usa el porcentaje de ese tren. Con «⚖ Ajustar al tope» se sube el
      porcentaje de las del TREN 0 que pasan de ${P.crono.topeDias} días —solo como análisis inicial,
      después cámbielo a criterio.</p>
      <div style="overflow-x:auto"><table class="rej" style="min-width:900px"><thead><tr>
        <th style="width:32px">N°</th><th style="width:44px">EDT</th><th>ACTIVIDAD</th>
        <th style="width:96px">HORAS M.O.</th><th style="width:180px">TREN</th>
        <th style="width:96px">% DE RECURSOS</th><th style="width:84px">% USADO</th>
        <th style="width:90px">DURACIÓN</th></tr></thead><tbody>`;
    acts.forEach(a => {
      const it = a.it, hm = M.horasManoObra(it);
      const dias = M.duracionItem(it);
      const largo = dias > P.crono.topeDias;
      const base = M.esTrenBase(M.trenDe(it));
      h += `<tr><td class="ctr">${a.n}</td><td class="ctr mini">${a.edt}</td>
        <td>${esc(it.desc)}</td>
        <td class="num">${hm.mayor ? M.fmt(hm.mayor, 1) : '—'}</td>
        <td><select data-act-tren="${it.id}">${L.map(t =>
        `<option value="${t.id}" ${M.trenDe(it).id === t.id ? 'selected' : ''}>${esc(t.n)}${
          M.esTrenBase(t) ? '' : ' (' + t.rec + ' %)'}</option>`).join('')}</select></td>
        <td>${base
          ? `<input type="number" step="25" min="1" inputmode="numeric" data-act-rec="${it.id}"
               value="${Number(it.rec) > 0 ? it.rec : ''}" placeholder="100">`
          : '<span class="mini" style="padding-left:6px">del tren</span>'}</td>
        <td class="num">${M.fmt(M.recursoDe(it), 0)} %</td>
        <td class="num" style="${largo ? 'color:var(--err);font-weight:700' : ''}">${dias} d</td></tr>`;
    });
    h += '</tbody></table></div>';
    $('#cuerpoRecursos').innerHTML = h;
  }

  /* ===================== MENÚS ===================== */
  const HAY_IMPORTADOR = typeof IMPORTADOR !== 'undefined';
  const HAY_EXPORTADOR = typeof EXPORTADOR !== 'undefined';
  const MENUS = {
    archivo: [
      ['Pantalla de inicio', 'pantallaInicio'], ['—'],
      ['Nuevo proyecto', 'nuevo', 'Ctrl+N'], ['Abrir proyecto (.boq)…', 'abrir', 'Ctrl+O'],
      ['Guardar proyecto', 'guardar', 'Ctrl+S'],
      ['Guardar como… (elegir carpeta)', 'guardarComo', 'Ctrl+Mayús+S'], ['—'],
      ['Importar proyecto (.ddp)…', 'importarDDP'],
      ['Importar archivos sueltos (.PRE .IND .DAT)…', 'importarSueltos'],
      ['Exportar a PRESCOM (.ddp)…', 'exportarPrescom'], ['—'],
      ['Datos generales del proyecto…', 'datosProyecto'],
      /* Lo que sale del proyecto —Excel e insumos en CSV— vive en REPORTES y
         solo ahi: estaba repetido en los dos menus y el mismo usuario no
         sabia por cual entrar. */
      ['—'], ['Borrar todo y empezar de cero', 'borrarTodo']
    ],
    edicion: [
      ['Nuevo ítem', 'nuevoItem', 'Ins'], ['Duplicar ítem', 'dupItem'], ['Eliminar ítem', 'delItem', 'Supr'],
      ['—'], ['Subir ítem', 'subirItem'], ['Bajar ítem', 'bajarItem'],
      ['—'], ['Nuevo módulo', 'nuevoModulo'], ['Renombrar módulo', 'renModulo'], ['Eliminar módulo', 'delModulo']
    ],
    insertar: [
      ['Ítem desde la Base de Datos…', 'irBase', 'F3'], ['Insumo nuevo…', 'nuevoInsumo'],
      ['Agregar insumo al análisis…', 'addInsumo'], ['Fila de cómputo métrico', 'addComputo']
    ],
    reportes: [
      ['Formulario B-1 · Presupuesto', 'repPresupuesto'], ['Formulario B-2 · Análisis de precios', 'repAnalisis'],
      ['Formulario B-3 · Precios elementales', 'repElementales'], ['—'],
      ['Requerimiento total de insumos', 'repInsumos'], ['Planilla de cómputos métricos', 'repComputos'],
      ['Cronograma y curva S', 'repCrono'], ['Resumen por módulos', 'repResumen'], ['—'],
      ['Exportar a Excel (libro completo)', 'exportarXls'],
      ['Exportar a Excel (elegir reportes)…', 'exportarXlsSel'],
      ['Exportar insumos a CSV', 'exportarCsvIns']
    ],
    herramientas: [
      ['Actualizar precios desde la Base de Datos…', 'actualizarPrecios'],
      ['Generar cronograma por rendimiento…', 'generarCrono'],
      ['Distribuir cronograma por incidencia económica', 'autoCrono'],
      ['Depurar insumos repetidos…', 'depurarInsumos'],
      ['Recalcular los precios unitarios del archivo importado…', 'recalcularPU'],
      ['—'], ['Fusionar análisis…', 'fusionarApus'],
      ['Crear ítems en lote…', 'itemsEnLote'],
      ['—'], ['Verificar consistencia del proyecto', 'verificar'],
      ['Comparar con otro proyecto (.boq)…', 'compararProyecto'],
      ['—'], ['Crear una base de datos…', 'nuevaBasePropia'],
      ['Guardar el presupuesto como base de datos…', 'proyectoABase'],
      ['Mis bases de datos…', 'misBases'],
      ['Mis cambios en la Base de Datos…', 'misCambiosBD']
    ],
    config: [
      ['Datos generales del proyecto…', 'datosProyecto'],
      /* Las incidencias son del proyecto entero —cargas sociales, IVA, herramientas,
         gastos generales, utilidad e IT— y hasta ahora solo se llegaba a ellas por
         la pestaña o por el botón del B-2. Acá abre la misma pestaña. */
      ['Incidencias del proyecto…', 'paramsGlobal'],
      ['Moneda, tipo de cambio y decimales…', 'formatoNumeros'],
      ['Tema claro / oscuro', 'tema'],
      ['Interfaz simple / completa', 'cambiarModo'],
      ['—'], ['Base de Datos al día…', 'estadoSincro'],
      ['—'], ['Mi cuenta…', 'cuenta'],
      ['Conectar con mi Google Drive…', 'driveConectar'],
      ['—'], ['Guardar este proyecto en mi Drive', 'driveGuardarProyecto'],
      ['Respaldar mis bases y cambios en mi Drive', 'driveGuardarBiblioteca']
    ],
    ayuda: [['Acerca de OpenBOQ', 'acerca'], ['Guía rápida de uso', 'guia'],
    ['—'], ['Reportar un error o una observación…', 'reportar']]
  };

  /* Importar y exportar a PRESCOM (js/importador.js y js/exportador.js) son
     módulos aparte, que no viajan en el repositorio público. Sin ellos la
     aplicación funciona igual y sus opciones simplemente no aparecen. */
  (() => {
    const fuera = new Set([
      ...(HAY_IMPORTADOR ? [] : ['importarDDP', 'importarSueltos', 'recalcularPU']),
      ...(HAY_EXPORTADOR ? [] : ['exportarPrescom'])
    ]);
    if (!fuera.size) return;
    Object.keys(MENUS).forEach(k => {
      const l = MENUS[k].filter(x => !fuera.has(x[1]));
      /* sin separadores repetidos ni sueltos al principio o al final */
      MENUS[k] = l.filter((x, i) => !(x[0] === '—' &&
        (i === 0 || i === l.length - 1 || l[i - 1][0] === '—')));
    });
  })();

  /* ===================== MENÚ NATIVO (solo escritorio) =====================
     En la aplicación de escritorio la barra de menús de Windows muestra
     ESTAS opciones —las del presupuesto— y no las del andamio que la
     hospeda: nada de «acercar», «pantalla completa» ni un «Acerca de» que
     hable del navegador incrustado.

     La definición es la misma de arriba, MENUS, y los títulos salen de la
     barra que ya está en la página: una sola lista, dibujada en dos lados.
     El proceso principal solo la dibuja; cuando el usuario elige algo,
     devuelve el mismo identificador que usan los `data-acc` de adentro y se
     ejecuta acá.

     Puesto el menú nativo, el de adentro se oculta. Dos barras de menú con
     lo mismo es peor que una: se ven distintas, se abren distinto y el
     usuario no sabe cuál es la buena. La marca con la versión se queda,
     que es lo único de esa franja que no es menú. */
  function armarEscritorio() {
    const ESC = typeof window !== 'undefined' ? window.OPENBOQ_ESCRITORIO : null;
    if (!ESC) return;

    if (ESC.menu) {
      const def = $$('.menubar .m').map(m => {
        const t = (m.textContent || '').trim();
        return {
          titulo: t.charAt(0) + t.slice(1).toLowerCase(),
          items: (MENUS[m.dataset.menu] || []).map(x => x[0] === '—'
            ? { sep: true }
            : { etiqueta: x[0], acc: x[1], atajo: x[2] || '' })
        };
      }).filter(x => x.items.length);

      if (def.length) {
        ESC.menu(def);
        $$('.menubar .m').forEach(m => { m.style.display = 'none'; });
        document.body.classList.add('escritorio');
      }
    }

    /* La opción elegida en el menú de Windows. Llega el identificador, no la
       función: del otro lado no hay nada del presupuesto. */
    if (ESC.alAccion) ESC.alAccion(acc => {
      if (!ACC[acc]) return;
      cerrarMenus();
      cerrarInicio();
      ACC[acc]();
    });

    /* La sesión que volvió del navegador del sistema. Se guarda y se recarga,
       igual que cuando el login termina en una ventana aparte: al entrar
       cambia el estado de media aplicación y repintar a mano deja rincones
       sin actualizar. */
    if (ESC.alSesion) ESC.alSesion(ses => {
      if (!hayNube() || !NUBE.tomarSesion(ses)) return;
      recargarPorLogin();
    });
  }

  function abrirMenu(nombre, el) {
    cerrarMenus();
    const def = MENUS[nombre]; if (!def) return;
    el.classList.add('abierto');
    const d = document.createElement('div');
    d.className = 'menu-pop';
    const r = el.getBoundingClientRect();
    d.style.left = Math.min(r.left, window.innerWidth - 250) + 'px';
    d.style.top = r.bottom + 'px';
    d.innerHTML = def.map(x => x[0] === '—' ? '<div class="sep"></div>' :
      `<div data-acc="${x[1]}">${esc(x[0])}${x[2] ? '<kbd>' + x[2] + '</kbd>' : ''}</div>`).join('');
    document.body.appendChild(d);
  }
  function cerrarMenus() {
    $$('.menu-pop').forEach(x => x.remove());
    $$('.menubar .m').forEach(x => x.classList.remove('abierto'));
  }

  /* ===================== MODAL ===================== */
  function modal(titulo, cuerpo, botones) {
    $('#modalTitulo').textContent = titulo;
    $('#modalCuerpo').innerHTML = cuerpo;
    $('#modalPie').innerHTML = '';
    (botones || [['Cerrar', null, 'sec']]).forEach(b => {
      const bt = document.createElement('button');
      bt.className = 'btn ' + (b[2] || '');
      bt.textContent = b[0];
      bt.onclick = () => { if (!b[1] || b[1]() !== false) cerrarModal(); };
      $('#modalPie').appendChild(bt);
    });
    $('#overlay').classList.add('on');
  }
  const cerrarModal = () => {
    /* `ancho` lo pone la matriz análisis × insumo, que necesita más espacio
       que un diálogo normal. Si no se quitara acá, el siguiente diálogo
       cualquiera saldría estirado. */
    $('#overlay').classList.remove('on', 'ancho');
    mzEstado = null;
  };

  /* ===================== COMBO DE UNIDADES =====================
     Lista desplegable con las unidades de uso corriente más un campo libre
     para las que no están («otra…»). Se usa en los diálogos donde hay que
     elegir la unidad de un ítem. */
  function comboUnidad(id, valor) {
    const v = valor || 'm²';
    const enLista = M.UNIDADES.indexOf(v) >= 0;
    return `<span style="display:flex;gap:6px">
      <select id="${id}" style="flex:1">
        ${M.UNIDADES.map(u => `<option value="${esc(u)}" ${u === v ? 'selected' : ''}>${esc(u)}</option>`).join('')}
        <option value="__otra" ${enLista ? '' : 'selected'}>otra…</option>
      </select>
      <input id="${id}Otra" placeholder="unidad" style="flex:1;${enLista ? 'display:none' : ''}"
        value="${enLista ? '' : esc(v)}">
    </span>`;
  }
  /** Unidad elegida en un combo, venga de la lista o del campo libre. */
  function unidadDe(id) {
    const s = $('#' + id); if (!s) return '';
    return s.value === '__otra' ? ($('#' + id + 'Otra').value.trim() || 'glb') : s.value;
  }
  function conectarUnidad(id, alCambiar) {
    const s = $('#' + id), o = $('#' + id + 'Otra'); if (!s) return;
    s.addEventListener('change', () => {
      o.style.display = s.value === '__otra' ? '' : 'none';
      if (s.value === '__otra') o.focus();
      if (alCambiar) alCambiar();
    });
    if (alCambiar) o.addEventListener('input', alCambiar);
  }

  /* ===================== ESTADO DE LA CUENTA =====================
     Lo que el usuario tiene de los dos lados, junto: lo de este equipo
     —proyecto abierto, bases propias, aportes esperando— y lo de la cuenta
     —los proyectos de la nube y la biblioteca guardada—, cada cosa con su fecha.
     Las de acá las pone el navegador; las de la nube vienen del servidor.  */

  const fechaHora = s => s ? new Date(s).toLocaleString('es-BO') : '—';

  /** Lo de este equipo. Es todo lo que ya está en memoria: no pide nada. */
  function cuentaLocal() {
    const P = M.proyecto();
    const nItems = P.modulos.reduce((s, m) => s + m.items.length, 0);
    const bases = M.basesPropias();
    const nApus = bases.reduce((s, x) => s + x.apus, 0);
    const ultLocal = M.ultimoLocal ? M.ultimoLocal() : '';
    const enCola = hayNube() ? NUBE.enCola() : 0;
    const ultResp = hayNube() ? NUBE.ultimoRespaldo() : '';

    const pendiente = sinGuardar || ensayo
      ? ' <span class="cta-pend">hay cambios sin guardar</span>' : '';

    return `<table class="rej comp cta"><tbody>
      <tr><td class="et">Proyecto abierto</td><td><b>${esc(P.nombre)}</b>
        <span class="mini">${nItems} ítem(s) · ${M.fmt(M.totalGeneral(), 2)} Bs</span></td></tr>
      <tr><td class="et">Último cambio guardado acá</td>
        <td>${ultLocal ? fechaHora(ultLocal) : 'todavía no se guardó en este navegador'}${pendiente}</td></tr>
      <tr><td class="et">Archivo del proyecto</td>
        <td>${manejo && manejo.name ? esc(manejo.name) : 'sin archivo — solo vive en este navegador'}</td></tr>
      <tr><td class="et">Mis bases de datos</td>
        <td>${bases.length ? `${bases.length} base(s) · ${nApus} análisis
          <span class="mini">${bases.map(b => esc(b.n) + ' (' + b.apus + ')').join(' · ')}</span>`
        : 'ninguna todavía'}</td></tr>
      <tr><td class="et">Último respaldo desde este equipo</td>
        <td>${ultResp ? fechaHora(ultResp) : 'nunca'}</td></tr>
      <tr><td class="et">Aportes esperando salir</td>
        <td>${enCola ? enCola + ' análisis en cola' : 'ninguno'}</td></tr>
      </tbody></table>`;
  }

  /** Lo de la cuenta. Se pide al servidor y se completa cuando llega. */
  function pintarCuentaNube() {
    const caja = () => $('#ctaNube');
    if (!caja()) return;
    Promise.all([
      NUBE.listarProyectos(),
      NUBE.infoBiblioteca().catch(() => null)
    ]).then(([L, bib]) => {
      const c = caja(); if (!c) return;
      const fechas = (L || []).map(p => p.actualizado_en)
        .concat(bib && bib.actualizado_en ? [bib.actualizado_en] : []).filter(Boolean).sort();
      const ultimo = fechas.length ? fechas[fechas.length - 1] : '';

      const filas = (L || []).length
        ? L.map(p => `<tr>
            <td class="ctr">${p.slot}</td>
            <td>${p.protegido ? '🔒 ' : ''}${esc(p.nombre || p.etiqueta || '')}</td>
            <td class="num">${p.n_items || 0}</td>
            <td class="num">${Math.round((p.bytes || 0) / 1024)} KB</td>
            <td>${fechaHora(p.actualizado_en)}</td>
            <td class="mini">${esc(p.app_version || '—')}</td></tr>`).join('')
        : `<tr><td colspan="6" class="mini">Ningún proyecto guardado en la cuenta.
             Se guardan hasta ${NUBE.TOPE_PROYECTOS}.</td></tr>`;

      c.innerHTML = `
        <table class="rej comp cta"><tbody>
          <tr><td class="et">Biblioteca guardada</td>
            <td>${bib ? `${bib.n_bases} base(s) · ${bib.n_apus} análisis
              <span class="mini">guardada el ${fechaHora(bib.actualizado_en)}</span>`
          : 'no hay ninguna biblioteca en la cuenta'}</td></tr>
          <tr><td class="et">Último cambio en línea</td><td>${ultimo ? fechaHora(ultimo) : '—'}</td></tr>
        </tbody></table>
        <div style="overflow-x:auto"><table class="rej comp cta-proy">
          <thead><tr><th>#</th><th>PROYECTO</th><th>ÍTEMS</th><th>TAMAÑO</th>
            <th>ÚLTIMO CAMBIO</th><th>VERSIÓN</th></tr></thead>
          <tbody>${filas}</tbody></table></div>
        <p class="mini">Los proyectos con candado no muestran el nombre de la obra: se cifra en el
          navegador junto con la entidad, la ubicación y los cómputos.</p>`;
    }).catch(e => {
      const c = caja(); if (!c) return;
      c.innerHTML = `<p class="mini">No se pudo consultar la cuenta: ${esc(e.message)}.
        Lo de este equipo, que está arriba, se ve igual.</p>`;
    });
  }

  /* ===================== MATRIZ ANALISIS x INSUMO =====================
     La planilla de rendimientos. Insumos en las filas, análisis en las
     columnas, el rendimiento en el cruce. Es la forma de corregir el mismo
     insumo en veinte análisis sin abrir veinte análisis.

     Dos decisiones que valen la pena explicar:

     · Solo salen los insumos que PARTICIPAN en alguno de esos ítems. Una
       matriz con los 1.200 insumos de un PRESCOM importado sería casi toda
       ceros: no se podría leer y tardaría en dibujarse.

     · Un rendimiento escrito en 0 SACA el insumo de ese análisis, no lo deja
       en cero. Un renglón en cero ensucia el B-2 impreso y no aporta costo.
       La celda vacía y el cero son lo mismo, y así lo dice la ayuda.

     El total de cada columna es el precio unitario del ítem, para ver el
     efecto de lo que se escribe sin salir de la planilla.                     */

  /** Alcance y filtro con los que se abrió la matriz, para repintarla igual. */
  let mzEstado = null;

  function abrirMatriz(alcance, tipo) {
    mzEstado = { alcance, tipo };
    pintarMatriz();
  }

  function pintarMatriz() {
    if (!mzEstado) return;
    const P = M.proyecto();
    const mz = M.matrizApuInsumo({ modulo: mzEstado.alcance.modulo, tipo: mzEstado.tipo });
    const nom = { M: 'Material', O: 'Mano de obra', E: 'Equipo' };

    if (!mz.insumos.length || !mz.items.length) {
      modal('Matriz análisis × insumo',
        '<p>Ninguno de esos ítems tiene insumos cargados' +
        (mzEstado.tipo ? ' del tipo elegido' : '') + '.</p>');
      return;
    }

    /* el precio unitario de cada columna, para el pie */
    const pu = mz.items.map(it => M.analisis(it).pu);

    let h = '<div class="mz-envoltura"><table class="rej mz"><thead><tr>' +
      '<th class="mz-esq">INSUMO</th>' +
      mz.items.map((it, k) => '<th class="mz-col" title="' +
        esc((it.cod ? it.cod + ' — ' : '') + it.desc) + '">' +
        /* el código suele ser un número de orden y no dice nada; lo que
           identifica la columna es la descripción, recortada. El título
           emergente tiene el nombre entero. */
        '<span class="mz-nro">' + (k + 1) + (it.cod ? ' · ' + esc(it.cod) : '') + '</span>' +
        '<span class="mz-rot">' + esc(it.desc.slice(0, 44)) + '</span>' +
        '<span class="mini">' + esc(it.und) + '</span></th>').join('') +
      '</tr></thead><tbody>';

    mz.insumos.forEach(ins => {
      h += '<tr><th class="mz-fila"><span class="badge ' + ins.t + '">' + nom[ins.t] + '</span> ' +
        esc(ins.d) + ' <span class="mini">' + esc(ins.u) + '</span></th>';
      mz.items.forEach(it => {
        const v = mz.rend[ins.id + '|' + it.id];
        h += '<td class="mz-celda"><input type="number" step="any" inputmode="decimal"' +
          ' data-mz-ins="' + ins.id + '" data-mz-item="' + it.id + '"' +
          ' value="' + (v === undefined ? '' : v) + '"' +
          (v === undefined ? ' class="mz-vacia"' : '') + '></td>';
      });
      h += '</tr>';
    });

    h += '</tbody><tfoot><tr><th class="mz-fila">PRECIO UNITARIO (' + P.moneda + ')</th>' +
      pu.map(v => '<td class="mz-pu num">' + M.fmt(M.conv(v)) + '</td>').join('') +
      '</tr></tfoot></table></div>' +
      '<p class="mini">Cada casilla es el <b>rendimiento</b> del insumo en ese análisis. ' +
      'Escribir <b>0</b> —o vaciar la casilla— saca el insumo de ese análisis. ' +
      'El pie muestra el precio unitario recalculado. ' +
      mz.insumos.length + ' insumo(s) × ' + mz.items.length + ' análisis.</p>';

    modal('Matriz análisis × insumo — ' +
      (mzEstado.alcance.modulo === undefined ? 'todo el presupuesto' : esc(M.modulo().n)), h,
      [['Cerrar', () => { mzEstado = null; }]]);
    $('#overlay').classList.add('ancho');
  }

  /* ===================== COMPARAR CON OTRO PROYECTO =====================
     Abre un .boq guardado y lo pone al lado del que se está trabajando, sin
     reemplazar nada: el archivo se lee, se calculan sus totales con SUS
     insumos y SUS incidencias, y se muestran las diferencias. Es el caso de
     todos los días: el mismo proyecto antes y después de una revisión, o la
     versión de otra unidad contra la propia.

     Solo el resumen —totales por módulo y del proyecto—; el detalle ítem por
     ítem es otra pantalla y todavía no está.                              */

  /** Empareja los módulos de los dos proyectos por nombre.
      Nombres repetidos: se emparejan en el orden en que aparecen, así dos
      módulos que se llamen igual no caen los dos en la misma fila. */
  function compararModulos(A, B) {
    const usados = new Set();
    const filas = A.modulos.map(a => {
      const k = B.modulos.findIndex((b, i) => !usados.has(i) && M.norm(b.n) === M.norm(a.n));
      if (k >= 0) usados.add(k);
      return { n: a.n, a, b: k >= 0 ? B.modulos[k] : null };
    });
    /* los que están solo en el archivo van al final, para que se vean */
    B.modulos.forEach((b, i) => { if (!usados.has(i)) filas.push({ n: b.n, a: null, b }); });
    return filas;
  }

  /** Diferencia en Bs y en %, con el signo a la vista. Sin base, no hay %. */
  function dif(va, vb) {
    const d = M.r2((vb || 0) - (va || 0));
    const pct = va ? (d / va * 100) : null;
    return { d, pct };
  }
  const celdaDif = ({ d, pct }) => {
    const cls = d === 0 ? '' : (d > 0 ? 'sube' : 'baja');
    const signo = d > 0 ? '+' : '';
    return `<td class="num ${cls}">${signo}${M.fmt(d, 2)}</td>
            <td class="num ${cls}">${pct === null ? '—' : signo + pct.toFixed(2) + '%'}</td>`;
  };

  function mostrarComparacion(otro, nombreArchivo) {
    const A = M.resumenProyecto(M.proyecto());   // el abierto
    const B = M.resumenProyecto(otro);           // el del archivo
    const filas = compararModulos(A, B);
    const dTot = dif(A.total, B.total);

    const cab = `<table class="rej comp"><tbody>
      <tr><td class="et">Proyecto</td><td><b>${esc(A.nombre)}</b></td><td><b>${esc(B.nombre)}</b></td><td colspan="2"></td></tr>
      <tr><td class="et">Entidad</td><td>${esc(A.entidad) || '—'}</td><td>${esc(B.entidad) || '—'}</td><td colspan="2"></td></tr>
      <tr><td class="et">Fecha</td><td>${esc(A.fecha) || '—'}</td><td>${esc(B.fecha) || '—'}</td><td colspan="2"></td></tr>
      <tr><td class="et">Ítems</td><td class="num">${A.items}</td><td class="num">${B.items}</td>
        <td class="num" colspan="2">${B.items - A.items > 0 ? '+' : ''}${B.items - A.items}</td></tr>
      <tr><td class="et">Insumos</td><td class="num">${A.insumos}</td><td class="num">${B.insumos}</td>
        <td class="num" colspan="2">${B.insumos - A.insumos > 0 ? '+' : ''}${B.insumos - A.insumos}</td></tr>
      </tbody></table>`;

    const cuerpo = filas.map(f => {
      const ta = f.a ? f.a.total : null, tb = f.b ? f.b.total : null;
      const solo = !f.a ? 'solo en el archivo' : (!f.b ? 'solo en este proyecto' : '');
      return `<tr${solo ? ' class="solo"' : ''}>
        <td>${esc(f.n)}${solo ? ` <span class="mini">(${solo})</span>` : ''}</td>
        <td class="num">${f.a ? f.a.items : '—'}</td>
        <td class="num">${f.a ? M.fmt(ta, 2) : '—'}</td>
        <td class="num">${f.b ? f.b.items : '—'}</td>
        <td class="num">${f.b ? M.fmt(tb, 2) : '—'}</td>
        ${f.a && f.b ? celdaDif(dif(ta, tb)) : '<td class="num">—</td><td class="num">—</td>'}</tr>`;
    }).join('');

    const aviso = A.moneda !== B.moneda || (A.tc !== B.tc && B.tc)
      ? `<p class="mini"><b>Ojo:</b> los dos archivos no tienen el mismo tipo de cambio o la misma
         moneda de presentación (este: ${esc(A.moneda)} a ${M.fmt(A.tc, 2)} · el archivo:
         ${esc(B.moneda)} a ${M.fmt(B.tc, 2)}). La tabla está en Bs, que es como se guardan los
         precios, así que la comparación vale igual.</p>` : '';

    modal('Comparar con otro proyecto', `
      <p class="mini">Archivo leído: <b>${esc(nombreArchivo || 'sin nombre')}</b>. No se abrió ni
        reemplazó nada: el proyecto que está trabajando quedó como estaba.</p>
      ${cab}
      <div style="overflow-x:auto">
      <table class="rej comp">
        <thead>
          <tr><th rowspan="2">MÓDULO</th><th colspan="2">ESTE PROYECTO</th>
            <th colspan="2">EL ARCHIVO</th><th colspan="2">DIFERENCIA</th></tr>
          <tr><th>ÍTEMS</th><th>TOTAL (Bs)</th><th>ÍTEMS</th><th>TOTAL (Bs)</th>
            <th>Bs</th><th>%</th></tr>
        </thead>
        <tbody>${cuerpo}</tbody>
        <tfoot><tr><td>TOTAL DEL PROYECTO</td>
          <td class="num">${A.items}</td><td class="num">${M.fmt(A.total, 2)}</td>
          <td class="num">${B.items}</td><td class="num">${M.fmt(B.total, 2)}</td>
          ${celdaDif(dTot)}</tr></tfoot>
      </table></div>
      ${aviso}
      <p class="mini">Los totales salen con las incidencias de cada archivo —cargas sociales, IVA,
        herramientas, gastos generales, utilidad e IT—, así que una diferencia puede venir de los
        precios o de los parámetros.</p>
      <p class="mini"><b>¿De dónde sale la diferencia?</b> «Comparar en Excel» baja un libro con dos
        hojas: el <b>presupuesto ítem contra ítem</b> —cantidad, precio unitario y total de los dos
        lados, con la diferencia en Bs y en %— y los <b>insumos, insumo contra insumo</b>, marcando
        en cada uno si hubo incremento o decremento.</p>`,
      [['Cerrar', null, 'sec'],
      ['Comparar en Excel…', () => {
        try {
          const C = REP.excelComparacion(otro, nombreArchivo);
          marcarGuardado('Comparación en Excel: ' + C.items.length + ' ítems · ' +
            C.insumos.length + ' insumos');
        } catch (e) {
          alert('No se pudo armar la comparación: ' + (e && e.message || e));
        }
        return false;      // el resumen queda abierto: el Excel es un agregado, no un reemplazo
      }]]);
  }

  /** Lee el archivo elegido y muestra la comparación. */
  function compararTexto(txt, nombreArchivo) {
    let otro;
    try { otro = M.leerProyecto(txt); }
    catch (e) {
      return modal('Comparar con otro proyecto',
        `<p style="color:var(--err)">No se pudo leer el archivo: ${esc(e.message)}</p>
         <p class="mini">Tiene que ser un proyecto guardado por OpenBOQ (<code>.boq</code>).</p>`,
        [['Cerrar', null, 'sec']]);
    }
    mostrarComparacion(otro, nombreArchivo);
  }

  /* ===================== ACCIONES ===================== */
  const ACC = {
    /* --- archivo --- */
    pantallaInicio() { abrirInicio(); },
    /* Cambia el tema y avisa por la barra de estado, porque desde
       CONFIGURACIÓN el botón de la pantalla de inicio no está a la vista. */
    cambiarModo() { fijarModo(modoSimple() ? 'completo' : 'simple'); },
    tema() {
      const nuevo = temaActual() === 'oscuro' ? 'claro' : 'oscuro';
      fijarTema(nuevo);
      marcarGuardado('Tema ' + nuevo);
    },
    nuevo() {
      confirmarDescartar('Nuevo proyecto', () => {
        modal('Nuevo proyecto', `<div class="form-g">
          <label>Nombre del proyecto</label><input id="mNom" value="Nuevo proyecto">
          <label>Entidad</label><input id="mEnt" value="${esc(entidadRecordada())}" placeholder="Entidad o empresa">
          <label>Ubicación</label><input id="mUbi">
          <label>Plazo (días)</label><input id="mPlazo" type="number" value="180"></div>`,
          [['Cancelar', null, 'sec'], ['Crear', () => {
            M.proyectoNuevo($('#mNom').value.trim() || 'Sin nombre');
            const P = M.proyecto();
            P.entidad = $('#mEnt').value.trim(); P.ubicacion = $('#mUbi').value;
            recordarEntidad(P.entidad);
            P.plazo = Number($('#mPlazo').value) || 180;
            manejo = null; sinGuardar = false; sinArchivo = false;
            M.guardarLocal(); render(); irVista('presupuesto');
            marcarGuardado('Proyecto creado');
          }]]);
      });
    },
    abrir() {
      confirmarDescartar('Abrir otro proyecto', async () => {
        if (typeof window.showOpenFilePicker === 'function') {
          try {
            const [h] = await window.showOpenFilePicker({
              types: [{ description: 'Proyecto OpenBOQ', accept: { 'application/json': ['.boq', '.json'] } }]
            });
            abrirTexto(await (await h.getFile()).text(), h.name, h);
            return;
          } catch (e) { if (e && e.name === 'AbortError') return; }
        }
        $('#fileAbrir').click();
      });
    },
    /* No pasa por confirmarDescartar: no reemplaza nada, solo mira el otro
       archivo. Tampoco toca `manejo`, así «Guardar» sigue apuntando al
       archivo del proyecto abierto. */
    async compararProyecto() {
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          const [h] = await window.showOpenFilePicker({
            types: [{ description: 'Proyecto OpenBOQ', accept: { 'application/json': ['.boq', '.json'] } }]
          });
          const f = await h.getFile();
          compararTexto(await f.text(), f.name);
          return;
        } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      $('#fileComparar').click();
    },
    guardar() { salirDeEnsayo(() => guardarArchivo(false)); },
    guardarComo() { salirDeEnsayo(() => guardarArchivo(true)); },
    /* botones de la barra de estado: confirmar o deshacer lo que se está probando */
    guardarCambios() { guardarEnsayo(); },
    descartarCambios() {
      if (!ensayo) return;
      const et = ETIQUETA_ENSAYO[ensayo.clave] || ensayo.clave;
      modal('Descartar cambios', `<p>Se deshace todo lo que cambió en <b>${et}</b> desde la última
        vez que guardó.</p><p><b>¿Continuar?</b></p>`,
        [['Seguir editando', null, 'sec'], ['Descartar', () => descartarEnsayo(), 'rojo']]);
    },
    datosProyecto() {
      const P = M.proyecto();
      modal('Datos generales del proyecto', `<div class="form-g">
        <label>Nombre</label><input id="dNom" value="${esc(P.nombre)}">
        <label>Entidad</label><input id="dEnt" value="${esc(P.entidad || '')}">
        <label>Ubicación</label><input id="dUbi" value="${esc(P.ubicacion || '')}">
        <label>Fecha</label><input id="dFec" type="date" value="${P.fecha}">
        <label>Inicio de obra</label><input id="dIni" type="date" value="${P.inicioObra || ''}">
        <label>Plazo (días)</label><input id="dPla" type="number" value="${P.plazo}"></div>`,
        [['Cancelar', null, 'sec'], ['Guardar', () => {
          P.nombre = $('#dNom').value.trim() || 'Sin nombre'; P.entidad = $('#dEnt').value.trim();
          recordarEntidad(P.entidad);
          P.ubicacion = $('#dUbi').value; P.fecha = $('#dFec').value;
          P.inicioObra = $('#dIni').value; P.plazo = Number($('#dPla').value) || 180;
          aplicar(); render();
        }]]);
    },
    borrarTodo() {
      modal('Borrar todo', '<p>Se eliminará el proyecto actual de este navegador. Los archivos .boq que haya guardado no se tocan.</p><p><b>¿Continuar?</b></p>',
        [['Cancelar', null, 'sec'], ['Sí, borrar', () => {
          localStorage.removeItem('openboq_proyecto');
          M.proyectoNuevo('Sin nombre'); render(); marcarGuardado('Proyecto vacío');
        }, 'rojo']]);
    },
    exportarXls() { REP.excelLibro(); },
    exportarXlsSel() {
      const H = REP.nombresHojas();
      modal('Exportar a Excel — elegir reportes',
        '<p class="mini">Cada reporte se guarda como una hoja del libro, con sus columnas y su cabecera de proyecto.</p>' +
        '<div style="columns:2;font-size:12px">' + H.map((h, k) =>
          `<label style="display:block;padding:2px 0"><input type="checkbox" data-hoja="${k}" checked> ${esc(h)}</label>`).join('') +
        '</div>',
        [['Ninguno', () => { $$('#modalCuerpo input[data-hoja]').forEach(c => c.checked = false); return false; }, 'sec'],
        ['Cancelar', null, 'sec'],
        ['Exportar', () => {
          const sel = [];
          $$('#modalCuerpo input[data-hoja]').forEach(c => { if (c.checked) sel.push(H[+c.dataset.hoja]); });
          if (!sel.length) { alert('Marque al menos un reporte.'); return false; }
          REP.excelLibro(sel);
        }]]);
    },
    exportarCsvIns() { REP.csvInsumos(); },

    /* --- importación de archivos externos --- */
    importarDDP() {
      confirmarDescartar('Importar un proyecto .ddp', () => $('#fileDDP').click());
    },
    importarSueltos() {
      confirmarDescartar('Importar archivos sueltos', () => ACC.importarSueltosPaso2());
    },
    importarSueltosPaso2() {
      modal('Importar archivos sueltos', `
        <p>Seleccione juntos los archivos del proyecto que están en la carpeta
        <code>\\proyectos</code> o <code>\\temporal</code>:</p>
        <ul style="font-size:12px"><li><b>.PRE</b> — presupuesto (obligatorio)</li>
        <li><b>.IND</b> — índice de insumos (obligatorio)</li>
        <li><b>.DAT</b> — precios y rendimientos (obligatorio)</li>
        <li><b>.CFG .MOD .STT</b> — recargos, módulos y datos del proyecto (opcionales)</li></ul>
        <p class="mini">Los archivos solo se leen; nunca se modifican.</p>`,
        [['Cancelar', null, 'sec'], ['Elegir archivos…', () => $('#fileSueltos').click()]]);
    },

    /* --- vuelta a PRESCOM ---------------------------------------------
       El proyecto se escribe en los mismos archivos binarios de los que
       salió. Se revisa antes: si algún análisis pasa de lo que el formato
       admite (30 materiales, 10 de mano de obra, 20 de equipo) no se
       exporta, porque PRESCOM leería el ítem incompleto sin decir nada. */
    exportarPrescom() {
      let r;
      try { r = EXPORTADOR.archivos(); }
      catch (e) { alert('No se pudo preparar la exportación:\n' + e.message); return; }
      const s = r.resumen;
      if (r.errores.length) {
        modal('Exportar a PRESCOM', `
          <p>El proyecto no entra en el formato de PRESCOM tal como está:</p>
          <ul style="font-size:12px;color:var(--err)">${r.errores.map(e => '<li>' + esc(e) + '</li>').join('')}</ul>
          <p class="mini">Un análisis de PRESCOM admite hasta 30 materiales, 10 renglones de mano de
          obra y 20 de equipo. Divida el ítem o junte insumos repetidos
          (<b>HERRAMIENTAS → Depurar insumos repetidos</b>) y vuelva a intentarlo.</p>`);
        return;
      }
      const P = M.proyecto();
      const arch = (P.prescom && P.prescom.base) || EXPORTADOR.nombreSugerido(P.nombre);
      /* El .ddp tiene diecisiete renglones fijos para la cadena de recargos: los
         del DS 0181 y nada más. Una cadena propia no entra ahí, y callarlo
         sería entregar a PRESCOM un archivo que calcula distinto del que se ve
         en pantalla. Se avisa antes, con el número de la diferencia. */
      const avisoFormato = M.formatoEsOficial() ? '' : `
        <div class="aviso-caja"><b>Este proyecto no usa el formato oficial.</b>
        <p class="mini" style="margin:4px 0 0">La cadena <b>${esc(M.formato().n)}</b> no cabe en un
        <code>.ddp</code>: PRESCOM guarda solo los seis recargos del DS 0181. El archivo se escribe
        con esos seis y con los precios unitarios que calculó OpenBOQ, así que el presupuesto
        cierra igual; pero si en PRESCOM se recalcula un análisis, el resultado va a diferir.</p></div>`;
      modal('Exportar a PRESCOM — Guardar como', `
        ${avisoFormato}
        <p>Se arma un contenedor <code>.ddp</code> con el presupuesto, los análisis, los insumos,
        los módulos y los recargos del proyecto.</p>
        <table class="rej" style="margin-bottom:10px"><tbody>
          <tr><td>Módulos / ítems / insumos</td><td>${s.modulos} / ${s.items} / ${s.insumos}</td></tr>
          <tr><td>Total del presupuesto</td><td class="num"><b>${M.fmt(s.total, 2)} Bs</b></td></tr>
          <tr><td>Archivos del original</td><td>${s.conPlantilla
          ? 'se conservan (membrete, formatos y rótulos de <b>' + esc(s.origen || 'el .ddp importado') + '</b>)'
          : 'no hay: se escriben los de fábrica'}</td></tr>
        </tbody></table>
        ${r.avisos.length ? '<ul style="font-size:11px;color:var(--aviso);padding-left:16px">' +
          r.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>' : ''}
        <div class="form-g"><label>Guardar como (nombre del archivo)</label>
          <input id="expNom" value="${esc(arch)}" maxlength="60">
          <span class="mini">Se guarda como <b id="expVista">${esc(arch)}.ddp</b> y ese mismo nombre
          llevan los trece archivos de adentro.</span></div>
        <p class="mini"><b>No le cambie el nombre desde Windows.</b> PRESCOM descomprime el
        <code>.ddp</code> y después busca los archivos por el nombre del archivo: si se renombra
        afuera, adentro sigue el nombre viejo y deja de reconocer el proyecto. Para cambiarle el
        nombre, vuelva a exportarlo desde acá con el nombre nuevo.</p>
        <p class="mini">Se abre en PRESCOM con <b>Archivo → Abrir proyecto</b> y el archivo
        <code>.ddp</code>. El cronograma, los cómputos métricos y los códigos de ítem son de OpenBOQ
        y no tienen dónde guardarse en PRESCOM: consérvelos en el <code>.boq</code>.</p>`,
        [['Cancelar', null, 'sec'],
        ['Guardar como…', () => {
          const n = ($('#expNom').value || arch).trim();
          cerrarModal();
          bajarPrescom(n);
        }]]);
      const cajaNom = $('#expNom');
      if (cajaNom) cajaNom.addEventListener('input', () => {
        $('#expVista').textContent = EXPORTADOR.nombreInterno(cajaNom.value) + '.ddp';
      });
    },

    /* --- edición --- */
    nuevoItem() {
      const P = M.proyecto();
      modal('Nuevo ítem', `<div class="form-g">
        <label>Descripción de la actividad</label><input id="niD" placeholder="Ej.: HORMIGÓN SIMPLE TIPO A">
        <label>Unidad</label>${comboUnidad('niU', 'm³')}
        <label>Cantidad</label><input id="niC" type="number" step="any" value="1">
        <label>Módulo</label><select id="niM">${P.modulos.map((m, k) =>
        `<option value="${k}" ${k === P.moduloActivo ? 'selected' : ''}>${esc(m.n)}</option>`).join('')}</select>
        </div>
        <div id="niAviso"></div>
        <p class="mini">Escriba <b>qué se hace</b>, no dónde: «Muro de ladrillo 6H», no
        «Muro de ladrillo U.E. Gualberto Villarroel». Así el ítem sirve en cualquier
        presupuesto.</p>
        <p class="mini">Al crearlo se abre su <b>análisis de precios unitarios</b> para cargar
        materiales, mano de obra y equipo desde la Base de Datos.</p>`,
        [['Cancelar', null, 'sec'], ['Crear y analizar', () => {
          const d = $('#niD').value.trim();
          if (!d) { $('#niD').focus(); return false; }
          /* El aviso no frena: puede ser un material con nombre de lugar
             («piedra Tarija»). El bloqueo sí. */
          const rev = M.revisarDescripcion(d);
          if (rev.nivel === 'bloqueo') { mostrarRevision('niD', 'niAviso', rev); return false; }
          /* El ítem nuevo entra como ensayo y se abre su análisis. La clave es
             'analisis' —no 'presupuesto'— porque es ahí donde se sigue
             trabajando: así lo que se cargue en el B-2 a continuación queda
             dentro del mismo ensayo y se guarda todo junto. */
          probando('analisis');
          P.moduloActivo = Number($('#niM').value) || 0;
          const it = M.addItem({ desc: d, und: unidadDe('niU') || 'glb', cant: Number($('#niC').value) || 1 });
          P.itemSel = it.id;
          render();
          $('#selItemAnalisis').value = it.id;
          irVista('analisis'); renderAnalisis();
        }]]);
      conectarUnidad('niU');
      revisarMientrasEscribe('niD', 'niAviso');
      setTimeout(() => { const i = $('#niD'); if (i) i.focus(); }, 60);
    },
    delItem() {
      const id = M.proyecto().itemSel;
      if (!id) return alert('Seleccione un ítem en el presupuesto.');
      const it = M.getItem(id);
      modal('Eliminar ítem', '<p>¿Eliminar <b>' + esc(it.desc) + '</b> del presupuesto?</p>',
        [['Cancelar', null, 'sec'], ['Eliminar', () => { probando('presupuesto'); M.delItem(id); render(); }, 'rojo']]);
    },
    dupItem() { const id = M.proyecto().itemSel; if (id) { probando('presupuesto'); M.duplicarItem(id); render(); } },
    subirItem() { const id = M.proyecto().itemSel; if (id) { probando('presupuesto'); M.moverItem(id, -1); render(); } },
    bajarItem() { const id = M.proyecto().itemSel; if (id) { probando('presupuesto'); M.moverItem(id, 1); render(); } },
    nuevoModulo() {
      modal('Nuevo módulo', '<div class="form-g"><label>Nombre del módulo</label><input id="mM" value="MÓDULO # ' + (M.proyecto().modulos.length + 1) + '"></div>',
        [['Cancelar', null, 'sec'], ['Crear', () => {
          const P = M.proyecto();
          probando('presupuesto');
          P.modulos.push({ id: M.nid(), n: $('#mM').value.trim() || 'MÓDULO', items: [] });
          P.moduloActivo = P.modulos.length - 1; render();
        }]]);
    },
    renModulo() {
      const m = M.modulo();
      modal('Renombrar módulo', '<div class="form-g"><label>Nombre</label><input id="mR" value="' + esc(m.n) + '"></div>',
        [['Cancelar', null, 'sec'], ['Guardar', () => { probando('presupuesto'); m.n = $('#mR').value.trim() || m.n; render(); }]]);
    },
    delModulo() {
      const P = M.proyecto();
      if (P.modulos.length < 2) return alert('El proyecto debe tener al menos un módulo.');
      const m = M.modulo();
      modal('Eliminar módulo', '<p>Se eliminará <b>' + esc(m.n) + '</b> con sus ' + m.items.length + ' ítem(s).</p>',
        [['Cancelar', null, 'sec'], ['Eliminar', () => {
          probando('presupuesto');
          P.modulos.splice(P.moduloActivo, 1); P.moduloActivo = 0; render();
        }, 'rojo']]);
    },

    /* --- base de datos --- */
    irBase() { irVista('base'); $('#buscaBase').focus(); },
    /**
     * Trae un análisis de la Base de Datos al presupuesto. Cantidades y precios
     * se pueden corregir acá: los cambios valen solo para este proyecto, salvo
     * que se marque «guardar también en la Base de Datos».
     */
    insertarApu() {
      if (!apuSel) return alert('Elija un ítem de la lista.');
      const pay = M.payloadApu(apuSel.base, apuSel.apu);   // copia editable
      const dOrigen = pay.d;
      const nom = { M: '1. MATERIALES', O: '2. MANO DE OBRA', E: '3. EQUIPO, MAQUINARIA Y HERRAMIENTAS' };

      modal('Traer ítem al presupuesto', `
        <div class="form-g">
          <label>Descripción</label><input id="iDesc" value="${esc(pay.d)}">
          <label>Unidad</label>${comboUnidad('iUnd', pay.u)}
          <label>Cantidad</label><input id="iCant" type="number" step="any" value="1">
          <label>Módulo destino</label><select id="iMod">${M.proyecto().modulos.map((m, k) =>
        `<option value="${k}" ${k === M.proyecto().moduloActivo ? 'selected' : ''}>${esc(m.n)}</option>`).join('')}</select>
        </div>
        <p class="mini">Corrija acá las cantidades y los precios que haga falta: valen para este
        presupuesto y para el archivo que guarde. La Base de Datos no se toca.</p>
        <div id="iConf"></div>
        <div style="max-height:250px;overflow:auto;border:1px solid var(--gris-borde);margin-top:6px">
          <table class="rej" id="tApu"></table></div>
        <div class="res" style="margin-top:8px">
          <div class="fila sub"><span>COSTO DIRECTO (Bs)</span><span class="val" id="iCD">0,00</span></div>
          <div class="fila tot"><span>PRECIO UNITARIO con recargos (Bs)</span><span class="val" id="iPU">0,00</span></div>
        </div>
        <label style="display:block;margin-top:10px"><input type="checkbox" id="iGuardar">
          <b>Guardar también estos cambios en la Base de Datos</b></label>
        <div id="iModo" style="display:none;padding:4px 0 0 20px;font-size:12px">
          <label style="display:block"><input type="radio" name="iModoR" value="actualizar" checked>
            Actualizar el análisis <b id="iModoNom">${esc(dOrigen)}</b> — cambia los costos de sus
            insumos, mano de obra y maquinaria en la Base de Datos</label>
          <label style="display:block"><input type="radio" name="iModoR" value="nuevo">
            Guardarlo como ítem nuevo en
            <select id="iBaseDest" style="max-width:230px">
              ${M.basesPropias().map(b => `<option value="${b.id}">${esc(b.n)}</option>`).join('')}
              <option value="">— crear una base nueva —</option>
            </select></label>
          <p class="mini" style="margin:4px 0 0">Se guarda en este equipo (navegador). El archivo
          original de la Base de Datos no se modifica; con
          <b>HERRAMIENTAS → Mis cambios en la Base de Datos</b> se pueden deshacer.</p>
        </div>`,
        [['Cancelar', null, 'sec'], ['Traer al presupuesto', () => {
          const datos = leer();
          if (!datos.d) { $('#iDesc').focus(); return false; }
          const P = M.proyecto();
          /* Traer un ítem de la Base de Datos agrega ítem e insumos al
             proyecto: es un cambio y entra como ensayo. Lo que se guarda en la
             base propia (más abajo) NO es parte del ensayo: vive fuera del
             proyecto y descartar no lo toca. */
          probando('presupuesto');
          P.moduloActivo = Number($('#iMod').value) || 0;
          /* «actualizar»: los insumos que ya estaban en el proyecto se quedan con
             el precio nuevo, así no aparece el mismo insumo dos veces */
          if (modoConf() === 'nuevos')
            M.conflictosInsumos(datos.c).forEach(x => { M.fijarPrecio(x.ins, x.c.p); });
          M.importarApuEditado(Object.assign({ cant: Number($('#iCant').value) || 1 }, datos));
          if ($('#iGuardar').checked) {
            const r = $$('#iModo input[name="iModoR"]').find(x => x.checked);
            const sel = $('#iBaseDest');
            /* «— crear una base nueva —»: se arma con el nombre del análisis */
            const dest = (sel && sel.value) ? Number(sel.value)
              : (r && r.value === 'nuevo' ? M.crearBasePropia('MIS ANÁLISIS').id : 0);
            M.guardarEnBD(datos, r ? r.value : 'nuevo', apuSel.base, apuSel.apu, dest);
            llenarBases(); buscarBase();
          }
          render(); irVista('presupuesto');
        }]]);

      const leer = () => ({
        cod: pay.cod, d: $('#iDesc').value.trim(), u: unidadDe('iUnd'),
        c: pay.c.map(c => Object.assign({}, c))
      });

      /* ---- insumos que el proyecto ya tiene a otro precio ----
         Sin esto el presupuesto termina con dos insumos de nombre casi igual y
         precio distinto, y el B-3 queda duplicado. Se ofrece unificar en el
         momento de traer el ítem. */
      /* Precio que se quiere traer para cada línea: el de la Base de Datos, o el
         que el usuario escriba en la tabla. Es la referencia para detectar los
         conflictos, porque `pay.c[k].p` cambia al unificar. */
      const precioBase = pay.c.map(c => c.p);
      const modoConf = () => {
        const c = $('#iConf');
        return (c && c.dataset.modo) || 'proyecto';
      };
      /** Líneas cuyo insumo ya está en el proyecto a otro precio. */
      function conflictos() {
        const out = [];
        pay.c.forEach((c, k) => {
          const ex = M.buscarInsumo(c.t, c.d, c.u);
          if (!ex) return;
          if (Math.abs(precioBase[k] - ex.p) < 0.005) return;
          out.push({ c, k, ins: ex, pBase: precioBase[k] });
        });
        return out.sort((a, b) => M.cmpIns(a.ins, b.ins));
      }
      function panelConflictos() {
        const conf = conflictos();
        const cont = $('#iConf'); if (!cont) return;
        if (!conf.length) { cont.innerHTML = ''; return; }
        const modo = cont.dataset.modo || 'proyecto';
        cont.innerHTML = `<div class="panel" style="background:var(--aviso-fondo);border:1px solid var(--aviso-borde);
          margin-top:8px;padding:8px 10px">
          <b style="color:var(--aviso)">${conf.length} insumo(s) ya están en el proyecto a otro precio.</b>
          <p class="mini" style="margin:4px 0">Si no se unifican, el presupuesto queda con dos insumos
          de nombre igual y precio distinto.</p>
          <label style="display:block"><input type="radio" name="iConfR" value="proyecto"
            ${modo === 'proyecto' ? 'checked' : ''}> <b>Usar los precios del proyecto</b> — el ítem nuevo
            adopta los precios que ya tiene esta obra (recomendado)</label>
          <label style="display:block"><input type="radio" name="iConfR" value="nuevos"
            ${modo === 'nuevos' ? 'checked' : ''}> <b>Actualizar el proyecto con los precios nuevos</b> —
            cambia el precio en todos los ítems que ya usan ese insumo</label>
          <label style="display:block"><input type="radio" name="iConfR" value="ambos"
            ${modo === 'ambos' ? 'checked' : ''}> Dejar los dos por separado (queda duplicado)</label>
          <div style="max-height:150px;overflow:auto;margin-top:6px">
          <table class="rej"><thead><tr><th>INSUMO</th><th style="width:52px">UND.</th>
            <th style="width:90px">EN EL PROYECTO</th><th style="width:90px">EN LA BASE</th>
            <th style="width:56px">USOS</th></tr></thead><tbody>` +
          conf.map(x => `<tr><td>${esc(x.ins.d)}</td><td class="ctr">${esc(x.ins.u)}</td>
            <td class="num">${M.fmt(x.ins.p, 2)}</td>
            <td class="num" style="color:${x.pBase > x.ins.p ? 'var(--err)' : 'var(--ok)'}">${M.fmt(x.pBase, 2)}</td>
            <td class="num">${M.usoInsumo(x.ins.id).length}</td></tr>`).join('') +
          '</tbody></table></div></div>';
      }
      /**
       * Deja en la tabla los precios que corresponden al modo elegido.
       * @param {string} [modo] 'proyecto' (unifica con los del proyecto),
       *                        'nuevos' o 'ambos' (deja los de la Base de Datos)
       */
      function aplicarModoConflicto(modo) {
        const cont = $('#iConf');
        cont.dataset.modo = modo || modoConf();
        pay.c.forEach((c, k) => { c.p = precioBase[k]; });        // se parte de los de la base
        if (cont.dataset.modo === 'proyecto')
          conflictos().forEach(x => { x.c.p = x.ins.p; });
        tabla();
      }

      function tabla() {
        let h = `<thead><tr><th style="width:30px">N°</th><th>DESCRIPCIÓN</th>
          <th style="width:56px">UND.</th><th style="width:92px">CANTIDAD</th>
          <th style="width:92px">P. UNIT.</th><th style="width:100px">PARCIAL</th>
          <th style="width:28px"></th></tr></thead><tbody>`;
        ['M', 'O', 'E'].forEach(t => {
          const L = pay.c.map((c, k) => ({ c, k })).filter(x => x.c.t === t);
          h += `<tr class="grupo"><td colspan="7">${nom[t]}</td></tr>`;
          if (!L.length) h += '<tr><td colspan="7" class="mini" style="padding-left:14px">(sin insumos)</td></tr>';
          L.forEach((x, n) => {
            h += `<tr><td class="ctr">${n + 1}</td><td>${esc(x.c.d)}</td><td class="ctr">${esc(x.c.u)}</td>
              <td><input type="number" step="any" data-q="${x.k}" value="${x.c.q}"></td>
              <td><input type="number" step="any" data-p="${x.k}" value="${x.c.p}"></td>
              <td class="num parcial">${M.fmt(x.c.q * x.c.p, 2)}</td>
              <td class="ctr"><button class="b-del" data-quita="${x.k}" title="Quitar del análisis">✕</button></td></tr>`;
          });
        });
        $('#tApu').innerHTML = h + '</tbody>';
        totales();
        panelConflictos();
      }

      function totales() {
        let m = 0, o = 0, e = 0;
        pay.c.forEach(c => {
          const v = (Number(c.q) || 0) * (Number(c.p) || 0);
          if (c.t === 'O') o += v; else if (c.t === 'E') e += v; else m += v;
        });
        $('#iCD').textContent = M.fmt(m + o + e, 2);
        $('#iPU').textContent = M.fmt(M.cadenaRecargos(m, o, e).pu, 2);
      }

      /* Solo tiene sentido «actualizar» si sigue siendo el mismo análisis. */
      function revisarModo() {
        const igual = M.norm($('#iDesc').value.trim()) === M.norm(dOrigen);
        const ra = $('#iModo input[value="actualizar"]');
        ra.disabled = !igual;
        if (!igual) $('#iModo input[value="nuevo"]').checked = true;
        $('#iModoNom').textContent = igual ? dOrigen : dOrigen + ' (cambió el nombre)';
      }

      $('#tApu').addEventListener('input', ev => {
        const t = ev.target;
        const k = t.dataset.q !== undefined ? t.dataset.q : t.dataset.p;
        if (k === undefined) return;
        const c = pay.c[+k]; if (!c) return;
        if (t.dataset.q !== undefined) c.q = Number(t.value) || 0;
        else { c.p = Number(t.value) || 0; precioBase[+k] = c.p; }   // el precio escrito manda
        const cel = t.closest('tr').querySelector('.parcial');
        if (cel) cel.textContent = M.fmt(c.q * c.p, 2);
        totales();
        panelConflictos();
      });
      $('#tApu').addEventListener('click', ev => {
        const b = ev.target.closest('[data-quita]'); if (!b) return;
        pay.c.splice(+b.dataset.quita, 1);
        precioBase.splice(+b.dataset.quita, 1);
        tabla();
      });
      $('#iDesc').addEventListener('input', revisarModo);
      $('#iGuardar').addEventListener('change', e => {
        $('#iModo').style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) revisarModo();
      });
      $('#iConf').addEventListener('change', e => {
        if (e.target.name === 'iConfR') aplicarModoConflicto(e.target.value);
      });
      conectarUnidad('iUnd');
      aplicarModoConflicto('proyecto');   // arranca unificando con los precios del proyecto
    },
    /**
     * Une los insumos que quedaron cargados dos veces (mismo tipo y descripción,
     * distinto precio o unidad). Todos los análisis pasan a apuntar al que se
     * conserve y el resto se elimina.
     */
    depurarInsumos() {
      const G = M.duplicadosInsumo();
      if (!G.length)
        return modal('Depurar insumos repetidos',
          '<p style="color:var(--ok)"><b>No hay insumos repetidos.</b> Cada material, especialidad y equipo ' +
          'aparece una sola vez en el proyecto.</p>');
      const nom = { M: 'MATERIAL', O: 'MANO DE OBRA', E: 'EQUIPO' };
      const total = G.reduce((s, g) => s + g.ins.length - 1, 0);
      let h = `<p><b>${G.length}</b> insumo(s) están cargados más de una vez —
        ${total} sobran—. Marque cuál se conserva: su precio y su unidad son los que quedan en todo
        el proyecto.</p>
        <div style="max-height:360px;overflow:auto"><table class="rej"><thead><tr>
          <th style="width:34px"></th><th style="width:44px">SE QUEDA</th><th>INSUMO</th>
          <th style="width:52px">UND.</th><th style="width:88px">PRECIO</th>
          <th style="width:52px">USOS</th><th style="width:100px">MONTO OBRA</th>
        </tr></thead><tbody>`;
      G.forEach((g, k) => {
        /* se propone conservar el más usado; a igualdad de usos, el más caro */
        const mejor = g.ins.slice().sort((a, b) => b.usos - a.usos || b.ins.p - a.ins.p)[0];
        h += `<tr class="grupo"><td class="ctr"><input type="checkbox" data-gr="${k}" checked></td>
          <td colspan="6"><span class="badge ${g.t}">${nom[g.t]}</span> ${esc(g.d)}
          — ${g.ins.length} versiones</td></tr>`;
        g.ins.forEach(x => {
          h += `<tr><td></td>
            <td class="ctr"><input type="radio" name="dup${k}" value="${x.ins.id}"
              ${x === mejor ? 'checked' : ''}></td>
            <td>${esc(x.ins.d)}</td><td class="ctr">${esc(x.ins.u)}</td>
            <td class="num">${M.fmt(x.ins.p, 2)}</td><td class="num">${x.usos}</td>
            <td class="num">${M.fmt(M.conv(x.monto))}</td></tr>`;
        });
      });
      h += `</tbody></table></div>
        <p class="mini">Si un ítem usaba las dos versiones del mismo insumo, los rendimientos se suman
        en una sola línea. El precio unitario de esos ítems cambia: revíselos después.</p>`;
      modal('Depurar insumos repetidos', h,
        [['Cancelar', null, 'sec'], ['Unificar los marcados', () => {
          let grupos = 0, quitados = 0, items = 0;
          probando('insumos');
          G.forEach((g, k) => {
            const ch = $(`#modalCuerpo input[data-gr="${k}"]`);
            if (!ch || !ch.checked) return;
            const r = $$(`#modalCuerpo input[name="dup${k}"]`).find(x => x.checked);
            if (!r) return;
            const res = M.fusionarInsumos(r.value, g.ins.map(x => x.ins.id));
            grupos++; quitados += res.quitados; items += res.items;
          });
          if (!grupos) { alert('No marcó ningún grupo.'); return false; }
          render(); irVista('insumos');
          setTimeout(() => modal('Insumos unificados', `<p><b>${grupos}</b> insumo(s) quedaron en una
            sola línea: se quitaron <b>${quitados}</b> repetidos y se corrigieron
            <b>${items}</b> análisis.</p>
            <p>Total del presupuesto: <b>${M.fmt(M.conv(M.totalGeneral()))} ${M.proyecto().moneda}</b>.</p>`), 80);
        }]]);
    },
    /** Qué guardó el usuario en la Base de Datos de este equipo, y cómo deshacerlo. */
    misCambiosBD() {
      const r = M.resumenBDU();
      const hay = r.propios || r.cambios;
      modal('Mis cambios en la Base de Datos', hay
        ? `<p>Guardados en este equipo:</p><ul style="font-size:12px">
             <li><b>${r.propios}</b> análisis propios repartidos en <b>${r.bases}</b> base(s) suyas</li>
             <li><b>${r.cambios}</b> análisis de las bases originales con costos actualizados</li>
           </ul>
           <p class="mini">El archivo original de la Base de Datos nunca se modificó: estos cambios se
           vuelven a aplicar cada vez que se abre OpenBOQ en este equipo.</p>`
        : '<p>Todavía no guardó ningún cambio: la Base de Datos está tal como vino en el archivo.</p>',
        hay
          ? [['Cerrar', null, 'sec'], ['Descartar todos mis cambios', () => {
            M.limpiarBDU(); llenarBases(); buscarBase(); render();
            setTimeout(() => alert('La Base de Datos quedó como el archivo original.'), 80);
          }, 'rojo']]
          : null);
    },

    /* --- insumos --- */
    nuevoInsumo() {
      modal('Nuevo insumo', `<div class="form-g">
        <label>Tipo</label><select id="nT"><option value="M">Material</option>
          <option value="O">Mano de obra</option><option value="E">Equipo / maquinaria</option></select>
        <label>Descripción</label><input id="nD">
        <label>Unidad</label><input id="nU" list="lUnidades" value="pza">
        <label>Precio (Bs)</label><input id="nP" type="number" step="any" value="0"></div>`,
        [['Cancelar', null, 'sec'], ['Crear', () => {
          const d = $('#nD').value.trim(); if (!d) return false;
          probando('insumos');
          /* insumo cargado a mano: el precio lo puso el usuario hoy, y se fecheó */
          M.agregarInsumo($('#nT').value, d, $('#nU').value, Number($('#nP').value), false, true);
          /* Recién creado no lo usa ningún análisis, así que la rejilla lo
             ocultaría justo después de crearlo. Se destapan los que no se usan
             para que el usuario vea el que acaba de cargar. */
          if ($('#verSinUso')) $('#verSinUso').checked = true;
          render(); irVista('insumos');
        }]]);
    },
    /**
     * Renombrar un insumo cambia cómo se llama en TODOS los análisis que lo usan,
     * así que se hace desde el detalle de usos —donde se ve a cuáles afecta— y no
     * escribiendo sobre la rejilla del B-3.
     * @param {string} id insumo
     */
    renombrarInsumo(id) {
      const ins = M.proyecto().insumos[id]; if (!ins) return;
      const n = M.usoInsumo(id).length;
      modal('Renombrar insumo', `
        <p class="mini">Cambia cómo se llama en <b>${n}</b> ítem(s), en el B-3 y en los reportes.
          No toca precios ni rendimientos.</p>
        <div class="form-g">
          <label>Descripción</label><input id="riD" value="${esc(ins.d)}">
          <label>Unidad</label><input id="riU" list="lUnidades" value="${esc(ins.u)}"></div>
        <p class="mini">Si al cambiarlo queda igual a otro insumo del proyecto, únalos con
          <b>🔗 Depurar repetidos</b>.</p>`,
        [['Cancelar', null, 'sec'], ['Renombrar', () => {
          const d = $('#riD').value.trim(); if (!d) return false;
          probando('insumos');
          ins.d = d; ins.u = $('#riU').value.trim() || ins.u;
          render();
        }]]);
    },
    /**
     * Agrega un insumo al análisis del ítem activo. Busca en dos lugares a la vez:
     * los insumos que ya tiene el proyecto y los 10.000+ de la Base de Datos. Si el insumo
     * no existe en ninguno, los campos de abajo quedan editables y se crea uno nuevo.
     * @param {string} tipoIni pestaña inicial: 'M' materiales, 'O' mano de obra, 'E' equipo
     */
    addInsumo(tipoIni) {
      const it = M.getItem($('#selItemAnalisis').value);
      if (!it) return alert('Primero seleccione un ítem.');
      let tipo = (tipoIni === 'M' || tipoIni === 'O' || tipoIni === 'E') ? tipoIni : 'M';
      const nomTab = { M: '1. MATERIALES', O: '2. MANO DE OBRA', E: '3. EQUIPO Y MAQUINARIA' };
      const nomCorto = { M: 'MAT', O: 'M.O.', E: 'EQU' };
      const hayCat = M.BD.bases.length > 0;

      modal('Agregar insumo al análisis', `
        <div class="tabs" id="tIns" style="margin:-4px -4px 8px">
          ${['M', 'O', 'E'].map(t => `<button data-t="${t}" class="${t === tipo ? 'on' : ''}">${nomTab[t]}</button>`).join('')}
        </div>
        <div class="bar" style="padding:0 0 8px">
          <input type="search" id="bIns" placeholder="Buscar por descripción…" style="flex:1">
          <select id="bBase" style="max-width:230px" ${hayCat ? '' : 'disabled'}>
            <option value="">Toda la Base de Datos</option>
            ${M.BD.bases.map(b => `<option value="${b.id}">${esc(b.n)}</option>`).join('')}
          </select>
        </div>
        <div style="max-height:270px;overflow:auto;border:1px solid var(--gris-borde)"><ul class="lista" id="lIns"></ul></div>
        <div class="form-g" style="margin-top:10px">
          <label>Descripción</label><input id="aDesc" placeholder="Elija uno de la lista o escriba uno nuevo">
          <label>Unidad</label><input id="aUnd" list="lUnidades" value="pza">
          <label>Precio unitario (Bs)</label><input id="aPrecio" type="number" step="any" value="0">
          <label>Rendimiento / cantidad</label><input id="aRend" type="number" step="any" value="1">
        </div>
        <div id="aAviso"></div>
        <p class="mini">Los resultados de la Base de Datos se pueden editar antes de agregarlos: cambiar el
        precio acá no altera la Base de Datos, solo el insumo del proyecto.</p>`,
        [['Cancelar', null, 'sec'], ['Agregar al análisis', () => {
          const d = $('#aDesc').value.trim();
          if (!d) { alert('Elija un insumo de la lista o escriba una descripción para crearlo.'); return false; }
          const u = $('#aUnd').value.trim() || 'pza';
          const p = Number($('#aPrecio').value) || 0;
          const ex = M.buscarInsumo(tipo, d, u);            // mismo tipo, descripción y unidad
          const actualizar = $('#aActualizar') && $('#aActualizar').checked;
          /* Agregar un material, un albañil o un equipo al análisis es un
             cambio como cualquier otro: entra como ensayo y espera el
             «✔ Guardar cambios». Antes se guardaba solo, sin dar opción. */
          probando('analisis');
          let ins;
          if (ex && actualizar) { M.fijarPrecio(ex, p); ins = ex; }  // se corrige el precio del que ya estaba
          else ins = M.agregarInsumo(tipo, d, u, p, true, true);   // reutiliza si coincide también el precio
          if (it.comp.some(c => c.ins === ins.id)) {
            alert('Ese insumo ya está en el análisis. Cambie su rendimiento en la tabla.');
            return false;
          }
          it.comp.push({ ins: ins.id, rend: Number($('#aRend').value) || 0 });
          render();
        }]]);

      /* --- lista de resultados: primero el proyecto, después la Base de Datos --- */
      function pintar() {
        const q = $('#bIns').value.trim();
        const base = $('#bBase').value;
        const propios = M.insumosOrdenados().filter(x => x.t === tipo &&
          (!q || M.norm(x.d + ' ' + x.u).indexOf(M.norm(q)) >= 0));
        const delCat = hayCat ? M.buscarInsumosEnBase(q, tipo, base, 250) : [];
        let h = '';
        if (propios.length) {
          h += '<li class="mini" style="background:var(--papel-2);cursor:default"><b>EN ESTE PROYECTO</b></li>';
          h += propios.map(x => `<li data-d="${esc(x.d)}" data-u="${esc(x.u)}" data-p="${x.p}">
            <span class="badge ${x.t}">${nomCorto[x.t]}</span> ${esc(x.d)}
            <span class="pu">${M.fmt(x.p, 2)}</span><div class="mini">${esc(x.u)}</div></li>`).join('');
        }
        if (delCat.length) {
          h += '<li class="mini" style="background:var(--papel-2);cursor:default"><b>EN LA BASE DE DATOS</b> — ' +
            delCat.length + (delCat.length >= 250 ? '+ resultados (afine la búsqueda)' : ' resultado(s)') + '</li>';
          h += delCat.map(x => `<li data-d="${esc(x.ins.d)}" data-u="${esc(x.ins.u)}" data-p="${x.ins.p}">
            <span class="badge ${x.ins.t}">${nomCorto[x.ins.t]}</span> ${esc(x.ins.d)}
            <span class="pu">${M.fmt(x.ins.p, 2)}</span>
            <div class="mini">${esc(x.ins.u)} · ${esc(x.base.n)}</div></li>`).join('');
        }
        if (!h) h = `<li class="mini" style="cursor:default">Sin coincidencias${hayCat ? '' : ' (no hay Base de Datos cargada)'}.
          Escriba la descripción abajo y se creará un insumo nuevo.</li>`;
        $('#lIns').innerHTML = h;
      }

      /* Avisa si la descripción escrita ya existe en el proyecto a otro precio. */
      function revisarExistente() {
        const d = $('#aDesc').value.trim(), u = $('#aUnd').value.trim() || 'pza';
        const p = Number($('#aPrecio').value) || 0;
        const ex = d ? M.buscarInsumo(tipo, d, u) : null;
        if (!ex || Math.abs(ex.p - p) < 1e-6) { $('#aAviso').innerHTML = ''; return; }
        $('#aAviso').innerHTML = `<p class="mini" style="color:var(--err);margin-top:6px">
          Este insumo ya está en el proyecto a <b>${M.fmt(ex.p, 2)} Bs</b> y se usa en
          <b>${M.usoInsumo(ex.id).length}</b> análisis.
          <label style="display:block;margin-top:4px"><input type="checkbox" id="aActualizar" checked>
          Actualizar su precio a ${M.fmt(p, 2)} Bs en todo el proyecto</label>
          <span>Sin tildar, se crea un segundo insumo con el mismo nombre.</span></p>`;
      }

      $('#tIns').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        tipo = b.dataset.t;
        $$('#tIns button').forEach(x => x.classList.toggle('on', x === b));
        pintar(); revisarExistente();
      });
      $('#lIns').addEventListener('click', e => {
        const li = e.target.closest('li'); if (!li || !li.dataset.d) return;
        $$('#lIns li').forEach(x => x.classList.remove('sel')); li.classList.add('sel');
        $('#aDesc').value = li.dataset.d;
        $('#aUnd').value = li.dataset.u;
        $('#aPrecio').value = li.dataset.p;
        revisarExistente();
      });
      let tB;
      $('#bIns').addEventListener('input', () => { clearTimeout(tB); tB = setTimeout(pintar, 180); });
      $('#bBase').addEventListener('change', pintar);
      ['#aDesc', '#aUnd', '#aPrecio'].forEach(s => $(s).addEventListener('input', revisarExistente));
      pintar();
      setTimeout(() => { const i = $('#bIns'); if (i) i.focus(); }, 60);
    },

    /* --- cómputos --- */
    addComputo() {
      const it = M.getItem($('#selItemComputo').value);
      if (!it) return alert('Seleccione un ítem.');
      it.computos.push({ d: '', n: 1, l: '', a: '', h: '', ar: '', vo: '' });
      probando('computos'); renderComputos(); irVista('computos');
    },
    aplicarComputo() {
      const it = M.getItem($('#selItemComputo').value);
      if (!it) return;
      probando('computos');
      it.cant = M.totalComputos(it);
      render(); alert('Cantidad actualizada a ' + M.fmt(it.cant, 3) + ' ' + it.und);
    },

    /* --- recursos (trenes de trabajo) --- */
    nuevoTren() {
      const n = M.trenes().length + 1;
      modal('Nuevo tren de trabajo', `<div class="form-g">
        <label>Nombre</label><input id="ntN" value="TREN ${n}">
        <label>Recursos (%)</label><input id="ntR" type="number" step="25" min="1" value="100">
        </div>
        <p class="mini">100 % es una cuadrilla completa. Después asigne actividades a este tren en la
        tabla de abajo: las de trenes distintos se ejecutan en paralelo.</p>`,
        [['Cancelar', null, 'sec'], ['Crear', () => {
          M.nuevoTren($('#ntN').value.trim(), Number($('#ntR').value));
          aplicar(); render(); irCrono('recursos');
        }]]);
    },
    aplicarRecursos() {
      M.programar({ duracion: true });
      aplicar(); render(); irCrono('programacion');
    },
    ajustarRecursos() {
      const P = M.proyecto();
      const tope = P.crono.topeDias || 180;
      const cambios = M.ajustarRecursos(tope);
      M.programar({ duracion: true });
      aplicar(); render(); irCrono('recursos');
      modal('Ajuste de recursos', cambios.length
        ? `<p>Se subió el porcentaje de <b>${cambios.length}</b> actividad(es) para que ninguna pase
           de <b>${tope}</b> días:</p>
           <div style="max-height:300px;overflow:auto"><table class="rej"><thead><tr>
             <th>ACTIVIDAD</th><th style="width:80px">ANTES</th><th style="width:80px">AHORA</th>
             <th style="width:80px">DURACIÓN</th></tr></thead><tbody>` +
        cambios.map(c => `<tr><td>${esc(c.it.desc)}</td><td class="num">${M.fmt(c.antes, 0)} %</td>
             <td class="num">${M.fmt(c.rec, 0)} %</td><td class="num">${c.dias} d</td></tr>`).join('') +
        `</tbody></table></div>
           <p class="mini">Es solo un análisis inicial: cambie los porcentajes o reparta las
           actividades en más trenes según lo que se pueda hacer en obra.</p>`
        : `<p>Ninguna actividad pasa de <b>${tope}</b> días con los recursos actuales.</p>`);
    },

    /* --- cronograma --- */
    /**
     * Arma el cronograma general de toda la obra: calcula la duración de cada
     * actividad con las horas de mano de obra de su análisis y las encadena en
     * el orden del presupuesto, módulo tras módulo.
     */
    generarCrono() {
      const P = M.proyecto();
      const acts = M.actividades();
      if (!acts.length) return alert('Primero cargue ítems en el presupuesto.');
      const sinMO = acts.filter(a => !M.horasManoObra(a.it).mayor).length;
      const trenes = M.trenes();
      modal('Generar cronograma', `
        <p>Se arma <b>un solo cronograma para toda la obra</b>: cada módulo es una tarea resumen y sus
        ${acts.length} ítems son las actividades, en el orden del presupuesto.</p>
        <ul style="font-size:12px">
          <li>La duración sale de las <b>horas de mano de obra</b> de cada análisis: manda la
              especialidad que más horas necesita, repartida en jornadas de
              <b>${M.fmt(P.crono.jornada, 1)} h</b>, con el <b>% de recursos</b> de su tren y
              <b>${P.crono.diasSemana}</b> días trabajados por semana.</li>
          <li>Cada actividad queda como <b>sucesora de la anterior de su tren</b> (fin a comienzo);
              hay <b>${trenes.length}</b> tren(es) de trabajo, que avanzan en paralelo. Las que duran
              <b>un día</b> se programan <b>el mismo día en que termina la anterior</b> (predecesora
              «FC-1»), porque entran dentro de esa jornada. Después puede cambiar a mano duraciones y
              predecesoras.</li>
          ${sinMO ? `<li><b>${sinMO}</b> ítem(s) no tienen mano de obra en su análisis: quedan en 1 día.</li>` : ''}
        </ul>
        <label style="display:block;margin-top:6px"><input type="checkbox" id="gcHoy" checked>
          Empezar hoy (${M.fmtFecha(new Date())}); sin tildar se respeta el inicio de obra cargado</label>
        <label style="display:block"><input type="checkbox" id="gcTope" checked>
          Subir el % de recursos de las actividades que pasen de <b>${P.crono.topeDias}</b> días
          (análisis inicial; se cambia en RECURSOS)</label>
        <p class="mini">Se reemplazan las duraciones y las predecesoras que haya ahora.</p>`,
        [['Cancelar', null, 'sec'], ['Generar', () => {
          if ($('#gcHoy').checked) P.inicioObra = M.hoyISO();
          const ajustes = $('#gcTope').checked ? M.ajustarRecursos(P.crono.topeDias) : [];
          const r = M.programar({ duracion: true, encadenar: true });
          r.ajustes = ajustes.length;
          aplicar(); render(); irCrono('programacion');
          const fin = M.fechasDe(0, r.plazo).fin;
          setTimeout(() => modal('Cronograma generado', `
            <p><b>${r.tareas}</b> actividades programadas en <b>${r.plazo}</b> días calendario.</p>
            <p>Comienza el <b>${M.fmtFecha(M.fechaDia(0))}</b> y termina el <b>${M.fmtFecha(fin)}</b>.</p>
            ${r.ajustes ? `<p>A <b>${r.ajustes}</b> actividad(es) se les subió el % de recursos para que
              no pasaran de ${P.crono.topeDias} días. Revíselo en la pestaña <b>RECURSOS</b>.</p>` : ''}
            <p class="mini">Ajuste lo que haga falta en la columna DURACIÓN o PREDECESORAS: las fechas
            se recalculan solas.</p>`), 80);
        }]]);
    },
    recalcularCrono() {
      const r = M.programar();
      aplicar(); render(); irCrono('programacion');
      if (r.ciclo) alert('Hay predecesoras que se referencian entre sí (ciclo). Revise la columna PREDECESORAS.');
    },

    /* --- herramientas --- */
    autoCrono() { M.distribuirCronograma(); aplicar(); render(); irCrono('programacion'); },
    actualizarPrecios() {
      const bases = M.BD.bases;
      modal('Actualizar precios desde la Base de Datos', `<div class="form-g">
        <label>Base de referencia</label><select id="uB">${bases.map(b => `<option value="${b.id}">${esc(b.n)}</option>`).join('')}</select>
        <label>Solo si difieren más de</label><input id="uTol" type="number" step="any" value="0"> </div>
        <p class="mini">Compara por descripción y unidad. Muestra un informe antes de aplicar.</p>`,
        [['Cancelar', null, 'sec'], ['Comparar', () => {
          const b = bases.find(x => x.id === Number($('#uB').value));
          const tol = Number($('#uTol').value) || 0;
          const idx = {};
          b.ins.forEach(i => { idx[M.norm(i.d) + '|' + M.norm(i.u)] = i; });
          const cambios = [];
          Object.values(M.proyecto().insumos).forEach(x => {
            const s = idx[M.norm(x.d) + '|' + M.norm(x.u)];
            if (s && Math.abs(s.p - x.p) > tol) cambios.push({ x, nuevo: s.p });
          });
          setTimeout(() => mostrarCambiosPrecio(cambios, b), 60);
        }]]);
    },
    verificar() {
      const P = M.proyecto();
      const av = [];
      P.modulos.forEach(m => m.items.forEach(it => {
        if (!it.comp.length) av.push('El ítem «' + it.desc + '» no tiene insumos: su precio unitario es 0.');
        if (!(Number(it.cant) > 0)) av.push('El ítem «' + it.desc + '» tiene cantidad 0.');
        it.comp.forEach(c => {
          const i = P.insumos[c.ins];
          if (!i) av.push('El ítem «' + it.desc + '» referencia un insumo inexistente.');
          else if (!(i.p > 0)) av.push('El insumo «' + i.d + '» tiene precio 0.');
          if (!(Number(c.rend) > 0)) av.push('Rendimiento 0 en «' + it.desc + '».');
        });
      }));
      const sinUso = Object.values(P.insumos).filter(x => !M.usoInsumo(x.id).length).length;
      if (sinUso) av.push(sinUso + ' insumo(s) sin uso en ningún análisis.');
      const dup = M.duplicadosInsumo();
      if (dup.length) av.push(dup.length + ' insumo(s) cargados más de una vez con distinto precio o unidad ' +
        '(HERRAMIENTAS → Depurar insumos repetidos).');
      modal('Verificación del proyecto', av.length
        ? '<p><b>' + av.length + ' observación(es):</b></p><ul style="font-size:12px;padding-left:18px">' +
        [...new Set(av)].slice(0, 60).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
        : '<p style="color:var(--ok)"><b>Sin observaciones.</b> Todos los ítems tienen insumos, cantidades y precios válidos.</p>');
    },
    /* Moneda, tipo de cambio y decimales. Están en la cabecera, pero en el
       celular esa fila se oculta para no comerse la pantalla: acá se editan
       igual desde el menú CONFIGURACIÓN. */
    formatoNumeros() {
      const P = M.proyecto();
      modal('Moneda y decimales', `<div class="form-g">
        <label>Moneda</label><select id="fnMon">
          <option value="Bs" ${P.moneda === 'Bs' ? 'selected' : ''}>Bs (bolivianos)</option>
          <option value="$US" ${P.moneda === '$US' ? 'selected' : ''}>$US (dólares)</option></select>
        <label>Tipo de cambio Bs/$US</label><input id="fnTC" type="number" step="0.01" inputmode="decimal" value="${P.tc}">
        <label>Decimales de cálculo</label><select id="fnPre">
          ${[0, 1, 2, 3, 4].map(k => `<option value="${k}" ${k === P.precision ? 'selected' : ''}>${
        k ? '0.' + '0'.repeat(k) : '0'}</option>`).join('')}</select>
        </div>
        <p class="mini">Los decimales valen para el precio unitario y los totales. El tipo de cambio
        solo se usa cuando la moneda es $US.</p>`,
        [['Cancelar', null, 'sec'], ['Aplicar', () => {
          P.moneda = $('#fnMon').value;
          P.tc = Number($('#fnTC').value) || 6.96;
          P.precision = Number($('#fnPre').value) || 0;
          aplicar(); render();
        }]]);
    },
    /* Las incidencias son del proyecto: se editan en su pestaña, no en el B-2. */
    paramsGlobal() { irVista('incidencias'); },
    incidenciasDef() {
      if (!M.formatoEsOficial())
        return modal('Valores por defecto', `<p>Los valores por defecto son los del <b>formato
          oficial</b>. Este proyecto usa <b>${esc(M.formato().n)}</b>, que tiene sus propias filas.</p>
          <p class="mini">Para volver a los valores habituales, use <b>↺ Volver al formato oficial</b>
          en la pestaña INCIDENCIAS.</p>`);
      modal('Volver a los valores por defecto', `<p>Las incidencias vuelven a los valores habituales
        (cargas sociales ${M.fmt(M.PARAMS_DEF.cargas, 2)} %, IVA mano de obra ${M.fmt(M.PARAMS_DEF.ivaMO, 2)} %,
        herramientas ${M.fmt(M.PARAMS_DEF.herr, 2)} %, gastos generales ${M.fmt(M.PARAMS_DEF.gg, 2)} %,
        utilidad ${M.fmt(M.PARAMS_DEF.util, 2)} %, IT ${M.fmt(M.PARAMS_DEF.it, 2)} %) y se recalcula
        todo el presupuesto.</p>`,
        [['Cancelar', null, 'sec'], ['Aplicar', () => {
          probando('incidencias');
          Object.assign(M.proyecto().params, M.PARAMS_DEF);
          render(); irVista('incidencias');
        }]]);
    },

    /* --- edición masiva ---
       Cuatro herramientas para no abrir doscientos análisis de a uno. Todas
       trabajan sobre un alcance que elige el usuario: el módulo activo o el
       proyecto entero. La lógica está en motor.js; acá solo el diálogo. */

    /** La planilla de rendimientos: insumos en las filas, análisis en las columnas. */
    matrizApu() {
      const P = M.proyecto();
      if (!P.modulos.some(m => m.items.length))
        return modal('Matriz análisis × insumo', '<p>El presupuesto todavía no tiene ítems.</p>');
      modal('Matriz análisis × insumo', `<div class="form-g">
        <label>Qué ítems</label>
        <select id="mzAlc">
          <option value="mod">Solo el módulo activo — ${esc(M.modulo().n)} (${M.modulo().items.length} ítem(s))</option>
          <option value="todo">Todo el presupuesto (${P.modulos.reduce((a, m) => a + m.items.length, 0)} ítem(s))</option>
        </select>
        <label>Qué insumos</label>
        <select id="mzTipo">
          <option value="">Todos</option><option value="M">Solo materiales</option>
          <option value="O">Solo mano de obra</option><option value="E">Solo equipo</option>
        </select>
        <p class="mini">La planilla muestra el <b>rendimiento</b> de cada insumo en cada análisis y
        se escribe directamente sobre ella. Un rendimiento en <b>0</b> saca el insumo de ese análisis.</p>
      </div>`, [['Cancelar', null, 'sec'], ['Abrir la matriz', () => {
        const alc = $('#mzAlc').value === 'todo' ? {} : { modulo: M.proyecto().moduloActivo };
        abrirMatriz(alc, $('#mzTipo').value);
        return false;                       // el diálogo se reemplaza, no se cierra
      }]]);
    },

    /** Multiplica rendimientos por un factor. */
    factorRend() {
      modal('Factor de rendimiento', `<div class="form-g">
        <label>Qué ítems</label>
        <select id="frAlc">
          <option value="mod">Solo el módulo activo — ${esc(M.modulo().n)}</option>
          <option value="todo">Todo el presupuesto</option>
        </select>
        <label>Sobre qué insumos</label>
        <div class="chk-fila">
          <label><input type="checkbox" id="frM" checked> Materiales</label>
          <label><input type="checkbox" id="frO" checked> Mano de obra</label>
          <label><input type="checkbox" id="frE" checked> Equipo</label>
        </div>
        <label>Factor</label>
        <input type="number" step="0.01" id="frF" value="1.10" style="max-width:140px">
        <p class="mini"><b>1,10</b> sube los rendimientos un 10 %. <b>0,90</b> los baja un 10 %.
        <b>1</b> no cambia nada. Los <b>precios no se tocan</b>: el factor es de rendimiento.</p>
        <p class="mini">El cambio se aplica al presupuesto pero no se guarda solo: revise el total
        y guarde si está conforme.</p>
      </div>`, [['Cancelar', null, 'sec'], ['Aplicar', () => {
        const f = Number($('#frF').value);
        if (!isFinite(f) || f <= 0) { alert('El factor tiene que ser un número mayor que cero.'); return false; }
        const tipos = ['M', 'O', 'E'].filter(t => $('#fr' + t).checked);
        if (!tipos.length) { alert('Elija al menos un tipo de insumo.'); return false; }
        probando('presupuesto');
        const alc = $('#frAlc').value === 'todo' ? {} : { modulo: M.proyecto().moduloActivo };
        const r = M.factorRendimiento(alc, f, { tipos });
        render();
        setTimeout(() => alert(r.renglones
          ? r.renglones + ' rendimiento(s) en ' + r.items + ' ítem(s), multiplicados por ' + f + '.'
          : 'No había rendimientos que cambiar con ese filtro.'), 100);
      }]]);
    },

    /** Junta los insumos de varios análisis en uno. */
    fusionarApus() {
      const L = M.todosItems().map(x => x.i);
      if (L.length < 2)
        return modal('Fusionar análisis', '<p>Hacen falta al menos dos ítems para fusionar.</p>');
      const rot = it => esc((it.cod ? it.cod + ' — ' : '') + it.desc);
      modal('Fusionar análisis', `<div class="form-g">
        <label>Análisis que queda (destino)</label>
        <select id="fuDest">${L.map(it => `<option value="${it.id}">${rot(it)}</option>`).join('')}</select>
        <label>Análisis que se le suman (se eliminan al fusionar)</label>
        <div class="lista-chk" id="fuOrig">${L.map(it =>
        `<label><input type="checkbox" value="${it.id}"> ${rot(it)}
           <span class="mini">${(it.comp || []).length} insumo(s)</span></label>`).join('')}</div>
        <label>Si un insumo está en los dos</label>
        <select id="fuModo">
          <option value="sumar">Sumar los rendimientos</option>
          <option value="mantener">Dejar el del destino</option>
        </select>
        <p class="mini">El destino <b>conserva su cantidad de obra</b>: fusionar análisis no suma
        cantidades, junta los insumos. Los ítems de origen se eliminan del presupuesto.</p>
      </div>`, [['Cancelar', null, 'sec'], ['Fusionar', () => {
        const dest = $('#fuDest').value;
        const orig = $$('#fuOrig input:checked').map(c => c.value).filter(id => id !== dest);
        if (!orig.length) { alert('Marque al menos un análisis para sumar al destino.'); return false; }
        probando('presupuesto');
        const r = M.fusionarApus(dest, orig, $('#fuModo').value);
        render();
        setTimeout(() => alert(r.items + ' análisis fusionado(s). Se agregaron ' + r.insumos +
          ' insumo(s) al destino.'), 100);
      }, 'rojo']]);
    },

    /** Carga muchos ítems de una lista pegada. */
    itemsEnLote() {
      modal('Crear ítems en lote', `<div class="form-g">
        <label>Un ítem por renglón</label>
        <textarea id="loteTxt" rows="9" class="txt" style="font-family:ui-monospace,Consolas,monospace"
          placeholder="MURO DE LADRILLO GAMBOTE ; m2 ; 42&#10;CONTRAPISO DE CEMENTO ; m2 ; 120,5&#10;EXCAVACION COMUN ; m3 ; 8"></textarea>
        <p class="mini">Formato: <b>descripción ; unidad ; cantidad</b>. También sirve separado por
        tabulaciones, que es lo que sale al copiar tres columnas de Excel. La unidad y la cantidad
        son opcionales.</p>
        <label>Unidad por defecto</label>
        <input class="txt" id="loteUnd" value="glb" list="lUnidades" style="max-width:140px">
        <p class="mini">Los ítems se crean <b>sin análisis</b>, en el módulo activo
        (<b>${esc(M.modulo().n)}</b>): quedan listos para traerles el suyo de la Base de Datos.</p>
      </div>`, [['Cancelar', null, 'sec'], ['Crear', () => {
        const txt = $('#loteTxt').value;
        if (!txt.trim()) { alert('Escriba o pegue al menos un renglón.'); return false; }
        probando('presupuesto');
        const r = M.crearItemsEnLote(txt, { und: $('#loteUnd').value });
        render();
        setTimeout(() => alert(r.items.length + ' ítem(s) creado(s)' +
          (r.saltadas ? ', ' + r.saltadas + ' renglón(es) sin descripción se saltaron' : '') + '.'), 100);
      }]]);
    },

    /* --- formatos de incidencias (la cadena de cálculo del B-2) --- */

    /** Copia editable del formato activo. Arranca idéntica: nada cambia de precio. */
    duplicarFormato() {
      const base = M.formato();
      modal('Duplicar el formato de incidencias', `<div class="form-g">
        <label>Nombre del formato nuevo</label>
        <input class="txt" id="nomFmt" value="${esc('Copia de ' + base.n)}" maxlength="80">
        <p class="mini">La copia arranca <b>idéntica</b> a «${esc(base.n)}»: ningún ítem cambia de
        precio al duplicar. Recién al editarla se mueve el presupuesto.</p>
        <p class="mini">Queda en el <b>listado de incidencias</b> de este proyecto y viaja dentro del
        archivo <code>.boq</code>. Los formatos anteriores siguen ahí y se vuelven a aplicar con un
        clic; el oficial nunca se pierde.</p>
      </div>`, [['Cancelar', null, 'sec'], ['Duplicar', () => {
        probando('incidencias');
        const f = M.duplicarFormato($('#nomFmt').value);
        M.guardarFormato(f);
        M.usarFormato(f.id);
        render(); irVista('incidencias');
      }]]);
    },

    /** Cambia el nombre de un formato propio del listado. */
    renombrarFormato(id) {
      const f = M.formatoPorId(id);
      if (!f || id === M.ID_SABS) return;
      modal('Cambiar el nombre del formato', `<div class="form-g">
        <label>Nombre</label>
        <input class="txt" id="renFmt" value="${esc(f.n)}" maxlength="80">
      </div>`, [['Cancelar', null, 'sec'], ['Guardar', () => {
        const v = $('#renFmt').value.trim();
        if (!v) { alert('Escriba un nombre.'); return false; }
        probando('incidencias');
        M.renombrarFormato(id, v);
        render(); irVista('incidencias');
      }]]);
    },

    /** Saca un formato propio del listado. El oficial no se puede sacar. */
    quitarFormato(id) {
      const f = M.formatoPorId(id);
      if (!f || id === M.ID_SABS) return;
      const aplicado = M.formato().id === id;
      modal('Quitar del listado', `
        <p>Se saca <b>${esc(f.n)}</b> del listado de incidencias de este proyecto.</p>
        ${aplicado ? `<div class="aviso-caja"><b>Es el formato que está aplicado.</b>
          <p class="mini" style="margin:4px 0 0">El presupuesto vuelve al <b>formato oficial</b> y
          los precios unitarios van a cambiar si esta cadena no daba el mismo resultado.
          Total ahora: <b>${M.fmt(M.conv(M.totalGeneral()))} ${M.proyecto().moneda}</b>.</p></div>`
        : '<p class="mini">No es el que está aplicado, así que el presupuesto no cambia.</p>'}
        <p class="mini">Esto no se puede deshacer desde el listado; si todavía no guardó, el botón
        <b>Descartar</b> de la barra inferior devuelve todo como estaba.</p>`,
        [['Cancelar', null, 'sec'], ['Quitar', () => {
          probando('incidencias');
          M.eliminarFormato(id);
          render(); irVista('incidencias');
        }, 'rojo']]);
    },

    /** Vuelve al SABS oficial sin sacar nada del listado. Los porcentajes con
        nombre conocido se conservan. Es lo mismo que hacer clic en el oficial
        dentro del listado; se deja como acción porque el menú la nombra. */
    volverFormatoOficial() {
      if (M.formatoEsOficial()) return;
      modal('Volver al formato oficial', `<p>El presupuesto vuelve a calcularse con la cadena del
        <b>SABS (DS 0181)</b>. Se conservan los porcentajes que tengan nombre conocido —cargas
        sociales, IVA mano de obra, herramientas, gastos generales, utilidad e IT.</p>
        <p class="mini">El precio unitario de los ítems va a cambiar si la cadena propia no daba el
        mismo resultado. El formato que estaba aplicado <b>no se borra</b>: queda en el listado y se
        vuelve a poner con un clic.</p>`,
        [['Cancelar', null, 'sec'], ['Volver al oficial', () => {
          probando('incidencias');
          M.usarFormato(null);
          render(); irVista('incidencias');
        }, 'rojo']]);
    },

    /** Fila nueva, justo antes del precio unitario. */
    agregarFilaFormato() {
      if (M.formatoEsOficial())
        return modal('Formato oficial', `<p>La estructura del formato oficial no se cambia: es la
          del DS 0181. Use <b>⧉ Duplicar para editarlo</b> y agregue la fila en la copia.</p>`);
      const F = M.formato().filas;
      const pos = Math.max(3, F.length - 1);     // antes de la última, que es el P.U.
      probando('incidencias');
      const nueva = {
        id: 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
        k: 'pct', n: 'Recargo nuevo', pct: 0, sobre: [pos]
      };
      conReferenciasEstables(F, () => { F.splice(pos, 0, nueva); });
      /* La fila nueva entra TAMBIÉN en el precio unitario. Sin esto, agregar un
         recargo no cambiaba nada: la última fila seguía sumando solo las que ya
         estaban, así que el usuario ponía su 2 % y el total no se movía, sin un
         mensaje que lo explicara. Si hace falta dejarla fuera del precio, se
         quita a mano del «sobre qué» de la última fila. */
      const pu = F[F.length - 1];
      const nPos = F.indexOf(nueva) + 1;
      if (pu && pu !== nueva && (pu.sobre || []).indexOf(nPos) < 0) pu.sobre = (pu.sobre || []).concat([nPos]);
      render(); irVista('incidencias');
    },

    /* --- reportes --- */
    repPresupuesto() { REP.b1(); },
    repAnalisis() { REP.b2(); },
    repAnalisisUno() { const it = M.getItem($('#selItemAnalisis').value); if (it) REP.b2(it); },
    repElementales() { REP.b3(); },
    estadoSincro() { abrirEstadoSincro(); },
    repInsumos() { REP.insumos(); },
    repComputos() { REP.computos(); },
    repCrono() { REP.crono(); },
    repResumen() { REP.resumen(); },

    /* --- bases de datos propias ---
       Además de la base publicada, cada usuario puede armar las suyas: quedan
       guardadas en este navegador y se buscan igual que las demás. */
    nuevaBasePropia() {
      const n = M.basesPropias().length;
      modal('Crear una base de datos', `<div class="form-g">
        <label>Nombre de la base</label>
        <input id="nbN" value="${n ? 'MI BASE ' + (n + 1) : 'MIS ANÁLISIS'}" placeholder="Ej.: PRECIOS ORURO 2026">
        </div>
        <p class="mini">Queda guardada en este navegador y aparece en la lista de bases, junto a las
        demás. Para llenarla puede copiar ítems del presupuesto con
        <b>⬇ Del presupuesto</b>, acá mismo, o guardar análisis sueltos desde el diálogo
        <b>Traer al presupuesto</b>.</p>`,
        [['Cancelar', null, 'sec'], ['Crear', () => {
          const b = M.crearBasePropia($('#nbN').value);
          llenarBases();
          $('#selBaseFiltro').value = b.id; $('#selBase').value = b.id;
          buscarBase(); render(); irVista('base');
          marcarGuardado('Base «' + b.n + '» creada');
          /* La base nace vacía; si hay presupuesto abierto con análisis, este
             es el momento en que llenarla cuesta un clic. */
          const L = M.itemsConAnalisis();
          if (!L.length) return;
          setTimeout(() => modal('Base creada', `
            <p>La base <b>${esc(b.n)}</b> quedó creada y todavía está vacía.</p>
            <p>El presupuesto abierto tiene <b>${L.length}</b> ítem(s) con análisis cargado.
            ¿Los copia ahora a esta base?</p>`,
            [['Ahora no', null, 'sec'],
            ['Elegir ítems y copiar…', () => setTimeout(() => ACC.proyectoABase(null, b.id), 80)]]), 80);
        }]]);
      setTimeout(() => { const i = $('#nbN'); if (i) { i.focus(); i.select(); } }, 60);
    },
    /**
     * Copia ítems del presupuesto a una base propia, para reusarlos.
     * @param {string} [sugerido] nombre para una base nueva. Al importar un
     *        .ddp llega el nombre del archivo, así cada PRESCOM queda en su
     *        propia base y no se mezcla con lo que ya había.
     * @param {number} [idDest] base destino preseleccionada
     */
    proyectoABase(sugerido, idDest) {
      const P = M.proyecto();
      const L = M.itemsConAnalisis();
      if (!L.length) return alert('Ningún ítem del presupuesto tiene análisis cargado.');
      const propias = M.basesPropias();
      const nom = (typeof sugerido === 'string' && sugerido.trim()) || P.nombre || 'MI BASE';
      /* Con un nombre sugerido —viene de una importación— el destino por
         defecto es una base nueva: cada archivo de origen, su propia base. */
      const nueva = !propias.length || (typeof sugerido === 'string' && !!sugerido.trim());
      const sel = id => (nueva ? false : Number(idDest) === id) ? 'selected' : '';

      modal('Guardar el presupuesto como base de datos', `
        <p>Los ítems que elija se copian a una base de datos de este equipo, para poder traerlos a
        otros proyectos. El presupuesto abierto no se toca.</p>
        <div class="form-g"><label>Base destino</label>
          <select id="pbB">
            ${propias.map(b => `<option value="${b.id}" ${sel(b.id)}>${esc(b.n)} (${b.apus} ítems)</option>`).join('')}
            <option value="" ${nueva ? 'selected' : ''}>— crear una base nueva —</option>
          </select>
          <label>Nombre de la base nueva</label>
          <input id="pbN" value="${esc(nom)}" ${nueva ? '' : 'disabled'}>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px">
          <b>Ítems a copiar</b>
          <button class="btn sec" type="button" data-marca="1">Todos</button>
          <button class="btn sec" type="button" data-marca="0">Ninguno</button>
          <span class="mini" id="pbCuenta"></span>
        </div>
        <div style="max-height:260px;overflow:auto;border:1px solid var(--gris-borde)"><table class="rej">
          <thead><tr><th style="width:28px"></th><th>ÍTEM</th><th style="width:52px">UND.</th>
            <th style="width:96px">COSTO DIR.</th></tr></thead><tbody>` +
        L.map(({ m, it }) => {
          const a = M.analisis(it);
          return `<tr><td class="ctr"><input type="checkbox" data-pbitem="${it.id}" checked></td>
            <td>${esc(it.desc)}<div class="mini">${esc(m.n)}</div></td>
            <td class="ctr">${esc(it.und)}</td>
            <td class="num">${M.fmt(a.mat + a.mo + a.eq, 2)}</td></tr>`;
        }).join('') +
        `</tbody></table></div>
        <p class="mini">Si alguno ya está en esa base con la misma descripción, se pregunta antes
        qué hacer: reemplazarlo, guardar los dos o dejar el que estaba.</p>`,
        [['Cancelar', null, 'sec'], ['Guardar en la base', () => {
          const ids = $$('#modalCuerpo input[data-pbitem]')
            .filter(c => c.checked).map(c => c.getAttribute('data-pbitem'));
          if (!ids.length) { alert('Marque al menos un ítem.'); return false; }
          const s = $('#pbB');
          const id = (s && s.value) ? Number(s.value) : M.crearBasePropia($('#pbN').value).id;
          /* los que coinciden en todo no son conflicto: se reemplazan igual */
          const ch = M.conflictosVolcado(id, ids).filter(c => !c.igual);
          if (ch.length) { setTimeout(() => resolverVolcado(id, ids, ch), 80); return; }
          finVolcado(M.volcarProyectoABase(id, { ids }));
        }]]);

      const s = $('#pbB'), inp = $('#pbN'), cuenta = $('#pbCuenta');
      const marcados = () => $$('#modalCuerpo input[data-pbitem]').filter(c => c.checked).length;
      const refrescar = () => { if (cuenta) cuenta.textContent = marcados() + ' de ' + L.length; };
      if (s) s.addEventListener('change', () => { inp.disabled = !!s.value; });
      $('#modalCuerpo').addEventListener('click', ev => {
        const b = ev.target.closest('[data-marca]');
        if (b) $$('#modalCuerpo input[data-pbitem]').forEach(c => { c.checked = b.dataset.marca === '1'; });
        refrescar();
      });
      refrescar();
    },
    /** Renombrar o borrar las bases que armó el usuario. */
    misBases() {
      const L = M.basesPropias();
      if (!L.length)
        return modal('Mis bases de datos', `<p>Todavía no creó ninguna base propia.</p>`,
          [['Cerrar', null, 'sec'], ['Crear una ahora…', () => setTimeout(ACC.nuevaBasePropia, 80)]]);
      modal('Mis bases de datos', `
        <p>Bases que armó en este equipo. La base publicada no se toca desde acá.</p>
        <table class="rej"><thead><tr><th>NOMBRE</th><th style="width:70px">ÍTEMS</th>
          <th style="width:34px"></th></tr></thead><tbody>` +
        L.map(b => `<tr><td><input class="txt" data-basepropia="${b.id}" value="${esc(b.n)}"></td>
          <td class="num">${b.apus}</td>
          <td class="ctr"><button class="b-del" data-delbase="${b.id}" title="Eliminar la base">✕</button></td></tr>`).join('') +
        `</tbody></table>
        <p class="mini">Al cambiar el nombre se guarda al cerrar. Eliminar una base borra sus
        análisis de este equipo; los proyectos ya armados no se tocan.</p>`,
        [['Cerrar', () => {
          /* el atributo va en minúsculas a propósito: el HTML baja el nombre
             a `data-basen` y `dataset.baseN` quedaba en undefined, así que el
             renombrado no llegaba a guardarse nunca */
          $$('#modalCuerpo input[data-basepropia]')
            .forEach(i => M.renombrarBasePropia(i.dataset.basepropia, i.value));
          llenarBases(); buscarBase(); render();
        }]]);
      $('#modalCuerpo').addEventListener('click', ev => {
        const b = ev.target.closest('[data-delbase]'); if (!b) return;
        const nom = L.find(x => x.id === Number(b.dataset.delbase));
        if (!confirm('¿Eliminar la base «' + (nom ? nom.n : '') + '» de este equipo?')) return;
        M.eliminarBasePropia(b.dataset.delbase);
        llenarBases(); buscarBase(); render();
        cerrarModal(); setTimeout(ACC.misBases, 80);
      });
    },

    /* --- cuenta, respaldo y reportes --- */

    /** Entrar o ver el estado de la cuenta. */
    cuenta() {
      if (!hayNube())
        return modal('Mi cuenta', '<p>Esta copia de OpenBOQ no tiene servidor configurado.</p>' +
          '<p class="mini">Funciona igual: todo se guarda en este equipo.</p>');
      const u = NUBE.usuario();
      if (u) return ACC.miCuenta();

      modal('Entrar', `
        <p class="mini" style="margin:0 0 14px">Su biblioteca de análisis se guarda en la cuenta
        y se recupera en cualquier equipo.</p>
        <button class="btn google" id="cuGoogle">
          <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path
            fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path
            fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"/><path
            fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
          Continuar con Google
        </button>
        <div id="cuAviso"></div>`,
        [['Cancelar', null, 'sec']]);
      const g = $('#cuGoogle');
      /* Atajar acá el error que no se ve: en una dirección que el proveedor
         no tiene autorizada, el login «funciona» pero la sesión queda en la
         ventana emergente y esta se queda como invitada. Se avisa ANTES de
         abrirla, con el enlace a la dirección que sí sirve. */
      const ajeno = NUBE.origenAjeno && NUBE.origenAjeno();
      if (ajeno) {
        const av = $('#cuAviso');
        if (av) av.innerHTML = `<p class="mini" style="margin-top:12px">
          Está entrando desde <b>${esc(location.origin)}</b>, que es una dirección de prueba
          de un despliegue. Desde acá el acceso <b>no va a poder completarse</b>: la sesión
          queda en la ventana emergente y esta pantalla sigue como invitada.<br>
          Use <a href="${esc(ajeno)}" target="_blank" rel="noopener"><b>${esc(ajeno)}</b></a>.</p>`;
      }
      if (g) g.onclick = () => {
        const modo = NUBE.entrarCon('google');
        if (modo === 'navegador') {
          /* Escritorio: el login va en el navegador del sistema porque Google
             no lo acepta dentro de la ventana de la aplicación. La sesión
             vuelve sola por el servidor interno y la aplicación se recarga. */
          const c = $('#cuAviso');
          if (c) c.innerHTML = '<p class="mini">Se abrió el navegador para entrar con Google. ' +
            'Al terminar, esta ventana se actualiza sola: la pestaña del navegador se puede cerrar.</p>';
        } else if (modo === 'ventana') {
          /* La ventana de login avisa cuando termina (NUBE.alEntrar, enganchado
             al arrancar). Mientras tanto se deja el diálogo abierto con el
             aviso: si el usuario cancela en Google, sigue donde estaba. */
          const c = $('#cuAviso');
          if (c) c.innerHTML = '<p class="mini">Se abrió una ventana para entrar con Google. ' +
            'Si no la ve, revise si el navegador bloqueó las ventanas emergentes.</p>';
        }
      };
      setTimeout(() => { const b = $('#cuGoogle'); if (b) b.focus(); }, 60);
    },

    /** Todo lo que tiene el usuario, de un lado y del otro.
        Lo de este equipo se pinta al toque —ya está en memoria— y lo de la
        nube se pide y se completa cuando llega, para que el diálogo no se
        quede en blanco esperando a la red. */
    miCuenta() {
      const u = NUBE.usuario();
      if (!u) return ACC.cuenta();
      /* TODO EL RESPALDO DEL USUARIO VA A SU DRIVE (decisión del 2026-09-10).
         Lo que se guardaba en el servidor —la biblioteca y los diez proyectos—
         salió de la interfaz: era espacio del plan gratuito que crecía con
         cada usuario, y contenido que quien administra el servidor podía, en
         principio, abrir. En el Drive del usuario no pasa ni una cosa ni la
         otra.

         La cuenta NO desaparece: sigue haciendo falta para saber quién es y
         con qué correo autorizar el Drive. Y los APORTES anónimos siguen
         yendo a Supabase exactamente igual que antes —solo la parte técnica
         de los análisis, sin cantidades ni montos ni nombres—: eso alimenta
         la base común y no se toca. Simplemente no se muestra acá, porque no
         es un respaldo del usuario.

         El código de nube.js (subirBiblioteca, guardarProyecto, …) queda
         donde está: nada lo llama desde la interfaz, pero sacarlo sería
         perder el camino de vuelta si esto se revierte. */
      modal('Mi cuenta', `
        <p style="margin:0 0 2px"><b>${esc(u.email || '—')}</b></p>
        <p class="mini" style="margin:0 0 12px">Sesión iniciada en este navegador.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn" data-acc="driveGuardarProyecto">⬆ Este proyecto a mi Drive</button>
          <button class="btn sec" data-acc="driveGuardarBiblioteca">⬆ Respaldar mis bases y cambios</button>
        </div>
        <h4 class="cta-t">En este equipo</h4>
        ${cuentaLocal()}
        <h4 class="cta-t">En su Google Drive</h4>
        <div id="ctaDrive"><p class="mini">Consultando…</p></div>`,
        [['Cerrar', null, 'sec'],
        ['Salir de la cuenta', () => { NUBE.salir(); location.reload(); }, 'rojo']]);
      pintarDrive();
      /* El panel de administración NO se enlaza desde la aplicación (decisión
         de Alvaro, 15/09/2026): se entra solo con la dirección directa. */
    },

    /* --------------------------- Drive del usuario ---------------------------
       Las cuatro salen de un clic, y DRIVE.autorizar se llama derecho, sin
       ningún `await` delante: si se pierde el gesto, el navegador bloquea la
       ventana de permiso sin decir nada. */

    driveConectar() {
      if (!hayDrive()) return;
      if (!hayNube() || !NUBE.conectado())
        return alert('Primero hay que entrar con Google, y después conectar el Drive.');
      marcarGuardado('Pidiendo permiso a Google Drive…');
      DRIVE.autorizar({ interactivo: true, correo: correoDrive() })
        .then(t => {
          if (t) marcarGuardado('Drive conectado');
          else marcarGuardado('No se concedió el permiso de Drive', true);
          pintarDrive();
        })
        .catch(e => {
          marcarGuardado('No se pudo conectar el Drive', true);
          pintarDrive();
          /* Un renglón en la barra de estado se pierde, y acá el usuario
             necesita saber qué hacer: casi siempre el problema no es suyo. */
          setTimeout(() => modal('No se pudo conectar con Drive', `
            <p>${esc(e.message)}</p>
            <p class="mini">Su trabajo no corre riesgo: OpenBOQ sigue funcionando y todo
            queda guardado en este equipo. También puede guardar el proyecto en un archivo
            <code>.boq</code> desde <b>ARCHIVO → Guardar</b>.</p>
            ${e.codigo ? `<p class="mini">Código de Google: <code>${esc(e.codigo)}</code></p>` : ''}`,
            [['Entendido', null]]), 80);
        });
    },

    driveGuardarProyecto() {
      if (!hayDrive()) return;
      if (!hayContenido()) return alert('No hay ningún proyecto abierto para guardar.');
      const nombre = nombreDrive();
      /* Se mira ANTES de abrir el diálogo para poder decir si pisa algo. La
         consulta sale dentro del clic, que es lo que habilita la ventana de
         permiso si todavía no hay token. */
      marcarGuardado('Consultando su Drive…');
      DRIVE.buscar(nombre, opDrive())
        .then(ya => { marcarGuardado(''); dialogoGuardarDrive(nombre, ya); })
        .catch(e => marcarGuardado('No se pudo consultar el Drive: ' + e.message, true));
    },

    /** Manda un archivo del Drive a la papelera. Se puede recuperar desde
        el propio Drive: por eso no se pide una confirmación dramática, pero
        sí se pide, porque el archivo es del usuario. */
    driveBorrar(id) {
      if (!hayDrive() || !id) return;
      DRIVE.listar(opDrive()).then(fs => {
        const f = fs.find(x => x.id === id);
        if (!f) return marcarGuardado('Ese archivo ya no está en su Drive', true);
        setTimeout(() => modal('Quitar del Drive', `
          <p>Se manda <b>${esc(nombreVisible(f.name))}</b> a la papelera de su Google Drive.</p>
          <p class="mini">No se borra del todo: queda en la papelera de su Drive y puede
          recuperarlo desde ahí. OpenBOQ deja de verlo.</p>`,
          [['Cancelar', null, 'sec'],
           ['Mandar a la papelera', () => {
             DRIVE.borrar(id, opDrive())
               .then(() => {
                 marcarGuardado('Quitado de su Drive · ' + nombreVisible(f.name));
                 pintarDrive(); pintarDriveInicio();
               })
               .catch(e => marcarGuardado('No se pudo quitar: ' + e.message, true));
           }, 'rojo']]), 60);
      }).catch(e => marcarGuardado('No se pudo consultar el Drive: ' + e.message, true));
    },

    driveGuardarBiblioteca() {
      if (!hayDrive()) return;
      const bd = M.exportarBDU ? M.exportarBDU() : null;
      if (!bd || !(bd.bases || []).length)
        return alert('Todavía no armó ninguna base propia: no hay nada que guardar.');
      const nApus = bd.bases.reduce((s, b) => s + ((b.apus && b.apus.length) || 0), 0);
      const nCambios = (bd.cambios || []).length;

      const escribir = () => {
        marcarGuardado('Respaldando sus bases y cambios en su Drive…');
        DRIVE.escribir(ARCHIVO_BDU, bd,
          { bases: bd.bases.length, apus: nApus, cambios: nCambios, version: VERSION }, opDrive())
          .then(() => {
            marcarGuardado(`Respaldado en su Drive · ${bd.bases.length} base(s), ` +
              `${nApus} análisis` + (nCambios ? `, ${nCambios} cambio(s)` : ''));
            pintarDrive(); pintarDriveInicio();
          })
          .catch(e => marcarGuardado('No se pudo respaldar: ' + e.message, true));
      };

      /* El respaldo de la biblioteca SIEMPRE va al mismo archivo —es una
         copia del estado actual, no un historial—, así que lo honesto es
         decir que reemplaza el anterior y con qué fecha. */
      marcarGuardado('Consultando su Drive…');
      DRIVE.buscar(ARCHIVO_BDU, opDrive()).then(ya => {
        marcarGuardado('');
        setTimeout(() => modal('Respaldar mis bases y cambios', `
          <p>Se guarda en la carpeta <b>OpenBOQ</b> de su Google Drive${correoDrive() ? ' — ' + esc(correoDrive()) : ''},
          como <b>${esc(nombreVisible(ARCHIVO_BDU))}</b>.</p>
          <p class="mini">Contiene <b>${bd.bases.length}</b> base(s) propia(s) con
          <b>${nApus}</b> análisis${nCambios ? `, y <b>${nCambios}</b> análisis del catálogo que usted reescribió` : ''}.
          No incluye el proyecto abierto: eso se guarda aparte.</p>
          ${ya ? `<p class="mini" style="color:var(--rojo,#b4232a)"><b>Reemplaza el respaldo anterior</b>${
            ya.modifiedTime ? ', del ' + new Date(ya.modifiedTime).toLocaleString('es-BO') : ''}.
            Siempre es un solo archivo, con el estado actual.</p>` : ''}`,
          [['Cancelar', null, 'sec'],
           [ya ? 'Reemplazar' : 'Respaldar', escribir, ya ? 'rojo' : '']]), 60);
      }).catch(e => marcarGuardado('No se pudo consultar el Drive: ' + e.message, true));
    },

    /** Trae un archivo del Drive. Puede ser un proyecto o la biblioteca:
        se distinguen por lo que traen adentro, no por el nombre, porque el
        usuario puede renombrarlos desde su Drive. */
    driveAbrir(id) {
      if (!hayDrive() || !id) return;
      marcarGuardado('Trayendo de su Drive…');
      DRIVE.leer(id, opDrive()).then(obj => {
        if (obj && Array.isArray(obj.bases)) {
          return modal('Traer la biblioteca de su Drive', `
            <p>El archivo tiene <b>${(obj.bases || []).length}</b> base(s) propia(s).</p>
            <p><b>Reemplaza</b> las bases propias de este equipo por las del archivo.</p>`,
            [['Cancelar', null, 'sec'], ['Traer y reemplazar', () => {
              M.importarBDU(obj);
              llenarBases(); buscarBase(); render();
              marcarGuardado('Biblioteca restaurada desde su Drive');
            }, 'rojo']]);
        }
        cerrarInicio();
        abrirTexto(JSON.stringify(obj), '', null);
        marcarGuardado('Traído de su Drive');
      }).catch(e => marcarGuardado('No se pudo abrir: ' + e.message, true));
    },

    async respaldar() {
      if (!hayNube() || !NUBE.conectado()) return ACC.cuenta();
      const bd = M.exportarBDU ? M.exportarBDU() : null;
      if (!bd || !(bd.bases || []).length)
        return alert('Todavía no armó ninguna base propia: no hay nada que guardar.');
      marcarGuardado('Guardando la biblioteca…');
      try {
        const r = await NUBE.subirBiblioteca(bd, VERSION);
        marcarGuardado(`Biblioteca guardada · ${r.bases} base(s), ${r.apus} análisis`);
      } catch (e) {
        marcarGuardado('No se pudo guardar: ' + e.message, true);
      }
    },

    async restaurar() {
      if (!hayNube() || !NUBE.conectado()) return ACC.cuenta();
      let r;
      try { r = await NUBE.bajarBiblioteca(); }
      catch (e) { return alert('No se pudo traer la biblioteca: ' + e.message); }
      if (!r) return alert('No hay ninguna biblioteca guardada en esta cuenta.');
      modal('Traer la biblioteca guardada', `
        <p>Hay una biblioteca de <b>${r.n_bases}</b> base(s) y <b>${r.n_apus}</b> análisis,
        guardada el <b>${new Date(r.actualizado_en).toLocaleString('es-BO')}</b>.</p>
        <p><b>Reemplaza</b> las bases propias de este equipo por las guardadas.</p>`,
        [['Cancelar', null, 'sec'], ['Traer y reemplazar', () => {
          M.importarBDU(r.payload);
          llenarBases(); buscarBase(); render();
          marcarGuardado('Biblioteca restaurada · ' + r.n_apus + ' análisis');
        }, 'rojo']]);
    },

    /** Suelta los precios unitarios heredados del .ddp y vuelve al cálculo. */
    recalcularPU() {
      const r = M.conPuDeArchivo();
      if (!r.items)
        return modal('Precios unitarios', `
          <p>Este proyecto no tiene precios unitarios heredados de un archivo de PRESCOM.</p>
          <p class="mini">Todos los precios los calcula OpenBOQ a partir de los análisis.</p>`);
      const P = M.proyecto();
      const antes = M.totalProyecto();
      modal('Recalcular los precios unitarios', `
        <p><b>${r.items} ítem(s)</b> conservan el precio unitario que traía el archivo importado, y
        en <b>${r.conAjuste}</b> de ellos ese precio difiere del calculado por el redondeo del
        origen.</p>
        <p>Al recalcular, OpenBOQ pasa a usar sus propios precios: desaparece el renglón
        «redondeo del archivo de origen» del B-2 y el total del presupuesto puede moverse unos
        centavos respecto del documento de PRESCOM.</p>
        <p class="mini">Total actual: <b>${M.fmt(M.conv(antes))} ${P.moneda}</b>. Queda como cambio
        en prueba: se deshace con <b>↺ Descartar</b> mientras no lo guarde. Una vez guardado, para
        volver atrás hay que importar el archivo de nuevo.</p>`,
        [['Cancelar', null, 'sec'], ['Recalcular', () => {
          probando('presupuesto');
          const n = M.soltarPuDeArchivo();
          render();
          const ahora = M.totalProyecto();
          marcarGuardado(`Precios recalculados en ${n} ítem(s) · el total cambió ` +
            M.fmt(ahora - antes, 2) + ' ' + P.moneda);
        }, 'rojo']]);
    },

    /* --- proyectos en la nube ---
       Diez lugares por cuenta. Lo que sube es el proyecto entero, el
       mismo contenido del .boq. En js/nube.js está la nota larga sobre qué
       ve el servidor y qué no. */

    misProyectos() {
      if (!hayNube())
        return modal('Mis proyectos', '<p>Esta copia de OpenBOQ no tiene servidor configurado.</p>' +
          '<p class="mini">Los proyectos se guardan en este equipo y en los archivos <code>.boq</code>.</p>');
      if (!NUBE.conectado()) return ACC.cuenta();
      modal('Mis proyectos en la nube', `
        <p class="mini" style="margin:0 0 10px">Hasta ${NUBE.TOPE_PROYECTOS} proyectos por cuenta.
        Para tener más, guárdelos en archivos <code>.boq</code>: ahí no hay límite.</p>
        <div class="ini-slots" id="mpSlots"><span class="mini">Buscando…</span></div>
        ${PIE_NUBE}`,
        [['Cerrar', null, 'sec'],
        ['⬆ Guardar el proyecto abierto', () => { setTimeout(() => ACC.guardarNube(), 80); }]]);
      refrescarNube();
    },

    /** Sube el proyecto abierto al lugar que se elija. */
    guardarNube(slot) {
      if (!hayNube() || !NUBE.conectado()) return ACC.cuenta();
      if (!hayContenido())
        return alert('El proyecto está vacío: no hay nada que guardar todavía.');
      const P = M.proyecto();
      const n = P.modulos.reduce((s, m) => s + m.items.length, 0);
      const kb = Math.round(M.serializar().length / 1024);

      NUBE.listarProyectos().then(L => {
        const por = {}; L.forEach(p => { por[p.slot] = p; });
        let elegido = Number(slot) || 0;
        if (!elegido) {
          for (let s = 1; s <= NUBE.TOPE_PROYECTOS && !elegido; s++) if (!por[s]) elegido = s;
          if (!elegido) elegido = 1;
        }
        let ops = '';
        for (let s = 1; s <= NUBE.TOPE_PROYECTOS; s++) {
          const p = por[s];
          ops += `<label class="op-slot"><input type="radio" name="gnSlot" value="${s}"
              ${s === elegido ? 'checked' : ''}>
            <span><b>Proyecto ${s}</b> — ${p
              ? (p.protegido ? '🔒 ' + esc(p.etiqueta) : esc(p.nombre || p.etiqueta)) +
              ' <span class="mini">(se reemplaza)</span>'
              : '<span class="mini">libre</span>'}</span></label>`;
        }
        modal('Guardar en la nube', `
          <p style="margin:0 0 8px"><b>${esc(P.nombre)}</b> — ${n} ítem(s), ${kb} KB aprox.</p>
          ${ops}
          <label class="op-slot" style="margin-top:8px"><input type="checkbox" id="gnCandado">
            <span><b>Proteger con una frase</b>
              <span class="mini">Cifra en este equipo el nombre del proyecto, la entidad, la
              ubicación y los cómputos métricos. Al servidor llegan ilegibles.</span></span></label>
          <div id="gnFraseCaja" style="display:none" class="form-g">
            <label>Frase</label>
            <input id="gnFrase" type="password" autocomplete="new-password">
            <p class="mini" style="color:var(--err);margin:4px 0 0">Si la olvida, esos datos no los
            recupera nadie — tampoco quien administra el servidor. El resto del proyecto abre igual.</p>
          </div>
          ${PIE_NUBE}`,
          [['Cancelar', null, 'sec'], ['Guardar', () => {
            const marcado = document.querySelector('input[name=gnSlot]:checked');
            const s = Number(marcado ? marcado.value : elegido);
            const conCandado = $('#gnCandado').checked;
            const frase = conCandado ? ($('#gnFrase').value || '').trim() : '';
            if (conCandado && frase.length < 6) {
              const c = $('#gnFraseCaja');
              if (c) c.insertAdjacentHTML('beforeend',
                '<p class="mini" style="color:var(--err)">La frase necesita al menos 6 caracteres.</p>');
              return false;
            }
            $('#modalPie').innerHTML = '<span class="mini">Guardando…</span>';
            subirProyecto(s, frase, n)
              .then(() => { cerrarModal(); refrescarNube(); pintarNubeInicio(); })
              .catch(e => { cerrarModal(); alert('No se pudo guardar: ' + e.message); });
            return false;
          }]]);
        const chk = $('#gnCandado');
        if (chk) chk.onchange = () => {
          $('#gnFraseCaja').style.display = chk.checked ? '' : 'none';
          if (chk.checked) setTimeout(() => { const i = $('#gnFrase'); if (i) i.focus(); }, 40);
        };
      }).catch(e => alert('No se pudo consultar la nube: ' + e.message));
    },

    /** Trae un proyecto de la nube y reemplaza el que está abierto. */
    abrirNube(slot) {
      if (!hayNube() || !NUBE.conectado()) return ACC.cuenta();
      NUBE.bajarProyecto(slot).then(r => {
        if (!r) return alert('No hay nada guardado en Proyecto ' + slot + '.');
        const traer = frase =>
          NUBE.desempaquetarProyecto(r.payload, frase).then(obj => {
            cerrarInicio();
            abrirTexto(JSON.stringify(obj), '', null);
            marcarGuardado('Traído de la nube · Proyecto ' + r.slot);
          }).catch(e => {
            alert(e.message === 'FRASE_INCORRECTA'
              ? 'La frase no abre este proyecto.'
              : 'No se pudo abrir: ' + e.message);
          });

        const seguir = () => {
          if (!r.protegido) return traer('');
          modal('Proyecto protegido', `
            <p>Este proyecto tiene candado: el nombre, la entidad, la ubicación y los cómputos
            métricos están cifrados.</p>
            <div class="form-g"><label>Frase</label>
              <input id="anFrase" type="password" autocomplete="current-password"></div>
            <p class="mini">Sin la frase se abre igual, pero esos campos vienen vacíos.</p>`,
            [['Abrir sin la frase', () => {
              const copia = JSON.parse(JSON.stringify(r.payload));
              delete copia.candado;
              cerrarInicio();
              abrirTexto(JSON.stringify(copia), '', null);
            }, 'sec'],
            ['Abrir', () => { traer(($('#anFrase').value || '').trim()); return false; }]]);
          setTimeout(() => { const i = $('#anFrase'); if (i) i.focus(); }, 60);
        };

        if (!hayContenido()) return seguir();
        modal('Traer de la nube', `
          <p>Se reemplaza el proyecto abierto (<b>${esc(M.proyecto().nombre)}</b>) por el que está
          guardado como <b>Proyecto ${r.slot}</b>.</p>
          <p class="mini">Lo que está en pantalla se pierde si no lo guardó antes en un
          <code>.boq</code> o en la nube.</p>`,
          [['Cancelar', null, 'sec'], ['Traer y reemplazar', seguir, 'rojo']]);
      }).catch(e => alert('No se pudo traer: ' + e.message));
    },

    borrarNube(slot) {
      if (!hayNube() || !NUBE.conectado()) return ACC.cuenta();
      if (!confirm('¿Quitar de la nube el Proyecto ' + slot +
        '?\n\nLo que está en este equipo no se toca.')) return;
      NUBE.borrarProyecto(slot)
        .then(() => {
          refrescarNube(); pintarNubeInicio();
          marcarGuardado('Proyecto ' + slot + ' liberado');
        })
        .catch(e => alert('No se pudo quitar: ' + e.message));
    },

    /** Reportar un error o mandar una observación. */
    reportar() {
      if (!hayNube())
        return modal('Reportar', '<p>Esta copia no tiene servidor configurado.</p>');
      const u = NUBE.usuario();
      modal('Reportar un error o una observación', `
        <p>Contá qué pasó y en qué pantalla. Si se puede repetir, mejor todavía.</p>
        <div class="form-g">
          <label>Qué pasó</label>
          <textarea id="rpM" rows="5" style="width:100%" placeholder="Ej.: al exportar a Excel el cronograma sale sin fechas"></textarea>
        </div>
        <p class="mini">${u
          ? 'Se manda con su correo <b>' + esc(u.email) + '</b>, para poder responderle.'
          : 'Se manda sin identificar. Si entra con su cuenta, se puede responder.'}</p>
        <p class="mini">Se incluyen el navegador y el tamaño de pantalla. Nada del proyecto.</p>
        <p class="mini" id="rpAviso" style="color:var(--err)"></p>`,
        [['Cancelar', null, 'sec'], ['Enviar', () => {
          const t = ($('#rpM').value || '').trim();
          /* Un reporte tiene que servir para algo: con el mensaje vacio, o con
             unas letras apretadas al azar, no se puede averiguar nada y solo
             ensucia la cola de revision. Dos varas, las dos baratas: largo
             minimo y variedad de caracteres —«2211111…» tiene 50 caracteres
             y dos distintos—. El mismo numero lo repiten js/nube.js y la base
             de datos, que es la que manda. */
          const distintos = new Set(t.toLowerCase().replace(/\s/g, '')).size;
          /* La tercera vara salió del reporte que provoco todo esto:
             «2211111…(50 veces)…falta validar weon». Tiene largo de sobra y
             caracteres distintos de sobra, porque la frase del final los
             aporta. Lo que no tiene ningún mensaje de verdad es una tecla
             apretada ocho veces seguidas. */
          const machaca = /(.)\1{7,}/.test(t);
          const flojo = t.length < 10 ? 'Falta contar qué pasó: escriba al menos una frase.'
            : distintos < 5 ? 'Eso no dice nada: cuente qué estaba haciendo y qué vio.'
            : machaca ? 'Saque las letras o los números repetidos y cuente qué pasó.' : '';
          if (flojo) {
            const av = $('#rpAviso'); if (av) av.textContent = flojo;
            $('#rpM').focus();
            return false;
          }
          $('#modalPie').innerHTML = '<span class="mini">Enviando…</span>';
          NUBE.reportar(t, VERSION, { vista })
            .then(() => { cerrarModal(); marcarGuardado('Reporte enviado — gracias'); })
            .catch(e => { cerrarModal(); alert('No se pudo enviar: ' + e.message); });
          return false;
        }]]);
      setTimeout(() => { const i = $('#rpM'); if (i) i.focus(); }, 60);
    },

    /* --- ayuda --- */
    acerca() {
      modal('Acerca de OpenBOQ',
        '<p><b>OpenBOQ</b> — programa para presupuestos, cómputos métricos y cronograma de obra.</p>' +
        '<p>De código abierto y uso libre.</p>' +
        /* Única mención en toda la aplicación. Va acá y no en el login ni en
           cada guardado: alcanza con que esté escrito en un lugar estable. */
        '<p class="mini" style="border-top:1px solid var(--linea);padding-top:8px">Los análisis que se ' +
        'arman alimentan la Base de Datos común de forma anónima: tipo de insumo, unidad, precio ' +
        'y rendimiento. No se envían cantidades de obra, montos, cómputos, ni el nombre del ' +
        'proyecto o de la entidad.</p>');
    },
    guia() {
      modal('Guía rápida', `<ol style="font-size:12px;line-height:1.6;padding-left:18px">
        <li><b>ARCHIVO → Nuevo proyecto</b>: nombre, entidad y plazo.</li>
        <li><b>BASE DE DATOS</b>: busque la actividad (ej. «hormigón», «revoque»), revísela a la derecha
            y pulse <b>Traer al presupuesto</b>. Ahí puede corregir cantidades y precios, y decidir si
            el cambio se guarda también en la Base de Datos.</li>
        <li><b>PRESUPUESTO</b>: escriba la cantidad de cada ítem. Los totales se recalculan solos.</li>
        <li><b>CÓMPUTOS</b>: cargue las mediciones (n° veces × largo × ancho × alto) y lleve el total a la cantidad.</li>
        <li><b>ANÁLISIS (B-2)</b>: ajuste rendimientos y precios de cada ítem.</li>
        <li><b>INCIDENCIAS</b>: cargas sociales, IVA M.O., herramientas, gastos generales, utilidad e IT.
            Son del proyecto entero: al cambiarlas se recalculan todos los ítems.</li>
        <li><b>INSUMOS (B-3)</b>: cambie el precio de un insumo y se actualiza todo el presupuesto.</li>
        <li><b>CRONOGRAMA</b>: <b>⚙ Generar cronograma</b> arma un solo programa de toda la obra
            —módulo como tarea resumen y cada ítem como actividad— con la duración sacada de las horas
            de mano de obra y encadenado en el orden del presupuesto. Después ajuste duraciones y
            predecesoras como en MS Project.</li>
        <li><b>REPORTES</b>: imprima B-1, B-2, B-3 o guárdelos como PDF (Ctrl+P).</li>
        <li><b>Base de Datos de precios</b>: la aplicación arranca sin ella y funciona igual. Si le
            entregaron la clave, escríbala en <b>BASE DE DATOS → 🔑 Clave</b> (o en
            <b>CONFIGURACIÓN</b>). También puede armar la suya con <b>➕ Nueva base</b> y llenarla
            desde <b>HERRAMIENTAS → Guardar el presupuesto como base de datos</b>.</li>
        <li>El punto de color de la barra inferior indica si la aplicación está comunicada con el
            servidor. Es solo informativo: no bloquea nada.</li>
        <li><b>ARCHIVO → Guardar</b> (Ctrl+S) escribe el <code>.boq</code>; <b>Guardar como…</b>
            (Ctrl+Mayús+S) deja elegir carpeta y nombre. El proyecto también queda en este navegador
            hasta que cree otro o abra un archivo distinto. Puede renombrar o mover el <code>.boq</code>:
            abre igual, el nombre del archivo no forma parte del proyecto.</li>
        <li><b>Su cuenta y la nube</b>: al entrar con una cuenta puede dejar hasta
            <b>tres proyectos</b> guardados en el servidor y seguirlos en otro equipo
            (<b>CONFIGURACIÓN → Mis proyectos en la nube</b>, o la caja de la pantalla de inicio).
            Solo usted los ve. Si además no quiere que quien administra el servidor pueda leer el
            nombre de la obra, la entidad o los cómputos, marque <b>«Proteger con una frase»</b> al
            guardar: esos campos se cifran en su equipo y sin la frase no los abre nadie —usted
            tampoco, así que anótela. Para más de tres proyectos, los archivos <code>.boq</code>
            no tienen límite.</li>
        <li><b>Proyectos traídos de PRESCOM</b>: el presupuesto importado imprime <b>exactamente el
            mismo total</b> que el original. PRESCOM guarda los precios unitarios con dos decimales y
            los subtotales con tres, así que en algunos ítems el centavo del redondeo no se puede
            recalcular; en esos, OpenBOQ conserva el precio del archivo y lo declara en el B-2 como
            <b>«redondeo del archivo de origen»</b>. Al editar el análisis de un ítem vuelve el precio
            calculado, y con <b>HERRAMIENTAS → Recalcular los precios unitarios del archivo
            importado</b> se sueltan todos de una vez.</li>
        <li><b>ARCHIVO → Exportar a PRESCOM (.ddp)</b>: el camino de vuelta. Se puede abrir un
            <code>.ddp</code>, trabajarlo acá y devolverlo a PRESCOM con los cambios; el membrete y
            los formatos del archivo original se conservan. <b>Al revés que el .boq, este archivo no
            se puede renombrar desde Windows</b>: PRESCOM busca los archivos por el nombre del
            <code>.ddp</code>. Para cambiarle el nombre, expórtelo de nuevo con el nombre nuevo.</li>
      </ol>`);
    }
  };

  /* informe de importación */
  function trasImportar(r, archivo) {
    const s = r.resumen;
    manejo = null; sinGuardar = false; sinArchivo = true;   // todavía no hay .boq propio
    M.guardarLocal(); render(); irVista('presupuesto');
    marcarGuardado('Importado ' + hora());
    /* se muestran los totales como el B-1 de PRESCOM; el control usa los otros */
    const tOrig = s.totalOrigenB1 !== undefined ? s.totalOrigenB1 : s.totalOrigen;
    const tRecal = s.totalRecalculadoB1 !== undefined ? s.totalRecalculadoB1 : s.totalRecalculado;
    const dif = Math.abs(tOrig - tRecal);
    /* Un ítem que conserva el precio unitario del archivo NO es un problema:
       es la decisión de respetar el documento original. Lo que sí lo es: que
       el archivo declare un subtotal que sus propios insumos no dan (s.difs). */
    const ok = s.difs === 0;
    modal('Proyecto importado', `
      <p><b>${esc(s.nombre || archivo)}</b></p>
      <table class="rej" style="margin-bottom:10px"><tbody>
        <tr><td>Archivo</td><td>${esc(archivo)}</td></tr>
        <tr><td>Cliente</td><td>${esc(s.cliente || '—')}</td></tr>
        <tr><td>Lugar</td><td>${esc(s.lugar || '—')}</td></tr>
        <tr><td>Módulos / ítems / insumos</td><td>${s.modulos} / ${s.items} / ${s.insumos}</td></tr>
        <tr><td>Tipo de cambio</td><td>${s.tc}</td></tr>
        <tr><td>Recargos leídos del archivo</td><td>cargas ${s.params.cargas}% · IVA M.O. ${s.params.ivaMO}% ·
            herramientas ${s.params.herr}% · G.G. ${s.params.gg}% · utilidad ${s.params.util}% · IT ${s.params.it}%</td></tr>
        <tr><td>Total según el archivo importado</td><td class="num"><b>${M.fmt(tOrig, 2)} Bs</b></td></tr>
        <tr><td>Total recalculado por OpenBOQ</td><td class="num"><b>${M.fmt(tRecal, 2)} Bs</b></td></tr>
        <tr><td>Diferencia</td><td class="num" style="color:${dif < 1 ? 'var(--ok)' : 'var(--err)'}"><b>${M.fmt(dif, 2)} Bs</b></td></tr>
      </tbody></table>
      <p style="color:${ok ? 'var(--ok)' : 'var(--err)'}"><b>${ok
        ? (s.deArchivo
          ? 'Los ' + s.items + ' ítems entraron completos y el presupuesto cierra igual que el original.'
          : 'Los ' + s.items + ' ítems se leyeron con costos y precios unitarios idénticos a los del archivo original.')
        : s.difs + ' ítem(s) del archivo declaran un costo directo que sus propios insumos no dan.'}</b></p>
      ${s.deArchivo ? `<p class="mini"><b>${s.deArchivo} ítem(s) conservan el precio unitario del archivo.</b>
        PRESCOM guarda los subtotales con 3 decimales y el precio unitario con 2; en los ítems cuyo
        precio cae al borde del medio centavo, los dígitos que descartó deciden el redondeo y no están
        en el archivo. Se respeta el precio del documento original —por eso el presupuesto cierra
        igual— y en el B-2 aparece como <b>«redondeo del archivo de origen»</b>. Al editar el análisis
        de un ítem, vuelve el precio calculado.</p>` : ''}
      ${(s.incoherentes || []).length ? `<p class="mini" style="color:var(--err)"><b>${s.incoherentes.length}
        ítem(s) del archivo no cuadran consigo mismos:</b> el subtotal que declara el
        <code>.PRE</code> no es el que sale de sus propios insumos del <code>.DAT</code>. Pasa cuando
        PRESCOM guardó el análisis y algo cambió después sin recalcularlo. No se puede reproducir —
        faltaría un insumo que no está en el archivo—, así que conviene revisar esos análisis en el
        original.</p>
        <ul style="font-size:11px;padding-left:16px">${s.incoherentes.slice(0, 6).map(x =>
        `<li>«${esc(x.desc)}»: declara ${M.fmt(x.arch.m + x.arch.o + x.arch.e, 2)} y sus insumos suman
           ${M.fmt(x.calc.m + x.calc.o + x.calc.e, 2)} — ${M.fmt(Math.abs(x.falta), 2)} Bs sin
           respaldo</li>`).join('')}</ul>` : ''}
      ${ok ? '' : '<ul style="font-size:11px;padding-left:16px">' + s.avisos.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul>'}
      <p class="mini">El archivo original no se modificó. Guarde este proyecto con
      <b>ARCHIVO → Guardar</b> para conservarlo como <code>.boq</code>.</p>
      <p class="mini">Cuando termine de editarlo puede devolverlo a PRESCOM con
      <b>ARCHIVO → Exportar a PRESCOM (.ddp)</b>: el membrete, los rótulos y los formatos de este
      archivo se guardan y vuelven intactos.</p>
      <p class="mini">Los ítems de un PRESCOM sirven para los proyectos que vengan: puede guardarlos
      como base de datos propia. Se propone una base nueva con el nombre del archivo —cada origen en
      su base— para no mezclarlos con lo que ya tenga guardado.</p>`,
      [['Cerrar', null, 'sec'],
      ['Guardar como base de datos…', () => setTimeout(() => ACC.proyectoABase(baseDeArchivo(archivo)), 80)]]);
  }

  /* Guarda el .ddp. Donde el navegador lo permite (Chrome, Edge) se abre el
     diálogo «Guardar como» del sistema y el nombre que el usuario elige ahí
     es el que se escribe adentro del contenedor: es la única forma de que el
     nombre del archivo y el de los trece archivos internos no se separen
     nunca, que es lo que hace que PRESCOM no reconozca un proyecto. */
  async function bajarPrescom(nombre) {
    let destino = null, base = EXPORTADOR.nombreInterno(nombre);
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        destino = await window.showSaveFilePicker({
          suggestedName: base + '.ddp',
          types: [{ description: 'Proyecto de PRESCOM', accept: { 'application/octet-stream': ['.ddp'] } }]
        });
        base = EXPORTADOR.nombreInterno(destino.name);
      }
    } catch (e) { return; }        // el usuario canceló el diálogo
    try {
      marcarGuardado('Armando el archivo de PRESCOM…');
      const r = await EXPORTADOR.ddp({ nombre: base });
      if (!r.datos) { alert('No se pudo exportar:\n' + r.errores.join('\n')); return; }
      if (destino) {
        const f = await destino.createWritable();
        await f.write(r.datos); await f.close();
      } else {
        REP.descargar(r.nombre + '.ddp', r.datos, 'application/octet-stream');
      }
      M.guardarLocal();            // queda anotado el nombre con que se exportó
      marcarGuardado('Exportado a PRESCOM como ' + r.nombre + '.ddp · ' + hora());
    } catch (e) {
      alert('No se pudo exportar a PRESCOM:\n' + e.message);
      marcarGuardado('');
    }
  }

  /** Nombre de base propuesto para un archivo importado. */
  const baseDeArchivo = a =>
    'PRESCOM — ' + String(a || 'importado').replace(/\.[^.]+$/, '').trim();

  /* ---------------------------------------------------------------------
     GUARDAR EL PRESUPUESTO EN UNA BASE PROPIA

     Un archivo de PRESCOM trae ítems que sirven para los proyectos que
     vengan; el volcado es lo que los convierte en biblioteca. Dos cuidados:
     se elige QUÉ ítems entran, y cuando la base ya tiene un análisis con la
     misma descripción se pregunta —antes reemplazaba en silencio, así que
     dos proyectos con «HORMIGÓN H21» a precios distintos dejaban uno solo.
     --------------------------------------------------------------------- */

  /** Costo directo de un análisis en el formato de las bases propias. */
  const costoPay = pay =>
    (pay.c || []).reduce((s, c) => s + (Number(c.q) || 0) * (Number(c.p) || 0), 0);

  /** Cierre del volcado: refresca la pestaña y cuenta lo que entró. */
  function finVolcado(r) {
    llenarBases(); buscarBase(); render();
    /* Lo que el usuario decide guardar en su base es lo que considera
       que vale la pena conservar: es el momento honesto para aportarlo
       a la común. Solo la parte técnica, y anónimo. */
    aportarDelProyecto();
    const partes = [`<b>${r.nuevos}</b> ítem(s) nuevos`];
    if (r.actualizados) partes.push(`<b>${r.actualizados}</b> reemplazado(s)`);
    if (r.copias) partes.push(`<b>${r.copias}</b> guardado(s) como copia`);
    if (r.omitidos) partes.push(`<b>${r.omitidos}</b> omitido(s)`);
    setTimeout(() => modal('Guardado en la base',
      `<p>En <b>${esc(r.base)}</b>: ${partes.join(', ')}.</p>`), 80);
  }

  /** Qué hacer con los análisis que la base ya tiene con la misma descripción. */
  function resolverVolcado(idBase, ids, ch) {
    modal('Análisis repetidos', `
      <p><b>${ch.length}</b> análisis del presupuesto ya están en la base con la misma
      descripción, pero con otros datos. Elija qué hacer con cada uno.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <span class="mini">Aplicar a todos:</span>
        <button class="btn sec" type="button" data-todos="reemplazar">Reemplazar</button>
        <button class="btn sec" type="button" data-todos="ambos">Guardar los dos</button>
        <button class="btn sec" type="button" data-todos="omitir">Dejar el de la base</button>
      </div>
      <div style="max-height:320px;overflow:auto"><table class="rej"><thead><tr>
        <th>ANÁLISIS</th><th style="width:90px">EN LA BASE</th><th style="width:90px">PRESUPUESTO</th>
        <th style="width:210px">QUÉ HACER</th></tr></thead><tbody>` +
      ch.map((c, k) => `<tr><td>${esc(c.pay.d)}<div class="mini">${esc(c.pay.u)}</div></td>
        <td class="num">${M.fmt(costoPay(c.apu), 2)}</td>
        <td class="num">${M.fmt(costoPay(c.pay), 2)}</td>
        <td class="mini">
          <label style="display:block"><input type="radio" name="cf${k}" value="reemplazar" checked>
            Reemplazar el de la base</label>
          <label style="display:block"><input type="radio" name="cf${k}" value="ambos">
            Guardar los dos</label>
          <label style="display:block"><input type="radio" name="cf${k}" value="omitir">
            Dejar el de la base</label>
        </td></tr>`).join('') +
      `</tbody></table></div>
      <p class="mini">«Guardar los dos» deja el análisis que ya estaba y guarda el del presupuesto
      con la descripción numerada, para poder compararlos después.</p>`,
      [['Cancelar', null, 'sec'], ['Guardar en la base', () => {
        const dec = {};
        ch.forEach((c, k) => {
          const r = $$('#modalCuerpo input[name="cf' + k + '"]').find(x => x.checked);
          dec[c.it.id] = r ? r.value : 'reemplazar';
        });
        finVolcado(M.volcarProyectoABase(idBase, { ids, decisiones: dec }));
      }]]);
    $('#modalCuerpo').addEventListener('click', ev => {
      const b = ev.target.closest('[data-todos]'); if (!b) return;
      $$('#modalCuerpo input[type="radio"]').forEach(r => { r.checked = r.value === b.dataset.todos; });
    });
  }

  function mostrarCambiosPrecio(cambios, base) {
    if (!cambios.length) return modal('Actualizar precios', '<p>No se encontraron insumos coincidentes con precio distinto en <b>' + esc(base.n) + '</b>.</p>');
    const h = '<p>Coincidencias en <b>' + esc(base.n) + '</b>: <b>' + cambios.length + '</b></p>' +
      '<div style="max-height:340px;overflow:auto"><table class="rej"><thead><tr><th></th><th>INSUMO</th><th>UND.</th>' +
      '<th>ACTUAL</th><th>NUEVO</th><th>VAR. %</th></tr></thead><tbody>' +
      cambios.map((c, k) => `<tr><td class="ctr"><input type="checkbox" data-cp="${k}" checked></td>
        <td>${esc(c.x.d)}</td><td class="ctr">${esc(c.x.u)}</td>
        <td class="num">${M.fmt(c.x.p, 2)}</td><td class="num">${M.fmt(c.nuevo, 2)}</td>
        <td class="num" style="color:${c.nuevo > c.x.p ? 'var(--err)' : 'var(--ok)'}">${c.x.p ? ((c.nuevo - c.x.p) / c.x.p * 100).toFixed(1) : '—'}</td></tr>`).join('') +
      '</tbody></table></div>';
    modal('Actualizar precios — revisión', h, [['Cancelar', null, 'sec'], ['Aplicar seleccionados', () => {
      let n = 0;
      probando('insumos');
      $$('#modalCuerpo input[data-cp]').forEach(ch => {
        if (ch.checked) { M.fijarPrecio(cambios[+ch.dataset.cp].x, cambios[+ch.dataset.cp].nuevo); n++; }
      });
      render();
      setTimeout(() => alert(n + ' precio(s) actualizado(s).'), 100);
    }]]);
  }

  /* ===================== NAVEGACIÓN ===================== */
  function irVista(v) {
    vista = v;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $$('.vista').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
    if (v === 'base' && !resBase.length) buscarBase();
    if (v === 'analisis') renderAnalisis();
    if (v === 'incidencias') renderIncidencias();
    if (v === 'computos') renderComputos();
    if (v === 'cronograma') { renderCrono(); renderRecursos(); }
    if (v === 'insumos') renderInsumos();
  }

  /** Subpestañas del cronograma: PROGRAMACIÓN y RECURSOS. */
  function irCrono(sub) {
    irVista('cronograma');
    $$('#subCrono button').forEach(b => b.classList.toggle('on', b.dataset.s === sub));
    $$('#v-cronograma .sub').forEach(s => s.classList.toggle('on', s.id === 's-' + sub));
    if (sub === 'recursos') renderRecursos(); else renderCrono();
  }

  /* ===================== EVENTOS ===================== */
  function conectarEventos() {
    // menús
    $('#menubar').addEventListener('click', e => {
      const m = e.target.closest('.m');
      if (m) { m.classList.contains('abierto') ? cerrarMenus() : abrirMenu(m.dataset.menu, m); return; }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.menubar')) cerrarMenus();
      const a = e.target.closest('[data-acc]');
      // data-acc-arg permite que un mismo botón sirva a varias secciones
      // (por ejemplo «Agregar insumo» abriendo ya la pestaña de mano de obra)
      if (!a || !ACC[a.dataset.acc]) return;
      cerrarMenus();
      ACC[a.dataset.acc](a.dataset.accArg);
    });

    /* archivos del Drive: el botón se pinta dentro de «Mi cuenta» */
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-drive-abrir]');
      if (a) return ACC.driveAbrir(a.dataset.driveAbrir);
      const q = e.target.closest('[data-drive-borrar]');
      if (q) ACC.driveBorrar(q.dataset.driveBorrar);
    });

    /* proyectos de la nube: aparecen en la pantalla de inicio y en el
       diálogo «Mis proyectos», así que el clic se escucha una sola vez acá */
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-nube-abrir],[data-nube-guardar],[data-nube-borrar]');
      if (!b) return;
      if (b.dataset.nubeAbrir) ACC.abrirNube(Number(b.dataset.nubeAbrir));
      else if (b.dataset.nubeGuardar) ACC.guardarNube(Number(b.dataset.nubeGuardar));
      else if (b.dataset.nubeBorrar) ACC.borrarNube(Number(b.dataset.nubeBorrar));
    });

    /* pantalla de inicio: cualquier opción elegida la cierra. Va antes que el
       manejador de arriba —el clic sube desde acá— así que la aplicación queda
       a la vista mientras el diálogo de la acción se abre encima.
       Lo marcado con data-ini-queda es la excepción: el botón del tema cambia
       el color de la propia pantalla y cerrarla sería no dejarlo ver. */
    $('#inicio').addEventListener('click', e => {
      const perfil = e.target.closest('[data-perfil]');
      if (perfil) {
        const nuevo = perfil.dataset.perfil === 'nuevo';
        fijarModo(nuevo ? 'simple' : 'completo', !nuevo);
        const caja = $('#iniPerfil');
        caja.innerHTML = nuevo
          ? '<b>Listo: interfaz simple.</b> <span class="mini">Empiece con «Empezar en blanco» y después busque los ítems. CONFIGURACIÓN → «Interfaz simple / completa» muestra la interfaz completa.</span>'
          : '<b>Listo: interfaz completa.</b> <span class="mini">La misma organización de PRESCOM. CONFIGURACIÓN → «Interfaz simple / completa» la simplifica.</span>';
        return;
      }
      if (e.target.closest('[data-ini-queda]')) return;
      if (e.target.closest('[data-ini-cerrar]') || e.target.closest('[data-acc]')) cerrarInicio();
    });

    // pestañas y subpestañas
    /* al salir de una pestaña donde se estaban probando cambios, se pregunta */
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (ensayo && b.dataset.v === vista) return;
      salirDeEnsayo(() => irVista(b.dataset.v));
    });
    $('#subCrono').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (ensayo && b.classList.contains('on')) return;
      salirDeEnsayo(() => irCrono(b.dataset.s));
    });

    // cabecera
    $('#selModulo').addEventListener('change', e => { M.proyecto().moduloActivo = +e.target.value; render(); });
    $('#selPrecision').addEventListener('change', e => { M.proyecto().precision = +e.target.value; tocar(); render(); });
    $('#selMoneda').addEventListener('change', e => { M.proyecto().moneda = e.target.value; tocar(); render(); });
    $('#inpTC').addEventListener('change', e => { M.proyecto().tc = +e.target.value || 6.96; tocar(); render(); });
    $('#selBase').addEventListener('change', e => { $('#selBaseFiltro').value = e.target.value; buscarBase(); });
    $('#buscaPres').addEventListener('input', renderPresupuesto);

    // presupuesto: edición en línea y selección
    $('#tblPresupuesto').addEventListener('input', e => {
      const tr = e.target.closest('tr[data-item]'); if (!tr) return;
      const it = M.getItem(tr.dataset.item); if (!it) return;
      const c = e.target.dataset.campo;
      if (!c) return;
      probando('presupuesto');
      if (c === 'cant') it.cant = Number(e.target.value) || 0;
      else it[c] = e.target.value;
      if (c === 'cant') { actualizarFila(tr, it); barraEstado(); renderModulos(); }
    });
    $('#tblPresupuesto').addEventListener('change', e => {
      if (e.target.dataset.campo && e.target.dataset.campo !== 'cant') { renderSelectItems(); }
      /* La descripción se revisa al salir del campo y no en cada tecla:
         mientras se escribe, media descripción siempre parece incompleta.
         Acá se avisa y se marca, pero no se revierte lo tipeado — quien
         edita sabe lo que quiere y borrarle el texto sería peor. El filtro
         que de verdad protege la base común está en el envío del aporte. */
      if (e.target.dataset.campo !== 'desc') return;
      const rev = M.revisarDescripcion(e.target.value);
      e.target.style.borderColor = rev.nivel === 'bloqueo' ? 'var(--err)' : '';
      if (rev.nivel === 'bloqueo')
        marcarGuardado('La descripción ' + rev.motivo + ' — conviene dejarla genérica', true);
    });
    $('#tblPresupuesto').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { M.proyecto().itemSel = del.dataset.del; ACC.delItem(); return; }
      const tr = e.target.closest('tr[data-item]');
      if (tr) {
        M.proyecto().itemSel = tr.dataset.item;
        $$('#tblPresupuesto tr').forEach(x => x.classList.remove('sel'));
        tr.classList.add('sel');
        $('#selItemAnalisis').value = tr.dataset.item;
        $('#selItemComputo').value = tr.dataset.item;
      }
    });
    /* Doble clic en una fila del presupuesto = abrir su análisis (B-2), el
       mismo gesto que en el B-3 abre el detalle del insumo.
       Incluye la DESCRIPCIÓN, que es un `<input>`: como todos los `<input>`
       quedaban afuera, doble clic sobre el nombre —lo primero que uno intenta—
       no hacía nada. UND. y CANTIDAD siguen afuera: ahí el doble clic sirve
       para seleccionar el número y corregirlo. */
    $('#tblPresupuesto').addEventListener('dblclick', e => {
      const tr = e.target.closest('tr[data-item]');
      if (!tr) return;
      if (e.target.matches('input') && e.target.dataset.campo !== 'desc') return;
      /* abrir el análisis de un ítem es deliberado: lo que se estaba probando
         en el presupuesto se guarda y se sigue, sin cortar con un aviso */
      if (ensayo) guardarEnsayo();
      /* sin esto queda el texto de la descripción seleccionado atrás */
      if (e.target.blur) e.target.blur();
      M.proyecto().itemSel = tr.dataset.item;
      $('#selItemAnalisis').value = tr.dataset.item;
      irVista('analisis'); renderAnalisis();
    });

    // módulos (pestañas inferiores)
    $('#barraModulos').addEventListener('click', e => {
      const t = e.target.closest('.mtab'); if (!t) return;
      if (t.dataset.mod === 'nuevo') return ACC.nuevoModulo();
      M.proyecto().moduloActivo = +t.dataset.mod; render();
    });

    // base de datos
    $('#buscaBase').addEventListener('keydown', e => { if (e.key === 'Enter') buscarBase(); });
    let tBusq;
    $('#buscaBase').addEventListener('input', () => { clearTimeout(tBusq); tBusq = setTimeout(buscarBase, 320); });
    $('#selBaseFiltro').addEventListener('change', buscarBase);
    $('#chkTodasBases').addEventListener('change', buscarBase);
    $('#listaBase').addEventListener('click', e => {
      const li = e.target.closest('li'); if (li) mostrarApuBase(+li.dataset.k);
    });
    $('#listaBase').addEventListener('dblclick', e => {
      const li = e.target.closest('li'); if (li) { mostrarApuBase(+li.dataset.k); ACC.insertarApu(); }
    });

    /* Pasar al análisis de otro ítem con cambios sin guardar PREGUNTA, igual
       que salir de la pestaña. Antes se guardaba solo y en silencio: quien
       tocaba un rendimiento sin querer y cambiaba de ítem se llevaba el cambio
       aplicado al proyecto sin enterarse.
       «Descartar» es seguro acá: la copia se tomó antes de tocar el ítem
       anterior, y el ítem que se está por abrir todavía no se editó. */
    $('#selItemAnalisis').addEventListener('change', e => {
      const nuevo = e.target.value;
      const abrir = () => {
        e.target.value = nuevo;
        M.proyecto().itemSel = nuevo;
        renderAnalisis();
      };
      if (ensayo && ensayo.clave === 'analisis') {
        /* La lista vuelve al ítem anterior mientras se decide: si elige
           «Seguir editando», no puede quedar mostrando un ítem que no se
           abrió. */
        e.target.value = M.proyecto().itemSel || nuevo;
        return salirDeEnsayo(abrir);
      }
      abrir();
    });
    $('#cuerpoB2').addEventListener('input', e => {
      const it = M.getItem($('#selItemAnalisis').value); if (!it) return;
      const t = e.target;
      if (!t.dataset.b2 && !t.dataset.rend && !t.dataset.precio) return;
      probando('analisis');
      if (t.dataset.b2) {
        if (t.dataset.b2 === 'cant') it.cant = Number(t.value) || 0; else it[t.dataset.b2] = t.value;
      } else if (t.dataset.rend) {
        const c = it.comp.find(c => c.ins === t.dataset.rend); if (c) c.rend = Number(t.value) || 0;
      } else {
        const i = M.proyecto().insumos[t.dataset.precio]; if (i) M.fijarPrecio(i, t.value);
      }
      clearTimeout(tB2); tB2 = setTimeout(() => { const f = document.activeElement; const k = clave(f); renderAnalisis(); restaurar(k); barraEstado(); renderPresupuesto(); renderModulos(); }, 420);
    });
    $('#cuerpoB2').addEventListener('click', e => {
      const q = e.target.closest('[data-quita]'); if (!q) return;
      const it = M.getItem($('#selItemAnalisis').value); if (!it) return;
      probando('analisis');
      it.comp = it.comp.filter(c => c.ins !== q.dataset.quita);
      renderAnalisis(); renderPresupuesto(); barraEstado();
    });

    // insumos B-3
    $('#buscaInsumo').addEventListener('input', renderInsumos);
    $('#filtroTipoInsumo').addEventListener('change', renderInsumos);
    $('#verSinUso').addEventListener('change', renderInsumos);
    /* En el B-3 SOLO se edita el precio. La descripción y la unidad son las que
       traen los análisis: cambiarlas acá renombraba el insumo en todos los ítems
       de golpe, sin ver a cuáles afectaba. Se editan en el análisis del ítem. */
    let tIns;
    $('#tblInsumos').addEventListener('input', e => {
      const P = M.proyecto(), t = e.target;
      const id = t.dataset.insP;
      if (!id || !P.insumos[id]) return;
      probando('insumos');
      M.fijarPrecio(P.insumos[id], t.value);   // escribirlo a mano lo fecha
      clearTimeout(tIns); tIns = setTimeout(() => {
        const k = clave(document.activeElement);
        renderInsumos(); restaurar(k); renderPresupuesto(); renderModulos(); barraEstado();
      }, 500);
    });
    /* Un insumo NO se borra desde acá: el B-3 es el resumen de lo que consumen
       los análisis, así que se quita desde el análisis del ítem que lo usa.
       El doble clic sobre la descripción abre/cierra el detalle de usos. */
    $('#tblInsumos').addEventListener('dblclick', e => {
      const t = e.target.closest('[data-ins-d]'); if (!t) return;
      const id = t.dataset.insD;
      if (usosAbiertos.has(id)) usosAbiertos.delete(id); else usosAbiertos.add(id);
      const k = clave(document.activeElement);
      renderInsumos(); restaurar(k);
    });
    $('#tblInsumos').addEventListener('click', e => {
      const c = e.target.closest('[data-cerraruso]'); if (!c) return;
      usosAbiertos.delete(c.dataset.cerraruso);
      renderInsumos();
    });

    /* incidencias: cambian el proyecto entero, no un ítem.
       Con el formato oficial solo llegan porcentajes y se escriben en
       `P.params`, como toda la vida. Con un formato propio llega además el
       nombre, el «cómo» y el «sobre qué», y se escriben en la fila. */
    let tInc;
    $('#cuerpoIncidencias').addEventListener('input', e => {
      const t = e.target, nro = Number(t.dataset.fmt);
      if (!nro) return;
      const campo = t.dataset.f;
      probando('incidencias');            // la copia de respaldo va ANTES de tocar nada
      if (M.formatoEsOficial()) {
        /* el oficial se arma de `P.params`: se escribe ahí, no en la copia */
        const f = M.formato().filas[nro - 1];
        if (campo === 'pct' && f && f.p) M.proyecto().params[f.p] = Number(t.value) || 0;
      } else {
        const f = M.formato().filas[nro - 1];
        if (!f) return;
        if (campo === 'n') f.n = t.value;
        else if (campo === 'pct') f.pct = Number(t.value) || 0;
        else if (campo === 'sobre') f.sobre = leerSobre(t.value);
      }
      /* se espera a que termine de escribir antes de recalcular */
      clearTimeout(tInc); tInc = setTimeout(() => {
        const f = clave(document.activeElement);
        render(); restaurar(f);
      }, 900);
    });
    /* el «cómo» (porcentaje o subtotal) es un desplegable: cambia de golpe */
    $('#cuerpoIncidencias').addEventListener('change', e => {
      const nro = Number(e.target.dataset.fmt);
      if (!nro || e.target.dataset.f !== 'k' || M.formatoEsOficial()) return;
      probando('incidencias');
      const f = M.formato().filas[nro - 1];
      if (!f) return;
      f.k = e.target.value === 'sum' ? 'sum' : 'pct';
      if (f.k === 'pct' && !isFinite(Number(f.pct))) f.pct = 0;
      render();
    });
    /* el listado de formatos: aplicar, renombrar, quitar */
    $('#cuerpoIncidencias').addEventListener('click', e => {
      const ren = e.target.closest('[data-renfmt]');
      const del = e.target.closest('[data-delfmt]');
      const usar = e.target.closest('[data-usarfmt]');

      if (ren) { ACC.renombrarFormato(ren.dataset.renfmt); return; }
      if (del) { ACC.quitarFormato(del.dataset.delfmt); return; }
      if (!usar) return;

      const id = usar.dataset.usarfmt;
      if (id === (M.formato().id || '')) return;          // ya es el aplicado
      probando('incidencias');
      M.usarFormato(id === M.ID_SABS ? null : id);
      render(); irVista('incidencias');
    });

    /* subir, bajar y quitar filas */
    $('#cuerpoIncidencias').addEventListener('click', e => {
      const mov = e.target.closest('[data-fmtmov]');
      const del = e.target.closest('[data-fmtdel]');
      if (!mov && !del) return;
      if (M.formatoEsOficial()) return;
      const F = M.formato().filas;
      const i = Number((mov || del).dataset[mov ? 'fmtmov' : 'fmtdel']) - 1;
      if (!(i >= 0 && i < F.length) || F[i].k === 'ent') return;
      probando('incidencias');
      if (mov) {
        const j = i + Number(mov.dataset.dir);
        if (j < 3 || j >= F.length) return;      // las tres entradas no se mueven
        conReferenciasEstables(F, () => { const t = F[i]; F[i] = F[j]; F[j] = t; });
      } else {
        conReferenciasEstables(F, () => { F.splice(i, 1); });
      }
      render();
    });

    // cómputos — mismo criterio que en el B-2 al cambiar de ítem
    $('#selItemComputo').addEventListener('change', () => {
      if (ensayo && ensayo.clave === 'computos') guardarEnsayo();
      renderComputos();
    });
    let tCo;
    $('#cuerpoComputos').addEventListener('input', e => {
      const it = M.getItem($('#selItemComputo').value); if (!it) return;
      const t = e.target; if (t.dataset.comp === undefined) return;
      const row = it.computos[+t.dataset.comp]; if (!row) return;
      probando('computos');
      row[t.dataset.c] = t.dataset.c === 'd' ? t.value : (t.value === '' ? '' : Number(t.value));
      clearTimeout(tCo); tCo = setTimeout(() => { const k = clave(document.activeElement); renderComputos(); restaurar(k); }, 420);
    });
    $('#cuerpoComputos').addEventListener('click', e => {
      const d = e.target.closest('[data-delcomp]'); if (!d) return;
      const it = M.getItem($('#selItemComputo').value); if (!it) return;
      probando('computos');
      it.computos.splice(+d.dataset.delcomp, 1); renderComputos();
    });

    // recursos: trenes de trabajo
    let tRec;
    const repintarRecursos = () => {
      clearTimeout(tRec); tRec = setTimeout(() => {
        const k = clave(document.activeElement);
        renderRecursos(); restaurar(k);
      }, 900);
    };
    $('#inpTope').addEventListener('change', e => {
      probando('recursos');
      M.proyecto().crono.topeDias = Math.max(1, Number(e.target.value) || 180);
      renderRecursos();
    });
    $('#cuerpoRecursos').addEventListener('input', e => {
      const t = e.target, d = t.dataset;
      if (d.trenN === undefined && d.trenR === undefined && d.actRec === undefined) return;
      probando('recursos');
      if (d.trenN !== undefined || d.trenR !== undefined) {
        const tr = M.trenes().find(x => x.id === (d.trenN || d.trenR)); if (!tr) return;
        if (d.trenN !== undefined) tr.n = t.value;
        else tr.rec = Math.max(1, Number(t.value) || M.REC_DEF);
      } else if (d.actRec !== undefined) {
        const it = M.getItem(d.actRec); if (!it) return;
        it.rec = t.value === '' ? null : Math.max(1, Number(t.value) || M.REC_DEF);
      }
      repintarRecursos();
    });
    $('#cuerpoRecursos').addEventListener('change', e => {
      const id = e.target.dataset.actTren; if (id === undefined) return;
      const it = M.getItem(id); if (!it) return;
      probando('recursos');
      it.tren = e.target.value; renderRecursos();
    });
    $('#cuerpoRecursos').addEventListener('click', e => {
      const b = e.target.closest('[data-deltren]'); if (!b) return;
      const tr = M.trenes().find(x => x.id === b.dataset.deltren); if (!tr) return;
      modal('Eliminar tren', `<p>Se elimina <b>${esc(tr.n)}</b> y sus actividades vuelven al primer
        tren.</p>`, [['Cancelar', null, 'sec'], ['Eliminar', () => {
          M.eliminarTren(tr.id); aplicar(); render();
        }, 'rojo']]);
    });

    // cronograma
    $('#inpInicioObra').addEventListener('change', e => {
      probando('cronograma');
      M.proyecto().inicioObra = e.target.value || M.hoyISO(); renderCrono();
    });
    [['#inpJornada', 'jornada'], ['#inpCuadrillas', 'cuadrillas'], ['#inpDiasSemana', 'diasSemana']]
      .forEach(([sel, campo]) => $(sel).addEventListener('change', e => {
        probando('cronograma');
        M.proyecto().crono[campo] = Number(e.target.value) || M.CRONO_DEF[campo];
        renderCrono();
      }));
    /* duración y predecesoras: cada cambio reprograma toda la obra */
    $('#cuerpoCrono').addEventListener('input', e => {
      const t = e.target;
      const id = t.dataset.dur !== undefined ? t.dataset.dur : t.dataset.pred;
      if (id === undefined) return;
      const it = M.getItem(id); if (!it) return;
      probando('cronograma');
      if (t.dataset.dur !== undefined) it.dias = Math.max(1, Number(t.value) || 1);
      else it.pred = t.value;
      clearTimeout(tCo); tCo = setTimeout(() => {
        M.programar();
        const k = clave(document.activeElement);
        renderCrono(); restaurar(k); barraEstado();
      }, 900);
    });

    // modal
    /* Matriz análisis × insumo: cada casilla escribe un rendimiento.
       Se repinta con retardo —igual que el B-3 y las incidencias— para no
       recalcular el presupuesto entero con cada tecla, y se devuelve el foco
       a la casilla donde estaba. */
    let tMz;
    $('#modalCuerpo').addEventListener('input', e => {
      const t = e.target;
      if (!t.dataset || !t.dataset.mzIns) return;
      probando('presupuesto');
      M.fijarRendimiento(t.dataset.mzItem, t.dataset.mzIns, t.value);
      clearTimeout(tMz); tMz = setTimeout(() => {
        const ins = t.dataset.mzIns, it = t.dataset.mzItem, sel = t.selectionStart;
        pintarMatriz();
        renderPresupuesto(); renderModulos(); barraEstado();
        const el = document.querySelector('[data-mz-ins="' + ins + '"][data-mz-item="' + it + '"]');
        if (el) { el.focus(); try { el.setSelectionRange(sel, sel); } catch (x) { } }
      }, 600);
    });

    $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') cerrarModal(); });

    // abrir archivo
    $('#fileAbrir').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => abrirTexto(rd.result, f.name, null);
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    });

    /* comparar contra otro .boq: entra por su propio campo, nunca por el de
       abrir, para que un archivo elegido acá no reemplace el proyecto */
    $('#fileComparar').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => compararTexto(rd.result, f.name);
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    });

    // importar .ddp
    $('#fileDDP').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        marcarGuardado('Leyendo ' + f.name + '…');
        const r = await IMPORTADOR.importarDDP(await f.arrayBuffer());
        trasImportar(r, f.name);
      } catch (err) { alert('No se pudo leer el proyecto:\n' + err.message); }
    });

    // abrir archivos sueltos .PRE/.IND/.DAT/…
    $('#fileSueltos').addEventListener('change', async e => {
      const fs = Array.from(e.target.files); e.target.value = '';
      if (!fs.length) return;
      try {
        const por = {}, nombres = {};
        for (const f of fs) {
          const ext = (f.name.split('.').pop() || '').toUpperCase();
          por[ext] = await f.arrayBuffer();
          nombres[ext] = f.name;
        }
        trasImportar(IMPORTADOR.importarSueltos(por, nombres), fs[0].name);
      } catch (err) { alert('No se pudieron leer los archivos:\n' + err.message); }
    });

    // atajos
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); ACC.guardarComo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); ACC.guardar(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); ACC.nuevo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); ACC.abrir(); }
      else if (e.key === 'F3') { e.preventDefault(); ACC.irBase(); }
      else if (e.key === 'Escape') { cerrarMenus(); cerrarModal(); cerrarInicio(); }
      else if (e.key === 'Insert' && !e.target.matches('input,textarea,select')) { e.preventDefault(); ACC.nuevoItem(); }
    });

    /* Al cerrar la pestaña: el proyecto queda guardado en el navegador, pero si
       todavía no se escribió en un .boq el navegador pregunta antes de salir. */
    window.addEventListener('beforeunload', e => {
      if (!ensayo) M.guardarLocal();   // lo que se estaba probando no se guarda
      else { e.preventDefault(); e.returnValue = ''; }
      if (hayContenido() && sinArchivo) { e.preventDefault(); e.returnValue = ''; }
    });
  }
  let tB2;

  /* actualiza en caliente una fila del presupuesto sin re-renderizar toda la tabla */
  function actualizarFila(tr, it) {
    const a = M.analisis(it);
    const tds = tr.querySelectorAll('td');
    tds[4].textContent = M.fmt(M.conv(a.pu));
    tds[5].innerHTML = '<b>' + M.fmt(M.conv(M.parcialGeneral(it))) + '</b>';
    tds[6].textContent = M.fmt(M.conv(a.mat * it.cant));
    tds[7].textContent = M.fmt(M.conv(a.totalMO * it.cant));
    tds[8].textContent = M.fmt(M.conv(a.totalEQ * it.cant));
  }

  /* conserva el foco al re-renderizar */
  function clave(el) {
    if (!el || !el.dataset) return null;
    const d = el.dataset;
    const k = ['rend', 'precio', 'fmt', 'insP', 'comp', 'dur', 'pred',
      'trenN', 'trenR', 'actRec', 'b2', 'campo'].find(x => d[x] !== undefined);
    /* `data-f` distingue las casillas de una misma fila del editor de
       incidencias (nombre, porcentaje, sobre qué): sin él, al repintar el
       foco saltaba de la casilla del porcentaje a la del nombre. */
    return k ? { k, v: d[k], c: d.c, f: d.f, sel: el.selectionStart } : null;
  }
  function restaurar(k) {
    if (!k) return;
    const attr = { rend: 'data-rend', precio: 'data-precio', fmt: 'data-fmt',
      insP: 'data-ins-p', comp: 'data-comp', dur: 'data-dur', pred: 'data-pred',
      trenN: 'data-tren-n', trenR: 'data-tren-r', actRec: 'data-act-rec',
      b2: 'data-b2', campo: 'data-campo' }[k.k];
    let sel = `[${attr}="${k.v}"]`;
    if (k.c) sel += `[data-c="${k.c}"]`;
    if (k.f) sel += `[data-f="${k.f}"]`;
    const el = document.querySelector(sel);
    if (el) { el.focus(); try { el.setSelectionRange(k.sel, k.sel); } catch (e) { } }
  }

  let _arrancado = false;
  const arrancar = () => { if (_arrancado) return; _arrancado = true; init(); };
  document.addEventListener('DOMContentLoaded', arrancar);
  if (document.readyState !== 'loading') arrancar();
})();
