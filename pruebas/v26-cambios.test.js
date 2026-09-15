/* =========================================================================
   v2.6 — los cuatro cambios de la auditoría, y lo que NO tienen que romper
   -------------------------------------------------------------------------
   Se cubren:

     O-4  fecha del precio en los insumos
     O-5  catálogo cifrado para el sitio publicado
     O-6  cadena de incidencias editable (formatos)
     O-7  edición masiva: matriz, factor, fusión y carga en lote

   Y sobre todo lo que no puede romperse por culpa de ninguno de ellos:
   **importar y exportar PRESCOM**. Un .ddp real entra, se lo somete a las
   cuatro novedades y tiene que seguir saliendo igual, al centavo. Es el
   camino por el que los proyectos van y vuelven de las unidades solicitantes;
   si se rompe, no avisa: el archivo se abre y los números están mal.
   ========================================================================= */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///app/index.html' });
const w = dom.window;
const errores = [];
w.alert = m => errores.push('ALERT: ' + m);
['DecompressionStream', 'CompressionStream', 'ReadableStream', 'Blob', 'Response',
  'TextDecoder', 'TextEncoder', 'URL', 'atob', 'btoa'].forEach(k => { if (!w[k]) w[k] = globalThis[k]; });
/* jsdom trae un `crypto` propio SIN `subtle`, expuesto como propiedad de solo
   lectura: asignarle encima no hace nada y falla en silencio. Se redefine, que
   es la única forma. Sin WebCrypto no se puede probar el descifrado, y en el
   navegador de verdad `crypto.subtle` siempre está. */
Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true, writable: true });
w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => { };

const src = ['data/catalogo.js', 'js/cifrado.js', 'js/motor.js', 'js/importador.js',
  'js/exportador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;window.MOTOR=MOTOR;window.IMPORTADOR=IMPORTADOR;window.EXPORTADOR=EXPORTADOR;window.CIFRADO=CIFRADO;';
try { w.eval(src); } catch (e) { console.log('EVAL ERROR', e); process.exit(1); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) errores.push(m); };
const M = w.MOTOR;

/* Un proyecto chico y conocido, para las cuentas exactas. */
function proyectoBase() {
  M.proyectoNuevo('PRUEBA v2.6');
  const cem = M.agregarInsumo('M', 'CEMENTO PORTLAND', 'kg', 1.20);
  const alb = M.agregarInsumo('O', 'ALBAÑIL', 'hr', 20.00);
  const mez = M.agregarInsumo('E', 'MEZCLADORA', 'hr', 35.00);
  const it = M.addItem({ desc: 'HORMIGÓN DE PRUEBA', und: 'm³', cant: 10 });
  it.comp = [{ ins: cem.id, rend: 300 }, { ins: alb.id, rend: 4 }, { ins: mez.id, rend: 1 }];
  return { cem, alb, mez, it };
}

/* ======================================================================
   O-4 · FECHA DEL PRECIO
   ====================================================================== */
console.log('== O-4 · fecha del precio ==');
{
  const { cem } = proyectoBase();
  const hoy = M.fechaHoy();

  ok(!cem.f, 'un insumo creado sin fechar no trae fecha');

  ok(M.fijarPrecio(cem, 1.35) === true, 'cambiar el precio devuelve true');
  ok(cem.p === 1.35, 'el precio quedó escrito');
  ok(cem.f === hoy, 'y quedó fechado hoy: ' + cem.f);

  const antes = cem.f;
  cem.f = '2020-01-01';
  ok(M.fijarPrecio(cem, 1.35) === false, 'escribir el MISMO precio no es una modificación');
  ok(cem.f === '2020-01-01', 'y por lo tanto no mueve la fecha: ' + cem.f);
  cem.f = antes;

  ok(M.fijarPrecio(cem, 2.00, false) === true && cem.f === antes,
    'un precio ajeno (fechar=false) cambia el número pero no inventa fecha');

  const nuevo = M.agregarInsumo('M', 'ARENA FINA', 'm³', 200, false, true);
  ok(nuevo.f === hoy, 'un insumo cargado a mano nace fechado');

  const sinFecha = M.agregarInsumo('M', 'GRAVA', 'm³', 180, false);
  ok(!sinFecha.f, 'uno traído de un archivo, no');

  /* la fecha viaja en el .boq */
  const txt = M.serializar();
  M.deserializar(txt);
  const leido = Object.values(M.proyecto().insumos).find(x => x.d === 'ARENA FINA');
  ok(leido && leido.f === hoy, 'la fecha sobrevive a guardar y abrir el .boq');
}

/* ======================================================================
   O-6 · CADENA DE INCIDENCIAS EDITABLE
   ====================================================================== */
console.log('== O-6 · formatos de incidencias ==');
let puOficial = 0;
{
  const { it } = proyectoBase();
  puOficial = M.analisis(it).pu;

  ok(M.formatoEsOficial(), 'un proyecto nuevo arranca con el formato oficial');
  ok(M.formato().filas.length === 15, 'la cadena oficial tiene 15 filas');
  ok(M.formato().filas.filter(f => f.k === 'ent').length === 3,
    'las tres primeras son las entradas del análisis');

  /* la cadena reproduce EXACTAMENTE la aritmética vieja del B-2 */
  const p = M.proyecto().params, a = M.analisis(it);
  const Mx = 360, Ox = 80, Ex = 35;
  const cargas = Ox * p.cargas / 100, iva = (Ox + cargas) * p.ivaMO / 100;
  const tmo = Ox + cargas + iva, herr = tmo * p.herr / 100, teq = Ex + herr;
  const sub = Mx + tmo + teq, gg = sub * p.gg / 100, par2 = sub + gg;
  const util = par2 * p.util / 100, par3 = par2 + util, itx = par3 * p.it / 100;
  ok(Math.abs(a.pu - M.r2(par3 + itx)) < 1e-9,
    'el precio unitario sale igual que con la cadena escrita a mano: ' + a.pu);
  ok(a.cadena.length === 15, 'el análisis devuelve la cadena corrida, fila por fila');

  /* --- el listado: el oficial está siempre y no se puede sacar --- */
  ok(M.formatos().length === 1, 'un proyecto nuevo tiene un solo formato: el oficial');
  ok(M.formatos()[0].id === M.ID_SABS, 'y es el oficial');
  ok(M.eliminarFormato(M.ID_SABS) === false, 'el oficial no se puede sacar del listado');

  /* duplicar no puede mover un solo centavo */
  const propio = M.duplicarFormato('Mi cadena');
  M.guardarFormato(propio);
  M.usarFormato(propio.id);
  ok(!M.formatoEsOficial(), 'después de duplicar, el proyecto ya no está en el oficial');
  ok(M.analisis(it).pu === puOficial,
    'duplicar el formato NO cambia el precio unitario: ' + M.analisis(it).pu);
  ok(M.formatos().length === 2, 'y el listado pasó a tener dos: ' +
    M.formatos().map(f => f.n).join(' / '));

  /* una fila nueva sí lo mueve, y en la dirección correcta */
  const F = M.formato().filas;
  F.splice(F.length - 1, 0,
    { id: 'sup', k: 'pct', n: 'Supervisión', pct: 2, sobre: [9] });
  F[F.length - 1].sobre = [13, 14, 15];
  ok(M.validarFormato(M.formato()).ok, 'la cadena con la fila nueva es válida');
  const conSup = M.analisis(it).pu;
  ok(conSup > puOficial, 'agregar un recargo sube el precio: ' + puOficial + ' → ' + conSup);

  /* el validador ataja lo que no se puede calcular */
  const malo = JSON.parse(JSON.stringify(M.formato()));
  malo.filas[5].sobre = [14];                 // se apoya en una fila posterior
  const v = M.validarFormato(malo);
  ok(!v.ok && /viene despu[ée]s/.test(v.errores.join(' ')),
    'una fila que se apoya en otra posterior se rechaza: ' + v.errores[0]);

  /* --- ir y volver entre formatos, sin perder ninguno --- */
  M.usarFormato(null);
  ok(M.formatoEsOficial() && M.analisis(it).pu === puOficial,
    'volver al oficial devuelve el precio original: ' + M.analisis(it).pu);
  ok(M.formatos().length === 2,
    'y el formato propio SIGUE en el listado, no se borró al dejar de usarlo');

  M.usarFormato(propio.id);
  ok(M.analisis(it).pu === conSup,
    'volver a aplicarlo devuelve su precio, con la fila agregada y todo: ' + M.analisis(it).pu);

  /* un segundo formato propio: los dos conviven */
  const otro = M.duplicarFormato('Sin utilidad');
  M.guardarFormato(otro);
  otro.filas.find(x => x.p === 'util').pct = 0;
  M.usarFormato(otro.id);
  ok(M.formatos().length === 3, 'tres formatos en el listado: ' +
    M.formatos().map(f => f.n).join(' / '));
  ok(M.analisis(it).pu < conSup, 'el tercero calcula distinto: ' + M.analisis(it).pu);
  M.usarFormato(propio.id);
  ok(M.analisis(it).pu === conSup, 'y volver al anterior lo deja como estaba');

  /* renombrar y quitar */
  ok(M.renombrarFormato(otro.id, 'Sin utilidad (ensayo)'), 'un formato propio se renombra');
  ok(M.formatoPorId(otro.id).n === 'Sin utilidad (ensayo)', 'y el nombre queda');
  ok(M.eliminarFormato(otro.id) && M.formatos().length === 2,
    'se saca del listado y quedan dos');
  ok(M.formato().id === propio.id, 'sacar uno que NO estaba aplicado no cambia el activo');

  /* sacar el aplicado devuelve el proyecto al oficial */
  M.eliminarFormato(propio.id);
  ok(M.formatoEsOficial() && M.formatos().length === 1,
    'sacar el aplicado devuelve el proyecto al oficial');
  ok(M.analisis(it).pu === puOficial, 'con el precio del oficial: ' + M.analisis(it).pu);

  /* --- todo esto viaja en el .boq --- */
  const f2 = M.duplicarFormato('Va al archivo');
  M.guardarFormato(f2); M.usarFormato(f2.id);
  M.deserializar(M.serializar());
  ok(M.formatos().length === 2 && !M.formatoEsOficial(),
    'el listado y el formato aplicado sobreviven a guardar y abrir el .boq');
  ok(M.formato().n === 'Va al archivo', 'con su nombre: ' + M.formato().n);

  /* --- compatibilidad hacia atrás --- */
  /* un .boq de la PRIMERA v2.6 trae un único `P.formato`, sin listado */
  const v26a = JSON.parse(M.serializar());
  v26a.P.formato = v26a.P.formatos[0];
  delete v26a.P.formatos; delete v26a.P.formatoId;
  M.deserializar(JSON.stringify(v26a));
  ok(M.formatos().length === 2 && M.formato().n === 'Va al archivo',
    'un .boq de la primera v2.6 pasa su único formato al listado y lo deja aplicado');

  /* un .boq anterior a la v2.6 no trae nada de esto */
  const viejo = JSON.parse(M.serializar());
  delete viejo.P.formato; delete viejo.P.formatos; delete viejo.P.formatoId;
  M.deserializar(JSON.stringify(viejo));
  ok(M.formatoEsOficial(), 'un .boq anterior a la v2.6 abre con el formato oficial');
  ok(M.formatos().length === 1, 'y con el listado en el oficial solo');
  ok(M.analisis(M.proyecto().modulos[0].items[0]).pu === puOficial,
    'y con el mismo precio unitario que tenía: ' + puOficial);

  /* un formatoId que apunta a un formato que ya no está no rompe nada */
  const roto = JSON.parse(M.serializar());
  roto.P.formatoId = 'fantasma';
  M.deserializar(JSON.stringify(roto));
  ok(M.formatoEsOficial() && M.analisis(M.proyecto().modulos[0].items[0]).pu === puOficial,
    'un formato aplicado que ya no existe cae al oficial en vez de dejar el proyecto sin cadena');
}

/* ======================================================================
   NUMERACIÓN CORRIDA DE LOS ÍTEMS
   ----------------------------------------------------------------------
   El N° es del presupuesto, no del módulo: el módulo 2 empieza donde terminó
   el 1. Así lo hacen el B-1 impreso y el Excel desde siempre; la rejilla de la
   pantalla contaba desde 1 en cada módulo y mostraba un número distinto al del
   documento que se presenta.
   ====================================================================== */
console.log('== Numeración corrida entre módulos ==');
{
  M.proyectoNuevo('NUMERACIÓN');
  const P = M.proyecto();
  P.modulos[0].n = 'MÓDULO 1';
  const a1 = M.addItem({ desc: 'A1', und: 'm2', cant: 1 });
  const a2 = M.addItem({ desc: 'A2', und: 'm2', cant: 1 });
  const a3 = M.addItem({ desc: 'A3', und: 'm2', cant: 1 });
  P.modulos.push({ id: M.nid(), n: 'MÓDULO 2', items: [] });
  P.moduloActivo = 1;
  const b1 = M.addItem({ desc: 'B1', und: 'm2', cant: 1 });
  const b2 = M.addItem({ desc: 'B2', und: 'm2', cant: 1 });

  P.moduloActivo = 0;
  ok(M.itemsAntesDelModulo() === 0, 'el primer módulo arranca en 0');
  P.moduloActivo = 1;
  ok(M.itemsAntesDelModulo() === 3,
    'el segundo arranca después de los 3 del primero: ' + M.itemsAntesDelModulo());

  ok(M.numeroItem(a1.id) === 1 && M.numeroItem(a3.id) === 3,
    'el módulo 1 va del 1 al 3');
  ok(M.numeroItem(b1.id) === 4 && M.numeroItem(b2.id) === 5,
    'y el módulo 2 sigue en 4 y 5, no vuelve a 1');

  /* el B-1 impreso tiene que decir lo mismo */
  const P2 = M.proyecto();
  let n = 0; const delB1 = {};
  P2.modulos.forEach(m => m.items.forEach(it => { delB1[it.id] = ++n; }));
  const coincide = [a1, a2, a3, b1, b2].every(it => delB1[it.id] === M.numeroItem(it.id));
  ok(coincide, 'y coincide con la numeración del B-1 y del Excel, ítem por ítem');

  ok(M.numeroItem('no-existe') === 0, 'un id que no está devuelve 0');
}

/* ======================================================================
   O-7 · EDICIÓN MASIVA
   ====================================================================== */
console.log('== O-7 · edición masiva ==');
{
  const { cem, alb, it } = proyectoBase();

  /* matriz */
  const mz = M.matrizApuInsumo({});
  ok(mz.items.length === 1 && mz.insumos.length === 3, 'la matriz trae 3 insumos × 1 análisis');
  ok(mz.rend[cem.id + '|' + it.id] === 300, 'el cruce muestra el rendimiento: 300');

  ok(M.fijarRendimiento(it.id, cem.id, 250), 'escribir en la matriz cambia el rendimiento');
  ok(it.comp.find(c => c.ins === cem.id).rend === 250, 'y queda en 250');
  ok(M.fijarRendimiento(it.id, cem.id, 0), 'escribir 0 se aplica');
  ok(!it.comp.some(c => c.ins === cem.id),
    'y saca el insumo del análisis en vez de dejar un renglón en cero');
  M.fijarRendimiento(it.id, cem.id, 300);

  /* la matriz no inventa insumos que nadie usa */
  M.agregarInsumo('M', 'INSUMO QUE NADIE USA', 'kg', 9, false);
  ok(M.matrizApuInsumo({}).insumos.length === 3,
    'los insumos que no entran en ningún análisis no ensucian la matriz');

  /* factor de rendimiento */
  const rendAntes = it.comp.find(c => c.ins === alb.id).rend;
  const r = M.factorRendimiento({}, 1.10, { tipos: ['O'] });
  ok(r.renglones === 1 && r.items === 1, 'el factor tocó 1 renglón de 1 ítem');
  ok(Math.abs(it.comp.find(c => c.ins === alb.id).rend - rendAntes * 1.10) < 1e-6,
    'mano de obra multiplicada por 1,10: ' + it.comp.find(c => c.ins === alb.id).rend);
  ok(it.comp.find(c => c.ins === cem.id).rend === 300,
    'y los materiales quedaron intactos, como pedía el filtro');
  ok(M.proyecto().insumos[alb.id].p === 20, 'el factor NO toca precios');

  /* carga en lote */
  const lote = M.crearItemsEnLote('MURO DE LADRILLO; m2; 42\nCONTRAPISO\tm2\t120,5\n\nEXCAVACIÓN|m3|8');
  ok(lote.items.length === 3, 'tres ítems creados desde la lista: ' + lote.items.length);
  ok(lote.items[1].und === 'm2' && lote.items[1].cant === 120.5,
    'la coma decimal se entiende: ' + lote.items[1].cant);
  ok(lote.items[2].desc === 'EXCAVACIÓN' && lote.items[2].cant === 8,
    'y también el separador con barra');

  /* fusión */
  const a = M.addItem({ desc: 'A', und: 'm2', cant: 5 });
  const b = M.addItem({ desc: 'B', und: 'm2', cant: 7 });
  a.comp = [{ ins: cem.id, rend: 10 }];
  b.comp = [{ ins: cem.id, rend: 5 }, { ins: alb.id, rend: 2 }];
  const f = M.fusionarApus(a.id, [b.id], 'sumar');
  ok(f.items === 1 && f.insumos === 1, 'fusionó 1 análisis y agregó 1 insumo nuevo');
  ok(a.comp.find(c => c.ins === cem.id).rend === 15, 'los rendimientos repetidos se suman: 15');
  ok(a.cant === 5, 'el destino conserva su cantidad de obra');
  ok(!M.getItem(b.id), 'el análisis de origen se eliminó');
}

/* ======================================================================
   PRESCOM · NADA DE ESTO PUEDE ROMPER EL .ddp
   ====================================================================== */
console.log('== PRESCOM · importar y exportar siguen exactos ==');
const ab = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
/* El .ddp real no se versiona: su ruta va en pruebas/casos-reales.local.json. */
const DDP = (() => {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'casos-reales.local.json'), 'utf8')).v26Prescom;
    return r ? path.join(dir, r) : null;
  } catch (e) { return null; }
})();

async function prescom() {
  if (!DDP) { console.log('  · sin pruebas/casos-reales.local.json: se omite la vuelta a PRESCOM'); return; }
  /* --- 1. importar --- */
  const ida = await w.IMPORTADOR.importarDDP(ab(DDP));
  const P = M.proyecto();
  const totalImportado = M.totalProyecto();
  const nItems = P.modulos.reduce((s, m) => s + m.items.length, 0);
  ok(nItems > 0, 'el .ddp importó ' + nItems + ' ítem(s), total ' + M.fmt(totalImportado));
  ok(Math.abs(ida.resumen.totalOrigen - totalImportado) < 0.005,
    'el total coincide con el del archivo de origen al centavo: ' +
    M.fmt(ida.resumen.totalOrigen) + ' vs ' + M.fmt(totalImportado));
  ok(M.formatoEsOficial(), 'un proyecto importado de PRESCOM queda con el formato oficial');
  ok(M.conPuDeArchivo().items > 0,
    M.conPuDeArchivo().items + ' ítem(s) conservan el precio unitario del archivo');

  /* --- 2. las novedades de la v2.6 no mueven el total --- */
  const total = Object.keys(P.insumos).length;
  const sinFecha = Object.values(P.insumos).filter(x => !x.f).length;
  ok(sinFecha === total,
    'ningún insumo importado se fecheó con la fecha de hoy (O-4): ' + sinFecha + ' de ' + total);
  ok(M.totalProyecto() === totalImportado, 'y el total no se movió');

  const mz = M.matrizApuInsumo({ modulo: 0 });
  ok(mz.insumos.length > 0 && mz.items.length > 0,
    'la matriz se arma sobre el proyecto importado: ' + mz.insumos.length + ' × ' + mz.items.length);
  ok(M.totalProyecto() === totalImportado, 'y armarla no toca el presupuesto');

  /* --- 3. exportar de vuelta y volver a leer --- */
  const salida = await w.EXPORTADOR.ddp({ nombre: 'VUELTA v26' });
  ok(!!(salida && salida.datos && salida.datos.length),
    'el .ddp se exportó: ' + (salida && salida.datos ? salida.datos.length : 0) + ' bytes');

  const vuelta = await w.IMPORTADOR.importarDDP(salida.datos.buffer.slice(0, salida.datos.length));
  const totalVuelta = M.totalProyecto();
  const nVuelta = M.proyecto().modulos.reduce((s, m) => s + m.items.length, 0);
  ok(nVuelta === nItems, 'la vuelta tiene los mismos ' + nItems + ' ítems');
  ok(Math.abs(totalVuelta - totalImportado) < 0.005,
    'y el mismo total al centavo: ' + M.fmt(totalImportado) + ' → ' + M.fmt(totalVuelta));
  ok(JSON.stringify(vuelta.resumen.params) === JSON.stringify(ida.resumen.params),
    'los seis recargos volvieron iguales');

  /* --- 4. con un formato propio también tiene que exportar --- */
  M.usarFormato(M.duplicarFormato('Cadena propia'));
  ok(Math.abs(M.totalProyecto() - totalVuelta) < 0.005,
    'duplicar el formato sobre un proyecto de PRESCOM no mueve el total: ' + M.fmt(M.totalProyecto()));
  const salida2 = await w.EXPORTADOR.ddp({ nombre: 'VUELTA2 v26' });
  ok(!!(salida2 && salida2.datos && salida2.datos.length),
    'y el .ddp se sigue exportando con un formato propio (la interfaz avisa antes)');
  M.usarFormato(null);

  /* --- 5. la edición masiva mueve el total de forma previsible --- */
  const antes = M.totalProyecto();
  const r = M.factorRendimiento({}, 1.05, { tipos: ['M', 'O', 'E'] });
  ok(r.renglones > 0, 'el factor tocó ' + r.renglones + ' rendimiento(s) del proyecto importado');
  ok(M.totalProyecto() > antes,
    'y el total subió: ' + M.fmt(antes) + ' → ' + M.fmt(M.totalProyecto()));
  const salida3 = await w.EXPORTADOR.ddp({ nombre: 'VUELTA3 v26' });
  const vuelta3 = await w.IMPORTADOR.importarDDP(salida3.datos.buffer.slice(0, salida3.datos.length));
  ok(Math.abs(vuelta3.resumen.totalOrigen - M.totalProyecto()) < 0.005,
    'y el .ddp exportado después de la edición masiva se relee al centavo: ' +
    M.fmt(M.totalProyecto()));
}

/* ======================================================================
   O-5 · CATÁLOGO CIFRADO
   ====================================================================== */
async function catalogoCifrado() {
  console.log('== O-5 · el catálogo publicado va cifrado ==');
  const ruta = path.join(dir, 'data', 'catalogo.obq.js');
  if (!fs.existsSync(ruta)) {
    ok(false, 'falta data/catalogo.obq.js — generarlo con npm run catalogo:cifrar');
    return;
  }
  const cifrado = fs.readFileSync(ruta, 'utf8');
  ok(!/CEMENTO|HORMIGON|ALAMBRE/i.test(cifrado),
    'el archivo publicado no tiene ni una descripción legible');
  ok(cifrado.length < fs.statSync(path.join(dir, 'data', 'catalogo.js')).size,
    'y pesa menos que el de texto plano (va comprimido)');

  /* la aplicación lo abre sola y sale idéntico al original */
  w.OPENBOQ_CIFRADO = cifrado.replace(/^[^"]*"/, '').replace(/";\s*$/, '');
  const db = await w.CIFRADO.abrirDeLaApp();
  ok(!!db, 'la aplicación lo abre sin pedirle nada al usuario');
  if (db) {
    const orig = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'catalogo.js'), 'utf8')
      .replace(/^[^=]*=/, '').replace(/;\s*$/, ''));
    ok(JSON.stringify(db) === JSON.stringify(orig),
      'y lo que sale es idéntico al catálogo original: ' + db.stats.apus + ' análisis');
  }

  /* con la semilla equivocada no explota: arranca sin catálogo */
  const guardado = w.OPENBOQ_CIFRADO;
  w.OPENBOQ_CIFRADO = 'T0JRMQ' + 'A'.repeat(200);
  const nada = await w.CIFRADO.abrirDeLaApp();
  ok(nada === null, 'si el descifrado falla devuelve null y la aplicación arranca igual');
  w.OPENBOQ_CIFRADO = guardado;
}

(async () => {
  try { await prescom(); } catch (e) { ok(false, 'PRESCOM: ' + (e && e.message)); console.log(e); }
  try { await catalogoCifrado(); } catch (e) { ok(false, 'cifrado: ' + (e && e.message)); console.log(e); }

  const reales = errores.filter(e => !/^ALERT: /.test(e));
  console.log(reales.length ? '\nPROBLEMAS:\n  ' + reales.join('\n  ') : '\nTODAS LAS PRUEBAS PASARON');
  process.exit(reales.length ? 1 : 0);
})();
