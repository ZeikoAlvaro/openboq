/* OpenBOQ v2 — barra lateral plegable.
   ------------------------------------------------------------------
   Archivo aparte, sin relación con ui.js: solo abre y cierra la barra
   lateral y recuerda la elección. Si este archivo no carga, la barra queda
   abierta y la aplicación funciona igual.

   Cerrada, la barra queda como una tira de íconos: el ítem activo se sigue
   viendo (ícono + filo ámbar) y el texto se oculta con font-size:0 desde la
   hoja de estilo. El texto de cada botón se copia a `title` para que al
   pasar el puntero se lea el nombre completo. */
(function () {
  'use strict';

  var LLAVE = 'openboq_lateral';   // 'cerrada' | 'abierta'

  function aplicar(cerrada) {
    document.body.classList.toggle('lat-cerrada', cerrada);
    var b = document.getElementById('btnLateral');
    if (b) {
      b.setAttribute('aria-expanded', cerrada ? 'false' : 'true');
      b.title = cerrada ? 'Desplegar el menú' : 'Plegar el menú';
    }
  }

  function guardar(cerrada) {
    try { localStorage.setItem(LLAVE, cerrada ? 'cerrada' : 'abierta'); } catch (e) { }
  }

  function arrancar() {
    /* el nombre de cada vista pasa a title: cerrada, el texto no se ve */
    var bts = document.querySelectorAll('#tabs button[data-v]');
    for (var i = 0; i < bts.length; i++) {
      if (!bts[i].title) bts[i].title = bts[i].textContent.trim();
    }

    var b = document.getElementById('btnLateral');
    if (b) {
      b.addEventListener('click', function () {
        var cerrada = !document.body.classList.contains('lat-cerrada');
        aplicar(cerrada);
        guardar(cerrada);
      });
    }

    /* al elegir una vista con la barra cerrada, se queda cerrada: la tira de
       íconos ya muestra cuál está activa */

    var v = null;
    try { v = localStorage.getItem(LLAVE); } catch (e) { }
    /* en pantalla angosta la barra se acuesta arriba: plegarla no aplica */
    var angosta = window.matchMedia('(max-width:900px)').matches;
    aplicar(v === 'cerrada' && !angosta);

    marcarDesplazables();
    etiquetarCampos(document.body);
    /* las rejillas se repintan enteras con innerHTML: se etiqueta lo nuevo */
    if (window.MutationObserver) {
      var pendiente = null;
      new MutationObserver(function () {
        if (pendiente) return;
        pendiente = setTimeout(function () { pendiente = null; etiquetarCampos(document.body); }, 120);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  /* Barras que se desplazan a lo ancho (menú, pestañas en el celular): sin
     una pista, «HERRAMIEN» cortado parecía el final. Mientras quede algo a la
     derecha, el borde se desvanece (.hay-mas en ui2.css). */
  function marcarDesplazables() {
    var ids = ['.menubar', '#tabs', '#subCrono'];
    var els = [];
    ids.forEach(function (s) { var e = document.querySelector(s); if (e) els.push(e); });
    function revisar() {
      els.forEach(function (e) {
        e.classList.toggle('hay-mas', e.scrollLeft + e.clientWidth < e.scrollWidth - 4);
      });
    }
    els.forEach(function (e) { e.addEventListener('scroll', revisar, { passive: true }); });
    window.addEventListener('resize', revisar);
    revisar();
  }

  /* Nombre accesible de las casillas que no tienen <label>: las rejillas del
     B-1, B-2, B-3, cómputos y cronograma. Un lector de pantalla leía
     «cuadro de edición» 47 veces; ahora lee «P. UNITARIO — CEMENTO PORTLAND».
     Se arma con el encabezado de la columna y el primer texto de la fila. */
  function etiquetarCampos(raiz) {
    var cs = raiz.querySelectorAll('input:not([type=hidden]):not([aria-label]),select:not([aria-label]),textarea:not([aria-label])');
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if ((c.labels && c.labels.length) || c.getAttribute('aria-labelledby')) continue;
      var n = nombreDeCampo(c);
      if (n) c.setAttribute('aria-label', n);
    }
  }

  function limpio(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  function nombreDeCampo(c) {
    var td = c.closest('td');
    if (td) {
      var tr = td.parentElement, tabla = td.closest('table');
      var col = '', fila = '';
      if (tabla && tabla.tHead) {
        /* posición real de la celda contando los colspan de la fila */
        var x = 0;
        for (var k = 0; k < tr.cells.length && tr.cells[k] !== td; k++) x += tr.cells[k].colSpan || 1;
        var filas = tabla.tHead.rows;
        for (var f = filas.length - 1; f >= 0 && !col; f--) {
          var p = 0;
          for (var j = 0; j < filas[f].cells.length; j++) {
            var th = filas[f].cells[j];
            if (p === x && (th.colSpan || 1) === 1) { col = limpio(th.textContent); break; }
            p += th.colSpan || 1;
          }
        }
      }
      for (var m = 0; m < tr.cells.length; m++) {
        var t = tr.cells[m];
        /* la columna TIPO (una etiqueta «Material») no nombra la fila */
        if (t === td || t.querySelector('input,select,button,.badge')) continue;
        var tx = limpio(t.textContent);
        if (tx && !/^[\d.,\s%]+$/.test(tx)) { fila = tx.slice(0, 60); break; }
      }
      if (col || fila) return [col, fila].filter(Boolean).join(' — ');
    }
    /* fuera de una tabla: el <label> que va justo antes, sin for= */
    var prev = c.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') return limpio(prev.textContent).replace(/:$/, '');
    return c.placeholder || c.title || '';
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
