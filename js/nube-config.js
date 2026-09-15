/* =========================================================================
   OpenBOQ — datos del servidor
   -------------------------------------------------------------------------
   Los dos valores son PUBLICOS a proposito y viajan con la aplicacion.

   La clave `anon` no es un secreto: sola no sirve, porque las politicas RLS
   de Postgres deciden que puede hacer. Con ella se puede insertar un aporte
   o un reporte, y leer y escribir la biblioteca propia cuando hay sesion.
   Nada mas: no lee aportes de otros ni toca el catalogo.

   La que si es secreta es la `service_role`, que saltea el RLS y vive solo
   en supabase/.env.local, fuera del repositorio.

   OJO al copiarla del panel: Supabase la muestra con un prefijo
   `sb_publishable_` pegado adelante del JWT. El servidor acepta SOLO el
   JWT — el que empieza en `eyJ`. Con el prefijo devuelve "Invalid API key".
   ========================================================================= */
"use strict";

const NUBE_CFG = {
  /* La direccion oficial del sitio. Tiene que coincidir con el Site URL del
     panel de Supabase, y existe para atajar un error que costo una sesion:
     cada despliegue de Cloudflare Pages genera ADEMAS una direccion propia
     —`a14b47b1.openboq.pages.dev`— que sirve la aplicacion igual de bien.
     Pero Supabase no la tiene autorizada, asi que al entrar manda la sesion
     al Site URL y la ventana desde donde se lanzo el login queda como
     invitada, sin ningun mensaje. Con esto la aplicacion lo detecta y avisa.
     Vacio = no se comprueba nada. */
  sitio: "https://openboq.pages.dev",
  url:  "https://ejqcdkyyqekmoorrrady.supabase.co",
  anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqcWNka3l5cWVrbW9vcnJyYWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NTc3NDgsImV4cCI6MjEwMTEzMzc0OH0.Mrw6Sl4sNdDg08OZYF39PeG7vplsHmW3oSs7PiC2CAY"
};

/* =========================================================================
   Drive del usuario — respaldo de sus proyectos y sus bases propias.

   El `client_id` de OAuth tambien es PUBLICO: Google lo pensa asi para las
   aplicaciones que corren en el navegador. Lo que protege la cuenta no es
   que este oculto —viaja en la URL de autorizacion, a la vista— sino la
   lista de direcciones de retorno autorizadas: un token solo puede
   aterrizar en un origen que este registrado en la consola de Google.

   El `client_secret` que la consola muestra al lado NO va aca ni en ningun
   archivo del repositorio: este flujo no lo usa.

   Vacio = la aplicacion sigue andando igual, sin la opcion de Drive.
   ========================================================================= */
/* OJO: es el MISMO cliente que Supabase usa para el login con Google. A
   proposito —una sola identidad, un solo nombre en la pantalla de permiso—,
   pero hay que saberlo: tocar esa credencial en la consola rompe el login
   ademas de Drive. Sus URI de retorno son tres cosas distintas y las tres
   tienen que estar: el callback de Supabase (`/auth/v1/callback`), y el
   `/drive.html` de cada origen desde donde se use OpenBOQ. */
const DRIVE_CFG = {
  client_id: "621939092202-uco66nj1sdlbhgjo95ebscpkt8ad7ccc.apps.googleusercontent.com"
};
