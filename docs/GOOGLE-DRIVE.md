# OpenBOQ y Google Drive

Los proyectos y las bases propias de cada usuario se guardan **en su propio Google Drive**, no en un
servidor de OpenBOQ. Este documento explica cómo se conecta, qué permiso se pide y qué queda dónde.

---

## Para quien usa la aplicación

1. Entrar a <https://openboq.pages.dev> e **iniciar sesión con Google**.
2. Abrir **CONFIGURACIÓN → Mi cuenta** y, en «En su Google Drive», pulsar **Conectar con mi Drive**. Google muestra una pantalla de permiso la
   primera vez.
3. Desde ahí, **Guardar** escribe el proyecto en la carpeta **OpenBOQ** de su Drive.
4. En otro equipo, o después de borrar el navegador, basta con iniciar sesión otra vez: los
   proyectos siguen en esa carpeta y se abren desde **Mi cuenta**.

Nada se guarda solo: el proyecto llega a Drive cuando el usuario guarda. Mientras tanto queda en el
navegador.

La carpeta es visible en <https://drive.google.com> como cualquier otra: se puede copiar,
compartir o borrar desde ahí. Si se borra un archivo desde Drive, OpenBOQ lo nota la próxima vez
que lista la carpeta.

---

## Cómo está hecho

### Dos permisos separados

| | Quién lo gestiona | Para qué |
|---|---|---|
| **Sesión de OpenBOQ** | Supabase Auth, con Google como proveedor | saber quién es el usuario |
| **Permiso de Drive** | Google directo, desde el navegador (`js/drive.js`) | leer y escribir la carpeta OpenBOQ |

Van separados a propósito. Supabase entrega el token de Google una sola vez y no lo renueva; la
alternativa sería guardar un *refresh token* del Drive de cada usuario en un servidor, que es
justamente lo que este diseño evita. **OpenBOQ no guarda ningún token de Drive en ningún servidor.**

### Alcance `drive.file`

Se pide `https://www.googleapis.com/auth/drive.file`: la aplicación **solo ve los archivos que ella
misma creó**. No puede leer el resto del Drive del usuario. Es un alcance no sensible para Google.

Se eligió sobre `drive.appdata` porque la carpeta de *appdata* es oculta: el usuario no la ve ni la
puede copiar.

### El token

- Flujo implícito de OAuth 2.0 en una ventana emergente. El `client_id` es público (está en
  `js/nube-config.js`); lo que protege la cuenta es la lista de direcciones de retorno autorizadas
  en la consola de Google.
- El token dura **una hora**. Vive en memoria y en `sessionStorage` de la pestaña: sobrevive a
  recargar la página y **muere al cerrarla**. No se comparte con otras pestañas ni perfiles.
- La renovación va montada en un clic del usuario (guardar, abrir) con `prompt=none`: si el
  permiso ya está dado, Google devuelve un token nuevo sin mostrar pantallas.
- El permiso vuelve a `drive.html`, una página propia, y no a `index.html`. Así el token de Drive
  nunca se confunde con la sesión de Supabase, que también vuelve con un token en la dirección.

### Dos reglas del navegador que condicionan el código

- **Una ventana emergente por gesto.** El navegador bloquea en silencio una segunda ventana abierta
  después de un `await`. Toda llamada que pueda abrir la ventana de Google sale directo del clic.
- **No existe renovación en segundo plano.** Sin interacción del usuario no se puede abrir la
  ventana de permiso, así que la renovación se hace cuando el usuario actúa.

### La carpeta

`drive.js` busca la carpeta **OpenBOQ** por nombre y guarda su id **por cuenta de Google**, no por
navegador: dos personas que usan el mismo equipo no se cruzan los archivos.

---

## Qué NO va a Drive, y qué NO va a Supabase

| Dato | Drive del usuario | Supabase |
|---|---|---|
| Proyecto completo (ítems, cantidades, montos, cómputos, entidad) | sí | **no** |
| Bases de precios propias | sí | **no** |
| Aporte técnico de un análisis (insumo, unidad, precio, rendimiento) | — | sí, **anónimo** y con desfase |

El filtro de lo que viaja como aporte está en `armarAporte()` de `js/nube.js`: cantidades de obra,
montos, cómputos, nombre del proyecto y de la entidad no salen del equipo.

---

## Para desarrollar

- `DRIVE_CFG.client_id` en `js/nube-config.js`. Vacío = la aplicación funciona igual, sin Drive.
- En la consola de Google, las direcciones de retorno tienen que incluir el `/drive.html` de cada
  origen desde donde se use OpenBOQ (`https://openboq.pages.dev`, `http://localhost:8731`,
  `http://127.0.0.1:8731`) y el `/auth/v1/callback` de Supabase.
- Si se usa un `client_id` propio en un fork, hay que registrar ahí sus propios orígenes.
- Pruebas: `pruebas/drive-carpeta.test.js` y `pruebas/drive-sesion.test.js`.
