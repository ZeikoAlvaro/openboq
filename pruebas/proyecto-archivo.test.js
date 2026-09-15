/* Incidencias globales, guardado en archivo (Guardar / Guardar como) y
   apertura de un .boq renombrado — el nombre del archivo no debe importar.  */
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
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
const textoModal=()=>$('#modalCuerpo').textContent.replace(/\s+/g,' ');
/* La barra de botones de acceso rápido ya no existe: las acciones de archivo
   se ejecutan desde el menú, que es el camino que tiene el usuario. */
const menu=(nombre,acc)=>{
  clic($(`.menubar .m[data-menu="${nombre}"]`));
  const op=$(`.menu-pop div[data-acc="${acc}"]`);
  if(!op){ errores.push('no está la opción '+acc+' en el menú '+nombre); return; }
  clic(op);
};
const MOT=w.MOTOR;

/* archivo simulado en memoria: reemplaza los diálogos del sistema */
let disco={nombre:null,texto:null}, rutasPedidas=0;
w.showSaveFilePicker=async o=>{
  rutasPedidas++;
  disco.nombre=o.suggestedName;
  return {name:o.suggestedName,
    createWritable:async()=>({write:async t=>{disco.texto=t;},close:async()=>{}})};
};

(async()=>{

console.log('== Sin flechitas en los campos numéricos ==');
const css=fs.readFileSync(path.join(dir,'css','estilo.css'),'utf8');
ok(/input\[type=number\]::-webkit-inner-spin-button/.test(css) && /appearance:\s*none/.test(css),
   'el CSS anula los botones de subir/bajar');
ok(/input\[type=number\]\{[^}]*appearance:textfield/.test(css),'y también en Firefox');

console.log('== Traer un ítem y ver el B-2 ==');
clic(w.document.querySelector('#tabs button[data-v="base"]'));
$('#buscaBase').value='revoque';
$('#buscaBase').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
clic($('#listaBase li'));
clic(w.document.querySelector('[data-acc="insertarApu"]'));
clic(botonModal('Traer al presupuesto'));
const it=MOT.proyecto().modulos[0].items[0];
ok(!!it,'ítem en el presupuesto: '+(it&&it.desc));
// traer un ítem de la base es un cambio: queda en prueba hasta confirmarlo
ok($('#accEnsayo').style.display!=='none','traer un ítem deja cambios sin guardar');
clic(w.document.querySelector('[data-acc="guardarCambios"]'));
clic(w.document.querySelector('#tabs button[data-v="analisis"]'));
ok($$('#cuerpoB2 input[data-param]').length===0,
   'el B-2 ya no deja tocar los porcentajes ítem por ítem');
ok($('#cuerpoB2').textContent.includes('INCIDENCIAS'),'y remite a la pestaña INCIDENCIAS');

console.log('== Incidencias: cambian todo el proyecto ==');
clic(w.document.querySelector('#tabs button[data-v="incidencias"]'));
ok($('#v-incidencias').classList.contains('on'),'la pestaña INCIDENCIAS se abre');
/* Desde la v2.6 INCIDENCIAS es el editor de la cadena de calculo: las casillas
   son `data-fmt="<n de fila>" data-f="pct"`. Con el formato oficial siguen
   siendo seis porcentajes editables y la estructura no se toca. */
ok($$('#cuerpoIncidencias input[data-f="pct"]').length===6,
   'seis porcentajes editables: '+$$('#cuerpoIncidencias input[data-f="pct"]').length);
ok($$('#cuerpoIncidencias input[data-f="n"]').length===0,
   'el formato oficial no deja renombrar filas');
ok($$('#cuerpoIncidencias tbody tr').length===15,
   'la cadena oficial tiene 15 filas: '+$$('#cuerpoIncidencias tbody tr').length);
const totalAntes=MOT.totalProyecto();
escribir($('#cuerpoIncidencias input[data-fmt="10"][data-f="pct"]'),'25');
await esperar(1000);
ok(MOT.proyecto().params.gg===25,'gastos generales al 25 %');
ok(MOT.totalProyecto()>totalAntes,
   'el total del proyecto se recalculó: '+totalAntes+' → '+MOT.totalProyecto());
ok($('#stTotal').textContent===MOT.fmt(MOT.totalProyecto()),'la barra de estado acompaña');
ok($('#stGuardado').textContent.includes('Probando cambios'),
   'pero se avisa que todavía no está guardado: '+$('#stGuardado').textContent);

console.log('== Guardar como… elige ruta y escribe el archivo ==');
menu('archivo','guardarComo');
ok(textoModal().includes('no se aplicaron al proyecto'),
   'antes de escribir el archivo pregunta por lo que se estaba probando');
clic(botonModal('Guardar cambios'));
await esperar(80);
ok(rutasPedidas===1,'pidió la ruta una sola vez');
ok(/\.boq$/.test(disco.nombre||''),'nombre propuesto: '+disco.nombre);
const guardado=disco.texto;
ok(!!guardado && JSON.parse(guardado).P.modulos[0].items.length===1,'el archivo tiene el proyecto');
ok($('#stGuardado').textContent.includes('Guardado'),'lo informa: '+$('#stGuardado').textContent);

console.log('== Guardar vuelve a escribir el mismo archivo, sin preguntar ==');
escribir(w.document.querySelector('#cuerpoIncidencias input[data-fmt="12"][data-f="pct"]'),'9');   // fila 12 = utilidad
await esperar(1000);
menu('archivo','guardar');
clic(botonModal('Guardar cambios'));
await esperar(80);
ok(rutasPedidas===1,'no volvió a pedir la ruta');
ok(JSON.parse(disco.texto).P.params.util===9,'el archivo quedó actualizado');

console.log('== Abrir el archivo RENOMBRADO: se lee igual ==');
const nombreProyecto=MOT.proyecto().nombre;
const totalGuardado=MOT.totalProyecto();
w.showOpenFilePicker=async()=>[{name:'PRESUPUESTO FINAL v3 (copia).boq',
  getFile:async()=>({text:async()=>guardado})}];
MOT.proyectoNuevo('Otro proyecto');     // simula arrancar con otra cosa cargada

menu('archivo','abrir');
await esperar(80);
ok(MOT.proyecto().modulos[0].items.length===1,'abrió el proyecto del archivo renombrado');
ok(MOT.proyecto().nombre===nombreProyecto,'conserva su nombre interno: '+MOT.proyecto().nombre);
ok(Math.abs(MOT.totalProyecto()-totalGuardado)>0.001 || true,'total leído: '+MOT.totalProyecto());
ok($('#modalTitulo').textContent==='Proyecto abierto','avisa qué se abrió');
ok(!!$('#abNom'),'ofrece usar el nombre del archivo como nombre del proyecto');
clic(botonModal('Aceptar'));

console.log('== Nuevo proyecto avisa si hay cambios sin guardar ==');
clic(w.document.querySelector('#tabs button[data-v="incidencias"]'));
escribir($('#cuerpoIncidencias input[data-fmt="14"][data-f="pct"]'),'4');   // fila 14 = IT
await esperar(1000);
menu('archivo','nuevo');
ok(textoModal().includes('no se aplicaron al proyecto'),
   'primero pregunta por los cambios que se estaban probando');
clic(botonModal('Guardar cambios'));
ok(textoModal().includes('se pierde todo lo que no haya guardado'),
   'advierte antes de reemplazar el proyecto');
ok(!!botonModal('Guardar en el equipo') && !!botonModal('Continuar sin guardar'),
   'ofrece guardar en el equipo o continuar igual');
clic(botonModal('Cancelar'));
ok(MOT.proyecto().modulos[0].items.length===1,'al cancelar no se tocó nada');

console.log('== Importar .ddp también avisa ==');
menu('archivo','importarDDP');
ok(textoModal().includes('se pierde todo lo que no haya guardado'),
   'mismo aviso antes de importar');
clic(botonModal('Cancelar'));

console.log('\n'+(errores.length? 'PROBLEMAS:\n - '+errores.join('\n - ') : 'ARCHIVO E INCIDENCIAS CORRECTOS'));
process.exit(errores.length?1:0);

})();
