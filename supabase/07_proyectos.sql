-- =========================================================================
-- OpenBOQ — hasta tres proyectos guardados en la cuenta
-- -------------------------------------------------------------------------
-- Correr UNA VEZ en el SQL Editor, DESPUÉS de 03_cuentas.sql. Es idempotente.
--
-- QUÉ RESUELVE. Hoy el proyecto vive en el navegador y en el `.boq` que el
-- usuario guarda. Cambia de equipo, formatea o se le borra el navegador y
-- pierde todo. Con esto puede dejar hasta TRES proyectos en su cuenta y
-- abrirlos desde cualquier lado.
--
-- POR QUÉ DIEZ Y NO LOS QUE QUIERA. El plan gratis de Supabase da 500 MB.
-- Un proyecto guardado pesa, medido sobre filas reales, entre 15 y 115 KB ya
-- comprimido —el jsonb comprime 3 a 1—, con un tope duro de 3 MB de JSON más
-- abajo. Diez por cuenta son ~1,1 MB por usuario en el caso peor realista:
-- con los 419 MB libres del 09-09-2026 entran unos 380 usuarios que llenen
-- los diez casilleros, o unos 2.300 con uno solo. Sin tope, un solo usuario
-- llena la base de todos.
--   2026-09-09: el tope pasó de 3 a 10 (ver `09_tope_proyectos.sql`, que es
--   el que corrige la restricción en una base ya creada — este archivo solo
--   define el estado inicial y `create table if not exists` no la toca).
-- El tope NO es un contador: es `unique (user_id, slot)` con `slot` entre 1
-- y 10. No hay forma de guardar un onceavo, ni con la API cruda.
--
-- QUÉ VE QUIEN ADMINISTRA LA BASE. En columnas, nada más que esto:
--
--     user_id · slot · «Proyecto 1» · cuántos ítems · cuántos bytes · fecha
--
-- La etiqueta la escribe el SERVIDOR, no la aplicación: aunque alguien mande
-- el nombre real en ese campo, el disparador lo reemplaza por «Proyecto N».
--
-- Y QUÉ HAY ADENTRO DEL PAYLOAD. El proyecto entero, en claro, protegido por
-- RLS: solo su dueño lo lee, ni siquiera otro usuario con sesión. Quien
-- administra la base tiene, técnicamente, cómo abrir ese JSON. Está dicho
-- así en la aplicación, sin vueltas, junto con el compromiso de que esos
-- datos no se usan para otra cosa que mejorar el programa.
--
-- Quien no quiera confiar en eso tiene el CANDADO: una frase suya cifra
-- —AES-256-GCM, en su navegador— el nombre del proyecto, la entidad, la
-- ubicación y los cómputos métricos antes de subir. Esos cuatro campos
-- llegan acá como texto ilegible y sin la frase no los abre nadie, tampoco
-- yo. Es opcional y viene apagado. La columna `protegido` solo dice si está
-- puesto, para que la aplicación sepa que tiene que pedir la frase.
-- =========================================================================


-- =========================================================================
-- 1 · LA TABLA
-- =========================================================================
create table if not exists usuarios_proyectos (
  id             bigserial   primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  slot           int         not null check (slot between 1 and 10),
  etiqueta       text        not null default '',   -- la escribe el servidor
  payload        jsonb       not null,
  protegido      boolean     not null default false,
  n_items        int,
  bytes          int,
  app_version    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (user_id, slot)
);

create index if not exists usuarios_proyectos_dueno
  on usuarios_proyectos (user_id, slot);


-- =========================================================================
-- 2 · LO QUE DECIDE EL SERVIDOR Y NO EL CLIENTE
-- -------------------------------------------------------------------------
-- Tres cosas no se le creen a la aplicación, porque cualquiera puede llamar
-- a la API con la clave pública y su token:
--
--   la etiqueta   se reescribe siempre como «Proyecto N». Es la única
--                 columna legible desde el panel y no debe poder traer el
--                 nombre de la obra ni de la entidad.
--   el tamaño     se mide acá. Un `bytes` mandado por el cliente no sirve
--                 para nada.
--   la fecha      reloj del servidor. El del equipo puede estar corrido.
--
-- Y un tope duro de tamaño: 3 MB de JSON. Un proyecto de 64 ítems con los
-- archivos de PRESCOM adentro no llega a 500 KB; 3 MB es holgado y a la vez
-- frena que alguien use la cuenta como disco.
-- =========================================================================
create or replace function obq_proyecto_normalizar() returns trigger
language plpgsql as $$
declare v_bytes int;
begin
  v_bytes := octet_length(new.payload::text);
  if v_bytes > 3 * 1024 * 1024 then
    raise exception 'OpenBOQ: el proyecto pesa % KB y el máximo es 3072 KB', (v_bytes / 1024)
      using hint = 'Guarde este proyecto en un archivo .boq desde ARCHIVO → Guardar.';
  end if;
  new.etiqueta       := 'Proyecto ' || new.slot;
  new.bytes          := v_bytes;
  new.actualizado_en := now();
  if tg_op = 'UPDATE' then new.creado_en := old.creado_en; end if;
  return new;
end;
$$;

drop trigger if exists trg_proyecto_normalizar on usuarios_proyectos;
create trigger trg_proyecto_normalizar
  before insert or update on usuarios_proyectos
  for each row execute function obq_proyecto_normalizar();


-- =========================================================================
-- 3 · SOLO EL DUEÑO
-- -------------------------------------------------------------------------
-- Las mismas cuatro políticas de usuarios_bases. Sin la de SELECT, ni el
-- propio dueño puede leer lo que guardó.
--
-- `anon` no aparece en ninguna: sin sesión no hay proyectos que valgan.
-- =========================================================================
alter table usuarios_proyectos enable row level security;

drop policy if exists up_lee    on usuarios_proyectos;
drop policy if exists up_crea   on usuarios_proyectos;
drop policy if exists up_actual on usuarios_proyectos;
drop policy if exists up_borra  on usuarios_proyectos;

create policy up_lee    on usuarios_proyectos for select to authenticated
                                              using (auth.uid() = user_id);
create policy up_crea   on usuarios_proyectos for insert to authenticated
                                              with check (auth.uid() = user_id);
create policy up_actual on usuarios_proyectos for update to authenticated
                                              using (auth.uid() = user_id)
                                              with check (auth.uid() = user_id);
create policy up_borra  on usuarios_proyectos for delete to authenticated
                                              using (auth.uid() = user_id);

revoke all on usuarios_proyectos from anon;
grant select, insert, update, delete on usuarios_proyectos to authenticated;
grant usage, select on sequence usuarios_proyectos_id_seq to authenticated;


-- =========================================================================
-- 4 · QUÉ MIRAR DESDE EL PANEL
-- -------------------------------------------------------------------------
-- Cuánto se está usando, sin abrir un solo proyecto. La vista nace con
-- `security_invoker` —ver 06_seguridad_vistas.sql— y sin permiso para la
-- clave pública.
-- =========================================================================
create or replace view v_proyectos_uso
with (security_invoker = on) as
select count(*)                        as proyectos,
       count(distinct user_id)         as usuarios,
       count(*) filter (where protegido) as con_candado,
       round(sum(bytes) / 1024.0, 1)   as kb_total,
       round(avg(bytes) / 1024.0, 1)   as kb_promedio,
       max(actualizado_en)             as ultima_actividad
  from usuarios_proyectos;

revoke all on v_proyectos_uso from anon, authenticated;


-- =========================================================================
-- 5 · PROBAR QUE QUEDÓ
-- =========================================================================
select 'proyectos guardados' as que, count(*)::text as dato from usuarios_proyectos
union all
select 'políticas RLS', count(*)::text from pg_policies
 where schemaname = 'public' and tablename = 'usuarios_proyectos'
union all
select 'lo ve anon', has_table_privilege('anon', 'usuarios_proyectos', 'select')::text;
