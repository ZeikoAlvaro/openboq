/* Codificación de los archivos de texto.

   Esta prueba existe por un accidente real: un reemplazo hecho con
   PowerShell leyó index.html como ANSI y lo reescribió como UTF-8. Cada
   carácter acentuado quedó codificado dos veces —«CÓMPUTOS» pasó a
   «CÃ“MPUTOS»— y los emoji de los botones se volvieron basura. Se publicó
   así, y a simple vista parecía un problema de tipografía.

   Dos reglas, y las dos son verificables:

     1. Ningún archivo lleva BOM. En un .js el BOM es un carácter invisible
        antes del código; en un .html empuja contenido fuera del <head>.
     2. Ningún archivo tiene doble codificación. La firma es inconfundible:
        «Ã©», «Ã³», «â€", «ðŸ"Ž». Son bytes UTF-8 leídos como Latin-1.

   Al editar estos archivos desde PowerShell, `Get-Content` sin `-Encoding
   utf8` lee en la codificación ANSI del sistema y rompe todo. Conviene usar
   las herramientas de edición, o Python declarando utf-8 en los dos lados. */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');
const EXT = ['.html', '.js', '.css', '.md', '.json', '.webmanifest', '.sql', '.txt'];
const SALTAR = ['node_modules', '.git', '.wrangler', 'muestras', 'data', 'datos',
  'OpenBOQ-Portable', 'openboq-publicar'];

let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

function recorrer(d, salida) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SALTAR.some(s => e.name.startsWith(s))) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) recorrer(p, salida);
    else if (EXT.includes(path.extname(e.name).toLowerCase())) salida.push(p);
  }
  return salida;
}

const archivos = recorrer(dir, []);
console.log(`== Codificación de ${archivos.length} archivos de texto ==`);

/* La firma del doble encodeado. No se busca «Ã» sola porque aparece
   legítimamente en cualquier texto en español mal acentuado; se buscan las
   parejas que solo salen de releer UTF-8 como Latin-1. */
const DOBLE = /Ã[©³¡­ºñ±"œ]|â€[""¦"]|ðŸ[^\s]/;

const conBom = [];
const conDoble = [];
for (const p of archivos) {
  /* Este archivo lleva los ejemplos de mojibake escritos a propósito, en los
     comentarios y en el patrón. Si se revisara a sí mismo, siempre fallaría. */
  if (path.basename(p) === 'codificacion.test.js') continue;
  const b = fs.readFileSync(p);
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF)
    conBom.push(path.relative(dir, p));
  if (DOBLE.test(b.toString('utf8')))
    conDoble.push(path.relative(dir, p));
}

ok(conBom.length === 0, 'ningún archivo lleva BOM' +
  (conBom.length ? ': ' + conBom.join(', ') : ''));
ok(conDoble.length === 0, 'ningún archivo tiene doble codificación' +
  (conDoble.length ? ': ' + conDoble.join(', ') : ''));

/* Los textos que se ven en pantalla: si estos están bien, el resto también. */
console.log('\n== La interfaz muestra los acentos y los emoji ==');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
[['CÓMPUTOS', 'la pestaña CÓMPUTOS'],
['ANÁLISIS (B-2)', 'la pestaña ANÁLISIS'],
['CONFIGURACIÓN', 'el menú CONFIGURACIÓN'],
['➕ Nuevo ítem', 'el botón de ítem nuevo, con su emoji'],
['🔎 Traer de la Base de Datos', 'el botón de traer de la base'],
['Módulo:', 'la etiqueta Módulo']
].forEach(([t, q]) => ok(html.includes(t), q));

ok(/<meta charset="utf-8">/i.test(html), 'index.html declara charset utf-8');

console.log('\n' + (fallos ? 'PROBLEMAS: ' + fallos : 'CODIFICACIÓN OK'));
process.exit(fallos ? 1 : 0);
