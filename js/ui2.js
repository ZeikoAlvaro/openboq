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
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();
})();
