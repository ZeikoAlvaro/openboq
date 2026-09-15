/* =========================================================================
   OpenBOQ escritorio — proceso principal
   -------------------------------------------------------------------------
   Levanta el servidor interno en 127.0.0.1:8731 y abre la ventana contra él.
   La aplicación web no se toca: es la misma que se publica en la nube.

   Compatibilidad: este archivo se ejecuta tanto sobre Electron 22 (canal
   universal, Windows 7 SP1 en adelante) como sobre Electron moderno (canales
   x64 y arm64). Por eso NO usa ninguna API posterior a Electron 22: nada de
   protocol.handle(), nada de utilityProcess, nada de net.fetch.

   Banderas de línea de comandos:
     --sin-aceleracion   apaga la aceleración por GPU. Sirve en equipos
                         viejos con controladores de video rotos, donde la
                         ventana sale en negro o parpadea.
     --puerto=N          cambia el puerto del servidor interno. OJO: cambia
                         el origen y con eso el localStorage, así que los
                         proyectos guardados con otro puerto no se ven.
     --consola           abre las herramientas de desarrollo al arrancar.
     --sin-actualizar    no busca actualizaciones al arrancar.
     --vuelta-entrar     al entrar con Google, vuelve por la página liviana
                         /entrar en vez de por la raíz. Requiere tener
                         http://127.0.0.1:8731/entrar en la lista de
                         redirecciones permitidas de Supabase.
     --carpeta-descargas=<ruta>
                         guarda las exportaciones ahí sin preguntar, en vez
                         de abrir el «Guardar como». Para pruebas y para
                         exportar sin nadie al teclado.
   ========================================================================= */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const servidor = require('./servidor.js');

const VERSION = app.getVersion();

/* Dónde mirar cuando la actualización automática no puede resolverse sola.
   Es la misma página de siempre, no un feed: sirve para mandar a alguien a
   bajar el instalador a mano. */
const WEB_DESCARGAS = 'https://openboq.pages.dev/descargas/';

/* El canal (universal / x64 / arm64) lo escribe hacer.js dentro del
   package.json del paquete, con extraMetadata. Sirve para el «Acerca de» y
   para saber qué instalador tiene puesto quien reporta un problema. */
const CANAL = process.env.OPENBOQ_CANAL || (function () {
  try { return require('./package.json').openboqCanal || 'desarrollo'; }
  catch (e) { return 'desarrollo'; }
})();

/* Número de la aplicación web — el `?v=N` de index.html. Es otra numeración
   que la del programa: hacer.js lo lee del propio index.html al empaquetar y
   lo estampa acá, para que al reportar un problema se sepa exactamente qué
   versión de la aplicación trae este .exe adentro. */
const VERSION_WEB = (function () {
  try { return require('./package.json').openboqWeb || ''; }
  catch (e) { return ''; }
})();

/* Carpeta de la aplicación web.
   Empaquetada viaja en resources/openboq (extraResources), fuera del asar,
   para que el servidor la lea con fs normal. En desarrollo se sirve el
   proyecto tal cual está.

   NO se llama resources/app: esa ruta ya es una de las que Electron mira
   para encontrar la aplicación, y tenerla ocupada por otra cosa deja la
   resolución a merced del orden interno de Electron. */
const RAIZ = app.isPackaged
  ? path.join(process.resourcesPath, 'openboq')
  : path.resolve(__dirname, '..');

const args = process.argv.slice(1);
const tiene = n => args.indexOf('--' + n) !== -1;
const valor = n => {
  const a = args.find(x => x.indexOf('--' + n + '=') === 0);
  return a ? a.slice(n.length + 3) : null;
};

if (tiene('sin-aceleracion')) app.disableHardwareAcceleration();

/* Una sola copia. La segunda le devuelve el foco a la primera — y además
   evita que dos procesos peleen por el puerto 8731. */
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

let ventana = null;
let servicio = null;

/* Lo único que el preload le pide al proceso principal. Va por sendSync
   porque tiene que estar listo antes de que corra el primer script de la
   página, y devuelve datos, nunca capacidades. */
ipcMain.on('openboq-datos', e => {
  e.returnValue = {
    version: VERSION,
    canal: CANAL,
    plataforma: process.platform,
    arquitectura: process.arch,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    puerto: servicio ? servicio.puerto : 0,
    portable: PORTABLE
  };
});

/* ==================== BARRA DE MENÚS ====================
   El menú de Windows muestra las opciones DEL PROGRAMA, no las del entorno
   que lo hospeda. Nada de «acercar», «alejar», «pantalla completa» ni un
   «Acerca de» que hable de Electron: eso es del andamio, no de OpenBOQ, y
   en una aplicación de escritorio de verdad no tiene por qué estar a la
   vista.

   La lista NO se escribe acá. La manda la propia página al arrancar
   (`window.OPENBOQ_ESCRITORIO.menu(...)`) y es exactamente la misma que usa
   el menú de adentro: ARCHIVO, EDICIÓN, INSERTAR, REPORTES, HERRAMIENTAS,
   CONFIGURACIÓN y AYUDA con todas sus opciones. Una sola definición, en un
   solo lugar: si mañana la aplicación web suma una opción, el menú nativo
   la tiene sin tocar este archivo.

   Lo que sí se agrega acá es lo que SOLO puede hacer el escritorio: salir,
   recargar la ventana, la consola, buscar actualizaciones y los datos de
   esta instalación. Van pegados al final del menú que les corresponde, no
   en un menú aparte.

   LOS ATAJOS SE MUESTRAN PERO NO SE REGISTRAN (`registerAccelerator: false`).
   La página ya escucha Ctrl+S, Ctrl+N, Ctrl+O, F3, Insert y Supr por su
   cuenta. Registrándolos también acá, Windows se los quedaría antes de que
   llegaran a la página: Supr dejaría de borrar texto dentro de una celda y
   pasaría a borrar el ítem entero. Se dibujan como recordatorio y la página
   sigue siendo la única que los atiende.

   Los únicos atajos registrados de verdad son los que la página no escucha:
   Ctrl+R, F12, Alt+F4 y los de edición de texto. */

/* «Ctrl+Mayús+S» → «CmdOrCtrl+Shift+S». Electron no entiende los nombres en
   castellano ni las abreviaturas de la página, y un atajo que no sabe leer
   lo rechaza con una excepción que se llevaría puesto el menú entero. */
function atajo(txt) {
  if (!txt) return undefined;
  const t = String(txt)
    .replace(/May[úu]s/gi, 'Shift')
    .replace(/\bCtrl\b/gi, 'CmdOrCtrl')
    .replace(/\bIns\b/gi, 'Insert')
    .replace(/\bSupr\b/gi, 'Delete')
    .replace(/\s+/g, '');
  return /^[A-Za-z0-9+]+$/.test(t) ? t : undefined;
}

/* Lo propio del escritorio, por menú. La clave es el título en minúsculas y
   sin acentos, que es como la página nombra sus menús. */
function extrasDe(clave) {
  if (clave === 'archivo') return [
    { type: 'separator' },
    /* Dos cosas que el navegador no puede hacer y el escritorio sí: abrir
       carpetas del equipo. La primera ahorra buscar a mano dónde quedó lo
       último exportado; la segunda es para soporte —ahí viven ajustes.json
       y los registros— y para saber qué borrar si se quiere empezar limpio. */
    { label: 'Abrir la última carpeta usada', click: () => shell.openPath(carpetaInicial()) },
    { label: 'Abrir la carpeta de datos de OpenBOQ', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: 'Salir de OpenBOQ', accelerator: 'Alt+F4', role: 'quit' }
  ];
  if (clave === 'edicion') return [
    { type: 'separator' },
    { label: 'Deshacer', role: 'undo' },
    { label: 'Rehacer', role: 'redo' },
    { type: 'separator' },
    { label: 'Cortar', role: 'cut' },
    { label: 'Copiar', role: 'copy' },
    { label: 'Pegar', role: 'paste' },
    { label: 'Seleccionar todo', role: 'selectAll' }
  ];
  if (clave === 'ayuda') return [
    { type: 'separator' },
    { label: 'Buscar actualizaciones…', click: () => buscarActualizacion(true) },
    { label: 'Ver las descargas en la web', click: () => shell.openExternal(WEB_DESCARGAS) },
    { type: 'separator' },
    { label: 'Recargar la ventana', accelerator: 'CmdOrCtrl+R', click: () => ventana && ventana.reload() },
    { label: 'Herramientas de desarrollo', accelerator: 'F12', click: () => ventana && ventana.webContents.toggleDevTools() },
    { type: 'separator' },
    { label: 'Datos de esta instalación…', click: acercaEscritorio }
  ];
  return [];
}

const sinAcento = t => String(t || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* Arma el menú nativo con la lista que mandó la página.
   Cada opción devuelve su `acc` —el mismo identificador que usa el menú de
   adentro— y la página la ejecuta. Acá no se sabe qué hace ninguna: este
   proceso no conoce el presupuesto ni tiene por qué conocerlo. */
function menuDePagina(def) {
  const menus = (def || [])
    .filter(m => m && m.titulo && Array.isArray(m.items))
    .map(m => {
      const items = m.items.map(it => {
        if (!it || it.sep) return { type: 'separator' };
        if (!it.acc) return null;
        return {
          label: String(it.etiqueta || it.acc),
          accelerator: atajo(it.atajo),
          registerAccelerator: false,
          click: () => ventana && ventana.webContents.send('openboq-accion', it.acc)
        };
      }).filter(Boolean);
      return { label: String(m.titulo), submenu: items.concat(extrasDe(sinAcento(m.titulo))) };
    });

  if (!menus.length) return menuMinimo();

  /* Si la página no trajo alguno de los menús donde viven los extras, esos
     extras no pueden perderse: sin ellos no habría manera de buscar
     actualizaciones ni de abrir la consola. */
  ['archivo', 'edicion', 'ayuda'].forEach(clave => {
    if (menus.some(m => sinAcento(m.label) === clave)) return;
    const sueltos = extrasDe(clave).filter(x => x.type !== 'separator');
    if (sueltos.length) menus.push({ label: clave.charAt(0).toUpperCase() + clave.slice(1), submenu: sueltos });
  });

  return Menu.buildFromTemplate(menus);
}

/* El menú de antes de que la página conteste, y el de emergencia si nunca
   contesta. Solo lo del escritorio: las opciones del presupuesto las pone la
   página cuando termina de cargar. */
function menuMinimo() {
  return Menu.buildFromTemplate([
    { label: 'Archivo', submenu: extrasDe('archivo').filter(x => x.type !== 'separator') },
    { label: 'Edición', submenu: extrasDe('edicion').filter(x => x.type !== 'separator') },
    { label: 'Ayuda', submenu: extrasDe('ayuda').filter(x => x.type !== 'separator') }
  ]);
}

/* La página manda su menú al arrancar y otra vez después de cada recarga.
   Vale siempre el último. */
ipcMain.on('openboq-menu', (e, def) => {
  try {
    Menu.setApplicationMenu(menuDePagina(def));
  } catch (err) {
    /* Que quede dicho: si no, la aplicación se queda con el menú mínimo y
       parece que la página nunca contestó. */
    console.error('no se pudo armar el menu de la pagina: ' + ((err && err.message) || err));
    Menu.setApplicationMenu(menuMinimo());
  }
});

/* «Acerca de OpenBOQ» lo muestra la aplicación web, con su propio diálogo.
   Esto es otra cosa: los datos del PAQUETE, que son los que sirven cuando
   alguien reporta un problema y hay que saber qué instalador tiene puesto. */
function acercaEscritorio() {
  dialog.showMessageBox(ventana, {
    type: 'info',
    title: 'OpenBOQ — datos de esta instalación',
    message: 'OpenBOQ ' + VERSION + (PORTABLE ? ' (portable)' : ''),
    detail: [
      'Canal: ' + CANAL,
      'Aplicación: ' + (VERSION_WEB || '—'),
      'Arquitectura: ' + process.arch,
      'Electron: ' + process.versions.electron,
      'Windows: ' + os.release(),
      'Servidor interno: ' + (servicio ? servicio.url : '—'),
      '',
      'Estos son los datos que conviene copiar al reportar un problema.'
    ].join('\n'),
    buttons: ['Cerrar']
  });
}

/* Todo lo que no sea la propia aplicación se abre en el navegador del
   sistema, nunca adentro de la ventana. */
function afueraSoloHttps(url) {
  if (url.indexOf('https://') === 0) shell.openExternal(url);
}

/* ==================== ENTRAR CON UN PROVEEDOR ====================
   Google NO acepta que su pantalla de login corra dentro de una ventana de
   Electron: la reconoce como navegador incrustado y responde
   `disallowed_useragent`. Así que el login va sí o sí en el navegador del
   sistema, y el problema pasa a ser cómo vuelve la sesión.

   Antes no volvía. El proveedor redirigía a http://127.0.0.1:8731/, que es
   este mismo servidor, y el navegador cargaba OTRA copia de OpenBOQ con la
   sesión guardada en el almacenamiento DEL NAVEGADOR. La aplicación seguía
   como invitada: la sesión existía, pero del otro lado del vidrio.

   Ahora la vuelta se intercepta. El token viaja en el fragmento de la URL,
   que nunca llega al servidor, así que lo lee el JavaScript de la página de
   vuelta y lo manda por POST a 127.0.0.1. De ahí entra por acá y se le pasa
   a la ventana, que la guarda como si el login hubiera ocurrido adentro.

   LLAVE DE UN SOLO USO. Cualquier programa de esta máquina puede hacerle
   POST a 127.0.0.1:8731. Por eso solo se acepta una sesión mientras hay un
   login pedido desde la aplicación —dura cinco minutos y se consume al
   primer uso—, y si la página de vuelta trajo llave, tiene que ser la misma.

   La ruta `/` no puede traer llave (ahí aterriza el redirect_to de siempre,
   sin parámetros), así que en ese caso alcanza con que el login esté
   pedido. Es la diferencia entre exigir la lista de redirecciones de
   Supabase actualizada o no: con `/entrar` en esa lista el camino es el
   estricto; sin ella, funciona igual por `/`. */

const VENTANA_LOGIN_MS = 5 * 60 * 1000;
let loginPedido = null;      /* { llave, hasta } */

ipcMain.on('openboq-entrar', e => {
  const llave = require('crypto').randomBytes(16).toString('hex');
  loginPedido = { llave, hasta: Date.now() + VENTANA_LOGIN_MS };
  if (!servicio) { e.returnValue = null; return; }

  /* POR OMISIÓN SE VUELVE A LA RAÍZ, no a `/entrar`.

     Supabase solo redirige a las direcciones que tiene en su lista de
     «Redirect URLs»; a cualquier otra la manda al Site URL, o sea al sitio
     publicado, y el token se pierde para siempre del lado de allá. La raíz
     ya está en esa lista —es adonde volvía hasta ahora—, así que es la única
     que se puede usar sin depender de un ajuste del panel.

     `--vuelta-entrar` usa la página liviana `/entrar` en vez de cargar la
     aplicación entera en el navegador. Es mejor, pero exige agregar
     `http://127.0.0.1:8731/entrar` a esa lista primero. */
  e.returnValue = tiene('vuelta-entrar')
    ? servicio.url + 'entrar?e=' + llave
    : servicio.url;
});

/* La página ya armó la dirección del proveedor —sabe cuál es, este proceso
   no— y pide abrirla. Solo https, y solo si hay un login pedido: así esto no
   se convierte en un «abrime cualquier cosa» para el contenido de la
   ventana. */
ipcMain.on('openboq-abrir-login', (e, url) => {
  if (!loginPedido || Date.now() > loginPedido.hasta) return;
  if (String(url).indexOf('https://') !== 0) return;
  shell.openExternal(String(url));
});

/* Llega del navegador, por el servidor interno. Devuelve si se aceptó: el
   `false` es lo que la página de vuelta muestra como «no se pudo entrar». */
function recibirSesion(datos) {
  if (!loginPedido || Date.now() > loginPedido.hasta) { loginPedido = null; return false; }
  if (datos.llave && datos.llave !== loginPedido.llave) return false;
  loginPedido = null;                       /* un solo uso */
  if (!ventana) return false;

  ventana.webContents.send('openboq-sesion', {
    access_token: datos.access_token,
    refresh_token: datos.refresh_token || null,
    token_type: datos.token_type || 'bearer',
    expires_in: datos.expires_in || null
  });

  /* Traer la ventana al frente: el usuario está mirando el navegador y la
     sesión acaba de entrar del otro lado. */
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
  return true;
}

/* ==================== GUARDAR ARCHIVOS ====================
   El .boq y el .ddp ya se guardan con showSaveFilePicker, que en Electron
   abre el diálogo del sistema. Lo que NO pasaba por ahí son las salidas a
   Excel y CSV de reportes.js, que usan <a download>: sin esto Electron las
   escribe solo en Descargas, sin preguntar ni filtrar por tipo.

   Acá se les pone el mismo «Guardar como» del sistema, con el filtro que
   corresponde a la extensión y arrancando en la última carpeta usada. */

const FILTROS = {
  '.xlsx': [{ name: 'Libro de Excel', extensions: ['xlsx'] }],
  '.csv': [{ name: 'Valores separados por comas', extensions: ['csv'] }],
  '.boq': [{ name: 'Proyecto OpenBOQ', extensions: ['boq'] }],
  '.ddp': [{ name: 'Proyecto de PRESCOM', extensions: ['ddp'] }],
  '.json': [{ name: 'Archivo JSON', extensions: ['json'] }]
};
const TODOS = { name: 'Todos los archivos', extensions: ['*'] };

/* La última carpeta usada se guarda al lado de los datos de la aplicación,
   no adentro del proyecto: es preferencia de la máquina, no del presupuesto. */
/* La carpeta se recuerda en dos lugares: en memoria para la sesión que está
   corriendo, y en un archivo para las siguientes.

   Los dos, y no solo el archivo, porque en máquinas con antivirus el archivo
   puede no poder escribirse: Avast, por ejemplo, bloquea con heurística
   (IDP.Generic) que un .exe SIN FIRMAR escriba un .json en %APPDATA%. Cuando
   eso pasa, la sesión en curso igual recuerda la carpeta; lo único que se
   pierde es recordarla después de cerrar. Se arregla de raíz firmando el
   ejecutable.

   El archivo se llama ajustes.json y no preferencias.json porque Avast, al
   bloquearlo la primera vez, deja esa ruta vedada incluso para el usuario.
   Cambiar el nombre no cura la causa —la cura es la firma—, pero evita
   arrastrar una ruta que en esa máquina ya quedó inutilizable. */
let carpetaEnMemoria = null;

function archivoPreferencias() {
  return path.join(app.getPath('userData'), 'ajustes.json');
}
function leerPreferencias() {
  try { return JSON.parse(fs.readFileSync(archivoPreferencias(), 'utf8')); }
  catch (e) { return {}; }
}
function anotarCarpeta(dir) {
  if (dir === carpetaEnMemoria) return;      /* nada que anotar */
  carpetaEnMemoria = dir;
  try {
    const p = leerPreferencias();
    p.ultimaCarpeta = dir;
    fs.writeFileSync(archivoPreferencias(), JSON.stringify(p, null, 2), 'utf8');
  } catch (e) { /* queda solo en memoria: ver el comentario de arriba */ }
}
function carpetaInicial() {
  if (!carpetaEnMemoria) carpetaEnMemoria = leerPreferencias().ultimaCarpeta || null;
  if (carpetaEnMemoria && fs.existsSync(carpetaEnMemoria)) return carpetaEnMemoria;
  try { return app.getPath('documents'); } catch (e) { return app.getPath('home'); }
}

function descargasConDialogo(sesion) {
  sesion.on('will-download', (e, item) => {
    const nombre = item.getFilename();
    const ext = path.extname(nombre).toLowerCase();

    /* --carpeta-descargas=<ruta>: guarda ahí sin preguntar nada.
       Está para poder probar esta ruta de código sin un diálogo modal
       delante, y de paso sirve si alguna vez hace falta dejar OpenBOQ
       exportando sin nadie al teclado. Sin la bandera, siempre se pregunta. */
    const fija = valor('carpeta-descargas');
    if (fija) {
      item.setSavePath(path.join(fija, nombre));
      item.once('done', (ev, estado) => console.log('descarga ' + nombre + ': ' + estado));
      return;
    }

    /* showSaveDialogSync y no la versión asíncrona: setSavePath tiene que
       quedar puesto ANTES de que termine este manejador, o Electron abre su
       propio diálogo por su cuenta. */
    const destino = dialog.showSaveDialogSync(ventana, {
      title: 'Guardar ' + nombre,
      defaultPath: path.join(carpetaInicial(), nombre),
      filters: (FILTROS[ext] || []).concat([TODOS]),
      buttonLabel: 'Guardar'
    });

    if (!destino) { item.cancel(); return; }
    item.setSavePath(destino);
    anotarCarpeta(path.dirname(destino));

    item.once('done', (ev, estado) => {
      if (estado !== 'completed') {
        dialog.showErrorBox('OpenBOQ', 'No se pudo guardar ' + nombre + ' (' + estado + ').');
      }
    });
  });
}

function crearVentana(url) {
  const origen = new URL(url).origin;

  ventana = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#eceae5',
    title: 'OpenBOQ',
    icon: path.join(__dirname, 'recursos', 'icono.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(menuMinimo());   /* la página manda el suyo al cargar */

  /* Permisos: lista de PROHIBIDOS, no «negar todo».
     Negar todo parece más seguro, pero también corta el acceso al sistema de
     archivos, que es de donde salen «Guardar como» y «Abrir» de verdad
     (showSaveFilePicker / showOpenFilePicker). La aplicación no usa cámara,
     micrófono, ubicación ni notificaciones: se niegan esos. */
  const PROHIBIDOS = [
    'media', 'audioCapture', 'videoCapture', 'geolocation', 'notifications',
    'midi', 'midiSysex', 'pointerLock', 'hid', 'serial', 'usb', 'bluetooth',
    'idle-detection', 'speaker-selection', 'background-sync', 'display-capture'
  ];
  const permitido = permiso => PROHIBIDOS.indexOf(permiso) === -1;
  ventana.webContents.session.setPermissionRequestHandler((wc, permiso, conceder) => conceder(permitido(permiso)));
  ventana.webContents.session.setPermissionCheckHandler((wc, permiso) => permitido(permiso));

  descargasConDialogo(ventana.webContents.session);

  ventana.webContents.setWindowOpenHandler(({ url: destino }) => {
    afueraSoloHttps(destino);
    return { action: 'deny' };
  });

  ventana.webContents.on('will-navigate', (e, destino) => {
    if (new URL(destino).origin !== origen) { e.preventDefault(); afueraSoloHttps(destino); }
  });

  ventana.once('ready-to-show', () => {
    ventana.show();
    if (tiene('consola')) ventana.webContents.openDevTools();
    if (servicio && !servicio.estandar) avisarPuerto();
    /* Chequeo mudo, y no en el mismo instante del arranque: primero que la
       ventana quede usable. --sin-actualizar lo apaga (sirve para probar). */
    if (!tiene('sin-actualizar')) setTimeout(() => buscarActualizacion(false), 5000);
  });

  ventana.on('closed', () => { ventana = null; });

  ventana.loadURL(url);
}

/* Si el 8731 estaba ocupado, los proyectos guardados antes NO se ven: el
   navegador guarda por origen y el origen incluye el puerto. Mejor decirlo
   que dejar que el usuario crea que perdió su trabajo. */
function avisarPuerto() {
  dialog.showMessageBox(ventana, {
    type: 'warning',
    title: 'OpenBOQ — puerto ocupado',
    message: 'OpenBOQ arrancó en el puerto ' + servicio.puerto + ', no en el ' + servidor.PUERTO_ESTANDAR + '.',
    detail: [
      'Otro programa está usando el puerto de siempre.',
      '',
      'Consecuencia: los proyectos y la biblioteca guardados en sesiones',
      'anteriores NO aparecen en esta ventana. No se borró nada: vuelven a',
      'estar cuando OpenBOQ pueda usar el puerto ' + servidor.PUERTO_ESTANDAR + '.',
      '',
      'Antes de trabajar aquí, cerrar el otro programa y volver a abrir OpenBOQ.'
    ].join('\n'),
    buttons: ['Entendido']
  });
}

/* ==================== ACTUALIZACIONES ====================
   El instalador NSIS se actualiza solo contra los `latest.yml` que publica
   hacer.js junto a los .exe. Cada canal tiene su propia dirección: un equipo
   con el instalador de 32 bits no puede recibir el paquete de 64, así que los
   feeds están separados por canal y no se mezclan nunca.

   La versión PORTABLE no se actualiza: no hay nada instalado que reemplazar.
   Se detecta por PORTABLE_EXECUTABLE_DIR, que pone el propio empaquetador.

   El chequeo automático del arranque es MUDO: si no hay internet, si el
   servidor no responde o si todavía no se publicó nada, no se dice nada.
   Solo el chequeo pedido desde el menú informa lo que pasó. */

const PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
let actualizador;            /* undefined = sin resolver, false = no disponible */
let buscando = false;

function traerActualizador() {
  if (actualizador !== undefined) return actualizador;
  try {
    actualizador = require('electron-updater').autoUpdater;
    actualizador.autoDownload = true;
    actualizador.autoInstallOnAppQuit = true;
  } catch (e) {
    actualizador = false;
  }
  return actualizador;
}

/* Traduce el error de electron-updater a algo que se pueda leer.

   EL CASO FRECUENTE ES EL 404. electron-updater no pregunta «¿hay algo
   nuevo?»: se baja `latest.yml` del feed del canal y lo compara. Si ese
   archivo todavía no está publicado, el error que sale es de archivo no
   encontrado —«Cannot find latest.yml», «HttpError: 404»— y así, crudo,
   parece que la aplicación perdió un archivo suyo. No perdió nada: lo que
   falta está del lado del servidor, y mientras no se publique NINGUNA copia
   instalada va a poder actualizarse sola.

   Los otros dos casos son quedarse sin internet y que el servidor conteste
   cualquier otra cosa. Ninguno es culpa de quien está mirando la pantalla,
   así que ninguno se cuenta como error de la aplicación. */
function diagnosticar(err) {
  const txt = String((err && (err.stack || err.message)) || err || '');
  const codigo = (err && err.code) || '';

  const noHayFeed = /404|Cannot find|ENOTFOUND .*openboq|not found/i.test(txt);
  const sinRed = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR/i.test(txt + codigo);

  if (sinRed && !/404/.test(txt)) return {
    mensaje: 'No se pudo consultar si hay una versión nueva.',
    detalle: [
      'No hay conexión con el servidor de descargas.',
      '',
      'OpenBOQ funciona igual sin internet: esto solo afecta a la búsqueda',
      'de actualizaciones. Se puede volver a intentar más tarde.'
    ].join('\n'),
    web: false
  };

  if (noHayFeed) return {
    mensaje: 'Todavía no hay actualizaciones publicadas.',
    detalle: [
      'El canal «' + CANAL + '» no tiene ninguna versión publicada para',
      'descargar, así que no hay con qué comparar esta copia.',
      '',
      'No falta ningún archivo de OpenBOQ: esta instalación está completa.',
      'Cuando se publique una versión nueva, la aplicación la va a encontrar',
      'sola. Mientras tanto, la última se baja a mano desde la web.'
    ].join('\n'),
    web: true
  };

  return {
    mensaje: 'No se pudo comprobar si hay actualizaciones.',
    detalle: [
      'El servidor de descargas respondió algo inesperado.',
      '',
      String((err && err.message) || err),
      '',
      'La última versión siempre se puede bajar a mano desde la web.'
    ].join('\n'),
    web: true
  };
}

function buscarActualizacion(pedido) {
  const au = traerActualizador();

  if (!app.isPackaged || PORTABLE || !au) {
    if (!pedido) return;
    dialog.showMessageBox(ventana, {
      type: 'info',
      title: 'OpenBOQ',
      message: 'Esta copia no se actualiza sola.',
      detail: PORTABLE
        ? 'Es la versión portable: no hay nada instalado que reemplazar. Para\npasar a una versión nueva se descarga el .exe otra vez.'
        : 'La actualización automática solo funciona en la versión instalada.',
      buttons: ['Ver las descargas', 'Cerrar'],
      defaultId: 0,
      cancelId: 1
    }).then(r => { if (r.response === 0) shell.openExternal(WEB_DESCARGAS); });
    return;
  }

  if (buscando) return;
  buscando = true;

  au.removeAllListeners('update-available');
  au.removeAllListeners('update-not-available');
  au.removeAllListeners('update-downloaded');
  au.removeAllListeners('error');

  au.on('update-available', info => {
    if (!pedido) return;
    dialog.showMessageBox(ventana, {
      type: 'info',
      title: 'OpenBOQ',
      message: 'Hay una versión nueva: ' + info.version,
      detail: 'Se está descargando. Cuando termine, OpenBOQ avisa para\nreiniciarse e instalarla.',
      buttons: ['Entendido']
    });
  });

  au.on('update-not-available', () => {
    buscando = false;
    if (!pedido) return;
    dialog.showMessageBox(ventana, {
      type: 'info',
      title: 'OpenBOQ',
      message: 'OpenBOQ ' + VERSION + ' está al día.',
      buttons: ['Cerrar']
    });
  });

  au.on('update-downloaded', info => {
    buscando = false;
    dialog.showMessageBox(ventana, {
      type: 'question',
      title: 'OpenBOQ',
      message: 'La versión ' + info.version + ' está lista para instalarse.',
      detail: 'Hay que cerrar OpenBOQ para reemplazarlo. Guardar el trabajo\nantes de continuar.',
      buttons: ['Instalar y reiniciar', 'Más tarde'],
      defaultId: 1,
      cancelId: 1
    }).then(r => { if (r.response === 0) au.quitAndInstall(); });
  });

  au.on('error', err => {
    buscando = false;
    if (!pedido) return;                 /* el chequeo del arranque calla */
    const d = diagnosticar(err);
    dialog.showMessageBox(ventana, {
      type: 'info',
      title: 'OpenBOQ',
      message: d.mensaje,
      detail: d.detalle,
      buttons: d.web ? ['Ver las descargas', 'Cerrar'] : ['Cerrar'],
      defaultId: 0,
      cancelId: d.web ? 1 : 0
    }).then(r => { if (d.web && r.response === 0) shell.openExternal(WEB_DESCARGAS); });
  });

  au.checkForUpdates().catch(() => { buscando = false; });
}

app.on('second-instance', () => {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
});

app.whenReady().then(() => {
  const puerto = Number(valor('puerto')) || undefined;
  return servidor.iniciar(RAIZ, { puerto: puerto, entregarSesion: recibirSesion }).then(s => { servicio = s; crearVentana(s.url); });
}).catch(err => {
  dialog.showErrorBox('OpenBOQ no pudo arrancar', String((err && err.stack) || err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (servicio) servicio.cerrar();
  app.quit();
});
