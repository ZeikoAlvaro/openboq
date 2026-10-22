/* =========================================================================
   OpenBOQ — métricas de uso (Plausible)
   -------------------------------------------------------------------------
   Para qué: el panel de administración ve solo a quien entra con su cuenta
   (versión, perfil, resumen del Drive). Quien usa OpenBOQ sin iniciar
   sesión no deja rastro en ningún lado, y es la mayoría. Plausible cuenta
   visitas y acciones de TODOS, y cada evento lleva la marca `cuenta`
   (si / no) para separar a los invitados de los que entraron.

   Qué se manda: la página, el país (Plausible lo saca de la IP y la
   descarta), el navegador y el nombre de la acción. NUNCA el contenido del
   proyecto, nombres, montos, correos ni el identificador de la cuenta.
   Plausible no usa cookies ni guarda nada en el navegador.

   Qué se mide:
     - la visita (pageview automático al cargar);
     - cada pestaña que se abre, como página virtual /vista/<nombre>: así
       sale en «Páginas principales» sin necesitar propiedades
       personalizadas en el plan de Plausible;
     - las acciones de la lista ACCIONES, como evento con nombre propio.
       Se registra el CLIC (la intención), no si la acción terminó bien.

   Marcas en todos los eventos (propiedades personalizadas):
     cuenta    si | no       sesión iniciada al cargar la página
     interfaz  simple | completa | sin elegir
   Entrar o salir de la cuenta recarga la página, así que la marca no
   queda vieja.

   Dónde NO corre: aplicación de escritorio (Electron/Tauri), localhost,
   127.0.0.1 y file://. Ahí no se carga ni el script: las pruebas y el
   servidor local no ensucian los números.

   Para activarlo: crear el sitio `openboq.pages.dev` en plausible.io,
   copiar la dirección del script que da Plausible (…/js/pa-XXXX.js) en
   SCRIPT, y publicar. Mientras SCRIPT esté vacío no se carga nada.
   Si se cambia de servidor (Plausible propio), mover también `script-src`
   y `connect-src` de la CSP en index.html.
   ========================================================================= */
'use strict';

const METRICAS = (() => {

  /* La dirección que da Plausible en Site installation. Vacía = apagado. */
  const SCRIPT = '';

  /* identificador de data-acc → nombre del evento en Plausible.
     Varias acciones pueden caer en el mismo evento. Para verlas en el
     tablero hay que darlas de alta como «Goal» (custom event) con este
     mismo nombre. */
  const ACCIONES = {
    nuevo: 'Proyecto nuevo',
    abrir: 'Abrir .boq',
    guardar: 'Guardar .boq',
    guardarComo: 'Guardar .boq',
    importarDDP: 'Importar PRESCOM',
    importarSueltos: 'Importar PRESCOM',
    exportarDdp: 'Exportar PRESCOM',
    exportarXls: 'Exportar Excel',
    exportarXlsSel: 'Exportar Excel',
    exportarCsvIns: 'Exportar Excel',
    repPresupuesto: 'Reporte',
    repAnalisis: 'Reporte',
    repElementales: 'Reporte',
    repInsumos: 'Reporte',
    repComputos: 'Reporte',
    repCrono: 'Reporte',
    repResumen: 'Reporte',
    cuenta: 'Mi cuenta',
    driveConectar: 'Conectar Drive',
    driveGuardarProyecto: 'Guardar en Drive',
    nuevaBasePropia: 'Base propia nueva',
    cambiarModo: 'Cambiar interfaz'
  };

  function apagado() {
    if (!SCRIPT) return true;
    if (window.OPENBOQ_ESCRITORIO || window.__TAURI__ || window.__TAURI_INTERNALS__) return true;
    if (location.protocol === 'file:') return true;
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '';
  }

  function conCuenta() {
    try { return typeof NUBE !== 'undefined' && NUBE.hayToken && NUBE.hayToken(); }
    catch (e) { return false; }
  }

  /* El mismo perfil que guarda el modo simple (ui.js, CLAVE_PERFIL). */
  function interfaz() {
    try {
      const p = JSON.parse(localStorage.getItem('openboq_perfil') || 'null');
      return p && p.modo ? (p.modo === 'simple' ? 'simple' : 'completa') : 'sin elegir';
    } catch (e) { return 'sin elegir'; }
  }

  const activo = !apagado();

  if (activo) {
    /* La cola que pide Plausible: lo que se llame antes de que el script
       termine de bajar se guarda y se manda después. */
    window.plausible = window.plausible || function () { (plausible.q = plausible.q || []).push(arguments); };
    plausible.init = plausible.init || function (i) { plausible.o = i || {}; };
    plausible.init({
      /* función y no objeto: se lee en cada evento, así el cambio de
         interfaz (simple / completa) se refleja sin recargar */
      customProperties: () => ({ cuenta: conCuenta() ? 'si' : 'no', interfaz: interfaz() })
    });
    const s = document.createElement('script');
    s.async = true;
    s.src = SCRIPT;
    s.onerror = () => { /* bloqueador de anuncios o sin red: la aplicación sigue igual */ };
    document.head.appendChild(s);
  }

  function evento(nombre) {
    if (!activo || !nombre) return;
    try { plausible(nombre); } catch (e) { /* las métricas nunca rompen la aplicación */ }
  }

  return {
    activo: () => activo,
    /* Llamado desde el despachador de data-acc de ui.js. Lo que no está en
       la lista no se manda. */
    accion(acc) { evento(ACCIONES[acc]); },
    /* Cada pestaña como página virtual. */
    vista(v) {
      if (!activo || !v) return;
      try { plausible('pageview', { url: location.origin + '/vista/' + v }); } catch (e) { }
    }
  };
})();
