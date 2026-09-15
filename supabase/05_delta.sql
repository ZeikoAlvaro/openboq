-- =========================================================================
-- OpenBOQ — el catálogo se actualiza sin republicar la aplicación
-- -------------------------------------------------------------------------
-- Correr UNA VEZ en el SQL Editor. Es idempotente.
--
-- QUÉ RESUELVE. Hoy la aplicación trae el catálogo en `data/catalogo.js`, un
-- archivo que viaja con ella. Un precio corregido en Postgres no llega a
-- nadie hasta regenerar ese archivo y desplegar de nuevo. Con esto, la
-- aplicación sigue arrancando con su archivo —instantáneo, y funciona igual
-- si Supabase está caído— pero después pregunta «¿cambió algo desde la
-- versión que tengo?» y se trae SOLO eso.
--
-- POR QUÉ NO CONSULTAR TODO EN VIVO. Buscar en 7.974 análisis contra un
-- array en memoria es instantáneo; contra São Paulo son 150 ms por tecla.
-- Y si el proyecto de Supabase se pausa —el plan gratis lo hace a los 7 días
-- sin actividad—, en vivo la aplicación deja de funcionar; así, solo deja de
-- actualizarse. Ver docs/ARQUITECTURA.md.
--
-- LO QUE SE ABRE. Este archivo da lectura anónima a las cuatro tablas del
-- catálogo. Es información que YA es pública: viaja entera en
-- data/catalogo.js, que cualquiera baja del sitio. No se abre nada de
-- usuarios_bases, aportes ni reportes.
-- =========================================================================


-- =========================================================================
-- 1 · CUÁNDO CAMBIÓ CADA COSA
-- -------------------------------------------------------------------------
-- Sin esta marca no hay forma de preguntar «qué cambió»: habría que bajar
-- el catálogo entero cada vez, que es justo lo que se quiere evitar.
-- =========================================================================
alter table precios_insumo  add column if not exists actualizado_en timestamptz not null default now();
alter table insumos         add column if not exists actualizado_en timestamptz not null default now();
alter table apus            add column if not exists actualizado_en timestamptz not null default now();
alter table apu_componentes add column if not exists actualizado_en timestamptz not null default now();

create or replace function obq_marcar_cambio() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['precios_insumo', 'insumos', 'apus', 'apu_componentes'] loop
    execute format('drop trigger if exists marcar_cambio on %I', t);
    execute format(
      'create trigger marcar_cambio before insert or update on %I
       for each row execute function obq_marcar_cambio()', t);
  end loop;
end
$$;

create index if not exists precios_insumo_cambio  on precios_insumo  (actualizado_en);
create index if not exists apu_componentes_cambio on apu_componentes (actualizado_en);

-- -------------------------------------------------------------------------
-- QUITAR una corrección también es un cambio. Al borrar la fila de curaduría
-- el precio vigente vuelve al de origen, pero el DELETE no deja rastro en
-- ninguna fila: sin esto, la aplicación se queda con la corrección deshecha
-- para siempre. Se toca la fila de origen, que es la que pasa a mandar.
-- -------------------------------------------------------------------------
create or replace function obq_marcar_baja() returns trigger
language plpgsql as $$
begin
  if old.procedencia = 'curaduria' then
    update precios_insumo
       set actualizado_en = now()
     where insumo_id = old.insumo_id
       and base_id = old.base_id
       and procedencia = 'base origen';
  end if;
  return old;
end;
$$;

drop trigger if exists marcar_baja on precios_insumo;
create trigger marcar_baja
  after delete on precios_insumo
  for each row execute function obq_marcar_baja();


-- =========================================================================
-- 2 · QUÉ VE LA APLICACIÓN
-- -------------------------------------------------------------------------
-- Una sola vista con el precio vigente de cada insumo en cada base, ya
-- resuelto —la curaduría gana sobre el precio de origen, igual que al
-- generar el catálogo— y con la fecha del cambio más reciente de los dos.
-- La aplicación pide de acá lo posterior a la fecha que tenga guardada.
-- =========================================================================
create or replace view v_catalogo_precios as
select b.id                                   as base_id,
       b.nombre                               as base,
       i.id                                   as insumo_id,
       i.tipo,
       i.descripcion,
       i.unidad,
       coalesce(cur.precio, org.precio)       as precio,
       (cur.precio is not null)               as curado,
       greatest(org.actualizado_en,
                coalesce(cur.actualizado_en, org.actualizado_en)) as actualizado_en
  from bases b
  join precios_insumo org on org.base_id = b.id and org.procedencia = 'base origen'
  join insumos i on i.id = org.insumo_id
  left join lateral (
    select p.precio, p.actualizado_en
      from precios_insumo p
     where p.insumo_id = org.insumo_id and p.base_id = b.id and p.procedencia = 'curaduria'
     limit 1
  ) cur on true;

comment on view v_catalogo_precios is
  'Precio vigente por (base, insumo), con la curaduría ya aplicada. La aplicación pide de acá lo posterior a su última sincronización.';


-- =========================================================================
-- 3 · CUÁNTO HAY PARA TRAER
-- -------------------------------------------------------------------------
-- La aplicación llama primero a esto, con la fecha que tiene guardada. Si
-- devuelve 0, no pide nada más: una consulta de una fila y listo.
--
-- OJO CON LA FECHA: la aplicación NUNCA manda su propio reloj. Guarda el
-- `ultima` que devolvió esta función y lo manda de vuelta tal cual. El reloj
-- del equipo puede estar corrido, y sobre todo el navegador manda la hora
-- con su huso: una marca local leída como UTC se va cuatro horas atrás y el
-- servidor contesta que cambió el catálogo entero. Pasó al probar esto.
-- =========================================================================
create or replace function obq_hay_cambios(desde timestamptz)
returns table (cambios bigint, ultima timestamptz)
language sql stable
as $$
  select count(*)::bigint, max(actualizado_en)
    from v_catalogo_precios
   where actualizado_en > coalesce(desde, '-infinity'::timestamptz);
$$;


-- =========================================================================
-- 4 · PERMISO DE LECTURA
-- -------------------------------------------------------------------------
-- Las tablas del catálogo tienen RLS prendido desde el principio y SIN
-- políticas, así que hasta ahora la clave pública no leía nada. Se abre
-- solo lectura, y solo de lo que ya viaja en data/catalogo.js.
-- Escribir sigue siendo exclusivo de la clave de servicio.
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array['bases', 'insumos', 'precios_insumo', 'apu_componentes', 'apus'] loop
    execute format('drop policy if exists lectura_publica on %I', t);
    execute format('create policy lectura_publica on %I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;

grant select on bases, insumos, precios_insumo, apus, apu_componentes to anon, authenticated;
grant select on v_catalogo_precios to anon, authenticated;
grant execute on function obq_hay_cambios(timestamptz) to anon, authenticated;


-- =========================================================================
-- 5 · PROBAR QUE QUEDÓ
-- =========================================================================
select 'precios en la vista' as que, count(*)::text as dato from v_catalogo_precios
union all
select 'cambios desde ayer', (select cambios::text from obq_hay_cambios(now() - interval '1 day'))
union all
select 'último cambio', (select coalesce(ultima::text, '—') from obq_hay_cambios(null));
