global.window = {};
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]} };
const fs=require('fs'), vm=require('vm'), path=require('path');
const dir=path.join(__dirname,'..');
const ctx = { window: global.window, localStorage: global.localStorage, console, Math, Date, JSON, Number, Object, Array, String, isNaN };
ctx.globalThis = ctx;
vm.createContext(ctx);
['data/catalogo.js','js/motor.js'].forEach(f=>vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),ctx,{filename:f}));
const M = vm.runInContext('MOTOR', ctx);
let fallos=0;
const ok=(c,m)=>{ if(!c){fallos++;console.log('  ✗ '+m);} else console.log('  ✓ '+m); };

console.log('== 1. Carga de la base ==');
/* Sin numeros escritos a mano: el catalogo cambia (se agregan y se quitan
   bases) y una prueba que los fije falla por eso y no por un error real.
   Lo que si tiene que cumplirse es que las cuentas cierren entre si. */
ok(M.BD.bases.length>0,'catalogo cargado: '+M.BD.bases.length+' bases');
ok(M.BD.bases.length===M.BD.stats.bases,'stats.bases coincide con las bases cargadas');
const sumaApus=M.BD.bases.reduce((s,b)=>s+b.apus.length,0);
ok(sumaApus===M.BD.stats.apus,'stats.apus coincide con la suma de las bases: '+sumaApus);

console.log('== 2. Importación de APU: costo directo idéntico al original ==');
M.proyectoNuevo('TEST');
let dif=0, probados=0, peor=0;
for(const b of M.BD.bases){
  for(let k=0;k<b.apus.length;k+=97){
    const a=b.apus[k];
    if(!a.c.length) continue;
    M.proyectoNuevo('T');
    const it=M.importarApu(b,a,1);
    const an=M.analisis(it);
    const orig=M.r2(a.tm+a.to+a.te);
    const nuevo=M.r2(an.mat+an.mo+an.eq);
    const d=Math.abs(orig-nuevo); probados++;
    if(d>0.02){dif++; peor=Math.max(peor,d);}
  }
}
ok(dif===0, probados+' APUs importados con costo directo exacto (desvíos: '+dif+', peor '+peor.toFixed(4)+')');

console.log('== 3. Cadena aritmética del B-2 ==');
M.proyectoNuevo('APU');
const ins1=M.agregarInsumo('M','CEMENTO PORTLAND','kg',1.20);
const ins2=M.agregarInsumo('O','ALBAÑIL','hr',20.00);
const ins3=M.agregarInsumo('E','MEZCLADORA','hr',35.00);
const it=M.addItem({desc:'HORMIGÓN PRUEBA',und:'m³',cant:10});
it.comp=[{ins:ins1.id,rend:300},{ins:ins2.id,rend:4},{ins:ins3.id,rend:1}];
const p=M.proyecto().params, a=M.analisis(it);
const M_=360, O_=80, E_=35;
// cadena sin redondeos intermedios (sin redondeos intermedios)
const cargas=O_*p.cargas/100, iva=(O_+cargas)*p.ivaMO/100, tmo=O_+cargas+iva;
const herr=tmo*p.herr/100, teq=E_+herr, sub=M_+tmo+teq;
const gg=sub*p.gg/100, p2=sub+gg, ut=p2*p.util/100, p3=p2+ut;
const itx=p3*p.it/100, pu=M.r2(p3+itx);
ok(a.mat===M_&&a.mo===O_&&a.eq===E_,'subtotales netos M='+a.mat+' O='+a.mo+' E='+a.eq);
ok(a.cargas===M.r2(cargas)&&a.ivaMO===M.r2(iva)&&a.totalMO===M.r2(tmo),'cargas sociales e IVA MO');
ok(a.herr===M.r2(herr)&&a.totalEQ===M.r2(teq),'herramientas menores');
ok(a.subtotal===M.r2(sub)&&a.gg===M.r2(gg)&&a.util===M.r2(ut)&&a.it===M.r2(itx),'GG, utilidad e IT');
ok(Math.abs(a.pu-pu)<0.005,'precio unitario = '+a.pu+' (esperado '+pu+')');
ok(Math.abs(a.total-M.r2(pu*10))<0.05,'precio total x10 = '+a.total);

console.log('== 4. Cómputos métricos ==');
it.computos=[{d:'Zapatas',n:8,l:1.2,a:1.2,h:0.4},{d:'Viga',n:1,l:12,a:0.25,h:0.4}];
ok(M.totalComputos(it)===M.r2(8*1.2*1.2*0.4 + 12*0.25*0.4),'total cómputo = '+M.totalComputos(it));

console.log('== 5. Requerimiento de insumos ==');
it.cant=10;
const req=M.requerimiento();
const cem=req.find(x=>x.ins.d.indexOf('CEMENTO')>=0);
ok(cem && cem.cant===3000,'cemento requerido = '+(cem&&cem.cant)+' kg (300 x 10)');
ok(cem && cem.monto===3600,'monto cemento = '+(cem&&cem.monto));

console.log('== 6. Módulos, total y moneda ==');
const P=M.proyecto();
P.modulos.push({id:M.nid(),n:'MÓDULO # 2',items:[]});
P.moduloActivo=1; M.addItem({desc:'ÍTEM 2',und:'m',cant:5});
ok(P.modulos.length===2,'dos módulos');
ok(M.totalProyecto()===M.r2(M.totalModulo(P.modulos[0])+M.totalModulo(P.modulos[1])),'total = suma de módulos');
P.moneda='$US'; P.tc=6.96;
ok(Math.abs(M.conv(696)-100)<1e-9,'conversión a $US');
P.moneda='Bs';

console.log('== 7. Guardar / abrir proyecto ==');
const s=M.serializar();
M.proyectoNuevo('otro');
M.deserializar(s);
ok(M.proyecto().nombre==='APU' && M.proyecto().modulos.length===2,'round-trip .boq correcto');
ok(M.guardarLocal()===true,'guardado en almacenamiento local');

console.log('== 8. Cronograma y curva S ==');
M.proyecto().plazo=180;
M.distribuirCronograma();
const S=M.curvaS();
ok(S.length===6,'6 períodos mensuales ('+S.length+')');
ok(Math.abs(S[S.length-1].pct-100)<0.01,'curva S termina en 100% ('+S[S.length-1].pct+')');

console.log('== 9. Búsqueda en la base ==');
const r1=M.buscarEnBase(1,'hormigon',true,50);
ok(r1.length>0,'búsqueda «hormigon» en todas las bases: '+r1.length+' resultados');
const r2=M.buscarEnBase(1,'zzzznoexiste',true,50);
ok(r2.length===0,'búsqueda sin resultados devuelve 0');

console.log(fallos? '\nFALLOS: '+fallos : '\nTODAS LAS PRUEBAS PASARON');
process.exit(fallos?1:0);
