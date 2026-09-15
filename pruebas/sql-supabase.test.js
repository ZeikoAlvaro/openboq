/* Las vistas y las tablas de Supabase, probadas en un Postgres LOCAL.

   Por qué existe: el linter de Supabase marcó nueve vistas en ERROR con
   «Security Definer View». Una vista, por omisión, corre con los permisos de
   su dueño —`postgres`, que es dueño de las tablas y por lo tanto no le
   aplica el RLS—, así que una vista sobre `usuarios_bases` devolvía filas
   que la tabla jamás habría dejado salir. Acá se reproduce esa fuga y se
   comprueba que `06_seguridad_vistas.sql` la cierra.

   También se prueban `07_proyectos.sql` y `09_tope_proyectos.sql`: el tope
   de diez proyectos, el de tamaño, la etiqueta que reescribe el servidor y
   que un usuario no vea el proyecto de otro.

   CÓMO CORRE: arma una base de pruebas descartable en el Postgres local
   (por omisión postgres@localhost:5432) con un remedo del esquema `auth` de
   Supabase, aplica los archivos de `supabase/` en orden y consulta. Si no
   hay Postgres local, la prueba SE SALTEA y no falla: el resto del proyecto
   no necesita uno.

       PGHOST · PGPORT · PGUSER · PGPASSWORD   para apuntar a otro servidor  */
'use strict';

const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

let Client;
try { ({ Client } = require('pg')); }
catch (e) {
  console.log('  · sin el módulo «pg» (npm install): prueba salteada');
  process.exit(0);
}

const BASE_PRUEBA = 'openboq_prueba_sql';
const conexion = extra => Object.assign({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || ''
}, extra);

const sql = f => fs.readFileSync(path.join(dir, 'supabase', f), 'utf8');

/* El remedo de Supabase: los roles anon/authenticated, el esquema auth y
   auth.uid() leyendo el reclamo del token, igual que en el servidor real. */
const REMEDO = `
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
-- Esto es lo que hace Supabase de fábrica y es media causa del problema: la
-- clave pública recibe permisos sobre TODO lo que se cree en el esquema
-- public, vista nueva incluida. Sin reproducirlo, la prueba no probaría nada.
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

const ROLES = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;`;

const USUARIO_A = '11111111-1111-1111-1111-111111111111';
const USUARIO_B = '22222222-2222-2222-2222-222222222222';

/** Corre algo con el rol y el usuario de una sesión de la aplicación. */
async function comoUsuario(c, uid, consulta, valores) {
  await c.query('begin');
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const r = await c.query(consulta, valores);
    await c.query('rollback');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
}

(async () => {
  /* ---------- ¿hay Postgres local? ---------- */
  const admin = new Client(conexion({ database: 'postgres' }));
  try { await admin.connect(); }
  catch (e) {
    console.log('  · sin Postgres local (' + e.message.split('\n')[0] + '): prueba salteada');
    process.exit(0);
  }

  console.log('== Base de pruebas ==');
  await admin.query(ROLES);
  await admin.query(`drop database if exists ${BASE_PRUEBA} with (force)`);
  await admin.query(`create database ${BASE_PRUEBA}`);
  await admin.end();
  ok(true, 'base ' + BASE_PRUEBA + ' creada');

  const c = new Client(conexion({ database: BASE_PRUEBA }));
  await c.connect();

  try {
    await c.query(REMEDO);
    await c.query(`insert into auth.users (id, email) values
      ('${USUARIO_A}', 'a@ejemplo.bo'), ('${USUARIO_B}', 'b@ejemplo.bo')`);

    console.log('== Los archivos de supabase/ se aplican en orden ==');
    for (const f of ['01_esquema.sql', '03_cuentas.sql', '04_curar.sql', '05_delta.sql']) {
      try { await c.query(sql(f)); ok(true, f); }
      catch (e) { ok(false, f + ' — ' + e.message); }
    }

    /* ------------------------------------------------------------------
       LA FUGA, ANTES DE ARREGLARLA
       Una vista como las que había: creada por el dueño de las tablas, sin
       security_invoker. Se le da permiso a `authenticated` y se consulta con
       la sesión del usuario A. Tiene que ver TAMBIÉN la fila de B, que es
       exactamente lo que el linter denuncia.
       ------------------------------------------------------------------ */
    console.log('== Una vista sin security_invoker saltea el RLS ==');
    await c.query(`insert into usuarios_bases (user_id, payload, n_bases, n_apus) values
      ('${USUARIO_A}', '{"bases":[]}'::jsonb, 1, 10),
      ('${USUARIO_B}', '{"bases":[]}'::jsonb, 2, 20)`);
    await c.query(`create or replace view v_prueba_fuga as select user_id, n_apus from usuarios_bases`);
    await c.query('grant select on v_prueba_fuga to authenticated');

    {
      const r = await comoUsuario(c, USUARIO_A, 'select * from v_prueba_fuga');
      ok(r.rows.length === 2,
        'sin invoker, el usuario A ve las ' + r.rows.length + ' filas (la suya y la ajena): la fuga existe');
      const d = await comoUsuario(c, USUARIO_A, 'select * from usuarios_bases');
      ok(d.rows.length === 1, 'la TABLA, en cambio, ya le devolvía solo la suya: ' + d.rows.length);
    }

    console.log('== 06_seguridad_vistas.sql ==');
    try { await c.query(sql('06_seguridad_vistas.sql')); ok(true, 'aplicado'); }
    catch (e) { ok(false, 'no aplicó — ' + e.message); }

    {
      await c.query(`alter view v_prueba_fuga set (security_invoker = on)`);
      const r = await comoUsuario(c, USUARIO_A, 'select * from v_prueba_fuga');
      ok(r.rows.length === 1 && r.rows[0].user_id === USUARIO_A,
        'con invoker, la misma vista le devuelve solo su fila: ' + r.rows.length);
    }

    console.log('== Las nueve vistas quedaron en security_invoker ==');
    const VISTAS = ['v_precio_vigente', 'v_precios_dispares', 'v_posibles_duplicados',
      'v_aportes_pendientes', 'v_reportes_nuevos', 'v_uso',
      'v_por_curar', 'v_mis_curadurias', 'v_catalogo_precios'];
    {
      const r = await c.query(`
        select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as op
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v' and c.relname = any($1)`, [VISTAS]);
      ok(r.rows.length === VISTAS.length, 'están las ' + VISTAS.length + ' vistas: ' + r.rows.length);
      const sin = r.rows.filter(x => !/security_invoker=(on|true)/i.test(x.op)).map(x => x.relname);
      ok(!sin.length, sin.length ? 'quedaron sin invoker: ' + sin.join(', ')
        : 'las nueve con security_invoker=true');
    }

    console.log('== La clave pública ya no llega a las vistas internas ==');
    {
      const internas = VISTAS.filter(v => v !== 'v_catalogo_precios');
      const r = await c.query(`select v, has_table_privilege('anon', v, 'select') as ve
                                 from unnest($1::text[]) v`, [internas]);
      const ven = r.rows.filter(x => x.ve).map(x => x.v);
      ok(!ven.length, ven.length ? 'anon todavía ve: ' + ven.join(', ')
        : 'anon no ve ninguna de las ocho vistas internas');
      const cat = await c.query(`select has_table_privilege('anon', 'v_catalogo_precios', 'select') as ve`);
      ok(cat.rows[0].ve === true, 'anon sí ve v_catalogo_precios — es la que usa js/sync.js');
    }

    console.log('== El catálogo se sigue pudiendo sincronizar como anon ==');
    {
      await c.query('begin');
      await c.query('set local role anon');
      const r = await c.query('select count(*)::int as n from v_catalogo_precios');
      const f = await c.query('select * from obq_hay_cambios(null)');
      await c.query('rollback');
      ok(Number.isInteger(r.rows[0].n), 'anon consulta v_catalogo_precios sin error');
      ok(!!f.rows.length, 'anon ejecuta obq_hay_cambios()');
    }

    /* ==================================================================
       07_proyectos.sql
       ================================================================== */
    console.log('== 07_proyectos.sql ==');
    try { await c.query(sql('07_proyectos.sql')); ok(true, 'aplicado'); }
    catch (e) { ok(false, 'no aplicó — ' + e.message); }

    const proyecto = n => JSON.stringify({
      app: 'OpenBOQ', v: 1, P: { nombre: n, modulos: [{ n: 'M1', items: [] }] }
    });

    console.log('== El servidor reescribe la etiqueta ==');
    {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: USUARIO_A, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      await c.query(`insert into usuarios_proyectos (user_id, slot, etiqueta, payload, n_items, bytes)
                     values ($1, 1, 'PUENTE VEHICULAR PARCO VENTILLA', $2::jsonb, 44, 7)`,
        [USUARIO_A, proyecto('PUENTE VEHICULAR PARCO VENTILLA')]);
      const r = await c.query('select etiqueta, bytes, n_items from usuarios_proyectos');
      await c.query('rollback');
      ok(r.rows[0].etiqueta === 'Proyecto 1',
        'la etiqueta llegó como «Proyecto 1» y no con el nombre de la obra: ' + r.rows[0].etiqueta);
      ok(r.rows[0].bytes > 20, 'el tamaño lo mide el servidor: ' + r.rows[0].bytes + ' bytes');
      ok(r.rows[0].n_items === 44, 'la cantidad de ítems sí se guarda como la manda la aplicación');
    }

    /* El tope pasó de 3 a 10 el 2026-09-09. `07_proyectos.sql` lo dice para
       una base nueva; en una base ya creada la restricción vieja la corrige
       `09_tope_proyectos.sql`, que se aplica acá abajo antes de probar. */
    console.log('== 09_tope_proyectos.sql ==');
    try { await c.query(sql('09_tope_proyectos.sql')); ok(true, 'aplicado'); }
    catch (e) { ok(false, 'no aplicó — ' + e.message); }

    console.log('== Diez y no once ==');
    {
      const filas = [];
      for (let s = 1; s <= 10; s++) filas.push(`('${USUARIO_A}', ${s}, '${proyecto('p' + s)}'::jsonb)`);
      await c.query(`insert into usuarios_proyectos (user_id, slot, payload) values ` + filas.join(','));
      let onceavo = null;
      try {
        await c.query(`insert into usuarios_proyectos (user_id, slot, payload)
                       values ('${USUARIO_A}', 11, '${proyecto('once')}'::jsonb)`);
      } catch (e) { onceavo = e.message; }
      ok(!!onceavo && /check|restric/i.test(onceavo), 'el slot 11 lo rechaza la base: ' + (onceavo || 'ENTRÓ'));

      const up = await c.query(`
        insert into usuarios_proyectos (user_id, slot, payload) values ('${USUARIO_A}', 2, $1::jsonb)
        on conflict (user_id, slot) do update set payload = excluded.payload
        returning slot, bytes`, [proyecto('dos, reemplazado')]);
      ok(up.rows[0].slot === 2, 'guardar de nuevo en el slot 2 reemplaza, no agrega');
      const n = await c.query(`select count(*)::int as n from usuarios_proyectos where user_id = '${USUARIO_A}'`);
      ok(n.rows[0].n === 10, 'el usuario A tiene diez proyectos, no once: ' + n.rows[0].n);
    }

    console.log('== Un proyecto absurdo no entra ==');
    {
      const gordo = JSON.stringify({ app: 'OpenBOQ', relleno: 'x'.repeat(4 * 1024 * 1024) });
      let e1 = null;
      try {
        await c.query(`insert into usuarios_proyectos (user_id, slot, payload)
                       values ('${USUARIO_B}', 1, $1::jsonb)`, [gordo]);
      } catch (e) { e1 = e.message; }
      ok(!!e1 && /3072 KB/.test(e1), 'los 4 MB se rechazan con el motivo escrito: ' + (e1 || 'ENTRÓ'));
    }

    console.log('== Cada quien ve lo suyo ==');
    {
      await c.query(`insert into usuarios_proyectos (user_id, slot, payload)
                     values ('${USUARIO_B}', 1, '${proyecto('de B')}'::jsonb)`);
      const a = await comoUsuario(c, USUARIO_A, 'select slot, payload from usuarios_proyectos');
      ok(a.rows.length === 10, 'el usuario A ve sus diez: ' + a.rows.length);
      const b = await comoUsuario(c, USUARIO_B, 'select slot, payload from usuarios_proyectos');
      ok(b.rows.length === 1 && b.rows[0].payload.P.nombre === 'de B',
        'el usuario B ve solo el suyo: ' + b.rows.length);

      let ajeno = null;
      try {
        await comoUsuario(c, USUARIO_B,
          `update usuarios_proyectos set payload = '${proyecto('robado')}'::jsonb
            where user_id = '${USUARIO_A}'`);
        const q = await comoUsuario(c, USUARIO_A,
          `select payload from usuarios_proyectos where slot = 1`);
        ajeno = q.rows[0].payload.P.nombre;
      } catch (e) { ajeno = 'RECHAZADO'; }
      ok(ajeno !== 'robado', 'B no puede reescribir el proyecto de A (quedó: ' + ajeno + ')');

      let sinSesion = null;
      try {
        await c.query('begin');
        await c.query('set local role anon');
        await c.query('select * from usuarios_proyectos');
        await c.query('rollback');
        sinSesion = 'LEYÓ';
      } catch (e) { await c.query('rollback'); sinSesion = e.message; }
      ok(/permission denied|permiso denegado/i.test(sinSesion),
        'sin sesión no hay proyectos: ' + sinSesion.split('\n')[0]);
    }

    console.log('== La vista del panel tampoco es pública ==');
    {
      const r = await c.query(`select
        has_table_privilege('anon', 'v_proyectos_uso', 'select') as anon,
        has_table_privilege('authenticated', 'v_proyectos_uso', 'select') as auth,
        (select coalesce(array_to_string(reloptions, ','), '') from pg_class
          where relname = 'v_proyectos_uso') as op`);
      ok(r.rows[0].anon === false && r.rows[0].auth === false,
        'v_proyectos_uso no la ve ni anon ni authenticated');
      ok(/security_invoker=(on|true)/i.test(r.rows[0].op), 'v_proyectos_uso nace con security_invoker');
      const u = await c.query('select * from v_proyectos_uso');
      ok(Number(u.rows[0].proyectos) === 11,
        'desde el panel se ve el uso, sin abrir ningún proyecto: ' +
        u.rows[0].proyectos + ' proyecto(s), ' + u.rows[0].kb_total + ' KB');
    }

  } catch (e) {
    errores.push('EXCEPCIÓN: ' + e.message);
    console.log('  ✗ EXCEPCIÓN', e);
  } finally {
    await c.end();
    const fin = new Client(conexion({ database: 'postgres' }));
    await fin.connect();
    await fin.query(`drop database if exists ${BASE_PRUEBA} with (force)`);
    await fin.end();
  }

  console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
  process.exit(errores.length ? 1 : 0);
})();
