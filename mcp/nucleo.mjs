/* =========================================================================
   OpenBOQ MCP — el núcleo: lo que una IA puede hacer con un presupuesto
   -------------------------------------------------------------------------
   LA REGLA DE ORO: la IA elige, el motor calcula. La IA decide qué ítems,
   de qué base y en qué cantidad; los precios unitarios, parciales y totales
   los saca SIEMPRE js/motor.js, el mismo de la aplicación. Nada de lo que
   devuelve este archivo es una cuenta hecha acá.

   El motor es un singleton con un proyecto activo (`P`). Para poder tener
   varios proyectos abiertos —y para que el remoto pueda guardarlos en
   cualquier lado— cada operación carga el proyecto desde su texto .boq,
   lo modifica y lo vuelve a serializar. El `almacen` decide dónde vive ese
   texto: una carpeta en el MCP local, el almacenamiento del usuario en el
   remoto. Interfaz: leer(id) → texto|null, escribir(id, texto), listar().

   No depende de Node ni del navegador: lo usan local.mjs y el Worker.
   ========================================================================= */

const r2 = v => Math.round((Number(v) || 0) * 100 + Number.EPSILON * 1e6) / 100;
const TIPO = { M: 'material', O: 'mano de obra', E: 'equipo' };

/** Umbral para avisar que un solo insumo se come el análisis. Es la señal
    de los precios imposibles del 10/09 (bloque suelo-cemento a 330 Bs/pza:
    20.460 de 20.554 Bs de costo directo). No es un error: es «revisar». */
const DOMINA = 0.9;

/* `cargar: false` cuando el catálogo ya está en el motor: en el Worker lo
   carga una sola vez el isolate y lo comparten las sesiones. */
export function crearNucleo({ MOTOR, catalogo, almacen, cargar, IMPORTAR_EXCEL }) {
  if (catalogo && cargar !== false) MOTOR.cargarCatalogo(catalogo);
  const BD = MOTOR.BD;

  /* ------------------------------------------------------------ catálogo */
  const base = id => {
    const b = BD.bases.find(x => x.id === Number(id));
    if (!b) throw new Error(`No existe la base ${id}. Use catalogo_info para ver las bases.`);
    return b;
  };
  /** «3:125» → base 3, análisis con seq 125. Es la referencia única de un APU. */
  function apuPorRef(ref) {
    const [bid, seq] = String(ref || '').split(':');
    const b = base(bid);
    const a = b.apus.find(x => String(x.seq) === String(seq));
    if (!a) throw new Error(`No existe el análisis ${ref}. Búsquelo con buscar_apu.`);
    return { b, a };
  }
  const refApu = (b, a) => `${b.id}:${a.seq}`;

  function catalogoInfo() {
    return {
      generado_en: (catalogo && catalogo.generado_en) || null,
      bases: BD.bases.map(b => ({ base_id: b.id, nombre: b.n, analisis: b.apus.length, insumos: b.ins.length })),
      incidencias_por_omision: Object.assign({}, MOTOR.PARAMS_DEF),
      unidades: MOTOR.UNIDADES
    };
  }

  function buscarApu({ texto, base_id, limite }) {
    const lim = Math.min(Number(limite) || 20, 100);
    const res = MOTOR.buscarEnBase(base_id ? Number(base_id) : null, texto || '', !base_id, lim);
    return res.map(({ base: b, apu: a }) => ({
      ref: refApu(b, a), base: b.n, codigo: a.cod, descripcion: a.d, unidad: a.u,
      costo_directo: MOTOR.costoBase(b, a), insumos: a.c.length
    }));
  }

  function verApu({ ref }) {
    const { b, a } = apuPorRef(ref);
    const cd = MOTOR.costoBase(b, a);
    const comp = a.c.map(([seq, rend]) => {
      const i = b.imap[seq];
      if (!i) return null;
      const parcial = r2(Number(rend) * Number(i.p));
      return { tipo: TIPO[i.t] || i.t, descripcion: i.d, unidad: i.u, rendimiento: Number(rend), precio: i.p, parcial };
    }).filter(Boolean);
    return {
      ref, base: b.n, codigo: a.cod, descripcion: a.d, unidad: a.u,
      costo_directo: cd, materiales: r2(a.tm), mano_de_obra: r2(a.to), equipo: r2(a.te),
      componentes: comp, avisos: avisosComp(comp.map(c => ({ d: c.descripcion, p: c.precio, parcial: c.parcial })), cd)
    };
  }

  function buscarInsumo({ texto, tipo, base_id, limite }) {
    const t = tipo ? ({ material: 'M', 'mano de obra': 'O', equipo: 'E' }[tipo] || tipo) : null;
    const res = MOTOR.buscarInsumosEnBase(texto || '', t, base_id || null, Math.min(Number(limite) || 30, 200));
    return res.map(({ base: b, ins: i }) => ({ base: b.n, base_id: b.id, tipo: TIPO[i.t] || i.t, descripcion: i.d, unidad: i.u, precio: i.p }));
  }

  /* ------------------------------------------------------------ avisos */
  function avisosComp(filas, costoDirecto) {
    const av = [];
    filas.forEach(f => { if (!(Number(f.p) > 0)) av.push(`«${f.d}» tiene precio cero`); });
    if (costoDirecto > 0) {
      const mayor = filas.reduce((m, f) => (f.parcial > (m ? m.parcial : -1) ? f : m), null);
      if (mayor && filas.length > 1 && mayor.parcial / costoDirecto > DOMINA)
        av.push(`«${mayor.d}» es el ${Math.round(mayor.parcial / costoDirecto * 100)} % del costo directo: revisar su precio y rendimiento`);
    }
    return av;
  }

  /* ------------------------------------------------------------ proyectos */
  function nuevoId(nombre) {
    const s = String(nombre || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'proyecto';
    return s + '-' + Date.now().toString(36).slice(-5);
  }

  /* Carga, opera y serializa SIN await en el medio: el motor es uno solo y
     en el Worker lo comparten las sesiones del mismo isolate. */
  async function conProyecto(id, fn, guardar) {
    const txt = await almacen.leer(id);
    if (!txt) throw new Error(`No existe el proyecto «${id}». Use listar_proyectos o crear_proyecto.`);
    MOTOR.deserializar(txt);
    const P = MOTOR.proyecto();
    const out = fn(P);
    if (guardar) await almacen.escribir(id, MOTOR.serializar());
    return out;
  }

  function moduloIdx(P, modulo) {
    if (modulo === undefined || modulo === null || modulo === '') return P.modulos.length - 1;
    const n = Number(modulo);
    if (Number.isInteger(n) && n >= 1 && n <= P.modulos.length) return n - 1;
    const k = P.modulos.findIndex(m => m.n.trim().toUpperCase() === String(modulo).trim().toUpperCase());
    if (k < 0) throw new Error(`No existe el módulo «${modulo}». Módulos: ${P.modulos.map((m, i) => (i + 1) + '. ' + m.n).join(' · ')}`);
    return k;
  }

  function fichaItem(it) {
    const a = MOTOR.analisis(it);
    const filas = [].concat(a.grupos.M, a.grupos.O, a.grupos.E).map(f => ({ d: f.ins.d, p: f.pu, parcial: f.parcial }));
    return {
      item_id: it.id, numero: MOTOR.numeroItem(it.id), codigo: it.cod, descripcion: it.desc, unidad: it.und,
      cantidad: Number(it.cant) || 0, precio_unitario: a.pu, parcial: MOTOR.parcialGeneral(it),
      origen: it.origen || '', avisos: avisosComp(filas, a.mat + a.mo + a.eq)
    };
  }

  async function crearProyecto({ nombre, entidad, ubicacion, moneda, tipo_cambio, incidencias, modulos }) {
    MOTOR.proyectoNuevo(nombre);
    const P = MOTOR.proyecto();
    if (entidad) P.entidad = String(entidad);
    if (ubicacion) P.ubicacion = String(ubicacion);
    if (moneda === '$US' || moneda === 'Bs') P.moneda = moneda;
    if (Number(tipo_cambio) > 0) P.tc = Number(tipo_cambio);
    if (incidencias) fijarParams(P, incidencias);
    if (Array.isArray(modulos) && modulos.length) {
      P.modulos[0].n = String(modulos[0]);
      modulos.slice(1).forEach(n => P.modulos.push({ id: MOTOR.nid(), n: String(n), items: [] }));
    }
    const id = nuevoId(nombre);
    await almacen.escribir(id, MOTOR.serializar());
    return { proyecto_id: id, nombre: P.nombre, modulos: P.modulos.map((m, i) => (i + 1) + '. ' + m.n), incidencias: P.params };
  }

  function fijarParams(P, inc) {
    const cambios = {};
    Object.keys(MOTOR.PARAMS_DEF).forEach(k => {
      if (inc[k] !== undefined && inc[k] !== null && !isNaN(Number(inc[k]))) { P.params[k] = Number(inc[k]); cambios[k] = P.params[k]; }
    });
    return cambios;
  }

  const configurarIncidencias = ({ proyecto_id, incidencias }) =>
    conProyecto(proyecto_id, P => ({ cambiadas: fijarParams(P, incidencias || {}), incidencias: P.params }), true);

  const agregarModulo = ({ proyecto_id, nombre }) => conProyecto(proyecto_id, P => {
    P.modulos.push({ id: MOTOR.nid(), n: String(nombre || 'MÓDULO # ' + (P.modulos.length + 1)), items: [] });
    return { modulos: P.modulos.map((m, i) => (i + 1) + '. ' + m.n) };
  }, true);

  const agregarItems = ({ proyecto_id, items }) => conProyecto(proyecto_id, P => {
    const hechos = [], errores = [];
    (items || []).forEach((x, k) => {
      try {
        const { b, a } = apuPorRef(x.ref);
        P.moduloActivo = moduloIdx(P, x.modulo);
        const it = MOTOR.importarApu(b, a, Number(x.cantidad) || 1);
        if (x.descripcion) it.desc = String(x.descripcion);
        hechos.push(fichaItem(it));
      } catch (e) { errores.push(`fila ${k + 1} (${x.ref}): ${e.message}`); }
    });
    return { agregados: hechos, errores, total: MOTOR.totalGeneral() };
  }, true);

  const modificarItem = ({ proyecto_id, item_id, cantidad, descripcion, quitar }) => conProyecto(proyecto_id, P => {
    const it = MOTOR.getItem(item_id);
    if (!it) throw new Error(`No existe el ítem ${item_id}. Use ver_presupuesto para ver los ítems.`);
    if (quitar) { MOTOR.delItem(item_id); return { quitado: item_id, total: MOTOR.totalGeneral() }; }
    if (cantidad !== undefined) it.cant = Number(cantidad) || 0;
    if (descripcion) it.desc = String(descripcion);
    return { item: fichaItem(it), total: MOTOR.totalGeneral() };
  }, true);

  const cambiarPrecioInsumo = ({ proyecto_id, descripcion, unidad, precio }) => conProyecto(proyecto_id, P => {
    const q = String(descripcion || '').trim().toUpperCase();
    const u = unidad ? String(unidad).trim().toUpperCase() : null;
    const cand = Object.values(P.insumos).filter(i => i.d.trim().toUpperCase() === q && (!u || i.u.trim().toUpperCase() === u));
    if (!cand.length) throw new Error(`El proyecto no tiene el insumo «${descripcion}»${unidad ? ' / ' + unidad : ''}.`);
    if (cand.length > 1) throw new Error(`Hay ${cand.length} insumos «${descripcion}» con distinta unidad: indique la unidad (${cand.map(i => i.u).join(', ')}).`);
    MOTOR.fijarPrecio(cand[0], Number(precio));
    return { insumo: cand[0].d, unidad: cand[0].u, precio: cand[0].p, usado_en: MOTOR.usoInsumo(cand[0].id).length, total: MOTOR.totalGeneral() };
  }, true);

  const verPresupuesto = ({ proyecto_id }) => conProyecto(proyecto_id, P => {
    const modulos = P.modulos.map((m, i) => ({
      modulo: (i + 1) + '. ' + m.n, subtotal: MOTOR.subtotalGeneral(m), items: m.items.map(fichaItem)
    }));
    const avisos = [];
    modulos.forEach(m => m.items.forEach(it => it.avisos.forEach(a => avisos.push(`Ítem ${it.numero} (${it.descripcion}): ${a}`))));
    return {
      proyecto: P.nombre, entidad: P.entidad, ubicacion: P.ubicacion, moneda: P.moneda,
      incidencias: P.params, modulos, total: MOTOR.totalGeneral(),
      items: modulos.reduce((s, m) => s + m.items.length, 0), insumos: Object.keys(P.insumos).length, avisos
    };
  });

  const verAnalisis = ({ proyecto_id, item_id }) => conProyecto(proyecto_id, () => {
    const it = MOTOR.getItem(item_id);
    if (!it) throw new Error(`No existe el ítem ${item_id}.`);
    const a = MOTOR.analisis(it);
    const g = k => a.grupos[k].map(f => ({ descripcion: f.ins.d, unidad: f.ins.u, rendimiento: f.rend, precio: f.pu, parcial: f.parcial }));
    return {
      item: fichaItem(it), materiales: g('M'), mano_de_obra: g('O'), equipo: g('E'),
      cadena: (a.cadena || []).map(f => ({ concepto: f.n, porcentaje: f.pct, monto: r2(f.valor) })),
      precio_unitario: a.pu
    };
  });

  async function listarProyectos() {
    const ids = await almacen.listar();
    const out = [];
    for (const id of ids) {
      try {
        const r = MOTOR.resumenProyecto(JSON.parse(await almacen.leer(id)).P);
        out.push({ proyecto_id: id, nombre: r.nombre, items: r.items, total: r.total });
      } catch (e) { out.push({ proyecto_id: id, error: e.message }); }
    }
    return out;
  }

  const textoBoq = id => conProyecto(id, () => MOTOR.serializar());

  async function importarBoq(texto, nombre) {
    MOTOR.deserializar(texto);                 // sanea en la puerta, igual que la aplicación
    const P = MOTOR.proyecto();
    const id = nuevoId(nombre || P.nombre);
    /* todo lo que sale del motor se lee ANTES del await: en el Worker el
       motor lo comparten varias sesiones y otra puede cargar su proyecto
       mientras esta espera al almacén */
    const res = { proyecto_id: id, nombre: P.nombre, items: MOTOR.todosItems().length, total: MOTOR.totalGeneral() };
    await almacen.escribir(id, MOTOR.serializar());
    return res;
  }

  /* Presupuesto desde Excel (B-1 + B-2, y el B-3 si viene). Leer los libros
     es asincrónico; armar el proyecto no: se lee todo primero y después se
     arma y serializa de un tirón, por el mismo motivo que conProyecto. */
  async function importarExcel(archivos) {
    if (!IMPORTAR_EXCEL) throw new Error('Este servidor no trae el importador de Excel.');
    const libros = await IMPORTAR_EXCEL.leerLibros(archivos);
    const mod = IMPORTAR_EXCEL.interpretar(libros);
    const { resumen: s } = IMPORTAR_EXCEL.construir(MOTOR, mod, archivos.map(a => a.nombre).join(' + '));
    const P = MOTOR.proyecto();
    const id = nuevoId(P.nombre);
    const txt = MOTOR.serializar();
    const res = {
      proyecto_id: id, nombre: s.nombre, formato: s.formato, en_dolares_pasado_a_bs: s.enDolares,
      modulos: s.modulos, items: s.items, insumos: s.insumos, incidencias: s.params,
      total_excel: isFinite(s.totalOrigen) ? r2(s.totalOrigen) : null, total_openboq: s.totalRecalculado,
      /* lo que el evaluador tiene que mirar, primero */
      precio_bs_copiado_como_dolares: s.monedaCruzada,
      analisis_que_no_suman_su_total: s.incoherentes.map(x => ({ codigo: x.cod, descripcion: x.desc,
        diferencia: { materiales: r2(x.falta.m), mano_de_obra: r2(x.falta.o), equipo: r2(x.falta.e) },
        renglones_sin_costo: x.sinCosto || [] })),
      items_con_pu_del_archivo: s.deArchivo.map(x => ({ codigo: x.cod, descripcion: x.desc, pu_archivo: x.archivo, pu_analisis: x.calculado })),
      precios_distintos_en_b3: s.b3dif,
      avisos: s.avisos
    };
    await almacen.escribir(id, txt);
    return res;
  }

  return {
    catalogoInfo, buscarApu, verApu, buscarInsumo,
    crearProyecto, configurarIncidencias, agregarModulo, agregarItems, modificarItem,
    cambiarPrecioInsumo, verPresupuesto, verAnalisis, listarProyectos, textoBoq, importarBoq,
    importarExcel, conProyecto
  };
}
