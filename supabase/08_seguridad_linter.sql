-- =========================================================================
-- OpenBOQ — cerrar los hallazgos del linter de seguridad de Supabase
-- -------------------------------------------------------------------------
-- Correr UNA VEZ. Es idempotente: se puede volver a correr sin daño.
--   node herramientas/aplicar_sql.js --archivo=supabase/08_seguridad_linter.sql
--
-- QUÉ CIERRA
--
--   4 ERROR  rls_disabled_in_public        tablas de trabajo sin RLS
--   10 WARN  function_search_path_mutable  funciones sin search_path fijo
--   1  WARN  extension_in_public           pg_trgm vive en `public`
--
-- QUÉ NO CIERRA (no se puede desde SQL)
--
--   1  WARN  auth_leaked_password_protection
--            Es un interruptor del panel: Authentication → Providers → Email
--            → «Prevent use of leaked passwords». Hay que activarlo a mano.
--
-- POR QUÉ IMPORTA CADA UNO
--
--   RLS. En Supabase todo lo que se crea en `public` queda alcanzable con la
--   clave pública `anon`, que viaja adentro de la aplicación y la tiene
--   cualquiera. Las cuatro tablas son de trabajo interno —los respaldos del
--   día de la consolidación y el registro de reescalado— y contienen la base
--   de precios entera. Sin RLS, un `select` con la clave pública se las lleva.
--
--   search_path. Una función sin `search_path` fijo resuelve los nombres con
--   el camino de QUIEN la llama. Si alguien crea un `public.upper` propio en
--   un esquema que va antes, la función pasa a ejecutar código ajeno. En las
--   funciones de disparador (los frenos, la marca de cambio) eso es escritura
--   con los permisos del dueño.
--
--   pg_trgm en public. Ocupa nombres genéricos (`similarity`, `word_similarity`,
--   los operadores `%` y `<->`) en el mismo esquema donde viven los datos.
--   Se lo manda a `extensions`, que es donde Supabase espera las extensiones.
--
-- LO QUE NO CAMBIA. Los scripts de mantenimiento entran como `postgres`, que
-- es dueño de las tablas: el RLS no se le aplica. `npm run consolidar:auditar`
-- y `consolidar:reproducir` siguen funcionando igual.
-- =========================================================================


-- =========================================================================
-- 1 · RLS EN LAS TABLAS DE TRABAJO
-- -------------------------------------------------------------------------
-- Se activa RLS y NO se crea ninguna política: sin política, RLS niega todo.
-- Es lo correcto acá — estas tablas no son para nadie más que el dueño.
--
-- El `revoke` va además del RLS y no en su lugar: son dos capas distintas.
-- Sin el revoke, `anon` puede consultar la tabla (RLS le devuelve cero filas)
-- pero igual conoce que existe y con qué columnas.
--
-- `respaldo_20260815_*` guardan el estado ANTERIOR a la consolidación y las
-- usa consolidacion/08_reproducir.js. NO BORRARLAS.
-- =========================================================================
-- Se recorre por PATRÓN y no por lista: cada corrida de
-- `consolidacion/06_aplicar.js` crea un juego nuevo de `respaldo_<fecha>_*`.
-- Con una lista fija, la corrida siguiente vuelve a encender el hallazgo.
do $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'
       and (c.relname like 'respaldo\_%' or c.relname like 'consolidacion\_%')
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('revoke all on public.%I from anon, authenticated', t.relname);
    n := n + 1;
  end loop;
  raise notice 'RLS activado y permisos quitados en % tabla(s) de trabajo', n;
end
$$;


-- =========================================================================
-- 2 · SEARCH_PATH FIJO EN LAS FUNCIONES DEL PROYECTO
-- -------------------------------------------------------------------------
-- Se recorre pg_proc en vez de escribir las firmas una por una: así entran
-- solas las sobrecargas (obq_curar tiene varias) y no hay que tocar este
-- archivo cada vez que cambie un argumento.
--
-- El camino incluye `extensions` porque el paso 3 manda pg_trgm ahí: si
-- alguna función llega a usar similarity(), tiene que seguir encontrándola.
-- `pg_temp` va al final, nunca antes, para que nadie pueda anteponer un
-- objeto temporal con el nombre de uno real.
-- =========================================================================
do $$
declare
  f record;
  n int := 0;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in (
             'obq_norm', 'insumos_normalizar', 'apus_normalizar',
             'obq_marcar_baja', 'obq_marcar_cambio', 'obq_hay_cambios',
             'obq_curar', 'obq_descurar', 'obq_freno_masivo',
             'obq_proyecto_normalizar')
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp',
                   f.firma);
    n := n + 1;
  end loop;
  raise notice 'search_path fijado en % función(es)', n;
end
$$;


-- =========================================================================
-- 3 · pg_trgm SALE DE `public`
-- -------------------------------------------------------------------------
-- Los índices `insumos_norm_trgm` y `apus_norm_trgm` (gin_trgm_ops) y la
-- vista `v_posibles_duplicados` (similarity) NO se rompen: Postgres guarda
-- esas referencias por identificador interno, no por nombre.
--
-- Lo que sí cambia es el SQL escrito a mano después de esto: `similarity(...)`
-- suelto sólo resuelve si `extensions` está en el camino. Por eso el paso 4.
-- =========================================================================
do $$
begin
  if exists (
        select 1
          from pg_extension e
          join pg_namespace n on n.oid = e.extnamespace
         where e.extname = 'pg_trgm' and n.nspname = 'public') then
    create schema if not exists extensions;
    alter extension pg_trgm set schema extensions;
    raise notice 'pg_trgm movido de public a extensions';
  else
    raise notice 'pg_trgm ya estaba fuera de public';
  end if;
end
$$;

grant usage on schema extensions to postgres, anon, authenticated, service_role;


-- =========================================================================
-- 4 · QUE EL SQL A MANO SIGA ENCONTRANDO similarity()
-- -------------------------------------------------------------------------
-- El SQL Editor entra como `postgres`. Sin esto, después del paso 3 las
-- consultas de curaduría que usan `similarity()` o el operador `%` fallan con
-- «function similarity(text, text) does not exist», y el error no dice por qué.
-- =========================================================================
alter role postgres set search_path = "$user", public, extensions;


-- =========================================================================
-- 5 · PROBAR QUE QUEDÓ
-- -------------------------------------------------------------------------
-- La primera consulta: `rls` en true y `lo_ve_anon` en false, las cuatro.
-- La segunda: `camino` con valor en las diez funciones, ninguna en null.
-- La tercera: `extensions`.
-- =========================================================================
select c.relname                                    as tabla,
       c.relrowsecurity                             as rls,
       has_table_privilege('anon', c.oid, 'select') as lo_ve_anon
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and (c.relname like 'respaldo\_%' or c.relname like 'consolidacion\_%')
 order by c.relname;

select p.proname                                          as funcion,
       coalesce(array_to_string(p.proconfig, ', '), '(SIN FIJAR)') as camino
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.proname in ('obq_norm', 'insumos_normalizar', 'apus_normalizar',
                     'obq_marcar_baja', 'obq_marcar_cambio', 'obq_hay_cambios',
                     'obq_curar', 'obq_descurar', 'obq_freno_masivo',
                     'obq_proyecto_normalizar')
 order by p.proname;

select n.nspname as esquema_de_pg_trgm
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
 where e.extname = 'pg_trgm';
