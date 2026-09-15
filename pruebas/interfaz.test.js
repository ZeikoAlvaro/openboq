const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const errores=[];
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'file:///app/index.html'});
const w=dom.window;
w.alert=m=>{errores.push('ALERT: '+m)};
w.onerror=(m)=>errores.push('ONERROR: '+m);
// un solo eval: en el navegador los <script> comparten el ambito lexico global
const src=['data/catalogo.js','js/motor.js','js/importador.js','js/xlsx.js','js/reportes.js','js/ui.js']
  .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n;\n')+'\n;window.MOTOR=MOTOR;window.REP=REP;';
try{ w.eval(src); }catch(e){ errores.push('EVAL: '+e.message); console.log('EVAL ERROR',e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $=s=>w.document.querySelector(s);
const ok=(c,m)=>console.log((c?'  ✓ ':'  ✗ ')+m)||(c?0:errores.push(m));

console.log('== Interfaz ==');
const NBASES=w.MOTOR.BD.bases.length;
ok($('#selBase').options.length===NBASES,'el selector lista las '+NBASES+' bases');
ok($('#tblPresupuesto').innerHTML.includes('DESCRIPCIÓN'),'tabla de presupuesto renderizada');
{ const nApus=w.MOTOR.BD.stats.apus, txt=$('#pillStats').textContent;
  ok(txt.replace(/\D/g,'').includes(String(nApus)),'el contador muestra los '+nApus+' items: '+txt); }

console.log('== Flujo: buscar en la base e insertar ==');
$('#buscaBase').value='revoque';
$('#buscaBase').dispatchEvent(new w.Event('input',{bubbles:true}));
$('#buscaBase').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
const lis=w.document.querySelectorAll('#listaBase li');
ok(lis.length>0,'resultados de búsqueda: '+lis.length);
lis[0].dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok($('#detApu').innerHTML.includes('COSTO DIRECTO'),'detalle del APU renderizado');

// insertar via modal
w.document.querySelector('[data-acc="insertarApu"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const bts=Array.from(w.document.querySelectorAll('#modalPie button'));
ok(bts.length===2,'modal de inserción abierto');
bts[1].click();
const MOT=w.MOTOR;
ok(MOT.proyecto().modulos[0].items.length===1,'ítem insertado en el presupuesto');
const it=MOT.proyecto().modulos[0].items[0];
ok(Object.keys(MOT.proyecto().insumos).length>0,'insumos copiados: '+Object.keys(MOT.proyecto().insumos).length);
ok(MOT.analisis(it).pu>0,'precio unitario calculado: '+MOT.analisis(it).pu);

console.log('== Editar cantidad en la rejilla ==');
const inp=w.document.querySelector('#tblPresupuesto input[data-campo="cant"]');
inp.value='25'; inp.dispatchEvent(new w.Event('input',{bubbles:true}));
ok(it.cant===25,'cantidad actualizada a '+it.cant);
ok($('#stTotal').textContent!=='0,00','total en barra de estado: '+$('#stTotal').textContent);

console.log('== Los cambios de cualquier pestaña se prueban antes de guardarse ==');
ok($('#accEnsayo').style.display!=='none','aparecen los botones de guardar/descartar');
ok($('#lblEnsayo').textContent==='PRESUPUESTO','dice en qué pestaña se está probando: '+$('#lblEnsayo').textContent);
// al cambiar de pestaña sin confirmar, primero pregunta
w.document.querySelector('#tabs button[data-v="insumos"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok($('#overlay').classList.contains('on'),'pregunta antes de salir de la pestaña');
ok(!$('#v-insumos').classList.contains('on'),'todavía no cambió de pestaña');
ok(Array.from(w.document.querySelectorAll('#modalPie button')).map(b=>b.textContent)
   .join('|')==='Seguir editando|Descartar|Guardar cambios','tres opciones: seguir, descartar, guardar');
w.document.querySelectorAll('#modalPie button')[0].click();       // seguir editando
ok(!$('#overlay').classList.contains('on'),'«Seguir editando» cierra el aviso');
// se confirma desde la barra de estado
w.document.querySelector('[data-acc="guardarCambios"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok($('#accEnsayo').style.display==='none','tras guardar, los botones desaparecen');
ok(it.cant===25,'la cantidad quedó guardada: '+it.cant);

console.log('== Vistas ==');
['base','analisis','insumos','incidencias','computos','cronograma','reportes','presupuesto'].forEach(v=>{
  w.document.querySelector(`#tabs button[data-v="${v}"]`).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  ok(w.document.querySelector('#v-'+v).classList.contains('on'),'vista '+v+' se abre');
});

console.log('== Análisis B-2 y B-3 ==');
w.document.querySelector('#tabs button[data-v="analisis"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok($('#cuerpoB2').innerHTML.includes('TOTAL PRECIO UNITARIO'),'formulario B-2 renderizado');
w.document.querySelector('#tabs button[data-v="insumos"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok($('#tblInsumos').innerHTML.includes('MONTO OBRA'),'tabla de insumos renderizada');

console.log('== Cambiar de ítem en el B-2 pregunta antes de guardar ==');
{
  const MOT2=w.MOTOR;
  // se crea el segundo ítem por el camino del usuario, para que la interfaz se refresque
  w.document.querySelector('[data-acc="nuevoItem"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  $('#niD').value='SEGUNDO ÍTEM DE PRUEBA';
  w.document.querySelectorAll('#modalPie button')[1].click();
  // crear un ítem TAMBIÉN es un ensayo: se confirma antes de seguir
  ok($('#accEnsayo').style.display!=='none','crear un ítem deja cambios sin guardar');
  w.document.querySelector('[data-acc="guardarCambios"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const sel=$('#selItemAnalisis');
  sel.value=it.id; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  const r=$('#cuerpoB2 input[data-rend]');
  const antes=Number(r.value);
  r.value=String(antes+1); r.dispatchEvent(new w.Event('input',{bubbles:true}));
  ok($('#accEnsayo').style.display!=='none','al editar el rendimiento empieza el ensayo');

  // se pasa al análisis de otro ítem: tiene que preguntar, igual que al salir
  // de la pestaña. Antes se guardaba solo y en silencio.
  const otro=MOT2.proyecto().modulos[0].items.find(x=>x.id!==it.id);
  sel.value=otro.id; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  ok($('#overlay').classList.contains('on'),'pregunta al cambiar de ítem');
  ok(sel.value===it.id,'mientras se decide, la lista vuelve al ítem que se estaba editando');
  ok($('#cuerpoB2').textContent.includes(it.desc.slice(0,20)),'y sigue mostrando ese análisis');

  w.document.querySelectorAll('#modalPie button')[0].click();       // seguir editando
  ok(!$('#overlay').classList.contains('on'),'«Seguir editando» cierra el aviso');
  ok($('#accEnsayo').style.display!=='none','y el ensayo sigue abierto');

  // ahora sí, guardando
  sel.value=otro.id; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  w.document.querySelectorAll('#modalPie button')[2].click();       // guardar cambios
  ok($('#accEnsayo').style.display==='none','tras «Guardar cambios» el ensayo se cierra');
  const c=it.comp.find(x=>x.ins===r.dataset.rend);
  ok(!!c && Math.abs(c.rend-(antes+1))<1e-9,'y el cambio se conservó: '+(c&&c.rend));
  ok($('#cuerpoB2').textContent.includes('SEGUNDO ÍTEM DE PRUEBA'),'se abrió el análisis del otro ítem');
  sel.value=it.id; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
}

/* Agregar mano de obra, material o equipo es un cambio como cualquier otro.
   Antes se guardaba solo y sin avisar: quien agregaba un albañil al B-2 no
   tenía forma de descartarlo. */
console.log('== Agregar insumos también entra como cambio en prueba ==');
{
  const MOT2=w.MOTOR;
  w.document.querySelector('#tabs button[data-v="analisis"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const antesN=it.comp.length;
  w.document.querySelector('[data-acc="addInsumo"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  $('#aDesc').value='CONTRAMAESTRE DE PRUEBA';
  $('#aUnd').value='hr';
  $('#aPrecio').value='30';
  $('#aRend').value='2';
  Array.from(w.document.querySelectorAll('#modalPie button'))
    .find(b=>/Agregar al análisis/.test(b.textContent)).click();
  ok(it.comp.length===antesN+1,'el insumo entró al análisis: '+it.comp.length+' componentes');
  ok($('#accEnsayo').style.display!=='none','y queda como cambio en prueba, sin guardarse solo');
  ok($('#lblEnsayo').textContent==='ANÁLISIS (B-2)','dice en qué pestaña: '+$('#lblEnsayo').textContent);
  /* Que «Descartar» lo revierta se prueba en cambios-en-prueba.test.js: ahí
     deserializar reconstruye el proyecto y las referencias de este archivo
     quedarían apuntando a objetos viejos. */
  w.document.querySelector('[data-acc="guardarCambios"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  ok($('#accEnsayo').style.display==='none','se confirma con «Guardar cambios»');
  ok(MOT2.getItem(it.id).comp.length===antesN+1,'y el insumo queda: '+MOT2.getItem(it.id).comp.length);
}

console.log('== Nuevo insumo en el B-3 también se prueba antes de guardarse ==');
{
  const MOT2=w.MOTOR;
  w.document.querySelector('#tabs button[data-v="insumos"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const antesN=Object.keys(MOT2.proyecto().insumos).length;
  w.document.querySelector('[data-acc="nuevoInsumo"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  $('#nT').value='O'; $('#nD').value='ALBAÑIL DE PRUEBA'; $('#nU').value='hr'; $('#nP').value='25';
  Array.from(w.document.querySelectorAll('#modalPie button')).find(b=>/Crear/.test(b.textContent)).click();
  ok(Object.keys(MOT2.proyecto().insumos).length===antesN+1,'el insumo se creó');
  ok($('#accEnsayo').style.display!=='none','y queda en prueba, no guardado');
  ok($('#lblEnsayo').textContent==='INSUMOS (B-3)','dice en qué pestaña: '+$('#lblEnsayo').textContent);
  w.document.querySelector('[data-acc="guardarCambios"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  ok($('#accEnsayo').style.display==='none','se confirma con «Guardar cambios»');
}

console.log('== Doble clic en el presupuesto abre el análisis del ítem ==');
{
  w.document.querySelector('#tabs button[data-v="presupuesto"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const fila=w.document.querySelector(`#tblPresupuesto tr[data-item="${it.id}"]`);
  ok(!!fila,'la fila del ítem está en la rejilla');
  // sobre la DESCRIPCIÓN, que es un <input>: es lo primero que uno intenta
  const desc=fila.querySelector('input[data-campo="desc"]');
  ok(!!desc,'la descripción es un campo editable');
  desc.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
  ok($('#v-analisis').classList.contains('on'),'doble clic en el nombre abre el B-2');
  ok($('#selItemAnalisis').value===it.id,'y abre el análisis de ESE ítem');

  // en UND. y CANTIDAD no: ahí el doble clic sirve para seleccionar el número
  w.document.querySelector('#tabs button[data-v="presupuesto"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  const cant=w.document.querySelector(`#tblPresupuesto tr[data-item="${it.id}"] input[data-campo="cant"]`);
  cant.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));
  ok($('#v-presupuesto').classList.contains('on'),'doble clic en la cantidad no cambia de pestaña');
}

console.log('== Cómputos: unidades, área y volumen ==');
w.document.querySelector('#tabs button[data-v="computos"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
$('#selItemComputo').value=it.id;
$('#selItemComputo').dispatchEvent(new w.Event('change',{bubbles:true}));
w.document.querySelector('[data-acc="addComputo"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok(it.computos.length===1,'fila de cómputo agregada');
const enc=$('#cuerpoComputos thead').textContent.replace(/\s+/g,' ');
ok(/LARGO \(m\)/.test(enc) && /ANCHO \(m\)/.test(enc) && /ALTO \/ ESP\. \(m\)/.test(enc),
   'las tres dimensiones llevan la unidad');
ok(/ÁREA \(m²\)/.test(enc) && /VOLUMEN \(m³\)/.test(enc),'y están las columnas ÁREA y VOLUMEN');
['n','l','a','h','ar','vo'].forEach(k=>
  ok(!!$(`#cuerpoComputos input[data-comp="0"][data-c="${k}"]`),'campo editable «'+k+'»'));
{
  const MOT2=w.MOTOR;
  // área medida del plano por espesor
  ok(MOT2.parcialComputo({n:1,ar:12,h:0.1})===1.2,'ÁREA × ALTO da el volumen: '+MOT2.parcialComputo({n:1,ar:12,h:0.1}));
  ok(MOT2.parcialComputo({n:2,vo:3.5})===7,'VOLUMEN por n° de veces: '+MOT2.parcialComputo({n:2,vo:3.5}));
  // las filas viejas, sin área ni volumen, siguen dando lo mismo
  ok(MOT2.parcialComputo({n:2,l:3,a:2,h:0.2})===2.4,'las filas de antes no cambian: '+MOT2.parcialComputo({n:2,l:3,a:2,h:0.2}));
  ok(MOT2.parcialComputo({n:4,l:2.5})===10,'las casillas vacías no multiplican');
}
w.document.querySelector('[data-acc="guardarCambios"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

console.log('== Los insumos van siempre en el mismo orden: M, O, E y A-Z ==');
{
  const MOT2=w.MOTOR;
  MOT2.agregarInsumo('M','ZINC EN HOJA','pza',10,false);
  MOT2.agregarInsumo('M','ARENA FINA','m³',80,false);
  MOT2.agregarInsumo('O','ALBAÑIL','hr',23,false);
  const L=MOT2.insumosOrdenados();
  const tipos=L.map(x=>x.t).join('');
  ok(/^M*O*E*$/.test(tipos),'primero materiales, después mano de obra y equipo: '+tipos);
  const mats=L.filter(x=>x.t==='M').map(x=>x.d);
  ok(mats.slice().sort((a,b)=>MOT2.cmpTexto(a,b)).join('|')===mats.join('|'),'materiales de la A a la Z');
  /* Se compara la posicion relativa y no el primero y el ultimo: el
     proyecto ya trae insumos del catalogo, y cuales son depende de lo que
     devolvieron las busquedas de mas arriba. */
  ok(mats.indexOf('ARENA FINA')>=0 && mats.indexOf('ARENA FINA')<mats.indexOf('ZINC EN HOJA'),
     'ARENA FINA queda antes que ZINC EN HOJA');
  // el análisis del ítem también sale ordenado
  const a=MOT2.analisis(it);
  const dm=a.grupos.M.map(x=>x.ins.d);
  ok(dm.slice().sort((x,y)=>MOT2.cmpTexto(x,y)).join('|')===dm.join('|'),'el B-2 lista los materiales A-Z');
}

console.log('== Depurar insumos repetidos ==');
{
  const MOT2=w.MOTOR;
  // el mismo material cargado dos veces a distinto precio
  const a1=MOT2.agregarInsumo('M','CEMENTO PORTLAND IP-30','bolsa',56,false);
  const a2=MOT2.agregarInsumo('M','Cemento Portland IP-30','bolsa',62,false);
  it.comp.push({ins:a1.id,rend:1},{ins:a2.id,rend:2});
  const G=MOT2.duplicadosInsumo();
  const g=G.find(x=>/CEMENTO PORTLAND/i.test(x.d));
  ok(!!g && g.ins.length===2,'detecta el insumo cargado dos veces');
  const r=MOT2.fusionarInsumos(a2.id,[a1.id,a2.id]);
  ok(r.quitados===1 && r.items===1,'los une en uno solo: quita '+r.quitados+' y corrige '+r.items+' análisis');
  ok(!MOT2.proyecto().insumos[a1.id],'el repetido ya no está en el proyecto');
  const c=it.comp.filter(x=>x.ins===a2.id);
  ok(c.length===1 && c[0].rend===3,'los rendimientos se suman en una línea: '+(c[0]&&c[0].rend));
  ok(!MOT2.duplicadosInsumo().some(x=>/CEMENTO PORTLAND/i.test(x.d)),'ya no figura como repetido');
}

console.log('== Menús ==');
w.document.querySelector('.menubar .m[data-menu="reportes"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
ok(w.document.querySelectorAll('.menu-pop div').length>=8,'menú REPORTES despliega opciones');

console.log('== Reportes (generación HTML) ==');
let abierto=null;
w.open=()=>{const d={write:s=>{abierto=(abierto||'')+s},close(){}};return {document:d}};
const R=w.REP;
[['b1','B-1'],['b2','B-2'],['b3','B-3'],['insumos','insumos'],['resumen','resumen'],['crono','cronograma']].forEach(([f,n])=>{
  abierto=null;
  try{ R[f](); ok(abierto&&abierto.length>500,'reporte '+n+' generado ('+(abierto?abierto.length:0)+' bytes)'); }
  catch(e){ ok(false,'reporte '+n+' falló: '+e.message); }
});
console.log('literal(12345.67) =', R.literal(12345.67));

console.log('\n'+(errores.length? 'PROBLEMAS:\n - '+errores.join('\n - ') : 'SIN ERRORES EN LA INTERFAZ'));

process.exit(errores.length?1:0);
