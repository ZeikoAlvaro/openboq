/* =========================================================================
   OpenBOQ — reportes imprimibles (formularios B-1, B-2, B-3 y otros)
   ========================================================================= */
'use strict';

const REP = (() => {

  /* Presentación de los reportes: la de los impresos de PRESCOM —el formato
     que conocen quienes revisan presupuestos—. Blanco y negro, título
     centrado, cabecera del proyecto en dos columnas, tabla con un solo marco
     en el encabezado, módulos en franja gris con «>», y «Pág. N de M» al pie.
     La cabecera va en el <thead> de una tabla que envuelve todo el reporte:
     así el navegador la repite en cada hoja al imprimir. */
  const CSS = `
  <style id="tamHoja">@page{size:letter}</style>
  <style>
    @page{margin:12mm 12mm 14mm;
      @bottom-right{content:"Pág. " counter(page) " de " counter(pages);font:9px Arial,sans-serif}}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#000;margin:0;background:#fff}
    .cred{font-size:8px;line-height:1.25;margin-bottom:6px}
    .cred b{font-size:11px}
    h1{font-size:17px;margin:4px 0 8px;text-align:center;font-weight:700}
    .datos{font-size:11px;margin:0 0 8px 0;line-height:1.45}
    .datos div{display:flex;justify-content:space-between;gap:16px}
    .datos span:last-child{text-align:right;white-space:nowrap}
    h2{font-size:11px;margin:12px 0 3px;background:#e6e6e6;padding:2px 5px;font-weight:700}
    table{border-collapse:collapse;width:100%;margin-bottom:6px}
    th{background:#fff;color:#000;border:1px solid #000;padding:2px 4px;font-size:10px;font-weight:700}
    td{border:0;padding:1px 4px;font-size:10px;vertical-align:top}
    td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    td.c{text-align:center}
    tr.g td{background:#ececec;font-weight:700}
    tr.mod td:first-child::before{content:"> "}
    tfoot td{background:#ececec;font-weight:700}
    /* el total de una tabla va UNA vez, al final: impreso, un <tfoot> se
       repite al pie de cada hoja y parecía un total a mitad de la lista */
    table:not(.marco)>tfoot{display:table-row-group}
    .tot td,.tot{background:#ececec;color:#000;font-weight:700}
    .apu{page-break-inside:avoid;margin-bottom:14px;border-top:1px solid #000;padding-top:4px}
    .apu h3{font-size:11px;margin:0 0 4px}
    .b2{border-top:0;padding-top:0}
    .b2+.b2{page-break-before:always;break-before:page}
    .itemcab{display:flex;justify-content:space-between;gap:12px;font-size:11px;margin:2px 0 6px}
    .apuT td{padding:1px 4px}
    .apuT td.frm{font-size:8.5px}
    .son{font-size:10.5px;margin:6px 0 0}
    h2.salto{page-break-before:always;break-before:page}
    .nota{font-size:9px;color:#333;margin:6px 0}
    .fuera{color:#a1281c;font-weight:700}
    .pie{margin-top:12px;font-size:8.5px;color:#555;text-align:left}
    .firmas{margin-top:34px;display:flex;justify-content:space-around;font-size:10px;text-align:center;page-break-inside:avoid}
    .firmas div{border-top:1px solid #000;padding-top:3px;width:200px}
    svg{width:100%;height:300px}
    table.marco{margin:0}
    table.marco>thead>tr>td,table.marco>tbody>tr>td,table.marco>tfoot>tr>td{padding:0;border:0;background:none;font-weight:400}
    /* pantalla: hoja sobre fondo gris y barra de herramientas */
    @media screen{
      body{background:#8a8f96;padding:52px 0 24px}
      .barra{position:fixed;top:0;left:0;right:0;height:42px;display:flex;align-items:center;gap:10px;padding:0 14px;
        background:#2b2f36;color:#fff;font:13px Arial,sans-serif;z-index:5;box-shadow:0 1px 4px rgba(0,0,0,.4)}
      .barra .esp{flex:1}
      .barra button,.barra select{font:13px Arial,sans-serif;padding:5px 12px;border-radius:3px;border:1px solid #666;
        background:#40464f;color:#fff;cursor:pointer}
      .barra button.pri{background:#1a4b8c;border-color:#1a4b8c}
      .aviso-pdf{position:fixed;top:48px;right:14px;max-width:340px;background:#fff8e1;color:#222;border:1px solid #e0c060;
        border-radius:4px;padding:8px 10px;font:12px Arial,sans-serif;z-index:6;box-shadow:0 2px 8px rgba(0,0,0,.3)}
      .papel{background:#fff;width:216mm;min-height:279mm;margin:0 auto;padding:12mm;box-shadow:0 2px 12px rgba(0,0,0,.45)}
      .papel[data-hoja="A4"]{width:210mm;min-height:297mm}
      .papel[data-hoja="legal"]{min-height:330mm}
    }
    @media print{ .barra,.aviso-pdf{display:none} }
  </style>`;

  /* la cabecera del reporte que se está armando (la pone `encabezado`) */
  let CAB = null;

  /* ---------------- encabezado propio ----------------
     El bloque de arriba a la izquierda (en PRESCOM, el de ROMSOFT): cada
     persona pone el suyo —empresa o profesional, matrícula, teléfono,
     ciudad—. Es de quien imprime, no del proyecto: se guarda en este
     navegador y vale para todos los reportes. La primera línea va en negrita. */
  const CLAVE_MEMBRETE = 'openboq_membrete';
  const SALTO = String.fromCharCode(10);
  const MEMBRETE_DEF = ['OpenBOQ', 'Presupuestos de obra · software libre', 'openboq.pages.dev'].join(SALTO);
  function membrete(nuevo) {
    try {
      if (nuevo !== undefined) {
        const t = String(nuevo).split(SALTO).map(x => x.trim()).filter(Boolean).slice(0, 6).join(SALTO);
        if (t && t !== MEMBRETE_DEF) localStorage.setItem(CLAVE_MEMBRETE, t); else localStorage.removeItem(CLAVE_MEMBRETE);
      }
      return localStorage.getItem(CLAVE_MEMBRETE) || MEMBRETE_DEF;
    } catch (e) { return MEMBRETE_DEF; }
  }
  const membreteHTML = () => membrete().split(SALTO).map((l, i) => i ? esc(l) : '<b>' + esc(l) + '</b>').join('<br>');

  function cabecera(titulo) {
    const P = MOTOR.proyecto();
    const lugar = P.ubicacion ? '&nbsp;&nbsp;&nbsp;Lugar: ' + esc(P.ubicacion) : '';
    return '<div class="cred">' + membreteHTML() + '</div>' +
      '<h1>' + esc(titulo) + '</h1><div class="datos">' +
      '<div><span>Proyecto: ' + esc(P.nombre) + '</span><span>Fecha: ' + fFecha(P.fecha) + '</span></div>' +
      '<div><span>Cliente: ' + esc(P.entidad || '—') + lugar + '</span><span>Tipo de cambio: ' +
      esc(P.tc) + ' · Moneda: ' + esc(P.moneda) + '</span></div></div>';
  }

  /** Abre el reporte en una ventana aparte, con su barra: imprimir o guardar
      en PDF, tamaño de hoja y cerrar. Los botones se enganchan desde acá —no
      con onclick en el HTML— porque la ventana hereda la política de
      seguridad de la aplicación, que no deja correr código escrito adentro. */
  function abrir(titulo, html) {
    const w = window.open('', '_blank');
    if (!w) { alert('El navegador bloqueó la ventana emergente. Habilite las ventanas emergentes para este archivo.'); return; }
    const cab = CAB !== null ? cabecera(CAB) : '';
    CAB = null;
    w.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' +
      esc(titulo) + '</title>' + CSS + '</head><body>' +
      '<div class="barra"><b>' + esc(titulo) + '</b><span class="esp"></span>' +
      '<label>Hoja <select id="repHoja"><option value="letter">Carta</option><option value="A4">A4</option>' +
      '<option value="legal">Oficio</option></select></label>' +
      '<button id="repMembrete">Encabezado</button>' +
      '<button id="repImprimir">Imprimir</button><button class="pri" id="repPdf">Guardar en PDF</button>' +
      '<button id="repCerrar">Cerrar</button></div>' +
      '<div class="papel" data-hoja="letter"><table class="marco"><thead><tr><td>' + cab + '</td></tr></thead>' +
      '<tbody><tr><td>' + html + '</td></tr></tbody>' +
      '<tfoot><tr><td><div class="pie">Generado con OpenBOQ · ' + new Date().toLocaleString('es-BO') +
      '</div></td></tr></tfoot></table></div></body></html>');
    w.document.close();
    const d = w.document;
    if (typeof d.getElementById !== 'function') return;
    const $d = id => d.getElementById(id);
    if ($d('repImprimir')) $d('repImprimir').addEventListener('click', () => { w.focus(); w.print(); });
    /* El navegador no deja elegir el destino desde la página: se abre el
       mismo diálogo y se avisa qué tocar. El nombre del archivo sale del
       título de la ventana. */
    if ($d('repPdf')) $d('repPdf').addEventListener('click', () => {
      if (!$d('avisoPdf')) {
        const a = d.createElement('div');
        a.id = 'avisoPdf'; a.className = 'aviso-pdf';
        a.innerHTML = 'En el cuadro de impresión, en <b>Destino</b>, elija <b>Guardar como PDF</b> y pulse <b>Guardar</b>.';
        d.body.appendChild(a);
        setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 9000);
      }
      setTimeout(() => { w.focus(); w.print(); }, 350);
    });
    if ($d('repCerrar')) $d('repCerrar').addEventListener('click', () => w.close());
    /* editar el encabezado propio sin salir del reporte */
    if ($d('repMembrete')) $d('repMembrete').addEventListener('click', () => {
      let caja = $d('cajaMembrete');
      if (caja) { caja.remove(); return; }
      caja = d.createElement('div');
      caja.id = 'cajaMembrete'; caja.className = 'aviso-pdf';
      caja.innerHTML = '<b>Encabezado de sus reportes</b><br><span style="font-size:11px">Hasta 6 líneas: empresa o ' +
        'profesional, matrícula, teléfono, ciudad. La primera va en negrita. Se guarda en este navegador.</span>' +
        '<textarea rows="5" style="width:100%;margin:6px 0;font:12px Arial"></textarea>' +
        '<div style="display:flex;gap:6px;justify-content:flex-end"><button data-m="def">Volver al de OpenBOQ</button>' +
        '<button data-m="ok" style="background:#1a4b8c;color:#fff;border:0;padding:4px 10px">Guardar</button></div>';
      d.body.appendChild(caja);
      const ta = caja.querySelector('textarea');
      ta.value = membrete();
      const poner = () => d.querySelectorAll('.cred').forEach(c => { c.innerHTML = membreteHTML(); });
      caja.querySelector('[data-m="ok"]').addEventListener('click', () => { membrete(ta.value); poner(); caja.remove(); });
      caja.querySelector('[data-m="def"]').addEventListener('click', () => { membrete(''); poner(); caja.remove(); });
      ta.focus();
    });
    if ($d('repHoja')) $d('repHoja').addEventListener('change', e => {
      $d('tamHoja').textContent = '@page{size:' + e.target.value + '}';
      d.querySelector('.papel').dataset.hoja = e.target.value;
    });
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

  /** Anota el título del reporte; la cabecera la arma `abrir`, dentro del
      encabezado que se repite en cada hoja. Devuelve '' para que los
      reportes sigan escribiéndose igual que antes (`let h = encabezado(…)`). */
  function encabezado(sub) {
    CAB = sub;
    return '';
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
    /* total y subtotales como el programa de origen: MOTOR.totalGeneral */
    let n = 0;
    const gran = MOTOR.totalGeneral();
    P.modulos.forEach(m => {
      if (P.modulos.length > 1) h += '<tr class="g mod"><td colspan="6">' + esc(m.n) + '</td></tr>';
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
    let h = encabezado('Formulario B-2 · Análisis de precios unitarios');
    let n = 0;
    lista.forEach(it => {
      n++;
      const a = MOTOR.analisis(it);
      /* Con el formato oficial, la hoja de PRESCOM: letras A a Q y la fórmula
         de cada fila, un análisis por hoja y sin los huecos en blanco que deja
         el original entre secciones. */
      if (MOTOR.formatoEsOficial()) { h += b2Oficial(it, a, n, P); return; }
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
        (a.cadena || []).filter(x => x.k !== 'ent').slice(0, -1).filter(x => !x.vacia).forEach(x => {
          const t = x.i + '. ' + esc(x.n).toUpperCase() + ((x.k === 'pct' || x.k === 'imp') ? ' (' + x.pct + '%)' : '');
          h += fila(x.k === 'sum' ? '<b>' + t + '</b>' : t, MOTOR.r2(x.valor));
        });
      }
      /* Renglón que solo aparece en los ítems traídos de un .ddp cuyo precio
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

  /* Un análisis con la forma del B-2 de PRESCOM (formato oficial). */
  function b2Oficial(it, a, n, P) {
    const p = P.params, f4 = v => MOTOR.fmt(MOTOR.conv(v), 4), pc = v => MOTOR.fmt(v, 2) + '% de';
    let h = '<div class="apu b2"><div class="itemcab"><span><b>Ítem ' + n + ':</b> ' + esc(it.desc) + '</span>' +
      '<span>Unidad: ' + esc(it.und) + ' · Cantidad: ' + MOTOR.fmt(it.cant, 2) + '</span></div>';
    h += '<table class="apuT"><thead><tr><th style="width:24px">Nº</th><th style="width:18px">P.</th><th>Insumo / parámetro</th>' +
      '<th style="width:44px">Und.</th><th style="width:66px">Cant.</th><th style="width:70px">Unit. (' + esc(P.moneda) + ')</th>' +
      '<th style="width:62px"></th><th style="width:84px">Parcial (' + esc(P.moneda) + ')</th></tr></thead><tbody>';
    const sec = (l, t) => { h += '<tr><td></td><td class="c">' + l + '</td><td colspan="6">' + t + '</td></tr>'; };
    const ins = arr => arr.forEach((x, k) => {
      h += '<tr><td class="c">' + (k + 1) + '</td><td class="c">-</td><td>' + esc(x.ins.d) + '</td><td class="c">' + esc(x.ins.u) +
        '</td><td class="n">' + MOTOR.fmt(x.rend, 4) + '</td><td class="n">' + MOTOR.fmt(MOTOR.conv(x.pu), 3) +
        '</td><td></td><td class="n">' + f4(x.bruto) + '</td></tr>';
    });
    const par = (l, t, pct, form, v, g) => {
      h += '<tr' + (g ? ' class="g"' : '') + '><td></td><td class="c">' + l + '</td><td>' + t + '</td><td></td><td class="n">' +
        (pct === null ? '' : pc(pct)) + '</td><td></td><td class="n frm">' + form + '</td><td class="n">' + f4(v) + '</td></tr>';
    };
    sec('A', 'MATERIALES'); ins(a.grupos.M);
    par('D', 'TOTAL MATERIALES', null, '(A) =', a.matX, 1);
    sec('B', 'MANO DE OBRA'); ins(a.grupos.O);
    par('E', 'SUBTOTAL MANO DE OBRA', null, '(B) =', a.moX, 1);
    const cad = (a.cadena || []).map(x => x.valor);
    par('F', 'CARGAS SOCIALES', p.cargas, '(E) =', cad[3]);
    par('O', 'IMPUESTOS IVA', p.ivaMO, '(E+F) =', cad[4]);
    par('G', 'TOTAL MANO DE OBRA', null, '(E+F+O) =', cad[5], 1);
    sec('C', 'EQUIPO, MAQUINARIA Y HERRAMIENTAS'); ins(a.grupos.E);
    par('H', 'HERRAMIENTAS', p.herr, '(G) =', cad[6]);
    par('I', 'TOTAL EQUIPO, MAQUINARIA Y HERRAMIENTAS', null, '(C+H) =', cad[7], 1);
    par('J', 'SUB TOTAL', null, '(D+G+I) =', cad[8], 1);
    par('L', 'GASTOS GENERALES Y ADMINISTRATIVOS', p.gg, '(J) =', cad[9]);
    par('M', 'UTILIDAD', p.util, '(J+L) =', cad[11]);
    par('N', 'PARCIAL', null, '(J+L+M) =', cad[12], 1);
    par('P', 'IMPUESTOS IT', p.it, '(N) =', cad[13]);
    if (a.ajuste) par('', 'REDONDEO DEL ARCHIVO DE ORIGEN', null, '', a.ajuste);
    h += '<tr class="tot"><td></td><td class="c">Q</td><td>TOTAL PRECIO UNITARIO</td><td colspan="3"></td><td class="n frm">(N+P) =</td>' +
      '<td class="n">' + f4(cad[14] !== undefined && !a.ajuste ? cad[14] : a.pu) + '</td></tr>' +
      '<tr class="tot"><td></td><td></td><td>PRECIO ADOPTADO:</td><td colspan="4"></td><td class="n">' + f(a.pu) + '</td></tr>';
    h += '</tbody></table><p class="son">Son: ' + literal(MOTOR.conv(a.pu)) + ' ' +
      (P.moneda === 'Bs' ? 'Bolivianos' : 'Dólares americanos') + '</p></div>';
    return h;
  }

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
    let h = encabezado('Desglose de insumos general');
    const nom = { M: 'MATERIALES', O: 'MANO DE OBRA', E: 'EQUIPO, MAQUINARIA Y HERRAMIENTAS' };
    let sec = 0;
    ['M', 'O', 'E'].forEach(t => {
      const g = L.filter(x => x.ins.t === t);
      if (!g.length) return;
      const st = g.reduce((s, x) => s + x.monto, 0);
      /* cada tipo en su hoja, como los desgloses de PRESCOM, pero con su
         subtotal y su peso en la obra (el original termina sin total) */
      h += '<h2' + (sec++ ? ' class="salto"' : '') + '>Desglose de insumos general: ' + nom[t] + '</h2><table><thead><tr><th style="width:34px">N°</th><th>INSUMO</th>' +
        '<th style="width:50px">UND.</th><th style="width:90px">CANTIDAD</th><th style="width:80px">P. UNIT.</th>' +
        '<th style="width:92px">MONTO</th><th style="width:56px">% OBRA</th></tr></thead><tbody>';
      g.forEach((x, k) => {
        h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(x.ins.d) + '</td><td class="c">' + esc(x.ins.u) +
          '</td><td class="n">' + MOTOR.fmt(x.cant, 3) + '</td><td class="n">' + f(x.p) +
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

  /* ---------------- RESUMEN GENERAL POR PARÁMETRO ----------------
     El mismo de la hoja «Resumen general» del Excel (MOTOR.resumenParametros,
     columna exacta): fila por fila de la cadena del B-2, por su cantidad. */
  function filasParametros() {
    const ex = MOTOR.resumenParametros('exacto');
    const LETRA = ['A', 'B', 'C'];
    let ent = 0;
    const sobre = x => (x.sobre || []).map((n, j) => (Number(n) < 0 ? (j ? ' − ' : '−') : (j ? ' + ' : '')) +
      'Nº' + Math.abs(Number(n))).join('');
    const filas = ex.filas.filter(x => x.k === 'ent' || x.k === 'sum' || x.parametro).map(x => ({
      i: x.i, n: x.n + (x.pct !== null ? ' (' + x.pct + '%)' : ''), sub: x.k === 'sum', monto: x.monto, inc: x.inc,
      formula: x.k === 'ent' ? LETRA[ent++] || '' : x.k === 'sum' ? 'subtotal: ' + sobre(x)
        : x.pct + ' % × (' + sobre(x) + ')' + (x.k === 'imp' ? ' ÷ (1 − impuestos sobre el precio final)' : '')
    }));
    return { ex, filas };
  }
  function parametros() {
    const P = MOTOR.proyecto();
    const { ex, filas } = filasParametros();
    const pc = v => (ex.total ? v / ex.total * 100 : 0).toFixed(2);
    let h = encabezado('Resumen general por parámetro');
    h += '<table><thead><tr><th style="width:30px">Nº</th><th>Parámetro</th><th style="width:30%">Fórmula</th>' +
      '<th style="width:110px">Monto (' + esc(P.moneda) + ')</th><th style="width:56px">Inc. %</th></tr></thead><tbody>';
    filas.forEach(x => {
      h += '<tr' + (x.sub ? ' class="g"' : '') + '><td class="c">' + x.i + '</td><td>' + esc(x.n) + '</td><td>' +
        esc(x.formula) + '</td><td class="n">' + f(x.monto) + '</td><td class="n">' + x.inc.toFixed(2) + '</td></tr>';
    });
    h += '</tbody><tfoot>' +
      '<tr><td></td><td colspan="2">Suma de los parámetros (sin subtotales)</td><td class="n">' + f(ex.suma) +
      '</td><td class="n">' + pc(ex.suma) + '</td></tr>' +
      '<tr><td></td><td>Diferencia por redondeo del precio unitario</td><td>Σ P.U. redondeado × cant. − suma de parámetros</td>' +
      '<td class="n">' + f(ex.redondeo) + '</td><td class="n">' + pc(ex.redondeo) + '</td></tr>' +
      '<tr><td></td><td colspan="2">Total presupuesto:</td><td class="n">' + f(ex.total) + '</td><td class="n">100.00</td></tr>' +
      '</tfoot></table>';
    h += firmas();
    abrir('Resumen general por parámetro', h);
  }

  /* ---------------- COSTOS DIRECTOS E INDIRECTOS ----------------
     Criterio (decisión de Alvaro, 22/10/2026, sobre el material de
     Ingeniería de Costos de la maestría, Temas 4 y 5): costo directo =
     materiales + mano de obra con sus cargas sociales + equipo, maquinaria y
     herramientas menores. Costo indirecto = gastos generales + utilidad +
     IMPUESTOS, y los impuestos son el IT y el IVA de la mano de obra. Por eso
     el costo directo es el «subtotal» del B-2 MENOS el IVA. El criterio del
     Formulario B-2 (IVA dentro de la mano de obra) se muestra como variante.

     Cada fila de la cadena del B-2 se clasifica por su NOMBRE, no por su
     posición: así sirve también con un formato de incidencias propio. Se
     suma fila × cantidad sin redondear, como la columna exacta del resumen
     por parámetro; la diferencia con el B-1 es el redondeo del P.U. */
  function claseFila(x, ent) {
    const n = MOTOR.norm ? MOTOR.norm(x.n).toLowerCase() : String(x.n).toLowerCase();
    if (x.k === 'ent') return ['mat', 'mo', 'eq'][ent] || 'otroD';
    if (x.k === 'sum' || x.vacia) return null;
    if (/gastos? generales/.test(n)) return 'gg';
    if (/utilidad/.test(n)) return 'util';
    if (/\biva\b/.test(n)) return 'iva';
    if (/impuesto|transacciones|\bi\.?\s?t\b/.test(n)) return 'it';
    if (/cargas|beneficios sociales/.test(n)) return 'cargas';
    if (/herramienta/.test(n)) return 'herr';
    return 'otroD';
  }
  const DIRECTOS = ['mat', 'mo', 'cargas', 'eq', 'herr', 'otroD'];
  const INDIRECTOS = ['gg', 'util', 'it', 'iva'];

  function desgloseCostos() {
    const P = MOTOR.proyecto();
    const cero = () => ({ mat: 0, mo: 0, cargas: 0, iva: 0, eq: 0, herr: 0, otroD: 0, gg: 0, util: 0, it: 0, b1: 0 });
    const pct = {};
    const mods = P.modulos.map(m => {
      const s = cero();
      m.items.forEach(it => {
        const a = MOTOR.analisis(it), q = Number(it.cant) || 0;
        let ent = 0;
        (a.cadena || []).forEach(x => {
          const c = claseFila(x, x.k === 'ent' ? ent++ : ent);
          if (!c) return;
          s[c] += (Number(x.valor) || 0) * q;
          if (x.pct !== null && x.pct !== undefined && x.k !== 'ent' && pct[c] === undefined) pct[c] = Number(x.pct);
        });
        s.b1 += MOTOR.parcialGeneral(it);
      });
      return { n: m.n, s };
    });
    const t = cero();
    mods.forEach(x => Object.keys(t).forEach(k => { t[k] += x.s[k]; }));
    const cd = s => DIRECTOS.reduce((v, k) => v + s[k], 0);
    const ci = s => INDIRECTOS.reduce((v, k) => v + s[k], 0);
    const total = MOTOR.totalGeneral();
    /* con ítems que conservan el P.U. de un archivo importado, la diferencia
       no es solo redondeo: incluye lo que ese precio difiere de su análisis */
    const deArchivo = MOTOR.conPuDeArchivo ? MOTOR.conPuDeArchivo().conAjuste : 0;
    const etiqueta = deArchivo ? 'Diferencia por redondeo y por ' + deArchivo + ' P.U. del archivo de origen'
      : 'Diferencia por redondeo del precio unitario';
    return { P, mods, t, cd, ci, pct, total, redondeo: MOTOR.r2(total - cd(t) - ci(t)), etiqueta };
  }

  const pctTxt = (D, k) => D.pct[k] !== undefined ? ' (' + D.pct[k] + '%)' : '';
  const porc = (v, base) => (base ? v / base * 100 : 0).toFixed(2);

  function directos() {
    const D = desgloseCostos(), { P, t } = D;
    const CD = D.cd(t);
    if (!CD) return alert('El presupuesto todavía no tiene costos.');
    const mo = s => s.mo + s.cargas, eq = s => s.eq + s.herr;
    let h = encabezado('Resumen de costos directos');
    h += '<h2>Composición del costo directo</h2>';
    h += '<table><thead><tr><th style="width:30px">Nº</th><th>Componente</th><th style="width:120px">Monto (' + esc(P.moneda) +
      ')</th><th style="width:80px">% del C.D.</th><th style="width:90px">% del presupuesto</th></tr></thead><tbody>';
    const r = (n, txt, v, g) => '<tr' + (g ? ' class="g"' : '') + '><td class="c">' + n + '</td><td>' + txt + '</td><td class="n">' +
      f(v) + '</td><td class="n">' + porc(v, CD) + '</td><td class="n">' + porc(v, D.total) + '</td></tr>';
    h += r(1, 'Materiales', t.mat);
    h += r(2, 'Mano de obra', t.mo);
    h += r(3, 'Cargas sociales' + pctTxt(D, 'cargas'), t.cargas);
    h += r(4, 'Total mano de obra (2 + 3)', mo(t), 1);
    h += r(5, 'Equipo y maquinaria', t.eq);
    h += r(6, 'Herramientas menores' + pctTxt(D, 'herr'), t.herr);
    h += r(7, 'Total equipo, maquinaria y herramientas (5 + 6)', eq(t), 1);
    if (Math.abs(t.otroD) >= 0.005) h += r(8, 'Otros costos directos del formato propio', t.otroD);
    h += '</tbody><tfoot><tr><td></td><td>COSTO DIRECTO TOTAL (1 + 4 + 7)</td><td class="n">' + f(CD) +
      '</td><td class="n">100.00</td><td class="n">' + porc(CD, D.total) + '</td></tr></tfoot></table>';

    h += '<h2>Costo directo por módulo</h2>';
    h += '<table><thead><tr><th style="width:30px">Nº</th><th>Módulo</th><th style="width:96px">Materiales</th>' +
      '<th style="width:96px">Mano de obra</th><th style="width:96px">Equipo y herram.</th><th style="width:104px">Costo directo</th>' +
      '<th style="width:56px">%</th></tr></thead><tbody>';
    D.mods.forEach((m, k) => {
      const c = D.cd(m.s);
      h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(m.n) + '</td><td class="n">' + f(m.s.mat) + '</td><td class="n">' +
        f(mo(m.s)) + '</td><td class="n">' + f(eq(m.s) + m.s.otroD) + '</td><td class="n">' + f(c) + '</td><td class="n">' +
        porc(c, CD) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td></td><td>TOTAL</td><td class="n">' + f(t.mat) + '</td><td class="n">' + f(mo(t)) +
      '</td><td class="n">' + f(eq(t) + t.otroD) + '</td><td class="n">' + f(CD) + '</td><td class="n">100.00</td></tr></tfoot></table>';
    h += '<p class="nota">Costo directo: materiales, mano de obra con sus cargas sociales, y equipo con las herramientas ' +
      'menores. El IVA de la mano de obra (' + f(t.iva) + ') es un impuesto y va en los costos indirectos. Con el criterio ' +
      'del Formulario B-2, que lo deja dentro de la mano de obra, el costo directo sería ' + f(CD + t.iva) +
      ' (el «subtotal» de los análisis).</p>';
    h += firmas();
    abrir('Resumen de costos directos', h);
  }

  /* rangos referenciales usuales en Bolivia, sobre el costo directo */
  const RANGOS = { gg: [10, 18], util: [5, 10], imp: [4, 5], total: [19, 33] };

  function indirectos() {
    const D = desgloseCostos(), { P, t } = D;
    const CD = D.cd(t), CI = D.ci(t);
    if (!CD) return alert('El presupuesto todavía no tiene costos.');
    /* gastos generales y utilidad se comparan por la TASA que aplica el
       proyecto (la utilidad va sobre C.D. + G.G.: 10 % aplicado son ~11 %
       del C.D.); los impuestos (IT + IVA) y el total, sobre el costo directo */
    const rango = (v, k) => {
      const [a, b] = RANGOS[k];
      const p = (k === 'gg' || k === 'util') && D.pct[k] !== undefined ? D.pct[k] : (CD ? v / CD * 100 : 0);
      const fuera = p < a - 1e-9 || p > b + 1e-9;
      return '<span class="' + (fuera ? 'fuera' : '') + '">' + a + ' – ' + b + ' %' + (fuera ? ' · fuera' : '') + '</span>';
    };
    let h = encabezado('Resumen de costos indirectos');
    h += '<h2>Costos indirectos del presupuesto</h2>';
    h += '<table><thead><tr><th style="width:30px">Nº</th><th>Componente</th><th style="width:120px">Monto (' + esc(P.moneda) +
      ')</th><th style="width:78px">% sobre C.D.</th><th style="width:90px">% del presupuesto</th>' +
      '<th style="width:110px">Rango referencial</th></tr></thead><tbody>';
    const r = (n, txt, v, k, g) => '<tr' + (g ? ' class="g"' : '') + '><td class="c">' + n + '</td><td>' + txt +
      '</td><td class="n">' + f(v) + '</td><td class="n">' + porc(v, CD) + '</td><td class="n">' + porc(v, D.total) +
      '</td><td class="c">' + (k ? rango(v, k) : '') + '</td></tr>';
    h += r('', 'Costo directo (base)', CD, null, 1);
    h += r(1, 'Gastos generales y administrativos' + pctTxt(D, 'gg'), t.gg, 'gg');
    h += r(2, 'Utilidad' + pctTxt(D, 'util'), t.util, 'util');
    h += r(3, 'Impuesto a las transacciones (IT)' + pctTxt(D, 'it'), t.it);
    h += r(4, 'IVA mano de obra' + pctTxt(D, 'iva'), t.iva);
    h += r(5, 'Total impuestos (3 + 4)', t.it + t.iva, 'imp', 1);
    h += '</tbody><tfoot><tr><td></td><td>TOTAL COSTOS INDIRECTOS (1 + 2 + 5)</td><td class="n">' + f(CI) + '</td><td class="n">' +
      porc(CI, CD) + '</td><td class="n">' + porc(CI, D.total) + '</td><td class="c">' + rango(CI, 'total') + '</td></tr></tfoot></table>';

    h += '<h2>Cierre con el presupuesto</h2><table><tbody>' +
      '<tr><td>Costo directo</td><td class="n" style="width:130px">' + f(CD) + '</td></tr>' +
      '<tr><td>Costos indirectos</td><td class="n">' + f(CI) + '</td></tr>' +
      '<tr><td>' + esc(D.etiqueta) + '</td><td class="n">' + f(D.redondeo) + '</td></tr>' +
      '<tr class="tot"><td>TOTAL PRESUPUESTO (B-1)</td><td class="n">' + f(D.total) + '</td></tr></tbody></table>';
    if (Math.abs(t.iva) >= 0.005)
      h += '<p class="nota"><b>Variante (criterio del Formulario B-2):</b> si el IVA de la mano de obra (' + f(t.iva) + ') se ' +
        'deja dentro de la mano de obra, el costo directo es ' + f(CD + t.iva) + ' y los indirectos suman ' + f(CI - t.iva) +
        ': ' + porc(CI - t.iva, CD + t.iva) + ' % sobre ese costo directo.</p>';

    h += '<h2>Costos indirectos por módulo</h2>';
    h += '<table><thead><tr><th style="width:30px">Nº</th><th>Módulo</th><th style="width:92px">Costo directo</th>' +
      '<th style="width:80px">Gastos gen.</th><th style="width:76px">Utilidad</th><th style="width:70px">IT</th>' +
      '<th style="width:70px">IVA M.O.</th><th style="width:88px">Indirectos</th><th style="width:54px">% s/C.D.</th></tr></thead><tbody>';
    D.mods.forEach((m, k) => {
      const c = D.cd(m.s), i = D.ci(m.s);
      h += '<tr><td class="c">' + (k + 1) + '</td><td>' + esc(m.n) + '</td><td class="n">' + f(c) + '</td><td class="n">' +
        f(m.s.gg) + '</td><td class="n">' + f(m.s.util) + '</td><td class="n">' + f(m.s.it) + '</td><td class="n">' + f(m.s.iva) +
        '</td><td class="n">' + f(i) + '</td><td class="n">' + porc(i, c) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td></td><td>TOTAL</td><td class="n">' + f(CD) + '</td><td class="n">' + f(t.gg) + '</td><td class="n">' +
      f(t.util) + '</td><td class="n">' + f(t.it) + '</td><td class="n">' + f(t.iva) + '</td><td class="n">' + f(CI) +
      '</td><td class="n">' + porc(CI, CD) + '</td></tr></tfoot></table>';
    h += '<p class="nota">Costos indirectos: gastos generales, utilidad e impuestos —el impuesto a las transacciones (IT) y el ' +
      'IVA de la mano de obra—. Rangos referenciales usuales en Bolivia: gastos generales 10–18 % y utilidad 5–10 % (tasa ' +
      'aplicada); impuestos 4–5 % y total de indirectos 19–33 %, sobre el costo directo. Son orientativos: cada proyecto ' +
      'justifica los suyos.</p>';
    h += firmas();
    abrir('Resumen de costos indirectos', h);
  }

  /* ---------------- CRONOGRAMA Y CURVA S ---------------- */
  function crono() {
    const P = MOTOR.proyecto();
    const S = MOTOR.curvaS();
    const tot = MOTOR.totalGeneral();   // el total del B-1
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
        esc(mod.m.n) + '</td><td class="n">' + f(MOTOR.subtotalGeneral(mod.m)) + '</td><td class="c">' +
        (mod.hijas.length ? mod.dias : '—') + '</td><td class="c">' +
        (mod.hijas.length ? MOTOR.fmtFecha(fm.ini) : '—') + '</td><td class="c">' +
        (mod.hijas.length ? MOTOR.fmtFecha(fm.fin) : '—') + '</td><td></td>' +
        barra(mod.inicio, mod.dias) + '</tr>';
      mod.hijas.forEach(a => {
        const it = a.it, fa = MOTOR.fechasDe(it.inicio, it.dias);
        h += '<tr><td class="c">' + a.n + '</td><td class="c">' + a.edt + '</td><td>' + esc(it.desc) +
          '</td><td class="n">' + f(MOTOR.parcialGeneral(it)) + '</td><td class="c">' +
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
    /* total y subtotales como el programa de origen: MOTOR.totalGeneral */
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
        (a.cadena || []).filter(x => x.k !== 'ent').slice(0, -1).filter(x => !x.vacia).forEach(x => {
          par(x.i + '. ' + x.n + ((x.k === 'pct' || x.k === 'imp') ? ' (' + x.pct + '%)' : ''), MOTOR.r2(x.valor));
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
        h.fila([cel(x.ins.d), cel(x.ins.u, EST.ctr), num(x.cant, EST.num4), xn(x.p),
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
          /* el parcial sale del renglón del B-2 (`bruto`, con la precisión
             del archivo si la tiene), así el costo directo del ítem es el
             mismo que en su análisis */
          const c = x.rend * q, parcial = MOTOR.r2(x.bruto * q);
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
    /* Fila por fila de la cadena, sea la oficial o una propia: cada ítem
       aporta el valor de esa fila por su cantidad (MOTOR.resumenParametros).
       Dos columnas de monto: la exacta y la del B-2 impreso (cada fila a 2
       decimales por unidad × cantidad, como la arma PRESCOM). Ninguna suma el
       total —el total sale del P.U. ya redondeado—, así que la diferencia va
       como fila propia y el resumen cierra con el B-1. Los subtotales se
       muestran para leerlo igual que el B-2, pero no entran en la suma. */
    /* Con la forma que pidió Alvaro (22/10/2026, sobre el Excel del CRECER):
       cinco columnas y las tres filas de cierre. La columna «como PRESCOM»
       sigue disponible en MOTOR.resumenParametros('impreso'). */
    const { ex, filas } = filasParametros();
    const h = nuevaHoja('Resumen general', 'Resumen general por parámetro', [6, 44, 26, 18, 10]);
    encabezados(h, ['Nº', 'Parámetro', 'Fórmula', 'Monto', 'Inc. %']);
    filas.forEach(x => h.fila([num(x.i, EST.ctr), cel(x.n, x.sub ? EST.subT : undefined), cel(x.formula),
      xn(x.monto, x.sub ? EST.subN : undefined), num(x.inc)]));
    h.fila([cel('', EST.subT), cel('Suma de los parámetros (sin subtotales)', EST.subT), cel('', EST.subT),
      xn(ex.suma, EST.subN), num(ex.total ? ex.suma / ex.total * 100 : 0, EST.subN)]);
    h.fila([cel(''), cel('Diferencia por redondeo del precio unitario'),
      cel('Σ P.U. redondeado × cant. − suma de parámetros'),
      xn(ex.redondeo), num(ex.total ? ex.redondeo / ex.total * 100 : 0)]);
    h.fila([cel('', EST.totT), cel('Total presupuesto:', EST.totT), cel('', EST.totT),
      xn(ex.total, EST.totN), num(100, EST.totN)]);
    return h;
  }

  /* --- 7b. Costos directos e indirectos (los mismos números del reporte) --- */
  function hCostosDirectos() {
    const D = desgloseCostos(), t = D.t, CD = D.cd(t) || 1;
    const h = nuevaHoja('Costos directos', 'Resumen de costos directos', [6, 46, 18, 12, 14]);
    encabezados(h, ['Nº', 'Componente', 'Monto', '% del C.D.', '% del presup.']);
    const r = (n, txt, v, s) => h.fila([n === '' ? cel('') : num(n, EST.ctr), cel(txt, s ? EST.subT : undefined),
      xn(v, s ? EST.subN : undefined), num(v / CD * 100), num(D.total ? v / D.total * 100 : 0)]);
    r(1, 'Materiales', t.mat); r(2, 'Mano de obra', t.mo); r(3, 'Cargas sociales' + pctTxt(D, 'cargas'), t.cargas);
    r(4, 'Total mano de obra', t.mo + t.cargas, 1);
    r(5, 'Equipo y maquinaria', t.eq); r(6, 'Herramientas menores' + pctTxt(D, 'herr'), t.herr);
    r(7, 'Total equipo, maquinaria y herramientas', t.eq + t.herr, 1);
    if (Math.abs(t.otroD) >= 0.005) r(8, 'Otros costos directos', t.otroD);
    h.fila([cel('', EST.totT), cel('COSTO DIRECTO TOTAL', EST.totT), xn(D.cd(t), EST.totN), num(100, EST.totN),
      num(D.total ? D.cd(t) / D.total * 100 : 0, EST.totN)]);
    h.blanco();
    h.fila([cel('Por módulo', EST.grupo, 5)]);
    h.fila(['', 'Módulo', 'Costo directo', '% del C.D.', ''].map(c => cel(c, EST.encab)));
    D.mods.forEach((m, k) => h.fila([num(k + 1, EST.ctr), cel(m.n), xn(D.cd(m.s)), num(D.cd(m.s) / CD * 100), cel('')]));
    return h;
  }
  function hCostosIndirectos() {
    const D = desgloseCostos(), t = D.t, CD = D.cd(t) || 1, CI = D.ci(t);
    const h = nuevaHoja('Costos indirectos', 'Resumen de costos indirectos', [6, 46, 18, 12, 14]);
    encabezados(h, ['Nº', 'Componente', 'Monto', '% s/C.D.', '% del presup.']);
    const r = (n, txt, v, s) => h.fila([n === '' ? cel('') : num(n, EST.ctr), cel(txt, s ? EST.subT : undefined),
      xn(v, s ? EST.subN : undefined), num(v / CD * 100), num(D.total ? v / D.total * 100 : 0)]);
    r('', 'Costo directo (base)', D.cd(t), 1);
    r(1, 'Gastos generales y administrativos' + pctTxt(D, 'gg'), t.gg);
    r(2, 'Utilidad' + pctTxt(D, 'util'), t.util);
    r(3, 'Impuesto a las transacciones (IT)' + pctTxt(D, 'it'), t.it);
    r(4, 'IVA mano de obra' + pctTxt(D, 'iva'), t.iva);
    r(5, 'Total impuestos', t.it + t.iva, 1);
    h.fila([cel('', EST.totT), cel('TOTAL COSTOS INDIRECTOS', EST.totT), xn(CI, EST.totN), num(CI / CD * 100, EST.totN),
      num(D.total ? CI / D.total * 100 : 0, EST.totN)]);
    r('', D.etiqueta, D.redondeo);
    r('', 'Total presupuesto (B-1)', D.total, 1);
    h.blanco();
    h.fila([cel('Por módulo', EST.grupo, 5)]);
    h.fila(['', 'Módulo', 'Indirectos', '% s/C.D.', ''].map(c => cel(c, EST.encab)));
    D.mods.forEach((m, k) => { const c = D.cd(m.s) || 1, i = D.ci(m.s);
      h.fila([num(k + 1, EST.ctr), cel(m.n), xn(i), num(i / c * 100), cel('')]); });
    return h;
  }

  /* --- 8. Resumen por incidencia --- */
  function hIncidencia() {
    /* los parciales y el total del B-1 (MOTOR.totalGeneral): el mismo número
       que el presupuesto impreso, también en un proyecto importado */
    const P = MOTOR.proyecto(), tot = MOTOR.totalGeneral() || 1;
    const L = [];
    P.modulos.forEach(m => m.items.forEach(it => L.push({ m, it, v: MOTOR.parcialGeneral(it) })));
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
      /* el último día INCLUIDO, igual que el cronograma en pantalla y en el
         HTML (MOTOR.fechasDe); antes acá salía un día más tarde */
      const dur = Math.max(1, Number(it.dias) || 1);
      h.fila([num(n, EST.ctr), cel(it.desc), xn(MOTOR.parcialGeneral(it)),
        cel(dia(it.inicio), EST.ctr), cel(dia((Number(it.inicio) || 0) + dur - 1), EST.ctr),
        num(dur, EST.ctr)]);
    }));
    h.fila([cel('Plazo total:', EST.totT, 2), xn(MOTOR.totalGeneral(), EST.totN),
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
    ['Costos directos', hCostosDirectos],
    ['Costos indirectos', hCostosIndirectos],
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
      x.cant, x.p, x.ins.f || '', x.monto].join(';') + '\n';
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
    b1, b2, b3, insumos, computos, resumen, crono, parametros, directos, indirectos,
    excelPresupuesto, excelLibro, nombresHojas, excelComparacion,
    csvInsumos, descargar, literal, esc, abrir, membrete, MEMBRETE_DEF
  };
})();
