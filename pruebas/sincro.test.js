/* La Base de Datos se pone al día sin republicar la aplicación.

   Lo que se fija acá es lo que puede romper de forma silenciosa: que al
   cambiar el precio de un insumo se REHAGAN los costos de los análisis que
   lo usan. En la Base de Datos el costo viene sumado (tm/to/te), así que un
   precio nuevo sin recalcular deja la lista mostrando un costo viejo y el
   usuario ve un precio distinto al que le aparece después en el presupuesto.

   Lo demás que se fija: que no se toquen las bases propias del usuario, que
   sus análisis reescritos ganen sobre lo que llega del repositorio, y que la
   fusión del delta guardado se quede con el precio más reciente.          */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', url: 'file:///app/index.html' });
const w = dom.window;
const src = ['data/catalogo.js', 'js/motor.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') +
  '\n;window.MOTOR=MOTOR;';
try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); console.log('EVAL ERROR', e); }
const M = w.MOTOR;
M.cargarCatalogo(w.OPENBOQ_DB);

/** Suma los componentes de un análisis, que es lo que tm/to/te tienen que decir. */
function sumar(base, apu) {
  let m = 0, o = 0, e = 0;
  apu.c.forEach(c => {
    const i = base.imap[c[0]]; if (!i) return;
    const v = (Number(c[1]) || 0) * (Number(i.p) || 0);
    if (i.t === 'O') o += v; else if (i.t === 'E') e += v; else m += v;
  });
  return { m, o, e };
}

console.log('== El catálogo trae la marca de cuándo se generó ==');
ok(!!w.OPENBOQ_DB.generado_en,
  'data/catalogo.js tiene generado_en: ' + (w.OPENBOQ_DB.generado_en || 'NO — la app no va a sincronizar'));

console.log('== Un precio nuevo rehace el costo de sus análisis ==');
/* se busca un insumo que participe de varios análisis, para que el cambio se note */
const base = M.BD.bases.find(b => b.ins.length && b.apus.length > 20);
const uso = {};
base.apus.forEach(a => (a.c || []).forEach(c => { uso[c[0]] = (uso[c[0]] || 0) + 1; }));
const seq = Object.keys(uso).sort((a, b) => uso[b] - uso[a])[0];
const ins = base.imap[seq];
const afectados = base.apus.filter(a => (a.c || []).some(c => String(c[0]) === String(seq)));
ok(!!ins && afectados.length > 1, 'insumo de prueba: «' + ins.d + '» en ' + afectados.length + ' análisis');

const antes = afectados.map(a => ({ seq: a.seq, tm: a.tm, to: a.to, te: a.te }));
const nuevo = Number((ins.p * 2 + 1).toFixed(4));
const r = M.aplicarDelta([
  { base: base.n, tipo: ins.t, descripcion: ins.d, unidad: ins.u, precio: nuevo }
]);
ok(r.insumos === 1, 'se aplicó a 1 insumo: ' + r.insumos);
ok(ins.p === nuevo, 'el precio quedó en ' + ins.p);
ok(r.apus === afectados.length, 'rehizo los ' + afectados.length + ' análisis: ' + r.apus);

{
  const a = afectados[0], s = sumar(base, a);
  const bien = Math.abs(a.tm - s.m) < 0.01 && Math.abs(a.to - s.o) < 0.01 && Math.abs(a.te - s.e) < 0.01;
  ok(bien, 'el costo del análisis coincide con la suma de sus componentes');
  const v = antes.find(x => x.seq === a.seq);
  ok(a.tm + a.to + a.te !== v.tm + v.to + v.te, 'y cambió respecto de antes: ' +
    (v.tm + v.to + v.te).toFixed(2) + ' → ' + (a.tm + a.to + a.te).toFixed(2));
}

console.log('== Lo que no debe tocar ==');
{
  const otra = M.BD.bases.find(b => b.n !== base.n && b.ins.length);
  const i2 = otra.ins[0], p2 = i2.p;
  M.aplicarDelta([{ base: base.n, tipo: i2.t, descripcion: i2.d, unidad: i2.u, precio: 12345 }]);
  ok(i2.p === p2, 'un cambio dice a qué base va: no se aplica a otra');
}
ok(M.aplicarDelta([]).insumos === 0, 'una lista vacía no hace nada');
ok(M.aplicarDelta(null).insumos === 0, 'y null tampoco rompe');
{
  const inexistente = M.aplicarDelta([
    { base: base.n, tipo: 'M', descripcion: 'INSUMO QUE NO EXISTE EN NINGUNA BASE', unidad: 'pza', precio: 9 }
  ]);
  ok(inexistente.insumos === 0, 'un insumo que no está se ignora');
}
{
  const igual = M.aplicarDelta([
    { base: base.n, tipo: ins.t, descripcion: ins.d, unidad: ins.u, precio: nuevo }
  ]);
  ok(igual.insumos === 0, 'un precio que ya está no se cuenta como cambio');
}

console.log('== Las bases propias del usuario no se tocan ==');
{
  const prop = M.crearBasePropia('BASE DE PRUEBA');
  M.guardarEnBD({
    cod: 'X-1', d: 'ANALISIS PROPIO', u: 'm2',
    c: [{ t: 'M', d: ins.d, u: ins.u, p: 7.77, q: 1 }]
  }, 'nuevo', null, null, prop.id);
  const bp = M.BD.bases.find(b => b.id === prop.id);
  const antesP = bp.ins.find(i => i.d === ins.d).p;
  M.aplicarDelta([{ base: bp.n, tipo: ins.t, descripcion: ins.d, unidad: ins.u, precio: 999 }]);
  ok(bp.ins.find(i => i.d === ins.d).p === antesP,
    'el insumo de la base propia sigue en ' + antesP + ', no en 999');
  M.eliminarBasePropia(prop.id);
}

console.log('== La fusión de lo guardado se queda con lo último ==');
{
  /* sync.js no se puede cargar acá porque necesita fetch e IndexedDB del
     navegador, pero la fusión es una función pura: se prueba sola */
  const codigo = fs.readFileSync(path.join(dir, 'js/sync.js'), 'utf8');
  const cuerpo = codigo.slice(codigo.indexOf('function fusionar'));
  const fusionar = new Function('return ' + cuerpo.slice(0, cuerpo.indexOf('\n  }') + 4))();
  const viejo = [{ base: 'A', tipo: 'M', descripcion: 'CEMENTO', unidad: 'kg', precio: 1 }];
  const nuevoL = [
    { base: 'A', tipo: 'M', descripcion: 'CEMENTO', unidad: 'kg', precio: 2 },
    { base: 'A', tipo: 'M', descripcion: 'ARENA', unidad: 'm3', precio: 3 }
  ];
  const f = fusionar(viejo, nuevoL);
  ok(f.length === 2, 'dos insumos distintos quedan como dos: ' + f.length);
  ok(f.find(x => x.descripcion === 'CEMENTO').precio === 2, 'del repetido queda el precio más nuevo');
}

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
process.exit(errores.length ? 1 : 0);
