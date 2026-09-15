-- =========================================================================
-- OpenBOQ — las vistas dejan de correr con los permisos de quien las creó
-- -------------------------------------------------------------------------
-- Correr UNA VEZ en el SQL Editor. Es idempotente.
--
-- QUÉ AVISA EL LINTER DE SUPABASE (nueve hallazgos, todos en ERROR):
--
--     "Security Definer View — Detects views defined with the SECURITY
--      DEFINER property. These views enforce Postgres permissions and row
--      level security policies (RLS) of the view creator, rather than that
--      of the querying user."
--
-- POR QUÉ PASA. En Postgres una vista se ejecuta, por omisión, con los
-- permisos de SU DUEÑO. Acá el dueño es `postgres`, que es dueño de las
-- tablas y por lo tanto NO le aplica el RLS. Y en Supabase los roles `anon`
-- y `authenticated` reciben permisos por omisión sobre todo lo que se crea
-- en `public`. Las dos cosas juntas son el problema:
--
--     una vista sobre usuarios_bases, consultada con la clave pública,
--     devolvía datos que el RLS de la tabla jamás habría dejado salir.
--
-- El caso concreto y más grave era `v_uso`: lee `usuarios_bases`, que tiene
-- RLS «solo el dueño», y la vista lo saltaba.
--
-- QUÉ HACE ESTE ARCHIVO. Dos cosas, y hacen falta las dos:
--
--   1. `security_invoker = on` en las nueve vistas: pasan a ejecutarse con
--      los permisos y el RLS de QUIEN CONSULTA. Necesita PostgreSQL 15+.
--   2. Le quita a `anon` y `authenticated` el permiso sobre las ocho vistas
--      de curaduría y de panel. Esas vistas no son para la aplicación: se
--      miran desde el SQL Editor, que entra como `postgres`.
--
-- LA ÚNICA QUE SIGUE ABIERTA es `v_catalogo_precios`, que es de donde
-- `js/sync.js` se trae los precios que cambiaron. Con `security_invoker` esa
-- vista ahora obedece el RLS de las tablas del catálogo, que ya tienen su
-- política `lectura_publica` (ver 05_delta.sql). No se abre nada nuevo.
--
-- QUÉ NO CAMBIA: desde el SQL Editor se sigue viendo todo igual. `postgres`
-- es dueño de las tablas y el RLS no se le aplica.
-- =========================================================================


-- =========================================================================
-- 0 · REQUISITO
-- =========================================================================
do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'security_invoker necesita PostgreSQL 15 o superior. Este servidor es %',
      current_setting('server_version');
  end if;
end
$$;


-- =========================================================================
-- 1 · LAS NUEVE VISTAS PASAN A OBEDECER AL QUE CONSULTA
-- -------------------------------------------------------------------------
-- Se recorre una lista y se saltea la que no exista: los archivos 01 a 05
-- se pueden haber aplicado en distinto orden o de a partes.
-- =========================================================================
do $$
declare
  v text;
  n int := 0;
begin
  foreach v in array array[
      'v_precio_vigente', 'v_precios_dispares', 'v_posibles_duplicados',  -- 01_esquema
      'v_aportes_pendientes', 'v_reportes_nuevos', 'v_uso',               -- 03_cuentas
      'v_por_curar', 'v_mis_curadurias',                                  -- 04_curar
      'v_catalogo_precios'                                                -- 05_delta
    ] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v);
      n := n + 1;
    end if;
  end loop;
  raise notice 'security_invoker activado en % vista(s)', n;
end
$$;


-- =========================================================================
-- 2 · QUIÉN PUEDE MIRAR CADA UNA
-- -------------------------------------------------------------------------
-- Ocho vistas son de trabajo interno: curaduría, cola de aportes, reportes y
-- uso. Nada de eso tiene por qué ser alcanzable con la clave pública, que
-- viaja dentro de la aplicación y la tiene cualquiera.
--
-- El REVOKE es imprescindible aunque ya esté el security_invoker: sin él,
-- `anon` sigue pudiendo consultar la vista y —aunque el RLS ya no le
-- devuelva filas ajenas— se filtra la forma de la consulta y, en las vistas
-- que agregan (v_uso), podría deducirse actividad.
-- =========================================================================
do $$
declare v text;
begin
  foreach v in array array[
      'v_precio_vigente', 'v_precios_dispares', 'v_posibles_duplicados',
      'v_aportes_pendientes', 'v_reportes_nuevos', 'v_uso',
      'v_por_curar', 'v_mis_curadurias'
    ] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v);
    end if;
  end loop;
end
$$;

-- La que sí usa la aplicación. El grant se repite acá a propósito: si este
-- archivo se corre después de un `revoke all on all tables`, la
-- sincronización tiene que seguir funcionando.
grant select on public.v_catalogo_precios to anon, authenticated;

comment on view public.v_catalogo_precios is
  'Precio vigente por (base, insumo), con la curaduría ya aplicada. security_invoker: obedece el RLS de quien consulta. La aplicación pide de acá lo posterior a su última sincronización.';


-- =========================================================================
-- 3 · PROBAR QUE QUEDÓ
-- -------------------------------------------------------------------------
-- La primera consulta tiene que devolver `security_invoker=true` en las
-- nueve. La segunda, `false` en las ocho internas y `true` solo en
-- v_catalogo_precios.
-- =========================================================================
select c.relname                                    as vista,
       coalesce(array_to_string(c.reloptions, ', '), '(sin opciones)') as opciones,
       has_table_privilege('anon', c.oid, 'select') as lo_ve_anon
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'v'
 order by c.relname;
