/* Guardar el presupuesto en una base propia: se elige QUÉ ítems entran y,
   cuando la base ya tiene un análisis con la misma descripción, se pregunta
   antes de pisarlo.

   Las dos pruebas del final nacieron de bugs reales:
   - un mismo insumo a dos precios en la misma base propia le pisaba el precio
     al primer análisis, que quedaba mostrando un precio y sumando otro;
   - el volcado reemplazaba por descripción en silencio, así que dos proyectos
     PRESCOM con «HORMIGÓN H21» a precios distintos dejaban uno solo.          */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const errores=[];
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://openboq.local/'});
const w=dom.window;
const avisos=[];
w.alert=m=>{avisos.push(m)};
w.onerror=(m)=>errores.push('ONERROR: '+m);
const src=['data/catalogo.js','js/motor.js','js/importador.js','js/xlsx.js','js/reportes.js','js/ui.js']
  .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n;\n')+'\n;window.MOTOR=MOTOR;';
try{ w.eval(src); }catch(e){ errores.push('EVAL: '+e.message); console.log('EVAL ERROR',e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $=s=>w.document.querySelector(s);
const $$=s=>Array.from(w.document.querySelectorAll(s));
const ok=(c,m)=>console.log((c?'  ✓ ':'  ✗ ')+m)||(c?0:errores.push(m));
const clic=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const botonModal=t=>$$('#modalPie button').find(b=>b.textContent.includes(t));
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
const M=w.MOTOR;

/** Carga un ítem con su análisis en el presupuesto abierto. */
function item(desc,und,comps){
  const it=M.addItem({desc,und,cant:1});
  comps.forEach(([t,d,u,p,q])=>{
    const i=M.agregarInsumo(t,d,u,p,false);
    it.comp.push({ins:i.id,rend:q});
  });
  return it;
}
const base=id=>M.BD.bases.find(b=>b.id===id);
const apuDe=(b,d)=>b.apus.find(a=>M.norm(a.d)===M.norm(d));

(async()=>{

console.log('== La pestaña BASE DE DATOS ofrece guardar el presupuesto ==');
ok(!!$('#v-base [data-acc="proyectoABase"]'),
   'hay botón para copiar los ítems del presupuesto a una base propia');

console.log('== Se elige qué ítems entran ==');
M.proyectoNuevo('PRUEBA DE VOLCADO');
item('MURO DE LADRILLO 6H','m²',[['M','CEMENTO PORTLAND','bolsa',56,0.35],['O','ALBAÑIL','hr',23,1.2]]);
item('CONTRAPISO DE CEMENTO','m²',[['M','CEMENTO PORTLAND','bolsa',56,0.5]]);
M.addItem({desc:'ÍTEM SIN ANÁLISIS',und:'glb',cant:1});
ok(M.itemsConAnalisis().length===2,'solo los dos ítems con análisis se pueden guardar');

const bd=M.crearBasePropia('MI BASE DE PRUEBA');
clic($('#v-base [data-acc="proyectoABase"]'));
const casillas=$$('#modalCuerpo input[data-pbitem]');
ok(casillas.length===2,'el diálogo lista los ítems con análisis, con casilla: '+casillas.length);
ok(casillas.every(c=>c.checked),'vienen todos marcados');
$('#pbB').value=String(bd.id);
casillas[1].checked=false;                       // el contrapiso queda afuera
clic(botonModal('Guardar en la base'));
ok(base(bd.id).apus.length===1 && base(bd.id).apus[0].d==='MURO DE LADRILLO 6H',
   'entró solo el ítem marcado: '+base(bd.id).apus.map(a=>a.d).join(', '));

console.log('== El mismo insumo a dos precios NO se aplasta ==');
/* Segundo proyecto: el mismo cemento, más caro. Antes el segundo análisis le
   pisaba el precio al primero y el costo mostrado dejaba de cuadrar. */
M.proyectoNuevo('SEGUNDO PROYECTO');
item('CIMIENTO DE HORMIGÓN','m³',[['M','CEMENTO PORTLAND','bolsa',72,7]]);
M.volcarProyectoABase(bd.id);
const b=base(bd.id);
ok(b.ins.filter(i=>/CEMENTO PORTLAND/.test(i.d)).length===2,
   'el cemento queda como dos insumos, uno por precio: '+b.ins.filter(i=>/CEMENTO/.test(i.d)).map(i=>i.p).join(' / '));
const muro=apuDe(b,'MURO DE LADRILLO 6H');
ok(Math.abs(M.costoBase(b,muro)-(0.35*56+1.2*23))<0.01,
   'el análisis viejo conserva su costo: '+M.costoBase(b,muro));
ok(Math.abs(b.imap[muro.c[0][0]].p-56)<1e-6,
   'y su cemento sigue a 56: '+b.imap[muro.c[0][0]].p);
ok(Math.abs(M.costoBase(b,apuDe(b,'CIMIENTO DE HORMIGÓN'))-72*7)<0.01,
   'el nuevo usa el suyo a 72: '+M.costoBase(b,apuDe(b,'CIMIENTO DE HORMIGÓN')));

console.log('== Mismo nombre y mismos datos no es conflicto ==');
M.proyectoNuevo('TERCERO — IGUAL');
item('MURO DE LADRILLO 6H','m²',[['M','CEMENTO PORTLAND','bolsa',56,0.35],['O','ALBAÑIL','hr',23,1.2]]);
const ch0=M.conflictosVolcado(bd.id);
ok(ch0.length===1 && ch0[0].igual===true,'se detecta el choque pero marcado como el mismo dato');

console.log('== Mismo nombre con otros datos: se pregunta ==');
M.proyectoNuevo('CUARTO — DISTINTO');
item('MURO DE LADRILLO 6H','m²',[['M','CEMENTO PORTLAND','bolsa',80,0.4],['O','ALBAÑIL','hr',30,1.5]]);
const ch=M.conflictosVolcado(bd.id);
ok(ch.length===1 && ch[0].igual===false,'el choque real se marca como distinto');
clic($('#v-base [data-acc="proyectoABase"]'));
$('#pbB').value=String(bd.id);
clic(botonModal('Guardar en la base'));
await esperar(200);

ok($('#modalTitulo').textContent==='Análisis repetidos',
   'se abre el diálogo de repetidos en vez de reemplazar en silencio: '+$('#modalTitulo').textContent);
const opciones=$$('#modalCuerpo input[type="radio"]').map(r=>r.value);
ok(opciones.join('|')==='reemplazar|ambos|omitir','con las tres salidas: '+opciones.join(', '));

console.log('== «Guardar los dos» conserva el que ya estaba ==');
$$('#modalCuerpo input[value="ambos"]').forEach(r=>{r.checked=true});
clic(botonModal('Guardar en la base'));
await esperar(200);
const b2=base(bd.id);
ok(!!apuDe(b2,'MURO DE LADRILLO 6H (2)'),
   'el nuevo entra numerado: '+b2.apus.map(a=>a.d).join(' · '));
ok(Math.abs(M.costoBase(b2,apuDe(b2,'MURO DE LADRILLO 6H'))-(0.35*56+1.2*23))<0.01,
   'y el original queda intacto: '+M.costoBase(b2,apuDe(b2,'MURO DE LADRILLO 6H')));
ok(Math.abs(M.costoBase(b2,apuDe(b2,'MURO DE LADRILLO 6H (2)'))-(0.4*80+1.5*30))<0.01,
   'con el suyo aparte: '+M.costoBase(b2,apuDe(b2,'MURO DE LADRILLO 6H (2)')));

console.log('== «Dejar el de la base» no cambia nada ==');
const antes=b2.apus.length;
M.volcarProyectoABase(bd.id,{ids:[M.proyecto().modulos[0].items[0].id],modo:'omitir'});
ok(base(bd.id).apus.length===antes,'omitir no agrega ni reemplaza: '+base(bd.id).apus.length);

console.log('== Una base propia nueva no pisa el nombre de otra ==');
const dup=M.crearBasePropia('MI BASE DE PRUEBA');
ok(dup.n==='MI BASE DE PRUEBA (2)','la segunda se numera sola: '+dup.n);

console.log('== Renombrar una base propia guarda el nombre nuevo ==');
/* `data-baseN` se bajaba a `data-basen` y `dataset.baseN` quedaba undefined:
   el renombrado desde el diálogo no llegaba a guardarse nunca. */
clic($('.menubar .m[data-menu="herramientas"]'));
clic($('.menu-pop div[data-acc="misBases"]'));
await esperar(120);
const inp=$('#modalCuerpo input[data-basepropia="'+bd.id+'"]');
ok(!!inp,'el diálogo lista la base con su casilla de nombre');
inp.value='BIBLIOTECA ORURO 2026';
clic(botonModal('Cerrar'));
await esperar(120);
ok(M.basesPropias().some(x=>x.n==='BIBLIOTECA ORURO 2026'),
   'el nombre nuevo quedó guardado: '+M.basesPropias().map(x=>x.n).join(' · '));

console.log('== La base publicada no se tocó ==');
ok(M.BD.bases.filter(x=>!M.esBasePropia(x.id)).every(x=>x.f!=='local'),
   'las bases publicadas siguen siendo las del archivo');
ok(!avisos.length,'ningún aviso de error durante el recorrido: '+avisos.join(' · '));

console.log('\n'+(errores.length?'PROBLEMAS:\n - '+errores.join('\n - '):'VOLCADO A BASE PROPIA CORRECTO'));
process.exit(errores.length?1:0);

})();
