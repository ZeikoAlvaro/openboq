/* Los proyectos guardados en la cuenta: hasta diez, el candado opcional y la
   caja de la pantalla de inicio.

   Lo que se fija acá es lo que puede romperse en silencio:

     · que el candado sea REVERSIBLE — si el sobre cifrado no vuelve exacto,
       el usuario pierde los cómputos métricos de todo el proyecto;
     · que con candado NO viaje en claro nada de lo que se prometió cifrar;
     · que la aplicación no pueda pedirle al servidor un casillero de más;
     · que la caja de la pantalla de inicio diga lo que tiene que decir y
       ofrezca entrar, porque es el único lugar donde se explica la cuenta.

   OJO — 2026-09-10: los diez casilleros SALIERON DE LA INTERFAZ. El respaldo
   del usuario pasó a ser su propio Google Drive, y esa caja ahora muestra los
   archivos del Drive. El contrato con el servidor se sigue probando acá, tal
   cual, porque el código de nube.js queda en su lugar: lo que cambió es quién
   lo llama, no lo que hace. Las comprobaciones de interfaz se reescribieron
   para fijar lo nuevo — que la caja hable del Drive y que NO queden botones
   de casillero sueltos.  */
'use strict';

const { JSDOM } = require('jsdom');
const { webcrypto } = require('crypto');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const CFG = `var NUBE_CFG = { url: 'https://servidor.de.prueba', anon: 'clave-publica' };`;
const SESION = {
  access_token: 'token-de-prueba', refresh_token: 'r',
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'alvaro@ejemplo.bo' }
};

/** Un proyecto chico pero con todo lo que el candado tiene que tapar. */
function proyectoDePrueba() {
  return {
    app: 'OpenBOQ', v: 1, _seq: 9,
    P: {
      nombre: 'PUENTE VEHICULAR PARCO VENTILLA',
      entidad: 'GOBIERNO AUTÓNOMO DEPARTAMENTAL DE ORURO',
      ubicacion: 'Parco - Ventilla',
      moneda: 'Bs',
      insumos: { i1: { id: 'i1', t: 'M', d: 'CEMENTO PORTLAND', u: 'kg', p: 1.2 } },
      modulos: [{
        id: 'm1', n: 'MÓDULO # 1', items: [
          {
            id: 'x1', cod: '1', desc: 'HORMIGÓN SIMPLE', und: 'm3', cant: 12,
            comp: [{ ins: 'i1', rend: 320 }],
            computos: [{ d: 'Zapata eje A', n: 4, l: 1.5, a: 1.5, h: 0.4 }]
          },
          { id: 'x2', cod: '2', desc: 'EXCAVACIÓN', und: 'm3', cant: 30, comp: [], computos: [] }
        ]
      }]
    }
  };
}

/* =====================================================================
   1 · NUBE.js solo, con un fetch de mentira
   ===================================================================== */
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', url: 'https://openboq.local/' });
const w = dom.window;
/* jsdom no trae crypto.subtle y la propiedad es de solo lectura */
Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });

const pedidos = [];
w.fetch = (url, opciones) => {
  const o = opciones || {};
  pedidos.push({ url: String(url), metodo: o.method || 'GET', cuerpo: o.body, cab: o.headers });
  let datos = '';
  if (/usuarios_proyectos\?select=/.test(url)) {
    datos = JSON.stringify([
      {
        slot: 1, etiqueta: 'Proyecto 1', protegido: false, n_items: 44, bytes: 320000,
        app_version: '1.11', actualizado_en: '2026-08-05T10:00:00Z', nombre: 'PUENTE VEHICULAR'
      },
      {
        slot: 3, etiqueta: 'Proyecto 3', protegido: true, n_items: 12, bytes: 41000,
        app_version: '1.11', actualizado_en: '2026-08-04T09:00:00Z', nombre: '(protegido)'
      }
    ]);
  }
  return Promise.resolve({
    ok: true, status: 200, text: () => Promise.resolve(datos)
  });
};
w.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
try {
  w.eval(CFG + '\n' + fs.readFileSync(path.join(dir, 'js/nube.js'), 'utf8') + '\n;window.NUBE=NUBE;');
} catch (e) { errores.push('EVAL nube.js: ' + e.message); }
const NUBE = w.NUBE;

(async () => {
  console.log('== Sin candado, el proyecto viaja tal cual ==');
  {
    const orig = proyectoDePrueba();
    const paq = await NUBE.empaquetarProyecto(orig, '');
    ok(paq.protegido === false, 'no queda marcado como protegido');
    ok(!paq.payload.candado, 'no hay sobre cifrado');
    ok(JSON.stringify(paq.payload) === JSON.stringify(orig), 'el payload es idéntico al proyecto');
    const vuelta = await NUBE.desempaquetarProyecto(paq.payload, '');
    ok(vuelta.P.nombre === orig.P.nombre, 'y vuelve igual');
  }

  console.log('== Con candado, lo prometido no viaja en claro ==');
  {
    const orig = proyectoDePrueba();
    const paq = await NUBE.empaquetarProyecto(proyectoDePrueba(), 'frase de prueba');
    const crudo = JSON.stringify(paq.payload);
    ok(paq.protegido === true, 'queda marcado como protegido');
    ok(!!paq.payload.candado && /^[A-Za-z0-9+/=]+$/.test(paq.payload.candado),
      'el sobre cifrado viaja en base64');
    ok(crudo.indexOf('PARCO VENTILLA') < 0, 'el nombre de la obra NO está en el payload');
    ok(crudo.indexOf('GOBIERNO AUTÓNOMO') < 0, 'la entidad tampoco');
    ok(crudo.indexOf('Zapata eje A') < 0, 'ni el detalle de los cómputos');
    ok(crudo.indexOf('HORMIGÓN SIMPLE') > 0,
      'los ítems y sus análisis SÍ viajan: es lo que hace falta para seguir trabajando');
    ok(paq.payload.P.modulos[0].items[0].computos.length === 0, 'los cómputos quedaron vacíos');

    const vuelta = await NUBE.desempaquetarProyecto(paq.payload, 'frase de prueba');
    ok(JSON.stringify(vuelta) === JSON.stringify(orig),
      'con la frase, el proyecto vuelve EXACTO — hasta el último cómputo');

    let mala = null;
    try { await NUBE.desempaquetarProyecto(paq.payload, 'otra frase'); }
    catch (e) { mala = e.message; }
    ok(mala === 'FRASE_INCORRECTA', 'con la frase equivocada no abre: ' + mala);

    /* Abrir sin la frase es una salida de emergencia, no un agujero: se
       recupera el presupuesto y se pierden los campos protegidos. */
    const sinFrase = JSON.parse(JSON.stringify(paq.payload));
    delete sinFrase.candado;
    const solo = await NUBE.desempaquetarProyecto(sinFrase, '');
    ok(solo.P.nombre === '(protegido)' && solo.P.modulos[0].items.length === 2,
      'sin la frase se abre el presupuesto, con el nombre en «(protegido)»');
  }

  console.log('== La lista y el guardado hablan con la ruta correcta ==');
  {
    const L = await NUBE.listarProyectos();
    ok(L.length === 2 && L[0].slot === 1, 'listarProyectos devuelve los casilleros ocupados');
    ok(/usuarios_proyectos\?select=.*order=slot/.test(pedidos[pedidos.length - 1].url),
      'pide solo las columnas del listado, ordenadas por casillero');
    ok(/payload->P->>nombre/.test(pedidos[pedidos.length - 1].url),
      'el nombre se pide como campo del JSON y no bajando el proyecto entero');

    await NUBE.guardarProyecto(2, { app: 'OpenBOQ' }, { nItems: 3, version: '1.11' });
    const p = pedidos[pedidos.length - 1];
    ok(p.metodo === 'POST' && /on_conflict=user_id,slot/.test(p.url),
      'guardar es un upsert por (usuario, casillero): no acumula filas');
    ok(/merge-duplicates/.test(p.cab.Prefer || ''), 'y lo dice en la cabecera Prefer');
    const enviado = JSON.parse(p.cuerpo);
    ok(enviado.slot === 2 && enviado.etiqueta === 'Proyecto 2',
      'manda la etiqueta neutra; el servidor la reescribe igual');
    ok(enviado.user_id === SESION.user.id, 'y el dueño, que el RLS vuelve a comprobar');

    let deMas = null;
    try { await NUBE.guardarProyecto(11, {}, {}); } catch (e) { deMas = e.message; }
    ok(deMas === 'SLOT_FUERA_DE_RANGO',
      'la aplicación ni siquiera intenta el casillero 11: ' + deMas);
    ok(NUBE.TOPE_PROYECTOS === 10, 'el tope que muestra la interfaz es 10');
  }

  /* =====================================================================
     2 · La caja de la pantalla de inicio
     ===================================================================== */
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const FUENTES = ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js',
    'js/reportes.js', 'js/ui.js'];

  /** Levanta la aplicación entera con o sin sesión guardada. */
  function levantar(conSesion) {
    const d = new JSDOM(html, {
      runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://openboq.local/'
    });
    const v = d.window;
    Object.defineProperty(v, 'crypto', { value: webcrypto, configurable: true });
    v.alert = m => errores.push('ALERT: ' + m);
    v.onerror = m => errores.push('ONERROR: ' + m);
    v.fetch = w.fetch;
    if (conSesion) v.localStorage.setItem('openboq_sesion', JSON.stringify(SESION));
    const src = CFG + '\n' +
      fs.readFileSync(path.join(dir, 'js/nube.js'), 'utf8') + '\n;\n' +
      FUENTES.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
      '\n;window.MOTOR=MOTOR;window.NUBE=NUBE;';
    try { v.eval(src); } catch (e) { errores.push('EVAL app: ' + e.message); console.log(e); }
    v.document.dispatchEvent(new v.Event('DOMContentLoaded'));
    return v;
  }

  console.log('== Sin sesión: la invitación a entrar ==');
  {
    const v = levantar(false);
    await new Promise(r => setTimeout(r, 600));
    const caja = v.document.querySelector('#iniNube');
    const t = caja.textContent.replace(/\s+/g, ' ');
    ok(v.document.querySelector('#inicio').classList.contains('on'),
      'la pantalla de inicio está abierta');
    ok(/Tu base de datos, siempre disponible/.test(t), 'sale el título pedido');
    ok(/Inicia sesión para sincronizar tus proyectos y acceder a ellos desde cualquier lugar/.test(t),
      'y la explicación completa');
    ok(!!caja.querySelector('[data-acc="cuenta"]'), 'con el botón que abre el diálogo de entrar');
    ok(/funciona igual/i.test(t), 'y aclara que sin cuenta la aplicación funciona igual');
    ok(!caja.querySelector('.slot'), 'todavía no muestra casilleros');
    v.close();
  }

  console.log('== Con sesión: la caja habla del Drive, no de casilleros ==');
  {
    const v = levantar(true);
    await new Promise(r => setTimeout(r, 800));
    const caja = v.document.querySelector('#iniNube');
    const t = caja.textContent.replace(/\s+/g, ' ');

    ok(!caja.querySelector('.slot'), 'ya no se pintan casilleros del servidor');
    ok(!caja.querySelector('[data-nube-abrir],[data-nube-guardar],[data-nube-borrar]'),
      'ni botones de abrir, reemplazar o quitar del servidor');
    ok(/Drive/i.test(t), 'la caja habla del Drive: ' + t.slice(0, 70));
    ok(/alvaro@ejemplo\.bo/.test(t), 'y dice con qué cuenta está');
    ok(!!caja.querySelector('[data-acc="driveGuardarProyecto"]'),
      'ofrece guardar el proyecto en el Drive');

    console.log('== CONFIGURACIÓN ofrece Drive y ya no el servidor ==');
    const clic = el => el.dispatchEvent(new v.MouseEvent('click', { bubbles: true }));
    clic(v.document.querySelector('.menubar .m[data-menu="config"]'));
    const ops = Array.from(v.document.querySelectorAll('.menu-pop div')).map(x => x.dataset.acc);
    ok(ops.indexOf('driveGuardarProyecto') >= 0, 'CONFIGURACIÓN → Guardar este proyecto en mi Drive');
    ok(ops.indexOf('driveGuardarBiblioteca') >= 0, 'CONFIGURACIÓN → Respaldar mis bases y cambios');
    ok(ops.indexOf('misProyectos') < 0, 'y ya NO ofrece los proyectos del servidor');
    ok(ops.indexOf('respaldar') < 0, 'ni guardar la biblioteca en la cuenta');
    ok(ops.indexOf('paramsGlobal') >= 0, 'las INCIDENCIAS siguen donde estaban');
    v.close();
  }

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
  process.exit(errores.length ? 1 : 0);
})();
