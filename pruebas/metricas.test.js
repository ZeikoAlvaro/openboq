/* Métricas con Plausible (js/metricas.js).

   Lo que no se negocia:
   - sin SCRIPT, en localhost o en el escritorio no se carga nada ni se
     llama a nadie: las pruebas y el servidor local no ensucian los números;
   - cada evento lleva la marca `cuenta` (si / no) e `interfaz`;
   - solo salen las acciones de la lista, nunca un identificador cualquiera;
   - y que index.html y la CSP dejen pasar a plausible.io.

   El archivo se evalúa en un contexto armado a mano, con SCRIPT reemplazado
   para simular el sitio ya configurado.                                    */
const vm = require('vm');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const fuente = fs.readFileSync(path.join(dir, 'js/metricas.js'), 'utf8');

function armar({ host = 'openboq.pages.dev', script = 'https://plausible.io/js/pa-PRUEBA.js',
  token = false, perfil = null, escritorio = false } = {}) {
  const agregados = [];
  const ls = new Map();
  if (perfil) ls.set('openboq_perfil', JSON.stringify(perfil));
  const win = {
    location: { hostname: host, protocol: 'https:', origin: 'https://' + host },
    document: { createElement: () => ({}), head: { appendChild: s => agregados.push(s) } },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null) },
    NUBE: { hayToken: () => token }
  };
  if (escritorio) win.OPENBOQ_ESCRITORIO = {};
  win.window = win;
  const ctx = vm.createContext(win);
  const src = fuente.replace("const SCRIPT = '';", `const SCRIPT = '${script}';`) +
    '\nwindow.METRICAS = METRICAS;';
  vm.runInContext(src, ctx);
  /* lo que se encoló para Plausible, con las marcas resueltas como lo haría el script */
  const enviados = () => (win.plausible && win.plausible.q || []).map(a => {
    const props = win.plausible.o.customProperties();
    return { nombre: a[0], opc: a[1], props };
  });
  return { M: win.METRICAS, agregados, enviados, win };
}

console.log('== apagado donde no corresponde ==');
for (const [txt, o] of [['SCRIPT vacío', { script: '' }], ['localhost', { host: 'localhost' }],
  ['127.0.0.1', { host: '127.0.0.1' }], ['escritorio', { escritorio: true }]]) {
  const a = armar(o);
  a.M.accion('nuevo'); a.M.vista('analisis');
  ok(!a.M.activo() && !a.agregados.length && !a.win.plausible, txt + ': no carga el script ni encola nada');
}

console.log('== en el sitio publicado ==');
const inv = armar();
ok(inv.M.activo() && inv.agregados.length === 1 && inv.agregados[0].src.includes('plausible.io'),
  'carga el script de Plausible una sola vez');
inv.M.accion('nuevo');
inv.M.accion('exportarXlsSel');
inv.M.accion('borrarTodo');          // no está en la lista
inv.M.accion('<script>');            // basura
inv.M.vista('cronograma');
const e = inv.enviados();
ok(e.length === 3, `salen 3 envíos (2 acciones + 1 vista), salieron ${e.length}`);
ok(e[0].nombre === 'Proyecto nuevo' && e[1].nombre === 'Exportar Excel', 'nombres de evento de la lista');
ok(e[2].nombre === 'pageview' && e[2].opc.url === 'https://openboq.pages.dev/vista/cronograma',
  'la pestaña sale como página virtual /vista/cronograma');
ok(e.every(x => x.props.cuenta === 'no' && x.props.interfaz === 'sin elegir'),
  'invitado: cuenta=no, interfaz=sin elegir');

const conCuenta = armar({ token: true, perfil: { modo: 'simple' } });
conCuenta.M.accion('guardar');
const p = conCuenta.enviados()[0].props;
ok(p.cuenta === 'si' && p.interfaz === 'simple', 'con sesión: cuenta=si, interfaz=simple');
ok(Object.keys(p).sort().join() === 'cuenta,interfaz', 'no viaja ninguna otra marca');

console.log('== index.html ==');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
ok(/script-src[^;]*https:\/\/plausible\.io/.test(csp), 'la CSP deja cargar el script de plausible.io');
ok(/connect-src[^;]*https:\/\/plausible\.io/.test(csp), 'la CSP deja mandar eventos a plausible.io');
ok(html.indexOf('js/metricas.js') > html.indexOf('js/nube.js'), 'metricas.js va después de nube.js');

console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
process.exit(errores.length ? 1 : 0);
