/* =========================================================================
   OpenBOQ — lector de libros de Excel (.xlsx y .xls)
   -------------------------------------------------------------------------
   Lee las celdas de un libro sin librerías externas, en el navegador y en
   Node (lo usan el importador de presupuestos y el MCP). Solo lectura: no
   evalúa fórmulas, toma el último valor que guardó Excel.

   .xlsx  ZIP con XML (Office Open XML). Se descomprime con
          DecompressionStream('deflate-raw'), que traen los navegadores y Node.
   .xls   Excel 97-2003: un archivo compuesto OLE2 con el flujo «Workbook» en
          registros BIFF8. Es el que siguen entregando muchos consultores.

   Resultado: { tipo, hojas: [{ n, filas }] } donde filas[r][c] es
   { v, t, z } —valor, tipo ('n' número, 's' texto, 'b' lógico) y el formato
   de número— o undefined si la celda está vacía. r y c empiezan en 0.

   El formato de número viaja con la celda porque hay libros que lo necesitan
   para leer bien el valor: el Excel que exporta PRESCOM, abierto en una
   máquina con coma de miles, deja «12,0000» como 120000 con formato
   «#,##0.0000». Lo resuelve quien interpreta el libro, no este lector.
   ========================================================================= */
'use strict';

const LECTOR_EXCEL = (() => {

  /* formatos de número que Excel no escribe en el archivo porque son fijos */
  const FMT_FIJOS = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
    11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'dd/mm/yyyy', 37: '#,##0 ;(#,##0)',
    38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 49: '@'
  };

  /** Lee un libro. @param {ArrayBuffer|Uint8Array} datos */
  async function leer(datos) {
    const u8 = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
    if (u8[0] === 0x50 && u8[1] === 0x4B) return leerXlsx(u8);
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) return leerXls(u8);
    throw new Error('El archivo no es un libro de Excel (.xlsx o .xls).');
  }

  function poner(filas, r, c, celda) {
    (filas[r] || (filas[r] = []))[c] = celda;
  }

  /* =====================================================================
     .XLSX
     ===================================================================== */

  /** Entradas de un ZIP: nombre -> función que devuelve los bytes. */
  function zipEntradas(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--)
      if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    if (eocd < 0) throw new Error('El .xlsx está dañado (no se encuentra el índice del ZIP).');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    const td = new TextDecoder('utf-8');
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014B50) break;
      const metodo = dv.getUint16(p + 10, true);
      const tam = dv.getUint32(p + 20, true);
      const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const nombre = td.decode(u8.subarray(p + 46, p + 46 + ln));
      out[nombre] = () => {
        const a = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const crudo = u8.subarray(a, a + tam);
        if (metodo === 0) return Promise.resolve(crudo);
        if (metodo !== 8) return Promise.reject(new Error('Compresión no soportada en ' + nombre));
        return inflar(crudo);
      };
      p += 46 + ln + le + lc;
    }
    return out;
  }

  async function inflar(crudo) {
    const ds = new DecompressionStream('deflate-raw');
    const r = new Response(new Response(crudo).body.pipeThrough(ds));
    return new Uint8Array(await r.arrayBuffer());
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const desXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
      : (ENT[e] !== undefined ? ENT[e] : m));
  const attr = (s, a) => { const m = s.match(new RegExp('\\b' + a + '="([^"]*)"')); return m ? desXml(m[1]) : null; };
  /** El texto de un <si> o un <is>: todos los <t> seguidos (texto con formato). */
  const textoT = s => { let t = ''; s.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, x) => { t += x; }); return desXml(t); };

  function colLetras(ref) {
    let c = 0, i = 0;
    for (; i < ref.length; i++) {
      const k = ref.charCodeAt(i);
      if (k < 65 || k > 90) break;
      c = c * 26 + (k - 64);
    }
    return { c: c - 1, r: parseInt(ref.slice(i), 10) - 1 };
  }

  async function leerXlsx(u8) {
    const z = zipEntradas(u8);
    const td = new TextDecoder('utf-8');
    const texto = async n => (z[n] ? td.decode(await z[n]()) : '');

    const wb = await texto('xl/workbook.xml');
    const rels = await texto('xl/_rels/workbook.xml.rels');
    const destino = {};
    rels.replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => { destino[attr(a, 'Id')] = attr(a, 'Target'); });

    const sst = [];
    (await texto('xl/sharedStrings.xml')).replace(/<si>([\s\S]*?)<\/si>/g, (m, x) => { sst.push(textoT(x)); });

    /* estilos: índice de estilo de celda -> código de formato de número */
    const st = await texto('xl/styles.xml');
    const fmts = Object.assign({}, FMT_FIJOS);
    st.replace(/<numFmt\b([^>]*)\/?>/g, (m, a) => { fmts[+attr(a, 'numFmtId')] = attr(a, 'formatCode'); });
    const xfs = [];
    const cx = st.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (cx) cx[1].replace(/<xf\b([^>]*)\/?>/g, (m, a) => { xfs.push(fmts[+(attr(a, 'numFmtId') || 0)] || 'General'); });

    const hojas = [];
    const reHoja = /<sheet\b([^>]*)\/?>/g; let mh;
    while ((mh = reHoja.exec(wb))) {
      const a = mh[1];
      let t = destino[attr(a, 'r:id')] || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      const xml = await texto(t);
      const filas = [];
      const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let mc;
      while ((mc = reC.exec(xml))) {
        const ca = mc[1], cuerpo = mc[2] || '';
        const ref = attr(ca, 'r'); if (!ref) continue;
        const { r, c } = colLetras(ref);
        const tipo = attr(ca, 't') || 'n';
        const z = xfs[+(attr(ca, 's') || 0)] || 'General';
        const mv = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
        const v = mv ? desXml(mv[1]) : null;
        if (tipo === 's') { if (v !== null) poner(filas, r, c, { v: sst[+v] || '', t: 's', z }); }
        else if (tipo === 'inlineStr') poner(filas, r, c, { v: textoT(cuerpo), t: 's', z });
        else if (tipo === 'str') { if (v !== null) poner(filas, r, c, { v, t: 's', z }); }
        else if (tipo === 'b') { if (v !== null) poner(filas, r, c, { v: v === '1', t: 'b', z }); }
        else if (tipo === 'e') { /* error de fórmula: celda vacía */ }
        else if (v !== null && v !== '') poner(filas, r, c, { v: Number(v), t: 'n', z });
      }
      hojas.push({ n: attr(a, 'name') || 'Hoja', filas });
    }
    return { tipo: 'xlsx', hojas };
  }

  /* =====================================================================
     .XLS — archivo compuesto OLE2 + BIFF8
     ===================================================================== */

  /** Saca un flujo (por nombre) de un archivo compuesto OLE2. */
  function flujoOle(u8, nombres) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tsec = 1 << dv.getUint16(30, true);
    const tmini = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true);
    const dirIni = dv.getInt32(48, true);
    const corte = dv.getUint32(56, true);
    const miniIni = dv.getInt32(60, true);
    let difat = dv.getInt32(68, true);
    const off = s => 512 + s * tsec;

    /* sectores de la FAT: 109 en la cabecera y el resto encadenado en la DIFAT */
    const secFat = [];
    for (let i = 0; i < 109 && secFat.length < nFat; i++) secFat.push(dv.getInt32(76 + i * 4, true));
    let guardia = 0;
    while (difat >= 0 && secFat.length < nFat && guardia++ < 100000) {
      const o = off(difat), por = tsec / 4 - 1;
      for (let i = 0; i < por && secFat.length < nFat; i++) secFat.push(dv.getInt32(o + i * 4, true));
      difat = dv.getInt32(o + por * 4, true);
    }
    const fat = new Int32Array(secFat.length * tsec / 4);
    secFat.forEach((s, k) => { for (let i = 0; i < tsec / 4; i++) fat[k * tsec / 4 + i] = dv.getInt32(off(s) + i * 4, true); });

    const cadena = (ini, tabla) => {
      const out = []; let s = ini, n = 0;
      while (s >= 0 && s < tabla.length && n++ < 1e7) { out.push(s); s = tabla[s]; }
      return out;
    };
    const juntar = (secs, leerSec, tam) => {
      const out = new Uint8Array(secs.length * tam);
      secs.forEach((s, i) => out.set(leerSec(s), i * tam));
      return out;
    };
    const sector = s => u8.subarray(off(s), off(s) + tsec);

    const dir = juntar(cadena(dirIni, fat), sector, tsec);
    const ddv = new DataView(dir.buffer);
    const entradas = [];
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const ln = ddv.getUint16(p + 64, true);
      let n = '';
      for (let i = 0; i < Math.max(0, ln / 2 - 1); i++) n += String.fromCharCode(ddv.getUint16(p + i * 2, true));
      entradas.push({ n, tipo: dir[p + 66], ini: ddv.getInt32(p + 116, true), tam: ddv.getUint32(p + 120, true) });
    }
    const raiz = entradas.find(e => e.tipo === 5);
    const e = entradas.find(x => x.tipo === 2 && nombres.includes(x.n));
    if (!e) throw new Error('El .xls no tiene hojas de cálculo (falta el flujo Workbook).');

    if (e.tam >= corte) return juntar(cadena(e.ini, fat), sector, tsec).subarray(0, e.tam);
    /* flujo chico: vive en el mini-flujo de la raíz, con su propia FAT */
    const miniFat = juntar(cadena(miniIni, fat), sector, tsec);
    const mdv = new DataView(miniFat.buffer);
    const mfat = new Int32Array(miniFat.length / 4);
    for (let i = 0; i < mfat.length; i++) mfat[i] = mdv.getInt32(i * 4, true);
    const mini = juntar(cadena(raiz.ini, fat), sector, tsec);
    return juntar(cadena(e.ini, mfat), s => mini.subarray(s * tmini, (s + 1) * tmini), tmini).subarray(0, e.tam);
  }

  /** Valor de un RK: número comprimido de BIFF (entero o double truncado, /100 opcional). */
  function rk(dv, p) {
    const x = dv.getInt32(p, true);
    let v;
    if (x & 2) v = x >> 2;
    else {
      const b = new DataView(new ArrayBuffer(8));
      b.setInt32(4, x & 0xFFFFFFFC, true);
      v = b.getFloat64(0, true);
    }
    return (x & 1) ? v / 100 : v;
  }

  function leerXls(u8) {
    const wb = flujoOle(u8, ['Workbook', 'Book']);
    const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);

    /* registros: [tipo, ini, largo] */
    const regs = [];
    for (let p = 0; p + 4 <= wb.length;) {
      const t = dv.getUint16(p, true), l = dv.getUint16(p + 2, true);
      regs.push([t, p + 4, l]);
      p += 4 + l;
    }

    /* cadena de texto BIFF8 (XLUnicodeString) que puede cortarse entre
       registros CONTINUE: al saltar, el registro nuevo empieza con un byte
       que dice si los caracteres siguen de 1 o de 2 bytes. */
    function lectorTexto(trozos) {
      let k = 0, p = trozos[0][0];
      const fin = () => trozos[k][0] + trozos[k][1];
      const avanzar = () => { k++; p = trozos[k][0]; };
      const u8at = () => { if (p >= fin()) avanzar(); return wb[p++]; };
      const u16 = () => { const a = u8at(); return a | (u8at() << 8); };
      const u32 = () => (u16() | (u16() << 16)) >>> 0;
      const saltar = n => { while (n > 0) { if (p >= fin()) avanzar(); const d = Math.min(n, fin() - p); p += d; n -= d; } };
      function cadena(largo16) {
        const cch = largo16 ? u16() : u8at();
        const fl = u8at();
        let ancho = fl & 1;
        const runs = (fl & 8) ? u16() : 0;
        const ext = (fl & 4) ? u32() : 0;
        let s = '';
        for (let i = 0; i < cch; i++) {
          if (p >= fin()) { avanzar(); ancho = wb[p++] & 1; }
          s += String.fromCharCode(ancho ? (wb[p++] | (wb[p++] << 8)) : wb[p++]);
        }
        saltar(runs * 4 + ext);
        return s;
      }
      return { u16, u32, cadena, quedan: () => k < trozos.length - 1 || p < fin() };
    }
    const textoEn = (ini, largo16) => lectorTexto([[ini, 1e9]]).cadena(largo16);

    const hojasDef = [], sst = [], fmts = Object.assign({}, FMT_FIJOS), xfs = [];
    for (let i = 0; i < regs.length; i++) {
      const [t, p, l] = regs[i];
      if (t === 0x0085) {                      // BOUNDSHEET
        if (wb[p + 5] === 0) hojasDef.push({ pos: dv.getUint32(p, true), n: textoEn(p + 6, false) });
      } else if (t === 0x041E) {               // FORMAT
        fmts[dv.getUint16(p, true)] = textoEn(p + 2, true);
      } else if (t === 0x00E0) {               // XF
        xfs.push(dv.getUint16(p + 2, true));
      } else if (t === 0x00FC) {               // SST + CONTINUE
        const trozos = [[p + 8, l - 8]];
        while (regs[i + 1] && regs[i + 1][0] === 0x003C) { i++; trozos.push([regs[i][1], regs[i][2]]); }
        const n = dv.getUint32(p + 4, true);
        const L = lectorTexto(trozos);
        for (let k = 0; k < n && L.quedan(); k++) sst.push(L.cadena(true));
      }
    }
    const fmtDe = xf => fmts[xfs[xf]] || 'General';

    const hojas = hojasDef.map(h => {
      const filas = [];
      let i = regs.findIndex(x => x[1] - 4 === h.pos);
      if (i < 0) return { n: h.n, filas };
      let pend = null;                         // FORMULA de texto: el valor viene en el STRING siguiente
      for (i++; i < regs.length; i++) {
        const [t, p] = regs[i];
        if (t === 0x000A) break;               // EOF de la hoja
        const r = () => dv.getUint16(p, true), c = () => dv.getUint16(p + 2, true), xf = () => dv.getUint16(p + 4, true);
        if (t === 0x00FD) poner(filas, r(), c(), { v: sst[dv.getUint32(p + 6, true)] || '', t: 's', z: fmtDe(xf()) });
        else if (t === 0x0203) poner(filas, r(), c(), { v: dv.getFloat64(p + 6, true), t: 'n', z: fmtDe(xf()) });
        else if (t === 0x027E) poner(filas, r(), c(), { v: rk(dv, p + 6), t: 'n', z: fmtDe(xf()) });
        else if (t === 0x00BD) {               // MULRK
          const fila = r(), c0 = c(), l = regs[i][2], n = (l - 6) / 6;
          for (let k = 0; k < n; k++)
            poner(filas, fila, c0 + k, { v: rk(dv, p + 6 + k * 6), t: 'n', z: fmtDe(dv.getUint16(p + 4 + k * 6, true)) });
        } else if (t === 0x0204 || t === 0x00D6) poner(filas, r(), c(), { v: textoEn(p + 6, true), t: 's', z: fmtDe(xf()) });
        else if (t === 0x0205) {               // BOOLERR
          if (!wb[p + 7]) poner(filas, r(), c(), { v: !!wb[p + 6], t: 'b', z: fmtDe(xf()) });
        } else if (t === 0x0006) {             // FORMULA: resultado guardado
          if (dv.getUint16(p + 12, true) !== 0xFFFF) poner(filas, r(), c(), { v: dv.getFloat64(p + 6, true), t: 'n', z: fmtDe(xf()) });
          else if (wb[p + 6] === 0) pend = { r: r(), c: c(), z: fmtDe(xf()) };
          else if (wb[p + 6] === 1) poner(filas, r(), c(), { v: !!wb[p + 8], t: 'b', z: fmtDe(xf()) });
        } else if (t === 0x0207 && pend) {     // STRING
          poner(filas, pend.r, pend.c, { v: textoEn(p, true), t: 's', z: pend.z });
          pend = null;
        }
      }
      return { n: h.n, filas };
    });
    return { tipo: 'xls', hojas };
  }

  /* ---------------- ayudas para quien interpreta el libro ---------------- */

  /** Texto de una celda tal como se ve (sin espacios de los costados). */
  function texto(celda) {
    if (!celda) return '';
    if (celda.t === 's') return String(celda.v).trim();
    if (celda.t === 'b') return celda.v ? 'VERDADERO' : 'FALSO';
    return String(celda.v);
  }

  /** Cuántos decimales muestra un formato de número («#,##0.0000» -> 4). */
  function decimalesFormato(z) {
    const m = String(z || '').split(';')[0].match(/\.(0+)/);
    return m ? m[1].length : 0;
  }

  return { leer, texto, decimalesFormato };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LECTOR_EXCEL;
