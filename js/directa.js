/* =========================================================================
   OpenBOQ — administración directa
   -------------------------------------------------------------------------
   Muchas entidades no contratan la obra entera: compran los materiales por su
   cuenta y contratan aparte la mano de obra con el equipo. Así los gastos
   generales, la utilidad y el IT del contratista dejan de cobrarse sobre los
   materiales. Caso real que dio origen a esto: Puente 1ro de Mayo (Huari),
   delegada 392.759,95 → M.O. + equipo 168.810,28 + materiales 188.091,16 con
   los mismos análisis: 9,1 % menos sin tocar un rendimiento.

   No es otro proyecto: es una VISTA del proyecto abierto. Los ítems, los
   cómputos y los análisis se cargan una sola vez y de ahí salen las dos
   partes, así que un cambio de cómputo llega a las dos sin sincronizar nada.
   Lo único propio se guarda en `P.adminDirecta`, dentro del mismo .boq:

     params   incidencias del contrato de M.O. (pueden diferir: utilidad 5 %)
     provee   { idInsumo: true } materiales que pone el contratista y que por
              eso quedan dentro de su contrato (la plaqueta, por ejemplo)
     mats     { idInsumo: {f, uc, pm, pt, lote} } factor a unidad comercial,
              unidad comercial, precio de mercado, partida y lote

   Los materiales van a COSTO DIRECTO (decisión de Alvaro, 22/10/2026): es una
   compra a proveedor y el precio ya trae sus impuestos.

   Se entra solo por HERRAMIENTAS: la interfaz principal no cambia.
   ========================================================================= */
'use strict';

const DIRECTA = (() => {
  const M = MOTOR;
  const clonar = x => JSON.parse(JSON.stringify(x));

  /* ---------------- configuración guardada en el proyecto ---------------- */
  function cfg(P) {
    P = P || M.proyecto();
    const c = P.adminDirecta = P.adminDirecta || {};
    c.params = Object.assign({}, P.params, c.params || {});
    c.provee = c.provee || {};
    c.mats = c.mats || {};
    return c;
  }

  /* Sugerencias para la planilla de adquisición. Son solo el punto de partida:
     todo se edita en la ventana y lo editado manda. */
  function partidaSugerida(d) {
    const s = M.norm(d).toLowerCase();
    const hay = l => l.some(k => s.indexOf(k) >= 0);
    if (hay(['cemento', 'estuco', 'yeso', 'cal '])) return ['34500', 'Ferretería'];
    if (hay(['arena', 'grava', 'piedra', 'ripio', 'tierra'])) return ['34700', 'Agregados'];
    if (hay(['madera', 'tabla', 'liston', 'venesta', 'callapo'])) return ['31300', 'Madera'];
    if (hay(['pintura', 'pegamento', 'limpiador', 'aditivo', 'sellador', 'thinner'])) return ['34200', 'Ferretería'];
    if (hay(['electrodo', 'cable', 'conductor'])) return ['39700', 'Ferretería'];
    if (hay(['fierro', 'acero', 'alambre', 'clavo', 'angular', 'tuberia', 'plancha', 'gavion', 'perfil', 'malla', 'calamina']))
      return ['34600', 'Metálicos'];
    if (hay(['oficina', 'deposito', 'letrero', 'cerco'])) return ['', 'No se compra'];
    return ['', ''];
  }
  function comercialSugerido(d, u) {
    const s = M.norm(d).toLowerCase();
    if (s.indexOf('cemento') >= 0 && /kg/i.test(u || 'kg')) return [50, 'bolsa 50 kg'];
    if (s.indexOf('tuberia') >= 0 || s.indexOf('angular') >= 0) return [6, 'barra 6 m'];
    if (s.indexOf('fierro') >= 0) return [null, 'barras (según planilla de fierros)'];
    return [1, u || ''];
  }

  /* ---------------- las dos partes ---------------- */

  /**
   * El proyecto del contrato de mano de obra y equipo: el mismo proyecto sin
   * los materiales que compra la entidad y con las incidencias del contrato.
   * Es una copia: el proyecto abierto no se toca.
   */
  function proyectoMO(P) {
    P = P || M.proyecto();
    const c = cfg(P);
    const Q = clonar(P);
    delete Q.adminDirecta;
    Q.nombre = (P.nombre || 'Proyecto') + ' — M.O. y equipo';
    Q.params = clonar(c.params);
    /* con otras incidencias el precio del archivo de origen ya no vale */
    Q.formatoId = null;
    Q.modulos.forEach(m => m.items.forEach(it => {
      delete it.puArchivo;
      it.comp = (it.comp || []).filter(x => {
        const ins = P.insumos[x.ins];
        return ins && (ins.t === 'O' || ins.t === 'E' || c.provee[ins.id]);
      });
    }));
    return limpiar(Q);
  }

  /* ítems sin nada que cobrar en esa parte, módulos vacíos e insumos que ya
     nadie usa: no van al archivo de esa parte */
  function limpiar(Q) {
    Q.modulos.forEach(m => { m.items = m.items.filter(it => (it.comp || []).length); });
    Q.modulos = Q.modulos.filter(m => m.items.length);
    if (!Q.modulos.length) Q.modulos = [{ id: M.nid(), n: 'MÓDULO # 1', items: [] }];
    Q.moduloActivo = 0; Q.itemSel = null;
    const usados = new Set();
    Q.modulos.forEach(m => m.items.forEach(it => it.comp.forEach(x => usados.add(String(x.ins)))));
    Object.keys(Q.insumos).forEach(id => { if (!usados.has(String(id))) delete Q.insumos[id]; });
    return Q;
  }

  /**
   * El proyecto de los materiales que compra la entidad, como el del puente:
   * mismos ítems y cómputos, solo los materiales (sin los que pone el
   * contratista) y A COSTO DIRECTO —gastos generales, utilidad e IT en cero—,
   * así el P.U. de cada ítem es su costo de materiales. Es una copia.
   */
  function proyectoMat(P) {
    P = P || M.proyecto();
    const c = cfg(P);
    const Q = clonar(P);
    delete Q.adminDirecta;
    Q.nombre = (P.nombre || 'Proyecto') + ' — Materiales';
    Q.params = Object.assign(clonar(P.params), { cargas: 0, ivaMO: 0, herr: 0, gg: 0, util: 0, it: 0 });
    Q.formatoId = null;
    Q.modulos.forEach(m => m.items.forEach(it => {
      delete it.puArchivo;
      it.comp = (it.comp || []).filter(x => {
        const ins = P.insumos[x.ins];
        return ins && ins.t !== 'O' && ins.t !== 'E' && !c.provee[ins.id];
      });
    }));
    return limpiar(Q);
  }

  /**
   * Lo que compra la entidad: por ítem (B-1 a costo directo) y por insumo
   * (planilla de adquisición). Cantidad = Σ rendimiento × cómputo.
   */
  function materiales(P) {
    P = P || M.proyecto();
    const c = cfg(P);
    const items = [], porIns = {};
    M.conProyecto(P, () => P.modulos.forEach(m => m.items.forEach(it => {
      const q = Number(it.cant) || 0;
      let unit = 0;
      (it.comp || []).forEach(x => {
        const ins = P.insumos[x.ins];
        if (!ins || ins.t === 'O' || ins.t === 'E' || c.provee[ins.id]) return;
        const rend = Number(x.rend) || 0;
        unit += rend * (Number(ins.p) || 0);
        const k = ins.id;
        porIns[k] = porIns[k] || { ins, cant: 0 };
        porIns[k].cant += rend * q;
      });
      items.push({ it, modulo: m.n, unit: M.r2(unit), total: M.r2(M.r2(unit) * q) });
    })));
    const lista = Object.values(porIns).map(x => {
      const ed = c.mats[x.ins.id] || {};
      const [ptS, loteS] = partidaSugerida(x.ins.d);
      const [fS, ucS] = comercialSugerido(x.ins.d, x.ins.u);
      const f = ed.f === undefined ? fS : (ed.f === '' || ed.f === null ? null : Number(ed.f));
      const p = Number(x.ins.p) || 0;
      const pm = ed.pm === undefined || ed.pm === '' ? (f ? p * f : p) : Number(ed.pm);
      const cantCom = f ? Math.ceil(x.cant / f - 1e-9) : null;
      return {
        ins: x.ins, cant: x.cant, p, parcialRef: M.r2(x.cant * p),
        f, uc: ed.uc === undefined ? ucS : ed.uc, cantCom, pm: M.r2(pm),
        compra: f ? M.r2(cantCom * pm) : M.r2(x.cant * p),
        pt: ed.pt === undefined ? ptS : ed.pt, lote: ed.lote === undefined ? loteS : ed.lote
      };
    }).sort((a, b) => M.cmpTexto(a.ins.d, b.ins.d));
    return { items, lista };
  }

  /** Delegada contra directa, con el motor de siempre. */
  function comparativo(P) {
    P = P || M.proyecto();
    const Q = proyectoMO(P);
    const mat = materiales(P);
    const delegada = M.conProyecto(P, () => M.totalGeneral());
    const mo = M.conProyecto(Q, () => M.totalGeneral());
    const matRef = M.r2(mat.items.reduce((s, x) => s + x.total, 0));
    const compra = M.r2(mat.lista.filter(x => x.lote !== 'No se compra').reduce((s, x) => s + x.compra, 0));
    const porItem = [];
    M.conProyecto(P, () => P.modulos.forEach(m => m.items.forEach(it => porItem.push({ it, del: M.parcialGeneral(it) }))));
    const moPorId = {};
    M.conProyecto(Q, () => Q.modulos.forEach(m => m.items.forEach(it => { moPorId[it.id] = M.parcialGeneral(it); })));
    const matPorId = {};
    mat.items.forEach(x => { matPorId[x.it.id] = x.total; });
    porItem.forEach(x => { x.mo = moPorId[x.it.id] || 0; x.mat = matPorId[x.it.id] || 0; x.ahorro = M.r2(x.del - x.mo - x.mat); });
    return {
      Q, mat, porItem, delegada, mo, matRef, compra,
      directaRef: M.r2(mo + matRef), directaCompra: M.r2(mo + compra),
      ahorroRef: M.r2(delegada - mo - matRef), ahorroCompra: M.r2(delegada - mo - compra)
    };
  }

  /* ---------------- Excel ---------------- */
  const X = () => XLSX;
  const cel = (v, s, m) => ({ v, t: 's', s: s === undefined ? XLSX.EST.texto : s, m: m || 1 });
  const num = (v, s) => ({ v: Number(v) || 0, t: 'n', s: s === undefined ? XLSX.EST.num : s });
  const nombreArchivo = s => (s || 'proyecto').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]/g, '').trim().replace(/\s+/g, '_');

  function cabecera(h, titulo, nc) {
    const P = M.proyecto(), E = XLSX.EST;
    h.fila([cel(titulo, E.titulo, nc)]);
    h.fila([cel('Proyecto:', E.etiqueta), cel(P.nombre, E.normal, nc - 1)]);
    h.fila([cel('Cliente:', E.etiqueta), cel(P.entidad || '—', E.normal, nc - 1)]);
    h.fila([cel('Lugar:', E.etiqueta), cel(P.ubicacion || '—', E.normal, nc - 1)]);
    h.blanco();
  }

  function hojaComparativo(C) {
    const E = X().EST, h = new XLSX.Hoja('Comparativo', [6, 52, 16, 16, 16, 16]);
    cabecera(h, 'Administración directa — comparativo', 6);
    const r = (t, v, s) => h.fila([cel(t, s ? E.totT : E.normal, 2), num(v, s ? E.totN : E.num)]);
    r('A. Presupuesto delegado (una sola empresa)', C.delegada);
    r('B. Contrato de mano de obra y equipo', C.mo);
    r('C. Materiales a costo directo (precios del análisis)', C.matRef);
    r('D. Materiales a cantidad y precio de compra', C.compra);
    r('Directa con precios del análisis (B + C)', C.directaRef, 1);
    r('Ahorro (A − B − C)', C.ahorroRef, 1);
    h.fila([cel('Ahorro %', E.totT, 2), num(C.delegada ? C.ahorroRef / C.delegada * 100 : 0, E.totN)]);
    r('Directa con compra (B + D)', C.directaCompra, 1);
    r('Ahorro con compra (A − B − D)', C.ahorroCompra, 1);
    h.blanco();
    h.fila(['Nº', 'Ítem', 'Delegada', 'M.O. + equipo', 'Materiales', 'Ahorro'].map(t => cel(t, E.encab)));
    h.congelar = h.filas.length;
    C.porItem.forEach((x, i) => h.fila([num(i + 1, E.ctr), cel(x.it.desc), num(x.del), num(x.mo), num(x.mat), num(x.ahorro)]));
    h.fila([cel('Total', E.totT, 2), num(C.delegada, E.totN), num(C.mo, E.totN), num(C.matRef, E.totN), num(C.ahorroRef, E.totN)]);
    h.blanco();
    h.fila([cel('El ahorro sale de que los gastos generales, la utilidad y el IT del contratista dejan de cobrarse sobre los materiales.', E.nota, 6)]);
    return h;
  }

  function hojaMatItems(C) {
    const E = X().EST, h = new XLSX.Hoja('Materiales por ítem', [6, 52, 8, 13, 15, 17]);
    cabecera(h, 'Materiales — presupuesto por ítem a costo directo', 6);
    h.fila(['Nº', 'Descripción', 'Und.', 'Cantidad', 'Unitario', 'Parcial'].map(t => cel(t, E.encab)));
    h.congelar = h.filas.length;
    C.mat.items.forEach((x, i) => h.fila([num(i + 1, E.ctr), cel(x.it.desc), cel(x.it.und, E.ctr),
      num(x.it.cant), num(x.unit), num(x.total)]));
    h.fila([cel('Total materiales:', E.totT, 5), num(C.matRef, E.totN)]);
    return h;
  }

  function hojaAdquisicion(C) {
    const E = X().EST;
    const h = new XLSX.Hoja('Adquisición', [5, 38, 8, 13, 11, 14, 9, 24, 12, 12, 15, 9, 16]);
    cabecera(h, 'Materiales — planilla de adquisición', 13);
    h.fila(['Nº', 'Material', 'Und.', 'Cantidad', 'Precio análisis', 'Parcial', 'Factor', 'Unidad comercial',
      'Cant. comercial', 'Precio compra', 'Parcial compra', 'Partida', 'Lote'].map(t => cel(t, E.encab)));
    h.congelar = h.filas.length;
    C.mat.lista.forEach((x, i) => h.fila([num(i + 1, E.ctr), cel(x.ins.d), cel(x.ins.u, E.ctr), num(x.cant, E.num4),
      num(x.p), num(x.parcialRef), x.f ? num(x.f) : cel('—', E.ctr), cel(x.uc || ''), x.f ? num(x.cantCom) : cel('—', E.ctr),
      num(x.pm), num(x.compra), cel(x.pt || '', E.ctr), cel(x.lote || '')]));
    h.fila([cel('Total', E.totT, 5), num(C.matRef, E.totN), cel('', E.totT, 4), num(C.mat.lista.reduce((s, x) => s + x.compra, 0), E.totN)]);
    const grupo = (titulo, clave) => {
      const acc = {};
      C.mat.lista.forEach(x => { const k = x[clave] || '(sin asignar)'; acc[k] = (acc[k] || 0) + x.compra; });
      h.blanco();
      h.fila([cel(titulo, E.grupo, 3)]);
      Object.keys(acc).sort().forEach(k => h.fila([cel(''), cel(k), num(M.r2(acc[k]))]));
    };
    grupo('Por partida', 'pt');
    grupo('Por lote', 'lote');
    h.blanco();
    h.fila([cel('Sin factor, la compra va a la cantidad y el precio del análisis (el fierro sale de la planilla de fierros).', E.nota, 13)]);
    return h;
  }

  function excelMateriales() {
    const C = comparativo();
    const datos = XLSX.libro([hojaComparativo(C), hojaMatItems(C), hojaAdquisicion(C)]);
    REP.descargar(nombreArchivo(M.proyecto().nombre) + '_materiales.xlsx', datos,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /* Los formularios del contrato son los mismos de siempre, calculados sobre
     el proyecto derivado. */
  function excelMO() {
    const Q = proyectoMO();
    M.conProyecto(Q, () => REP.excelLibro(['Presupuesto general', 'Presupuesto por módulo',
      'Análisis de precios', 'Precios elementales', 'Cómputos métricos']));
  }

  /* `archivos()` corre entero antes del primer await de `ddp()`, y es la única
     parte que lee el proyecto activo: por eso alcanza con prestarlo acá. */
  function ddpMO(nombre) {
    const Q = proyectoMO();
    /* nunca el nombre interno del original: en la carpeta temporal del
       programa de origen un .ddp con el mismo nombre pisa al otro */
    const P = M.proyecto();
    const base = (P.prescom && P.prescom.base) || EXPORTADOR.nombreSugerido(P.nombre);
    const n = nombre || EXPORTADOR.nombreInterno(base.slice(0, 54) + ' MO');
    return M.conProyecto(Q, () => EXPORTADOR.ddp({ proyecto: Q, nombre: n }));
  }

  function boqMO() {
    const Q = proyectoMO();
    const txt = M.conProyecto(Q, () => M.serializar());
    REP.descargar(nombreArchivo(Q.nombre) + '.boq', txt, 'application/json');
  }

  /* materiales: lo mismo, con su propio nombre interno («… MAT») */
  function ddpMat(nombre) {
    const Q = proyectoMat();
    const P = M.proyecto();
    const base = (P.prescom && P.prescom.base) || EXPORTADOR.nombreSugerido(P.nombre);
    const n = nombre || EXPORTADOR.nombreInterno(base.slice(0, 53) + ' MAT');
    return M.conProyecto(Q, () => EXPORTADOR.ddp({ proyecto: Q, nombre: n }));
  }
  function boqMat() {
    const Q = proyectoMat();
    const txt = M.conProyecto(Q, () => M.serializar());
    REP.descargar(nombreArchivo(Q.nombre) + '.boq', txt, 'application/json');
  }

  /* los dos archivos de una vez: M.O. + equipo y materiales. El segundo
     espera un momento: algunos navegadores frenan dos descargas seguidas */
  async function ambos(formato) {
    const espera = () => new Promise(r => setTimeout(r, 700));
    if (formato === 'boq') { boqMO(); await espera(); boqMat(); return; }
    const a = await ddpMO(), b = await ddpMat();
    const err = [].concat(a.datos ? [] : ['M.O. + equipo: ' + a.errores.join(' · ')], b.datos ? [] : ['Materiales: ' + b.errores.join(' · ')]);
    if (a.datos) REP.descargar(a.nombre + '.ddp', a.datos, 'application/octet-stream');
    if (b.datos) { await espera(); REP.descargar(b.nombre + '.ddp', b.datos, 'application/octet-stream'); }
    if (err.length) alert('No se pudo exportar:\n' + err.join('\n'));
  }

  /* ---------------- la ventana ---------------- */
  let pestana = 'comp';

  /**
   * @param {Object} ui funciones de ui.js: modal, cerrar, cambio (marca el
   *        proyecto con cambios sin guardar), esc
   */
  function abrir(ui) {
    const P = M.proyecto();
    const nItems = P.modulos.reduce((s, m) => s + m.items.length, 0);
    if (!nItems) { alert('El proyecto no tiene ítems. Arme o importe el presupuesto y vuelva a esta opción.'); return; }
    cfg(P);
    ui.modal('Administración directa — dividir M.O. y materiales', '<div id="dxCuerpo"></div>', [
      ['Cerrar', null, 'sec']
    ]);
    document.getElementById('overlay').classList.add('ancho');
    pintar(ui);
  }

  function pintar(ui) {
    const P = M.proyecto(), c = cfg(P), esc = ui.esc, f2 = v => M.fmt(M.conv(v), 2);
    const C = comparativo(P);
    const tab = (k, t) => `<button class="btn ${pestana === k ? '' : 'sec'}" data-dx-tab="${k}">${t}</button>`;
    /* el entregable: DOS archivos, uno por contrato, como el del puente */
    const dosArchivos = `<div class="aviso-caja" style="margin-top:10px"><b>Archivos finales: dos proyectos separados</b>
      <p class="mini" style="margin:4px 0 6px">Uno para el contrato de mano de obra y equipo, y otro para los materiales
      que compra la entidad (a costo directo: sin gastos generales, utilidad ni IT). Mismos ítems y cómputos.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${typeof EXPORTADOR !== 'undefined' ? '<button class="btn" data-dx-acc="ambosDdp">Descargar los 2 en formato PRESCOM (.ddp)</button>' : ''}
        <button class="btn ${typeof EXPORTADOR !== 'undefined' ? 'sec' : ''}" data-dx-acc="ambosBoq">Descargar los 2 como OpenBOQ (.boq)</button>
      </div></div>`;
    let h = `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
      ${tab('comp', 'Comparativo')}${tab('mo', 'Contrato M.O. + equipo')}${tab('mat', 'Materiales')}</div>
      <table class="rej" style="margin-bottom:10px"><tbody>
        <tr><td>Presupuesto delegado (una sola empresa)</td><td class="num">${f2(C.delegada)}</td><td></td></tr>
        <tr><td>Contrato de mano de obra y equipo</td><td class="num">${f2(C.mo)}</td><td></td></tr>
        <tr><td>Materiales a costo directo</td><td class="num">${f2(C.matRef)}</td><td></td></tr>
        <tr><td><b>Ahorro</b></td><td class="num"><b>${f2(C.ahorroRef)}</b></td>
          <td class="num"><b>${C.delegada ? (C.ahorroRef / C.delegada * 100).toFixed(1) : '0'} %</b></td></tr>
        <tr><td class="mini">Con cantidades y precios de compra</td><td class="num mini">${f2(C.directaCompra)}</td>
          <td class="num mini">ahorro ${f2(C.ahorroCompra)}</td></tr>
      </tbody></table>`;

    if (pestana === 'comp') {
      h += `<p class="mini">Mismos ítems y cómputos del proyecto. El ahorro sale de que los gastos generales, la
        utilidad y el IT del contratista dejan de cobrarse sobre los materiales.</p>
        <div style="max-height:46vh;overflow:auto"><table class="rej"><thead><tr><th>Nº</th><th>Ítem</th>
        <th>Delegada</th><th>M.O. + equipo</th><th>Materiales</th><th>Ahorro</th></tr></thead><tbody>
        ${C.porItem.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.it.desc)}</td><td class="num">${f2(x.del)}</td>
          <td class="num">${f2(x.mo)}</td><td class="num">${f2(x.mat)}</td><td class="num">${f2(x.ahorro)}</td></tr>`).join('')}
        </tbody></table></div>
        ${dosArchivos}
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sec" data-dx-acc="xlsMat">Excel: comparativo y materiales</button></div>`;
    } else if (pestana === 'mo') {
      const filas = [['cargas', 'Cargas sociales'], ['ivaMO', 'IVA mano de obra'], ['herr', 'Herramientas menores'],
        ['gg', 'Gastos generales'], ['util', 'Utilidad'], ['it', 'IT']];
      const mats = Object.values(P.insumos).filter(i => i.t !== 'O' && i.t !== 'E' &&
        C.mat.lista.some(x => x.ins.id === i.id) || c.provee[i.id]).sort((a, b) => M.cmpTexto(a.d, b.d));
      h += `<div style="display:flex;gap:18px;flex-wrap:wrap"><div>
        <h3 style="margin:4px 0">Incidencias del contrato</h3>
        <table class="rej"><thead><tr><th>Concepto</th><th>Proyecto</th><th>Contrato</th></tr></thead><tbody>
        ${filas.map(([k, n]) => `<tr><td>${n} %</td><td class="num">${M.fmt(P.params[k], 2)}</td>
          <td><input type="number" step="0.01" style="width:80px" data-dx-par="${k}" value="${c.params[k]}"></td></tr>`).join('')}
        </tbody></table>
        <p class="mini">Arrancan iguales a las del proyecto. Cambiarlas no toca el presupuesto delegado.</p></div>
        <div style="flex:1;min-width:280px"><h3 style="margin:4px 0">Materiales que pone el contratista</h3>
        <p class="mini">Marcados, quedan dentro del contrato de M.O. y no se compran (una plaqueta, consumibles).</p>
        <div style="max-height:36vh;overflow:auto"><table class="rej"><tbody>
        ${mats.map(i => `<tr><td><label><input type="checkbox" data-dx-prov="${esc(i.id)}" ${c.provee[i.id] ? 'checked' : ''}>
          ${esc(i.d)}</label></td><td>${esc(i.u)}</td></tr>`).join('')}
        </tbody></table></div></div></div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" data-dx-acc="xlsMO">Excel: B-1, B-2 y B-3 del contrato</button>
          ${typeof EXPORTADOR !== 'undefined' ? '<button class="btn sec" data-dx-acc="ddpMO">Exportar contrato a .ddp</button>' : ''}
          <button class="btn sec" data-dx-acc="boqMO">Guardar contrato como .boq aparte</button></div>`;
    } else {
      h += `<p class="mini">Cantidad = Σ rendimiento × cómputo. En amarillo lo editable: factor a la unidad en que se
        compra (50 para bolsas de cemento), precio de compra por esa unidad, partida y lote. Sin factor, la compra
        va a la cantidad y el precio del análisis.</p>
        <div style="max-height:44vh;overflow:auto"><table class="rej"><thead><tr><th>Material</th><th>Und.</th>
        <th>Cantidad</th><th>Parcial análisis</th><th>Factor</th><th>Unidad comercial</th><th>Cant. com.</th>
        <th>Precio compra</th><th>Parcial compra</th><th>Partida</th><th>Lote</th></tr></thead><tbody>
        ${C.mat.lista.map(x => {
          const id = esc(x.ins.id), inp = (k, v, w, t) =>
            `<input ${t ? 'type="number" step="any"' : ''} style="width:${w}px;background:var(--amarillo);color:var(--texto)" data-dx-mat="${id}" data-dx-k="${k}" value="${esc(v === null || v === undefined ? '' : v)}">`;
          return `<tr><td>${esc(x.ins.d)}</td><td>${esc(x.ins.u)}</td><td class="num">${M.fmt(x.cant, 3)}</td>
            <td class="num">${f2(x.parcialRef)}</td><td>${inp('f', x.f, 60, 1)}</td><td>${inp('uc', x.uc, 150)}</td>
            <td class="num">${x.cantCom === null ? '—' : x.cantCom}</td><td>${inp('pm', x.pm, 80, 1)}</td>
            <td class="num">${f2(x.compra)}</td><td>${inp('pt', x.pt, 60)}</td><td>${inp('lote', x.lote, 110)}</td></tr>`;
        }).join('')}
        </tbody></table></div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" data-dx-acc="xlsMat">Excel: comparativo y materiales</button>
          ${typeof EXPORTADOR !== 'undefined' ? '<button class="btn sec" data-dx-acc="ddpMat">Exportar materiales a .ddp</button>' : ''}
          <button class="btn sec" data-dx-acc="boqMat">Guardar materiales como .boq aparte</button></div>`;
    }
    const caja = document.getElementById('dxCuerpo');
    if (!caja) return;
    caja.innerHTML = h;
    conectar(ui, caja);
  }

  function conectar(ui, caja) {
    const P = M.proyecto(), c = cfg(P);
    const repintar = () => {
      const a = document.activeElement, sel = a && a.dataset ?
        (a.dataset.dxPar ? `[data-dx-par="${a.dataset.dxPar}"]` :
          a.dataset.dxMat ? `[data-dx-mat="${a.dataset.dxMat}"][data-dx-k="${a.dataset.dxK}"]` : null) : null;
      pintar(ui);
      if (sel) { const e = document.querySelector(sel); if (e) e.focus(); }
    };
    caja.querySelectorAll('[data-dx-tab]').forEach(b => b.onclick = () => { pestana = b.dataset.dxTab; pintar(ui); });
    caja.querySelectorAll('[data-dx-par]').forEach(i => i.onchange = () => {
      const v = Number(i.value);
      if (isFinite(v) && v >= 0) { c.params[i.dataset.dxPar] = v; ui.cambio(); }
      repintar();
    });
    caja.querySelectorAll('[data-dx-prov]').forEach(i => i.onchange = () => {
      if (i.checked) c.provee[i.dataset.dxProv] = true; else delete c.provee[i.dataset.dxProv];
      ui.cambio(); repintar();
    });
    caja.querySelectorAll('[data-dx-mat]').forEach(i => i.onchange = () => {
      const id = i.dataset.dxMat, k = i.dataset.dxK;
      const ed = c.mats[id] = c.mats[id] || {};
      ed[k] = (k === 'f' || k === 'pm') ? (i.value === '' ? '' : Number(i.value)) : i.value;
      ui.cambio(); repintar();
    });
    caja.querySelectorAll('[data-dx-acc]').forEach(b => b.onclick = async () => {
      const a = b.dataset.dxAcc;
      try {
        if (a === 'xlsMat') excelMateriales();
        else if (a === 'xlsMO') excelMO();
        else if (a === 'boqMO') boqMO();
        else if (a === 'boqMat') boqMat();
        else if (a === 'ambosDdp') await ambos('ddp');
        else if (a === 'ambosBoq') await ambos('boq');
        else if (a === 'ddpMat') {
          const r = await ddpMat();
          if (!r.datos) { alert('No se pudo exportar:\n' + r.errores.join('\n')); return; }
          REP.descargar(r.nombre + '.ddp', r.datos, 'application/octet-stream');
        }
        else if (a === 'ddpMO') {
          const r = await ddpMO();
          if (!r.datos) { alert('No se pudo exportar:\n' + r.errores.join('\n')); return; }
          REP.descargar(r.nombre + '.ddp', r.datos, 'application/octet-stream');
        }
      } catch (e) { alert('No se pudo generar:\n' + e.message); }
    });
  }

  return { cfg, proyectoMO, proyectoMat, materiales, comparativo, excelMateriales, excelMO, ddpMO, boqMO,
    ddpMat, boqMat, ambos, abrir, partidaSugerida };
})();

if (typeof window !== 'undefined') window.DIRECTA = DIRECTA;
