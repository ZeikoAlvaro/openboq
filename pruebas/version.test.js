/* El número de versión tiene que ser el mismo en los tres lugares.

   Si `index.html` sube el `?v=` y `sw.js` no —o al revés— los probadores
   siguen viendo la versión vieja guardada en el navegador y reportan errores
   ya corregidos. Es la confusión número uno de las pruebas, y `sw.js` tiene
   DOS números: `CACHE` y `V`. Ya pasó que se subiera uno solo.              */
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(dir, f), 'utf8');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const html = leer('index.html'), sw = leer('sw.js'), ui = leer('js/ui.js');

console.log('== index.html versiona todos sus archivos propios ==');
const vs = [...html.matchAll(/(?:src|href)="((?:js|css|data)\/[^"?]+)(\?v=(\d+))?"/g)];
const sinV = vs.filter(m => !m[2]).map(m => m[1]);
ok(!sinV.length, 'ningún archivo propio queda sin ?v=: ' + (sinV.join(', ') || 'todos lo llevan'));
const nums = [...new Set(vs.filter(m => m[3]).map(m => m[3]))];
ok(nums.length === 1, 'y todos con el mismo número: ' + nums.join(' / '));
const V = nums[0];

/* motor.js, ui.js y el resto no están en un <script src>: los carga el
   arranque por código con su propio `var V`. Estuvo fijo en '62' desde la
   v2.6 y nadie lo notó, porque la búsqueda de arriba no lo ve. */
const cargador = (html.match(/var V\s*=\s*'(\d+)'/) || [])[1];
ok(cargador === V, `el cargador de index.html pide ?v=${cargador} contra ?v=${V}`);
const panel = leer('panel.html');
const vPanel = [...new Set([...panel.matchAll(/(?:src|href)="(?:js|css)\/[^"?]+\?v=(\d+)"/g)].map(m => m[1]))];
ok(vPanel.length === 1 && vPanel[0] === V, `panel.html con ?v=${vPanel.join(' / ')} contra ?v=${V}`);

console.log('== sw.js acompaña con sus DOS números ==');
const cache = (sw.match(/CACHE\s*=\s*'openboq-v(\d+)'/) || [])[1];
const swV = (sw.match(/const V\s*=\s*'(\d+)'/) || [])[1];
ok(cache === V, `CACHE = openboq-v${cache} contra ?v=${V}`);
ok(swV === V, `V = '${swV}' contra ?v=${V}`);

console.log('== La versión que se muestra y la que se reporta coinciden ==');
const marca = (html.match(/<small>v([\d.]+)<\/small>/) || [])[1];
const verUI = (ui.match(/const VERSION\s*=\s*'([\d.]+)'/) || [])[1];
ok(marca === verUI, `la barra dice v${marca} y los reportes viajan como ${verUI}`);

console.log('== Lo que Google necesita para aprobar el permiso de Drive ==');
/* Tres cosas que se rompen calladas y solo se descubren cuando Google rechaza
   la verificacion, semanas despues:

     · la etiqueta de Search Console prueba que el sitio es de Alvaro. Si
       desaparece de index.html, Search Console pierde la propiedad;
     · la politica de privacidad tiene que EXISTIR y estar en este dominio —el
       intento anterior fue rechazado por apuntar a GitHub—;
     · y tiene que estar enlazada desde la pagina principal EN EL HTML, porque
       el rastreador de Google no ejecuta JavaScript. Un enlace pintado desde
       ui.js no cuenta.                                                       */
ok(/name="google-site-verification"\s+content="[A-Za-z0-9_-]{20,}"/.test(html),
  'index.html conserva la etiqueta de verificacion de Search Console');
ok(fs.existsSync(path.join(dir, 'privacidad.html')),
  'privacidad.html existe y viaja con el sitio');
ok(/href="privacidad\.html"/.test(html),
  'la pagina principal enlaza la politica desde el HTML estatico');

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'VERSIONES COHERENTES'));
process.exit(errores.length ? 1 : 0);
