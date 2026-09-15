# OpenBOQ escritorio — armar los instaladores de Windows

Convierte la misma aplicación web de OpenBOQ en un programa de Windows que se
instala, aparece en el menú Inicio y arranca sin navegador ni internet.

La aplicación web **no se toca**: el paquete se arma con los mismos
`index.html`, `css/`, `js/` y `data/catalogo.js` que se publican en la nube.

---

## Qué cubre cada instalador

| Canal | Instalador | Windows | Arquitectura |
|---|---|---|---|
| `universal` | `OpenBOQ-2.2.0-universal-instalador.exe` | **7 SP1, 8, 8.1, 10, 11** | x86 nativo · x64 por WOW64 · **ARM64 por emulación** |
| `x64` | `OpenBOQ-2.2.0-x64-instalador.exe` | 10, 11 | x64 nativo |
| `arm64` | `OpenBOQ-2.2.0-arm64-instalador.exe` | 11 ARM | ARM64 nativo |

Cada canal deja además una versión **portable**
(`OpenBOQ-2.2.0-<canal>-portable.exe`): un solo archivo, sin instalar, para
pendrive.

**Si hay que elegir uno solo, es `universal`**: es de 32 bits, y Windows de 64
bits ejecuta programas de 32 bits con WOW64, mientras que Windows 10 y 11 en
ARM traen emulación de x86. Un único archivo entra en todas las máquinas de la
tabla. Los canales `x64` y `arm64` son mejoras de velocidad y de seguridad,
no requisitos.

### Por qué no alcanza un solo canal

Electron 22.3.27 es la **última versión que arranca en Windows 7 SP1 y 8.1**;
de Electron 23 en adelante exigen Windows 10. Por eso el canal `universal`
queda clavado en esa versión y los otros dos usan el Electron actual.

> **Seguridad — leer antes de repartir el canal `universal`.**
> Electron 22 dejó de recibir actualizaciones en enero de 2023: lleva
> Chromium 108 sin ningún parche posterior. Es el precio de soportar
> Windows 7, que tampoco tiene parches desde enero de 2020. Entregar ese
> instalador **solo** a quien realmente tiene Windows 7 u 8; en Windows 10 y
> 11 va el canal `x64`. La ventana corre con `contextIsolation`, `sandbox`,
> sin integración de Node y solo carga contenido local, así que lo expuesto
> es poco, pero no es cero.

---

## Armar

En esta carpeta (`OpenBOQ/escritorio`):

```
npm install
npm run armar
```

Los tres instaladores y las tres portables quedan en `escritorio/salida/`.

Para un canal solo:

```
npm run armar:universal
npm run armar:x64
npm run armar:arm64
```

**Requisitos de la máquina que arma** (no de la que instala):

- Node 18 o más nuevo.
- Internet la primera vez: `electron-builder` descarga cada versión de
  Electron y la deja en caché en `%LOCALAPPDATA%\electron\Cache`. Después
  arma sin conexión.
- Windows, para que salgan los `.exe` de NSIS.

### Probar sin armar nada

```
npm start
```

Abre la ventana de Electron sirviendo la carpeta del proyecto tal como está,
sin empaquetar. Es la forma rápida de ver un cambio de la aplicación web
dentro de la ventana de escritorio.

---

## Cómo se instala del otro lado

El instalador es **por usuario**: se instala en `%LOCALAPPDATA%\Programs\OpenBOQ`
y **no pide contraseña de administrador**. Pensado para máquinas de oficina
donde el usuario no es administrador.

- Deja acceso directo en el escritorio y en el menú Inicio.
- Permite cambiar la carpeta de instalación.
- Al desinstalar **no borra los datos**: proyectos, biblioteca y preferencias
  siguen ahí si se vuelve a instalar.

**Windows va a mostrar el aviso «Windows protegió su PC» la primera vez.**
Los instaladores no están firmados con certificado. Se abre con
*Más información → Ejecutar de todas formas*. Sacar ese aviso cuesta un
certificado de firma de código (unos 200 USD al año) y es decisión aparte.

Sin teclado, para instalar en varias máquinas:

```
OpenBOQ-2.2.0-x64-instalador.exe /S /currentuser
```

`/S` sola **no alcanza**: hace falta también `/currentuser`. Para desinstalar,
lo mismo con `"%LOCALAPPDATA%\Programs\OpenBOQ\Uninstall OpenBOQ.exe"`.

---

## Archivos

| Archivo | Qué hace |
|---|---|
| `main.js` | Proceso principal: servidor interno, ventana, «Guardar como» y actualizaciones. |
| `preload.js` | Marca `window.OPENBOQ_ESCRITORIO`: datos de la instalación, menú nativo y login. No expone nada de Node. |
| `servidor.js` | Servidor HTTP interno en `127.0.0.1:8731` y la vuelta del login. |
| `hacer.js` | Arma los instaladores. Toda la lógica de canales vive acá. |
| `electron-builder.base.json` | Configuración compartida de empaquetado. |
| `recursos/hacer-icono.ps1` | Genera `recursos/icono.ico` en 7 tamaños. |
| `pruebas/version.test.js` | Prueba el guardia de versiones. |
| `pruebas/servidor.test.js` | Prueba la vuelta del login. `npm run probar` corre las dos. |
| `LEEME-ANTIVIRUS.md` | Por qué protesta el antivirus y las tres salidas posibles. |
| `salida/<canal>/` | Los instaladores de ese canal. No se versiona. |

### Banderas de línea de comandos

| Bandera | Para qué |
|---|---|
| `--sin-aceleracion` | Apaga la GPU. Para equipos viejos donde la ventana sale negra o parpadea. |
| `--sin-actualizar` | No busca actualizaciones al arrancar. |
| `--consola` | Abre las herramientas de desarrollo. |
| `--puerto=N` | Cambia el puerto interno. **Cambia el origen y con eso el `localStorage`.** |
| `--carpeta-descargas=<ruta>` | Guarda las exportaciones ahí sin preguntar, en vez de abrir el «Guardar como». |
| `--vuelta-entrar` | Al entrar con Google vuelve por `/entrar` en vez de por la raíz. Requiere agregar `http://127.0.0.1:8731/entrar` a las «Redirect URLs» de Supabase. |

---

## Guardar archivos

El `.boq` y el `.ddp` ya se guardaban bien: `ui.js` usa `showSaveFilePicker`,
que dentro de Electron abre el diálogo del sistema igual que en Chrome, y
recuerda el archivo para que «Guardar» vuelva a escribir sobre el mismo.

Lo que **no** pasaba por ahí son las salidas a **Excel y CSV** de
`reportes.js`, que usan `<a download>`. Sin nada de por medio, Electron las
tira en Descargas sin preguntar. Ahora `main.js` intercepta la descarga
(`will-download`) y abre el «Guardar como» del sistema:

- título con el nombre del archivo,
- filtro según la extensión (`.xlsx`, `.csv`, `.boq`, `.ddp`, `.json`),
- arranca en la **última carpeta usada**, y si no hay, en Documentos.

La carpeta se recuerda en memoria durante la sesión y en
`%APPDATA%\OpenBOQ\ajustes.json` para las siguientes.

> **Antivirus.** En la máquina de pruebas, **Avast bloqueó** que OpenBOQ
> escribiera ese archivo de ajustes (`IDP.Generic`), y dejó la ruta vedada
> incluso para el usuario. Es una heurística que se dispara con ejecutables
> **sin firmar**. La aplicación lo tolera: la sesión en curso igual recuerda
> la carpeta; solo se pierde recordarla después de cerrar. La cura de raíz es
> firmar el ejecutable — ver **`LEEME-ANTIVIRUS.md`**, que tiene las opciones
> de certificado con sus costos, cómo firmar desde acá (`CSC_LINK`) y las
> exclusiones de Avast y Defender mientras tanto.

---

## La barra de menús

La barra de menús de Windows muestra **las opciones de OpenBOQ**, no las del
andamio que lo hospeda. No hay «acercar», ni «alejar», ni «pantalla
completa», ni un «Acerca de» que hable de Electron: eso es del entorno, no
del programa, y en la ventana de una aplicación de escritorio no tiene por
qué estar a la vista.

**La lista la manda la página, no `main.js`.** Al arrancar, `ui.js` toma su
propia definición de menús —la misma que dibuja el menú de adentro— y se la
pasa al proceso principal por `window.OPENBOQ_ESCRITORIO.menu(...)`. El
proceso principal la dibuja y, cuando el usuario elige algo, devuelve el
identificador de la acción; la página la ejecuta. Hay **una sola definición
de menú** en todo el proyecto: si la aplicación web suma una opción, el menú
nativo la tiene sin tocar nada de `escritorio/`.

Puesto el menú nativo, **el de adentro se oculta**. Dos barras de menú con lo
mismo es peor que una.

A cada menú se le pegan al final las cosas que solo existen en el escritorio:

| Menú | Lo que agrega el escritorio |
|---|---|
| Archivo | Salir de OpenBOQ |
| Edición | Deshacer, Rehacer, Cortar, Copiar, Pegar, Seleccionar todo |
| Ayuda | Buscar actualizaciones…, Ver las descargas en la web, Recargar la ventana, Herramientas de desarrollo, Datos de esta instalación… |

> **Los atajos se dibujan pero no se registran** (`registerAccelerator:
> false`). La página ya escucha Ctrl+S, Ctrl+N, Ctrl+O, F3, Insert y Supr por
> su cuenta. Registrándolos también en el menú, Windows se los quedaría antes
> de que llegaran a la página: **Supr dejaría de borrar texto dentro de una
> celda y pasaría a borrar el ítem entero.** Los únicos atajos registrados de
> verdad son los que la página no escucha: Ctrl+R, F12, Alt+F4 y los de
> edición de texto.

Si la página no contesta —no cargó, falló el preload—, queda un menú mínimo
con solo lo del escritorio. Nunca se queda sin menú.

---

## Entrar con Google

**Google no acepta su pantalla de login dentro de una ventana de Electron**:
la reconoce como navegador incrustado y responde `disallowed_useragent`. No
hay manera de dar vuelta eso desde acá, así que el login sale al navegador
del sistema. El problema entonces es cómo vuelve la sesión.

**Antes no volvía.** El proveedor redirigía a `http://127.0.0.1:8731/`, que
es el servidor interno, y el navegador cargaba *otra copia* de OpenBOQ con la
sesión guardada en el almacenamiento **del navegador**. La aplicación seguía
mostrando «Invitado»: la sesión existía, pero del otro lado del vidrio.

Ahora la vuelta se intercepta:

1. La aplicación pide una **llave de un solo uso** al proceso principal y
   abre el navegador del sistema con esa dirección de vuelta.
2. El proveedor devuelve el token en el **fragmento** de la URL
   (`#access_token=…`), que el navegador nunca manda al servidor: solo lo ve
   el JavaScript de la página.
3. La página de vuelta lee su propio fragmento y lo manda por **POST a
   `127.0.0.1`**. Ahí el token cruza del navegador a la aplicación sin salir
   de la máquina.
4. El proceso principal se lo pasa a la ventana, que lo guarda como si el
   login hubiera ocurrido adentro, y trae la ventana al frente.

**Por qué se vuelve a la raíz y no a `/entrar`.** Supabase solo redirige a
las direcciones que tiene en su lista de *Redirect URLs*; a cualquier otra la
manda al *Site URL* —el sitio publicado— y ahí el token se pierde para
siempre. La raíz ya está en esa lista, así que es la única que funciona sin
depender de un ajuste del panel. El script del principio de `index.html`
reconoce el caso y entrega el token sin arrancar el resto de la aplicación.

Agregando `http://127.0.0.1:8731/entrar` a esa lista, `--vuelta-entrar` usa
una página de vuelta liviana en vez de cargar la aplicación entera en el
navegador. Es mejor, pero es opcional.

**Lo que protege el POST.** Cualquier programa de la máquina puede hacerle
POST a `127.0.0.1:8731`. Por eso solo se acepta una sesión mientras hay un
login **pedido desde la aplicación** —dura cinco minutos y se consume al
primer uso—, y si la página de vuelta trajo llave, tiene que coincidir.

`npm run probar` cubre este camino (13 casos, sin necesidad de Electron).

---

## Actualizaciones

La versión instalada se actualiza sola con `electron-updater`. La portable no:
no hay nada instalado que reemplazar.

**Cada canal tiene su propio feed**, y eso no es un detalle: un equipo con el
paquete de 32 bits no puede recibir el de 64. Por eso cada canal sale en su
carpeta con su propio `latest.yml`.

Para publicar una versión nueva:

1. Subir el número en `escritorio/package.json`.
2. `npm run armar`.
3. Subir el contenido de cada carpeta de `salida/` al feed del canal — **los
   tres archivos**, incluido el `.blockmap`: sin él la actualización se baja
   entera en vez de solo los pedazos que cambiaron.

### Dónde puede vivir el feed — y dónde no

`openboq.pages.dev` está en **Cloudflare Pages, que no acepta archivos de más
de 25 MiB**. Los instaladores pesan del orden de 90 MB: **no entran ahí.**
Mientras `PUBLICACION` apunte a Pages, ningún `latest.yml` va a poder
publicarse junto a su `.exe` y «Buscar actualizaciones» va a contestar
siempre que no hay nada publicado.

Las dos salidas, las dos gratuitas para este tamaño:

- **Cloudflare R2** con un dominio público. Es el mismo proveedor que ya se
  usa, no tiene tope por archivo y el feed queda igual de simple: se cambia
  `PUBLICACION` en `hacer.js` por la dirección del bucket.
- **Releases de un repositorio** (GitHub o similar). En ese caso conviene
  cambiar el `provider` de `generic` a `github` en `hacer.js`, y
  `electron-builder` arma los `latest.yml` apuntando solos.

`hacer.js` avisa al terminar el armado si algún `.exe` pasó el tope de Pages.

### Qué ve el usuario

Al arrancar busca **en silencio**: si no hay internet, si el servidor no
contesta o si todavía no se publicó nada, no dice nada. Solo
**Ayuda → Buscar actualizaciones…** informa siempre el resultado.

Ese chequeo pedido a mano **ya no muestra el error crudo**. Antes, cuando el
feed no existía, salía el mensaje de `electron-updater` —«Cannot find
latest.yml», «HttpError: 404»— y parecía que la aplicación había perdido un
archivo suyo. Ahora los tres casos se distinguen:

| Situación | Lo que dice |
|---|---|
| El feed no tiene nada publicado (404) | «Todavía no hay actualizaciones publicadas», aclarando que **no falta ningún archivo de OpenBOQ**, con botón para ver las descargas |
| Sin conexión | «No se pudo consultar si hay una versión nueva», aclarando que OpenBOQ funciona igual sin internet |
| Cualquier otra respuesta | El error, más el camino para bajar la última versión a mano |

---

## Versiones: son dos números distintos

- **El del programa** — `escritorio/package.json`. Es el que ve Windows y el
  que compara el actualizador.
- **El de la aplicación web** — el `?v=N` de `index.html`, que también está en
  `sw.js`. Sirve para que el navegador no siga usando su caché vieja.

`hacer.js` lee el `?v=N`, **comprueba que `sw.js` diga lo mismo y corta el
armado si no coinciden** — ese desajuste es justo el que deja al usuario
viendo la versión anterior, y empaquetarlo lo congela adentro del instalador.
Después lo estampa en el paquete, así **Ayuda → Acerca de** muestra las dos
numeraciones y se sabe qué versión de la aplicación trae ese `.exe`.

`npm run probar` ejercita ese guardia (6 casos) y la vuelta del login (13).

---

## Las tres decisiones que no conviene tocar

**1. La ventana carga `http://127.0.0.1:8731`, no `file://`.**
Con `file://` se rompen el `fetch` de `acceso.json` y las rutas relativas, y
la página deja de ser un origen seguro, con lo que `crypto.subtle` deja de
funcionar. Servirla desde `127.0.0.1` deja la aplicación idéntica a la
publicada. El servidor escucha **solo** en `127.0.0.1`: nada sale de la
máquina y Windows no levanta el aviso del cortafuegos.

**2. El puerto es fijo (8731), no aleatorio.**
Los proyectos, la biblioteca y las preferencias viven en `localStorage`, que
el navegador guarda **por origen — y el origen incluye el puerto**. Con un
puerto al azar en cada arranque, cada sesión estrenaría un almacenamiento
vacío y el usuario vería sus proyectos desaparecer. Si el 8731 está ocupado
se prueban los siguientes y la aplicación **avisa con un cartel** que los
datos anteriores están en el puerto de siempre.

**3. El paquete no lleva `sw.js`.**
En escritorio los archivos ya son locales; el service worker solo reviviría
la trampa de la caché con la versión vieja del `?v=N`. `preload.js` pone la
marca y `index.html` salta el registro.

---

## Qué quedó comprobado (2026-08-29)

### La aplicación corriendo

| Comprobación | `universal` (ia32) | `x64` |
|---|---|---|
| Arranca y muestra la pantalla de inicio | sí | sí |
| Electron / Chromium | 22.3.27 / 108.0.5359.215 | 44.0.0 / 152.0.7977.54 |
| Servidor interno responde en `127.0.0.1:8731` | sí | sí |
| `data/catalogo.js` se sirve completo (1,79 MB) | sí | sí |
| `window.OPENBOQ_ESCRITORIO` presente | sí | sí |
| Service workers registrados | 0 | 0 |
| Errores en la consola de la página | ninguno | ninguno |
| Proyectos guardados sobreviven al reinicio | sí | — |
| Exportación escrita en disco con el contenido correcto | sí | sí |

### Instalación y desinstalación (canal `x64`, de punta a punta)

- **Instalación silenciosa**: `OpenBOQ-…-instalador.exe /S /currentuser`
  (solo `/S` no alcanza). Instala en `%LOCALAPPDATA%\Programs\OpenBOQ` sin
  pedir administrador.
- Deja acceso directo en el escritorio y en el menú Inicio, y la entrada
  «OpenBOQ 2.2.0 (x64)» en Programas y características del usuario.
- **Actualización sobre lo instalado**: instalar una versión más nueva encima
  deja **una sola** entrada en el registro y el `.exe` con la versión nueva.
- **Desinstalación silenciosa**: `"Uninstall OpenBOQ.exe" /S /currentuser`.
  Saca los dos accesos directos, la entrada del registro y todos los archivos
  del programa, y **conserva los datos del usuario** (`%APPDATA%\OpenBOQ`,
  con el `localStorage` donde viven los proyectos).

### El «Guardar como»

Sale con el título del archivo, el filtro de la extensión y arrancando en la
carpeta correcta (Documentos la primera vez). Verificado en pantalla.
La escritura del archivo, con el contenido exacto, se verificó por separado
en los dos canales con `--carpeta-descargas`.

**No se pudo automatizar el clic final en «Guardar»**: el aviso de Avast
(elevado y siempre encima) se queda con el teclado y el ratón, y ninguna
ventana de otro programa puede sacárselo. La parte no cubierta es el propio
`showSaveDialogSync` de Electron.

### Las actualizaciones

Probadas contra un feed local que hacía de `openboq.pages.dev`:

- La aplicación pide el `latest.yml` sola al arrancar.
- Detecta la versión nueva y **se baja el instalador entero** (98,9 MB) al
  cache del actualizador.
- Muestra el aviso ofreciendo reiniciar para instalar.
- El instalador bajado, corrido a mano, actualiza sobre lo instalado sin
  duplicar entradas.

El `.blockmap` no estaba publicado en esa prueba (404) y el actualizador cayó
solo a bajar el paquete completo, como corresponde.

### El guardia de versiones

`npm run probar`: 6 de 6.

### Lo que NO se probó

- El canal **`arm64` corriendo**: hace falta una máquina Windows ARM. Es el
  mismo código y el mismo Electron que `x64`.
- El botón **«Instalar y reiniciar»** del aviso de actualización (bloqueado
  por Avast, igual que el «Guardar»).

> **Si se mata OpenBOQ desde el Administrador de tareas se pierde lo último.**
> `localStorage` escribe a disco con un retardo de segundos, igual que en
> cualquier navegador. Cerrar por la X o con Alt+F4 guarda bien; matar el
> proceso a la fuerza puede perder los últimos cambios. Comprobado: con
> cierre normal el dato vuelve, con `Stop-Process -Force` no.

---

## Pendiente

- **Firma de código.** Es lo que queda, y arregla tres cosas de una: el aviso
  «Windows protegió su PC», el bloqueo de Avast sobre los archivos que escribe
  la aplicación, y la verificación de firma del actualizador. Unos 200 USD al
  año.
- **Probar el canal `arm64`** en una máquina Windows ARM.
- **Publicar los instaladores** en `openboq.pages.dev/descargas/<canal>/` para
  que la actualización automática deje de ser teoría.
