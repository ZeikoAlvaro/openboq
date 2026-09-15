/* =========================================================================
   OpenBOQ — generador de libros .xlsx (Office Open XML) sin dependencias
   -------------------------------------------------------------------------
   Escribe un archivo XLSX real: una hoja por reporte, celdas numéricas con
   formato, encabezados con estilo y anchos de columna. Al ser un XLSX
   auténtico, Excel lo abre sin la advertencia de "formato y extensión no
   coinciden" que provoca el truco de exportar HTML con extensión .xls.
   ========================================================================= */
'use strict';

const XLSX = (() => {

  /* ------------------------- ZIP (método "stored") ------------------------ */
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

  const TE = new TextEncoder();

  /** @param {{name:string,data:Uint8Array}[]} archivos */
  function zip(archivos) {
    const partes = [], central = [];
    let off = 0;
    archivos.forEach(a => {
      const nombre = TE.encode(a.name);
      const crc = crc32(a.data), n = a.data.length;
      const lh = new Uint8Array(30 + nombre.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);            // versión
      dv.setUint16(6, 0, true);             // flags
      dv.setUint16(8, 0, true);             // método: stored
      dv.setUint16(10, 0, true);            // hora
      dv.setUint16(12, 0x2821, true);       // fecha (2000-01-01)
      dv.setUint32(14, crc, true);
      dv.setUint32(18, n, true);
      dv.setUint32(22, n, true);
      dv.setUint16(26, nombre.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nombre, 30);
      partes.push(lh, a.data);

      const cd = new Uint8Array(46 + nombre.length);
      const dc = new DataView(cd.buffer);
      dc.setUint32(0, 0x02014b50, true);
      dc.setUint16(4, 20, true);
      dc.setUint16(6, 20, true);
      dc.setUint16(8, 0, true);
      dc.setUint16(10, 0, true);
      dc.setUint16(12, 0, true);
      dc.setUint16(14, 0x2821, true);
      dc.setUint32(16, crc, true);
      dc.setUint32(20, n, true);
      dc.setUint32(24, n, true);
      dc.setUint16(28, nombre.length, true);
      dc.setUint32(42, off, true);
      cd.set(nombre, 46);
      central.push(cd);
      off += lh.length + n;
    });
    const cdIni = off;
    let cdLen = 0;
    central.forEach(c => { partes.push(c); cdLen += c.length; });
    const fin = new Uint8Array(22);
    const df = new DataView(fin.buffer);
    df.setUint32(0, 0x06054b50, true);
    df.setUint16(8, archivos.length, true);
    df.setUint16(10, archivos.length, true);
    df.setUint32(12, cdLen, true);
    df.setUint32(16, cdIni, true);
    partes.push(fin);

    let total = 0; partes.forEach(p => total += p.length);
    const out = new Uint8Array(total);
    let p = 0; partes.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }

  /* ------------------------------ utilidades ----------------------------- */
  const esc = s => String(s === undefined || s === null ? '' : s)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function col(n) {                       // 1 -> A, 27 -> AA
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
    return s;
  }
  /** Nombre de hoja válido para Excel (31 caracteres, sin : \ / ? * [ ]). */
  const nombreHoja = s => String(s || 'Hoja').replace(/[:\\\/\?\*\[\]]/g, '-').slice(0, 31);

  /* -------------------------------- estilos ------------------------------
     Índices usados en las celdas (propiedad s):
       0 normal      1 título      2 etiqueta     3 encabezado
       4 texto       5 nº 2 dec    6 nº 4 dec     7 subtotal texto
       8 subtotal nº 9 total texto 10 total nº   11 grupo
      12 centrado   13 nota       14 nº entero
     ---------------------------------------------------------------------- */
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.0000"/><numFmt numFmtId="166" formatCode="#,##0"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Calibri"/></font>
<font><i/><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEDE8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF404040"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="2" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const EST = {
    normal: 0, titulo: 1, etiqueta: 2, encab: 3, texto: 4, num: 5, num4: 6,
    subT: 7, subN: 8, totT: 9, totN: 10, grupo: 11, ctr: 12, nota: 13, ent: 14
  };

  /* --------------------------------- hoja -------------------------------- */
  function Hoja(nombre, anchos) {
    this.n = nombreHoja(nombre);
    this.anchos = anchos || [];
    this.filas = [];
    this.merges = [];
    this.congelar = 0;
  }
  /** Agrega una fila. Cada celda: {v, t:'s'|'n', s:estilo, m:nºcolumnas} */
  Hoja.prototype.fila = function (celdas) { this.filas.push(celdas || []); return this; };
  Hoja.prototype.blanco = function () { this.filas.push([]); return this; };

  Hoja.prototype.xml = function () {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (this.congelar)
      x += '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="' + this.congelar +
        '" topLeftCell="A' + (this.congelar + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    else x += '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
    x += '<sheetFormatPr defaultRowHeight="14.5"/>';
    if (this.anchos.length) {
      x += '<cols>';
      this.anchos.forEach((w, i) => {
        x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      });
      x += '</cols>';
    }
    x += '<sheetData>';
    this.filas.forEach((celdas, r) => {
      const nf = r + 1;
      x += '<row r="' + nf + '">';
      let c = 1;
      celdas.forEach(cel => {
        if (!cel) { c++; return; }
        const ref = col(c) + nf;
        const s = (cel.s === undefined ? EST.normal : cel.s);
        if (cel.t === 'n') {
          const v = Number(cel.v);
          x += '<c r="' + ref + '" s="' + s + '"><v>' + (isFinite(v) ? v : 0) + '</v></c>';
        } else {
          const v = esc(cel.v);
          x += v === ''
            ? '<c r="' + ref + '" s="' + s + '"/>'
            : '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + v + '</t></is></c>';
        }
        const m = cel.m || 1;
        if (m > 1) {
          this.merges.push(ref + ':' + col(c + m - 1) + nf);
          for (let k = 1; k < m; k++) x += '<c r="' + col(c + k) + nf + '" s="' + s + '"/>';
        }
        c += m;
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (this.merges.length)
      x += '<mergeCells count="' + this.merges.length + '">' +
        this.merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>';
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    x += '<pageSetup orientation="landscape" fitToWidth="1" paperSize="9"/>';
    return x + '</worksheet>';
  };

  /* -------------------------------- libro -------------------------------- */
  /** @param {Hoja[]} hojas @returns {Uint8Array} contenido del .xlsx */
  function libro(hojas) {
    if (!hojas.length) throw new Error('El libro no tiene hojas.');
    /* nombres únicos */
    const vistos = {};
    hojas.forEach(h => {
      let n = h.n, k = 2;
      while (vistos[n.toLowerCase()]) { n = h.n.slice(0, 28) + ' ' + (k++); }
      vistos[n.toLowerCase()] = 1; h.n = n;
    });

    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      hojas.map((h, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
        '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      hojas.map((h, i) => '<sheet name="' + esc(h.n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
      '</sheets></workbook>';

    const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hojas.map((h, i) => '<Relationship Id="rId' + (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (hojas.length + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const hoy = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:creator>OpenBOQ</dc:creator><cp:lastModifiedBy>OpenBOQ</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + hoy + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + hoy + '</dcterms:modified>' +
      '</cp:coreProperties>';

    const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>OpenBOQ</Application></Properties>';

    const f = (name, s) => ({ name, data: TE.encode(s) });
    return zip([
      f('[Content_Types].xml', ct),
      f('_rels/.rels', rels),
      f('docProps/core.xml', core),
      f('docProps/app.xml', app),
      f('xl/workbook.xml', wb),
      f('xl/_rels/workbook.xml.rels', wbRels),
      f('xl/styles.xml', STYLES)
    ].concat(hojas.map((h, i) => f('xl/worksheets/sheet' + (i + 1) + '.xml', h.xml()))));
  }

  /* --------------------------- azúcar sintáctico -------------------------- */
  const T = (v, s) => ({ v, t: 's', s: s === undefined ? EST.texto : s });
  const N = (v, s) => ({ v: Number(v) || 0, t: 'n', s: s === undefined ? EST.num : s });
  const B = () => null;

  return { Hoja, libro, zip, crc32, EST, T, N, B, col, nombreHoja };
})();
