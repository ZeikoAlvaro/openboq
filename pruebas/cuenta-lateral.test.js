/* Quién está usando la aplicación se muestra en DOS lugares: la barra de
   estado (#stCuenta) y el pie de la barra lateral (#btnCuenta).

   Esta prueba existe por un bug de la v2.0: el del pie decía «Invitado» fijo
   en el HTML y nadie lo actualizaba nunca. Con la sesión iniciada seguía
   diciendo «Invitado», y los datos de la cuenta recién aparecían al hacer
   clic. Los dos tienen que decir lo mismo, siempre.

   No toca la red: NUBE es un doble de prueba. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');

const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

/**
 * Arranca la aplicación con una NUBE simulada.
 * @param {?{email:string}} usuario null = sin sesión
 */
function armar(usuario) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'file:///app/index.html' });
  const w = dom.window;
  w.alert = m => errores.push('ALERT: ' + m);
  w.onerror = m => errores.push('ONERROR: ' + m);

  /* Doble de NUBE: solo lo que ui.js consulta al pintar. Va ANTES de ui.js
     en el mismo eval porque en el navegador los <script> comparten el
     ámbito léxico global. */
  const doble = `
    var NUBE = {
      hay: () => true,
      conectado: () => ${usuario ? 'true' : 'false'},
      usuario: () => (${usuario ? JSON.stringify(usuario) : 'null'}),
      hayToken: () => false,
      recogerRedireccion: () => null,
      cargarUsuario: () => Promise.resolve(null),
      alEntrar: () => {},
      alFallarLogin: () => {},
      enviarCola: () => Promise.resolve(),
      enCola: () => 0,
      ultimoRespaldo: () => '',
      hayCandado: () => false,
      listarProyectos: () => Promise.resolve([]),
      infoBiblioteca: () => Promise.resolve(null),
      bajarBiblioteca: () => Promise.resolve(null)
    };`;
  const src = doble + '\n;\n' +
    ['data/catalogo.js', 'js/motor.js', 'js/importador.js', 'js/xlsx.js', 'js/reportes.js', 'js/ui.js']
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  try { w.eval(src); } catch (e) { errores.push('EVAL: ' + e.message); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}

console.log('== Sin sesión ==');
{
  const w = armar(null);
  const bt = w.document.querySelector('#btnCuenta');
  const st = w.document.querySelector('#stCuenta');
  ok(!!bt, 'el pie de la barra lateral tiene el botón de cuenta');
  ok(bt.querySelector('.txt').textContent === 'Invitado', 'dice «Invitado»: ' + bt.querySelector('.txt').textContent);
  ok(st.textContent.includes('Invitado'), 'y la barra de estado también');
  ok(!bt.classList.contains('dentro'), 'sin resaltar');
  w.close();   // ui.js deja temporizadores andando; sin esto el proceso no termina
}

console.log('== Con la sesión iniciada ==');
{
  const w = armar({ id: 'u1', email: 'alguien@ejemplo.com' });
  const bt = w.document.querySelector('#btnCuenta');
  const st = w.document.querySelector('#stCuenta');
  const txt = bt.querySelector('.txt').textContent;
  ok(txt === 'alguien@ejemplo.com', 'el pie muestra el correo, no «Invitado»: ' + txt);
  ok(!/Invitado/.test(bt.textContent), 'y en ninguna parte del botón queda «Invitado»');
  ok(st.textContent.includes('alguien@ejemplo.com'), 'la barra de estado dice lo mismo');
  ok(bt.classList.contains('dentro'), 'el pie queda resaltado');
  ok(/alguien@ejemplo\.com/.test(bt.title), 'y el título del botón nombra la cuenta');
  /* El 👤 vive en su propio <span class="i">: con la barra plegada es lo único
     que queda visible, así que no puede irse junto con el texto. */
  ok(!!bt.querySelector('.i'), 'el ícono sigue en su propio span');
  w.close();
}

if (errores.length) { console.log('\n' + errores.length + ' fallo(s)'); process.exit(1); }
console.log('\ntodo en orden');
process.exit(0);
