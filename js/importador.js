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
   .CFG  estructura del análisis B-2: 17 registros de 73 bytes
           [0..49] etiqueta · [50..53] float32 % · [54..68] fórmula
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
    return {
      nombre: txt(u, 0, 70) || 'Proyecto importado',
      lugar: txt(u, 70, 60),
      cliente: txt(u, 130, 60),
      tc: Math.round(dv.getFloat32(200, true) * 10000) / 10000 || 6.96
    };
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
        t: String.fromCharCode(u[o + 2]),
        d: txt(u, o + 3, 70),
        u: txt(u, o + 75, 5),
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
        comp: []
      };
      if (!it.d) continue;
      for (let j = ptr - 1; j < ptr - 1 + 60 && j < dat.n; j++) {
        if (j < 0) continue;
        const c = dat.c[j], v = dat.v[j];
        if (c <= 0 || c > ins.length || !v) continue;
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
      filas.push({ n: txt(u, o, 50), pct: dv.getFloat32(o + 50, true), f: txt(u, o + 54, 15) });
    }
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
    guardarPlantilla(r.proyecto, zip, base);
    return r;
  }

  /** Importa desde archivos sueltos ya leídos: {PRE, IND, DAT, CFG, MOD, STT}. */
  function importarSueltos(por, nombres) {
    const r = construir(por);
    const zip = {};
    for (const ext in por) zip[(nombres && nombres[ext]) || ('proyecto.' + ext)] = por[ext];
    guardarPlantilla(r.proyecto, zip, '');
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
  function guardarPlantilla(P, zip, base) {
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
      if (ext === 'STT') { plant.stt = b64(zip[ruta].slice(190)); continue; }
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
    /* los totales que se muestran e imprimen redondean como el programa de origen (MOTOR.totalGeneral) */
    P.redondeoPrescom = true;
    ['cargas', 'ivaMO', 'herr', 'gg', 'util', 'it'].forEach(k => {
      if (typeof par[k] === 'number' && isFinite(par[k])) P.params[k] = par[k];
    });

    /* módulos: se respeta la numeración original (1..n) */
    const nMod = Math.max(mods.length, ...items.map(x => x.mod || 1), 1);
    P.modulos = [];
    for (let k = 0; k < nMod; k++)
      P.modulos.push({ id: MOTOR.nid(), n: mods[k] || ('MÓDULO # ' + (k + 1)), items: [] });
    P.moduloActivo = 0;

    /* insumos: se conserva el precio exacto del archivo original */
    const mapIns = {};
    ins.forEach(i => {
      const t = (i.t === 'O' || i.t === 'E') ? i.t : 'M';
      mapIns[i.seq] = MOTOR.agregarInsumo(t, i.d || ('INSUMO ' + i.seq), i.u || 'pza', i.p);
    });

    /* ítems */
    const avisos = [];
    const incoherentes = [];
    let difs = 0, difsPU = 0, deArchivo = 0;
    items.forEach(x => {
      const it = MOTOR.itemNuevo({
        desc: x.d, und: x.u || 'glb',
        cant: Math.round((x.cant || 0) * 1e6) / 1e6,
        origen: 'importado · ' + (cab.nombre || '')
      });
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
      /* El precio unitario del archivo pasa a mandar mientras el análisis no
         se toque (MOTOR.fijarPuDeArchivo). Así el presupuesto importado
         imprime exactamente lo mismo que el programa de origen. */
      MOTOR.fijarPuDeArchivo(it, it._puOrigen);
      /* El P.U. calculado se redondea con MOTOR.r2, igual que el del archivo:
         los dos lados de la comparación tienen que venir del mismo redondeo. */
      if (MOTOR.r2(a.puCalculado) !== it._puOrigen) {
        difsPU++;
        deArchivo++;
        avisos.push(`«${x.d}»: precio unitario del archivo ${it._puOrigen.toFixed(2)} — ` +
          `calculado ${MOTOR.r2(a.puCalculado).toFixed(2)}; se conserva el del archivo`);
      }
    });

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
      resumen: {
        nombre: cab.nombre, cliente: cab.cliente, lugar: cab.lugar, tc: cab.tc,
        modulos: P.modulos.length, items: items.length, insumos: ins.length,
        params: Object.assign({}, P.params),
        totalOrigen, totalRecalculado: MOTOR.totalProyecto(),
        totalOrigenB1, totalRecalculadoB1: MOTOR.totalGeneral(),
        difs, difsPU, deArchivo, incoherentes, avisos: avisos.slice(0, 12),
        filasCFG: par._filas || []
      }
    };
  }

  return { importarDDP, importarSueltos, leerCFG, leerSTT };
})();
