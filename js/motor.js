/* =========================================================================
   OpenBOQ — motor de cálculo y estado
   Presupuestos y computos metricos de obra civil.
   Formularios B-1 / B-2 / B-3 segun normativa SABS (Bolivia).
   ========================================================================= */
'use strict';

const MOTOR = (() => {

  /* ---------------- parámetros por defecto (recargos) ----------------
     Valores habituales en Bolivia. Editables desde CONFIGURACIÓN.       */
  const PARAMS_DEF = {
    cargas: 55.00,   // % cargas sociales sobre mano de obra
    ivaMO: 14.94,    // % IVA sobre (mano de obra + cargas sociales)
    herr: 5.00,      // % herramientas menores sobre total mano de obra
    gg: 10.00,       // % gastos generales y administrativos
    util: 7.00,      // % utilidad
    it: 3.09         // % impuestos (IT)
  };

  const UNIDADES = ['glb', 'm', 'm²', 'm³', 'pza', 'kg', 'l', 'hr', 'día', 'pto',
    'jgo', 'bolsa', 'ton', 'galón', 'pie²', 'rollo', 'barra', 'tubo', 'hoja', 'km', '%'];

  /* =====================================================================
     FORMATOS DE INCIDENCIAS — la cadena de cálculo del B-2

     Hasta la v2.5 la cadena estaba escrita en el código: seis recargos, en
     ese orden, con esas bases. Alcanza para el pliego estándar y no alcanza
     para nada más: una entidad que pida otra estructura —un recargo adicional,
     la utilidad calculada sobre otra base, un ítem sin gastos generales— deja
     al usuario sin salida dentro de la aplicación.

     Ahora la cadena es un dato. Cada fila dice cómo se calcula:

       { k:'ent' }                     entrada del análisis (materiales, mano
                                       de obra, equipo). Son siempre las tres
                                       primeras y no se tocan.
       { k:'pct', pct, sobre:[n,...] } porcentaje sobre la suma de esas filas
       { k:'sum', sobre:[n,...] }      subtotal: suma de esas filas

     `sobre` son números de fila, empezando en 1, igual que se leen en pantalla.
     La ÚLTIMA fila es el precio unitario.

     El formato oficial (`sabs`) queda como estaba y no se le puede cambiar la
     estructura: es el que reproduce exactamente el B-2 del DS 0181 y el que
     sabe escribir el .ddp de vuelta a PRESCOM. Sus porcentajes sí se editan,
     como siempre. Para otra estructura se duplica, y la copia se edita entera.
     ===================================================================== */

  const ID_SABS = 'sabs';

  /* Las tres entradas del análisis. No son recargos: son los subtotales que
     salen de los insumos del ítem. */
  const FILAS_ENTRADA = [
    { id: 'e1', k: 'ent', n: 'Materiales', ref: 'mat' },
    { id: 'e2', k: 'ent', n: 'Mano de obra bruta', ref: 'mo' },
    { id: 'e3', k: 'ent', n: 'Equipo y maquinaria base', ref: 'eq' }
  ];

  /* El formato oficial, fila por fila. `p` enlaza el porcentaje con la clave
     de `P.params`, que sigue siendo donde viven los seis números de siempre:
     así un .boq viejo abre igual, la pestaña INCIDENCIAS sigue editándolos y
     el exportador a PRESCOM los encuentra donde siempre estuvieron. */
  const FILAS_SABS = [
    { id: 's4', k: 'pct', n: 'Cargas sociales', p: 'cargas', sobre: [2], ref: 'cargas', ayuda: 'sobre el total de mano de obra' },
    { id: 's5', k: 'pct', n: 'IVA mano de obra', p: 'ivaMO', sobre: [2, 4], ref: 'ivaMO', ayuda: 'sobre (mano de obra + cargas sociales)' },
    { id: 's6', k: 'sum', n: 'Total mano de obra', sobre: [2, 4, 5], ref: 'totalMO' },
    { id: 's7', k: 'pct', n: 'Herramientas menores', p: 'herr', sobre: [6], ref: 'herr', ayuda: 'sobre el total de mano de obra' },
    { id: 's8', k: 'sum', n: 'Total equipo, maquinaria y herramientas', sobre: [3, 7], ref: 'totalEQ' },
    { id: 's9', k: 'sum', n: 'Subtotal', sobre: [1, 6, 8], ref: 'subtotal' },
    { id: 's10', k: 'pct', n: 'Gastos generales y administrativos', p: 'gg', sobre: [9], ref: 'gg', ayuda: 'sobre el subtotal' },
    { id: 's11', k: 'sum', n: 'Parcial', sobre: [9, 10], ref: 'parcial2' },
    { id: 's12', k: 'pct', n: 'Utilidad', p: 'util', sobre: [11], ref: 'util', ayuda: 'sobre el parcial con gastos generales' },
    { id: 's13', k: 'sum', n: 'Parcial', sobre: [11, 12], ref: 'parcial3' },
    { id: 's14', k: 'pct', n: 'Impuestos IT', p: 'it', sobre: [13], ref: 'it', ayuda: 'sobre el parcial con utilidad' },
    { id: 's15', k: 'sum', n: 'TOTAL PRECIO UNITARIO', sobre: [13, 14], ref: 'pu' }
  ];

  const clonar = x => JSON.parse(JSON.stringify(x));

  /** El formato oficial armado entero, con los porcentajes que tenga el proyecto. */
  function formatoSABS(params) {
    const pr = params || PARAMS_DEF;
    return {
      id: ID_SABS,
      n: 'SABS — Normas Básicas (DS 0181)',
      nota: 'Formato oficial de Bolivia. Los porcentajes se editan; la estructura no. ' +
        'Para otra estructura, duplíquelo.',
      filas: clonar(FILAS_ENTRADA).concat(clonar(FILAS_SABS).map(f =>
        f.p ? Object.assign(f, { pct: Number(pr[f.p]) }) : f))
    };
  }

  /* ---------------- el listado de formatos del proyecto ----------------
     El proyecto guarda VARIOS formatos y uno activo. El oficial no se guarda
     —se arma solo, con los porcentajes de `P.params`— y por eso está siempre
     disponible aunque el archivo venga de otra versión: no se puede borrar ni
     perder. Los propios viven en `P.formatos` y viajan dentro del `.boq`.

     `P.formatoId` dice cuál manda. `null` o `'sabs'` es el oficial. Si apunta
     a uno que ya no está —se borró, o el archivo llegó a medias— vuelve al
     oficial en vez de dejar el proyecto sin cadena de cálculo. */

  /** Todos los formatos disponibles: el oficial primero, después los propios. */
  function formatos() {
    if (!P) return [formatoSABS(PARAMS_DEF)];
    return [formatoSABS(P.params)].concat(P.formatos || []);
  }

  /** El formato activo. */
  function formato() {
    if (!P) return formatoSABS(PARAMS_DEF);
    if (!P.formatoId || P.formatoId === ID_SABS) return formatoSABS(P.params);
    const f = (P.formatos || []).find(x => x.id === P.formatoId);
    return f || formatoSABS(P.params);
  }

  /** ¿El proyecto está con el formato oficial? Lo preguntan el exportador a
      PRESCOM y la pestaña INCIDENCIAS, que se comportan distinto si no. */
  const formatoEsOficial = () => !P || !P.formatoId || P.formatoId === ID_SABS ||
    !(P.formatos || []).some(x => x.id === P.formatoId);

  /** Un formato del listado por su id (el oficial incluido). */
  function formatoPorId(id) {
    if (!id || id === ID_SABS) return formatoSABS(P.params);
    return (P.formatos || []).find(x => x.id === id) || null;
  }

  /**
   * Guarda un formato propio en el listado del proyecto, sin activarlo.
   * Si ya existe uno con ese id, lo reemplaza.
   * @returns {Object} el formato guardado
   */
  function guardarFormato(f) {
    if (!f || f.id === ID_SABS) return null;
    P.formatos = P.formatos || [];
    const k = P.formatos.findIndex(x => x.id === f.id);
    if (k >= 0) P.formatos[k] = f; else P.formatos.push(f);
    return f;
  }

  /** Cambia el nombre de un formato propio. */
  function renombrarFormato(id, n) {
    const f = (P.formatos || []).find(x => x.id === id);
    if (!f) return false;
    f.n = String(n || '').trim() || f.n;
    return true;
  }

  /**
   * Saca un formato del listado. El oficial no se puede sacar.
   * Si era el activo, el proyecto vuelve al oficial —y los precios unitarios
   * cambian con él, que es justamente lo que hay que avisar antes.
   * @returns {boolean} si se eliminó
   */
  function eliminarFormato(id) {
    if (!id || id === ID_SABS) return false;
    const k = (P.formatos || []).findIndex(x => x.id === id);
    if (k < 0) return false;
    P.formatos.splice(k, 1);
    if (P.formatoId === id) usarFormato(null);
    return true;
  }

  /**
   * Corre la cadena sobre los tres subtotales del análisis.
   * Sin redondeos intermedios: se redondea solo el precio unitario, igual que
   * antes. Una fila que se refiera a otra posterior vale 0 en lugar de romper
   * el cálculo — el editor no deja armarlas, pero un .boq tocado a mano sí.
   * @param {number} m materiales
   * @param {number} o mano de obra
   * @param {number} e equipo
   * @returns {{filas:Array, crudo:number, pu:number}} y los alias del B-2 clásico
   */
  function correrCadena(m, o, e) {
    const F = formato().filas || [];
    const val = [];          // val[i] = valor de la fila i+1
    const filas = [];
    const entradas = [m, o, e];
    let ent = 0;

    F.forEach((f, i) => {
      let v = 0;
      if (f.k === 'ent') {
        v = Number(entradas[ent++]) || 0;
      } else {
        const base = (f.sobre || []).reduce((s, n) => {
          const k = Number(n) - 1;
          return s + (k >= 0 && k < i ? (Number(val[k]) || 0) : 0);
        }, 0);
        v = f.k === 'pct' ? base * (Number(f.pct) || 0) / 100 : base;
      }
      val[i] = v;
      filas.push({ i: i + 1, id: f.id, k: f.k, n: f.n, ayuda: f.ayuda || '', ref: f.ref || '',
                   pct: f.k === 'pct' ? (Number(f.pct) || 0) : null, sobre: f.sobre || [], valor: v });
    });

    /* El precio unitario es la última fila. `crudo` es ese número sin
       redondear: sirve de huella del análisis para saber si sigue valiendo el
       precio que trajo el archivo importado (ver puVigente). */
    const crudo = val.length ? (Number(val[val.length - 1]) || 0) : 0;

    /* Alias del B-2 clásico. Con el formato oficial salen todos y el resto de
       la aplicación no se entera del cambio; con un formato propio salen los
       que existan y 0 los que no. Quien de verdad los necesita —el .ddp de
       PRESCOM— pregunta antes con `formatoEsOficial`. */
    const A = { cargas: 0, ivaMO: 0, totalMO: 0, herr: 0, totalEQ: 0,
                subtotal: 0, gg: 0, parcial2: 0, util: 0, parcial3: 0, it: 0 };
    filas.forEach(f => { if (f.ref && f.ref in A) A[f.ref] = f.valor; });

    return Object.assign(A, { filas, crudo, pu: r2(crudo) });
  }

  /**
   * Pone al proyecto un formato propio, o lo devuelve al oficial con `null`.
   * Al volver al oficial, los porcentajes que el formato propio tuviera con
   * nombre conocido (cargas, IVA, herramientas, G.G., utilidad, IT) se copian
   * a `P.params`: si alguien cambió la utilidad al 12 % en su formato, esa
   * utilidad sigue valiendo al volver, en vez de saltar sola al valor viejo.
   * @param {Object|null} f formato nuevo
   */
  function usarFormato(f) {
    const id = (f && typeof f === 'object') ? f.id : f;

    if (!id || id === ID_SABS) {
      /* al volver al oficial se conservan los porcentajes con nombre conocido
         del que estaba activo: si alguien puso la utilidad al 12 %, esa
         utilidad sigue valiendo en vez de saltar sola al valor viejo */
      const ant = formato();
      if (!formatoEsOficial()) {
        (ant.filas || []).forEach(x => {
          if (x.p && x.k === 'pct' && isFinite(x.pct)) P.params[x.p] = Number(x.pct);
        });
      }
      P.formatoId = null;
      return formato();
    }

    /* si viene el objeto entero y todavía no está en el listado, se guarda */
    if (f && typeof f === 'object' && !(P.formatos || []).some(x => x.id === id)) guardarFormato(f);
    if (!(P.formatos || []).some(x => x.id === id)) return formato();   // id inexistente: no se mueve

    P.formatoId = id;
    /* se mantienen sincronizados los seis de siempre: el exportador a PRESCOM
       y los .boq viejos los leen de ahí */
    (formato().filas || []).forEach(x => {
      if (x.p && x.k === 'pct' && isFinite(x.pct)) P.params[x.p] = Number(x.pct);
    });
    return formato();
  }

  /**
   * Copia editable del formato activo. Es el camino para salir del oficial:
   * la copia arranca idéntica —mismo precio unitario en todos los ítems— y de
   * ahí en más se le cambia lo que haga falta.
   * @param {string} [nombre]
   */
  function duplicarFormato(nombre) {
    const base = formato();
    const f = clonar(base);
    f.id = 'f' + Date.now().toString(36);
    f.n = (nombre || '').trim() || ('Copia de ' + base.n);
    f.nota = '';
    f.derivadoDe = base.id;
    /* los porcentajes quedan escritos en la copia y dejan de leerse de
       `P.params`: de acá en más el formato manda */
    f.filas.forEach(x => { if (x.p && x.k === 'pct') x.pct = Number(x.pct) || 0; });
    return f;
  }

  /**
   * Revisa que una cadena se pueda calcular, antes de guardarla.
   * Lo que no se permite y por qué:
   *  - menos de una fila después de las entradas: no habría precio unitario;
   *  - una fila que se apoye en sí misma o en una posterior: el valor no
   *    existe todavía cuando llega su turno y el cálculo daría 0 en silencio;
   *  - una fila sin base: un porcentaje sobre nada, o un subtotal vacío.
   * @returns {{ok:boolean, errores:string[]}}
   */
  function validarFormato(f) {
    const er = [];
    const F = (f && f.filas) || [];
    const ent = F.filter(x => x.k === 'ent').length;
    if (ent !== 3) er.push('La cadena tiene que empezar con las tres entradas del análisis (materiales, mano de obra y equipo).');
    if (F.length < ent + 1) er.push('Falta al menos una fila después de las entradas: la última es el precio unitario.');
    F.forEach((x, i) => {
      if (x.k === 'ent') return;
      const n = i + 1;
      const sobre = x.sobre || [];
      if (!sobre.length) er.push('Fila ' + n + ' («' + (x.n || 'sin nombre') + '»): no dice sobre qué se calcula.');
      sobre.forEach(v => {
        const k = Number(v);
        if (!isFinite(k) || k < 1 || k > F.length) er.push('Fila ' + n + ': la fila ' + v + ' no existe.');
        else if (k >= n) er.push('Fila ' + n + ': no puede calcularse sobre la fila ' + k + ', que viene después.');
      });
      if (x.k === 'pct' && !isFinite(Number(x.pct))) er.push('Fila ' + n + ': el porcentaje no es un número.');
      if (!String(x.n || '').trim()) er.push('Fila ' + n + ': falta el nombre.');
    });
    return { ok: !er.length, errores: er };
  }

  /* ---------------- cronograma: supuestos de obra ----------------
     La duración de cada actividad sale de las horas de mano de obra de su
     análisis; estos valores dicen cuántas horas rinde un día de trabajo.    */
  const CRONO_DEF = {
    jornada: 8,        // horas efectivas por día
    cuadrillas: 1,     // multiplicador general (se maneja desde RECURSOS)
    diasSemana: 6,     // días trabajados por semana (el resto estira el plazo)
    topeDias: 180      // ninguna actividad debería pasar de esto en el análisis inicial
  };

  /* Trenes de trabajo: cada tren es una cuadrilla que ejecuta sus actividades
     una tras otra. Los recursos se expresan en porcentaje — 100 % = una
     cuadrilla, 50 % media, 200 % dos— y dividen la duración. */
  const REC_DEF = 100;

  /* ---------------- estado del proyecto ---------------- */
  let P = null;                 // proyecto activo
  let _seq = 1;
  const nid = () => 'x' + (_seq++) + Date.now().toString(36).slice(-4);

  function proyectoNuevo(nombre) {
    _seq = 1;
    P = {
      nombre: nombre || 'Sin nombre',
      entidad: '',
      ubicacion: '',
      fecha: new Date().toISOString().slice(0, 10),
      inicioObra: new Date().toISOString().slice(0, 10),
      plazo: 180,
      moneda: 'Bs',
      tc: 6.96,
      precision: 2,
      params: Object.assign({}, PARAMS_DEF),
      formatos: [],             // formatos propios; el oficial no se guarda, se arma solo
      formatoId: null,          // null = el formato oficial (ver «FORMATOS DE INCIDENCIAS»)
      crono: Object.assign({}, CRONO_DEF),
      trenes: [{ id: nid(), n: 'TREN 0', rec: REC_DEF }],
      insumos: {},              // id -> {id,t,d,u,p}
      modulos: [{ id: nid(), n: 'MÓDULO # 1', items: [] }],
      moduloActivo: 0,
      itemSel: null
    };
    return P;
  }

  const proyecto = () => P;
  const modulo = () => P.modulos[P.moduloActivo] || P.modulos[0];
  const items = () => modulo().items;
  const todosItems = () => P.modulos.flatMap(m => m.items.map(i => ({ m, i })));

  /* ---------------- redondeo ----------------
     `r` sin segundo argumento usa los decimales que el usuario eligió para
     MOSTRAR los números (CONFIGURACIÓN → Moneda y decimales). Sirve para
     cantidades y rendimientos; NO sirve para plata. Los precios unitarios y
     los totales van SIEMPRE con `r2`: el centavo es el centavo, y cambiar la
     cantidad de decimales de la pantalla no puede mover el presupuesto ni
     descuadrar un proyecto importado de PRESCOM. */
  function r(v, d) {
    d = (d === undefined) ? P.precision : d;
    const f = Math.pow(10, d);
    return Math.round((Number(v) || 0) * f + Number.EPSILON * 1e6) / f;
  }
  function r2(v) { return Math.round((Number(v) || 0) * 100 + Number.EPSILON * 1e6) / 100; }

  /* ---------------- insumos del proyecto ---------------- */
  function claveIns(t, d, u) {
    return t + '|' + (d || '').trim().toUpperCase() + '|' + (u || '').trim().toUpperCase();
  }
  function buscarInsumo(t, d, u, p) {
    const k = claveIns(t, d, u);
    let primero = null;
    for (const id in P.insumos) {
      const x = P.insumos[id];
      if (claveIns(x.t, x.d, x.u) !== k) continue;
      if (p === undefined) return x;
      // se reutiliza solo si el precio tambien coincide: asi el costo directo
      // importado desde el catalogo se reproduce exactamente
      if (Math.abs(x.p - Number(p)) < 1e-6) return x;
      if (!primero) primero = x;
    }
    return (p === undefined) ? primero : null;
  }
  function agregarInsumo(t, d, u, p, reusar, fecha) {
    if (reusar !== false) {
      const ex = buscarInsumo(t, d, u, p);
      if (ex) return ex;
    }
    const id = nid();
    P.insumos[id] = { id, t: t || 'M', d: (d || 'NUEVO INSUMO').trim(), u: u || 'pza', p: Number(p) || 0 };
    if (fecha) P.insumos[id].f = fecha === true ? fechaHoy() : String(fecha);
    return P.insumos[id];
  }

  /* ---------------- fecha del precio ----------------
     Desde la v2.6 cada insumo puede llevar la fecha en que se fijó su precio
     (campo `f`, 'AAAA-MM-DD'). Vale una aclaración sobre qué se fecha y qué no:

     SE FECHA lo que el usuario decidió dentro de la aplicación — escribir un
     precio en el B-3 o en el análisis, aceptar una actualización desde la Base
     de Datos, crear un insumo a mano, resolver un repetido. Ahí la fecha dice
     algo cierto: ese día, esta persona puso ese número.

     NO SE FECHA lo que llega de otro lado con precio propio: un ítem traído
     del catálogo, un .ddp importado de PRESCOM, un .boq abierto. Ponerles la
     fecha de hoy sería firmar como propio un precio ajeno y de antigüedad
     desconocida; queda en blanco, que es la respuesta honesta. Los insumos que
     ya existían antes de esta versión tampoco se fechan hacia atrás.

     Por eso todo precio pasa por acá: es el único punto donde se decide. */
  const fechaHoy = () => {
    const d = new Date();
    const z = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  };

  /**
   * Fija el precio de un insumo y le pone la fecha de hoy si el número cambió.
   * Escribir el mismo precio otra vez no mueve la fecha: no hubo modificación.
   * @param {Object} ins insumo del proyecto o de una base propia
   * @param {number} p precio nuevo
   * @param {boolean} [fechar=true] false para cargar un precio ajeno sin fecharlo
   * @returns {boolean} si el precio cambió
   */
  function fijarPrecio(ins, p, fechar) {
    if (!ins) return false;
    const nuevo = Number(p) || 0;
    const antes = Number(ins.p) || 0;
    if (Math.abs(nuevo - antes) < 1e-9) return false;
    ins.p = nuevo;
    if (fechar !== false) ins.f = fechaHoy();
    return true;
  }
  function eliminarInsumo(id) {
    if (usoInsumo(id).length) return false;
    delete P.insumos[id];
    return true;
  }
  function usoInsumo(id) {
    const out = [];
    P.modulos.forEach(m => m.items.forEach(it => {
      if (it.comp.some(c => c.ins === id)) out.push(it);
    }));
    return out;
  }
  /**
   * En cuántos ítems entra cada insumo, todo de una pasada.
   * `usoInsumo` recorre el presupuesto entero por cada insumo: en un proyecto
   * importado de PRESCOM, con 1.200 insumos y 250 ítems, eso es un cuarto de
   * millón de recorridos cada vez que se dibuja la pestaña INSUMOS. Acá se
   * cuenta una sola vez.
   * @returns {Object<string,number>} id de insumo -> cantidad de ítems (0 no aparece)
   */
  function usosPorInsumo() {
    const n = {};
    P.modulos.forEach(m => m.items.forEach(it => {
      const vistos = new Set();          // el mismo insumo dos veces en un análisis cuenta un ítem
      (it.comp || []).forEach(c => {
        if (vistos.has(c.ins)) return;
        vistos.add(c.ins);
        n[c.ins] = (n[c.ins] || 0) + 1;
      });
    }));
    return n;
  }
  /**
   * Los insumos que de verdad entran en algún análisis, en el orden de siempre.
   * El B-3 es el resumen de lo que consume la obra: un insumo que no participa
   * en ningún ítem no aporta cantidad ni monto, y en una comparación entre dos
   * presupuestos solo agrega renglones vacíos. Se sigue pudiendo ver la lista
   * completa desde la pestaña INSUMOS.
   */
  function insumosEnUso() {
    const n = usosPorInsumo();
    return insumosOrdenados().filter(x => n[x.id] > 0);
  }
  /**
   * Dónde se usa un insumo, abierto ítem por ítem: el rendimiento con que entra
   * en cada análisis, la cantidad que aporta a la obra (cantidad del ítem por
   * rendimiento) y su monto. La suma de `cant` es lo mismo que devuelve
   * `requerimiento()` para ese insumo, pero acá desagregado.
   * Si el mismo insumo aparece dos veces en un análisis, los rendimientos se suman.
   * @param {string} id insumo
   * @returns {Array<{modulo:Object,item:Object,rend:number,cant:number,monto:number}>}
   */
  function detalleInsumo(id) {
    const ins = P.insumos[id];
    if (!ins) return [];
    const out = [];
    P.modulos.forEach(m => m.items.forEach(it => {
      let rend = 0, hay = false;
      (it.comp || []).forEach(c => { if (c.ins === id) { hay = true; rend += Number(c.rend) || 0; } });
      if (!hay) return;
      const cant = r((Number(it.cant) || 0) * rend, 4);
      out.push({ modulo: m, item: it, rend, cant, monto: r2(cant * (Number(ins.p) || 0)) });
    }));
    return out;
  }
  /* ---------------- orden único de los insumos ----------------
     En toda la aplicación —rejillas, análisis B-2, reportes y exportación a
     Excel— los insumos van en el mismo orden: primero MATERIALES, después
     MANO DE OBRA y por último EQUIPO, y dentro de cada grupo por descripción
     de la A a la Z. */
  const ORDEN_TIPO = { M: 1, O: 2, E: 3 };
  /** Compara dos insumos: por tipo (M, O, E) y después por descripción A-Z. */
  function cmpIns(a, b) {
    return (ORDEN_TIPO[a.t] || 9) - (ORDEN_TIPO[b.t] || 9) ||
      cmpTexto(a.d, b.d) || cmpTexto(a.u, b.u);
  }
  /** Compara descripciones A-Z sin que acentos ni mayúsculas cambien el orden. */
  const cmpTexto = (a, b) =>
    String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base', numeric: true });

  function insumosOrdenados() {
    return Object.values(P.insumos).sort(cmpIns);
  }

  /* ---------------- numeración corrida de los ítems ----------------
     El N° del ítem es del PRESUPUESTO, no del módulo. En el B-1 impreso y en
     el Excel siempre fue así —el módulo 2 sigue donde terminó el 1— pero la
     rejilla de la pantalla contaba desde 1 en cada módulo, y entonces el
     ítem 5 de la pantalla era el 23 del documento que se presenta. Al revisar
     una observación por número, eso hace perder tiempo y confunde.

     Estas dos funciones son la única fuente del número, para que la pantalla
     y los reportes no puedan volver a separarse. */

  /** Cuántos ítems hay en los módulos anteriores a `k`. */
  function itemsAntesDelModulo(k) {
    const n = (k === undefined || k === null) ? P.moduloActivo : k;
    let s = 0;
    for (let i = 0; i < n && i < P.modulos.length; i++) s += P.modulos[i].items.length;
    return s;
  }

  /**
   * El número con que un ítem sale en el B-1: corrido por todo el proyecto.
   * @returns {number} 1..N, o 0 si el ítem no está en el presupuesto
   */
  function numeroItem(id) {
    let n = 0;
    for (const m of P.modulos) {
      for (const it of m.items) { n++; if (it.id === id) return n; }
    }
    return 0;
  }

  /* ---------------- ítems ---------------- */
  function itemNuevo(datos) {
    const it = Object.assign({
      id: nid(), cod: '', desc: 'NUEVO ÍTEM', und: 'm²', cant: 1,
      comp: [],           // [{ins:idInsumo, rend:número}]
      computos: [],       // [{d, n, l, a, h}]
      dias: 0, inicio: 0, // cronograma (día relativo al inicio de obra)
      pred: '',           // predecesoras, estilo MS Project: "3", "3CC+2"
      tren: '',           // tren de trabajo (vacío = el primero)
      rec: null,          // % de recursos propio; null = el del tren
      origen: ''
    }, datos || {});
    return it;
  }
  function addItem(datos, pos) {
    const it = itemNuevo(datos);
    const L = items();
    if (pos === undefined || pos < 0 || pos > L.length) L.push(it); else L.splice(pos, 0, it);
    P.itemSel = it.id;
    return it;
  }
  function getItem(id) {
    for (const m of P.modulos) { const it = m.items.find(x => x.id === id); if (it) return it; }
    return null;
  }
  function delItem(id) {
    P.modulos.forEach(m => {
      const k = m.items.findIndex(x => x.id === id);
      if (k >= 0) m.items.splice(k, 1);
    });
    if (P.itemSel === id) P.itemSel = null;
  }
  function moverItem(id, dir) {
    const L = items(); const k = L.findIndex(x => x.id === id);
    if (k < 0) return; const j = k + dir;
    if (j < 0 || j >= L.length) return;
    [L[k], L[j]] = [L[j], L[k]];
  }
  function duplicarItem(id) {
    const it = getItem(id); if (!it) return null;
    const cp = JSON.parse(JSON.stringify(it));
    cp.id = nid(); cp.desc = it.desc + ' (copia)';
    const L = items(); L.splice(L.findIndex(x => x.id === id) + 1, 0, cp);
    P.itemSel = cp.id;
    return cp;
  }

  /* =====================================================================
     ANÁLISIS DE PRECIO UNITARIO — Formulario B-2
     ===================================================================== */
  function analisis(it) {
    const g = { M: [], O: [], E: [] };
    let m = 0, o = 0, e = 0;
    (it.comp || []).forEach(c => {
      const ins = P.insumos[c.ins];
      if (!ins) return;
      /* el parcial se muestra con 2 decimales, pero los subtotales se
         acumulan sin redondear: así se calculan los subtotales en los archivos
         .PRE que importa la aplicación */
      const bruto = Number(c.rend || 0) * Number(ins.p || 0);
      const fila = { ins, rend: Number(c.rend || 0), pu: Number(ins.p || 0), parcial: r2(bruto), ref: c };
      g[ins.t] ? g[ins.t].push(fila) : g.M.push(fila);
      if (ins.t === 'O') o += bruto; else if (ins.t === 'E') e += bruto; else m += bruto;
    });

    /* cada grupo sale de la A a la Z, igual que en los reportes y en el Excel */
    g.M.sort((x, y) => cmpTexto(x.ins.d, y.ins.d) || cmpTexto(x.ins.u, y.ins.u));
    g.O.sort((x, y) => cmpTexto(x.ins.d, y.ins.d) || cmpTexto(x.ins.u, y.ins.u));
    g.E.sort((x, y) => cmpTexto(x.ins.d, y.ins.d) || cmpTexto(x.ins.u, y.ins.u));

    const R = cadenaRecargos(m, o, e);

    /* ---- el precio unitario que trajo el archivo de origen ----
       Ver `puDelArchivo`. Vale mientras el análisis no se toque: si algo
       cambia, el crudo cambia con él y el valor guardado deja de aplicar
       solo. El ajuste se muestra como un renglón más del B-2 para que el
       análisis siga sumando exactamente su precio unitario. */
    const fijo = puVigente(it, R.crudo);
    const pu = fijo === null ? R.pu : fijo;
    const ajuste = r2(pu - R.pu);

    return {
      grupos: g, mat: r2(m), mo: r2(o), eq: r2(e),
      matX: m, moX: o, eqX: e,          // sin redondear (para acumulados)
      cargas: r2(R.cargas), ivaMO: r2(R.ivaMO), totalMO: r2(R.totalMO),
      herr: r2(R.herr), totalEQ: r2(R.totalEQ), subtotal: r2(R.subtotal),
      gg: r2(R.gg), parcial2: r2(R.parcial2), util: r2(R.util),
      parcial3: r2(R.parcial3), it: r2(R.it),
      /* la cadena corrida, fila por fila: es lo que dibujan el panel del
         análisis, el B-2 impreso y el Excel. Con el formato oficial trae las
         mismas doce filas de siempre; con uno propio, las que haya. */
      cadena: R.filas,
      puCalculado: R.pu, ajuste, deArchivo: fijo !== null && ajuste !== 0,
      pu,
      total: r2(pu * (Number(it.cant) || 0))
    };
  }

  /* =====================================================================
     EL PRECIO UNITARIO QUE TRAJO EL ARCHIVO
     ---------------------------------------------------------------------
     PRESCOM guarda los subtotales de cada análisis REDONDEADOS A 3 DECIMALES
     y el precio unitario a 2. Los dígitos que descarta son, en los ítems cuyo
     precio cae a menos de medio centavo del límite de redondeo, los que
     deciden para qué lado va el centavo. Medido sobre un proyecto real de 250
     ítems: 12 quedaban a un centavo y ninguna regla de redondeo los reproduce
     —se probó redondeo por renglón, solo totales, toda la cadena en float32 y
     redondeo hacia arriba—, ni siquiera partiendo de los subtotales que el
     propio archivo guarda. La información no está en el archivo.

     Por eso, en un proyecto importado manda el precio unitario del archivo:
     es el del documento aprobado, y así el presupuesto cierra en 0,00 contra
     PRESCOM. En cuanto se edita el análisis se vuelve al cálculo.

     Cómo se sabe que «se editó»: se guarda junto al precio el valor CRUDO de
     la cadena en el momento de importar. Cualquier cambio —un rendimiento,
     un precio de insumo, una incidencia del proyecto— mueve ese crudo y el
     valor guardado deja de aplicar. No hace falta avisar desde cada lugar que
     modifica algo, que es justamente lo que se olvida.
     ===================================================================== */

  /** @returns {number|null} el P.U. del archivo si todavía corresponde */
  function puVigente(it, crudo) {
    const a = it && it.puArchivo;
    if (!a || typeof a.pu !== 'number') return null;
    return Math.abs(crudo - a.crudo) < 1e-9 ? a.pu : null;
  }

  /** Marca el P.U. que trae el archivo para un ítem recién importado. */
  function fijarPuDeArchivo(it, pu) {
    const g = { m: 0, o: 0, e: 0 };
    (it.comp || []).forEach(c => {
      const ins = P.insumos[c.ins]; if (!ins) return;
      const v = Number(c.rend || 0) * Number(ins.p || 0);
      if (ins.t === 'O') g.o += v; else if (ins.t === 'E') g.e += v; else g.m += v;
    });
    it.puArchivo = { pu: Math.round((Number(pu) || 0) * 100) / 100,
                     crudo: cadenaRecargos(g.m, g.o, g.e).crudo };
    return it.puArchivo;
  }

  /** Suelta los P.U. del archivo: de acá en más manda el cálculo. */
  function soltarPuDeArchivo() {
    let n = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      if (it.puArchivo) { delete it.puArchivo; n++; }
    }));
    return n;
  }

  /** Cuántos ítems siguen mostrando el precio unitario del archivo. */
  function conPuDeArchivo() {
    let n = 0, conAjuste = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      if (!it.puArchivo) return;
      const a = analisis(it);
      if (a.deArchivo) { n++; conAjuste++; }
      else if (puVigente(it, cadenaRecargos(a.matX, a.moX, a.eqX).crudo) !== null) n++;
    }));
    return { items: n, conAjuste };
  }

  /* Cadena de recargos del B-2 sobre los tres subtotales (materiales, mano de
     obra, equipo). Se calcula SIN redondeos intermedios y se redondea solo el
     precio unitario final. Los parciales de cada insumo sí van a 2 decimales,
     que es como se imprimen y como están en los archivos originales.
     La usan el análisis del proyecto y la vista previa al traer un ítem de la
     Base de Datos. */
  function cadenaRecargos(m, o, e) {
    /* Desde la v2.6 la cadena es un dato del proyecto y no seis cuentas
       escritas acá. Con el formato oficial el resultado es exactamente el
       mismo que antes —las filas de FILAS_SABS son esas seis cuentas— así que
       ningún presupuesto existente cambia de precio. Ver `correrCadena`. */
    return correrCadena(m, o, e);
  }

  /* =====================================================================
     EDICIÓN MASIVA

     Corregir un rendimiento se hace en el análisis del ítem, y está bien
     mientras sean pocos. En un presupuesto de doscientos ítems, cambiar el
     rendimiento del albañil en todos los que lo usan era abrir doscientos
     análisis. Estas cuatro operaciones hacen eso de una vez:

       matrizApuInsumo   ver y escribir los rendimientos como una planilla
       factorRendimiento multiplicar rendimientos por un factor
       fijarRendimiento  escribir un rendimiento suelto (lo usa la matriz)
       fusionarApus      juntar los insumos de varios análisis en uno
       crearItemsEnLote  cargar muchos ítems de un tirón, desde una lista

     Todas trabajan sobre los ítems que se les pasen: el alcance lo decide
     quien llama, no la función.
     ===================================================================== */

  /** Los ítems de un alcance: ids sueltos, un módulo entero o todo el proyecto. */
  function itemsDelAlcance(alcance) {
    if (alcance && Array.isArray(alcance.ids)) {
      const set = new Set(alcance.ids);
      return todosItems().filter(x => set.has(x.i.id)).map(x => x.i);
    }
    if (alcance && alcance.modulo !== undefined && alcance.modulo !== null) {
      const m = P.modulos[alcance.modulo];
      return m ? m.items.slice() : [];
    }
    return todosItems().map(x => x.i);
  }

  /**
   * La planilla rendimiento por rendimiento: insumos en las filas, ítems en
   * las columnas. Solo se devuelven los insumos que participan en alguno de
   * esos ítems — una matriz con los 1.200 insumos de un PRESCOM importado
   * sería casi toda ceros y no se podría leer.
   * @param {{ids?:string[], modulo?:number, tipo?:string}} [op] alcance y filtro por tipo (M/O/E)
   * @returns {{items:Array, insumos:Array, rend:Object}} `rend['idIns|idItem']` = rendimiento
   */
  function matrizApuInsumo(op) {
    const its = itemsDelAlcance(op);
    const rend = {};
    const usados = new Set();
    its.forEach(it => (it.comp || []).forEach(c => {
      if (!P.insumos[c.ins]) return;
      usados.add(c.ins);
      const k = c.ins + '|' + it.id;
      /* el mismo insumo dos veces en un análisis se muestra sumado, que es
         como entra en el costo */
      rend[k] = (rend[k] || 0) + (Number(c.rend) || 0);
    }));
    const tipo = op && op.tipo;
    const insumos = insumosOrdenados()
      .filter(x => usados.has(x.id) && (!tipo || x.t === tipo));
    return { items: its, insumos, rend };
  }

  /**
   * Escribe el rendimiento de un insumo dentro de un ítem.
   * Con 0 se quita el insumo del análisis: dejar un renglón en cero ensucia el
   * B-2 y no aporta costo. Si el insumo no estaba, se agrega.
   * Si aparecía repetido en el análisis, queda un solo renglón con el valor
   * escrito — que es lo que la matriz venía mostrando.
   * @returns {boolean} si algo cambió
   */
  function fijarRendimiento(idItem, idIns, valor) {
    const it = getItem(idItem);
    if (!it || !P.insumos[idIns]) return false;
    const v = Number(valor) || 0;
    const antes = (it.comp || []).filter(c => c.ins === idIns);
    const suma = antes.reduce((s, c) => s + (Number(c.rend) || 0), 0);
    if (antes.length === 1 && Math.abs(suma - v) < 1e-9) return false;
    it.comp = (it.comp || []).filter(c => c.ins !== idIns);
    if (v !== 0) it.comp.push({ ins: idIns, rend: v });
    return true;
  }

  /**
   * Multiplica rendimientos por un factor.
   * Sirve para lo de todos los días: subir un 10 % la mano de obra de un
   * frente, bajar el desperdicio de materiales, ajustar un análisis traído de
   * otra región. No toca precios: el factor es de rendimiento.
   * @param {{ids?:string[], modulo?:number}} alcance qué ítems
   * @param {number} factor 1.10 sube un 10 %
   * @param {{tipos?:string[], insumos?:string[], decimales?:number}} [op]
   * @returns {{items:number, renglones:number}}
   */
  function factorRendimiento(alcance, factor, op) {
    const f = Number(factor);
    if (!isFinite(f) || f <= 0) return { items: 0, renglones: 0 };
    const tipos = (op && op.tipos && op.tipos.length) ? new Set(op.tipos) : null;
    const soloIns = (op && op.insumos && op.insumos.length) ? new Set(op.insumos) : null;
    const dec = (op && op.decimales !== undefined) ? op.decimales : 6;
    let items = 0, renglones = 0;
    itemsDelAlcance(alcance).forEach(it => {
      let tocado = false;
      (it.comp || []).forEach(c => {
        const ins = P.insumos[c.ins];
        if (!ins) return;
        if (tipos && !tipos.has(ins.t)) return;
        if (soloIns && !soloIns.has(c.ins)) return;
        const nuevo = r(Number(c.rend) * f, dec);
        if (Math.abs(nuevo - Number(c.rend)) < 1e-12) return;
        c.rend = nuevo; tocado = true; renglones++;
      });
      if (tocado) items++;
    });
    return { items, renglones };
  }

  /**
   * Junta varios análisis en uno.
   * El ítem destino se queda con sus insumos más los de los otros; si un
   * insumo está en los dos, los rendimientos se suman (`modo` 'sumar') o
   * manda el del destino ('mantener'). Los ítems de origen se eliminan, con
   * su cantidad: el destino conserva la suya, porque fusionar análisis no es
   * fusionar cantidades de obra.
   * @param {string} idDestino
   * @param {string[]} idsOrigen
   * @param {'sumar'|'mantener'} [modo='sumar']
   * @returns {{insumos:number, items:number}}
   */
  function fusionarApus(idDestino, idsOrigen, modo) {
    const dest = getItem(idDestino);
    if (!dest) return { insumos: 0, items: 0 };
    const sumar = modo !== 'mantener';
    const mapa = new Map();
    (dest.comp || []).forEach(c => mapa.set(c.ins, (mapa.get(c.ins) || 0) + (Number(c.rend) || 0)));
    let nuevos = 0, quitados = 0;
    (idsOrigen || []).filter(id => id !== idDestino).forEach(id => {
      const o = getItem(id);
      if (!o) return;
      (o.comp || []).forEach(c => {
        if (!P.insumos[c.ins]) return;
        if (mapa.has(c.ins)) { if (sumar) mapa.set(c.ins, mapa.get(c.ins) + (Number(c.rend) || 0)); }
        else { mapa.set(c.ins, Number(c.rend) || 0); nuevos++; }
      });
      /* `delItem` no devuelve nada: ya se comprobó arriba que el ítem existe */
      delItem(id); quitados++;
    });
    dest.comp = Array.from(mapa, ([ins, rend]) => ({ ins, rend }));
    /* el precio que trajo el archivo deja de valer: el análisis ya no es el
       que se importó */
    delete dest.puArchivo;
    return { insumos: nuevos, items: quitados };
  }

  /**
   * Crea muchos ítems de una lista de texto, una línea por ítem.
   * Formato: `descripción ; unidad ; cantidad` — también acepta tabulaciones,
   * que es lo que sale al copiar una columna de Excel. La unidad y la cantidad
   * son opcionales.
   * Los ítems se crean SIN análisis: quedan listos para traerles el suyo de la
   * Base de Datos o cargarlo a mano. Es la carga rápida de un presupuesto que
   * llega en papel o en una planilla.
   * @param {string} texto
   * @param {{und?:string, cant?:number}} [porDefecto]
   * @returns {{items:Array, saltadas:number}}
   */
  function crearItemsEnLote(texto, porDefecto) {
    const und0 = (porDefecto && porDefecto.und) || 'glb';
    const cant0 = (porDefecto && Number(porDefecto.cant)) || 1;
    const creados = [];
    let saltadas = 0;
    String(texto || '').split(/\r?\n/).forEach(linea => {
      const partes = linea.split(/\t|;|\|/).map(x => x.trim());
      const desc = (partes[0] || '').trim();
      if (!desc) { if (linea.trim()) saltadas++; return; }
      const und = partes[1] || und0;
      /* la coma decimal es lo normal en una planilla en español */
      const cant = partes[2] ? Number(String(partes[2]).replace(/\./g, '').replace(',', '.')) : cant0;
      const it = itemNuevo({
        desc: desc.toUpperCase() === desc ? desc : desc,
        und, cant: isFinite(cant) && cant > 0 ? cant : cant0
      });
      items().push(it);
      creados.push(it);
    });
    if (creados.length) P.itemSel = creados[creados.length - 1].id;
    return { items: creados, saltadas };
  }

  /* ---------------- totales de módulo / proyecto ---------------- */
  function totalModulo(m) {
    return r2(m.items.reduce((s, it) => s + analisis(it).total, 0));
  }
  function totalProyecto() {
    return r2(P.modulos.reduce((s, m) => s + totalModulo(m), 0));
  }
  function conv(v) { return P.moneda === '$US' ? v / (P.tc || 1) : v; }
  function fmt(v, d) {
    d = (d === undefined) ? P.precision : d;
    return (Number(v) || 0).toLocaleString('es-BO', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* ---------------- cómputos métricos ----------------
     Cada fila multiplica el número de veces por las medidas que estén
     cargadas; las casillas vacías no multiplican. Además del largo, el ancho
     y el alto se pueden cargar directamente el área o el volumen medidos del
     plano: ÁREA × alto da el volumen, y VOLUMEN va solo.                     */
  const MEDIDAS_COMPUTO = ['l', 'a', 'h', 'ar', 'vo'];
  const brutoComputo = c => {
    let v = Number(c.n) || 0;
    MEDIDAS_COMPUTO.forEach(k => { const x = Number(c[k]) || 0; if (x) v *= x; });
    return v;
  };
  function totalComputos(it) {
    return r2((it.computos || []).reduce((s, c) => s + brutoComputo(c), 0));
  }
  function parcialComputo(c) { return r2(brutoComputo(c)); }

  /* ---------------- requerimiento total de insumos ---------------- */
  function requerimiento() {
    const acc = {};
    P.modulos.forEach(m => m.items.forEach(it => {
      const q = Number(it.cant) || 0;
      (it.comp || []).forEach(c => {
        const ins = P.insumos[c.ins]; if (!ins) return;
        if (!acc[ins.id]) acc[ins.id] = { ins, cant: 0, monto: 0 };
        acc[ins.id].cant += q * (Number(c.rend) || 0);
      });
    }));
    const L = Object.values(acc);
    L.forEach(x => { x.cant = r(x.cant, 4); x.monto = r2(x.cant * x.ins.p); });
    L.sort((a, b) => cmpIns(a.ins, b.ins));
    return L;
  }

  /* =====================================================================
     INSUMOS REPETIDOS

     Al traer ítems de distintas bases —o al importar un proyecto— es normal
     que quede el mismo insumo cargado dos veces con precios distintos. Acá se
     detectan y se fusionan en uno solo.
     ===================================================================== */

  /** Clave de comparación: mismo tipo y misma descripción, sin acentos ni
      mayúsculas. La unidad NO entra: el caso típico es el mismo material
      cargado como «kg» y «KG», o con el mismo nombre a dos precios. */
  const claveDup = x => x.t + '|' + norm((x.d || '').trim()).replace(/\s+/g, ' ');

  /**
   * Grupos de insumos repetidos del proyecto.
   * @returns {Array<{clave, t, d, ins:Array<{ins, usos:number, monto:number}>}>}
   *          ordenados igual que el resto: M, O, E y A-Z.
   */
  function duplicadosInsumo() {
    const req = {};
    requerimiento().forEach(x => req[x.ins.id] = x);
    const por = {};
    insumosOrdenados().forEach(x => {
      const k = claveDup(x);
      (por[k] = por[k] || []).push({
        ins: x,
        usos: usoInsumo(x.id).length,
        monto: req[x.id] ? req[x.id].monto : 0
      });
    });
    return Object.keys(por).filter(k => por[k].length > 1).map(k => ({
      clave: k, t: por[k][0].ins.t, d: por[k][0].ins.d, ins: por[k]
    })).sort((a, b) => cmpIns(a.ins[0].ins, b.ins[0].ins));
  }

  /**
   * Deja un solo insumo de un grupo repetido: todos los análisis pasan a
   * apuntar al que queda y los demás se eliminan.
   * @param {string} idQueda  insumo que sobrevive
   * @param {string[]} idsFuera insumos que se eliminan
   * @param {number} [precio] precio a dejar en el que queda; si no se pasa, se
   *                          respeta el que ya tenía
   * @returns {{items:number, quitados:number}}
   */
  function fusionarInsumos(idQueda, idsFuera, precio) {
    const queda = P.insumos[idQueda];
    if (!queda) return { items: 0, quitados: 0 };
    /* el precio elegido al depurar lo decidió el usuario: se fecha si cambió */
    if (precio !== undefined && precio !== null && isFinite(precio)) fijarPrecio(queda, precio);
    const fuera = (idsFuera || []).filter(id => id !== idQueda && P.insumos[id]);
    const tocados = new Set();
    P.modulos.forEach(m => m.items.forEach(it => {
      let cambio = false;
      (it.comp || []).forEach(c => {
        if (fuera.indexOf(c.ins) < 0) return;
        c.ins = idQueda; cambio = true;
      });
      if (!cambio) return;
      tocados.add(it.id);
      /* si el ítem tenía los dos insumos, los rendimientos se suman en uno */
      const acum = {};
      it.comp.forEach(c => { acum[c.ins] = (acum[c.ins] || 0) + (Number(c.rend) || 0); });
      const vistos = {};
      it.comp = it.comp.filter(c => {
        if (vistos[c.ins]) return false;
        vistos[c.ins] = true; c.rend = acum[c.ins];
        return true;
      });
    }));
    fuera.forEach(id => { delete P.insumos[id]; });
    return { items: tocados.size, quitados: fuera.length };
  }

  /**
   * Insumos de un análisis que el proyecto ya tiene con OTRO precio.
   * Se usa al traer un ítem de la Base de Datos a un proyecto que ya viene
   * cargado, para no terminar con dos insumos casi iguales.
   * @param {Array<{t,d,u,p,q}>} comps componentes del análisis que se va a traer
   * @returns {Array<{c, ins, dif:number}>}
   */
  function conflictosInsumos(comps) {
    const out = [];
    (comps || []).forEach(c => {
      const ex = buscarInsumo(c.t, c.d, c.u);
      if (!ex) return;
      const dif = Number(c.p || 0) - Number(ex.p || 0);
      if (Math.abs(dif) < 0.005) return;         // mismo precio: no hay conflicto
      out.push({ c, ins: ex, dif });
    });
    return out.sort((a, b) => cmpIns(a.ins, b.ins));
  }

  /* =====================================================================
     BASE DE DATOS DE ANÁLISIS DE PRECIOS UNITARIOS
     ===================================================================== */
  const BD = { bases: [], stats: {} };

  function indexarBase(b) {
    b.imap = {}; b.ins.forEach(i => b.imap[i.seq] = i);
    b.busq = b.apus.map(a => norm(a.d + ' ' + a.cod));
    b.ibusq = b.ins.map(i => norm(i.d + ' ' + i.u));
    return b;
  }

  /** Carga (o reemplaza) la Base de Datos en memoria. Se usa al arrancar y
      también cuando llega cifrada y se descifra después de pedir la clave. */
  let _crudo = null;                 // último paquete cargado, para poder rearmarlo

  function cargarCatalogo(raw) {
    raw = (raw && raw.bases) ? raw : { bases: [], stats: {} };
    _crudo = raw;
    const bases = raw.bases.map(b => indexarBase({
      id: b.id, n: b.n, f: b.f,
      ins: b.ins.map(a => ({ seq: a[0], t: a[1], d: a[2], u: a[3], p: a[4] })),
      apus: b.apus.map(a => ({ seq: a[0], cod: a[1], d: a[2], u: a[3], tm: a[4], to: a[5], te: a[6], c: a[7] }))
    }));
    BD.bases = bases;
    BD.stats = raw.stats || {};
    aplicarBDU();
    return BD;
  }

  /* ---------------------------------------------------------------------
     BASES DE DATOS PROPIAS (se guardan en este navegador)

     - bases   : bases que arma el usuario. Cada una tiene su nombre y su
                 lista de análisis. La primera, «MIS ANÁLISIS», se crea sola
                 la primera vez que se guarda un ítem nuevo.
     - cambios : análisis de una base publicada que el usuario reescribió
                 (costos de sus insumos, mano de obra o maquinaria).

     El archivo original de la Base de Datos nunca se modifica: todo esto se
     vuelve a aplicar sobre lo cargado cada vez que arranca la aplicación.
     --------------------------------------------------------------------- */
  const LS_BDU = 'openboq_bd_propia';
  const ID_PROPIA = 9001;          // primera base propia
  const N_PROPIA = 'MIS ANÁLISIS';
  let BDU = { bases: [], cambios: [] };

  function cargarBDU() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_BDU) || 'null');
      if (!o) return;
      if (Array.isArray(o.bases)) BDU = { bases: o.bases, cambios: o.cambios || [] };
      /* formato anterior: una sola lista de análisis propios */
      else if (Array.isArray(o.propios)) BDU = {
        bases: o.propios.length ? [{ id: ID_PROPIA, n: N_PROPIA, apus: o.propios }] : [],
        cambios: o.cambios || []
      };
    } catch (e) { /* sin localStorage la capa propia queda vacía */ }
  }

  /** Bases que armó el usuario en este equipo. */
  const basesPropias = () => BDU.bases.map(b => ({ id: b.id, n: b.n, apus: b.apus.length }));

  /* La capa propia entera, para respaldarla fuera de este navegador. Sale
     una copia y no la referencia viva: quien la reciba no debe poder
     modificar el estado de la aplicación sin pasar por importarBDU. */
  const exportarBDU = () => JSON.parse(JSON.stringify(BDU));

  /**
   * Reemplaza la capa propia por una guardada. Devuelve cuántas bases y
   * análisis entraron, o null si el paquete no tiene la forma esperada.
   */
  function importarBDU(o) {
    if (!o || !Array.isArray(o.bases)) return null;
    BDU = { bases: o.bases, cambios: Array.isArray(o.cambios) ? o.cambios : [] };
    guardarBDU(); aplicarBDU();
    return {
      bases: BDU.bases.length,
      apus: BDU.bases.reduce((s, b) => s + ((b.apus && b.apus.length) || 0), 0)
    };
  }
  const esBasePropia = id => BDU.bases.some(b => b.id === Number(id));

  /** Primer nombre libre: si ya hay una base así, se numera « (2)», « (3)»… */
  function nombreLibreBase(nombre) {
    const raiz = String(nombre).replace(/\s*\(\d+\)\s*$/, '');
    if (!BDU.bases.some(b => norm(b.n) === norm(raiz))) return raiz;
    let n = 2;
    while (BDU.bases.some(b => norm(b.n) === norm(raiz + ' (' + n + ')'))) n++;
    return raiz + ' (' + n + ')';
  }

  /**
   * Crea una base de datos vacía en este equipo.
   * @param {string} nombre
   * @returns {{id:number, n:string}}
   */
  function crearBasePropia(nombre) {
    const id = BDU.bases.reduce((m, b) => Math.max(m, b.id), ID_PROPIA - 1) + 1;
    const b = {
      id,
      n: nombreLibreBase((nombre || '').trim() || ('MI BASE ' + (BDU.bases.length + 1))),
      apus: []
    };
    BDU.bases.push(b);
    guardarBDU(); aplicarBDU();
    return { id: b.id, n: b.n };
  }
  function renombrarBasePropia(id, nombre) {
    const b = BDU.bases.find(x => x.id === Number(id)); if (!b) return false;
    b.n = (nombre || '').trim() || b.n;
    guardarBDU(); aplicarBDU();
    return true;
  }
  function eliminarBasePropia(id) {
    const k = BDU.bases.findIndex(x => x.id === Number(id)); if (k < 0) return false;
    BDU.bases.splice(k, 1);
    guardarBDU();
    cargarCatalogo(_crudo);
    return true;
  }
  /** Base propia por id; si no se pasa ninguno, la primera (creándola si hace falta). */
  function basePropia(id) {
    if (id) { const b = BDU.bases.find(x => x.id === Number(id)); if (b) return b; }
    if (!BDU.bases.length) BDU.bases.push({ id: ID_PROPIA, n: N_PROPIA, apus: [] });
    return BDU.bases[0];
  }

  /** Análisis de un ítem del presupuesto, en el formato de las bases propias. */
  function payloadItem(it) {
    return {
      cod: it.cod || '', d: it.desc, u: it.und || 'glb',
      c: (it.comp || []).map(c => {
        const i = P.insumos[c.ins]; if (!i) return null;
        return { t: i.t, d: i.d, u: i.u, p: Number(i.p) || 0, f: i.f || '', q: Number(c.rend) || 0 };
      }).filter(Boolean).sort(cmpIns)
    };
  }

  /** Firma de un análisis: dos con la misma firma son el mismo dato, y
      entonces el choque de descripciones no es un conflicto de verdad. */
  function firmaApu(pay) {
    return norm(pay.d) + '|' + norm(pay.u) + '|' + (pay.c || [])
      .map(c => c.t + norm(c.d) + '|' + norm(c.u) + '|' + r2(c.p) + '|' + r(c.q, 6)).join(';');
  }

  /** Ítems del presupuesto que tienen análisis cargado: son los únicos que se
      pueden guardar en una base. */
  const itemsConAnalisis = () =>
    todosItems().filter(x => x.i.comp && x.i.comp.length).map(x => ({ m: x.m, it: x.i }));

  /**
   * Análisis del presupuesto que la base destino ya tiene con la misma
   * descripción. Se consulta ANTES de volcar, para preguntar qué hacer con
   * cada uno en vez de reemplazarlo en silencio.
   * @param {number} idBase base destino
   * @param {string[]} [ids] ítems a volcar; vacío = todos los que tengan análisis
   * @returns {Array<{it:Object, pay:Object, apu:Object, igual:boolean}>}
   */
  function conflictosVolcado(idBase, ids) {
    const b = BDU.bases.find(x => x.id === Number(idBase));
    if (!b) return [];
    const filtro = (ids && ids.length) ? new Set(ids) : null;
    const out = [];
    itemsConAnalisis().forEach(({ it }) => {
      if (filtro && !filtro.has(it.id)) return;
      const pay = payloadItem(it);
      const apu = b.apus.find(p => norm(p.d) === norm(pay.d));
      if (!apu) return;
      out.push({ it, pay, apu, igual: firmaApu(apu) === firmaApu(pay) });
    });
    return out;
  }

  /** Primera descripción libre en la base, numerando « (2)», « (3)»… */
  function descLibre(b, d) {
    const raiz = String(d).replace(/\s*\(\d+\)\s*$/, '');
    let n = 2;
    while (b.apus.some(p => norm(p.d) === norm(raiz + ' (' + n + ')'))) n++;
    return raiz + ' (' + n + ')';
  }

  /**
   * Copia los ítems del presupuesto actual a una base propia, para reusarlos
   * en otros proyectos.
   * @param {number} idBase  base destino; vacío = la primera
   * @param {Object} [o]
   * @param {string[]} [o.ids] ítems a copiar; vacío = todos los que tengan análisis
   * @param {string} [o.modo] qué hacer con el que ya está en la base con la
   *        misma descripción: 'reemplazar' (por defecto), 'ambos' —el nuevo
   *        entra con la descripción numerada y el viejo queda— u 'omitir'.
   * @param {Object} [o.decisiones] modo por ítem, {idItem: modo}; gana sobre o.modo
   * @returns {{base:string, nuevos:number, actualizados:number, copias:number, omitidos:number}}
   */
  function volcarProyectoABase(idBase, o) {
    o = o || {};
    const b = basePropia(idBase);
    const filtro = (o.ids && o.ids.length) ? new Set(o.ids) : null;
    const res = { base: b.n, nuevos: 0, actualizados: 0, copias: 0, omitidos: 0 };
    itemsConAnalisis().forEach(({ it }) => {
      if (filtro && !filtro.has(it.id)) return;
      const pay = payloadItem(it);
      const k = b.apus.findIndex(p => norm(p.d) === norm(pay.d));
      if (k < 0) { b.apus.push(pay); res.nuevos++; return; }
      const modo = (o.decisiones && o.decisiones[it.id]) || o.modo || 'reemplazar';
      if (modo === 'omitir') { res.omitidos++; return; }
      if (modo === 'ambos') {
        /* el que ya estaba no se toca: entra el nuevo con otra descripción */
        pay.d = descLibre(b, pay.d);
        b.apus.push(pay); res.copias++; return;
      }
      b.apus[k] = pay; res.actualizados++;
    });
    guardarBDU(); aplicarBDU();
    return res;
  }
  function guardarBDU() {
    try { localStorage.setItem(LS_BDU, JSON.stringify(BDU)); return true; }
    catch (e) { return false; }
  }

  /** Copia editable e independiente de un análisis de la Base de Datos.
      @returns {{cod:string, d:string, u:string, c:Array<{t,d,u,p,q}>}} */
  function payloadApu(base, apu) {
    return {
      cod: apu.cod || '', d: apu.d, u: apu.u || 'glb',
      /* mismo orden que en todo lo demás: M, O, E y dentro de cada uno A-Z */
      c: (apu.c || []).map(c => {
        const i = base.imap[c[0]] || { t: 'M', d: '—', u: 'pza', p: 0 };
        return { t: i.t, d: i.d, u: i.u, p: Number(i.p) || 0, f: i.f || '', q: Number(c[1]) || 0 };
      }).sort(cmpIns)
    };
  }

  /** Insumo de la base que coincide con el componente; si no está, lo crea.

      En las bases PROPIAS el precio entra en la comparación: el mismo material
      a dos precios son dos insumos distintos. Sin eso, el segundo análisis que
      entra le pisa el precio al primero, que queda mostrando un precio y
      sumando otro en sus subtotales —y es el caso normal al guardar dos
      proyectos PRESCOM en la misma base. Es la misma unicidad
      (análisis, insumo, precio) con la que se guarda el repositorio central.

      En las bases publicadas se mantiene el comportamiento contrario, y es a
      propósito: ACTUALIZAR un análisis corrige el costo de ese insumo en toda
      la base, que es justamente para lo que existe esa opción. */
  function insumoEnBase(b, c) {
    const propia = esBasePropia(b.id);
    const clave = x => norm(x.d) + '|' + norm(x.u) + (propia ? '|' + r2(x.p) : '');
    const k = clave(c);
    let ins = b.ins.find(i => i.t === c.t && clave(i) === k);
    if (!ins) {
      ins = { seq: b.ins.reduce((m, i) => Math.max(m, i.seq), 0) + 1, t: c.t, d: c.d, u: c.u, p: 0 };
      b.ins.push(ins); b.imap[ins.seq] = ins; b.ibusq.push(norm(ins.d + ' ' + ins.u));
    }
    /* guardar un análisis en una base es una decisión del usuario: si el precio
       del insumo se mueve, queda fechado. En las bases del catálogo no se toca. */
    fijarPrecio(ins, c.p, propia);
    return ins;
  }

  /** Reescribe un análisis de una base con los datos editados y recalcula sus
      subtotales de material, mano de obra y equipo. */
  function escribirApu(b, apu, pay) {
    apu.d = pay.d; apu.u = pay.u; apu.cod = pay.cod || apu.cod;
    apu.c = (pay.c || []).map(c => [insumoEnBase(b, c).seq, Number(c.q) || 0]);
    let tm = 0, to = 0, te = 0;
    (pay.c || []).forEach(c => {
      const v = (Number(c.q) || 0) * (Number(c.p) || 0);
      if (c.t === 'O') to += v; else if (c.t === 'E') te += v; else tm += v;
    });
    apu.tm = r2(tm); apu.to = r2(to); apu.te = r2(te);
    const k = b.apus.indexOf(apu);
    if (k >= 0) b.busq[k] = norm(apu.d + ' ' + apu.cod);
    return apu;
  }

  /** Arma las bases propias del usuario y vuelve a aplicar los cambios. */
  function aplicarBDU() {
    BD.bases = BD.bases.filter(b => !esBasePropia(b.id));
    BDU.bases.forEach(prop => {
      const b = indexarBase({ id: prop.id, n: prop.n, f: 'local', ins: [], apus: [] });
      (prop.apus || []).forEach((pay, k) => {
        const apu = { seq: k + 1, cod: pay.cod || 'P' + (k + 1), d: pay.d, u: pay.u, tm: 0, to: 0, te: 0, c: [] };
        b.apus.push(apu); b.busq.push('');
        escribirApu(b, apu, pay);
      });
      BD.bases.push(b);
    });
    BDU.cambios.forEach(ch => {
      const b = BD.bases.find(x => x.id === ch.baseId); if (!b) return;
      const apu = b.apus.find(a => a.seq === ch.seq); if (!apu) return;
      escribirApu(b, apu, ch.pay);
    });
    BD.stats = Object.assign({}, BD.stats, {
      bases: BD.bases.length,
      apus: BD.bases.reduce((s, b) => s + b.apus.length, 0),
      insumos: BD.bases.reduce((s, b) => s + b.ins.length, 0)
    });
    return BD;
  }

  /* ---------------------------------------------------------------------
     PRECIOS QUE LLEGAN DEL REPOSITORIO CENTRAL

     La Base de Datos que trae la aplicación es un archivo, y el archivo
     envejece: un precio corregido en el repositorio no llega a nadie hasta
     republicar. `aplicarDelta` mete esas correcciones sobre lo que ya está
     cargado, sin volver a bajar el catálogo entero.

     OJO con lo que hay que recalcular: en la Base de Datos el costo de cada
     análisis viene SUMADO (`tm`, `to`, `te`), no se calcula al vuelo. Si se
     cambia el precio de un insumo y no se rehacen esos tres números, la
     lista sigue mostrando el costo viejo y el usuario ve un precio distinto
     al que después le aparece en el presupuesto.
     --------------------------------------------------------------------- */

  /**
   * Aplica precios llegados del repositorio central al catálogo en memoria.
   * No toca las bases propias del usuario ni el proyecto abierto.
   *
   * @param {Array<{base:string, tipo:string, descripcion:string, unidad:string, precio:number}>} cambios
   * @returns {{insumos:number, apus:number, bases:number}} qué se movió
   */
  function aplicarDelta(cambios) {
    const res = { insumos: 0, apus: 0, bases: 0 };
    if (!Array.isArray(cambios) || !cambios.length) return res;

    /* los cambios agrupados por nombre de base */
    const porBase = new Map();
    cambios.forEach(c => {
      if (!c || !c.base) return;
      const k = norm(c.base);
      if (!porBase.has(k)) porBase.set(k, []);
      porBase.get(k).push(c);
    });

    BD.bases.forEach(b => {
      if (esBasePropia(b.id)) return;              // lo del usuario no se pisa
      const lista = porBase.get(norm(b.n));
      if (!lista) return;

      const porClave = new Map();
      b.ins.forEach(i => porClave.set(claveIns(i.t, i.d, i.u), i));   // misma clave que usa el proyecto

      const tocados = new Set();
      lista.forEach(c => {
        const ins = porClave.get(claveIns(c.tipo || 'M', c.descripcion, c.unidad));
        if (!ins) return;
        const p = Number(c.precio);
        if (!isFinite(p) || p === Number(ins.p)) return;
        ins.p = p;
        /* acá la fecha no es «hoy»: es la que trae el repositorio central
           (`actualizado_en`), que es cuándo se corrigió el precio de verdad.
           Fecharlo con el día de la sincronización diría cuándo se bajó el
           dato, no de cuándo es el precio. */
        if (c.actualizado_en) ins.f = String(c.actualizado_en).slice(0, 10);
        tocados.add(ins.seq);
        res.insumos++;
      });
      if (!tocados.size) return;
      res.bases++;

      /* se rehacen los totales de los análisis que usan alguno de esos insumos */
      b.apus.forEach(a => {
        if (!(a.c || []).some(c => tocados.has(c[0]))) return;
        let m = 0, o = 0, e = 0;
        a.c.forEach(c => {
          const ins = b.imap[c[0]];
          if (!ins) return;
          const v = (Number(c[1]) || 0) * (Number(ins.p) || 0);
          if (ins.t === 'O') o += v; else if (ins.t === 'E') e += v; else m += v;
        });
        a.tm = r(m, 4); a.to = r(o, 4); a.te = r(e, 4);
        res.apus++;
      });
    });

    /* Los cambios propios del usuario se vuelven a escribir encima: si él
       reescribió un análisis de una base publicada, esa decisión gana. */
    if (res.insumos) BDU.cambios.forEach(ch => {
      const b = BD.bases.find(x => x.id === ch.baseId); if (!b) return;
      const apu = b.apus.find(a => a.seq === ch.seq); if (!apu) return;
      escribirApu(b, apu, ch.pay);
    });

    return res;
  }

  /**
   * Guarda un análisis editado en la Base de Datos de este equipo.
   * @param {Object} pay   análisis editado (ver payloadApu)
   * @param {string} modo  'actualizar' reescribe el análisis de origen —
   *                       cambia los costos de sus insumos, mano de obra y
   *                       maquinaria—; 'nuevo' lo guarda en una base propia.
   * @param {Object} [base] base de origen, para 'actualizar'
   * @param {Object} [apu]  análisis de origen, para 'actualizar'
   * @param {number} [idDestino] base propia donde guardarlo, para 'nuevo'
   */
  function guardarEnBD(pay, modo, base, apu, idDestino) {
    pay = JSON.parse(JSON.stringify(pay));
    if (modo === 'actualizar' && base && apu && !esBasePropia(base.id)) {
      BDU.cambios = BDU.cambios.filter(c => !(c.baseId === base.id && c.seq === apu.seq));
      BDU.cambios.push({ baseId: base.id, seq: apu.seq, pay });
    } else {
      /* si se está reescribiendo un análisis de una base propia, se corrige ahí */
      const b = basePropia(idDestino || (base && esBasePropia(base.id) ? base.id : 0));
      const k = b.apus.findIndex(p => norm(p.d) === norm(pay.d));
      if (k >= 0) b.apus[k] = pay; else b.apus.push(pay);
    }
    guardarBDU();
    aplicarBDU();
    return true;
  }

  /** Cuántos análisis propios y cuántos cambios hay guardados en este equipo. */
  const resumenBDU = () => ({
    bases: BDU.bases.length,
    propios: BDU.bases.reduce((s, b) => s + b.apus.length, 0),
    cambios: BDU.cambios.length
  });

  /** Deja la Base de Datos como vino en el archivo original. */
  function limpiarBDU() {
    BDU = { bases: [], cambios: [] };
    guardarBDU();
    return cargarCatalogo(_crudo);
  }

  cargarBDU();
  cargarCatalogo(typeof window !== 'undefined' ? window.OPENBOQ_DB : null);

  function norm(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  }

  /* =====================================================================
     DESCRIPCIONES GEN\u00c9RICAS

     Un \u00edtem describe UNA ACTIVIDAD, no una obra: \u00abMuro de ladrillo 6H\u00bb,
     no \u00abMuro de ladrillo U.E. Gualberto Villarroel\u00bb. Las descripciones que
     nombran el proyecto, la entidad o el lugar no sirven en otro
     presupuesto y, al aportarlas a la base com\u00fan, arrastran a qu\u00e9 obra
     pertenec\u00edan.

     Dos niveles a prop\u00f3sito:

       BLOQUEA  lo inequ\u00edvoco \u2014 nombre de entidad, n\u00famero de contrato,
                \u00abproyecto\u00bb, un lugar detr\u00e1s de una preposici\u00f3n.
       AVISA    lo que necesita criterio. Un nombre de lugar suelto casi
                siempre es un material (\u00abpiedra Tarija\u00bb, \u00abm\u00e1rmol La Paz\u00bb,
                12 casos reales en el cat\u00e1logo) y no se puede distinguir
                de una ubicaci\u00f3n por regla; decide la persona.

     Calibrado contra las 7.974 descripciones del cat\u00e1logo: bloquea 1
     \u2014que efectivamente dice \u00abCONTRATO\u00bb\u2014 y avisa en 12, todas materiales.
     ===================================================================== */

  const LUGARES = ['ORURO', 'LA PAZ', 'COCHABAMBA', 'SANTA CRUZ', 'POTOSI', 'CHUQUISACA',
    'TARIJA', 'BENI', 'PANDO', 'SUCRE', 'EL ALTO', 'SABAYA', 'HUACHACALLA', 'CARACOLLO',
    'CHALLAPATA', 'POOPO', 'PARCO', 'OCURI', 'VENTILLA', 'TOLEDO', 'CURAHUARA', 'SORACACHI',
    'PAZNA', 'ANTEQUERA', 'SALINAS', 'PISIGA', 'UYUNI', 'LLALLAGUA', 'MONTERO', 'RIBERALTA'];

  /* Ojo con \b despu\u00e9s de un punto: en \u00abU.E. Gualberto\u00bb el punto y el
     espacio son los dos no-palabra, as\u00ed que no hay borde y `U\.E\.\b`
     nunca matchea. Por eso estos patrones no lo llevan al final. */
  const MARCAS = [
    [/\bPROYECTO\b/, 'nombra el proyecto'],
    [/\bMUNICIPIO\b|\bGOBIERNO AUTONOMO\b|\bG\.?A\.?M\.?[\s-]|\bGAD[OU]R\b/, 'nombra la entidad'],
    [/\bU\.E\.|\bUNIDAD EDUCATIVA\b/, 'nombra el establecimiento'],
    [/\bDISTRITO\b|\bCOMUNIDAD\b|\bLOCALIDAD\b|\bPROVINCIA\b|\bCANTON\b/, 'nombra la ubicaci\u00f3n'],
    [/\bCONTRATO\b|\bLICITACION\b|\bORDEN DE (TRABAJO|COMPRA)\b/, 'nombra el contrato'],
    [/\bITCP\b|\bEDTP\b|\bGESTION 20\d\d\b/, 'nombra el documento o la gesti\u00f3n'],
    [/\b[A-Z]{3,}[-\/]\d{3,}\b|\bN[\u00b0\u00ba]\s*\d{4,}/, 'incluye un c\u00f3digo de expediente']
  ];
  const CON_PREPOSICION = new RegExp(
    '\\b(EN|DEL|DE LA|PARA EL|PARA LA|ZONA|BARRIO|COMUN\\w*)\\s+(' + LUGARES.join('|') + ')\\b');
  const LUGAR_SUELTO = new RegExp('\\b(' + LUGARES.join('|') + ')\\b');

  const LARGO_MAX = 80;   // la m\u00e1s larga del cat\u00e1logo real tiene 70

  /**
   * \u00bfLa descripci\u00f3n sirve como \u00edtem gen\u00e9rico?
   * @param {string} texto
   * @returns {{nivel:'ok'|'aviso'|'bloqueo', motivo:string}}
   */
  function revisarDescripcion(texto) {
    const t = (texto || '').trim();
    if (!t) return { nivel: 'bloqueo', motivo: 'la descripci\u00f3n est\u00e1 vac\u00eda' };
    if (t.length > LARGO_MAX)
      return {
        nivel: 'bloqueo',
        motivo: `son ${t.length} caracteres; un \u00edtem gen\u00e9rico no pasa de ${LARGO_MAX}`
      };
    const n = norm(t);
    for (const [re, motivo] of MARCAS)
      if (re.test(n)) return { nivel: 'bloqueo', motivo };
    if (CON_PREPOSICION.test(n))
      return { nivel: 'bloqueo', motivo: 'nombra la ubicaci\u00f3n de la obra' };
    const m = n.match(LUGAR_SUELTO);
    if (m) return {
      nivel: 'aviso',
      motivo: `dice \u00ab${m[1]}\u00bb: si es el tipo de material (piedra, m\u00e1rmol) est\u00e1 bien; ` +
        'si es d\u00f3nde se hace la obra, conviene sacarlo'
    };
    return { nivel: 'ok', motivo: '' };
  }

  function buscarEnBase(baseId, texto, todas, limite) {
    limite = limite || 400;
    const q = norm(texto).split(/\s+/).filter(Boolean);
    const out = [];
    const lista = todas ? BD.bases : BD.bases.filter(b => b.id === baseId);
    for (const b of lista) {
      for (let k = 0; k < b.apus.length; k++) {
        if (q.length) {
          const t = b.busq[k];
          let ok = true;
          for (const w of q) if (t.indexOf(w) < 0) { ok = false; break; }
          if (!ok) continue;
        }
        out.push({ base: b, apu: b.apus[k] });
        if (out.length >= limite) return out;
      }
    }
    return out;
  }

  /**
   * Busca insumos sueltos en el catálogo, para armar un análisis desde cero.
   * A diferencia de buscarEnBase, que devuelve análisis completos, esto devuelve
   * materiales, mano de obra o equipo uno por uno.
   * @param {string} texto     palabras a buscar; vacío devuelve el principio de la lista
   * @param {string} tipo      'M', 'O', 'E' o vacío para todos
   * @param {number} baseId    base a mirar; vacío o 0 = todas
   * @param {number} limite    tope de resultados (por defecto 300)
   * @returns {Array<{base: Object, ins: Object}>}
   */
  function buscarInsumosEnBase(texto, tipo, baseId, limite) {
    limite = limite || 300;
    const q = norm(texto).split(/\s+/).filter(Boolean);
    const out = [];
    const lista = baseId ? BD.bases.filter(b => b.id === Number(baseId)) : BD.bases;
    for (const b of lista) {
      for (let k = 0; k < b.ins.length; k++) {
        const i = b.ins[k];
        if (tipo && i.t !== tipo) continue;
        if (q.length) {
          const t = b.ibusq[k];
          let ok = true;
          for (const w of q) if (t.indexOf(w) < 0) { ok = false; break; }
          if (!ok) continue;
        }
        out.push({ base: b, ins: i });
        if (out.length >= limite) { out.sort((x, y) => cmpIns(x.ins, y.ins)); return out; }
      }
    }
    return out.sort((x, y) => cmpIns(x.ins, y.ins));
  }

  /** Costo neto (sin recargos) de un APU de la base. */
  function costoBase(base, apu) {
    return r2(apu.tm + apu.to + apu.te);
  }

  /**
   * Trae al presupuesto un análisis ya editado (cantidades y precios que el
   * usuario cambió al traerlo). Solo toca el proyecto: la Base de Datos queda
   * como estaba.
   * @param {{cod, d, u, cant, c:Array<{t,d,u,p,q}>}} datos
   */
  function importarApuEditado(datos) {
    const it = itemNuevo({
      cod: datos.cod || '', desc: datos.d, und: datos.u || 'glb',
      cant: Number(datos.cant) || 1
    });
    (datos.c || []).forEach(c => {
      const ins = agregarInsumo(c.t, c.d, c.u, c.p);
      it.comp.push({ ins: ins.id, rend: Number(c.q) || 0 });
    });
    items().push(it);
    P.itemSel = it.id;
    return it;
  }

  /** Trae un APU de la base al proyecto, reutilizando insumos ya existentes. */
  function importarApu(base, apu, cantidad) {
    const it = itemNuevo({
      cod: apu.cod || '', desc: apu.d, und: apu.u || 'glb',
      cant: Number(cantidad) || 1, origen: base.n
    });
    apu.c.forEach(c => {
      const src = base.imap[c[0]];
      if (!src) return;
      /* el insumo hereda la fecha que tuviera en la base: es la del precio que
         se está trayendo. Si la base no la tiene, queda en blanco — no se
         inventa «hoy» para un precio que viene de un archivo. */
      const ins = agregarInsumo(src.t, src.d, src.u, src.p, true, src.f || '');
      it.comp.push({ ins: ins.id, rend: c[1] });
    });
    items().push(it);
    P.itemSel = it.id;
    return it;
  }

  /* =====================================================================
     PERSISTENCIA
     ===================================================================== */
  const LS = 'openboq_proyecto';
  function guardarLocal() {
    /* la marca de tiempo la escribe el equipo: es «cuándo se guardó acá», que
       es lo único que este lado puede saber. Lo de la nube lo fecha el
       servidor. */
    try { localStorage.setItem(LS, JSON.stringify({ P, _seq, t: Date.now() })); return true; }
    catch (e) { return false; }
  }
  /** Cuándo se guardó por última vez el proyecto en este navegador.
      Devuelve '' si nunca se guardó o si viene de una versión anterior, que
      no escribía la marca. */
  function ultimoLocal() {
    try {
      const s = localStorage.getItem(LS); if (!s) return '';
      const o = JSON.parse(s);
      return o && o.t ? new Date(o.t).toISOString() : '';
    } catch (e) { return ''; }
  }
  function cargarLocal() {
    try {
      const s = localStorage.getItem(LS); if (!s) return false;
      const o = JSON.parse(s);
      if (!o || !o.P || !o.P.modulos) return false;
      P = o.P; _seq = o._seq || 1;
      P.params = Object.assign({}, PARAMS_DEF, P.params || {});
      P.crono = Object.assign({}, CRONO_DEF, P.crono || {});
    trenes();
      return true;
    } catch (e) { return false; }
  }
  function serializar() { return JSON.stringify({ app: 'OpenBOQ', v: 1, _seq, P }, null, 1); }

  /* ---------- leer un proyecto SIN abrirlo ----------
     `deserializar` reemplaza el proyecto abierto; esto no toca nada. Sirve
     para mirar otro archivo al lado del que se está trabajando (comparar).
     No llama a `trenes()` a propósito: eso ordena los trenes de trabajo del
     proyecto abierto y acá no hace falta para sacar los totales. */
  function leerProyecto(txt) {
    const o = JSON.parse(txt);
    const p = o.P || o;
    if (!p || !p.modulos) throw new Error('El archivo no contiene un proyecto válido.');
    p.params = Object.assign({}, PARAMS_DEF, p.params || {});
    p.crono = Object.assign({}, CRONO_DEF, p.crono || {});
    p.insumos = p.insumos || {};
    return p;
  }

  /** Totales de un proyecto cualquiera, con SUS insumos y SUS incidencias.
      El cálculo entero cuelga de `P`, así que el proyecto se pone un momento
      en su lugar y se devuelve el abierto pase lo que pase. Los montos salen
      en Bs, la moneda base: convertir con el tipo de cambio de cada archivo
      daría dos escalas distintas en la misma tabla. */
  /**
   * Corre `fn` como si `p` fuera el proyecto abierto y devuelve lo que `fn`
   * devuelva. Es lo que hace falta para calcular sobre un archivo que solo se
   * está MIRANDO —comparar con otro .boq—: el análisis, el requerimiento y los
   * totales trabajan sobre el proyecto activo, y acá se les presta el otro por
   * un rato. El proyecto del usuario se restituye pase lo que pase, también si
   * `fn` revienta.
   * @param {Object} p proyecto prestado
   * @param {Function} fn
   */
  function conProyecto(p, fn) {
    const previo = P;
    try { P = p; return fn(); } finally { P = previo; }
  }

  /* =====================================================================
     COMPARAR DOS PROYECTOS RENGLÓN POR RENGLÓN

     El resumen por módulos dice CUÁNTO cambió; esto dice DÓNDE. Cada ítem del
     presupuesto y cada insumo del análisis se pone al lado de su par del otro
     archivo, con la diferencia en Bs y en %.

     Se empareja por NOMBRE, no por id: los dos archivos casi nunca comparten
     los ids —uno salió de un PRESCOM y el otro de una copia editada— y lo que
     el usuario reconoce es la descripción. Los nombres repetidos se emparejan
     en el orden en que aparecen, así dos renglones que se llaman igual no caen
     los dos en la misma fila. Lo que queda sin par se marca y va al final.
     ===================================================================== */

  /** Empareja dos listas por una clave, respetando el orden de los repetidos. */
  function emparejar(la, lb, clave) {
    const cola = new Map();
    lb.forEach((x, i) => {
      const k = clave(x);
      if (!cola.has(k)) cola.set(k, []);
      cola.get(k).push(i);
    });
    const usados = new Set();
    const filas = la.map(a => {
      const q = cola.get(clave(a));
      let b = null;
      if (q && q.length) { const i = q.shift(); usados.add(i); b = lb[i]; }
      return { a, b };
    });
    lb.forEach((b, i) => { if (!usados.has(i)) filas.push({ a: null, b }); });
    return filas;
  }

  /** Diferencia con signo entre dos valores. Sin base no hay porcentaje. */
  function delta(va, vb) {
    const a = Number(va) || 0, b = Number(vb) || 0;
    const d = r2(b - a);
    return { d, pct: a ? r2(d / a * 100) : null,
             /* «igual» solo si no se mueve ni un centavo */
             signo: d > 0 ? 1 : (d < 0 ? -1 : 0) };
  }

  /** Los ítems de un proyecto con su precio unitario y su total ya calculados. */
  function filasItems(p) {
    return conProyecto(p, () => {
      const out = [];
      (p.modulos || []).forEach(m => (m.items || []).forEach(it => {
        const a = analisis(it);
        out.push({ modulo: m.n || '', desc: it.desc || '', und: it.und || '',
                   cant: Number(it.cant) || 0, pu: a.pu, total: a.total });
      }));
      return out;
    });
  }

  /** Los insumos que entran en algún análisis, con su precio, cantidad y monto. */
  function filasInsumos(p) {
    return conProyecto(p, () => {
      const req = {};
      requerimiento().forEach(x => req[x.ins.id] = x);
      return insumosEnUso().map(x => ({
        t: x.t, d: x.d || '', u: x.u || '', p: Number(x.p) || 0, f: x.f || '',
        cant: req[x.id] ? req[x.id].cant : 0,
        monto: req[x.id] ? req[x.id].monto : 0
      }));
    });
  }

  /**
   * Compara el proyecto `A` contra el `B`, ítem por ítem e insumo por insumo.
   * @param {Object} A el proyecto abierto
   * @param {Object} B el del archivo con el que se compara
   * @returns {{items:Array, insumos:Array, totales:Object}}
   *   Cada fila trae `a`, `b` (uno puede ser null), las diferencias y
   *   `estado`: 'igual' · 'subio' · 'bajo' · 'soloA' · 'soloB'.
   */
  function compararProyectos(A, B) {
    const estado = (a, b, d) => !a ? 'soloB' : (!b ? 'soloA'
      : (d.signo > 0 ? 'subio' : (d.signo < 0 ? 'bajo' : 'igual')));

    const items = emparejar(filasItems(A), filasItems(B), x => norm(x.desc))
      .map(({ a, b }) => {
        const dPU = delta(a && a.pu, b && b.pu);
        const dTot = delta(a && a.total, b && b.total);
        const dCant = delta(a && a.cant, b && b.cant);
        return { a, b, dPU, dTot, dCant, estado: estado(a, b, dTot),
                 /* la unidad cambiada descoloca la cantidad: se avisa aparte */
                 undCambia: !!(a && b && norm(a.und) !== norm(b.und)) };
      });

    const insumos = emparejar(filasInsumos(A), filasInsumos(B), x => x.t + '|' + norm(x.d))
      .map(({ a, b }) => {
        const dP = delta(a && a.p, b && b.p);
        const dCant = delta(a && a.cant, b && b.cant);
        const dMonto = delta(a && a.monto, b && b.monto);
        return { a, b, dP, dCant, dMonto,
                 /* para un insumo, lo que se mira es si el PRECIO subió o bajó */
                 estado: estado(a, b, dP),
                 undCambia: !!(a && b && norm(a.u) !== norm(b.u)) };
      });

    const sum = (L, lado, campo) => r2(L.reduce((s, x) => s + (x[lado] ? x[lado][campo] : 0), 0));
    return {
      items, insumos,
      totales: {
        itemsA: items.filter(x => x.a).length, itemsB: items.filter(x => x.b).length,
        totalA: sum(items, 'a', 'total'), totalB: sum(items, 'b', 'total'),
        insumosA: insumos.filter(x => x.a).length, insumosB: insumos.filter(x => x.b).length,
        montoA: sum(insumos, 'a', 'monto'), montoB: sum(insumos, 'b', 'monto')
      }
    };
  }

  function resumenProyecto(p) {
    const previo = P;
    try {
      P = p;
      const mods = (p.modulos || []).map(m => ({
        n: m.n, items: (m.items || []).length, total: totalModulo(m)
      }));
      return {
        nombre: p.nombre || '', entidad: p.entidad || '', ubicacion: p.ubicacion || '',
        fecha: p.fecha || '', moneda: p.moneda || 'Bs', tc: Number(p.tc) || 0,
        plazo: Number(p.plazo) || 0,
        modulos: mods,
        items: mods.reduce((s, m) => s + m.items, 0),
        insumos: Object.keys(p.insumos || {}).length,
        total: r2(mods.reduce((s, m) => s + m.total, 0))
      };
    } finally { P = previo; }
  }
  function deserializar(txt) {
    const o = JSON.parse(txt);
    const p = o.P || o;
    if (!p.modulos) throw new Error('El archivo no contiene un proyecto válido.');
    P = p; _seq = o._seq || 1;
    P.params = Object.assign({}, PARAMS_DEF, P.params || {});
    P.crono = Object.assign({}, CRONO_DEF, P.crono || {});
    /* Los .boq anteriores a la v2.6 no traen formatos: quedan con el oficial,
       que es la cadena con la que se guardaron. Nada cambia de precio al abrir.

       Los de la primera v2.6 traen un único `P.formato`; se pasa al listado y
       se deja activo, así el proyecto sigue calculando igual que antes. */
    if (P.formato && Array.isArray(P.formato.filas) && P.formato.filas.length) {
      P.formatos = (P.formatos || []).concat([P.formato]);
      P.formatoId = P.formato.id;
    }
    delete P.formato;
    P.formatos = (P.formatos || []).filter(f =>
      f && f.id && f.id !== ID_SABS && Array.isArray(f.filas) && f.filas.length);
    if (P.formatoId && !P.formatos.some(f => f.id === P.formatoId)) P.formatoId = null;
    trenes();
    P.moduloActivo = 0;
    return P;
  }

  /* =====================================================================
     PROGRAMACIÓN DE OBRA — cronograma general con precedencias

     Un solo cronograma para todos los módulos, con dos niveles: el módulo es
     la tarea resumen y cada ítem una actividad. La duración sale de las horas
     de mano de obra del análisis y las actividades se encadenan en el orden
     del presupuesto, como en MS Project. Todo es editable después.
     ===================================================================== */

  /** Horas de mano de obra del ítem, por especialidad y en total.
      Los rendimientos de mano de obra están en horas por unidad de obra. */
  function horasManoObra(it) {
    const cant = Number(it.cant) || 0;
    let mayor = 0, total = 0;
    (it.comp || []).forEach(c => {
      const ins = P.insumos[c.ins];
      if (!ins || ins.t !== 'O') return;
      const h = (Number(c.rend) || 0) * cant;
      total += h;
      if (h > mayor) mayor = h;
    });
    return { mayor, total };
  }

  /* ---------------- trenes de trabajo y recursos ---------------- */

  /** Trenes del proyecto; siempre existe el TREN 0, donde el porcentaje se
      carga actividad por actividad. Los trenes que se creen después llevan un
      porcentaje propio que vale para todas sus actividades. */
  function trenes() {
    if (!Array.isArray(P.trenes) || !P.trenes.length)
      P.trenes = [{ id: nid(), n: 'TREN 0', rec: REC_DEF }];
    /* proyectos de versiones anteriores: el primer tren pasa a llamarse TREN 0 */
    if (P.trenes[0].n === 'TREN 1' && !P.trenes.some(t => t.n === 'TREN 0')) P.trenes[0].n = 'TREN 0';
    return P.trenes;
  }
  /** ¿Es el tren base (TREN 0), el de porcentaje por actividad? */
  const esTrenBase = t => !!t && trenes()[0].id === t.id;
  /** Tren al que pertenece una actividad (el TREN 0 si no tiene asignado). */
  function trenDe(it) {
    const L = trenes();
    return L.find(t => t.id === it.tren) || L[0];
  }
  /** % de recursos con el que se ejecuta la actividad.
      En el TREN 0 manda el de la actividad; en los demás, el del tren. */
  function recursoDe(it) {
    const t = trenDe(it);
    const delTren = Number(t && t.rec) > 0 ? Number(t.rec) : REC_DEF;
    if (!esTrenBase(t)) return delTren;
    const propio = Number(it.rec);
    return propio > 0 ? propio : delTren;
  }
  function nuevoTren(nombre, rec) {
    const L = trenes();
    const t = { id: nid(), n: nombre || ('TREN ' + L.length), rec: Number(rec) > 0 ? Number(rec) : REC_DEF };
    L.push(t);
    return t;
  }
  /** Quita un tren y devuelve sus actividades al primero. */
  function eliminarTren(id) {
    const L = trenes();
    if (L.length < 2) return false;
    const k = L.findIndex(t => t.id === id);
    if (k < 0) return false;
    L.splice(k, 1);
    const destino = L[0].id;
    actividades().forEach(a => { if (a.it.tren === id) a.it.tren = destino; });
    return true;
  }

  /**
   * Duración en días calendario de una actividad.
   * Las especialidades trabajan en paralelo: manda la que más horas necesita.
   * El % de recursos del tren (o el propio de la actividad) divide ese tiempo,
   * y los días no trabajados de la semana lo estiran.
   */
  function duracionItem(it, cr) {
    cr = Object.assign({}, CRONO_DEF, P.crono || {}, cr || {});
    const { mayor } = horasManoObra(it);
    if (!mayor) return 1;                       // sin mano de obra: 1 día
    const jornada = Number(cr.jornada) > 0 ? Number(cr.jornada) : 8;
    const cuad = Number(cr.cuadrillas) > 0 ? Number(cr.cuadrillas) : 1;
    const sem = Math.min(7, Math.max(1, Number(cr.diasSemana) || 6));
    const rec = (cr.rec !== undefined ? Number(cr.rec) : recursoDe(it)) || REC_DEF;
    return Math.max(1, Math.ceil(mayor / jornada / cuad / (rec / 100) * (7 / sem)));
  }

  /**
   * Análisis inicial de recursos: a las actividades que pasan del tope les sube
   * el porcentaje —en pasos de 25 %, un cuarto de cuadrilla— hasta que entren.
   * @param {number} tope días máximos por actividad
   * @returns {Array<{it, antes:number, rec:number, dias:number}>} lo que cambió
   */
  function ajustarRecursos(tope) {
    tope = Number(tope) > 0 ? Number(tope) : (P.crono.topeDias || 180);
    const cambios = [];
    actividades().forEach(a => {
      const it = a.it;
      /* solo las del TREN 0: en los demás el porcentaje lo fija el tren */
      if (!esTrenBase(trenDe(it))) return;
      const base = recursoDe(it);
      const dias = duracionItem(it, { rec: base });
      if (dias <= tope) return;
      let nec = Math.ceil(base * dias / tope / 25) * 25;
      /* el redondeo de días puede dejarlo justo por encima: se sube de a 25 % */
      while (nec < 5000 && duracionItem(it, { rec: nec }) > tope) nec += 25;
      it.rec = nec;
      cambios.push({ it, antes: base, rec: nec, dias: duracionItem(it) });
    });
    return cambios;
  }

  /**
   * Lee la columna de predecesoras al estilo MS Project.
   * Ejemplos: "3", "3+2", "5CC", "7FC-1", "2;4CC+3".
   * @returns {Array<{n:number, tipo:string, desf:number}>}
   */
  function leerPredecesoras(txt) {
    return String(txt || '').split(/[;,]/).map(s => s.replace(/\s+/g, '')).filter(Boolean)
      .map(s => {
        const m = /^(\d+)(FC|CC|FF|CF)?([+-]\d+)?d?$/i.exec(s);
        return m ? { n: Number(m[1]), tipo: (m[2] || 'FC').toUpperCase(), desf: Number(m[3] || 0) } : null;
      }).filter(Boolean);
  }

  /** Actividades del proyecto en orden, numeradas 1..N (el número que se usa
      como predecesora) y con su código EDT «módulo.actividad». */
  function actividades() {
    const out = [];
    P.modulos.forEach((m, mk) => m.items.forEach((it, k) => {
      out.push({ it, m, mk, k, n: out.length + 1, edt: (mk + 1) + '.' + (k + 1) });
    }));
    return out;
  }

  /** Módulos con sus actividades, para dibujar el cronograma por niveles. */
  function estructuraCrono() {
    const acts = actividades();
    return P.modulos.map((m, mk) => {
      const hijas = acts.filter(a => a.mk === mk);
      const ini = hijas.length ? Math.min(...hijas.map(a => Number(a.it.inicio) || 0)) : 0;
      const fin = hijas.length ? Math.max(...hijas.map(a =>
        (Number(a.it.inicio) || 0) + Math.max(1, Number(a.it.dias) || 1))) : 0;
      return { m, mk, edt: String(mk + 1), hijas, inicio: ini, dias: Math.max(0, fin - ini) };
    });
  }

  /**
   * Recalcula el cronograma completo.
   * @param {{duracion:boolean, encadenar:boolean}} o
   *        duracion   → vuelve a calcular los días desde la mano de obra
   *        encadenar  → cada actividad queda como sucesora de la anterior
   * @returns {{tareas:number, plazo:number, ciclo:boolean}}
   */
  function programar(o) {
    o = o || {};
    const acts = actividades();
    if (o.duracion) acts.forEach(a => { a.it.dias = duracionItem(a.it); });
    /* Encadenado por defecto: cada actividad sigue a la anterior DE SU TREN, de
       modo que trenes distintos avanzan en paralelo. Las de un solo día se
       programan con «FC-1», o sea el mismo día en que termina la anterior:
       son trabajos que entran dentro de esa jornada. */
    if (o.encadenar) {
      const ultima = {};
      acts.forEach(a => {
        const t = trenDe(a.it).id;
        const prev = ultima[t];
        a.it.pred = prev === undefined ? ''
          : (Math.max(1, Number(a.it.dias) || 1) === 1 ? prev + 'FC-1' : String(prev));
        ultima[t] = a.n;
      });
    }

    const porN = {}; acts.forEach(a => porN[a.n] = a.it);
    let cambio = true, vueltas = 0;
    while (cambio && vueltas++ <= acts.length + 2) {
      cambio = false;
      acts.forEach(a => {
        const it = a.it;
        const dur = Math.max(1, Number(it.dias) || 1);
        let ini = 0;
        leerPredecesoras(it.pred).forEach(p => {
          const q = porN[p.n];
          if (!q || q === it) return;
          const iq = Number(q.inicio) || 0, dq = Math.max(1, Number(q.dias) || 1);
          const base = p.tipo === 'CC' ? iq
            : p.tipo === 'FF' ? iq + dq - dur
              : p.tipo === 'CF' ? iq - dur
                : iq + dq;                       // FC, el caso normal
          ini = Math.max(ini, base + p.desf);
        });
        ini = Math.max(0, ini);
        if ((Number(it.inicio) || 0) !== ini) { it.inicio = ini; cambio = true; }
      });
    }
    P.plazo = Math.max(1, acts.reduce((s, a) =>
      Math.max(s, (Number(a.it.inicio) || 0) + Math.max(1, Number(a.it.dias) || 1)), 0));
    if (!P.inicioObra) P.inicioObra = new Date().toISOString().slice(0, 10);
    return { tareas: acts.length, plazo: P.plazo, ciclo: cambio };
  }

  const hoyISO = () => new Date().toISOString().slice(0, 10);

  /** Fecha calendario de un día relativo al inicio de obra. */
  function fechaDia(dia) {
    const d = new Date((P.inicioObra || hoyISO()) + 'T00:00:00');
    d.setDate(d.getDate() + (Number(dia) || 0));
    return d;
  }
  const fmtFecha = d => d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  /** Comienzo y fin de una actividad (o de un módulo), ya en fechas. */
  const fechasDe = (inicio, dias) => ({
    ini: fechaDia(inicio), fin: fechaDia((Number(inicio) || 0) + Math.max(1, Number(dias) || 1) - 1)
  });

  /* ---------------- distribución automática por incidencia (histórica) ---- */
  function distribuirCronograma() {
    const tot = totalProyecto() || 1;
    let dia = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      const inc = analisis(it).total / tot;
      const d = Math.max(1, Math.round(inc * (P.plazo || 180)));
      it.inicio = dia; it.dias = d;
      dia = Math.min(dia + Math.max(1, Math.round(d * 0.6)), Math.max(0, (P.plazo || 180) - d));
    }));
  }

  /** Avance mensual acumulado (curva S) sobre el plazo del proyecto. */
  function curvaS(nPeriodos) {
    const plazo = P.plazo || 180;
    const n = nPeriodos || Math.max(1, Math.ceil(plazo / 30));
    const per = new Array(n).fill(0);
    P.modulos.forEach(m => m.items.forEach(it => {
      const monto = analisis(it).total;
      const ini = Number(it.inicio) || 0, dur = Math.max(1, Number(it.dias) || 1);
      for (let d = 0; d < dur; d++) {
        const k = Math.min(n - 1, Math.floor((ini + d) / (plazo / n)));
        per[k] += monto / dur;
      }
    }));
    const tot = per.reduce((a, b) => a + b, 0) || 1;
    let ac = 0;
    return per.map((v, i) => {
      ac += v;
      return { i: i + 1, monto: r2(v), acum: r2(ac), pct: r2(ac / tot * 100) };
    });
  }

  /* ---------------- API ---------------- */
  return {
    PARAMS_DEF, CRONO_DEF, UNIDADES, BD,
    proyectoNuevo, proyecto, modulo, items, todosItems, nid,
    r, r2, fmt, conv,
    agregarInsumo, eliminarInsumo, buscarInsumo, usoInsumo, detalleInsumo, insumosOrdenados,
    fijarPrecio, fechaHoy,
    usosPorInsumo, insumosEnUso,
    cmpIns, cmpTexto, duplicadosInsumo, fusionarInsumos, conflictosInsumos,
    itemNuevo, addItem, getItem, delItem, moverItem, duplicarItem,
    itemsAntesDelModulo, numeroItem,
    matrizApuInsumo, fijarRendimiento, factorRendimiento, fusionarApus,
    crearItemsEnLote, itemsDelAlcance,
    analisis, cadenaRecargos, correrCadena, totalModulo, totalProyecto,
    formato, formatos, formatoPorId, formatoSABS, formatoEsOficial, ID_SABS, FILAS_ENTRADA,
    usarFormato, duplicarFormato, guardarFormato, renombrarFormato, eliminarFormato,
    validarFormato,
    fijarPuDeArchivo, soltarPuDeArchivo, conPuDeArchivo,
    totalComputos, parcialComputo, MEDIDAS_COMPUTO, requerimiento,
    buscarEnBase, buscarInsumosEnBase, costoBase, importarApu, importarApuEditado,
    norm, cargarCatalogo, revisarDescripcion, aplicarDelta,
    ID_PROPIA, payloadApu, payloadItem, guardarEnBD, resumenBDU, limpiarBDU,
    basesPropias, esBasePropia, crearBasePropia, renombrarBasePropia,
    exportarBDU, importarBDU, itemsConAnalisis, conflictosVolcado,
    eliminarBasePropia, volcarProyectoABase,
    guardarLocal, cargarLocal, ultimoLocal, serializar, deserializar, leerProyecto, resumenProyecto,
    conProyecto, compararProyectos,
    distribuirCronograma, curvaS,
    horasManoObra, duracionItem, leerPredecesoras, actividades, estructuraCrono,
    programar, fechaDia, fechasDe, fmtFecha, hoyISO,
    REC_DEF, trenes, esTrenBase, trenDe, recursoDe, nuevoTren, eliminarTren, ajustarRecursos
  };
})();
