/* Quién está usando la aplicación se muestra en la barra inferior
   (#stCuenta): nombre y círculo con iniciales, como la barra de Excel.

   Hasta la v2.7 también estaba en el pie de la barra lateral (#btnCuenta), y
   la prueba nació por un bug de la v2.0: ese pie decía «Invitado» fijo aunque
   hubiera sesión. Ahora la cuenta vive en un solo lugar y la lateral ya no
   tiene el botón.

   No toca la red: NUBE es un doble de prueba. */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');

const dir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

/**
 * Arranca la aplicación con una NUBE simulada.
 * @param {?{email:string, nombre?:string}} usuario null = sin sesión
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
  const st = w.document.querySelector('#stCuenta');
  ok(!w.document.querySelector('#btnCuenta'), 'la barra lateral ya no tiene el botón de cuenta');
  ok(!!st && !!st.closest('.estado'), 'la cuenta está en la barra inferior');
  ok(st.querySelector('.nom').textContent === 'Invitado', 'dice «Invitado»: ' + st.querySelector('.nom').textContent);
  ok(!st.classList.contains('dentro'), 'sin resaltar');
  w.close();   // ui.js deja temporizadores andando; sin esto el proceso no termina
}

console.log('== Con la sesión iniciada, sin nombre ==');
{
  const w = armar({ id: 'u1', email: 'alguien@ejemplo.com' });
  const st = w.document.querySelector('#stCuenta');
  ok(st.querySelector('.nom').textContent === 'alguien@ejemplo.com', 'muestra el correo: ' + st.querySelector('.nom').textContent);
  ok(!/Invitado/.test(st.textContent), 'y en ninguna parte queda «Invitado»');
  ok(st.querySelector('.avatar').textContent === 'A', 'el círculo lleva la inicial del correo: ' + st.querySelector('.avatar').textContent);
  ok(st.classList.contains('dentro'), 'queda resaltado');
  ok(/alguien@ejemplo\.com/.test(st.title), 'y el título nombra la cuenta');
  w.close();
}

console.log('== Con nombre de Google ==');
{
  const w = armar({ id: 'u2', email: 'ao@ejemplo.com', nombre: 'Alvaro Oczachoque' });
  const st = w.document.querySelector('#stCuenta');
  ok(st.querySelector('.nom').textContent === 'Alvaro Oczachoque', 'muestra el nombre: ' + st.querySelector('.nom').textContent);
  ok(st.querySelector('.avatar').textContent === 'AO', 'iniciales AO: ' + st.querySelector('.avatar').textContent);
  w.close();
}

if (errores.length) { console.log('\n' + errores.length + ' fallo(s)'); process.exit(1); }
console.log('\ntodo en orden');
process.exit(0);
