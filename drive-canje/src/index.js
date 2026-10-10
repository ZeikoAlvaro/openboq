/* =========================================================================
   OpenBOQ — canje del permiso de Google Drive (Worker sin memoria)
   -------------------------------------------------------------------------
   POR QUÉ EXISTE. El Drive del usuario se «cerraba» cada hora: el flujo
   implícito de Google da un token de una hora y ningún refresh token, y
   renovarlo exige una ventana, que exige un clic. Para que el Drive quede
   conectado semanas hace falta un refresh token, y para conseguirlo Google
   exige el `client_secret` en el canje — que no puede ir en el navegador.

   Este Worker es ese canje y NADA MÁS:
     POST /canje    {code, code_verifier, redirect_uri} → {access_token, expires_in, refresh_token}
     POST /renovar  {refresh_token}                     → {access_token, expires_in}
     POST /revocar  {token}                             → {ok: true}

   LO QUE NO HACE, Y ES EL PUNTO: no guarda nada. Ni KV, ni D1, ni logs con
   cuerpos. El refresh token pasa por acá una vez y vuelve al navegador del
   usuario, que es el único lugar donde vive. La decisión del 10/09/2026
   —«ningún servidor guarda una llave del Drive de nadie»— sigue en pie.

   Defensas:
     · solo responde a los orígenes de OpenBOQ (CORS + chequeo del Origin);
     · el redirect_uri tiene que ser `<origen>/drive.html` del MISMO origen;
     · PKCE: un `code` robado sin su `code_verifier` no sirve;
     · cuerpo chico (4 KB) y sin reenviar nada que no sea lo de Google.
   ========================================================================= */

const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOCAR = 'https://oauth2.googleapis.com/revoke';
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

function origenValido(origen, env) {
  if (!origen) return false;
  if (LOCAL.test(origen)) return true;
  return String(env.ORIGENES || '').split(',').map(s => s.trim()).filter(Boolean).includes(origen);
}

function cabeceras(origen) {
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

const json = (obj, status, origen) =>
  new Response(JSON.stringify(obj), { status: status || 200, headers: cabeceras(origen) });

/** Habla con Google. Devuelve lo que Google contesta, sin agregar nada. */
async function google(url, campos) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(campos).toString()
    });
  } catch (e) {
    return { status: 502, datos: { error: 'google_inalcanzable' } };
  }
  let datos = {};
  try { datos = await r.json(); } catch (e) { datos = {}; }
  return { status: r.status, datos };
}

export default {
  async fetch(req, env) {
    const origen = req.headers.get('Origin') || '';
    if (!origenValido(origen, env)) return new Response('origen no permitido', { status: 403 });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabeceras(origen) });
    if (req.method !== 'POST') return json({ error: 'metodo' }, 405, origen);
    if (!env.GOOGLE_CLIENT_SECRET) return json({ error: 'sin_configurar' }, 503, origen);

    const largo = Number(req.headers.get('Content-Length') || 0);
    if (largo > 4096) return json({ error: 'muy_grande' }, 413, origen);
    let b;
    try { b = JSON.parse((await req.text()).slice(0, 4096)); } catch (e) { b = null; }
    if (!b || typeof b !== 'object') return json({ error: 'cuerpo' }, 400, origen);

    const ruta = new URL(req.url).pathname;
    const base = { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };

    if (ruta === '/canje') {
      const { code, code_verifier, redirect_uri } = b;
      if (!code || !code_verifier || redirect_uri !== origen + '/drive.html')
        return json({ error: 'parametros' }, 400, origen);
      const g = await google(TOKEN, Object.assign({
        grant_type: 'authorization_code', code: String(code),
        code_verifier: String(code_verifier), redirect_uri
      }, base));
      if (g.status !== 200 || !g.datos.access_token)
        return json({ error: g.datos.error || 'canje' }, g.status === 502 ? 502 : 400, origen);
      return json({
        access_token: g.datos.access_token,
        expires_in: g.datos.expires_in,
        refresh_token: g.datos.refresh_token || null,
        scope: g.datos.scope || ''
      }, 200, origen);
    }

    if (ruta === '/renovar') {
      if (!b.refresh_token) return json({ error: 'parametros' }, 400, origen);
      const g = await google(TOKEN, Object.assign({
        grant_type: 'refresh_token', refresh_token: String(b.refresh_token)
      }, base));
      if (g.status !== 200 || !g.datos.access_token)
        return json({ error: g.datos.error || 'renovar' }, g.status === 502 ? 502 : 400, origen);
      return json({ access_token: g.datos.access_token, expires_in: g.datos.expires_in }, 200, origen);
    }

    if (ruta === '/revocar') {
      if (!b.token) return json({ error: 'parametros' }, 400, origen);
      await google(REVOCAR, { token: String(b.token) });
      return json({ ok: true }, 200, origen);
    }

    return json({ error: 'ruta' }, 404, origen);
  }
};
