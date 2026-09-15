-- =========================================================================
-- OpenBOQ — herramientas de curaduría para el SQL Editor
-- -------------------------------------------------------------------------
-- Correr este archivo UNA VEZ. Deja instalado:
--
--   v_por_curar        qué falta arreglar, ordenado por cuánto pesa
--   v_mis_curadurias   qué se corrigió hasta ahora
--   obq_curar(...)     corregir un precio, sin escribir UPDATE a mano
--   obq_descurar(...)  deshacer una corrección
--   seguro contra el UPDATE masivo en precios_insumo
--
-- POR QUÉ EXISTE: el 2026-08-02 un UPDATE sin WHERE dejó los 9.808 precios
-- en 20,00. Corregir con `obq_curar` en vez de editar la tabla evita repetir
-- eso: la función toca UNA fila, la que corresponde, y deja anotado el
-- precio original y el motivo.
-- =========================================================================


-- =========================================================================
-- 1 · QUÉ FALTA CURAR
-- -------------------------------------------------------------------------
-- Un insumo en cero hace que el análisis cueste de menos sin avisar. La
-- columna `apus` dice a cuántos análisis les cambia el costo arreglarlo:
-- conviene empezar por arriba.
-- =========================================================================
create or replace view v_por_curar as
select b.nombre                                  as base,
       case i.tipo when 'M' then 'material'
                   when 'O' then 'mano de obra'
                   else 'equipo' end             as tipo,
       i.descripcion,
       i.unidad,
       (select count(*) from apu_componentes c
         join apus a on a.id = c.apu_id
        where c.insumo_id = i.id and a.base_id = b.id) as apus,
       ref.n_bases,
       ref.minimo,
       ref.mediana,
       ref.maximo
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  join bases   b on b.id = p.base_id
  left join lateral (
    select count(distinct o.base_id)                                  as n_bases,
           min(o.precio)                                              as minimo,
           percentile_cont(0.5) within group (order by o.precio)      as mediana,
           max(o.precio)                                              as maximo
      from precios_insumo o
     where o.insumo_id = i.id and o.precio > 0
  ) ref on true
 where p.procedencia = 'base origen'
   and p.precio = 0
   and not exists (select 1 from precios_insumo q
                    where q.insumo_id = p.insumo_id and q.base_id = p.base_id
                      and q.procedencia = 'curaduria')
 order by apus desc, i.descripcion;


-- =========================================================================
-- 2 · QUÉ SE CORRIGIÓ HASTA AHORA
-- =========================================================================
create or replace view v_mis_curadurias as
select p.id,
       b.nombre as base,
       i.descripcion,
       i.unidad,
       p.precio as precio_curado,
       (select o.precio from precios_insumo o
         where o.insumo_id = p.insumo_id and o.base_id = p.base_id
           and o.procedencia = 'base origen' limit 1) as precio_original,
       p.nota,
       p.fecha
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  left join bases b on b.id = p.base_id
 where p.procedencia = 'curaduria'
 order by b.nombre, i.descripcion;


-- =========================================================================
-- 3 · CORREGIR UN PRECIO
-- -------------------------------------------------------------------------
-- No pisa el precio original: la corrección entra como una fila aparte con
-- procedencia 'curaduria', y al generar el catálogo esa gana. Volver a
-- llamarla con otro precio reemplaza la corrección anterior.
--
--   select obq_curar('Ex Fondo de Inversión Social', 'Caja de derivacion-pvc',
--                    'pza', 45.00, 'precio de plaza, agosto 2026');
--
-- La descripción no necesita ser exacta en acentos ni mayúsculas: se compara
-- normalizada, igual que en el resto del proyecto.
-- =========================================================================
create or replace function obq_curar(
  p_base   text,
  p_desc   text,
  p_unidad text,
  p_precio numeric,
  p_nota   text default null
) returns text
language plpgsql
as $$
declare
  v_insumo   bigint;
  v_base     bigint;
  v_original numeric;
  v_cuantos  int;
  v_apus     int;
begin
  select id into v_base from bases where nombre = p_base;
  if v_base is null then
    return '✖ no existe la base «' || p_base || '». Ver: select nombre from bases;';
  end if;

  select i.id, count(*) over () into v_insumo, v_cuantos
    from insumos i
    join precios_insumo p on p.insumo_id = i.id and p.base_id = v_base
   where i.descripcion_norm = obq_norm(p_desc)
     and i.unidad = btrim(p_unidad)
   limit 1;

  if v_insumo is null then
    return '✖ no encontré «' || p_desc || '» (' || p_unidad || ') en ' || p_base ||
           '. Buscar con: select * from v_por_curar where descripcion ilike ''%…%'';';
  end if;

  select p.precio into v_original
    from precios_insumo p
   where p.insumo_id = v_insumo and p.base_id = v_base and p.procedencia = 'base origen'
   limit 1;

  select count(*) into v_apus
    from apu_componentes c join apus a on a.id = c.apu_id
   where c.insumo_id = v_insumo and a.base_id = v_base;

  delete from precios_insumo
   where insumo_id = v_insumo and base_id = v_base and procedencia = 'curaduria';

  insert into precios_insumo (insumo_id, precio, procedencia, base_id, nota)
  values (v_insumo, p_precio, 'curaduria', v_base,
          '[origen ' || coalesce(v_original::text, '?') || '] ' ||
          coalesce(p_nota, 'corregido en curaduría'));

  return '✔ ' || p_desc || ' (' || p_unidad || ') en ' || p_base ||
         ': ' || coalesce(v_original::text, '?') || ' → ' || p_precio ||
         '   · toca ' || v_apus || ' análisis';
end;
$$;


-- =========================================================================
-- 4 · DESHACER UNA CORRECCIÓN
--   select obq_descurar('Ex Fondo de Inversión Social', 'Asfalto', 'kg');
-- =========================================================================
create or replace function obq_descurar(
  p_base text, p_desc text, p_unidad text
) returns text
language plpgsql
as $$
declare v_n int;
begin
  delete from precios_insumo p
   using insumos i, bases b
   where p.insumo_id = i.id and p.base_id = b.id
     and p.procedencia = 'curaduria'
     and b.nombre = p_base
     and i.descripcion_norm = obq_norm(p_desc)
     and i.unidad = btrim(p_unidad);
  get diagnostics v_n = row_count;
  return case when v_n > 0 then '✔ corrección quitada: vuelve el precio de origen'
              else '✖ no había corrección para eso' end;
end;
$$;


-- =========================================================================
-- 5 · EL SEGURO
-- -------------------------------------------------------------------------
-- Rechaza cualquier UPDATE o DELETE que toque más de 300 filas de
-- precios_insumo de una sola vez. Es exactamente lo que pasó el 02/08.
--
-- Cuando una operación masiva SÍ es lo que se quiere —restaurar un respaldo,
-- cargar una migración— se avisa antes, en la misma transacción:
--
--     begin;
--     set local openboq.masivo = 'on';
--     ...  la operación grande  ...
--     commit;
-- =========================================================================
create or replace function obq_freno_masivo() returns trigger
language plpgsql
as $$
declare v_n int;
begin
  if coalesce(current_setting('openboq.masivo', true), 'off') = 'on' then
    return null;
  end if;
  select count(*) into v_n from filas_tocadas;
  if v_n > 300 then
    raise exception
      'OpenBOQ: % filas de precios_insumo en una sola sentencia. Si es a propósito: begin; set local openboq.masivo = ''on''; … commit;', v_n
      using hint = 'Para corregir un precio usá select obq_curar(base, descripcion, unidad, precio, nota);';
  end if;
  return null;
end;
$$;

drop trigger if exists freno_update_masivo on precios_insumo;
create trigger freno_update_masivo
  after update on precios_insumo
  referencing new table as filas_tocadas
  for each statement execute function obq_freno_masivo();

drop trigger if exists freno_delete_masivo on precios_insumo;
create trigger freno_delete_masivo
  after delete on precios_insumo
  referencing old table as filas_tocadas
  for each statement execute function obq_freno_masivo();


-- =========================================================================
-- 6 · PROBAR QUE QUEDÓ INSTALADO
-- =========================================================================
select 'pendientes por curar' as que, count(*) as cuantos from v_por_curar
union all
select 'ya corregidos', count(*) from v_mis_curadurias;
