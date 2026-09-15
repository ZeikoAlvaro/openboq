/* Descripciones genéricas de ítem.

   Un ítem describe una ACTIVIDAD, no una obra. «Muro de ladrillo 6H» sirve en
   cualquier presupuesto; «Muro de ladrillo U.E. Gualberto Villarroel» no, y
   además arrastra a qué obra pertenecía cuando el análisis se aporta a la
   base común.

   Lo que se prueba acá, más que los casos sueltos, es que la regla no moleste:
   se corre contra las 7.974 descripciones reales del catálogo y casi ninguna
   puede quedar bloqueada. Una regla que da falsos positivos se desactiva sola
   —la gente la saltea— y deja de proteger nada. */
global.window = {};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null }, setItem(k, v) { this._d[k] = v }, removeItem(k) { delete this._d[k] } };
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const ctx = { window: global.window, localStorage: global.localStorage, console, Math, Date, JSON, Number, Object, Array, String, RegExp, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);
['data/catalogo.js', 'js/motor.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
const M = vm.runInContext('MOTOR', ctx);

let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const R = t => M.revisarDescripcion(t);

console.log('== Bloquea lo que identifica la obra ==');
[
  ['Muro de ladrillo U.E. Gualberto Villarroel', 'el establecimiento'],
  ['Provision e instalacion - proyecto agua potable Sabaya', 'la palabra proyecto'],
  ['Item 3.4 contrato GAMSH-2026-014', 'el contrato'],
  ['Revoque G.A.M. Sucre modulo 2', 'la entidad'],
  ['Losa alivianada - Gobierno Autonomo Municipal de Oruro', 'el gobierno municipal'],
  ['Excavacion en Oruro zona sur', 'un lugar detrás de preposición'],
  ['Hormigon comunidad Villa Esperanza', 'la comunidad'],
  ['Carpeta asfaltica distrito 4', 'el distrito'],
  ['Evaluacion ITCP puente peatonal', 'el documento'],
  ['Zapata aislada expediente ABC-12345', 'el código de expediente']
].forEach(([t, por]) => ok(R(t).nivel === 'bloqueo', `bloquea por ${por}: «${t.slice(0, 44)}»`));

console.log('\n== Deja pasar las descripciones técnicas ==');
[
  'Muro de ladrillo 6H e=15cm',
  'Hormigon Elaborado en Obra (H21)(Prod. y Colocado)',
  'Excavacion manual suelo semiduro 0-2m',
  'Replanteo y control topografico',
  'Losa Alivianada Reticular (E25)(H21)(Con Fierro)'
].forEach(t => ok(R(t).nivel === 'ok', `pasa: «${t.slice(0, 44)}»`));

console.log('\n== Avisa, sin bloquear, cuando el lugar puede ser el material ==');
[
  'Piso de piedra tarija color negro',
  'COLOCADO MARMOL LA PAZ'
].forEach(t => ok(R(t).nivel === 'aviso', `avisa y deja decidir: «${t}»`));

console.log('\n== Casos de borde ==');
ok(R('').nivel === 'bloqueo', 'la descripción vacía se rechaza');
ok(R('   ').nivel === 'bloqueo', 'solo espacios también');
ok(R('x'.repeat(81)).nivel === 'bloqueo', 'más de 80 caracteres se rechaza');
ok(R('x'.repeat(70)).nivel === 'ok', 'setenta caracteres pasan (el máximo real del catálogo)');
/* «gambote» es un tipo de ladrillo: el patrón de la entidad no debe morderlo */
ok(R('Botaguas de ladrillo gamb e=12 cm visto').nivel === 'ok',
  '«ladrillo gamb» no se confunde con G.A.M.');

console.log('\n== Contra las 7.974 descripciones reales del catálogo ==');
const todas = [];
for (const b of M.BD.bases) for (const a of b.apus) todas.push(a.d);
const bloqueadas = todas.filter(t => R(t).nivel === 'bloqueo');
const avisadas = todas.filter(t => R(t).nivel === 'aviso');
console.log(`  ${todas.length} descripciones · ${bloqueadas.length} bloqueadas · ${avisadas.length} con aviso`);
bloqueadas.slice(0, 5).forEach(t => console.log(`     bloqueada: ${t}  →  ${R(t).motivo}`));
ok(bloqueadas.length <= 5,
  `casi ninguna descripción real queda bloqueada: ${bloqueadas.length} de ${todas.length}`);
ok(avisadas.length < 40,
  `los avisos son pocos y todos materiales con nombre de lugar: ${avisadas.length}`);

console.log('\n' + (fallos ? 'PROBLEMAS: ' + fallos : 'DESCRIPCIONES OK'));
process.exit(fallos ? 1 : 0);
