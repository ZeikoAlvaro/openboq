/* Cronograma general de la obra: un solo cronograma con niveles (módulo →
   actividad), duración calculada con la mano de obra del análisis, encadenado
   en el orden del presupuesto y predecesoras editables estilo MS Project.   */
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
  .map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n;\n')+'\n;window.MOTOR=MOTOR;window.REP=REP;';
try{ w.eval(src); }catch(e){ errores.push('EVAL: '+e.message); console.log('EVAL ERROR',e); }
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
const $=s=>w.document.querySelector(s);
const $$=s=>Array.from(w.document.querySelectorAll(s));
const ok=(c,m)=>console.log((c?'  ✓ ':'  ✗ ')+m)||(c?0:errores.push(m));
const clic=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const escribir=(el,v)=>{el.value=v; el.dispatchEvent(new w.Event('input',{bubbles:true}));};
const botonModal=t=>$$('#modalPie button').find(b=>b.textContent.includes(t));
const esperar=ms=>new Promise(r=>setTimeout(r,ms));
const M=w.MOTOR;

/* proyecto de prueba: 2 módulos, 3 actividades con mano de obra conocida */
function armar(){
  M.proyectoNuevo('OBRA DE PRUEBA');
  const P=M.proyecto();
  const alb=M.agregarInsumo('O','ALBAÑIL','hr',20,false);
  const ayu=M.agregarInsumo('O','AYUDANTE','hr',15,false);
  const cem=M.agregarInsumo('M','CEMENTO','kg',1.2,false);
  // módulo 1
  const a=M.addItem({desc:'EXCAVACION',und:'m³',cant:10});      // 10 x 8 h = 80 h
  a.comp=[{ins:alb.id,rend:8},{ins:ayu.id,rend:4}];
  const b=M.addItem({desc:'HORMIGON',und:'m³',cant:5});          // 5 x 4 h = 20 h
  b.comp=[{ins:alb.id,rend:4},{ins:cem.id,rend:300}];
  // módulo 2
  P.modulos.push({id:M.nid(),n:'MÓDULO # 2',items:[]});
  P.moduloActivo=1;
  const c=M.addItem({desc:'CARPINTERIA',und:'pza',cant:2});      // sin mano de obra
  c.comp=[{ins:cem.id,rend:10}];
  P.moduloActivo=0;
  return {a,b,c};
}

(async()=>{

console.log('== Orden de las pestañas ==');
const pest=$$('#tabs button').map(b=>b.dataset.v);
ok(pest.join(',')==='presupuesto,analisis,insumos,incidencias,computos,base,cronograma,reportes',
   'BASE DE DATOS quedó entre CÓMPUTOS y CRONOGRAMA: '+pest.join(' · '));
ok($$('#subCrono button').map(b=>b.dataset.s).join(',')==='programacion,recursos',
   'RECURSOS es subpestaña del CRONOGRAMA');
/* Las incidencias se llegan por tres caminos y los tres tienen que existir:
   la pestaña, el botón del B-2 y —desde la v1.11— el menú CONFIGURACIÓN.
   Antes esta prueba fijaba lo contrario: que NO estuvieran en el menú. Se
   cambió a pedido de Alvaro, que es donde las busca. */
clic(w.document.querySelector('.menubar .m[data-menu="config"]'));
const inc=$$('.menu-pop div').filter(d=>/Incidencias/i.test(d.textContent));
ok(inc.length===1,'INCIDENCIAS está en el menú CONFIGURACIÓN: '+inc.length+' entrada(s)');
ok(inc.length===1&&inc[0].dataset.acc==='paramsGlobal',
   'y abre la misma pestaña que el botón del B-2 (paramsGlobal)');
ok($$('#tabs button').some(b=>b.textContent==='INCIDENCIAS'),'y sigue como pestaña');
clic(w.document.body);

console.log('== Duración a partir de la mano de obra ==');
let {a,b,c}=armar();
const P=M.proyecto();
P.crono.jornada=8; P.crono.cuadrillas=1; P.crono.diasSemana=6;
ok(M.horasManoObra(a).mayor===80,'la especialidad que más tarda en EXCAVACION: '+M.horasManoObra(a).mayor+' h');
ok(M.duracionItem(a)===12,'80 h / 8 h por día, estirado a 6 días por semana = 12 días ('+M.duracionItem(a)+')');
ok(M.duracionItem(b)===3,'HORMIGON 20 h = 3 días ('+M.duracionItem(b)+')');
ok(M.duracionItem(c)===1,'sin mano de obra queda en 1 día');
P.crono.cuadrillas=2;
ok(M.duracionItem(a)===6,'con 2 cuadrillas, la mitad: '+M.duracionItem(a));
P.crono.cuadrillas=1;

console.log('== Generar: un solo cronograma, todos los módulos encadenados ==');
w.document.querySelector('#tabs button[data-v="cronograma"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
clic(w.document.querySelector('[data-acc="generarCrono"]'));
ok(!!$('#gcHoy'),'pregunta si arranca hoy');
clic(botonModal('Generar'));
await esperar(120);
ok(M.proyecto().inicioObra===M.hoyISO(),'arranca hoy: '+M.proyecto().inicioObra);
const acts=M.actividades();
ok(acts.map(x=>x.edt).join(' ')==='1.1 1.2 2.1','EDT por módulo y actividad: '+acts.map(x=>x.edt).join(' '));
ok(a.inicio===0 && a.dias===12,'actividad 1 arranca el día 0 y dura 12');
ok(b.inicio===12 && b.pred==='1','la 2 empieza cuando termina la 1 (pred '+b.pred+', inicio '+b.inicio+')');
ok(c.pred==='2FC-1','la de 1 día queda como «2FC-1»: '+c.pred);
ok(c.inicio===b.inicio+b.dias-1,'y se hace el mismo día en que termina la anterior (día '+c.inicio+
   ', la 2 termina el '+(b.inicio+b.dias-1)+')');
ok(M.proyecto().plazo===15,'plazo total 15 días ('+M.proyecto().plazo+')');

console.log('== La escala del Gantt va por semanas ==');
const sem=$$('#cuerpoCrono table.crono thead tr.sem th');
ok(sem.length===Math.ceil(M.proyecto().plazo/7),
   'una casilla por semana calendario: '+sem.length+' para '+M.proyecto().plazo+' días');
ok(sem[0].textContent==='1' && sem[0].title.includes('Semana 1'),'numeradas desde la 1: '+sem[0].title);
ok($('#cuerpoCrono td.celda').getAttribute('colspan')==String(sem.length),
   'la barra de cada actividad se dibuja sobre esas semanas');

console.log('== La pestaña muestra EDT, fechas y predecesoras ==');
const cuerpo=$('#cuerpoCrono').textContent.replace(/\s+/g,' ');
ok(cuerpo.includes('MÓDULO # 1') && cuerpo.includes('MÓDULO # 2'),'las dos tareas resumen');
ok($$('#cuerpoCrono input[data-dur]').length===3,'duración editable por actividad');
ok($$('#cuerpoCrono input[data-pred]').length===3,'predecesoras editables');
const f0=M.fechasDe(0,1).ini, ff=M.fechasDe(0,M.proyecto().plazo).fin;
ok(cuerpo.includes(M.fmtFecha(f0)),'muestra la fecha de comienzo '+M.fmtFecha(f0));
ok($('#lblPlazo').textContent.includes(M.fmtFecha(ff)),'y la fecha de fin: '+$('#lblPlazo').textContent);

console.log('== El Gantt tiene ancho propio y scroll horizontal ==');
ok(!!$('#scrollCrono') && $('#scrollCrono').contains($('#cuerpoCrono table.crono')),
   'la tabla vive en su propia zona de scroll');
ok(!!$('#pieCrono') && $('#pieCrono').textContent.includes('Curva'),
   'la curva S y la nota van en el pie, aparte, para que la barra horizontal quede a la vista');
const tabla=$('#cuerpoCrono table.crono');
ok(!!tabla && /min-width:\s*\d{3,}px/.test(tabla.getAttribute('style')||''),
   'la tabla pide su ancho mínimo: '+(tabla&&tabla.getAttribute('style')));
ok(/min-width:\s*\d{3,}px/.test($('#cuerpoCrono table.crono thead th:last-child').getAttribute('style')||''),
   'y la columna PROGRAMACIÓN se dimensiona por el plazo');

console.log('== Editar duración y predecesoras a mano ==');
escribir($('#cuerpoCrono input[data-dur="'+a.id+'"]'),'20');
await esperar(1000);
ok(a.dias===20 && b.inicio===20,'al alargar la 1 a 20 días, la 2 se corre a '+b.inicio);
escribir($('#cuerpoCrono input[data-pred="'+c.id+'"]'),'1CC+2');
await esperar(1000);
ok(c.inicio===2,'con «1CC+2» arranca 2 días después de empezar la 1: '+c.inicio);
escribir($('#cuerpoCrono input[data-pred="'+c.id+'"]'),'2');
await esperar(1000);
ok(c.inicio===b.inicio+b.dias,'vuelta a fin-comienzo: '+c.inicio);

console.log('== Lectura de predecesoras ==');
const p=M.leerPredecesoras('3;5CC+2, 7FC-1');
ok(p.length===3 && p[0].n===3 && p[0].tipo==='FC','«3» = fin a comienzo sin desfase');
ok(p[1].n===5 && p[1].tipo==='CC' && p[1].desf===2,'«5CC+2» = comienzo a comienzo, +2 días');
ok(p[2].desf===-1,'«7FC-1» = un día antes');

console.log('== Los cambios se prueban, y al salir se pregunta ==');
ok($('#stGuardado').textContent.includes('Probando cambios en CRONOGRAMA'),
   'la barra de estado avisa: '+$('#stGuardado').textContent);
clic($$('#subCrono button')[1]);
ok($('#modalTitulo').textContent.includes('Cambios sin guardar en CRONOGRAMA'),
   'al pasar a otra subpestaña pregunta qué hacer');
ok(!!botonModal('Guardar cambios') && !!botonModal('Descartar') && !!botonModal('Seguir editando'),
   'ofrece guardar, descartar o quedarse');
const diasProbados=a.dias;
clic(botonModal('Guardar cambios'));
ok(a.dias===diasProbados && $('#stGuardado').textContent.includes('guardados'),
   'al guardar quedan aplicados: '+$('#stGuardado').textContent);

console.log('== Descartar deja el proyecto como estaba ==');
clic($$('#subCrono button')[0]);
escribir($('#cuerpoCrono input[data-dur="'+a.id+'"]'),'99');
await esperar(1000);
ok(a.dias===99,'mientras se prueba, el cambio se ve');
clic($$('#subCrono button')[1]);
clic(botonModal('Descartar'));
ok(M.getItem(a.id).dias===diasProbados,'al descartar vuelve a '+M.getItem(a.id).dias+' días');
a=M.getItem(a.id); b=M.getItem(b.id); c=M.getItem(c.id);   // el descarte rearma el proyecto

console.log('== RECURSOS: trenes de trabajo ==');
clic($$('#subCrono button')[1]);
ok($('#s-recursos').classList.contains('on'),'la subpestaña RECURSOS se abre dentro del cronograma');
ok(M.trenes().length===1 && M.trenes()[0].n==='TREN 0','todo arranca en el TREN 0');
ok($$('#cuerpoRecursos select[data-act-tren]').length===3,'con las 3 actividades adentro');
ok(M.recursoDe(a)===100,'y 100 % de recursos (una cuadrilla)');
ok(!$('#cuerpoRecursos input[data-tren-r="'+M.trenes()[0].id+'"]'),
   'el TREN 0 no tiene % propio: se carga por actividad');
escribir($('#cuerpoRecursos input[data-act-rec="'+a.id+'"]'),'200');
await esperar(1000);
ok(M.recursoDe(a)===200,'la actividad 1 pasa a 200 %');
ok(M.duracionItem(a)===6,'y su duración se parte a la mitad: '+M.duracionItem(a)+' días (era 12)');
escribir($('#cuerpoRecursos input[data-act-rec="'+a.id+'"]'),'50');
await esperar(1000);
ok(M.duracionItem(a)===24,'con 50 % (media cuadrilla) tarda el doble: '+M.duracionItem(a)+' días');
a.rec=null;

console.log('== Trenes en paralelo ==');
const t2=M.nuevoTren('TREN 1',100);
c.tren=t2.id;                                   // la del módulo 2 va a otro tren
M.programar({duracion:true,encadenar:true});
ok(a.pred==='' && b.pred==='1','el tren 1 encadena sus dos actividades');
ok(c.pred==='','la primera del tren 2 arranca libre: pred «'+c.pred+'»');
ok(c.inicio===0,'y empieza el día 0, en paralelo con el tren 1');
ok(M.proyecto().plazo===15,'el plazo lo marca el tren más largo: '+M.proyecto().plazo);

console.log('== Ajuste automático al tope de días ==');
M.proyecto().crono.topeDias=10;
const cambios=M.ajustarRecursos(10);
ok(cambios.length===1 && cambios[0].it===a,'solo la de 12 días necesita más recursos');
ok(a.rec===125 && M.duracionItem(a)<=10,'sube a '+a.rec+' % y baja a '+M.duracionItem(a)+' días (tope 10)');
M.proyecto().crono.topeDias=180; a.rec=null;

console.log('== El reporte lleva EDT, fechas y predecesoras ==');
let abierto=null;
w.open=()=>({document:{write:s=>{abierto=(abierto||'')+s},close(){}}});
w.REP.crono();
ok(abierto && abierto.includes('EDT') && abierto.includes('PREDEC'),'columnas nuevas en el reporte');
ok(abierto.includes(M.fmtFecha(f0)),'con las fechas reales');

console.log('\n'+(errores.length? 'PROBLEMAS:\n - '+errores.join('\n - ') : 'CRONOGRAMA CORRECTO'));
process.exit(errores.length?1:0);

})();
