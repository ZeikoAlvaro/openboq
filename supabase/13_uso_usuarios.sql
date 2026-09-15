-- =========================================================================
-- OpenBOQ — USO REAL POR USUARIO (para el panel de administración)
-- -------------------------------------------------------------------------
-- Desde la v2.5 los proyectos viven en el Google Drive de cada usuario y el
-- servidor no tiene —ni debe tener— llave para entrar ahí. El panel veía
-- «0 proyectos» de quien tenía dos guardados.
--
-- La aplicación, cada vez que lista la carpeta de Drive del usuario, manda
-- un RESUMEN: cuántos proyectos, cuánto pesan, cuántos ítems suman y cuándo
-- se guardó el último. Nunca un nombre de archivo ni un dato del proyecto.
-- Además el perfil de uso: si ya usó PRESCOM y qué interfaz eligió.
--
-- Cada usuario escribe SOLO su fila (auth.uid() dentro de la función) y no
-- puede leer la tabla: la lee el panel, por obq_admin_usuarios.
--
-- Correr: node herramientas/aplicar_sql.js --archivo=supabase/13_uso_usuarios.sql
-- Idempotente.
-- =========================================================================

create table if not exists uso_usuarios (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  drive_proyectos   int,
  drive_bytes       bigint,
  drive_items       int,
  drive_bibliotecas int,
  drive_apus        int,
  drive_ultimo      timestamptz,     -- último guardado de un archivo en su Drive
  drive_visto       timestamptz,     -- cuándo la aplicación miró la carpeta
  perfil            jsonb not null default '{}',
  app_version       text,
  ultima_actividad  timestamptz,
  actualizado_en    timestamptz not null default now()
);

alter table uso_usuarios enable row level security;
revoke all on uso_usuarios from anon, authenticated;

-- p: { drive: {proyectos, bytes, items, bibliotecas, apus, ultimo},
--      perfil: {usa_prescom: bool, modo: 'simple'|'completo'},
--      version: '2.6' }
-- Lo que no viene, no se toca. Todo se recorta a tipos y rangos sanos: la
-- llama cualquiera con sesión, así que no se confía en nada.
create or replace function obq_uso_reportar(p jsonb)
returns void language plpgsql volatile security definer
set search_path = public, extensions, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  d     jsonb := case when jsonb_typeof(p -> 'drive') = 'object' then p -> 'drive' end;
  pf    jsonb := '{}';
  num   text := '^[0-9]{1,12}$';
begin
  if v_uid is null or jsonb_typeof(p) <> 'object' then return; end if;

  if jsonb_typeof(p -> 'perfil') = 'object' then
    if jsonb_typeof(p #> '{perfil,usa_prescom}') = 'boolean' then
      pf := pf || jsonb_build_object('usa_prescom', p #> '{perfil,usa_prescom}');
    end if;
    if p #>> '{perfil,modo}' in ('simple', 'completo') then
      pf := pf || jsonb_build_object('modo', p #>> '{perfil,modo}');
    end if;
    if pf <> '{}' then pf := pf || jsonb_build_object('fecha', to_char(now(), 'YYYY-MM-DD')); end if;
  end if;

  insert into uso_usuarios as u (user_id, drive_proyectos, drive_bytes, drive_items, drive_bibliotecas, drive_apus,
                                 drive_ultimo, drive_visto, perfil, app_version, ultima_actividad, actualizado_en)
  values (v_uid,
          case when d ->> 'proyectos' ~ num then least((d ->> 'proyectos')::bigint, 100000)::int end,
          case when d ->> 'bytes' ~ num then (d ->> 'bytes')::bigint end,
          case when d ->> 'items' ~ num then least((d ->> 'items')::bigint, 10000000)::int end,
          case when d ->> 'bibliotecas' ~ num then least((d ->> 'bibliotecas')::bigint, 1000)::int end,
          case when d ->> 'apus' ~ num then least((d ->> 'apus')::bigint, 10000000)::int end,
          case when d ->> 'ultimo' ~ '^\d{4}-\d{2}-\d{2}T' then least((d ->> 'ultimo')::timestamptz, now()) end,
          case when d is not null then now() end,
          pf,
          left(p ->> 'version', 20),
          now(), now())
  on conflict (user_id) do update set
    drive_proyectos   = case when d is not null then excluded.drive_proyectos else u.drive_proyectos end,
    drive_bytes       = case when d is not null then excluded.drive_bytes else u.drive_bytes end,
    drive_items       = case when d is not null then excluded.drive_items else u.drive_items end,
    drive_bibliotecas = case when d is not null then excluded.drive_bibliotecas else u.drive_bibliotecas end,
    drive_apus        = case when d is not null then excluded.drive_apus else u.drive_apus end,
    drive_ultimo      = case when d is not null then excluded.drive_ultimo else u.drive_ultimo end,
    drive_visto       = coalesce(excluded.drive_visto, u.drive_visto),
    perfil            = u.perfil || excluded.perfil,
    app_version       = coalesce(excluded.app_version, u.app_version),
    ultima_actividad  = now(),
    actualizado_en    = now();
exception when others then
  -- un resumen de uso nunca le puede romper nada al usuario
  return;
end $$;

revoke all on function obq_uso_reportar(jsonb) from public, anon;
grant execute on function obq_uso_reportar(jsonb) to authenticated;
alter function obq_uso_reportar(jsonb) set statement_timeout = '5s';

-- El perfil de la cuenta con sesión (¿usó PRESCOM?, interfaz elegida). La
-- respuesta vive en el navegador; esto la recupera en otro equipo o después
-- de borrar la caché, para no volver a preguntarle a quien ya contestó.
-- Devuelve solo SU perfil, nada más de la fila.
create or replace function obq_uso_mi_perfil()
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp as $$
  select coalesce((select perfil from uso_usuarios where user_id = auth.uid()), '{}'::jsonb);
$$;

revoke all on function obq_uso_mi_perfil() from public, anon;
grant execute on function obq_uso_mi_perfil() to authenticated;
alter function obq_uso_mi_perfil() set statement_timeout = '5s';

notify pgrst, 'reload schema';

select 'uso_usuarios' as tabla, count(*) as filas from uso_usuarios;
