/* Traer un ítem de la Base de Datos corrigiendo cantidades y precios:
   los cambios valen para el proyecto y solo llegan a la Base de Datos si se
   pide expresamente (actualizando el análisis existente o guardándolo como
   ítem nuevo en MIS ANÁLISIS).                                            */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const errores=[];
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://openboq.local/'});
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

/* abre el diálogo con el primer resultado de una búsqueda */
function traer(texto){
  clic(w.document.querySelector('#tabs button[data-v="base"]'));
  $('#buscaBase').value=texto;
  $('#buscaBase').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  const li=$('#listaBase li'); clic(li);
  clic(w.document.querySelector('[data-acc="insertarApu"]'));
}

console.log('== La Base de Datos se llama Base de Datos ==');
ok(w.document.querySelector('#tabs button[data-v="base"]').textContent==='BASE DE DATOS',
   'la pestaña se rotula BASE DE DATOS');
ok(!/copia|archivo original|código interno/i.test($('#detApu').innerHTML+$('#tblPresupuesto').innerHTML),
   'no se anuncia de qué archivo es copia el ítem');

console.log('== Unidades: lista desplegable en el ítem nuevo ==');
clic(w.document.querySelector('[data-acc="nuevoItem"]'));
ok($('#niU').tagName==='SELECT','la unidad se elige de una lista');
ok($('#niU').options.length===MOT.UNIDADES.length+1,
   'trae las unidades corrientes más «otra…»: '+$('#niU').options.length);
escribir($('#niD'),'ÍTEM DE PRUEBA'); $('#niU').value='m³';
clic(botonModal('Crear y analizar'));
ok(MOT.proyecto().modulos[0].items[0].und==='m³','la unidad elegida queda en el ítem');

console.log('== Traer un ítem cambiando cantidad y precio ==');
traer('revoque');
ok(!!$('#tApu'),'el diálogo muestra el análisis completo, editable');
ok(!/copia de/i.test($('#modalCuerpo').textContent),'sin leyenda de «copia de…»');
const seleccion=MOT.buscarEnBase(Number($('#selBaseFiltro').value),'revoque',false,500)[0];
const baseId=seleccion.base.id, apuSeq=seleccion.apu.seq;
const insSeq=seleccion.apu.c[0][0];
const precioBD=seleccion.base.imap[insSeq].p;
const puOriginal=$('#iPU').textContent;
const inpP=$('#tApu input[data-p]'), inpQ=$('#tApu input[data-q]');
escribir(inpP,String(precioBD*2));
escribir(inpQ,'7');
ok($('#iPU').textContent!==puOriginal,'el precio unitario se recalcula al editar: '+puOriginal+' → '+$('#iPU').textContent);
escribir($('#iCant'),'3');
clic(botonModal('Traer al presupuesto'));
const it=MOT.proyecto().modulos[0].items[1];
ok(!!it && it.cant===3,'ítem traído con cantidad 3');
const comp=it.comp[0], insProy=MOT.proyecto().insumos[comp.ins];
ok(Math.abs(insProy.p-precioBD*2)<1e-6,'el insumo entró al proyecto con el precio corregido: '+insProy.p);
ok(Math.abs(comp.rend-7)<1e-6,'y con la cantidad corregida: '+comp.rend);
ok(Math.abs(MOT.BD.bases.find(b=>b.id===baseId).imap[insSeq].p-precioBD)<1e-6,
   'la Base de Datos NO cambió: sigue en '+MOT.BD.bases.find(b=>b.id===baseId).imap[insSeq].p);

console.log('== Guardar el cambio en la Base de Datos (mismo nombre = actualizar) ==');
traer('revoque');
const nuevoPrecio=precioBD*3;
escribir($('#tApu input[data-p]'),String(nuevoPrecio));
$('#iGuardar').checked=true;
$('#iGuardar').dispatchEvent(new w.Event('change',{bubbles:true}));
ok($('#iModo').style.display==='block','al marcar la casilla aparece la opción actualizar / ítem nuevo');
ok(!$('#iModo input[value="actualizar"]').disabled,'con el mismo nombre se puede actualizar el existente');
clic(botonModal('Traer al presupuesto'));
const bd=MOT.BD.bases.find(b=>b.id===baseId);
ok(Math.abs(bd.imap[insSeq].p-nuevoPrecio)<1e-6,
   'el costo del insumo quedó actualizado en la Base de Datos: '+bd.imap[insSeq].p);
const apuBD=bd.apus.find(a=>a.seq===apuSeq);
ok(Math.abs(MOT.costoBase(bd,apuBD)-MOT.r2(apuBD.tm+apuBD.to+apuBD.te))<1e-6 && MOT.costoBase(bd,apuBD)>0,
   'los subtotales del análisis se recalcularon: '+MOT.costoBase(bd,apuBD));
ok(MOT.resumenBDU().cambios===1,'queda registrado 1 cambio propio');

console.log('== Guardar como ítem nuevo (nombre distinto) ==');
traer('revoque');
escribir($('#iDesc'),'REVOQUE ESPECIAL DE PRUEBA');
$('#iGuardar').checked=true;
$('#iGuardar').dispatchEvent(new w.Event('change',{bubbles:true}));
ok($('#iModo input[value="actualizar"]').disabled,'con otro nombre solo se puede guardar como ítem nuevo');
clic(botonModal('Traer al presupuesto'));
const propia=MOT.BD.bases.find(b=>b.id===MOT.ID_PROPIA);
ok(!!propia,'aparece la base MIS ANÁLISIS');
ok(propia.apus.length===1 && propia.apus[0].d==='REVOQUE ESPECIAL DE PRUEBA',
   'con el análisis guardado: '+(propia&&propia.apus[0].d));
{ const nOrig=MOT.BD.bases.filter(b=>!MOT.esBasePropia(b.id)).length;
  ok($$('#selBase option').length===nOrig+1,
     'la base propia se lista junto a las '+nOrig+' originales: '+$$('#selBase option').length); }

console.log('== Los cambios sobreviven al recargar, y se pueden descartar ==');
ok(!!w.localStorage.getItem('openboq_bd_propia'),'los cambios quedaron guardados en el equipo');
MOT.cargarCatalogo(w.OPENBOQ_DB);
ok(MOT.BD.bases.find(b=>b.id===MOT.ID_PROPIA) &&
   Math.abs(MOT.BD.bases.find(b=>b.id===baseId).imap[insSeq].p-nuevoPrecio)<1e-6,
   'al volver a cargar la Base de Datos se reaplican los cambios propios');
MOT.limpiarBDU();
ok(!MOT.BD.bases.find(b=>b.id===MOT.ID_PROPIA) &&
   Math.abs(MOT.BD.bases.find(b=>b.id===baseId).imap[insSeq].p-precioBD)<1e-6,
   'al descartarlos vuelve el archivo original: '+MOT.BD.bases.find(b=>b.id===baseId).imap[insSeq].p);

console.log('\n'+(errores.length? 'PROBLEMAS:\n - '+errores.join('\n - ') : 'BASE DE DATOS EDITABLE CORRECTA'));
process.exit(errores.length?1:0);
