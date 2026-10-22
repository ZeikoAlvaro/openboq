/* =========================================================================
   OpenBOQ — importar un presupuesto desde Excel
   -------------------------------------------------------------------------
   Convierte los Excel que entrega un consultor —presupuesto general (B-1),
   análisis de precios unitarios (B-2) y, si vienen, los desgloses de insumos
   (B-3)— en un proyecto de OpenBOQ, que después se guarda como .boq o se
   exporta a formato PRESCOM. Sin inteligencia artificial: lee la estructura
   de las planillas.

   LA REGLA: este módulo solo LEE. Precios unitarios, parciales y totales los
   calcula js/motor.js, igual que en cualquier proyecto. Lo que el archivo
   dice se usa para COMPARAR: si el motor no da el P.U. del archivo, manda el
   del archivo (MOTOR.fijarPuDeArchivo, como en un .ddp importado) y se avisa.

   Formatos reconocidos (se detectan solos):

   · «prescom»   el Excel que exporta PRESCOM: archivos separados, análisis
                 con «Item: … Unidad: …», secciones A/B/C y «PRECIO
                 ADOPTADO». Trampa: abierto con coma de miles, «12,0000»
                 quedó 120000 con formato «#,##0.0000». Se detecta comparando
                 cantidad × unitario = parcial con las dos lecturas.
   · «actividad» un solo libro con «PRES. GENERAL», hojas de «Actividad: …»
                 con secciones 1.- a 7.-, equipo con % productivo y precio
                 improductivo, y actividades complementarias.

   Lo que no se inventa: si un análisis no suma lo que dice su propio total
   (faltan filas), se avisa y se conserva el P.U. del archivo. No se agregan
   insumos que el archivo no trae.
   ========================================================================= */
'use strict';

const IMPORTAR_EXCEL = (() => {

  const LX = typeof LECTOR_EXCEL !== 'undefined' ? LECTOR_EXCEL
    : (typeof require === 'function' ? require('./lector_excel.js') : null);

  /* ---------------- texto y números ---------------- */
  const tx = c => (LX ? LX.texto(c) : (c ? String(c.v).trim() : ''));
  const sinTildes = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
  const clave = s => sinTildes(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  /** Código de ítem comparable: «1.1.», «1,1» y el número 1.1 (que Excel
      guarda como 1.0999999…) dan lo mismo. */
  const codigo = s => {
    if (typeof s === 'number') s = String(Math.round(s * 1e6) / 1e6);
    return String(s || '').trim().replace(/,/g, '.').replace(/\.+$/, '');
  };

  /** Número escrito como texto: «1.652,2395», «0,5000», «18373.97», «14,94%». */
  function numTexto(s) {
    s = String(s || '').trim().replace(/\s/g, '').replace(/%$/, '');
    if (!s || !/^[-+]?[\d.,]+$/.test(s)) return NaN;
    const pc = s.lastIndexOf(','), pp = s.lastIndexOf('.');
    if (pc >= 0 && pp >= 0) s = pc > pp ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (pc >= 0) s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
    return Number(s);
  }

  /** Valor numérico de una celda. `coma`: el número perdió la coma decimal
      (ver arriba) y se le devuelve según los decimales de su formato. */
  function num(c, coma) {
    if (!c) return NaN;
    if (c.t === 'n') {
      if (!coma) return c.v;
      const d = LX.decimalesFormato(c.z);
      return d ? c.v / Math.pow(10, d) : c.v;
    }
    if (c.t === 's') return numTexto(c.v);
    return NaN;
  }
  const n0 = v => (isFinite(v) ? v : 0);

  /** Parecido entre dos descripciones (0 a 1): palabras en común sobre las
      de la más larga, sin artículos ni plurales. */
  const VACIAS = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'EN', 'CON', 'PARA', 'P', 'A']);
  const palabras = s => new Set(clave(s).split(' ').filter(w => w && !VACIAS.has(w))
    .map(w => (w.length > 3 ? w.replace(/(ES|S)$/, '') : w)));
  function parecido(a, b) {
    const A = palabras(a), B = palabras(b);
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach(w => { if (B.has(w)) n++; });
    return n / Math.max(A.size, B.size);
  }

  /** Celdas de una fila como texto (para buscar etiquetas). Array.from y no
      map: la fila tiene huecos, y un hueco llega a una expresión regular como
      «undefined» —que empieza con «Und»—. */
  const textos = fila => Array.from(fila || [], tx);
  const filaTiene = (fila, re) => textos(fila).some(t => re.test(t));

  /* =====================================================================
     LIBROS
     ===================================================================== */

  /** @param {Array<{nombre:string, datos:ArrayBuffer|Uint8Array}>} archivos */
  async function leerLibros(archivos) {
    const out = [];
    for (const a of archivos) {
      const lib = await LX.leer(a.datos);
      lib.nombre = a.nombre;
      lib.hojas.forEach(h => { h.libro = a.nombre; });
      out.push(lib);
    }
    return out;
  }
  const todasLasHojas = libros => libros.flatMap(l => l.hojas);

  /** Primera celda (en las primeras filas) que cumple `re`, como texto. */
  function buscarEnHoja(h, re, maxFilas) {
    for (let r = 0; r < Math.min(h.filas.length, maxFilas || 30); r++)
      for (const c of (h.filas[r] || [])) { const t = tx(c); if (re.test(t)) return t; }
    return '';
  }

  /** Qué formato es el conjunto de libros. */
  function detectar(libros) {
    const hs = todasLasHojas(libros);
    const tiene = re => hs.some(h => h.filas.some(f => filaTiene(f, re)));
    if (tiene(/^Actividad:\s/i)) return 'actividad';
    if (tiene(/^Item:\s/i) && tiene(/^Insumo\/Par/i)) return 'prescom';
    if (hs.some(esHojaDeItem)) return 'hoja';
    if (hs.some(esHojaLetras)) return 'letras';
    return null;
  }

  /** Una hoja por análisis, como el Formulario B-2 del DBC: «Ítem: …» arriba
      y secciones «1.- MATERIALES», «2.- MANO DE OBRA», … */
  const RE_INICIO = /^(Actividad|[IÍ]tem):\s*(.*)$/i;
  function esHojaDeItem(h) {
    let item = false, sec = false;
    for (let r = 0; r < Math.min(h.filas.length, 12); r++) {
      const t0 = tx((h.filas[r] || [])[0]);
      if (RE_INICIO.test(t0)) item = true;
      if (/^1\s*\.-/.test(t0) && /MATERIAL/i.test(textos(h.filas[r]).join(' '))) sec = true;
    }
    return item && sec;
  }

  /* =====================================================================
     FORMULARIO B-1 — presupuesto general (los dos formatos)
     ===================================================================== */

  /** Busca la fila de encabezados: Descripción + Cantidad + Unitario.
      Algunos libros parten el encabezado en dos filas («PRECIO» arriba de
      «UNITARIO»): se lee cada columna juntando las dos. */
  function encabezados(h, reqs) {
    for (let r = 0; r < Math.min(h.filas.length, 40); r++) {
      const ancho = Math.max((h.filas[r] || []).length, (h.filas[r - 1] || []).length);
      const col = {}, titulos = [];
      for (let c = 0; c < ancho; c++) {
        /* la celda sola o junto con la de arriba (encabezado en dos filas);
           la de arriba sola no: puede ser el título de la hoja */
        const t1 = clave(tx((h.filas[r] || [])[c]));
        const t = clave(tx((h.filas[r - 1] || [])[c]) + ' ' + tx((h.filas[r] || [])[c]));
        titulos[c] = tx((h.filas[r] || [])[c]) || tx((h.filas[r - 1] || [])[c]);
        for (const k in reqs) if (col[k] === undefined && (reqs[k].test(t1) || reqs[k].test(t))) col[k] = c;
      }
      if (['d', 'cant', 'pu'].every(k => col[k] !== undefined)) return { fila: r, col, titulos };
    }
    return null;
  }

  const REQ_B1 = {
    cod: /^(ITEM|N|NO|NRO|COD|CODIGO)$/,
    d: /DESCRIP/, u: /^(UND|UNID|UNIDAD|UNIT)$/, cant: /CANT/,
    pu: /UNITARIO|^UNIT$/, parcial: /PARCIAL/
  };

  function esHojaB1(h) {
    const e = encabezados(h, REQ_B1);
    if (!e) return null;
    const titulo = buscarEnHoja(h, /PRESUPUESTO|Presupuesto general/i, e.fila + 1);
    return titulo ? e : null;
  }

  function leerB1(h, e, coma) {
    const { col } = e;
    /* columnas con título entre la unidad y la cantidad total (DISTRITO 1,
       TRAMO A…): son los cómputos del ítem y entran como filas de cómputo */
    const parciales = [];
    if (col.u !== undefined) for (let c = col.u + 1; c < col.cant; c++) if (e.titulos[c]) parciales.push(c);
    const modulos = [];
    let mod = null, total = NaN, totalBs = NaN, padre = '';
    const nuevoMod = n => { mod = { n, items: [] }; modulos.push(mod); };
    /* moneda del B-1: «PRECIO UNITARIO ($US)» o un título «[$US]» */
    const enDolares = /\$\s*US|\bUSD\b|\$US/i.test(e.titulos.join(' ') + ' ' + buscarEnHoja(h, /\$\s*US|USD/i, e.fila + 1));
    for (let r = e.fila + 1; r < h.filas.length; r++) {
      const f = h.filas[r] || [];
      const cc = col.cod !== undefined ? f[col.cod] : null;
      const cod = cc && cc.t === 'n' ? codigo(cc.v) : tx(cc);
      const d = tx(f[col.d]);
      const u = col.u !== undefined ? tx(f[col.u]) : '';
      const pu = num(f[col.pu], coma);
      const k = clave(d);
      /* el total del proyecto cierra la tabla: abajo suele haber otro cuadro.
         La etiqueta puede no estar en la columna de la descripción */
      const kFila = clave(textos(f).filter((x, i) => x && f[i].t === 's').join(' '));
      if (/^(COSTO TOTAL|TOTAL PRESUPUESTO|TOTAL GENERAL|PRESUPUESTO TOTAL)/.test(kFila)) {
        const vs = f.map(c => num(c, coma)).filter(isFinite);
        total = vs.length ? vs[vs.length - 1] : NaN;
        /* en dólares, la fila siguiente suele traer el total en bolivianos */
        if (enDolares) {
          const g = h.filas[r + 1] || [];
          if (/\bBS\b/.test(clave(textos(g).join(' ')))) {
            const vb = g.map(c => num(c, coma)).filter(isFinite);
            if (vb.length) totalBs = vb[vb.length - 1];
          }
        }
        break;
      }
      if (!d || /^(SUB ?TOTAL|TOTAL)\b/.test(k)) continue;
      if (u && (isFinite(pu) || isFinite(num(f[col.cant], coma)))) {
        if (!mod) nuevoMod('MÓDULO # 1');
        mod.items.push({
          cod, d, u, cant: n0(num(f[col.cant], coma)), pu: n0(pu),
          parcial: col.parcial !== undefined ? num(f[col.parcial], coma) : NaN,
          computos: parciales.map(c => ({ d: e.titulos[c], n: num(f[c], coma) })).filter(x => isFinite(x.n) && x.n !== 0)
        });
      } else if (!u && !isFinite(pu)) {
        /* título con código = módulo; sin código = subgrupo del último módulo */
        if (cod) { padre = cod + ' ' + d; nuevoMod(padre); }
        else if (mod && !mod.items.length) mod.n += ' — ' + d;
        else nuevoMod((padre ? padre + ' — ' : '') + d);
      }
    }
    return { modulos: modulos.filter(m => m.items.length), total, totalBs, enDolares };
  }

  /** Cabecera del proyecto (Proyecto:, Cliente:, Lugar:, Fecha:, Tipo de cambio / TC:). */
  function cabecera(h) {
    const cab = {};
    for (let r = 0; r < Math.min(h.filas.length, 15); r++) for (const c of (h.filas[r] || [])) {
      const t = tx(c);
      let m;
      /* nombre entre comillas, sin «Proyecto:» delante */
      if (!cab.nombre && (m = t.match(/^[“"«]\s*(.+?)\s*[”"»]$/))) cab.nombre = m[1];
      if ((m = t.match(/^PROYECTO:\s*(.+)$/i))) cab.nombre = cab.nombre || m[1].trim();
      else if ((m = t.match(/^Cliente:\s*(.+)$/i))) cab.cliente = m[1].trim();
      else if ((m = t.match(/^Lugar:\s*(.+)$/i))) cab.lugar = m[1].trim();
      else if ((m = t.match(/^Fecha:\s*(.+)$/i))) cab.fecha = m[1].trim();
      if ((m = t.match(/(?:Tipo de cambio|TC):\s*([\d.,]+)/i))) cab.tc = numTexto(m[1]);
    }
    return cab;
  }

  /* =====================================================================
     FORMULARIO B-3 — desgloses de insumos (opcionales, solo para controlar)
     ===================================================================== */
  const REQ_B3 = {
    d: /DESCRIP|ESPECIALIDAD|INSUMO/, u: /^(UND|UNID|UNIDAD)$/, cant: /CANT|HORAS/,
    pu: /UNITARIO|^UNIT$/, parcial: /PARCIAL|COSTO TOTAL|^TOTAL$/
  };
  function tipoB3(h) {
    const t = clave(h.n + ' ' + buscarEnHoja(h, /MATERIAL|MANO DE OBRA|OBRERO|EQUIPO/i, 6));
    if (/MANO DE OBRA|OBRERO/.test(t)) return 'O';
    if (/EQUIPO|MAQ/.test(t)) return 'E';
    if (/MATERIAL/.test(t)) return 'M';
    return null;
  }
  function leerB3(h, coma) {
    const t = tipoB3(h); if (!t) return null;
    const e = encabezados(h, REQ_B3); if (!e) return null;
    const out = [];
    for (let r = e.fila + 1; r < h.filas.length; r++) {
      const f = h.filas[r] || [];
      const d = tx(f[e.col.d]); const q = num(f[e.col.cant], coma), p = num(f[e.col.pu], coma);
      if (!d || !isFinite(p) || /^(SUB ?TOTAL|TOTAL)/.test(clave(d))) continue;
      out.push({ t, d, u: e.col.u !== undefined ? tx(f[e.col.u]) : '', q: n0(q), p });
    }
    return out.length ? out : null;
  }

  /* =====================================================================
     FORMULARIO B-2 — análisis por secciones («Actividad:» o «Ítem:»)
     ---------------------------------------------------------------------
     Sirve para los dos libros que arman el análisis con secciones
     numeradas: el de «Actividad: 1.1. - …» (varios análisis por hoja) y el
     de una hoja por ítem («Ítem: …», como el Formulario B-2 del DBC). La
     sección se reconoce por su TÍTULO y no por su número: en uno el 4.- es
     «actividades complementarias» y en el otro «gastos generales».
     ===================================================================== */
  const PCT_SEC = [   // el IVA primero: su etiqueta suele nombrar las cargas sociales
    [/IVA/, 'ivaMO'], [/CARGAS SOCIALES|BENEFICIOS SOCIALES/, 'cargas'], [/HERRAMIENTAS/, 'herr'],
    [/^GG\b|GASTOS GENERALES/, 'gg'], [/^UTILIDAD/, 'util'], [/^I ?T\b|IMPUESTOS? I ?T\b/, 'it']
  ];
  const tipoSeccion = t => {
    const k = clave(t);
    if (/ACTIVIDADES COMPLEMENTARIAS/.test(k)) return 'C';
    if (/^MATERIAL/.test(k)) return 'M';
    if (/^MANO DE OBRA/.test(k)) return 'O';
    if (/^EQUIPO/.test(k)) return 'E';
    return '';
  };
  /** Porcentaje escrito en una celda: 0,55 con formato % o 55 a secas. */
  const pctCelda = c => {
    const v = num(c);
    if (!isFinite(v) || v <= 0) return NaN;
    return Math.round((/%/.test(c.z || '') ? v * 100 : v) * 1e4) / 1e4;
  };

  function leerApusSecciones(h) {
    const out = [];
    let a = null, sec = '', col = { d: 1, u: 2, q: 3, pp: -1, pi: -1, p: 4, h: 5 };
    let etiquetaSuelta = '';               // etiqueta partida en dos filas (Saucarí: «IVA … de Mano» / «de Obra …»)
    for (let r = 0; r < h.filas.length; r++) {
      const f = h.filas[r] || [];
      const ts = textos(f);
      const t0 = ts[0] || '';
      let m;
      if ((m = t0.match(RE_INICIO))) {
        const s = m[2].trim();
        const p = /^Actividad/i.test(m[1]) ? s.search(/\s+-\s+/) : -1;
        a = { cod: p > 0 ? s.slice(0, p).trim() : '', d: (p > 0 ? s.slice(p).replace(/^\s+-\s+/, '') : s).trim(),
              u: '', c: [], pct: {}, decl: {}, hoja: h.n };
        out.push(a); sec = ''; etiquetaSuelta = '';
      }
      if (!a) continue;
      /* unidad: «Unitario: GLB» o «Unidad:» con el valor en la celda de al lado */
      for (let c = 0; c < ts.length; c++) {
        const mu = (ts[c] || '').match(/^(Unitario|Unidad):\s*(.*)$/i);
        if (mu && !a.u) a.u = (mu[2] || '').trim() || (ts[c + 1] || '').trim();
      }
      if (m) continue;
      if (ts.some(x => /^Descripci/i.test(x)) && ts.some(x => /^Cantidad$/i.test(x))) {
        /* encabezado: ubica las columnas (con equipo productivo, las dos
           «Productiv.» son el % y el precio productivo) */
        const iD = ts.findIndex(x => /^Descripci/i.test(x));
        const prod = ts.map((x, i) => (/^Productiv/i.test(x) ? i : -1)).filter(i => i >= 0);
        const iP = ts.findIndex(x => /^Precio/i.test(x));
        col = { d: iD, u: ts.findIndex(x => /^(Und|Unid)/i.test(x)), q: ts.findIndex(x => /^Cantidad$/i.test(x)),
                pp: prod.length > 1 ? prod[0] : -1, pi: ts.findIndex(x => /^Improd/i.test(x)),
                p: prod.length > 1 ? prod[1] : (iP >= 0 ? iP : prod[0]),
                h: ts.findIndex(x => /^(Total|Sub ?Total|Costo|Parcial)/i.test(x)) };
        continue;
      }
      if (/^\d\s*\.-/.test(t0)) { sec = tipoSeccion(ts.slice(1).join(' ')); etiquetaSuelta = ''; continue; }

      /* la descripción puede estar en la columna del título o en las de al
         lado (el título «Descripción» combina A:B y el texto va en B) */
      let d = '';
      for (let c = col.d; c < col.u; c++) if (ts[c]) d = d ? d + ' ' + ts[c] : ts[c];
      const u = f[col.u] && f[col.u].t === 's' ? ts[col.u] : '';
      const q = num(f[col.q]), p = num(f[col.p]), costo = num(f[col.h]);

      /* totales que declara el análisis: la etiqueta en cualquier celda de texto */
      const etiqueta = clave(ts.filter((x, i) => x && f[i] && f[i].t === 's').join(' '));
      if (isFinite(costo) && !u) {
        let hecho = true;
        if (/^TOTAL MATERIALES/.test(etiqueta)) a.decl.mat = costo;
        else if (/^SUBTOTAL MANO DE OBRA/.test(etiqueta)) a.decl.mo = costo;
        else if (/^TOTAL EQUIPO/.test(etiqueta)) a.decl.eqTotal = costo;
        else if (/^TOTAL ACTIVIDADES COMPL/.test(etiqueta)) a.decl.comp = costo;
        else if (/^TOTAL PRECIO UNITARIO/.test(etiqueta)) a.decl.pu = costo;   // el último manda (el «adoptado»)
        else hecho = false;
        if (hecho) { etiquetaSuelta = ''; continue; }
      }
      /* renglones de porcentaje: «2.1 CARGAS SOCIALES = %(2)», «Gastos Generales = % de 1 + 2 + 3» */
      if (d && !u) {
        let v = NaN;
        for (let c = 0; c < f.length; c++) if (c !== col.h && f[c] && f[c].t === 'n') { v = pctCelda(f[c]); if (isFinite(v)) break; }
        /* una etiqueta sin número es la primera mitad de la siguiente (las
           de TOTAL no: cierran su sección) */
        const k = clave((etiquetaSuelta + ' ' + d).replace(/^\s*[\d.]+\s*/, ''));
        if (!isFinite(v)) { etiquetaSuelta = /^(SUB ?)?TOTAL/.test(clave(d)) ? '' : d; continue; }
        etiquetaSuelta = '';
        const e = PCT_SEC.find(x => x[0].test(k));
        if (e) {
          a.pct[e[1]] = v;
          if (e[1] === 'herr' && isFinite(costo)) a.decl.herr = costo;
        }
        continue;
      }
      etiquetaSuelta = '';
      if (!d || !u || !isFinite(q) || q === 0 || !sec) continue;
      if (sec === 'M' || sec === 'C') {
        a.c.push({ t: 'M', d, u, q, p: n0(p), costo, comp: sec === 'C' });
      } else if (sec === 'O') {
        a.c.push({ t: 'O', d, u, q, p: n0(p), costo });
      } else if (sec === 'E') {
        /* equipo: costo = cantidad × (%prod × precio prod + (1 − %prod) × precio improd).
           OpenBOQ tiene un solo precio por insumo: va el efectivo y el % en el nombre */
        const pp = col.pp >= 0 ? num(f[col.pp]) : NaN, pi = col.pi >= 0 ? num(f[col.pi]) : NaN;
        let pe = n0(p), dd = d;
        if (isFinite(pp) && pp > 0 && pp < 0.99995) {
          pe = pp * n0(p) + (1 - pp) * n0(pi);
          dd = d + ' (' + (Math.round(pp * 1e4) / 100).toFixed(2) + '% PROD.)';
        }
        a.c.push({ t: 'E', d: dd, u, q, p: pe, costo, prod: isFinite(pp) ? pp : null });
      }
    }
    out.forEach(x => {
      if (isFinite(x.decl.eqTotal)) x.decl.eq = x.decl.eqTotal - n0(x.decl.herr);
      if (isFinite(x.decl.comp)) x.decl.mat = n0(x.decl.mat) + x.decl.comp;
    });
    return out;
  }

  /* =====================================================================
     FORMULARIO B-2 — secciones con letras: (A) MATERIALES … (G) TOTAL
     ---------------------------------------------------------------------
     «ITEM Nº : 1,1» + «CONCEPTO: …», la unidad en la fila de PROYECTO.
     Trae dos cosas propias: las herramientas no son un porcentaje sino un
     renglón de equipo («Desgaste de Herramientas»), y las cargas sociales y
     el IVA solo dicen su porcentaje en el texto, cuando lo dicen: se sacan
     de los montos del propio análisis.
     ===================================================================== */
  const tipoLetra = t => {
    const k = clave(t);
    if (/^MATERIAL/.test(k)) return 'M';
    if (/^MANO DE OBRA/.test(k)) return 'O';
    if (/^(HERRAMIENTAS|EQUIPO)/.test(k)) return 'E';
    return '';
  };
  function esHojaLetras(h) {
    let item = false, letra = false;
    for (let r = 0; r < Math.min(h.filas.length, 40); r++) {
      const ts = textos(h.filas[r]);
      if (ts.some(x => /^ITEM N[º°o]?\s*:/i.test(x))) item = true;
      if (ts.some(x => /^\(\s*A\s*\)$/.test(x)) && ts.some(x => /^MATERIALES/i.test(x))) letra = true;
    }
    return item && letra;
  }
  function leerApusLetras(h) {
    const out = [];
    let a = null, sec = '', unidad = '', puFila = NaN, monedaFila = '';
    for (let r = 0; r < h.filas.length; r++) {
      const f = h.filas[r] || [];
      const ts = textos(f);
      /* la fila de PROYECTO trae la unidad y el P.U.; viene antes del ITEM */
      const iU = ts.findIndex(x => /^UNIDAD\s*:/i.test(x));
      if (iU >= 0 && !RE_ITEM_N.test(ts.join(' '))) {
        unidad = (ts[iU].replace(/^UNIDAD\s*:\s*/i, '') || ts[iU + 1] || '').trim();
        const iP = ts.findIndex(x => /^P\.\s*UN/i.test(x));
        puFila = iP >= 0 ? num(f[iP + 1]) : NaN;
        monedaFila = iP >= 0 && /\$/.test(ts[iP]) ? 'USD' : 'BS';
      }
      const iI = ts.findIndex(x => RE_ITEM_N.test(x));
      if (iI >= 0) {
        a = { cod: (ts[iI].replace(RE_ITEM_N, '') || ts[iI + 1] || '').trim(), d: '', u: unidad, c: [], pct: { herr: 0 },
              decl: { puFila, monedaFila }, hoja: h.n };
        out.push(a); sec = '';
        continue;
      }
      if (!a) continue;
      const iC = ts.findIndex(x => /^CONCEPTO\s*:/i.test(x));
      if (iC >= 0 && !a.d) { a.d = (ts[iC].replace(/^CONCEPTO\s*:\s*/i, '') || ts[iC + 1] || '').trim(); continue; }
      const iL = ts.findIndex(x => /^\(\s*[A-G]\s*\)$/.test(x));
      if (iL >= 0) {
        sec = tipoLetra(ts.slice(iL + 1).join(' '));
        if (/^\(\s*G\s*\)$/.test(ts[iL]) && isFinite(num(f[6]))) a.decl.pu = num(f[6]);
        continue;
      }
      const d = ts[2], u = f[3] && f[3].t === 's' ? ts[3] : '';
      const q = num(f[4]), p = num(f[5]), costo = num(f[6]);
      const etiqueta = clave(ts.filter((x, i) => x && f[i] && f[i].t === 's').join(' '));
      if (isFinite(costo)) {
        if (/MATERIALES/.test(etiqueta) && /^(TOTAL|PRECIO PARCIAL)/.test(etiqueta)) { a.decl.mat = costo; continue; }
        if (/^(SUB TOTAL|PRECIO SUB PARCIAL) (DE )?MANO DE OBRA/.test(etiqueta)) { a.decl.mo = costo; continue; }
        if (/^CARGAS SOCIALES/.test(etiqueta)) { a.decl.cargas = costo; continue; }
        if (/^(IMP|IMPUESTOS) (\w+ )?IVA/.test(etiqueta)) { a.decl.iva = costo; continue; }
        if (/^(TOTAL|PRECIO PARCIAL) (DE )?MANO DE OBRA/.test(etiqueta)) continue;
        if (/^HERRAMIENTAS|^PRECIO PARCIAL DE HERRAMIENTAS|^TOTAL EQUIPO/.test(etiqueta)) { a.decl.eq = costo; continue; }
        if (/^TOTAL PRECIO UNITARIO/.test(etiqueta)) { a.decl.pu = costo; continue; }
      }
      if (/^(GASTOS GENERALES|UTILIDAD|IMPUESTOS IT)\b/.test(etiqueta) && f[3] && f[3].t === 'n') {
        const v = pctCelda(f[3]);
        if (isFinite(v)) a.pct[/^GASTOS/.test(etiqueta) ? 'gg' : /^UTILIDAD/.test(etiqueta) ? 'util' : 'it'] = v;
        continue;
      }
      if (!d || !u || !isFinite(q) || q === 0 || !sec) continue;
      a.c.push({ t: sec, d, u, q, p: n0(p), costo });
    }
    out.forEach(x => {
      const mo = x.decl.mo;
      if (isFinite(mo) && mo > 0 && isFinite(x.decl.cargas)) x.pct.cargas = Math.round(x.decl.cargas / mo * 1e6) / 1e4;
      if (isFinite(mo) && mo > 0 && isFinite(x.decl.iva) && isFinite(x.decl.cargas))
        x.pct.ivaMO = Math.round(x.decl.iva / (mo + x.decl.cargas) * 1e6) / 1e4;
      if (!isFinite(x.decl.pu)) x.decl.pu = x.decl.puFila;
    });
    return out;
  }
  const RE_ITEM_N = /^ITEM N[º°o]?\s*:\s*/i;

  /** Hoja de parámetros («PARAM. DE CALCULO», «VALORES»): los porcentajes
      del proyecto y el tipo de cambio, si existe. */
  function leerParamsHoja(hs) {
    const h = hs.find(x => /PARAM|VALORES/i.test(x.n));
    if (!h) return null;
    const out = {};
    h.filas.forEach(f => {
      const k = clave(tx((f || [])[0])), c = (f || [])[1];
      if (!k || !c || c.t !== 'n') return;
      if (/^TIPO DE CAMBIO/.test(k)) { out.tc = c.v; return; }
      const v = pctCelda(c);
      if (!isFinite(v)) return;
      const e = PCT_SEC.find(x => x[0].test(k.replace(/^IMPUESTOS (IVA|IT)/, '$1')));
      if (e && out[e[1]] === undefined) out[e[1]] = v;
    });
    const tc = out.tc; delete out.tc;
    return Object.keys(out).length === 6 ? { params: out, tc } : null;
  }

  /* =====================================================================
     FORMULARIO B-2 — formato «prescom» (Excel exportado por PRESCOM)
     ===================================================================== */
  const PCT_PRESCOM = [
    [/INDIRECTA|IVA/, 'ivaMO'], [/BENEFICIOS SOCIALES|CARGAS SOCIALES/, 'cargas'],
    [/HERRAMIENTAS/, 'herr'], [/GASTOS GENERALES/, 'gg'], [/^UTILIDAD/, 'util'],
    [/IMPUESTOS? A LAS TRANS|^I ?T\b/, 'it']
  ];

  function leerApusPrescom(h, coma) {
    const out = [];
    let a = null, sec = null;
    for (let r = 0; r < h.filas.length; r++) {
      const f = h.filas[r] || [];
      const ts = textos(f);
      const iItem = ts.findIndex(x => /^Item:\s*/i.test(x));
      if (iItem >= 0) {
        const uu = ts.map(x => x.match(/^Unidad:\s*(.*)$/i)).find(Boolean);
        a = { cod: '', d: ts[iItem].replace(/^Item:\s*/i, '').trim(), u: uu ? uu[1].trim() : '', c: [], pct: {}, decl: {}, hoja: h.n };
        out.push(a); sec = null; continue;
      }
      if (!a) continue;
      const letra = ts[1], k = clave(ts[2]);
      if (letra === 'A') { sec = 'M'; continue; }
      if (letra === 'B') { sec = 'O'; continue; }
      if (letra === 'C') { sec = 'E'; continue; }
      if (/^\d+$/.test(ts[0]) && letra === '-' && sec) {
        a.c.push({ t: sec, d: ts[2], u: ts[3], q: num(f[4], coma), p: num(f[5], coma), costo: num(f[6], coma) });
        continue;
      }
      const pm = (ts[4] || '').match(/^([\d.,]+)\s*%/);
      if (pm) {
        const e = PCT_PRESCOM.find(x => x[0].test(k));
        if (e) a.pct[e[1]] = numTexto(pm[1]);
        if (e && e[1] === 'herr') a.decl.herr = num(f[6], coma);
      }
      if (/^TOTAL MATERIALES/.test(k)) a.decl.mat = num(f[6], coma);
      else if (/^TOTAL HERRAMIENTAS Y EQUIPO/.test(k)) a.decl.eqTotal = num(f[6], coma);
      else if (/^TOTAL ITEM/.test(k)) { a.decl.total = num(f[6], coma); a.decl.noProd = num(f[7], coma); }
      else if (/PRECIO ADOPTADO/.test(k)) a.decl.pu = num(f[6], coma);
    }
    out.forEach(x => {
      if (isFinite(x.decl.eqTotal)) x.decl.eq = x.decl.eqTotal - n0(x.decl.herr);
      const mo = x.c.filter(c => c.t === 'O').reduce((s, c) => s + n0(c.costo), 0);
      x.decl.mo = mo;   // el formato no imprime el subtotal de M.O. sin cargas: sale de sus filas
    });
    return out;
  }

  /** Cuántas filas cumplen cantidad × unitario = parcial con cada lectura. */
  function votoComa(hojas) {
    let si = 0, no = 0;
    hojas.forEach(h => h.filas.forEach(f => {
      if (!f || !/^\d+$/.test(tx(f[0])) || tx(f[1]) !== '-') return;
      const ok = coma => {
        const q = num(f[4], coma), p = num(f[5], coma), c = num(f[6], coma);
        return isFinite(q) && isFinite(p) && isFinite(c) && Math.abs(q * p - c) <= 0.0006 * Math.max(1, Math.abs(c));
      };
      if (ok(true)) si++;
      if (ok(false)) no++;
    }));
    return si > no;
  }

  /* =====================================================================
     MODELO: lo que dicen los archivos, sin calcular nada
     ===================================================================== */
  function interpretar(libros) {
    const formato = detectar(libros);
    if (!formato) throw new Error('No se reconoce el formato de los Excel. Se necesita el presupuesto general ' +
      'y los análisis de precios unitarios (como los exporta PRESCOM, o en hojas «Actividad: …»).');
    const hs = todasLasHojas(libros);
    const avisos = [];

    let coma = false, apus = [], params = null, tcHoja;
    if (formato === 'prescom') {
      const hApu = hs.filter(h => h.filas.some(f => filaTiene(f, /^Item:\s/i)));
      coma = votoComa(hApu);
      hApu.forEach(h => { apus = apus.concat(leerApusPrescom(h, coma)); });
      if (coma) avisos.push('Los números del Excel perdieron la coma decimal (se abrió con otra configuración ' +
        'regional): se leyeron según los decimales de cada celda.');
    } else if (formato === 'letras') {
      hs.filter(esHojaLetras).forEach(h => { apus = apus.concat(leerApusLetras(h)); });
    } else {
      hs.filter(h => h.filas.some(f => RE_INICIO.test(tx((f || [])[0]))))
        .forEach(h => { apus = apus.concat(leerApusSecciones(h)); });
      const ph = leerParamsHoja(hs);
      if (ph) { params = ph.params; tcHoja = ph.tc; }
    }
    /* tipo de cambio escrito como «T.CAMBIO:» con el valor en la celda de al lado */
    if (!tcHoja) for (const h of hs) {
      for (let r = 0; r < Math.min(h.filas.length, 12) && !tcHoja; r++) {
        const f = h.filas[r] || [], ts = textos(f);
        const i = ts.findIndex(x => /^(T\.?\s*CAMBIO|TIPO DE CAMBIO|T\/C)\s*:?$/i.test(x));
        if (i >= 0 && f[i + 1] && f[i + 1].t === 'n') tcHoja = f[i + 1].v;
      }
      if (tcHoja) break;
    }

    /* B-1: la hoja que tenga título de presupuesto y columnas de ítems. Si
       hay varias (general, por distrito, media y baja tensión), la GENERAL */
    const esApu = h => h.filas.some(f => filaTiene(f, /^(Item|[IÍ]tem|Actividad):\s/i)) || esHojaLetras(h);
    const candidatas = hs.filter(h => !esApu(h))
      .map(h => ({ h, e: esHojaB1(h) })).filter(x => x.e)
      .filter(x => !tipoB3(x.h) || /PRES/i.test(x.h.n) || buscarEnHoja(x.h, /Presupuesto general/i, 5));
    const parcialHoja = x => /MEDIA|BAJA|DISTRITO|MATERIAL|M\.?O\b|RESUMEN/i.test(x.h.n);
    const elegida = candidatas.find(x => /GRAL|GENERAL/i.test(x.h.n) && !parcialHoja(x)) ||
      candidatas.find(x => /GRAL|GENERAL/i.test(buscarEnHoja(x.h, /PRESUPUESTO/i, x.e.fila + 1)) && !parcialHoja(x)) ||
      candidatas.find(x => !parcialHoja(x)) || candidatas[0];
    let b1 = null, hB1 = null;
    if (elegida) { b1 = leerB1(elegida.h, elegida.e, coma); hB1 = elegida.h; }
    if (!b1 || !b1.modulos.length) throw new Error('No se encontró el presupuesto general (B-1): una hoja con ' +
      'columnas de descripción, unidad, cantidad y precio unitario.');

    /* B-3, si viene: solo para controlar */
    const b3 = [];
    hs.forEach(h => {
      if (h === hB1 || esApu(h) || candidatas.some(x => x.h === h)) return;
      const l = leerB3(h, coma); if (l) b3.push(...l);
    });

    /* porcentajes del proyecto: la hoja de parámetros o, si no hay, los que
       más se repiten en los análisis */
    if (!params) {
      params = {};
      ['cargas', 'ivaMO', 'herr', 'gg', 'util', 'it'].forEach(k => {
        const cuenta = {};
        apus.forEach(a => { if (isFinite(a.pct[k])) cuenta[a.pct[k]] = (cuenta[a.pct[k]] || 0) + 1; });
        const mejor = Object.keys(cuenta).sort((x, y) => cuenta[y] - cuenta[x])[0];
        if (mejor !== undefined) params[k] = Number(mejor);
      });
    }

    /* cada ítem del B-1 con su análisis: por código, por descripción y
       unidad, o por orden si el archivo no deja otra */
    const libres = apus.slice();
    const porCod = new Map(), porDesc = new Map();
    apus.forEach(a => {
      if (a.cod) { const k = codigo(a.cod); if (!porCod.has(k)) porCod.set(k, []); porCod.get(k).push(a); }
      const k = clave(a.d) + '|' + clave(a.u);
      if (!porDesc.has(k)) porDesc.set(k, []); porDesc.get(k).push(a);
      const k2 = clave(a.d);
      if (!porDesc.has(k2)) porDesc.set(k2, []); porDesc.get(k2).push(a);
    });
    const tomar = lista => {
      if (!lista) return null;
      const a = lista.find(x => libres.includes(x));
      if (a) libres.splice(libres.indexOf(a), 1);
      return a || null;
    };
    const items = b1.modulos.flatMap(m => m.items);
    const sinPareja = [];
    /* el código solo, no alcanza: Excel guarda 1.10 como 1.1 y dos ítems
       pueden quedar con el mismo. Primero código y descripción juntos */
    items.forEach(it => {
      const k = clave(it.d);
      it.apu = (it.cod && tomar((porCod.get(codigo(it.cod)) || []).filter(a => clave(a.d) === k))) ||
        tomar(porDesc.get(k + '|' + clave(it.u))) || tomar(porDesc.get(k));
    });
    items.forEach(it => {
      if (!it.apu && it.cod) it.apu = tomar(porCod.get(codigo(it.cod)));
    });
    /* por parecido: «PLANTADO DE POSTE DE CONCRETO … 11 m.» y «Plantado de
       Postes de Concreto … 11 m» son el mismo. Palabras en común sobre el
       total, sin plurales ni artículos; misma unidad y 70 % o más. */
    const porParecido = [];
    items.forEach(it => {
      if (it.apu) return;
      let mejor = null, max = 0;
      libres.forEach(a => {
        if (clave(a.u) && clave(it.u) && clave(a.u).replace(/S$/, '') !== clave(it.u).replace(/S$/, '')) return;
        const s = parecido(it.d, a.d);
        if (s > max) { max = s; mejor = a; }
      });
      if (mejor && max >= 0.7) { it.apu = tomar([mejor]); porParecido.push(`«${it.d}» con «${mejor.d}»`); }
    });
    if (porParecido.length) avisos.push(porParecido.length + ' ítem(s) se emparejaron con su análisis por parecido ' +
      'de la descripción: ' + porParecido.join('; ') + '.');
    items.forEach(it => { if (!it.apu) sinPareja.push(it); });
    /* lo que quedó: por orden, si las cantidades cierran */
    if (sinPareja.length && sinPareja.length === libres.length) {
      sinPareja.forEach((it, i) => { it.apu = libres[i]; it.porOrden = true; });
      avisos.push(sinPareja.length + ' ítem(s) se emparejaron con su análisis por orden, porque las descripciones no ' +
        'coinciden: ' + sinPareja.map(it => `«${it.d}» con «${it.apu.d}»`).join('; ') + '. Conviene revisarlos.');
    } else if (sinPareja.length) {
      avisos.push(sinPareja.length + ' ítem(s) del presupuesto no tienen análisis en los archivos: entran con el ' +
        'precio unitario del archivo y sin composición.');
    }

    const cab = Object.assign({ tc: tcHoja }, cabecera(hB1), { hojaB1: hB1.n, libroB1: hB1.libro });
    let totalArchivo = b1.total;

    /* Presupuesto en dólares: OpenBOQ lleva el proyecto en bolivianos —como
       el B-1 que se presenta y como lo espera el formato PRESCOM—, así que
       todos los precios pasan a Bs con el tipo de cambio del archivo. */
    if (b1.enDolares) {
      const tc = isFinite(cab.tc) && cab.tc > 0 ? cab.tc : 6.96;
      const x = v => (isFinite(v) ? v * tc : v);
      items.forEach(it => { it.pu = x(it.pu); it.parcial = x(it.parcial); });
      apus.forEach(a => {
        a.c.forEach(c => { c.p = x(c.p); c.costo = x(c.costo); });
        Object.keys(a.decl).forEach(k => { if (typeof a.decl[k] === 'number') a.decl[k] = x(a.decl[k]); });
      });
      totalArchivo = isFinite(b1.totalBs) ? b1.totalBs : x(b1.total);
      avisos.push('El presupuesto del archivo está en dólares: precios y totales se pasaron a bolivianos con el ' +
        'tipo de cambio del archivo (' + tc + ').');
    }

    return {
      formato, coma, cab, enDolares: !!b1.enDolares,
      params, modulos: b1.modulos, totalArchivo, apus, b3, avisos,
      sobrantes: libres.filter(a => !items.some(i => i.apu === a)).length
    };
  }

  /* =====================================================================
     PROYECTO: el motor arma y calcula
     ===================================================================== */
  function construir(M, mod, archivo) {
    const cab = mod.cab;
    const P = M.proyectoNuevo(cab.nombre || 'Proyecto importado de Excel');
    P.entidad = cab.cliente || '';
    P.ubicacion = cab.lugar || '';
    if (isFinite(cab.tc) && cab.tc > 0) P.tc = cab.tc;
    Object.keys(mod.params || {}).forEach(k => { if (isFinite(mod.params[k])) P.params[k] = mod.params[k]; });
    P.modulos = [];
    const avisos = mod.avisos.slice();
    const incoherentes = [], conPct = [], deArchivo = [], sinApu = [];
    let nComp = 0, nEqProd = 0;
    const origen = 'Excel · ' + (archivo || cab.libroB1 || '');

    mod.modulos.forEach((m, k) => {
      P.modulos.push({ id: M.nid(), n: m.n, items: [] });
      P.moduloActivo = k;
      m.items.forEach(x => {
        const a = x.apu;
        const comp = a ? a.c.map(c => ({ t: c.t, d: c.d, u: c.u, p: c.p, q: c.q })) : [];
        const it = M.importarApuEditado({ cod: x.cod, d: x.d, u: x.u, cant: x.cant, c: comp });
        it.cant = x.cant;                         // 0 es una cantidad válida (ítem sin metrado)
        it.origen = origen;
        if (x.computos && x.computos.length)
          it.computos = x.computos.map(c => ({ d: c.d, n: c.n, l: '', a: '', h: '', ar: '', vo: '' }));
        if (!a) sinApu.push(x.d);
        if (a) {
          nComp += a.c.filter(c => c.comp).length;
          nEqProd += a.c.filter(c => c.t === 'E' && c.prod !== null && c.prod !== undefined && c.prod < 0.99995).length;
          /* ¿el análisis suma lo que dice su propio total? (crudo contra crudo) */
          const an = M.analisis(it);
          const dec = a.decl;
          const dif = (v, d) => (isFinite(d) ? v - d : 0);
          const dm = dif(an.matX, dec.mat), dob = dif(an.moX, dec.mo), de = dif(an.eqX, dec.eq);
          /* medio centavo por grupo: lo que se pierde cuando la planilla
             redondea sus subtotales (la misma tolerancia que con un .ddp) */
          if (Math.abs(dm) > 0.0051 || Math.abs(dob) > 0.0051 || Math.abs(de) > 0.0051) {
            /* la causa más común: un renglón con cantidad y precio y la celda
               del costo vacía, que la planilla no suma */
            const sinCosto = a.c.filter(c => !isFinite(c.costo) && c.q * c.p > 0).map(c => c.d);
            incoherentes.push({ desc: x.d, cod: x.cod, falta: { m: -dm, o: -dob, e: -de }, sinCosto });
          }
          /* porcentajes propios del análisis distintos a los del proyecto */
          const otros = Object.keys(a.pct).filter(k2 => isFinite(P.params[k2]) && Math.abs(a.pct[k2] - P.params[k2]) > 1e-6);
          if (otros.length) conPct.push({ desc: x.d, cod: x.cod, pct: otros.map(k2 => k2 + ' ' + a.pct[k2] + '%').join(', ') });
          if (isFinite(dec.noProd) && dec.noProd > 0) avisos.push(`«${x.d}»: tiene ${dec.noProd} de «No productivo» que no se trae.`);
        }
        it._puOrigen = M.r2(x.pu);
      });
    });
    P.moduloActivo = 0;
    P.itemSel = null;

    /* Cómo redondeaba la planilla: hay libros que calculan en crudo y otros
       que redondean cada renglón y cada fila del B-2 a 2 decimales (ROUND en
       cada celda). Se prueba con la misma maquinaria del .ddp
       (MOTOR.elegirReceta) y se queda la que reproduce más precios. Va antes
       de fijar los P.U.: la huella del análisis depende de la receta. */
    const precisiones = [null, [6, 2, 6, 2]];
    let mejorCalc = null;
    precisiones.forEach(q => {
      P.calcOrigen = { pct32: false, precision: q };
      const r = M.elegirReceta();
      if (!mejorCalc || r.despues > mejorCalc.r.despues) mejorCalc = { q, r, receta: P.calcOrigen.receta };
    });
    P.calcOrigen = { pct32: false, precision: mejorCalc.q };
    if (mejorCalc.receta) P.calcOrigen.receta = mejorCalc.receta;
    if (!mejorCalc.q && !mejorCalc.receta) delete P.calcOrigen;
    else avisos.push('La planilla redondea cada renglón y cada fila del análisis a 2 decimales: OpenBOQ calcula igual ' +
      '(' + mejorCalc.r.antes + ' → ' + mejorCalc.r.despues + ' de ' + mejorCalc.r.items + ' precios reproducidos).');

    /* el P.U. del archivo manda mientras no se edite el análisis */
    const monedaCruzada = [];
    P.modulos.forEach(m => m.items.forEach(it => {
      M.fijarPuDeArchivo(it, it._puOrigen);
      const calc = M.r2(M.analisis(it).puCalculado);
      if (calc === it._puOrigen) return;
      deArchivo.push({ desc: it.desc, cod: it.cod, archivo: it._puOrigen, calculado: calc });
      /* el B-1 dice tipo de cambio veces lo que da el análisis: el precio en
         bolivianos se copió en la columna de dólares (o al revés) */
      if (calc > 0 && mod.enDolares && Math.abs(it._puOrigen / calc - P.tc) < 0.001 * P.tc)
        monedaCruzada.push({ desc: it.desc, cod: it.cod, archivo: it._puOrigen, calculado: calc, cant: it.cant,
          exceso: M.r2((it._puOrigen - calc) * (Number(it.cant) || 0)) });
    }));
    monedaCruzada.forEach(x => avisos.unshift(`Ítem ${x.cod} «${x.desc}»: el presupuesto lleva ${x.archivo} Bs y su ` +
      `análisis da ${x.calculado} Bs — exactamente ${P.tc} veces más. El B-1 copió el precio en bolivianos en la ` +
      `columna de dólares. Con ${x.cant} unidad(es) el ítem queda ${x.exceso} Bs por encima de su análisis. ` +
      `Se conserva el precio del archivo; corregirlo es decisión del evaluador.`));

    /* cómo redondea el B-1 del archivo los parciales: al centavo o al par */
    let total = M.totalGeneral();
    if (isFinite(mod.totalArchivo) && Math.abs(total - mod.totalArchivo) >= 0.005) {
      P.redondeoPrescom = true;
      const alPar = M.totalGeneral();
      if (Math.abs(alPar - mod.totalArchivo) < Math.abs(total - mod.totalArchivo)) total = alPar;
      else delete P.redondeoPrescom;
    }
    total = M.totalGeneral();

    /* control contra el B-3 del archivo: precio de cada insumo */
    const b3dif = [];
    if (mod.b3.length) {
      /* un mismo nombre puede estar dos veces con precios distintos: es
         diferencia solo si el B-3 no tiene ese nombre con ese precio */
      const idx = new Map();
      mod.b3.forEach(b => { const k = b.t + '|' + clave(b.d); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(b); });
      Object.values(P.insumos).forEach(i => {
        const l = idx.get(i.t + '|' + clave(i.d));
        if (l && !l.some(b => Math.abs(b.p - i.p) <= 0.005)) b3dif.push({ d: i.d, u: i.u, apu: i.p, b3: l.map(b => b.p).join(' / ') });
      });
    }

    if (nComp) avisos.push(nComp + ' renglón(es) de «actividades complementarias» entraron como materiales, con su ' +
      'precio del archivo (así los recargan los gastos generales y la utilidad, igual que en el original).');
    if (nEqProd) avisos.push(nEqProd + ' renglón(es) de equipo con % productivo menor a 100: entran con el precio ' +
      'efectivo (productivo × % + improductivo × resto) y el % en el nombre.');
    if (conPct.length) avisos.push(conPct.length + ' análisis tienen porcentajes distintos a los del proyecto; ' +
      'conservan el P.U. del archivo.');
    if (b3dif.length) avisos.push(b3dif.length + ' insumo(s) tienen en el desglose (B-3) un precio distinto al de los análisis.');

    const nItems = mod.modulos.reduce((s, m) => s + m.items.length, 0);
    return {
      proyecto: P,
      resumen: {
        formato: mod.formato, nombre: P.nombre, cliente: P.entidad, lugar: P.ubicacion, tc: P.tc,
        modulos: P.modulos.length, items: nItems, insumos: Object.keys(P.insumos).length,
        analisis: mod.apus.length, sobrantes: mod.sobrantes, params: Object.assign({}, P.params),
        totalOrigen: mod.totalArchivo, totalRecalculado: total,
        redondeoAlPar: !!P.redondeoPrescom, coma: mod.coma,
        deArchivo, incoherentes, conPct, sinApu, b3dif, b3: mod.b3.length, monedaCruzada,
        enDolares: !!mod.enDolares,
        avisos
      }
    };
  }

  /** Todo junto. @param M MOTOR  @param archivos [{nombre, datos}] */
  async function importar(M, archivos) {
    const libros = await leerLibros(archivos);
    const mod = interpretar(libros);
    return construir(M, mod, archivos.map(a => a.nombre).join(' + '));
  }

  return { leerLibros, detectar, interpretar, construir, importar, numTexto };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = IMPORTAR_EXCEL;
