/* =========================================================================
   OpenBOQ — importador de proyectos en formato .ddp
   -------------------------------------------------------------------------
   Formato estándar de presupuestos de obra, documentado por ingeniería
   inversa. Solo lectura, no se escribe nada sobre los archivos del usuario:

   .DDP  contenedor ZIP con todos los archivos del proyecto
   .STT  cabecera: nombre(70) + lugar(60) + cliente(60) + ... + T/C (float32 @200)
   .MOD  módulos: registros de 50 caracteres
   .IND  índice de insumos: registros de 92 bytes
           [2]      tipo  M / O / E
           [3..72]  descripción (70)
           [75..79] unidad (5)
           [88..91] int32 puntero al .DAT (1-based)
   .DAT  vector de pares (int32 código, float32 valor)
           · el par en (puntero-1) de un insumo guarda su PRECIO
           · un ítem del presupuesto ocupa 60 pares consecutivos desde
             (puntero-1); cada par es (secuencia de insumo, rendimiento)
   .PRE  presupuesto: registros de 460 bytes
           [2..3]     uint16 módulo
           [4..73]    descripción (70)
           [76..80]   unidad (5)
           [81..84]   int32 puntero al .DAT
           [85..92]   double cantidad
           [108..115] double precio unitario   [116] materiales
           [124] mano de obra                  [132] equipo
   .STT  [712..719] cuatro int16: precisión con la que se calculó (4,3,4,2
           de fábrica). Ver MOTOR.precisionOrigen.
   .CFG  estructura del análisis B-2: 17 registros de 73 bytes
           [0..49] etiqueta · [50..53] float32 % (−1 = suma) · [54..68]
           fórmula (letras A-Q = filas, + y -, «*» = entrada)
           [69..72] int16 id + int16 negrita. Ver formatoDesdeCFG.

   Campos descifrados el 22/10/2026 (informe de ingeniería inversa §10). Se
   leen para devolverlos al exportar —sin ellos el proyecto vuelve al programa
   de origen con los cómputos en otros ítems y sin especificaciones—:
   .PRE  [74] int16 grupo del ítem · [93..107] código · [172] double horas
         por unidad · [180] uint16 cuadrillas · [182..437] especificación
         corta · [438]/[446] double fechas de inicio y fin · [454] int16
         predecesora (n.º de orden; 0 o −1 = ninguna) · [456] uint16 ID DEL
         ÍTEM, que es la clave del .CMM · [458] n.º de orden
   .IND  [0..1] int16 −1 = registro dado de baja · [73..74] int16 grupo ·
         [80..87] double fecha de cotización
   .CMM  cómputos métricos, 62 bytes: [0] int16 id del ítem (PRE 456) ·
         [2..31] descripción · [32..47] float32 X, Y, Z, veces
   <NOMBRE>_ET/NNNNN.RTF  especificación técnica del ítem n.º NNNNN
   ========================================================================= */
'use strict';

const IMPORTADOR = (() => {

  const td = new TextDecoder('windows-1252');
  const txt = (b, i, n) => td.decode(b.slice(i, i + n)).replace(/\u0000/g, ' ').trim();

  /* ---------------- recuperación de números Single ------------------------
     Los precios y los rendimientos se guardan en el .DAT como float32 (Single
     de 4 bytes), así que el número que tecleó el usuario no vuelve tal cual:
     un precio de 165.006,40 se lee como 165006.40625 y uno de 87,15 como
     87.150002. Si se calcula con esos valores el costo directo se corre unos
     centavos, y en ítems grandes el precio unitario ya no coincide con el que
     el archivo trae guardado.

     Se devuelve el número con menos decimales que vuelve a dar exactamente el
     mismo float32 — que es el que se escribió. Verificado contra los proyectos
     de muestra: los subtotales de materiales, mano de obra y equipo y los
     precios unitarios salen idénticos a los guardados en el .PRE.            */
  function single(v) {
    const f = Math.fround(v);
    if (!isFinite(f) || f === 0) return 0;
    for (let d = 0; d <= 7; d++) {
      const p = Math.pow(10, d);
      const c = Math.round(f * p + Number.EPSILON * 1e6) / p;
      if (Math.fround(c) === f) return c;
    }
    return f;
  }

  /* ---------------- ZIP mínimo (deflate nativo del navegador) ------------- */
  async function descomprimir(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const out = {};
    let i = 0;
    while (i + 30 <= u8.length) {
      if (dv.getUint32(i, true) !== 0x04034b50) break;
      const metodo = dv.getUint16(i + 8, true);
      const flags = dv.getUint16(i + 6, true);
      let comp = dv.getUint32(i + 18, true);
      const nlen = dv.getUint16(i + 26, true);
      const elen = dv.getUint16(i + 28, true);
      const nombre = td.decode(u8.slice(i + 30, i + 30 + nlen));
      const ini = i + 30 + nlen + elen;
      if (flags & 8 && !comp) throw new Error('El ZIP usa descriptores de datos; no se puede leer.');
      const datos = u8.slice(ini, ini + comp);
      out[nombre] = metodo === 0 ? datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.length)
        : await inflar(datos);
      i = ini + comp;
    }
    if (!Object.keys(out).length) throw new Error('El archivo no parece un contenedor .DDP válido.');
    return out;
  }

  async function inflar(u8) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('Este navegador no puede descomprimir el .DDP. Use Chrome o Edge actualizado.');
    const ds = new DecompressionStream('deflate-raw');
    const rs = new ReadableStream({ start(c) { c.enqueue(u8); c.close(); } });
    return await new Response(rs.pipeThrough(ds)).arrayBuffer();
  }

  /* ---------------- lectura de cada archivo ---------------- */
  function leerSTT(b) {
    if (!b || b.byteLength < 204) return {};
    const u = new Uint8Array(b), dv = new DataView(b);
    /* Bytes 712-719: la precisión con la que el programa de origen calculó
       este proyecto (cuatro int16; de fábrica 4,3,4,2). Encontrada por
       ingeniería inversa el 14/10/2026: al copiar el «formato de cálculo» de
       otro proyecto, el programa la lee de acá. Ver MOTOR.precisionOrigen. */
    let precision = null;
    if (b.byteLength >= 720) {
      const q = [0, 1, 2, 3].map(k => dv.getInt16(712 + 2 * k, true));
      if (q.every(v => v >= 0 && v <= 8)) precision = q;
    }
    return {
      nombre: txt(u, 0, 70) || 'Proyecto importado',
      lugar: txt(u, 70, 60),
      cliente: txt(u, 130, 60),
      fecha: b.byteLength >= 198 ? fechaOLE(dv.getFloat64(190, true)) : '',
      tc: Math.round(dv.getFloat32(200, true) * 10000) / 10000 || 6.96,
      precision
    };
  }

  /** Fecha OLE (días desde el 30/12/1899) a 'AAAA-MM-DD'; vacío si no es una fecha razonable. */
  function fechaOLE(d) {
    if (!isFinite(d) || d < 2 || d > 120000) return '';
    const t = new Date(Date.UTC(1899, 11, 30) + Math.round(d) * 86400000);
    return t.toISOString().slice(0, 10);
  }
  const diaOLE = d => (isFinite(d) && d > 2 && d < 120000) ? Math.round(d) : 0;

  /** .CMM: filas de cómputo agrupadas por id de ítem (PRE 456). */
  function leerCMM(b) {
    const out = new Map();
    if (!b) return out;
    const u = new Uint8Array(b), dv = new DataView(b), R = 62;
    for (let k = 0; (k + 1) * R <= u.length; k++) {
      const o = k * R;
      const id = dv.getInt16(o, true);
      const f = [0, 1, 2, 3].map(j => single(dv.getFloat32(o + 32 + 4 * j, true)));
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ d: txt(u, o + 2, 30), x: f[0], y: f[1], z: f[2], v: f[3] });
    }
    return out;
  }

  function leerMOD(b) {
    if (!b) return [];
    const u = new Uint8Array(b), out = [];
    for (let i = 0; i + 50 <= u.length; i += 50) {
      const n = txt(u, i, 50);
      if (n) out.push(n);
    }
    return out;
  }

  function leerDAT(b) {
    const dv = new DataView(b), n = Math.floor(b.byteLength / 8), c = new Int32Array(n), v = new Float32Array(n);
    for (let k = 0; k < n; k++) { c[k] = dv.getInt32(k * 8, true); v[k] = dv.getFloat32(k * 8 + 4, true); }
    return { c, v, n };
  }

  function leerIND(b, dat) {
    const u = new Uint8Array(b), dv = new DataView(b), R = 92, out = [];
    for (let k = 0; k * R + R <= u.length; k++) {
      const o = k * R;
      const ptr = dv.getInt32(o + 88, true);
      out.push({
        seq: k + 1,
        baja: dv.getInt16(o, true) === -1,
        t: String.fromCharCode(u[o + 2]),
        d: txt(u, o + 3, 70),
        grp: dv.getInt16(o + 73, true),
        u: txt(u, o + 75, 5),
        f: fechaOLE(dv.getFloat64(o + 80, true)),
        p: (ptr > 0 && ptr <= dat.n) ? single(dat.v[ptr - 1]) : 0
      });
    }
    return out;
  }

  function leerPRE(b, dat, ins) {
    const u = new Uint8Array(b), dv = new DataView(b), R = 460, out = [];
    for (let k = 0; k * R + R <= u.length; k++) {
      const o = k * R;
      const ptr = dv.getInt32(o + 81, true);
      const it = {
        mod: dv.getUint16(o + 2, true),
        d: txt(u, o + 4, 70),
        u: txt(u, o + 76, 5),
        cant: dv.getFloat64(o + 85, true),
        pu: dv.getFloat64(o + 108, true),
        mat: dv.getFloat64(o + 116, true),
        mo: dv.getFloat64(o + 124, true),
        eq: dv.getFloat64(o + 132, true),
        us: [140, 148, 156, 164].map(x => dv.getFloat64(o + x, true)),
        pos: k + 1,
        px: {
          id: dv.getUint16(o + 456, true),
          grp: dv.getInt16(o + 74, true),
          h: dv.getFloat64(o + 172, true),
          cuad: dv.getUint16(o + 180, true),
          espec: txt(u, o + 182, 256),
          fIni: diaOLE(dv.getFloat64(o + 438, true)),
          fFin: diaOLE(dv.getFloat64(o + 446, true)),
          p454: dv.getInt16(o + 454, true)
        },
        cod: txt(u, o + 93, 15),
        comp: []
      };
      if (!it.d) continue;
      if (!isFinite(it.px.h)) it.px.h = 0;
      /* Un renglón con rendimiento 0 también es parte del análisis (el
         programa de origen lo muestra): se conserva. Solo se descartan los
         pares vacíos y los que apuntan fuera del índice. */
      for (let j = ptr - 1; j < ptr - 1 + 60 && j < dat.n; j++) {
        if (j < 0) continue;
        const c = dat.c[j], v = dat.v[j];
        if (c <= 0 || c > ins.length) continue;
        it.comp.push({ seq: c, rend: single(v) });
      }
      out.push(it);
    }
    return out;
  }

  /** Estructura del B-2 configurada en el proyecto (porcentajes reales). */
  function leerCFG(b) {
    const p = {};
    if (!b) return p;
    const u = new Uint8Array(b), dv = new DataView(b), R = 73;
    const filas = [];
    for (let k = 0; k * R + R <= u.length; k++) {
      const o = k * R;
      filas.push({ n: txt(u, o, 50), pct: dv.getFloat32(o + 50, true), f: txt(u, o + 54, 15),
                   px: [u[o + 69], u[o + 70], u[o + 71], u[o + 72]] });
    }
    p._todas = filas;
    const buscar = re => { const f = filas.find(x => re.test(x.n) && x.pct >= 0); return f ? Math.round(f.pct * 100) / 100 : null; };
    const map = {
      cargas: /CARGAS?\s+SOCIAL/i,
      ivaMO: /IVA/i,
      herr: /HERRAMIENTA/i,
      gg: /GASTOS?\s+GENERAL/i,
      util: /UTILIDAD/i,
      it: /\bI\.?T\b|TRANSACCION/i
    };
    for (const k in map) { const v = buscar(map[k]); if (v !== null) p[k] = v; }
    p._filas = filas.filter(x => x.n);
    return p;
  }

  /* ---------------------------------------------------------------------
     LA HOJA B-2 DEL ARCHIVO, COMO FÓRMULAS

     El .CFG no son seis porcentajes: son 17 filas y cada una dice cómo se
     calcula. La fórmula usa letras —la fila 1 es la A— con + y -, y «*»
     marca las tres entradas (materiales, mano de obra, equipo). Si la fila
     tiene porcentaje, vale ese porcentaje de la suma; si no (−1), vale la
     suma. Una fila puede nombrar a otra que está más abajo: en el oficial,
     TOTAL MANO DE OBRA = E+F+O, y O es el IVA.

     Antes se buscaban los porcentajes por la ETIQUETA de la fila y se
     volcaban en la cadena oficial. Con la hoja oficial da lo mismo; con otra
     —«Beneficios sociales» sobre B, la utilidad sobre J, sin IVA— la cadena
     quedaba con 55 % de cargas que el archivo no tiene.

     Ahora:
       · si la hoja ES la oficial (mismas fórmulas, mismos lugares), se usa el
         formato oficial y los porcentajes se toman por POSICIÓN;
       · si no, se arma un formato propio con las fórmulas del archivo, que el
         motor calcula igual que el programa de origen.
     --------------------------------------------------------------------- */
  const SABS_F = ['*', '*', '*', 'A', 'B', 'E', 'E+F+O', 'G', 'C+H', 'D+G+I', '', 'J', 'J+L', 'J+L+M', 'E+F', 'N', 'N+P'];
  const SABS_PCT = { 5: 'cargas', 7: 'herr', 11: 'gg', 12: 'util', 14: 'ivaMO', 15: 'it' };
  const normF = s => String(s || '').replace(/\s+/g, '').toUpperCase();

  /** ¿La hoja del archivo es la oficial? La fila 11 (vacía en el oficial) no
      la nombra ninguna otra, así que lo que tenga no cambia el precio. */
  function esHojaOficial(todas) {
    if (!todas || todas.length !== 17) return false;
    return todas.every((x, i) => {
      if (i === 10) return true;
      if (normF(x.f) !== SABS_F[i]) return false;
      return (i in SABS_PCT) ? x.pct >= 0 : x.pct < 0;
    });
  }

  /**
   * Convierte las filas del .CFG en un formato del motor.
   * @returns {{formato:Object}|{error:string}}
   */
  function formatoDesdeCFG(todas, nombreProyecto) {
    /* La conversión vive en el motor (MOTOR.formatoDesdeHoja) porque la usan
       también las plantillas de INCIDENCIAS; acá solo se recupera el
       porcentaje que se tecleó (el archivo lo guarda como float32). */
    return MOTOR.formatoDesdeHoja((todas || []).map(x => Object.assign({}, x,
      { pct: x.pct >= 0 ? single(x.pct) : -1 })), {
      nombre: 'Hoja B-2 del .ddp' + (nombreProyecto ? ' — ' + String(nombreProyecto).slice(0, 40) : ''),
      nota: 'Leída del archivo importado, fila por fila y con sus fórmulas. Se calcula igual que en el programa de origen.',
      origen: 'ddp'
    });
  }

  /* =====================================================================
     IMPORTACIÓN COMPLETA
     ===================================================================== */
  /**
   * @param {ArrayBuffer} buf contenido del .DDP
   * @returns {{proyecto:Object, resumen:Object}}
   */
  async function importarDDP(buf) {
    const zip = await descomprimir(buf);
    const por = {};
    let base = '';
    for (const ruta in zip) {
      const arch = ruta.split('/').pop();
      const ext = (arch.split('.').pop() || '').toUpperCase();
      por[ext] = zip[ruta];
      if (ext === 'PRE') base = arch.replace(/\.[^.]+$/, '');
    }
    const r = construir(por);
    guardarPlantilla(r.proyecto, zip, base, r.porPos);
    delete r.porPos;
    return r;
  }

  /** Importa desde archivos sueltos ya leídos: {PRE, IND, DAT, CFG, MOD, STT}. */
  function importarSueltos(por, nombres) {
    const r = construir(por);
    const zip = {};
    for (const ext in por) zip[(nombres && nombres[ext]) || ('proyecto.' + ext)] = por[ext];
    guardarPlantilla(r.proyecto, zip, '', r.porPos);
    delete r.porPos;
    return r;
  }

  /* ---------------------------------------------------------------------
     LA PLANTILLA PARA EL CAMINO DE VUELTA

     De un .ddp OpenBOQ entiende siete archivos y los vuelve a escribir al
     exportar; los otros —.ADI, .IMP, .GRP, el membrete— no los usa para
     nada, pero el programa de origen sí. Se guardan tal cual dentro del proyecto (en
     base64, así viajan también en el .boq) para devolverlos intactos.
     Los siete que se regeneran no se guardan: serían peso muerto.
     --------------------------------------------------------------------- */
  function guardarPlantilla(P, zip, base, porPos) {
    if (!P || typeof btoa !== 'function') return;
    const regen = (typeof EXPORTADOR !== 'undefined' && EXPORTADOR.GENERADOS) ||
      ['PRE', 'IND', 'DAT', 'MOD', 'STT', 'CFG', 'TIE'];
    const b64 = buf => {
      const u = new Uint8Array(buf); let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const plant = { base: base || '', archivos: {}, otros: {}, stt: '' };
    for (const ruta in zip) {
      const arch = ruta.split('/').pop();
      const ext = (arch.split('.').pop() || '').toUpperCase();
      /* Especificaciones técnicas: <NOMBRE>_ET/NNNNN.RTF, donde NNNNN es el
         n.º de orden del ítem. Se guardan EN EL ÍTEM, así siguen a su ítem
         aunque se reordene o se agreguen otros; el exportador las vuelve a
         numerar y a meter en la carpeta con el nombre nuevo. */
      const et = /_ET\/(\d+)\.RTF$/i.exec(ruta);
      if (et && porPos && porPos[Number(et[1])]) {
        porPos[Number(et[1])].px.rtf = b64(zip[ruta]);
        continue;
      }
      if (ext === 'STT') { plant.stt = b64(zip[ruta].slice(190)); continue; }
      if (ext === 'CFG') { plant.cfg = b64(zip[ruta]); continue; }        // la hoja original, para devolverla igual
      if (ext === 'TIE') { plant.archivos.TIE = b64(zip[ruta]); continue; }   // por las fechas de cada módulo
      if (regen.indexOf(ext) >= 0) continue;
      if (/^(ADI|CEQ|CMM|GRP|IMP|PLA)$/.test(ext)) plant.archivos[ext] = b64(zip[ruta]);
      else plant.otros[arch] = b64(zip[ruta]);                                // logo.jpg, sello.jpg…
    }
    P.prescom = plant;
  }

  function construir(por) {
    if (!por.PRE || !por.IND || !por.DAT)
      throw new Error('Faltan archivos del proyecto (.PRE, .IND y .DAT son obligatorios).');
    const cab = leerSTT(por.STT);
    const dat = leerDAT(por.DAT);
    const ins = leerIND(por.IND, dat);
    const items = leerPRE(por.PRE, dat, ins);
    const mods = leerMOD(por.MOD);
    const par = leerCFG(por.CFG);

    /* --- proyecto nuevo en el modelo de OpenBOQ --- */
    const P = MOTOR.proyectoNuevo(cab.nombre || 'Proyecto importado');
    P.entidad = cab.cliente || '';
    P.ubicacion = cab.lugar || '';
    P.tc = cab.tc || 6.96;
    if (cab.fecha) P.fecha = cab.fecha;          // fecha del proyecto (STT 190), no la de hoy
    /* los totales que se muestran e imprimen redondean como el programa de origen (MOTOR.totalGeneral) */
    P.redondeoPrescom = true;
    ['cargas', 'ivaMO', 'herr', 'gg', 'util', 'it'].forEach(k => {
      if (typeof par[k] === 'number' && isFinite(par[k])) P.params[k] = par[k];
    });
    /* cómo calculaba el archivo (ver MOTOR.precisionOrigen): porcentajes
       float32 y la precisión del .STT */
    P.calcOrigen = { pct32: true, precision: cab.precision || null };

    /* la hoja B-2 del archivo: oficial por posición, o formato propio */
    const avisosHoja = [];
    let hoja = 'etiquetas';
    if (esHojaOficial(par._todas)) {
      hoja = 'oficial';
      for (const i in SABS_PCT) P.params[SABS_PCT[i]] = single(par._todas[i].pct);
    } else if (par._todas && par._todas.length) {
      const r = formatoDesdeCFG(par._todas, cab.nombre);
      if (r.formato) {
        hoja = 'propia';
        MOTOR.usarFormato(r.formato);
        avisosHoja.push('La hoja B-2 del archivo no es la oficial: se cargó como formato propio «' +
          r.formato.n + '», con las fórmulas del archivo (ver INCIDENCIAS).');
      } else {
        avisosHoja.push('La hoja B-2 del archivo no es la oficial y no se pudo leer como fórmulas (' + r.error +
          '); se usan sus porcentajes sobre el formato oficial.');
      }
    }

    /* módulos: se respeta la numeración original (1..n) */
    const nMod = Math.max(mods.length, ...items.map(x => x.mod || 1), 1);
    P.modulos = [];
    for (let k = 0; k < nMod; k++)
      P.modulos.push({ id: MOTOR.nid(), n: mods[k] || ('MÓDULO # ' + (k + 1)), items: [] });
    P.moduloActivo = 0;

    /* insumos: se conserva el precio exacto del archivo original.
       Los DADOS DE BAJA (IND 0-1 = −1: «borrar registros», «borrar
       repetidos», «eliminar insumos no requeridos») que ningún ítem usa no
       entran: para el programa de origen ya no existen. Si algún ítem todavía
       los usa, entran —el precio unitario depende de ellos— y conservan la
       marca para devolverla igual. Grupo y fecha de cotización viajan en
       `px`; la fecha NO pasa a `f` (fecha decidida en OpenBOQ, ver
       MOTOR.fijarPrecio): es la que traía el archivo y vuelve igual. */
    const usados = new Set();
    items.forEach(x => x.comp.forEach(c => usados.add(c.seq)));
    const mapIns = {};
    let deBaja = 0;
    ins.forEach(i => {
      if (i.baja && !usados.has(i.seq)) { deBaja++; return; }
      const t = (i.t === 'O' || i.t === 'E') ? i.t : 'M';
      const x = MOTOR.agregarInsumo(t, i.d || ('INSUMO ' + i.seq), i.u || 'pza', i.p);
      if (!x.px) {
        const px = {};
        if (i.grp) px.grp = i.grp;
        if (i.f) px.f = i.f;
        if (i.baja) px.baja = true;
        if (Object.keys(px).length) x.px = px;
      }
      mapIns[i.seq] = x;
    });
    const cmm = leerCMM(por.CMM);

    /* ítems */
    const avisos = [];
    const incoherentes = [];
    let difs = 0, difsPU = 0, deArchivo = 0;
    const porPos = {};                 // n.º de orden en el .PRE -> ítem (RTF y predecesoras)
    let conComputo = 0;
    items.forEach(x => {
      const it = MOTOR.itemNuevo({
        desc: x.d, und: x.u || 'glb',
        cant: Math.round((x.cant || 0) * 1e6) / 1e6,
        cod: x.cod || '',
        origen: 'importado · ' + (cab.nombre || '')
      });
      /* lo que el programa de origen guarda del ítem y OpenBOQ no usa para
         calcular: vuelve tal cual al exportar (EXPORTADOR, .PRE) */
      const px = { id: x.px.id, h: x.px.h, cuad: x.px.cuad };
      ['grp', 'fIni', 'fFin', 'p454'].forEach(k => { if (x.px[k]) px[k] = x.px[k]; });
      if (x.px.espec) px.espec = x.px.espec;
      it.px = px;
      porPos[x.pos] = it;
      /* cómputos métricos: el .CMM se enlaza por el ID del ítem (PRE 456),
         no por su posición. X, Y, Z → largo, ancho, alto; una medida en
         cero queda vacía (no multiplica), igual que en el programa de origen */
      const filas = cmm.get(x.px.id);
      if (filas && filas.length) {
        conComputo++;
        it.computos = filas.map(f => ({ d: f.d, n: f.v, l: f.x || '', a: f.y || '', h: f.z || '', ar: '', vo: '' }));
      }
      x.comp.forEach(c => {
        const i = mapIns[c.seq];
        if (i) it.comp.push({ ins: i.id, rend: c.rend });
      });
      const m = P.modulos[Math.max(0, (x.mod || 1) - 1)] || P.modulos[0];
      m.items.push(it);
      /* control: los costos netos deben coincidir con los del archivo.
         -------------------------------------------------------------------
         LOS DOS LADOS SE COMPARAN EN CRUDO. Redondear antes de comparar
         inventaba diferencias que no existen, por dos motivos distintos:

         · El .PRE no guarda los subtotales con toda la precisión del
           cálculo: `0.035×140 + 1×100 + 1.489×1.40` da `106.9846` y el
           archivo trae `106.985`. Redondear los dos a 2 decimales manda uno
           a `106.98` y el otro a `106.99`: un centavo de diferencia que solo
           existe por haber redondeado dos veces.
         · Un subtotal que cae justo en la mitad —`2.175`, `601.425`— es un
           empate, y `Math.round` y `MOTOR.r2` lo resuelven para lados
           distintos: `2.175 * 100` da `217.49999999999997` en punto flotante,
           así que `Math.round` baja a `2.17` mientras `MOTOR.r2`, que corrige
           ese error, sube a `2.18`. Comparar un valor redondeado por una vía
           contra otro redondeado por la otra fabrica el centavo entero.

         Medio centavo por grupo es la tolerancia con sentido: es lo que se
         pierde al guardar, y es lo mínimo que se ve impreso. Lo que la pasa
         es que el archivo de verdad no cuadra consigo mismo. */
      const a = MOTOR.analisis(it);
      const d = Math.abs(a.matX - (x.mat || 0)) + Math.abs(a.moX - (x.mo || 0)) + Math.abs(a.eqX - (x.eq || 0));
      if (d > 0.005) {
        /* El archivo se contradice a sí mismo: el subtotal que declara no es
           el que sale de sus propios insumos. Pasa cuando el programa de origen guardó el
           análisis y después algo cambió sin recalcularlo. No hay forma de
           reproducirlo —faltaría un insumo que no está—, así que se avisa
           aparte y no se mezcla con las diferencias de redondeo. */
        difs++;
        incoherentes.push({
          desc: x.d,
          calc: { m: a.matX, o: a.moX, e: a.eqX },
          arch: { m: x.mat || 0, o: x.mo || 0, e: x.eq || 0 },
          falta: MOTOR.r2(((x.mat || 0) + (x.mo || 0) + (x.eq || 0)) - (a.matX + a.moX + a.eqX))
        });
        avisos.push(`«${x.d}»: el archivo declara M ${(x.mat || 0).toFixed(3)} / O ${(x.mo || 0).toFixed(3)} / E ${(x.eq || 0).toFixed(3)} ` +
          `y sus propios insumos suman M ${a.matX.toFixed(3)} / O ${a.moX.toFixed(3)} / E ${a.eqX.toFixed(3)}`);
      }
      /* MOTOR.r2 y no Math.round: el mismo empate de arriba. */
      it._puOrigen = MOTOR.r2(x.pu || 0);
      /* Los subtotales tal como quedaron en el archivo. Se guardan para poder
         comparar después —herramientas/diagnosticar_ddp.js— sin volver a
         abrir el archivo: cuando algo no cierra al centavo, la pregunta
         siempre es «¿de dónde salió ese número?». */
      it._dirOrigen = { m: x.mat, o: x.mo, e: x.eq };
      /* las columnas en dólares: el programa de origen las calcula aparte
         (cada precio ÷ T.C., con su redondeo); vuelven iguales si no se toca */
      if (x.us.every(v => isFinite(v))) { it._dirOrigen.us = x.us; it._dirOrigen.tc = P.tc; }
    });

    /* CRONOGRAMA del archivo: fechas de inicio y fin de cada ítem y la
       predecesora (PRE 438/446/454). Si el archivo trae fechas, pasan al
       cronograma de OpenBOQ —día relativo al inicio de obra, días calendario
       con el último incluido, predecesora por n.º de actividad—; si no trae,
       el cronograma queda como siempre, para calcularlo acá. */
    const nAct = new Map(MOTOR.actividades().map(a => [a.it, a.n]));
    Object.values(porPos).forEach(it => {
      const q = it.px.p454 > 0 ? porPos[it.px.p454] : null;
      if (q && q !== it && nAct.has(q)) it.pred = String(nAct.get(q));
    });
    const conFecha = Object.values(porPos).filter(it => it.px.fIni > 0);
    if (conFecha.length) {
      const ini0 = Math.min(...conFecha.map(it => it.px.fIni));
      P.inicioObra = fechaOLE(ini0) || P.inicioObra;
      let fin = 1;
      conFecha.forEach(it => {
        const f1 = Math.max(it.px.fFin || it.px.fIni, it.px.fIni);
        it.inicio = it.px.fIni - ini0;
        it.dias = f1 - it.px.fIni + 1;
        fin = Math.max(fin, it.inicio + it.dias);
      });
      P.plazo = fin;
    }

    /* Cómo redondeaba la instalación de origen lo que el .STT no dice (filas
       del B-2): se deduce contra los P.U. del archivo (MOTOR.elegirReceta).
       Va antes de fijar los P.U., porque la huella del análisis depende de
       la receta. */
    const receta = MOTOR.elegirReceta();

    P.modulos.forEach(m => m.items.forEach(it => {
      /* El precio unitario del archivo pasa a mandar mientras el análisis no
         se toque (MOTOR.fijarPuDeArchivo). Así el presupuesto importado
         imprime exactamente lo mismo que el programa de origen. */
      MOTOR.fijarPuDeArchivo(it, it._puOrigen);
      /* El P.U. calculado se redondea con MOTOR.r2, igual que el del archivo:
         los dos lados de la comparación tienen que venir del mismo redondeo. */
      const a = MOTOR.analisis(it);
      if (MOTOR.r2(a.puCalculado) !== it._puOrigen) {
        difsPU++;
        deArchivo++;
        avisos.push(`«${it.desc}»: precio unitario del archivo ${it._puOrigen.toFixed(2)} — ` +
          `calculado ${MOTOR.r2(a.puCalculado).toFixed(2)}; se conserva el del archivo`);
      }
    }));

    /* El total del archivo se arma como lo imprime el Formulario B-1: cada ítem
       redondeado a 2 decimales y recién después la suma. */
    const totalOrigen = MOTOR.r2(items.reduce((s, x) =>
      s + MOTOR.r2(MOTOR.r2(x.pu || 0) * (x.cant || 0)), 0));

    /* Lo que se MUESTRA al importar: el total como lo imprime el B-1 de
       el programa de origen (parciales redondeados al par, ver MOTOR.totalGeneral), de los
       dos lados. El control de arriba sigue con la suma de parciales. */
    const totalOrigenB1 = MOTOR.r2(items.reduce((s, x) =>
      s + MOTOR.r2par(MOTOR.r2(x.pu || 0) * (x.cant || 0)), 0));

    return {
      proyecto: P,
      porPos,
      resumen: {
        nombre: cab.nombre, cliente: cab.cliente, lugar: cab.lugar, tc: cab.tc,
        modulos: P.modulos.length, items: items.length, insumos: ins.length,
        insumosDeBaja: deBaja, itemsConComputo: conComputo, itemsConFechas: conFecha.length,
        params: Object.assign({}, P.params),
        totalOrigen, totalRecalculado: MOTOR.totalProyecto(),
        totalOrigenB1, totalRecalculadoB1: MOTOR.totalGeneral(),
        difs, difsPU, deArchivo, incoherentes, avisos: avisosHoja.concat(avisos).slice(0, 12),
        filasCFG: par._filas || [],
        hoja, precision: cab.precision || null, receta,
        precisionFabrica: !MOTOR.precisionOrigen()
      }
    };
  }

  return { importarDDP, importarSueltos, leerCFG, leerSTT };
})();
