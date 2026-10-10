# openboq-drive — canje del permiso de Google Drive

Worker **sin memoria** que deja el Drive del usuario conectado meses en vez de una hora
(decisión del 10/10/2026, opción B).

## Qué hace

| Ruta | Entra | Sale |
|---|---|---|
| `POST /canje` | `{code, code_verifier, redirect_uri}` | `{access_token, expires_in, refresh_token}` |
| `POST /renovar` | `{refresh_token}` | `{access_token, expires_in}` |
| `POST /revocar` | `{token}` | `{ok}` |

El navegador pide el permiso con flujo de código + PKCE (`js/drive.js`), este Worker lo canjea
con el `client_secret` y el **refresh token vuelve al navegador** (`localStorage`,
clave `openboq_drive_rt`, atado a la cuenta). El Worker no tiene KV, D1 ni logs: no guarda nada.

## Desplegar

```
cd drive-canje
npx wrangler deploy
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

El secreto sale de Google Cloud Console → APIs y servicios → Credenciales → el cliente
`621939092202-uco66nj1…` → «Secreto del cliente». **Es el mismo cliente que usa Supabase para
el login con Google: NO regenerar el secreto** (rompe el login; si alguna vez se regenera, hay que
cargarlo en Supabase → Authentication → Providers → Google **y** acá).

Sin el secreto el Worker responde 503 y la aplicación muestra el error al conectar Drive.

## Lo que hay que saber

- **Orígenes**: `ORIGENES` en `wrangler.toml` + `127.0.0.1`/`localhost` con cualquier puerto
  (escritorio). Un origen nuevo (dominio propio) va acá, en `connect-src` de `index.html` y en
  las URI de retorno de Google (`<origen>/drive.html`).
- **Riesgo aceptado**: quien robe un refresh token de un navegador puede renovarlo por este Worker
  (el chequeo de Origin no frena a `curl`). El alcance es `drive.file`: solo los archivos que
  creó OpenBOQ. Mitigación: CSP de `index.html`, y «Salir de la cuenta» borra el token del equipo.
- **Salir no revoca** en Google (desconectaría el Drive del usuario en sus otros equipos). Quitar
  el permiso del todo: myaccount.google.com → Seguridad → Apps de terceros.
- Google invalida el refresh token si pasan **6 meses sin usarlo**, si el usuario quita el permiso,
  o si una cuenta acumula más de 100 tokens con este cliente (se cae el más viejo). La app lo
  detecta (400 `invalid_grant`), lo tira y el próximo clic pide el permiso otra vez.
