-- =========================================================================
-- OpenBOQ — depuración de bases del catálogo (2026-09-14, hallazgo O-1)
-- -------------------------------------------------------------------------
-- Decisión de Alvaro:
--   ELIMINAR  RIEGOS.Conflict, RIEGOS.Conflict1, TEMPORAL
--   OCULTAR   Itemes revista, SANTA CRUZ   (quedan en Supabase, fuera del catálogo)
--   RENOMBRAR ACTUALIZADO -> BD ACTUALIZADA AGOSTO 2026
--
-- Por qué estaban duplicadas: en codex\APUS\prescom_dat_copias\ los archivos
-- RIEGOS.Conflict.dat y RIEGOS.Conflict1.dat son copias de conflicto de
-- sincronización de Riegos.DAT (mismo tamaño, 19.408 bytes, fechadas las dos
-- el 30/09/2024 10:06 junto con REVISTA.dat y SANTA CRUZ.dat). La migración
-- tomó cada .dat de la carpeta como una base. Las dos copias son idénticas
-- entre sí y tienen los mismos 39 APU que Riegos, pero con los precios viejos
-- (p. ej. «Cotización y adquisición de materiales» en 0,00 contra 2.200,00).
--
-- «Oculta» es un tipo nuevo: generar_catalogo_desde_supabase.js solo lee
-- tipo = 'origen', así que la base sigue en la base de datos, con sus precios
-- y su curaduría, y deja de publicarse. Volver a mostrarla es un UPDATE.
--
-- Ids del catálogo (id_origen) y secuencias de APU NO cambian: las ediciones
-- que cada usuario guardó por {baseId, seq} siguen enganchando.
--
-- Antes: npm run respaldar   (hecho: precios-2026-09-14T11-03-42.json.gz)
-- Correr: node herramientas/aplicar_sql.js --archivo=supabase/11_depurar_bases.sql
-- Después: npm run catalogo:generar && npm run catalogo:cifrar
-- =========================================================================

-- 1 · el tipo «oculta»
alter table bases drop constraint if exists bases_tipo_check;
alter table bases add constraint bases_tipo_check
  check (tipo in ('origen', 'arranque', 'publicada', 'oculta'));

-- 2 · control: que las bases sean las que se miraron, y nada más
do $$
declare v int;
begin
  select count(*) into v from bases
   where nombre in ('RIEGOS.Conflict', 'RIEGOS.Conflict1', 'TEMPORAL',
                    'Itemes revista', 'SANTA CRUZ', 'ACTUALIZADO');
  if v <> 6 then
    raise exception 'Se esperaban 6 bases y hay %: no se toca nada', v;
  end if;
end $$;

-- 3 · ocultar
update bases set tipo = 'oculta'
 where nombre in ('Itemes revista', 'SANTA CRUZ');

-- 4 · renombrar
update bases set nombre = 'BD ACTUALIZADA AGOSTO 2026'
 where nombre = 'ACTUALIZADO';

-- 5 · eliminar. precios_insumo.base_id es ON DELETE SET NULL: sin borrar los
--     precios a mano quedarían 380 filas huérfanas sin base. Son más de 300
--     filas, así que hace falta abrir el freno de 04_curar.sql.
set local openboq.masivo = 'on';

create temp table _borrar on commit drop as
  select id from bases where nombre in ('RIEGOS.Conflict', 'RIEGOS.Conflict1', 'TEMPORAL');

create temp table _insumos_tocados on commit drop as
  select distinct insumo_id from precios_insumo where base_id in (select id from _borrar)
  union
  select distinct c.insumo_id from apu_componentes c
    join apus a on a.id = c.apu_id where a.base_id in (select id from _borrar);

delete from precios_insumo where base_id in (select id from _borrar);
delete from bases where id in (select id from _borrar);   -- apus y componentes caen en cascada

-- insumos que solo existían en esas bases (4 al 14/09): sin precio ni uso
delete from insumos i
 where i.id in (select insumo_id from _insumos_tocados)
   and not exists (select 1 from precios_insumo p where p.insumo_id = i.id)
   and not exists (select 1 from apu_componentes c where c.insumo_id = i.id);

-- 6 · verificación
select tipo, count(*) as bases, string_agg(nombre, ' · ' order by nombre) as nombres
  from bases group by tipo order by tipo;
