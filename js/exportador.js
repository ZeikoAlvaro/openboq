/* =========================================================================
   OpenBOQ — exportador de proyectos al formato .ddp
   -------------------------------------------------------------------------
   El camino de vuelta del importador: escribe los mismos archivos binarios
   que lee `js/importador.js`, para que un proyecto que entró en formato .ddp
   se pueda editar acá y volver a abrir allá.

   Lo que se escribe (formato descifrado por ingeniería inversa, ver el
   encabezado de `importador.js` para el detalle de lectura):

   .PRE  presupuesto — 460 bytes por ítem
           [2..3] uint16 módulo · [4..73] descripción · [76..80] unidad
           [81..84] int32 puntero al .DAT · [85..92] double cantidad
           [108] precio unitario · [116] materiales · [124] mano de obra
           [132] equipo · [140] los cuatro anteriores divididos por el tipo
           de cambio (140 P.U. · 148 mat. · 156 M.O. · 164 equipo)
           [172] double días de la actividad
           [180..181] uint16 1 · [182..437] espacios · [438..455] ceros
           [456..457] y [458..459] uint16 con el número de ítem
   .IND  índice de insumos — 92 bytes
           [2] tipo M/O/E · [3..72] descripción · [75..79] unidad
           [80..87] double con la fecha (TDateTime de Delphi)
           [88..91] int32 puntero al .DAT
   .DAT  pares (int32 código, float32 valor):
           · cada ítem ocupa 60 pares consecutivos desde su puntero, y el
             lugar dentro del bloque dice el tipo de insumo —los primeros 30
             son materiales, del 30 al 39 mano de obra y del 40 al 59 equipo,
             igual que en los archivos originales;
           · el precio de cada insumo va en un par suelto, que se escribe
             detrás del bloque del ítem donde el insumo aparece por primera
             vez, tal como lo deja el programa de origen.
   .MOD  módulos — 50 caracteres cada uno
   .STT  cabecera: nombre(70) + lugar(60) + cliente(60), fecha en [190] y
         tipo de cambio (float32) en [200]
   .CFG  estructura del B-2: 17 registros de 73 bytes con la etiqueta, el
         porcentaje y la fórmula de cada fila
   .TIE  un registro de 66 bytes por módulo (nombre + fechas)

   Los demás archivos del contenedor (.ADI, .IMP, .GRP, .CEQ, .CMM, .PLA y
   las imágenes del membrete) no los toca OpenBOQ: si el proyecto vino de un
   .ddp se copian tal cual del original —el importador los guarda en
   `P.prescom`—; si no, se escriben los valores neutros de fábrica.

   Límite real del formato, y por eso se avisa antes de exportar: un análisis
   no puede pasar de 30 materiales, 10 renglones de mano de obra y 20 de
   equipo. Lo que no entra en el bloque de 60 pares, el programa de origen no lo lee.
   ========================================================================= */
'use strict';

const EXPORTADOR = (() => {

  /* Capacidad del bloque de 60 pares del .DAT, por tipo de insumo. */
  const LIM = { M: 30, O: 10, E: 20 };
  const SLOT0 = { M: 0, O: 30, E: 40 };
  const NOMBRE_TIPO = { M: 'materiales', O: 'mano de obra', E: 'equipo' };

  /* Archivos que OpenBOQ genera; el resto viaja igual que en el original.
     El .CMM se genera desde el 22/10/2026: copiado tal cual, sus filas se
     enganchaban por id a ítems que ya no eran los mismos. */
  const GENERADOS = ['PRE', 'IND', 'DAT', 'MOD', 'STT', 'CFG', 'TIE', 'CMM'];

  /* =====================================================================
     TEXTO — el formato guarda en Windows-1252, no en UTF-8
     ===================================================================== */
  /* Los caracteres que en Windows-1252 no coinciden con Latin-1 (0x80–0x9F). */
  const W1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
    0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
    0x017E: 0x9E, 0x0178: 0x9F
  };

  /** Un carácter a su byte de Windows-1252; lo que no existe se transcribe
      sin acento antes de rendirse (así «m²» y «día» salen enteros y una ẞ
      rara no rompe el archivo). */
  function byte1252(ch) {
    const c = ch.codePointAt(0);
    if (c === 0x0A || c === 0x0D || c === 0x09) return 0x20;
    if (c >= 0x20 && c <= 0x7E) return c;
    if (c >= 0xA0 && c <= 0xFF) return c;
    if (W1252[c] !== undefined) return W1252[c];
    const plano = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (plano && plano !== ch) return byte1252(plano[0]);
    return 0x3F;   // '?'
  }

  /** Escribe un texto de ancho fijo, completado con espacios y recortado.
      Devuelve true si hubo que recortar (el llamador lo avisa). */
  function texto(u8, off, s, n) {
    const t = String(s === undefined || s === null ? '' : s);
    let i = 0;
    for (const ch of t) {
      if (i >= n) break;
      u8[off + i] = byte1252(ch);
      i++;
    }
    for (; i < n; i++) u8[off + i] = 0x20;
    return [...t].length > n;
  }

  /* Fechas: Delphi cuenta días desde el 30/12/1899. */
  const ORIGEN_DELPHI = Date.UTC(1899, 11, 30);
  function fechaDelphi(f) {
    const t = f ? Date.parse(f + 'T00:00:00Z') : NaN;
    return ((isFinite(t) ? t : Date.now()) - ORIGEN_DELPHI) / 86400000;
  }

  /* base64 <-> bytes (las plantillas y lo que se guarda en el proyecto) */
  function deB64(b64) {
    const s = atob(String(b64 || '').replace(/\s+/g, ''));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  function aB64(u8) {
    let s = '';
    const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /* =====================================================================
     PLANTILLAS DE FÁBRICA
     Se usan solo cuando el proyecto no vino de un .ddp. Salieron de un
     archivo .ddp real, con los textos del membrete borrados.
     ===================================================================== */
  /* .STT desde el byte 190: fuentes, colores y líneas del membrete. */
  const STT_COLA =
    'AAAAACBo5kACAFK43kDAAAAA////AAUAAIAIAACAQXJpYWwgICAgICAgICAgICAgICAgICAgICAgICAgDgAAAAAA///g4OAA' +
    'gICAAAAAQXJpYWwgICAgICAgICAgICAgICAgICAgICAgICAgQXJpYWwgICAgICAgICAgICAgICAgICAgICAgICAgQXJpYWwg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgQXJpYWwgICAgICAgICAgICAgICAgICAgICAgICAgAAAAAAAAAQACACAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAA//8BAAAAQXJpYWwgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgQXJpYWwgICAgICAgICAgICAgICAgICAgICAgICAgAAABAP//ICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgBAADAAQAAgAAAAEACAAGAAAAICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg';
  /* .IMP: los rótulos de los reportes impresos. Es idéntico en todos los
     proyectos —no lleva nada del proyecto—, así que se copia tal cual. */
  const IMP =
    'UHJlc3VwdWVzdG8gZ2VuZXJhbCAgICAgICAgICAgICAgICAgICAgIFByZXN1cHVlc3RvIHBvciBt82R1bG8gICAgICAgICAg' +
    'ICAgICAgICBQcmVzdXB1ZXN0byBnbG9iYWxpemFkbyAgICAgICAgICAgICAgICAgRGVzY3JpcGNp824gICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgIFVuZC4gICAgICBDYW50aWRhZCAgVW5pdGFyaW8gIFBhcmNpYWwgICBUb3RhbCBwcmVzdXB1ZXN0' +
    'bzogICAgICAgQW7hbGlzaXMgZGUgUHJlY2lvcyBVbml0YXJpb3MgICAgICAgICAgIEluc3Vtby9QYXLhbWV0cm8gICAgICAg' +
    'ICAgICAgICAgICAgICAgICBVbmQuICAgICAgQ2FudC4gICAgIFVuaXQuICAgICBQYXJjaWFsICAgUFJFQ0lPIEFET1BUQURP' +
    'OiAgICAgICAgIERlc2dsb3NlIGRlIGluc3Vtb3MgZ2VuZXJhbDogICAgICAgICAgICBEZXNjcmlwY2nzbiBpbnN1bW9zICAg' +
    'ICAgICAgICAgICAgICAgICAgVW5kLiAgICAgIENhbnQuICAgICBVbml0LiAgICAgUGFyY2lhbCAgIEdydXBvICAgICBUb3Rh' +
    'bDogICAgICAgICAgICAgICAgICAgRGVzZ2xvc2UgZGUgaW5zdW1vcyBwb3Ig7XRlbTogICAgICAgICAgIEl0ZW1lcy9JbnN1' +
    'bW9zICAgICAgICAgICAgICAgICAgICAgICAgICBVbmQuICAgICAgVW5pdC4gICAgIENhbnQuICAgICBQYXJjaWFsICAgVG90' +
    'YWw6ICAgICAgICAgICAgICAgICAgIFJlc3VtZW4gZ2VuZXJhbCAgICAgICAgICAgICAgICAgICAgICAgICBQYXLhbWV0cm8g' +
    'ICAgICAgICAgICAgICAgTW9udG8gICAgICAgICAgICAgICBG83JtdWxhICAgICAgICAgICAgIFRvdGFsIHByZXN1cHVlc3Rv' +
    'OiAgICAgICBQcmVzdXB1ZXN0byBwb3IgcnVicm9zICAgICAgICAgICAgICAgICAgRGVzY3JpcGNp824g7XRlbSAgICAgICAg' +
    'ICAgICAgICAgICAgICAgIFRvdGFsZXMgcG9yIHJ1YnJvICAgICAgICBSZXN1bWVuIHBvciBpbmNpZGVuY2lhICAgICAgICAg' +
    'ICAgICAgICAgVG90YWxlczogICAgICAgICAgICAgICAgIFJlc3VtZW4gcG9yIGdydXBvcyAgICAgICAgICAgICAgICAgICAg' +
    'ICBEZXNjcmlwY2nzbiDtdGVtICAgICAgICAgICAgICAgICAgICAgICAgVW5kLiAgICAgIFVuaXQuICAgICBDYW50LiAgICAg' +
    'UGFyY2lhbCAgIFByZXN1cHVlc3RvOiAgICAgICAgICAgICBBcmlhbCAgICAgICAgICAgICAgICAgICAgICAgICD//wAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACABQcm95ZWN0bzogICAgICAgICAgICAgICAgTfNkdWxv' +
    'OiAgICAgICAgICAgICAgICAgIENsaWVudGU6ICAgICAgICAgICAgICAgICBMdWdhcjogICAgICAgICAgICAgICAgICAgRmVj' +
    'aGE6ICAgICAgICAgICAgICAgICAgIFRpcG8gZGUgY2FtYmlvOiAgICAgICAgICBOuiAgICBOb3RhczogICAgICAgICBDcm9u' +
    'b2dyYW1hIGdlbmVyYWwgICAgICAgICAgICAgICAgICAgICAgQWN0aXZpZGFkICAgICAgICAgICAgICAgIEluaWNpYSAgICAg' +
    'ICAgIEZpbmFsaXphICAgICAgIFBsYXpvICAgICAgICAgIETtYXMgICAgICAgICAgIEPzbXB1dG9zIG3pdHJpY29zICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIERlc2NyaXBjafNuL3BhcnRlICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgIFZlY2VzICAgICAgICAgIERpc3QuIFggICAgICAgIERpc3QuIFkgICAgICAgIERp' +
    'c3QuIFogICAgICAgIFBhcmNpYWwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgICAgPyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/ICAgICAgICAgICAg' +
    'ICAgICAgICAgICAgICAgICAgICAgID8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyAgICAgICAgICAgICAg' +
    'ICAgICA/ICAgICAgICAgICAgICAgICAgID8gICAgICAgICAgICAgICAgICAg';

  /** Las 17 filas del B-2 tal como las guarda el formato: etiqueta, porcentaje
      (-1 = fila calculada) y fórmula. Los porcentajes salen del proyecto. */
  function filasCFG(pr) {
    return [
      ['MATERIALES', -1, '*', [1, 0, 0, 0]],
      ['MANO DE OBRA', -1, '*', [4, 0, 255, 255]],
      ['EQUIPO, MAQUINARIA Y HERRAMIENTAS', -1, '*', [2, 0, 0, 0]],
      ['TOTAL MATERIALES', -1, 'A', [5, 0, 255, 255]],
      ['SUBTOTAL MANO DE OBRA', -1, 'B', [6, 0, 0, 0]],
      ['CARGAS SOCIALES', pr.cargas, 'E', [15, 0, 0, 0]],
      ['TOTAL MANO DE OBRA', -1, 'E+F+O', [7, 0, 255, 255]],
      ['HERRAMIENTAS', pr.herr, 'G', [3, 0, 0, 0]],
      ['TOTAL EQUIPO, MAQUINARIA Y HERRAMIENTAS', -1, 'C+H', [8, 0, 0, 0]],
      ['SUB TOTAL', -1, 'D+G+I', [9, 0, 255, 255]],
      ['', -1, '', [10, 0, 255, 255]],
      ['GASTOS GENERALES Y ADMINISTRATIVOS', pr.gg, 'J', [12, 0, 0, 0]],
      ['UTILIDAD', pr.util, 'J+L', [13, 0, 0, 0]],
      ['PARCIAL', -1, 'J+L+M', [14, 0, 255, 255]],
      ['IMPUESTOS IVA', pr.ivaMO, 'E+F', [16, 0, 0, 0]],
      ['IMPUESTOS IT', pr.it, 'N', [11, 0, 0, 0]],
      ['TOTAL PRECIO UNITARIO', -1, 'N+P', [17, 0, 255, 255]]
    ];
  }

  /* =====================================================================
     LA HOJA B-2 (.CFG)

     Tres casos, del más fiel al más general:

     1. Formato oficial y el proyecto vino de un .ddp cuya hoja ya era la
        oficial: se devuelve LA MISMA hoja del archivo, con los porcentajes
        actuales escritos en su lugar. Así no se pierden los nombres de fila
        ni una fila 11 propia («Imprevistos 0 %»).
     2. Formato oficial sin hoja de origen: la oficial de siempre (filasCFG).
     3. Formato propio: se escribe fila por fila con sus fórmulas —letras, + y
        -—. Si vino de un .ddp, cada fila vuelve a su lugar original.
     ===================================================================== */
  const SABS_F = ['*', '*', '*', 'A', 'B', 'E', 'E+F+O', 'G', 'C+H', 'D+G+I', '', 'J', 'J+L', 'J+L+M', 'E+F', 'N', 'N+P'];
  const SABS_PCT = { 5: 'cargas', 7: 'herr', 11: 'gg', 12: 'util', 14: 'ivaMO', 15: 'it' };

  function hojaCFG(P, plantilla, errores, avisos) {
    const cfg = new Uint8Array(17 * 73);
    const dvC = new DataView(cfg.buffer);
    const oficial = typeof MOTOR === 'undefined' || !MOTOR.formatoEsOficial || MOTOR.formatoEsOficial();

    if (oficial) {
      const orig = plantilla && plantilla.cfg ? deB64(plantilla.cfg) : null;
      if (orig && orig.length === 17 * 73 && hojaEsOficial(orig)) {
        cfg.set(orig);
        for (const i in SABS_PCT) dvC.setFloat32(i * 73 + 50, Number(P.params[SABS_PCT[i]]) || 0, true);
        return cfg;
      }
      filasCFG(P.params).forEach((fl, k) => {
        const o = k * 73;
        texto(cfg, o, fl[0], 50);
        dvC.setFloat32(o + 50, Number(fl[1]), true);
        texto(cfg, o + 54, fl[2], 15);
        fl[3].forEach((b, i) => { cfg[o + 69 + i] = b; });
      });
      return cfg;
    }

    /* --- formato propio --- */
    const F = (MOTOR.formato().filas || []);
    const nombre = MOTOR.formato().n;
    if (F.length > 17) { errores.push(`El formato «${nombre}» tiene ${F.length} filas; el .ddp admite 17.`); return cfg; }
    if (F.filter(x => x.k === 'ent').length !== 3) { errores.push(`El formato «${nombre}» no tiene las tres entradas.`); return cfg; }
    /* lugar de cada fila: el original si vino de un .ddp y sigue entero; si
       no, en orden, con el precio unitario en la última (fila 17) */
    const usaPos = F.every(x => Number.isInteger(x.pos)) && new Set(F.map(x => x.pos)).size === F.length &&
      F[F.length - 1].pos === 16;
    const lugar = F.map((x, i) => usaPos ? x.pos : (i === F.length - 1 ? 16 : i));
    const letra = j => String.fromCharCode(65 + lugar[j]);
    /* Impuestos sobre el precio final: el .ddp no tiene un tipo de fila para
       eso —en el programa de origen es un ajuste de la instalación («cálculo
       de impuesto mejorado»)—. Se escriben como porcentaje sobre su base y se
       avisa: los precios unitarios exportados son los de OpenBOQ, pero si allá
       se recalcula sin ese ajuste, los impuestos salen distintos. */
    if (avisos && F.some(x => x.k === 'imp' && !x.vacia))
      avisos.push('El formato calcula IVA/IT sobre el precio final. El .ddp no guarda ese modo: ' +
        'en el programa de origen hay que activar el «cálculo de impuesto mejorado» o, al recalcular, ' +
        'los impuestos saldrán sobre el parcial.');
    const ocupado = new Set(lugar);
    for (let s = 0; s < 17; s++) {
      if (ocupado.has(s)) continue;
      const o = s * 73;
      texto(cfg, o, '', 50); dvC.setFloat32(o + 50, -1, true); texto(cfg, o + 54, '', 15);
      cfg[o + 69] = s + 1;
    }
    F.forEach((x, j) => {
      const o = lugar[j] * 73;
      let formula = '';
      if (x.k === 'ent') formula = '*';
      else if (!x.vacia) {
        formula = (x.sobre || []).map(v => {
          const n = Number(v), k = Math.abs(n) - 1;
          if (!(k >= 0 && k < F.length)) return '';
          return (n < 0 ? '-' : '+') + letra(k);
        }).join('').replace(/^\+/, '');
      }
      if (formula.length > 15)
        errores.push(`Fila «${x.n}» del formato: la fórmula ${formula} pasa de los 15 caracteres que admite el .ddp.`);
      const conPct = x.k === 'pct' || x.k === 'imp';
      const suma = !conPct;
      texto(cfg, o, x.n || '', 50);
      dvC.setFloat32(o + 50, conPct ? (Number(x.pct) || 0) : -1, true);
      texto(cfg, o + 54, formula.slice(0, 15), 15);
      const px = Array.isArray(x.px) && x.px.length === 4 ? x.px
        : [lugar[j] + 1, 0, (suma && x.k !== 'ent') ? 255 : 0, (suma && x.k !== 'ent') ? 255 : 0];
      px.forEach((b, i) => { cfg[o + 69 + i] = b; });
    });
    return cfg;
  }

  /** ¿Esta hoja (bytes de un .CFG) es la oficial? La fila 11 no cuenta. */
  function hojaEsOficial(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const td = new TextDecoder('windows-1252');
    for (let i = 0; i < 17; i++) {
      if (i === 10) continue;
      const o = i * 73;
      const f = td.decode(u8.slice(o + 54, o + 69)).replace(/[\s\u0000]+/g, '').toUpperCase();
      const pct = dv.getFloat32(o + 50, true);
      if (f !== SABS_F[i]) return false;
      if ((i in SABS_PCT) ? !(pct >= 0) : !(pct < 0)) return false;
    }
    return true;
  }

  /* =====================================================================
     ARMADO DE LOS ARCHIVOS
     ===================================================================== */
  /**
   * Arma los archivos binarios del .ddp con el proyecto abierto.
   * No escribe nada: devuelve los bytes, los avisos y los errores que
   * impiden exportar.
   * @param {Object} [proy] proyecto; por defecto el que está abierto
   * @returns {{archivos:Object, avisos:string[], errores:string[], resumen:Object}}
   */
  function archivos(proy) {
    const P = proy || MOTOR.proyecto();
    if (!P) throw new Error('No hay proyecto abierto.');
    const avisos = [], errores = [];
    const tc = Number(P.tc) || 6.96;
    const plantilla = P.prescom || null;

    /* --- ítems en el orden del presupuesto, con su módulo --- */
    const filas = [];
    P.modulos.forEach((m, mi) => (m.items || []).forEach(it => filas.push({ it, mod: mi + 1 })));
    if (!filas.length) errores.push('El proyecto no tiene ítems.');

    /* --- .DAT: bloques de 60 pares por ítem, precios de insumos intercalados --- */
    const cod = [], val = [];
    const push = (c, v) => { cod.push(c); val.push(v); return cod.length; };  // devuelve puntero 1-based
    const seq = {};          // id de insumo -> número de orden en el .IND
    const ptrIns = {};       // id de insumo -> puntero de su precio en el .DAT
    const orden = [];        // insumos en el orden del .IND
    let nSeq = 0;

    filas.forEach(f => {
      const it = f.it;
      const base = cod.length;
      for (let i = 0; i < 60; i++) push(0, 0);
      f.ptr = base + 1;

      /* Los renglones van en el orden en que el usuario los cargó (it.comp),
         no en el alfabético de la pantalla: es el orden que muestra el
         programa de origen. */
      const grupos = { M: [], O: [], E: [] };
      (it.comp || []).forEach(c => {
        const ins = P.insumos[c.ins];
        if (!ins) return;
        (grupos[ins.t] || grupos.M).push({ ins, rend: c.rend });
      });
      const nuevos = [];
      ['M', 'O', 'E'].forEach(t => {
        const g = grupos[t];
        if (g.length > LIM[t]) {
          errores.push(`«${it.desc}»: ${g.length} renglones de ${NOMBRE_TIPO[t]}; ` +
            `el formato .ddp admite ${LIM[t]} por análisis.`);
        }
        g.slice(0, LIM[t]).forEach((fila, k) => {
          const ins = fila.ins;
          if (seq[ins.id] === undefined) {
            seq[ins.id] = ++nSeq; orden.push(ins); nuevos.push(ins);
          }
          const j = base + SLOT0[t] + k;
          cod[j] = seq[ins.id];
          val[j] = Number(fila.rend) || 0;
        });
      });
      /* el precio de los insumos que aparecen por primera vez en este ítem */
      nuevos.forEach(ins => { ptrIns[ins.id] = push(seq[ins.id], Number(ins.p) || 0); });
    });

    /* insumos del proyecto que no usa ningún ítem: igual van al índice */
    Object.values(P.insumos || {}).sort(MOTOR.cmpIns).forEach(ins => {
      if (seq[ins.id] !== undefined) return;
      seq[ins.id] = ++nSeq; orden.push(ins);
      ptrIns[ins.id] = push(seq[ins.id], Number(ins.p) || 0);
    });

    const dat = new Uint8Array(cod.length * 8);
    const dvD = new DataView(dat.buffer);
    for (let k = 0; k < cod.length; k++) {
      dvD.setInt32(k * 8, cod[k], true);
      dvD.setFloat32(k * 8 + 4, val[k], true);
    }

    /* --- .IND --- */
    const fecha = fechaDelphi(P.fecha);
    const ind = new Uint8Array(orden.length * 92);
    const dvI = new DataView(ind.buffer);
    let cortados = 0;
    orden.forEach((ins, k) => {
      const o = k * 92;
      const px = ins.px || {};
      /* marca de baja, grupo y fecha de cotización: los del archivo de
         origen si los trae; si no, la fecha del precio fijada en OpenBOQ o la
         del proyecto */
      dvI.setInt16(o, px.baja ? -1 : 0, true);
      ind[o + 2] = byte1252((ins.t === 'O' || ins.t === 'E') ? ins.t : 'M');
      if (texto(ind, o + 3, ins.d, 70)) cortados++;
      dvI.setInt16(o + 73, Number(px.grp) || 0, true);
      texto(ind, o + 75, ins.u, 5);
      dvI.setFloat64(o + 80, (px.f || ins.f) ? fechaDelphi(px.f || ins.f) : fecha, true);
      dvI.setInt32(o + 88, ptrIns[ins.id] || 0, true);
    });

    /* --- id de cada ítem (PRE 456): es la clave de los cómputos (.CMM).
       Se conserva el que trajo el archivo; los ítems nuevos —o un duplicado
       que heredó el id de otro— reciben uno libre. --- */
    const usadosId = new Set();
    let sigId = filas.reduce((m, f) => Math.max(m, Number(f.it.px && f.it.px.id) || 0), 0);
    filas.forEach(f => {
      const v = Number(f.it.px && f.it.px.id);
      if (Number.isInteger(v) && v > 0 && v < 65536 && !usadosId.has(v)) f.id = v;
      else f.id = ++sigId;
      usadosId.add(f.id);
    });
    if (sigId > 65535) errores.push('Demasiados ítems para el formato .ddp (el id del ítem pasa de 65.535).');

    /* --- cronograma: fechas absolutas desde el inicio de obra --- */
    const ini0 = P.inicioObra ? fechaDelphi(P.inicioObra) : 0;

    /* --- .PRE --- */
    const pre = new Uint8Array(filas.length * 460);
    const dvP = new DataView(pre.buffer);
    filas.forEach((f, k) => {
      const o = k * 460, it = f.it, a = MOTOR.analisis(it);
      const px = it.px || {};
      pre.fill(0, o, o + 460);
      dvP.setUint16(o + 2, f.mod, true);
      if (texto(pre, o + 4, it.desc, 70)) cortados++;
      dvP.setInt16(o + 74, Number(px.grp) || 0, true);
      texto(pre, o + 76, it.und, 5);
      dvP.setInt32(o + 81, f.ptr, true);
      dvP.setFloat64(o + 85, Number(it.cant) || 0, true);
      texto(pre, o + 93, it.cod || '', 15);
      /* Los subtotales van SIN redondear (`matX`, no `mat`).
         `a.mat` es el subtotal ya llevado a 2 decimales para imprimirlo, y
         escribir eso perdía precisión que el formato sí guarda: los archivos
         que salen de un .ddp real traen `8.700500`, `106.985000`,
         `1217.911000`. Con el valor redondeado, un proyecto exportado y
         vuelto a abrir declaraba un costo directo que sus propios insumos ya
         no daban, y aparecía como «no cuadra consigo mismo» sin que nadie
         hubiera tocado nada. El precio unitario sí va a 2 decimales, que es
         como lo guarda el formato. */
      /* Un ítem importado que nadie tocó devuelve los subtotales que traía:
         el programa de origen los guarda con su propio redondeo (17,5912
         donde el recálculo da 17,591) y no hay por qué cambiárselos. */
      const crudo = a.cadena && a.cadena.length ? a.cadena[a.cadena.length - 1].valor : NaN;
      const d0 = it._dirOrigen;
      const intactoAn = !!(d0 && it.puArchivo && Math.abs(crudo - it.puArchivo.crudo) < 1e-9);
      dvP.setFloat64(o + 108, a.pu, true);
      dvP.setFloat64(o + 116, intactoAn ? Number(d0.m) || 0 : a.matX, true);
      dvP.setFloat64(o + 124, intactoAn ? Number(d0.o) || 0 : a.moX, true);
      dvP.setFloat64(o + 132, intactoAn ? Number(d0.e) || 0 : a.eqX, true);
      const us = intactoAn && Array.isArray(d0.us) && d0.us.length === 4 && Number(P.tc) === Number(d0.tc || P.tc)
        ? d0.us.map(Number) : [a.pu / tc, a.matX / tc, a.moX / tc, a.eqX / tc];
      us.forEach((v, j) => dvP.setFloat64(o + 140 + 8 * j, Number(v) || 0, true));
      /* [172] horas por unidad y [180] cuadrillas: las del archivo de
         origen; en un ítem hecho acá, las horas de la especialidad que más
         trabaja por unidad (MOTOR.horasManoObra) y una cuadrilla. Antes se
         escribían acá los DÍAS del cronograma: otro dato. */
      const q = Number(it.cant) || 0;
      const hU = px.h !== undefined ? Number(px.h) || 0
        : (q > 0 && MOTOR.horasManoObra ? MOTOR.horasManoObra(it).mayor / q : 0);
      dvP.setFloat64(o + 172, hU, true);
      dvP.setUint16(o + 180, Number(px.cuad) > 0 ? Number(px.cuad) : 1, true);
      texto(pre, o + 182, px.espec || '', 256);
      /* [438]/[446] fechas: las del cronograma de OpenBOQ (inicio de obra +
         día de comienzo; el último día incluido). [454] predecesora: el
         n.º de actividad de OpenBOQ es el n.º de orden en el .PRE. */
      const dias = Number(it.dias) || 0;
      if (dias > 0 && ini0) {
        const fi = ini0 + (Number(it.inicio) || 0);
        /* si el cronograma no se tocó, la fecha de fin vuelve tal cual
           (hay archivos con el fin un día antes del inicio) */
        const intacto = px.fIni === fi && dias === Math.max(px.fFin || 0, px.fIni) - px.fIni + 1;
        dvP.setFloat64(o + 438, fi, true);
        dvP.setFloat64(o + 446, intacto && px.fFin ? px.fFin : fi + dias - 1, true);
      }
      const pr = (MOTOR.leerPredecesoras ? MOTOR.leerPredecesoras(it.pred) : [])
        .find(x => x.n >= 1 && x.n <= filas.length && x.n !== k + 1);
      dvP.setInt16(o + 454, pr ? pr.n : (Number(px.p454) < 0 ? -1 : 0), true);
      dvP.setUint16(o + 456, f.id, true);
      dvP.setUint16(o + 458, k + 1, true);
    });

    /* --- .CMM: los cómputos métricos de cada ítem, enganchados por su id.
       Una fila de OpenBOQ puede traer área o volumen además de largo, ancho y
       alto; el formato tiene tres medidas, así que lo que sobra se multiplica
       en la tercera (el producto es el mismo). --- */
    const filasCmm = [];
    filas.forEach(f => (f.it.computos || []).forEach(c => {
      const med = ['l', 'a', 'h', 'ar', 'vo'].map(k => Number(c[k]) || 0).filter(v => v);
      const xyz = [med[0] || 0, med[1] || 0, med.slice(2).reduce((s, v) => s * v, med.length > 2 ? 1 : 0)];
      filasCmm.push({ id: f.id, d: c.d, xyz, v: Number(c.n) || 0 });
    }));
    const cmm = new Uint8Array(filasCmm.length * 62);
    const dvM = new DataView(cmm.buffer);
    filasCmm.forEach((x, k) => {
      const o = k * 62;
      dvM.setInt16(o, x.id, true);
      texto(cmm, o + 2, x.d, 30);
      x.xyz.forEach((v, j) => dvM.setFloat32(o + 32 + 4 * j, v, true));
      dvM.setFloat32(o + 44, x.v, true);
    });

    /* --- especificaciones técnicas (RTF): una por ítem, numeradas con el
       n.º de orden con que sale el ítem --- */
    const especs = [];
    filas.forEach((f, k) => {
      if (f.it.px && f.it.px.rtf) especs.push({ n: String(k + 1).padStart(5, '0') + '.RTF', datos: deB64(f.it.px.rtf) });
    });
    if (cortados) avisos.push(cortados + ' descripción(es) se recortaron: el formato .ddp guarda 70 caracteres.');

    /* --- .MOD --- */
    const mod = new Uint8Array(P.modulos.length * 50);
    P.modulos.forEach((m, k) => texto(mod, k * 50, m.n, 50));

    /* --- .STT --- */
    const cola = plantilla && plantilla.stt ? deB64(plantilla.stt) : deB64(STT_COLA);
    const stt = new Uint8Array(190 + cola.length);
    stt.set(cola, 190);
    const dvS = new DataView(stt.buffer);
    texto(stt, 0, P.nombre, 70);
    texto(stt, 70, P.ubicacion, 60);
    texto(stt, 130, P.entidad, 60);
    dvS.setFloat64(190, fecha, true);
    dvS.setFloat32(200, tc, true);
    /* [532] primera línea del membrete: QUIEN ELABORA el presupuesto
       («NOMADARQ», «BRAMOL»…), no la entidad. Si el proyecto vino de un .ddp
       se respeta la del archivo; solo un proyecto nacido acá la llena, con la
       entidad, que es lo único que se tiene. */
    if (stt.length >= 572 && !(plantilla && plantilla.stt)) texto(stt, 532, P.entidad, 40);
    /* la precisión con la que se calculó el proyecto (ver MOTOR.precisionOrigen):
       si vino de un .ddp vuelve la misma; si no, queda la de la plantilla */
    const prec = P.calcOrigen && P.calcOrigen.precision;
    if (Array.isArray(prec) && prec.length === 4 && stt.length >= 720)
      prec.forEach((v, k) => dvS.setInt16(712 + 2 * k, v, true));

    /* --- .CFG --- */
    const cfg = hojaCFG(P, plantilla, errores, avisos);

    /* --- .TIE: un registro de 66 bytes por módulo. Si el proyecto vino de
       un .ddp se conservan las fechas que ya traía cada módulo. --- */
    const tieViejo = plantilla && plantilla.archivos && plantilla.archivos.TIE
      ? deB64(plantilla.archivos.TIE) : null;
    const tie = new Uint8Array(P.modulos.length * 66);
    P.modulos.forEach((m, k) => {
      const o = k * 66;
      texto(tie, o, m.n, 50);
      if (tieViejo && tieViejo.length >= (k + 1) * 66) tie.set(tieViejo.subarray(k * 66 + 50, k * 66 + 66), o + 50);
    });

    /* --- lo que OpenBOQ no toca --- */
    const out = { PRE: pre, IND: ind, DAT: dat, MOD: mod, STT: stt, CFG: cfg, TIE: tie, CMM: cmm };
    const extras = {};
    const guardados = (plantilla && plantilla.archivos) || {};
    ['ADI', 'CEQ', 'GRP', 'PLA', 'IMP'].forEach(e => {
      out[e] = guardados[e] !== undefined ? deB64(guardados[e]) : deFabrica(e);
    });
    Object.keys((plantilla && plantilla.otros) || {}).forEach(n => {
      extras[n] = deB64(plantilla.otros[n]);
    });

    return {
      archivos: out, extras, especs, avisos, errores,
      resumen: {
        items: filas.length, insumos: orden.length, modulos: P.modulos.length,
        pares: cod.length, total: MOTOR.totalProyecto(),
        conPlantilla: !!(plantilla && (plantilla.stt || Object.keys(plantilla.archivos || {}).length)),
        origen: (plantilla && plantilla.base) || ''
      }
    };
  }

  /** Los archivos que el programa de origen espera y OpenBOQ no usa, en su versión neutra. */
  function deFabrica(ext) {
    if (ext === 'IMP') return deB64(IMP);
    if (ext === 'ADI') {
      const u = new Uint8Array(146);
      u.fill(0x20, 18); u[0] = 2;
      return u;
    }
    return new Uint8Array(0);   // .CEQ, .CMM, .PLA y .GRP van vacíos, como en los originales
  }

  /* =====================================================================
     CONTENEDOR .DDP  (ZIP)
     ===================================================================== */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** Deflate crudo con el compresor del navegador; si no está, se guarda sin
      comprimir (método 0), que cualquier descompresor entiende igual. */
  async function deflar(u8) {
    if (!u8.length || typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const rs = new ReadableStream({ start(c) { c.enqueue(u8); c.close(); } });
      const b = new Uint8Array(await new Response(rs.pipeThrough(cs)).arrayBuffer());
      return b.length < u8.length ? b : null;
    } catch (e) { return null; }
  }

  /** @param {{nombre:string,datos:Uint8Array}[]} entradas */
  async function zip(entradas) {
    const partes = [], central = [];
    const f = new Date();
    const hora = ((f.getHours() << 11) | (f.getMinutes() << 5) | (f.getSeconds() >> 1)) & 0xFFFF;
    const dia = (((f.getFullYear() - 1980) << 9) | ((f.getMonth() + 1) << 5) | f.getDate()) & 0xFFFF;
    let off = 0;
    for (const e of entradas) {
      const nom = new Uint8Array([...e.nombre].map(byte1252));
      const crudo = e.datos;
      const comp = await deflar(crudo);
      const datos = comp || crudo;
      const metodo = comp ? 8 : 0;
      const c = crc32(crudo);

      const lh = new Uint8Array(30 + nom.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, metodo, true);
      dv.setUint16(10, hora, true); dv.setUint16(12, dia, true);
      dv.setUint32(14, c, true);
      dv.setUint32(18, datos.length, true);
      dv.setUint32(22, crudo.length, true);
      dv.setUint16(26, nom.length, true); dv.setUint16(28, 0, true);
      lh.set(nom, 30);
      partes.push(lh, datos);

      const cd = new Uint8Array(46 + nom.length);
      const dc = new DataView(cd.buffer);
      dc.setUint32(0, 0x02014b50, true);
      dc.setUint16(4, 20, true); dc.setUint16(6, 20, true);
      dc.setUint16(8, 0, true); dc.setUint16(10, metodo, true);
      dc.setUint16(12, hora, true); dc.setUint16(14, dia, true);
      dc.setUint32(16, c, true);
      dc.setUint32(20, datos.length, true);
      dc.setUint32(24, crudo.length, true);
      dc.setUint16(28, nom.length, true);
      dc.setUint32(42, off, true);
      cd.set(nom, 46);
      central.push(cd);
      off += lh.length + datos.length;
    }
    let cdLen = 0;
    central.forEach(c => { partes.push(c); cdLen += c.length; });
    const fin = new Uint8Array(22);
    const df = new DataView(fin.buffer);
    df.setUint32(0, 0x06054b50, true);
    df.setUint16(8, central.length, true);
    df.setUint16(10, central.length, true);
    df.setUint32(12, cdLen, true);
    df.setUint32(16, off, true);
    partes.push(fin);

    const total = partes.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let i = 0;
    partes.forEach(p => { out.set(p, i); i += p.length; });
    return out;
  }

  /* ---------------------------------------------------------------------
     EL NOMBRE, QUE ES LO QUE MÁS SE ROMPE

     El programa de origen descomprime el .ddp en su carpeta `temporal` y después busca los
     archivos del proyecto por el nombre del .ddp. Si el archivo se renombra
     desde Windows —«presupuesto final.ddp»— adentro sigue estando
     «PROYECTO ULTIMO3.PRE» y el programa de origen ya no reconoce el proyecto.

     Por eso acá el nombre es uno solo: el que se elige al guardar es el que
     llevan los trece archivos de adentro. `nombreInterno` únicamente saca lo
     que un nombre de archivo de Windows no admite —no cambia el texto—, para
     que el nombre de afuera y el de adentro no se puedan separar.
     --------------------------------------------------------------------- */
  function nombreInterno(s) {
    const t = String(s === undefined || s === null ? '' : s)
      .replace(/\.ddp$/i, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim();
    return (t || 'PROYECTO').slice(0, 60);
  }

  /** El nombre que se propone al guardar: escrito como los escribe el programa de origen
      —mayúsculas y sin acentos—, que es lo más seguro para su carpeta
      `temporal`. Si el usuario elige otro, manda el suyo. */
  function nombreSugerido(s) {
    return nombreInterno(String(s || 'PROYECTO').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toUpperCase());
  }


  /**
   * Arma el .ddp completo.
   * @param {Object} [opc] `{nombre}` nombre interno del proyecto,
   *        `{sueltos:true}` para un zip con los archivos sin la carpeta de
   *        el programa de origen (sirve para copiarlos a mano dentro del programa).
   * @returns {Promise<{datos:Uint8Array, avisos:string[], errores:string[], resumen:Object, nombre:string}>}
   */
  async function ddp(opc) {
    const o = opc || {};
    const P = o.proyecto || MOTOR.proyecto();
    const r = archivos(P);
    if (r.errores.length) return Object.assign({ datos: null, nombre: '' }, r);
    const base = nombreInterno(o.nombre || (P.prescom && P.prescom.base) || nombreSugerido(P.nombre));
    /* el nombre con el que se guardó queda anotado: la próxima exportación lo
       propone de nuevo, así el proyecto no cambia de nombre sin querer */
    if (P) {
      P.prescom = P.prescom || { archivos: {}, otros: {}, stt: '' };
      P.prescom.base = base;
    }
    const carpeta = o.sueltos ? '' : 'PRESCOM_2013/temporal/';
    const entradas = [];
    /* el orden es el mismo que trae un .ddp original */
    ['ADI', 'CEQ', 'CFG', 'CMM', 'DAT', 'GRP', 'IMP', 'IND', 'MOD', 'PLA', 'PRE', 'STT', 'TIE']
      .forEach(e => entradas.push({ nombre: carpeta + base + '.' + e, datos: r.archivos[e] || new Uint8Array(0) }));
    Object.keys(r.extras).forEach(n => entradas.push({ nombre: carpeta + n, datos: r.extras[n] }));
    /* las especificaciones van en la carpeta <NOMBRE>_ET, con el nombre elegido */
    (r.especs || []).forEach(e => entradas.push({ nombre: carpeta + base + '_ET/' + e.n, datos: e.datos }));
    return Object.assign({ datos: await zip(entradas), nombre: base }, r);
  }

  return { archivos, ddp, zip, crc32, nombreInterno, nombreSugerido, aB64, deB64, GENERADOS, LIM };
})();
