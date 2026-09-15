/* Armado de un análisis de precios unitarios desde cero:
   Nuevo ítem -> se abre el B-2 -> se cargan materiales, mano de obra y equipo
   eligiéndolos del catálogo, creando insumos nuevos y corrigiendo precios.   */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const errores=[];
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'file:///app/index.html'});
const w=dom.window;
w.alert=m=>{errores.push('ALERT: '+m)};
w.onerror=(m)=>errores.push('ONERROR: '+m);
const src=['data/catalogo.js','js/motor.js','js/importador.js','js/xlsx.js','js/reportes.js','js/ui.js']
  .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n;\n')+'\n;window.MOTOR=MOTOR;';
try{ w.eval(src); }catch(e){ errores.push('EVAL: '+e.message); console.log('EVAL ERROR',e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $=s=>w.document.querySelector(s);
const $$=s=>Array.from(w.document.querySelectorAll(s));
const ok=(c,m)=>console.log((c?'  ✓ ':'  ✗ ')+m)||(c?0:errores.push(m));
const clic=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const escribir=(el,v)=>{el.value=v; el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const botonModal=t=>$$('#modalPie button').find(b=>b.textContent.includes(t));
const MOT=w.MOTOR;
const esperar=ms=>new Promise(r=>setTimeout(r,ms));   // deja correr el debounce de la búsqueda

(async()=>{

console.log('== Nuevo ítem abre su análisis ==');
clic($('[data-acc="nuevoItem"]'));
ok(!!$('#niD'),'el diálogo pide descripción, unidad y cantidad');
escribir($('#niD'),'HORMIGÓN SIMPLE PARA CIMIENTOS');
escribir($('#niU'),'m³');
escribir($('#niC'),'12');
clic(botonModal('Crear y analizar'));
const it=MOT.proyecto().modulos[0].items[0];
ok(!!it && it.desc==='HORMIGÓN SIMPLE PARA CIMIENTOS','ítem creado: '+(it&&it.desc));
ok(it.und==='m³' && it.cant===12,'unidad y cantidad tomadas del diálogo: '+it.und+' / '+it.cant);
ok($('#v-analisis').classList.contains('on'),'queda abierta la vista ANÁLISIS (B-2)');
ok($('#selItemAnalisis').value===it.id,'el análisis mostrado es el del ítem nuevo');
ok($('#cuerpoB2').innerHTML.includes('TOTAL PRECIO UNITARIO'),'formulario B-2 renderizado');

console.log('== Cada sección tiene su botón, y abre su pestaña ==');
const botones=$$('#cuerpoB2 [data-acc="addInsumo"]');
ok(botones.length===3,'un botón «Agregar» por sección: '+botones.length);
ok(botones.map(b=>b.dataset.accArg).join('')==='MOE','apuntan a materiales, mano de obra y equipo');

console.log('== MATERIALES desde el catálogo ==');
clic(botones[0]);
ok($('#tIns button.on').dataset.t==='M','abre en la pestaña de materiales');
escribir($('#bIns'),'cemento portland');
await esperar(260);
const filasCat=$$('#lIns li[data-d]');
ok(filasCat.length>0,'el catálogo devuelve resultados: '+filasCat.length);
ok($('#lIns').innerHTML.includes('EN LA BASE DE DATOS'),'los resultados se rotulan como de la Base de Datos');
clic(filasCat[0]);
ok($('#aDesc').value.length>0 && Number($('#aPrecio').value)>0,
   'al elegirlo se completan descripción y precio: '+$('#aDesc').value+' a '+$('#aPrecio').value);
const descMat=$('#aDesc').value, precioCat=Number($('#aPrecio').value);
escribir($('#aRend'),'0.35');
clic(botonModal('Agregar al análisis'));
ok(it.comp.length===1,'insumo agregado al análisis');
const insMat=MOT.proyecto().insumos[it.comp[0].ins];
ok(insMat.t==='M' && insMat.d===descMat,'quedó como material: '+insMat.d);
ok(Math.abs(insMat.p-precioCat)<1e-6,'con el precio del catálogo: '+insMat.p);
ok(MOT.analisis(it).mat>0,'subtotal de materiales calculado: '+MOT.analisis(it).mat);

console.log('== MANO DE OBRA desde el catálogo ==');
clic($$('#cuerpoB2 [data-acc="addInsumo"]')[1]);
ok($('#tIns button.on').dataset.t==='O','abre en la pestaña de mano de obra');
escribir($('#bIns'),'albanil');
await esperar(260);
let f=$$('#lIns li[data-d]');
ok(f.length>0,'resultados de mano de obra: '+f.length);
clic(f[0]);
escribir($('#aRend'),'1.2');
clic(botonModal('Agregar al análisis'));
ok(it.comp.length===2,'segundo insumo agregado');
ok(MOT.proyecto().insumos[it.comp[1].ins].t==='O','quedó como mano de obra');
ok(MOT.analisis(it).mo>0,'subtotal de mano de obra: '+MOT.analisis(it).mo);

console.log('== EQUIPO: insumo que no existe, se crea ==');
clic($$('#cuerpoB2 [data-acc="addInsumo"]')[2]);
ok($('#tIns button.on').dataset.t==='E','abre en la pestaña de equipo');
escribir($('#aDesc'),'VIBRADORA DE INMERSION MARCA X');
escribir($('#aUnd'),'hr');
escribir($('#aPrecio'),'45');
escribir($('#aRend'),'0.5');
clic(botonModal('Agregar al análisis'));
ok(it.comp.length===3,'insumo nuevo agregado sin estar en el catálogo');
const insEq=MOT.proyecto().insumos[it.comp[2].ins];
ok(insEq.t==='E' && insEq.d==='VIBRADORA DE INMERSION MARCA X' && insEq.p===45,
   'creado con tipo, unidad y precio propios: '+insEq.u+' a '+insEq.p);

console.log('== Insumo repetido a otro precio: avisa y deja corregir ==');
clic($$('#cuerpoB2 [data-acc="addInsumo"]')[0]);
escribir($('#aDesc'),descMat);
escribir($('#aUnd'),insMat.u);
escribir($('#aPrecio'),String(precioCat+10));
ok(!!$('#aActualizar'),'avisa que el insumo ya existe y ofrece actualizar su precio');
ok($('#aAviso').textContent.includes('1'),'informa en cuántos análisis se usa');
$('#aActualizar').checked=true;
escribir($('#aRend'),'1');
clic(botonModal('Agregar al análisis'));
ok(Math.abs(MOT.proyecto().insumos[insMat.id].p-(precioCat+10))<1e-6,
   'el precio del insumo existente quedó actualizado: '+MOT.proyecto().insumos[insMat.id].p);
ok(errores.filter(e=>e.startsWith('ALERT')).length===1,
   'avisa que el insumo ya estaba en el análisis en lugar de duplicarlo');
errores.length=0;   // ese ALERT es el comportamiento buscado

console.log('== El análisis cierra números ==');
const a=MOT.analisis(it);
ok(a.mat>0 && a.mo>0 && a.eq>0,'las tres secciones con costo: '+a.mat+' / '+a.mo+' / '+a.eq);
ok(a.pu>0,'precio unitario: '+a.pu);
ok(Math.abs(a.total-MOT.r2(a.pu*it.cant))<0.02,'total del ítem = PU x cantidad: '+a.total);

console.log('\n'+(errores.length? 'PROBLEMAS:\n - '+errores.join('\n - ') : 'ANÁLISIS DESDE CERO CORRECTO'));
process.exit(errores.length?1:0);

})();
