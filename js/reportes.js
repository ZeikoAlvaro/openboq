/* =========================================================================
   OpenBOQ — reportes imprimibles (formularios B-1, B-2, B-3 y otros)
   ========================================================================= */
'use strict';

const REP = (() => {

  const CSS = `
  <style>
    @page{size:A4;margin:14mm 12mm}
    body{font-family:"Segoe UI",Arial,sans-serif;font-size:10.5px;color:#111;margin:0}
    h1{font-size:15px;margin:0 0 2px;text-align:center;letter-spacing:.5px}
    h2{font-size:12px;margin:14px 0 4px;background:#3d3d3d;color:#fff;padding:3px 6px}
    .enc{border:1.5px solid #c00000;padding:6px 8px;margin-bottom:8px}
    .enc .g{display:grid;grid-template-columns:repeat(4,1fr);gap:2px 12px;font-size:10px}
    .enc b{color:#c00000}
    table{border-collapse:collapse;width:100%;margin-bottom:6px}
    th{background:#c00000;color:#fff;border:1px solid #8c0000;padding:3px 4px;font-size:9.5px}
    td{border:1px solid #bbb;padding:2px 4px;font-size:10px;vertical-align:top}
    td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    td.c{text-align:center}
    tr.g td{background:#eee;font-weight:700}
    tfoot td{background:#f0ece4;font-weight:700}
    .tot{background:#c00000;color:#fff;font-weight:700}
    .apu{page-break-inside:avoid;margin-bottom:14px;border:1px solid #999;padding:6px}
    .apu h3{font-size:11px;margin:0 0 4px;color:#c00000}
    .pie{margin-top:16px;font-size:9px;color:#666;text-align:center}
    .firmas{margin-top:34px;display:flex;justify-content:space-around;font-size:10px;text-align:center}
    .firmas div{border-top:1px solid #333;padding-top:3px;width:200px}
    svg{width:100%;height:300px}
  </style>`;

  function abrir(titulo, html) {
    const w = window.open('', '_blank');
    if (!w) { alert('El navegador bloqueó la ventana emergente. Habilite las ventanas emergentes para este archivo.'); return; }
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' +
      esc(titulo) + '</title>' + CSS + '</head><body>' + html +
      '<div class="pie">Generado con OpenBOQ · ' + new Date().toLocaleString('es-BO') + '</div></body></html>');
    w.document.close();
  }

  /* Escapa TODO lo que puede romper el HTML, no solo los signos de mayor y
     menor. Las comillas importan tanto como ellos: esta misma funcion se usa
     dentro de atributos —`value="${esc(x)}"`— y un texto con una comilla
     doble cierra el atributo y deja poner otro, por ejemplo un `onmouseover`.
     El texto llega de un .boq que puede haber armado cualquiera y mandarlo
     por correo, asi que se trata como dato ajeno.

     La comilla simple va como `&#39;` y no como `&apos;`: es la unica de las
     cinco que el HTML antiguo no conoce por nombre. */
  const MAPA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/[&<>"']/g, c => MAPA_ESC[c]);

  function encabezado(sub) {
    const P = MOTOR.proyecto();
    return '<h1>' + esc(P.nombre.toUpperCase()) + '</h1>' +
      '<h1 style="font-size:12px;font-weight:400">' + esc(sub) + '</h1>' +
      '<div class="enc"><div class="g">' +
      '<div><b>Entidad:</b> ' + esc(P.entidad || '—') + '</div>' +
      '<div><b>Ubicación:</b> ' + esc(P.ubicacion || '—') + '</div>' +
      '<div><b>Fecha:</b> ' + esc(P.fecha) + '</div>' +
      '<div><b>Moneda:</b> ' + esc(P.moneda) + (P.moneda === '$US' ? ' (T/C ' + P.tc + ')' : '') + '</div>' +
      '<div><b>Plazo:</b> ' + esc(P.plazo) + ' días calendario</div>' +
      '<div><b>Módulos:</b> ' + P.modulos.length + '</div>' +
      '<div><b>Ítems:</b> ' + P.modulos.reduce((s, m) => s + m.items.length, 0) + '</div>' +
      '<div><b>Insumos:</b> ' + Object.keys(P.insumos).length + '</div>' +
      '</div></div>';
  }

  const f = (v, d) => MOTOR.fmt(MOTOR.conv(v), d);
  const firmas = () => '<div class="firmas"><div>Elaborado por</div><div>Revisado por</div><div>Aprobado por</div></div>';

  /* ---------------- B-1 · PRESUPUESTO GENERAL ---------------- */
  function b1() {
    const P = MOTOR.proyecto();
    let h = encabezado('FORMULARIO B-1 · PRESUPUESTO GENERAL DE LA OBRA');
    h += '<table><thead><tr><th style="width:34px">N°</th><th>DESCRIPCIÓN DE LA ACTIVIDAD</th>' +
      '<th style="width:46px">UND.</th><th style="width:70px">CANTIDAD</th>' +
      '<th style="width:82px">PRECIO UNIT.</th><th style="width:92px">PRECIO TOTAL</th></tr></thead><tbody>';
    /* total y subtotales como PRESCOM: MOTOR.totalGeneral */
    let n = 0;
    const gran = MOTOR.totalGeneral();
    P.modulos.forEach(m => {
      if (P.modulos.length > 1) h += '<tr class="g"><td colspan="6">' + esc(m.n) + '</td></tr>';
      m.items.forEach(it => {
        const a = MOTOR.analisis(it); n++;
        h += '<tr><td class="c">' + n + '</td><td>' + esc(it.desc) + '</td><td class="c">' + esc(it.und) +
          '</td><td class="n">' + MOTOR.fmt(it.cant, 2) + '</td><td class="n">' + f(a.pu) +
          '</td><td class="n">' + f(MOTOR.parcialGeneral(it)) + '</td></tr>';
      });
      if (P.modulos.length > 1)
        h += '<tr><td colspan="5" class="n">Subtotal ' + esc(m.n) + '</td><td class="n">' +
          f(MOTOR.subtotalGeneral(m)) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr class="tot"><td colspan="5" class="n">TOTAL PRESUPUESTO (' + P.moneda + ')</td>' +
      '<td class="n">' + f(gran) + '</td></tr></tfoot></table>';
    h += '<p style="font-size:10px"><b>Son:</b> ' + literal(MOTOR.conv(gran)) + ' ' +
      (P.moneda === 'Bs' ? 'BOLIVIANOS' : 'DÓLARES AMERICANOS') + '.</p>';
    h += firmas();
    abrir('B-1 Presupuesto general', h);
  }

  /* ---------------- B-2 · ANÁLISIS DE PRECIOS UNITARIOS ---------------- */
  function b2(unItem) {
    const P = MOTOR.proyecto();
    const lista = unItem ? [unItem] : P.modulos.flatMap(m => m.items);
    if (!lista.length) return alert('No hay ítems en el presupuesto.');
    let h = encabezado('FORMULARIO B-2 · ANÁLISIS DE PRECIOS UNITARIOS');
    let n = 0;
    lista.forEach(it => {
      n++;
      const a = MOTOR.analisis(it);
      h += '<div class="apu"><h3>ÍTEM N° ' + n + ' · ' + esc(it.desc) + '</h3>' +
        '<table><tr><td><b>Unidad:</b> ' + esc(it.und) + '</td><td><b>Cantidad:</b> ' +
        MOTOR.fmt(it.cant, 2) + '</td><td><b>Moneda:</b> ' + P.moneda + '</td>' +
        '<td><b>Precio unitario:</b> ' + f(a.pu) + '</td></tr></table>';
      h += '<table><thead><tr><th style="width:26px">N°</th><th>DESCRIPCIÓN</th><th style="width:46px">UND.</th>' +
        '<th style="width:76px">CANTIDAD</th><th style="width:80px">P. UNITARIO</th><th style="width:84px">COSTO TOTAL</th></tr></thead><tbody>';
      const bloque = (tit, arr, sub) => {
        h += '<tr class="g"><td colspan="6">' + tit + '</td></tr>';
        if (!arr.length) h += '<tr><td class="c">—</td><td colspan="5" style="color:#888">(sin insumos)</td></tr>';
        arr.forEach((x, k) => {
          h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(x.ins.d) + '</td><td class="c">' + esc(x.ins.u) +
            '</td><td class="n">' + MOTOR.fmt(x.rend, 4) + '</td><td class="n">' + f(x.pu) +
            '</td><td class="n">' + f(x.parcial) + '</td></tr>';
        });
        h += '<tr><td colspan="5" class="n"><b>' + sub[0] + '</b></td><td class="n"><b>' + f(sub[1]) + '</b></td></tr>';
      };
      /* Con el formato oficial el B-2 sale exactamente como siempre: es la
         forma del DS 0181 y así se presenta. Con un formato propio no hay
         dónde intercalar filas que la aplicación no conoce, de modo que los
         tres grupos salen limpios y la cadena se imprime entera debajo. */
      if (MOTOR.formatoEsOficial()) {
        bloque('1. MATERIALES', a.grupos.M, ['TOTAL MATERIALES', a.mat]);
        bloque('2. MANO DE OBRA', a.grupos.O, ['SUBTOTAL MANO DE OBRA', a.mo]);
        h += fila('CARGAS SOCIALES (' + P.params.cargas + '% de mano de obra)', a.cargas);
        h += fila('IVA MANO DE OBRA (' + P.params.ivaMO + '%)', a.ivaMO);
        h += fila('<b>TOTAL MANO DE OBRA</b>', a.totalMO);
        bloque('3. EQUIPO, MAQUINARIA Y HERRAMIENTAS', a.grupos.E, ['SUBTOTAL EQUIPO Y MAQUINARIA', a.eq]);
        h += fila('HERRAMIENTAS MENORES (' + P.params.herr + '% de mano de obra)', a.herr);
        h += fila('<b>TOTAL EQUIPO, MAQUINARIA Y HERRAMIENTAS</b>', a.totalEQ);
        h += '<tr class="g"><td colspan="5" class="n">SUBTOTAL (1 + 2 + 3)</td><td class="n">' + f(a.subtotal) + '</td></tr>';
        h += fila('4. GASTOS GENERALES Y ADMINISTRATIVOS (' + P.params.gg + '%)', a.gg);
        h += fila('PARCIAL', a.parcial2);
        h += fila('5. UTILIDAD (' + P.params.util + '%)', a.util);
        h += fila('PARCIAL', a.parcial3);
        h += fila('6. IMPUESTOS IT (' + P.params.it + '%)', a.it);
      } else {
        bloque('1. MATERIALES', a.grupos.M, ['TOTAL MATERIALES', a.mat]);
        bloque('2. MANO DE OBRA', a.grupos.O, ['SUBTOTAL MANO DE OBRA', a.mo]);
        bloque('3. EQUIPO, MAQUINARIA Y HERRAMIENTAS', a.grupos.E, ['SUBTOTAL EQUIPO Y MAQUINARIA', a.eq]);
        (a.cadena || []).filter(x => x.k !== 'ent').slice(0, -1).forEach(x => {
          const t = x.i + '. ' + esc(x.n).toUpperCase() + (x.k === 'pct' ? ' (' + x.pct + '%)' : '');
          h += fila(x.k === 'sum' ? '<b>' + t + '</b>' : t, MOTOR.r2(x.valor));
        });
      }
      /* Renglón que solo aparece en los ítems traídos de PRESCOM cuyo precio
         unitario difiere del calculado por el redondeo del archivo de origen.
         Va a la vista para que el análisis siga sumando exactamente su precio
         unitario y cualquiera pueda seguir de dónde sale el centavo. */
      if (a.ajuste) h += fila('REDONDEO DEL ARCHIVO DE ORIGEN', a.ajuste);
      h += '<tr class="tot"><td colspan="5" class="n">TOTAL PRECIO UNITARIO (' + P.moneda + ')</td>' +
        '<td class="n">' + f(a.pu) + '</td></tr>';
      h += '</tbody></table></div>';
    });
    abrir('B-2 Análisis de precios unitarios', h);
  }
  const fila = (t, v) => '<tr><td colspan="5" class="n">' + t + '</td><td class="n">' + f(v) + '</td></tr>';

  /** Fecha del precio para los impresos: dd/mm/aaaa, o un guión si no la tiene. */
  function fFecha(v) {
    if (!v) return '—';
    const [a, m, d] = String(v).slice(0, 10).split('-');
    return (d && m && a) ? d + '/' + m + '/' + a : esc(v);
  }

  /* ---------------- B-3 · PRECIOS ELEMENTALES ---------------- */
  function b3() {
    const P = MOTOR.proyecto();
    /* Solo los insumos que entran en algún análisis. El B-3 es el resumen de
       lo que consume la obra; los que no participan en ningún ítem no aportan
       ni cantidad ni monto y, puesto al lado de otro presupuesto, solo suman
       renglones vacíos. La lista completa sigue estando en la pestaña
       INSUMOS. */
    const L = MOTOR.insumosEnUso();
    let h = encabezado('FORMULARIO B-3 · ANÁLISIS DE GASTOS GENERALES Y PRECIOS ELEMENTALES');
    const nom = { M: 'MATERIALES', O: 'MANO DE OBRA', E: 'EQUIPO, MAQUINARIA Y HERRAMIENTAS' };
    ['M', 'O', 'E'].forEach(t => {
      const g = L.filter(x => x.t === t);
      if (!g.length) return;
      h += '<h2>' + nom[t] + '</h2><table><thead><tr><th style="width:34px">N°</th><th>DESCRIPCIÓN DEL INSUMO</th>' +
        '<th style="width:60px">UNIDAD</th><th style="width:100px">PRECIO (' + P.moneda + ')</th>' +
        '<th style="width:78px">FECHA</th></tr></thead><tbody>';
      g.forEach((x, k) => {
        h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(x.d) + '</td><td class="c">' + esc(x.u) +
          '</td><td class="n">' + f(x.p, Math.max(2, P.precision)) +
          '</td><td class="c">' + fFecha(x.f) + '</td></tr>';
      });
      h += '</tbody></table>';
    });
    h += firmas();
    abrir('B-3 Precios elementales', h);
  }

  /* ---------------- REQUERIMIENTO DE INSUMOS ---------------- */
  function insumos() {
    const P = MOTOR.proyecto();
    const L = MOTOR.requerimiento();
    if (!L.length) return alert('No hay insumos en el presupuesto.');
    const tot = L.reduce((s, x) => s + x.monto, 0);
    let h = encabezado('REQUERIMIENTO TOTAL DE INSUMOS DE LA OBRA');
    const nom = { M: 'MATERIALES', O: 'MANO DE OBRA', E: 'EQUIPO, MAQUINARIA Y HERRAMIENTAS' };
    ['M', 'O', 'E'].forEach(t => {
      const g = L.filter(x => x.ins.t === t);
      if (!g.length) return;
      const st = g.reduce((s, x) => s + x.monto, 0);
      h += '<h2>' + nom[t] + '</h2><table><thead><tr><th style="width:34px">N°</th><th>INSUMO</th>' +
        '<th style="width:50px">UND.</th><th style="width:90px">CANTIDAD</th><th style="width:80px">P. UNIT.</th>' +
        '<th style="width:92px">MONTO</th><th style="width:56px">% OBRA</th></tr></thead><tbody>';
      g.forEach((x, k) => {
        h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(x.ins.d) + '</td><td class="c">' + esc(x.ins.u) +
          '</td><td class="n">' + MOTOR.fmt(x.cant, 3) + '</td><td class="n">' + f(x.ins.p) +
          '</td><td class="n">' + f(x.monto) + '</td><td class="n">' +
          (tot ? (x.monto / tot * 100).toFixed(2) : '0.00') + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><td colspan="5" class="n">SUBTOTAL ' + nom[t] + '</td><td class="n">' +
        f(st) + '</td><td class="n">' + (tot ? (st / tot * 100).toFixed(2) : '0.00') + '</td></tr></tfoot></table>';
    });
    h += '<table><tr class="tot"><td class="n" style="width:70%">COSTO DIRECTO TOTAL DE INSUMOS (' + P.moneda + ')</td>' +
      '<td class="n">' + f(tot) + '</td></tr></table>';
    abrir('Requerimiento de insumos', h);
  }

  /* ---------------- CÓMPUTOS MÉTRICOS ---------------- */
  function computos() {
    const P = MOTOR.proyecto();
    let h = encabezado('PLANILLA DE CÓMPUTOS MÉTRICOS');
    let n = 0, hay = false;
    P.modulos.forEach(m => m.items.forEach(it => {
      n++;
      if (!it.computos || !it.computos.length) return;
      hay = true;
      h += '<h2>ÍTEM ' + n + ' · ' + esc(it.desc) + ' (' + esc(it.und) + ')</h2>';
      h += '<table><thead><tr><th>DESCRIPCIÓN / UBICACIÓN</th><th style="width:56px">N° VECES</th>' +
        '<th style="width:62px">LARGO (m)</th><th style="width:62px">ANCHO (m)</th>' +
        '<th style="width:62px">ALTO/ESP. (m)</th><th style="width:62px">ÁREA (m²)</th>' +
        '<th style="width:66px">VOLUMEN (m³)</th>' +
        '<th style="width:86px">PARCIAL</th></tr></thead><tbody>';
      const md = v => (Number(v) ? MOTOR.fmt(v, 2) : '');   // las medidas vacías quedan en blanco
      it.computos.forEach(c => {
        h += '<tr><td>' + esc(c.d) + '</td><td class="n">' + MOTOR.fmt(c.n || 0, 2) + '</td><td class="n">' +
          md(c.l) + '</td><td class="n">' + md(c.a) + '</td><td class="n">' + md(c.h) + '</td><td class="n">' +
          md(c.ar) + '</td><td class="n">' + md(c.vo) + '</td><td class="n">' +
          MOTOR.fmt(MOTOR.parcialComputo(c), 3) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><td colspan="7" class="n">TOTAL ' + esc(it.und) + '</td><td class="n">' +
        MOTOR.fmt(MOTOR.totalComputos(it), 3) + '</td></tr></tfoot></table>';
    }));
    if (!hay) return alert('Todavía no se cargaron cómputos métricos en ningún ítem.');
    abrir('Cómputos métricos', h);
  }

  /* ---------------- RESUMEN POR MÓDULOS ---------------- */
  function resumen() {
    const P = MOTOR.proyecto();
    /* los mismos subtotales y total que el B-1 (MOTOR.totalGeneral) */
    const tot = MOTOR.totalGeneral();
    let h = encabezado('RESUMEN DEL PRESUPUESTO POR MÓDULOS');
    h += '<table><thead><tr><th style="width:40px">N°</th><th>MÓDULO</th><th style="width:60px">ÍTEMS</th>' +
      '<th style="width:120px">MONTO (' + P.moneda + ')</th><th style="width:70px">%</th></tr></thead><tbody>';
    P.modulos.forEach((m, k) => {
      const t = MOTOR.subtotalGeneral(m);
      h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(m.n) + '</td><td class="c">' + m.items.length +
        '</td><td class="n">' + f(t) + '</td><td class="n">' + (tot ? (t / tot * 100).toFixed(2) : '0.00') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr class="tot"><td colspan="3" class="n">TOTAL</td><td class="n">' + f(tot) +
      '</td><td class="n">100.00</td></tr></tfoot></table>';
    h += firmas();
    abrir('Resumen por módulos', h);
  }

  /* ---------------- CRONOGRAMA Y CURVA S ---------------- */
  function crono() {
    const P = MOTOR.proyecto();
    const S = MOTOR.curvaS();
    const tot = MOTOR.totalProyecto();
    let h = encabezado('CRONOGRAMA DE EJECUCIÓN Y CURVA "S"');
    h += '<h2>CRONOGRAMA DE ACTIVIDADES</h2>';
    h += '<table><thead><tr><th style="width:26px">N°</th><th style="width:34px">EDT</th><th>ACTIVIDAD</th>' +
      '<th style="width:70px">MONTO</th><th style="width:40px">DÍAS</th>' +
      '<th style="width:62px">COMIENZO</th><th style="width:62px">FIN</th>' +
      '<th style="width:56px">PREDEC.</th><th>BARRA</th></tr></thead><tbody>';
    const barra = (ini, dias) => {
      const izq = ((Number(ini) || 0) / (P.plazo || 1) * 100).toFixed(1);
      const anc = Math.max(0.6, (Number(dias) || 0) / (P.plazo || 1) * 100).toFixed(1);
      return '<td style="padding:0"><div style="position:relative;height:12px"><div style="position:absolute;left:' +
        izq + '%;width:' + anc + '%;height:10px;top:1px;background:#1a4b8c"></div></div></td>';
    };
    MOTOR.estructuraCrono().forEach(mod => {
      const fm = MOTOR.fechasDe(mod.inicio, mod.dias);
      h += '<tr style="background:#e8e5de;font-weight:bold"><td></td><td class="c">' + mod.edt + '</td><td>' +
        esc(mod.m.n) + '</td><td class="n">' + f(MOTOR.totalModulo(mod.m)) + '</td><td class="c">' +
        (mod.hijas.length ? mod.dias : '—') + '</td><td class="c">' +
        (mod.hijas.length ? MOTOR.fmtFecha(fm.ini) : '—') + '</td><td class="c">' +
        (mod.hijas.length ? MOTOR.fmtFecha(fm.fin) : '—') + '</td><td></td>' +
        barra(mod.inicio, mod.dias) + '</tr>';
      mod.hijas.forEach(a => {
        const it = a.it, fa = MOTOR.fechasDe(it.inicio, it.dias);
        h += '<tr><td class="c">' + a.n + '</td><td class="c">' + a.edt + '</td><td>' + esc(it.desc) +
          '</td><td class="n">' + f(MOTOR.analisis(it).total) + '</td><td class="c">' +
          Math.max(1, Number(it.dias) || 1) + '</td><td class="c">' + MOTOR.fmtFecha(fa.ini) +
          '</td><td class="c">' + MOTOR.fmtFecha(fa.fin) + '</td><td class="c">' + esc(it.pred || '') + '</td>' +
          barra(it.inicio, it.dias) + '</tr>';
      });
    });
    h += '</tbody></table>';
    h += '<p style="font-size:10px">Inicio de obra: <b>' + MOTOR.fmtFecha(MOTOR.fechaDia(0)) +
      '</b> · plazo <b>' + P.plazo + '</b> días calendario · fin <b>' +
      MOTOR.fmtFecha(MOTOR.fechasDe(0, P.plazo).fin) + '</b>. Duraciones estimadas con la mano de obra de cada análisis: jornada de ' +
      P.crono.jornada + ' h, ' + P.crono.cuadrillas + ' cuadrilla(s), ' + P.crono.diasSemana + ' días por semana.</p>';

    h += '<h2>AVANCE PROGRAMADO POR PERÍODO (MENSUAL)</h2>';
    h += '<table><thead><tr><th>PERÍODO</th>' + S.map(x => '<th>' + x.i + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td>Monto del período</td>' + S.map(x => '<td class="n">' + f(x.monto) + '</td>').join('') + '</tr>' +
      '<tr><td>Acumulado</td>' + S.map(x => '<td class="n">' + f(x.acum) + '</td>').join('') + '</tr>' +
      '<tr><td>% acumulado</td>' + S.map(x => '<td class="n">' + x.pct.toFixed(2) + '</td>').join('') + '</tr>' +
      '</tbody></table>';
    h += '<h2>CURVA "S"</h2>' + svgCurvaS(S);
    h += '<p style="font-size:10px"><b>Monto total programado:</b> ' + f(tot) + ' ' + P.moneda + '</p>';
    abrir('Cronograma y curva S', h);
  }

  function svgCurvaS(S) {
    const W = 700, H = 300, mx = 46, my = 26;
    const n = S.length;
    const px = i => mx + (W - mx - 14) * (n > 1 ? i / (n - 1) : 0.5);
    const py = p => H - my - (H - my - 18) * (p / 100);
    let pts = S.map((x, i) => px(i).toFixed(1) + ',' + py(x.pct).toFixed(1)).join(' ');
    let g = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    g += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fff" stroke="#bbb"/>';
    for (let p = 0; p <= 100; p += 20) {
      g += '<line x1="' + mx + '" y1="' + py(p) + '" x2="' + (W - 14) + '" y2="' + py(p) +
        '" stroke="#e2e2e2"/><text x="6" y="' + (py(p) + 4) + '" font-size="10" fill="#666">' + p + '%</text>';
    }
    S.forEach((x, i) => {
      g += '<text x="' + px(i) + '" y="' + (H - 8) + '" font-size="10" fill="#666" text-anchor="middle">' + x.i + '</text>';
      g += '<rect x="' + (px(i) - 9) + '" y="' + py(x.monto / (S[n - 1].acum || 1) * 100) + '" width="18" height="' +
        Math.max(0, H - my - py(x.monto / (S[n - 1].acum || 1) * 100)) + '" fill="#dce6f4"/>';
    });
    g += '<polyline points="' + pts + '" fill="none" stroke="#c00000" stroke-width="2.4"/>';
    S.forEach((x, i) => {
      g += '<circle cx="' + px(i) + '" cy="' + py(x.pct) + '" r="3" fill="#c00000"/>';
      g += '<text x="' + px(i) + '" y="' + (py(x.pct) - 8) + '" font-size="9" fill="#c00000" text-anchor="middle">' +
        x.pct.toFixed(1) + '</text>';
    });
    g += '<line x1="' + mx + '" y1="' + (H - my) + '" x2="' + (W - 14) + '" y2="' + (H - my) + '" stroke="#333"/>';
    g += '<line x1="' + mx + '" y1="18" x2="' + mx + '" y2="' + (H - my) + '" stroke="#333"/>';
    g += '</svg>';
    return g;
  }

  /* ---------------- EXPORTACIONES ---------------- */
  function descargar(nombre, contenido, mime) {
    const blob = new Blob([contenido], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* =====================================================================
     EXPORTACIÓN A EXCEL (.xlsx real, una hoja por reporte)
     ===================================================================== */
  const EST = XLSX.EST;
  const T = XLSX.T, N = XLSX.N;
  const xn = (v, s) => N(MOTOR.conv(v), s);
  const cel = (v, s, m) => ({ v, t: 's', s: s === undefined ? EST.texto : s, m: m || 1 });
  const num = (v, s, m) => ({ v: Number(v) || 0, t: 'n', s: s === undefined ? EST.num : s, m: m || 1 });

  /** Hoja nueva con la cabecera del proyecto. */
  function nuevaHoja(nombre, titulo, anchos) {
    const P = MOTOR.proyecto(), nc = anchos.length;
    const h = new XLSX.Hoja(nombre, anchos);
    h.fila([cel(titulo, EST.titulo, nc)]);
    const d = (a, b) => h.fila([cel(a, EST.etiqueta), cel(b, EST.normal, Math.max(1, nc - 1))]);
    d('Proyecto:', P.nombre);
    d('Cliente:', P.entidad || '—');
    d('Lugar:', P.ubicacion || '—');
    d('Fecha:', P.fecha);
    d('Tipo de cambio:', P.tc + '   ·   Moneda: ' + P.moneda);
    h.blanco();
    return h;
  }
  function encabezados(h, cols) {
    h.fila(cols.map(c => cel(c, EST.encab)));
    h.congelar = h.filas.length;
  }

  /* --- 1. Presupuesto general --- */
  function hPresupuesto() {
    const P = MOTOR.proyecto();
    const h = nuevaHoja('Presupuesto general', 'Presupuesto general', [6, 58, 8, 13, 15, 17]);
    encabezados(h, ['Nº', 'Descripción', 'Und.', 'Cantidad', 'Unitario', 'Parcial']);
    let n = 0;
    P.modulos.forEach(m => {
      if (P.modulos.length > 1) h.fila([cel(m.n, EST.grupo, 6)]);
      m.items.forEach(it => {
        const a = MOTOR.analisis(it); n++;
        h.fila([num(n, EST.ctr), cel(it.desc), cel(it.und, EST.ctr),
          num(it.cant, EST.num), xn(a.pu), xn(MOTOR.parcialGeneral(it))]);
      });
      if (P.modulos.length > 1)
        h.fila([cel('Subtotal ' + m.n, EST.subT, 5), xn(MOTOR.subtotalGeneral(m), EST.subN)]);
    });
    /* total y subtotales como PRESCOM: MOTOR.totalGeneral */
    h.fila([cel('Total presupuesto:', EST.totT, 5), xn(MOTOR.totalGeneral(), EST.totN)]);
    h.blanco();
    h.fila([cel('Son: ' + literal(MOTOR.conv(MOTOR.totalGeneral())) + ' ' +
      (P.moneda === 'Bs' ? 'bolivianos' : 'dólares americanos'), EST.nota, 6)]);
    return h;
  }

  /* --- 2. Presupuesto por módulo --- */
  function hModulos() {
    /* los mismos subtotales y total que el Presupuesto general */
    const P = MOTOR.proyecto(), tot = MOTOR.totalGeneral() || 1;
    const h = nuevaHoja('Presupuesto por módulo', 'Presupuesto por módulo', [6, 50, 10, 18, 14]);
    encabezados(h, ['Nº', 'Módulo', 'Ítems', 'Monto', 'Incidencia %']);
    P.modulos.forEach((m, k) => {
      const v = MOTOR.subtotalGeneral(m);
      h.fila([num(k + 1, EST.ctr), cel(m.n), num(m.items.length, EST.ctr), xn(v), num(v / tot * 100)]);
    });
    h.fila([cel('Total presupuesto:', EST.totT, 3), xn(MOTOR.totalGeneral(), EST.totN), num(100, EST.totN)]);
    return h;
  }

  /* --- 3. Análisis de precios unitarios --- */
  function hAnalisis() {
    const P = MOTOR.proyecto();
    const h = nuevaHoja('Análisis de precios', 'Análisis de precios unitarios', [6, 52, 8, 13, 15, 17]);
    let n = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      n++;
      const a = MOTOR.analisis(it);
      h.fila([cel('Ítem ' + n + ':  ' + it.desc, EST.grupo, 6)]);
      h.fila([cel('Unidad:', EST.etiqueta), cel(it.und, EST.normal),
        cel('Cantidad:', EST.etiqueta), num(it.cant, EST.num), cel('Módulo:', EST.etiqueta), cel(m.n, EST.normal)]);
      h.fila(['Nº', 'Insumo / Parámetro', 'Und.', 'Cant.', 'Unit.', 'Parcial'].map(c => cel(c, EST.encab)));
      const blq = (tit, arr) => {
        h.fila([cel(tit, EST.subT, 6)]);
        if (!arr.length) h.fila([cel('', EST.texto), cel('(sin insumos)', EST.texto, 5)]);
        arr.forEach((x, k) => h.fila([num(k + 1, EST.ctr), cel(x.ins.d), cel(x.ins.u, EST.ctr),
          num(x.rend, EST.num4), xn(x.pu), xn(x.parcial)]));
      };
      const par = (tit, v) => h.fila([cel(tit, EST.subT, 5), xn(v, EST.subN)]);
      if (MOTOR.formatoEsOficial()) {
        blq('1. Materiales', a.grupos.M); par('Total materiales', a.mat);
        blq('2. Mano de obra', a.grupos.O); par('Subtotal mano de obra', a.mo);
        par('Cargas sociales (' + P.params.cargas + '%)', a.cargas);
        par('IVA mano de obra (' + P.params.ivaMO + '%)', a.ivaMO);
        par('Total mano de obra', a.totalMO);
        blq('3. Equipo, maquinaria y herramientas', a.grupos.E); par('Subtotal equipo y maquinaria', a.eq);
        par('Herramientas menores (' + P.params.herr + '%)', a.herr);
        par('Total equipo, maquinaria y herramientas', a.totalEQ);
        par('Subtotal (1 + 2 + 3)', a.subtotal);
        par('4. Gastos generales y administrativos (' + P.params.gg + '%)', a.gg);
        par('5. Utilidad (' + P.params.util + '%)', a.util);
        par('Parcial', a.parcial3);
        par('6. Impuestos IT (' + P.params.it + '%)', a.it);
      } else {
        blq('1. Materiales', a.grupos.M); par('Total materiales', a.mat);
        blq('2. Mano de obra', a.grupos.O); par('Subtotal mano de obra', a.mo);
        blq('3. Equipo, maquinaria y herramientas', a.grupos.E); par('Subtotal equipo y maquinaria', a.eq);
        (a.cadena || []).filter(x => x.k !== 'ent').slice(0, -1).forEach(x => {
          par(x.i + '. ' + x.n + (x.k === 'pct' ? ' (' + x.pct + '%)' : ''), MOTOR.r2(x.valor));
        });
      }
      if (a.ajuste) par('Redondeo del archivo de origen', a.ajuste);
      h.fila([cel('PRECIO UNITARIO ADOPTADO (' + it.und + ')', EST.totT, 5), xn(a.pu, EST.totN)]);
      h.blanco();
    }));
    if (!n) h.fila([cel('El presupuesto no tiene ítems.', EST.nota, 6)]);
    return h;
  }

  /* Nombres de los tres subgrupos de insumos. El orden M · O · E y la
     ordenación A-Z dentro de cada uno es la misma en toda la aplicación. */
  const GRUPOS = [['M', '1. MATERIALES'], ['O', '2. MANO DE OBRA'],
  ['E', '3. EQUIPO, MAQUINARIA Y HERRAMIENTAS']];
  const NOMGRUPO = { M: 'Materiales', O: 'Mano de obra', E: 'Equipo y maquinaria' };

  /* --- 4. Precios elementales --- */
  function hElementales() {
    const L = MOTOR.insumosEnUso();          // igual que el B-3 impreso: sin los que no se usan
    const h = nuevaHoja('Precios elementales', 'Precios elementales de los insumos', [6, 54, 8, 16, 13, 20]);
    encabezados(h, ['Nº', 'Descripción', 'Und.', 'Precio', 'Fecha precio', 'Grupo']);
    GRUPOS.forEach(([t, tit]) => {
      const g = L.filter(x => x.t === t);
      if (!g.length) return;
      h.fila([cel(tit, EST.grupo, 6)]);
      g.forEach((x, k) => h.fila([num(k + 1, EST.ctr), cel(x.d), cel(x.u, EST.ctr),
        xn(x.p), cel(x.f || '—', EST.ctr), cel(NOMGRUPO[x.t])]));
      h.fila([cel('Subtotal ' + NOMGRUPO[t] + ':  ' + g.length + ' insumo(s)', EST.subT, 6)]);
    });
    if (!L.length) h.fila([cel('Ningún insumo del proyecto entra en un análisis.', EST.nota, 6)]);
    return h;
  }

  /* --- 5. Desglose de insumos general --- */
  function hInsumosGeneral() {
    const L = MOTOR.requerimiento();
    const h = nuevaHoja('Insumos general', 'Desglose de insumos — requerimiento total de la obra',
      [54, 8, 15, 14, 17, 20, 11]);
    encabezados(h, ['Descripción insumos', 'Und.', 'Cant.', 'Unit.', 'Parcial', 'Grupo', '% obra']);
    let s = 0;
    const tot = L.reduce((a, x) => a + x.monto, 0) || 1;
    GRUPOS.forEach(([t, tit]) => {
      const g = L.filter(x => x.ins.t === t);
      if (!g.length) return;
      h.fila([cel(tit, EST.grupo, 7)]);
      let st = 0;
      g.forEach(x => {
        s += x.monto; st += x.monto;
        h.fila([cel(x.ins.d), cel(x.ins.u, EST.ctr), num(x.cant, EST.num4), xn(x.ins.p),
          xn(x.monto), cel(NOMGRUPO[x.ins.t]), num(x.monto / tot * 100)]);
      });
      h.fila([cel('Subtotal ' + NOMGRUPO[t], EST.subT, 4), xn(st, EST.subN),
        cel('', EST.subT), num(st / tot * 100, EST.subN)]);
    });
    h.fila([cel('Total:', EST.totT, 4), xn(s, EST.totN), cel('', EST.totT), num(100, EST.totN)]);
    return h;
  }

  /* --- 6. Desglose de insumos por ítem ---
     Cada ítem lleva sus insumos separados en tres subgrupos resaltados
     (materiales, mano de obra, equipo), cada uno con su subtotal. */
  function hInsumosPorItem() {
    const P = MOTOR.proyecto();
    const h = nuevaHoja('Insumos por ítem', 'Desglose de insumos por ítem', [54, 8, 14, 15, 17]);
    encabezados(h, ['Ítems / Insumos', 'Und.', 'Unit.', 'Cant.', 'Parcial']);
    let g = 0, n = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      n++;
      const a = MOTOR.analisis(it), q = Number(it.cant) || 0;
      h.fila([cel(n + '. ' + it.desc + '   (' + it.und + ' × ' + it.cant + ')', EST.grupo, 5)]);
      let s = 0;
      GRUPOS.forEach(([t, tit]) => {
        const arr = a.grupos[t];
        h.fila([cel(tit, EST.subT, 5)]);
        if (!arr.length) { h.fila([cel('(sin insumos)', EST.nota, 5)]); return; }
        let st = 0;
        arr.forEach(x => {
          const c = x.rend * q, parcial = MOTOR.r2(c * x.pu);
          s += parcial; st += parcial;
          h.fila([cel(x.ins.d), cel(x.ins.u, EST.ctr), xn(x.pu), num(c, EST.num4), xn(parcial)]);
        });
        h.fila([cel('Subtotal ' + NOMGRUPO[t], EST.subT, 4), xn(st, EST.subN)]);
      });
      g += s;
      h.fila([cel('Costo directo del ítem', EST.totT, 4), xn(s, EST.totN)]);
      h.blanco();
    }));
    h.fila([cel('Total:', EST.totT, 4), xn(g, EST.totN)]);
    return h;
  }

  /* --- 7. Resumen general (parámetros) --- */
  function hResumenGeneral() {
    const P = MOTOR.proyecto();
    const FM = MOTOR.formato().filas || [];
    /* Se acumula fila por fila de la cadena, sea la oficial o una propia: cada
       ítem aporta el valor de esa fila por su cantidad. Antes estaban las seis
       incidencias escritas a mano, y con un formato propio no habría qué
       mostrar. Las filas de subtotal no se listan: son sumas de las anteriores
       y repetirlas aquí daría un total que no cierra. */
    const ac = FM.map(() => 0);
    P.modulos.forEach(m => m.items.forEach(it => {
      const a = MOTOR.analisis(it), q = Number(it.cant) || 0;
      (a.cadena || []).forEach((x, i) => { ac[i] += x.valor * q; });
    }));
    const h = nuevaHoja('Resumen general', 'Resumen general por parámetro', [50, 20, 30]);
    encabezados(h, ['Parámetro', 'Monto', 'Fórmula']);
    const f = (p, v, fo) => h.fila([cel(p), xn(v), cel(fo)]);
    const LETRA = ['A', 'B', 'C'];
    FM.forEach((x, i) => {
      if (x.k === 'sum') return;
      const formula = x.k === 'ent' ? LETRA[i] || ''
        : (x.pct + ' % × (' + (x.sobre || []).map(n => 'Nº' + n).join(' + ') + ')');
      f(x.n + (x.k === 'pct' ? ' (' + x.pct + '%)' : ''), ac[i], formula);
    });
    h.fila([cel('Total presupuesto:', EST.totT), xn(MOTOR.totalProyecto(), EST.totN), cel('', EST.totT)]);
    return h;
  }

  /* --- 8. Resumen por incidencia --- */
  function hIncidencia() {
    const P = MOTOR.proyecto(), tot = MOTOR.totalProyecto() || 1;
    const L = [];
    P.modulos.forEach(m => m.items.forEach(it => L.push({ m, it, v: MOTOR.analisis(it).total })));
    L.sort((a, b) => b.v - a.v);
    const h = nuevaHoja('Resumen por incidencia', 'Resumen por incidencia económica', [6, 52, 28, 17, 13, 14]);
    encabezados(h, ['Nº', 'Descripción ítem', 'Módulo', 'Parcial', 'Incidencia %', 'Acumulado %']);
    let ac = 0;
    L.forEach((x, k) => {
      ac += x.v / tot * 100;
      h.fila([num(k + 1, EST.ctr), cel(x.it.desc), cel(x.m.n), xn(x.v),
        num(x.v / tot * 100), num(ac)]);
    });
    h.fila([cel('Totales:', EST.totT, 3), xn(tot, EST.totN), num(100, EST.totN), cel('', EST.totT)]);
    return h;
  }

  /* --- 9. Cómputos métricos --- */
  function hComputos() {
    const P = MOTOR.proyecto();
    const h = nuevaHoja('Cómputos métricos', 'Planilla de cómputos métricos', [46, 10, 12, 12, 14, 12, 14, 15]);
    encabezados(h, ['Descripción / parte', 'Veces', 'Largo (m)', 'Ancho (m)', 'Alto / esp. (m)',
      'Área (m²)', 'Volumen (m³)', 'Parcial']);
    let n = 0, hay = false;
    P.modulos.forEach(m => m.items.forEach(it => {
      n++;
      if (!it.computos || !it.computos.length) return;
      hay = true;
      h.fila([cel(n + '. ' + it.desc + '   (' + it.und + ')', EST.grupo, 8)]);
      /* las medidas que el usuario dejó vacías van vacías, no en cero */
      const md = v => Number(v) ? num(v) : cel('', EST.num);
      it.computos.forEach(c => h.fila([cel(c.d), num(c.n || 0), md(c.l), md(c.a), md(c.h),
        md(c.ar), md(c.vo), num(MOTOR.parcialComputo(c), EST.num4)]));
      h.fila([cel('Total ' + it.und, EST.subT, 7), num(MOTOR.totalComputos(it), EST.subN)]);
    }));
    if (!hay) h.fila([cel('No se cargaron cómputos métricos en este proyecto.', EST.nota, 8)]);
    return h;
  }

  /* --- 10. Cronograma y curva S --- */
  function hCrono() {
    const P = MOTOR.proyecto();
    const base = P.inicioObra ? new Date(P.inicioObra + 'T00:00:00') : new Date();
    const dia = d => { const x = new Date(base); x.setDate(x.getDate() + (Number(d) || 0)); return x.toLocaleDateString('es-BO'); };
    const h = nuevaHoja('Cronograma', 'Cronograma general de ejecución', [6, 52, 17, 14, 14, 9]);
    encabezados(h, ['Nº', 'Actividad', 'Monto', 'Inicia', 'Finaliza', 'Días']);
    let n = 0;
    P.modulos.forEach(m => m.items.forEach(it => {
      n++;
      h.fila([num(n, EST.ctr), cel(it.desc), xn(MOTOR.analisis(it).total),
        cel(dia(it.inicio), EST.ctr), cel(dia((it.inicio || 0) + (it.dias || 0)), EST.ctr),
        num(it.dias || 0, EST.ctr)]);
    }));
    h.fila([cel('Plazo total:', EST.totT, 2), xn(MOTOR.totalProyecto(), EST.totN),
      cel(P.plazo + ' días calendario', EST.totT, 2), cel('', EST.totT)]);
    h.blanco();
    const S = MOTOR.curvaS();
    h.fila([cel('Curva "S" — avance programado', EST.grupo, Math.max(6, S.length + 1))]);
    h.fila([cel('Período (mes)', EST.encab)].concat(S.map(x => cel(x.i, EST.encab))));
    h.fila([cel('Monto del período', EST.etiqueta)].concat(S.map(x => xn(x.monto))));
    h.fila([cel('Acumulado', EST.etiqueta)].concat(S.map(x => xn(x.acum))));
    h.fila([cel('% acumulado', EST.etiqueta)].concat(S.map(x => num(x.pct))));
    return h;
  }

  /* =====================================================================
     COMPARACIÓN CONTRA OTRO .boq — libro aparte, dos hojas

     No entra en el libro de reportes: se arma a pedido desde HERRAMIENTAS →
     Comparar con otro proyecto, porque necesita el segundo archivo. Las dos
     hojas contestan las dos preguntas que uno se hace al revisar una versión
     contra otra: qué ítem se movió, y qué insumo lo movió.
     ===================================================================== */

  const NOM_ESTADO = {
    igual: 'sin cambio', subio: 'incremento', bajo: 'decremento',
    soloA: 'solo en este proyecto', soloB: 'solo en el archivo'
  };
  const raya = () => cel('—', EST.ctr);
  /** Porcentaje; sin base de comparación va una raya, no un cero. */
  const pc = v => (v === null || v === undefined) ? raya() : num(v);

  /** Cabecera de una hoja de comparación: los dos archivos, uno sobre otro. */
  function hojaComparar(nombre, titulo, anchos, A, B, archivo) {
    const nc = anchos.length;
    const h = new XLSX.Hoja(nombre, anchos);
    h.fila([cel(titulo, EST.titulo, nc)]);
    const d = (a, b) => h.fila([cel(a, EST.etiqueta), cel(b, EST.normal, Math.max(1, nc - 1))]);
    d('Este proyecto:', A.nombre || '—');
    d('El archivo:', (B.nombre || '—') + (archivo ? '   ·   ' + archivo : ''));
    d('Entidad:', (A.entidad || '—') + '   contra   ' + (B.entidad || '—'));
    d('Fecha:', (A.fecha || '—') + '   contra   ' + (B.fecha || '—'));
    d('Moneda:', 'Bs — los montos van en bolivianos, que es como se guardan los precios');
    h.blanco();
    return h;
  }

  /* --- comparación 1. el presupuesto, ítem contra ítem --- */
  function hComparaItems(C, A, B, archivo) {
    const h = hojaComparar('Presupuesto comparado',
      'Comparación del presupuesto — ítem contra ítem',
      [5, 26, 46, 7, 12, 13, 15, 12, 13, 15, 14, 10, 21], A, B, archivo);
    encabezados(h, ['Nº', 'Módulo', 'Ítem', 'Und.',
      'Cant. (este)', 'P.U. (este)', 'Total (este)',
      'Cant. (archivo)', 'P.U. (archivo)', 'Total (archivo)',
      'Dif. total (Bs)', 'Dif. %', 'Estado']);
    C.items.forEach(function (x, k) {
      const a = x.a, b = x.b, u = a || b;
      h.fila([
        num(k + 1, EST.ctr),
        cel(u.modulo),
        cel(u.desc + (x.undCambia ? '   [la unidad cambió: ' + a.und + ' → ' + b.und + ']' : '')),
        cel(u.und, EST.ctr),
        a ? num(a.cant) : raya(), a ? xn(a.pu) : raya(), a ? xn(a.total) : raya(),
        b ? num(b.cant) : raya(), b ? xn(b.pu) : raya(), b ? xn(b.total) : raya(),
        (a && b) ? num(x.dTot.d) : raya(),
        (a && b) ? pc(x.dTot.pct) : raya(),
        cel(NOM_ESTADO[x.estado], EST.ctr)
      ]);
    });
    if (!C.items.length) h.fila([cel('Ninguno de los dos proyectos tiene ítems.', EST.nota, 13)]);
    /* La fila de totales respeta las columnas: cada monto cae bajo su propio
       encabezado. Las cuentas de ítems van en el rótulo, no en la columna de
       cantidades, que está en unidades de obra y no se puede sumar. */
    const t = C.totales, dT = MOTOR.r2(t.totalB - t.totalA);
    h.fila([cel('TOTALES  —  este proyecto: ' + t.itemsA + ' ítem(s)   ·   el archivo: ' +
      t.itemsB + ' ítem(s)', EST.totT, 4),
      cel('', EST.totT), cel('', EST.totT), xn(t.totalA, EST.totN),
      cel('', EST.totT), cel('', EST.totT), xn(t.totalB, EST.totN),
      num(dT, EST.totN),
      t.totalA ? num(MOTOR.r2(dT / t.totalA * 100), EST.totN) : cel('', EST.totT),
      cel('', EST.totT)]);
    h.blanco();
    h.fila([cel('Los ítems se emparejan por su descripción. Los que están en un solo archivo van ' +
      'al final y sin diferencia: no hay contra qué compararlos.', EST.nota, 13)]);
    return h;
  }

  /* --- comparación 2. los insumos, insumo contra insumo --- */
  function hComparaInsumos(C, A, B, archivo) {
    const h = hojaComparar('Insumos comparados',
      'Comparación de insumos — precio, cantidad de obra y monto',
      [5, 15, 46, 7, 13, 14, 15, 13, 14, 15, 13, 10, 14, 21], A, B, archivo);
    encabezados(h, ['Nº', 'Grupo', 'Insumo', 'Und.',
      'Precio (este)', 'Cant. (este)', 'Monto (este)',
      'Precio (archivo)', 'Cant. (archivo)', 'Monto (archivo)',
      'Dif. precio', 'Dif. %', 'Dif. monto', 'Estado']);
    const NOMG = { M: 'Material', O: 'Mano de obra', E: 'Equipo' };
    C.insumos.forEach(function (x, k) {
      const a = x.a, b = x.b, u = a || b;
      h.fila([
        num(k + 1, EST.ctr),
        cel(NOMG[u.t] || u.t, EST.ctr),
        cel(u.d + (x.undCambia ? '   [la unidad cambió: ' + a.u + ' → ' + b.u + ']' : '')),
        cel(u.u, EST.ctr),
        a ? xn(a.p) : raya(), a ? num(a.cant, EST.num4) : raya(), a ? xn(a.monto) : raya(),
        b ? xn(b.p) : raya(), b ? num(b.cant, EST.num4) : raya(), b ? xn(b.monto) : raya(),
        (a && b) ? num(x.dP.d) : raya(),
        (a && b) ? pc(x.dP.pct) : raya(),
        (a && b) ? num(x.dMonto.d) : raya(),
        cel(NOM_ESTADO[x.estado], EST.ctr)
      ]);
    });
    if (!C.insumos.length)
      h.fila([cel('En ninguno de los dos proyectos hay insumos dentro de un análisis.', EST.nota, 14)]);
    const t = C.totales, dM = MOTOR.r2(t.montoB - t.montoA);
    h.fila([cel('TOTALES  —  este proyecto: ' + t.insumosA + ' insumo(s)   ·   el archivo: ' +
      t.insumosB + ' insumo(s)', EST.totT, 4),
      cel('', EST.totT), cel('', EST.totT), xn(t.montoA, EST.totN),
      cel('', EST.totT), cel('', EST.totT), xn(t.montoB, EST.totN),
      cel('', EST.totT), cel('', EST.totT), num(dM, EST.totN),
      cel('', EST.totT)]);
    h.blanco();
    h.fila([cel('«Incremento» y «decremento» miran el PRECIO del insumo. La columna «Dif. monto» ' +
      'es lo que ese cambio le cuesta o le ahorra a la obra: cruza el precio con la cantidad que ' +
      'consume el presupuesto, así que también se mueve si cambió un rendimiento o la cantidad ' +
      'de un ítem.', EST.nota, 14)]);
    h.fila([cel('Solo se listan los insumos que entran en algún análisis: los cargados sin uso no ' +
      'aportan ni cantidad ni monto.', EST.nota, 14)]);
    return h;
  }

  /**
   * Libro .xlsx con la comparación contra otro proyecto: una hoja con el
   * presupuesto ítem contra ítem y otra con los insumos, insumo contra insumo.
   * @param {Object} otro proyecto leído del .boq, SIN abrirlo ni reemplazar nada
   * @param {string} [archivo] nombre del archivo, para el encabezado
   * @returns {Object} la comparación, por si el llamador quiere mostrarla
   */
  function excelComparacion(otro, archivo) {
    const A = MOTOR.proyecto();
    const C = MOTOR.compararProyectos(A, otro);
    const datos = XLSX.libro([hComparaItems(C, A, otro, archivo),
                              hComparaInsumos(C, A, otro, archivo)]);
    descargar(nombreArchivo(A.nombre) + '_comparacion.xlsx', datos,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return C;
  }

  const HOJAS = [
    ['Presupuesto general', hPresupuesto],
    ['Presupuesto por módulo', hModulos],
    ['Análisis de precios', hAnalisis],
    ['Precios elementales', hElementales],
    ['Insumos general', hInsumosGeneral],
    ['Insumos por ítem', hInsumosPorItem],
    ['Resumen general', hResumenGeneral],
    ['Resumen por incidencia', hIncidencia],
    ['Cómputos métricos', hComputos],
    ['Cronograma', hCrono]
  ];

  /**
   * Genera un libro .xlsx real con una hoja por reporte.
   * @param {string[]} [cuales] nombres de hoja a incluir (por defecto, todas)
   */
  function excelLibro(cuales) {
    const P = MOTOR.proyecto();
    const sel = HOJAS.filter(h => !cuales || !cuales.length || cuales.indexOf(h[0]) >= 0);
    if (!sel.length) { alert('Seleccione al menos un reporte.'); return; }
    const datos = XLSX.libro(sel.map(h => h[1]()));
    descargar(nombreArchivo(P.nombre) + '.xlsx', datos,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return datos;
  }

  const excelPresupuesto = () => excelLibro();
  const nombresHojas = () => HOJAS.map(h => h[0]);

  function csvInsumos() {
    const L = MOTOR.requerimiento();
    let c = 'TIPO;DESCRIPCION;UNIDAD;CANTIDAD;PRECIO UNITARIO;FECHA PRECIO;MONTO\n';
    const nom = { M: 'MATERIAL', O: 'MANO DE OBRA', E: 'EQUIPO' };
    L.forEach(x => {
      c += [nom[x.ins.t], '"' + x.ins.d.replace(/"/g, "'") + '"', x.ins.u,
      x.cant, x.ins.p, x.ins.f || '', x.monto].join(';') + '\n';
    });
    descargar(nombreArchivo(MOTOR.proyecto().nombre) + '_insumos.csv', '﻿' + c, 'text/csv;charset=utf-8');
  }

  const nombreArchivo = s => (s || 'proyecto').replace(/[^\wáéíóúñÁÉÍÓÚÑ -]/g, '').trim().replace(/\s+/g, '_');

  /* ---------------- número a literal ---------------- */
  const UNI = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
    'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
    'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
    'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
    'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  function tres(n) {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    let s = '';
    const c = Math.floor(n / 100), resto = n % 100;
    if (c) s += CEN[c] + ' ';
    if (resto < 30) s += UNI[resto];
    else {
      const d = Math.floor(resto / 10), u = resto % 10;
      s += DEC[d] + (u ? ' Y ' + UNI[u] : '');
    }
    return s.trim();
  }
  function literal(v) {
    v = Math.abs(Number(v) || 0);
    const ent = Math.floor(v);
    const cent = Math.round((v - ent) * 100);
    if (ent === 0) return 'CERO ' + String(cent).padStart(2, '0') + '/100';
    let s = '';
    const mill = Math.floor(ent / 1e6), mil = Math.floor((ent % 1e6) / 1000), un = ent % 1000;
    if (mill) s += (mill === 1 ? 'UN MILLÓN' : tres(mill) + ' MILLONES') + ' ';
    if (mil) s += (mil === 1 ? 'MIL' : tres(mil) + ' MIL') + ' ';
    if (un) s += tres(un);
    return s.trim() + ' ' + String(cent).padStart(2, '0') + '/100';
  }

  return {
    b1, b2, b3, insumos, computos, resumen, crono,
    excelPresupuesto, excelLibro, nombresHojas, excelComparacion,
    csvInsumos, descargar, literal, esc, abrir
  };
})();
