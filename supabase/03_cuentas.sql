-- =========================================================================
-- OpenBOQ — cuentas, respaldo privado, aportes y reportes
-- -------------------------------------------------------------------------
-- Tres cosas que NO se mezclan, cada una con su propia regla de acceso:
--
--   usuarios_bases   la biblioteca de análisis de cada usuario.
--                    IDENTIFICADA y PRIVADA: solo su dueño la ve, ni
--                    siquiera otro usuario logueado.
--
--   aportes          lo que alimenta la base común.
--                    ANÓNIMO: la tabla no tiene ni user_id ni correo, a
--                    propósito. Solo se puede insertar; nadie lee desde la
--                    aplicación. La curaduría entra por el panel.
--
--   reportes         errores y observaciones que manda la gente.
--                    IDENTIFICADO: acá el correo sirve, para poder
--                    responder y preguntar.
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Es idempotente.
-- =========================================================================


-- =========================================================================
-- 1 · RESPALDO PRIVADO DE LA BIBLIOTECA
-- -------------------------------------------------------------------------
-- Una fila por usuario con su `openboq_bd_propia` entero: las bases que
-- armó y los análisis que editó. Es lo que hoy vive solo en el navegador y
-- se pierde si formatea el equipo o cambia de máquina.
-- =========================================================================
create table if not exists usuarios_bases (
  id             bigserial primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  payload        jsonb       not null,
  n_bases        int,
  n_apus         int,
  app_version    text,
  actualizado_en timestamptz not null default now(),
  unique (user_id)
);

alter table usuarios_bases enable row level security;

-- Cuatro políticas y las cuatro dicen lo mismo: solo el dueño. Sin una
-- política de SELECT, ni el propio dueño puede leer lo que guardó.
drop policy if exists ub_lee    on usuarios_bases;
drop policy if exists ub_crea   on usuarios_bases;
drop policy if exists ub_actual on usuarios_bases;
drop policy if exists ub_borra  on usuarios_bases;

create policy ub_lee    on usuarios_bases for select using (auth.uid() = user_id);
create policy ub_crea   on usuarios_bases for insert with check (auth.uid() = user_id);
create policy ub_actual on usuarios_bases for update using (auth.uid() = user_id)
                                              with check (auth.uid() = user_id);
create policy ub_borra  on usuarios_bases for delete using (auth.uid() = user_id);


-- =========================================================================
-- 2 · APORTES — anónimos de verdad
-- -------------------------------------------------------------------------
-- La versión anterior de esta tabla tenía usuario_email y usuario_id. Se
-- quitan: contradicen el diseño. Un aporte no debe poder atribuirse a
-- nadie, ni siquiera por quien administra la base.
--
-- Queda una huella menor que conviene tener presente: si alguien guarda su
-- biblioteca y en el mismo instante se manda el aporte, cruzar los
-- timestamps los une. Por eso la aplicación encola los aportes y los manda
-- desfasados, en la sesión siguiente y en lote.
-- =========================================================================
alter table aportes drop column if exists usuario_email;
alter table aportes drop column if exists usuario_id;

alter table aportes enable row level security;

drop policy if exists ap_inserta on aportes;

-- Solo INSERT, y para cualquiera. No hay política de SELECT ni de UPDATE:
-- desde la aplicación, con la clave pública, no se puede leer un aporte ni
-- modificarlo. Ni el propio.
create policy ap_inserta on aportes
  for insert to anon, authenticated
  with check (
    estado = 'pendiente'                    -- nadie se auto-aprueba
    and pg_column_size(payload) < 100000    -- freno a payloads absurdos
  );


-- =========================================================================
-- 3 · REPORTES — acá el correo sí sirve
-- -------------------------------------------------------------------------
-- Para poder volver a preguntar: «¿en qué pantalla pasó?», «¿lo podés
-- repetir?». Sin identidad, un reporte de error es casi inútil.
-- =========================================================================
create table if not exists reportes (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  email       text,
  mensaje     text not null check (length(btrim(mensaje)) > 0),
  version     text,
  contexto    jsonb,                        -- navegador, pestaña, tamaño de pantalla
  estado      text not null default 'nuevo'
              check (estado in ('nuevo', 'leido', 'resuelto', 'descartado')),
  respuesta   text,
  creado_en   timestamptz not null default now()
);

create index if not exists reportes_cola on reportes (estado, creado_en desc);

alter table reportes enable row level security;

drop policy if exists rep_inserta on reportes;
drop policy if exists rep_lee_propios on reportes;

create policy rep_inserta on reportes
  for insert to anon, authenticated
  with check (estado = 'nuevo' and length(mensaje) < 5000);

-- Cada quien puede ver los suyos, para saber si fueron respondidos.
create policy rep_lee_propios on reportes
  for select to authenticated
  using (auth.uid() = user_id);


-- =========================================================================
-- 4 · QUÉ MIRAR DESDE EL PANEL
-- =========================================================================

-- Aportes esperando curaduría, con el análisis ya legible.
create or replace view v_aportes_pendientes as
select a.id,
       a.payload->>'descripcion'                       as analisis,
       a.payload->>'unidad'                            as unidad,
       jsonb_array_length(coalesce(a.payload->'componentes', '[]'::jsonb)) as insumos,
       a.app_version,
       a.creado_en
  from aportes a
 where a.estado = 'pendiente'
 order by a.creado_en desc;

-- Reportes sin leer.
create or replace view v_reportes_nuevos as
select id, coalesce(email, '(anónimo)') as de, mensaje, version, creado_en
  from reportes
 where estado = 'nuevo'
 order by creado_en desc;

-- Cuánta gente usa la aplicación y cuánto guardó. Sin abrir el contenido.
create or replace view v_uso as
select count(*)                                          as usuarios,
       sum(n_bases)                                      as bases_guardadas,
       sum(n_apus)                                       as analisis_guardados,
       max(actualizado_en)                               as ultima_actividad
  from usuarios_bases;
