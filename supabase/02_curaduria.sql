-- =========================================================================
-- OpenBOQ — curaduría de precios desde el SQL Editor de Supabase
-- -------------------------------------------------------------------------
-- Consultas para revisar y corregir la Base de Datos a mano. No se corre
-- entero: se ejecuta UN bloque por vez, se mira el resultado y recién
-- entonces se pasa al siguiente.
--
-- En el SQL Editor: seleccionar con el mouse solo el bloque que se quiere
-- correr y apretar Ctrl+Enter. Si no se selecciona nada, corre TODO el
-- editor, que no es lo que se busca acá.
--
-- LA REGLA DE LA CASA: el precio de origen NO se toca. Corregir es AGREGAR
-- una fila con procedencia 'curaduria'; el generador del catálogo la
-- prefiere sobre la de origen. Por eso toda corrección se deshace con un
-- DELETE y nunca se pierde lo que decía el archivo original.
-- =========================================================================


-- =========================================================================
-- 1 · PANORAMA — cuánto hay para revisar
-- =========================================================================
select
  (select count(*) from bases   where tipo = 'origen')                    as bases,
  (select count(*) from insumos)                                          as insumos,
  (select count(*) from apus)                                             as apus,
  (select count(*) from precios_insumo where procedencia = 'base origen') as precios_origen,
  (select count(*) from precios_insumo where procedencia = 'curaduria')   as ya_corregidos,
  (select count(*) from precios_insumo
    where procedencia = 'base origen' and precio = 0)                     as precios_en_cero;


-- =========================================================================
-- 2 · CONFLICTOS — el mismo insumo, en la misma base, a precios distintos
-- -------------------------------------------------------------------------
-- `ref_otras_bases` es lo que cobran las DEMÁS bases por ese mismo insumo:
-- es lo que permite decidir cuál de los precios es el bueno sin adivinar.
-- `apus` dice cuántos análisis usan ese precio exacto — o sea, el daño.
--
-- Bajar el 10 del `having` para ver también los conflictos leves (con 2
-- aparecen los 105; casi todos son el mismo precio actualizado con los
-- años, y ahí las dos versiones son legítimas).
-- =========================================================================
with grupos as (
  select insumo_id, base_id
    from precios_insumo
   where procedencia = 'base origen'
   group by insumo_id, base_id
  having count(*) > 1
     and max(precio) > min(precio) * 10
)
select b.nombre                                   as base,
       i.tipo, i.descripcion, i.unidad,
       p.precio,
       round(ref.mediana::numeric, 2)                      as ref_otras_bases,
       ref.n                                      as cuantas_bases,
       (select count(distinct c.apu_id)
          from apu_componentes c
          join apus a on a.id = c.apu_id
         where c.insumo_id = i.id
           and a.base_id   = b.id
           and c.precio_origen = p.precio)        as apus
  from grupos g
  join precios_insumo p on p.insumo_id = g.insumo_id
                       and p.base_id   = g.base_id
                       and p.procedencia = 'base origen'
  join insumos i on i.id = g.insumo_id
  join bases   b on b.id = g.base_id
  left join lateral (
    select count(*) as n,
           percentile_cont(0.5) within group (order by o.precio) as mediana
      from precios_insumo o
     where o.insumo_id = i.id
       and o.base_id is distinct from b.id
       and o.precio > 0
  ) ref on true
 order by b.nombre, i.descripcion, p.precio;


-- =========================================================================
-- 3 · PRECIOS EN CERO — ordenados por cuánto daño hacen
-- -------------------------------------------------------------------------
-- Un insumo en 0 hace que el análisis cueste de menos sin avisar. OJO: no
-- siempre es un error — hay bases que ponen 0 a propósito porque ese costo
-- entra en otro lado. Ahí decide el criterio de ingeniería, no el SQL.
-- =========================================================================
select b.nombre as base, i.tipo, i.descripcion, i.unidad,
       round(ref.mediana::numeric, 2) as ref_otras_bases,
       ref.n                 as cuantas_bases,
       (select count(distinct c.apu_id)
          from apu_componentes c
          join apus a on a.id = c.apu_id
         where c.insumo_id = i.id and a.base_id = b.id)  as apus
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  join bases   b on b.id = p.base_id
  left join lateral (
    select count(*) as n,
           percentile_cont(0.5) within group (order by o.precio) as mediana
      from precios_insumo o
     where o.insumo_id = i.id and o.precio > 0
  ) ref on true
 where p.procedencia = 'base origen' and p.precio = 0
 order by apus desc, b.nombre
 limit 50;


-- =========================================================================
-- 4 · MIRAR UN INSUMO EN DETALLE, antes de tocarlo
-- -------------------------------------------------------------------------
-- Siempre este paso antes de corregir: qué precios tiene en todas las
-- bases. Cambiar el texto del obq_norm() por el insumo que se quiera ver.
-- =========================================================================
select b.nombre as base, i.tipo, i.descripcion, i.unidad,
       p.precio, p.procedencia, p.fecha, p.nota
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  left join bases b on b.id = p.base_id
 where i.descripcion_norm = obq_norm('CAÑERIA GALVANIZADA 1')
 order by b.nombre, p.precio;


-- =========================================================================
-- 5 · QUÉ ANÁLISIS SE VAN A VER AFECTADOS
-- -------------------------------------------------------------------------
-- Antes de corregir conviene saber a quién le cambia el costo. Acá se ve
-- el precio unitario del componente y cuánto pesa dentro del análisis.
-- =========================================================================
select b.nombre as base, a.seq_origen, a.descripcion as analisis,
       c.rendimiento, c.precio_origen,
       round(c.rendimiento * c.precio_origen, 2) as cuesta_hoy
  from apu_componentes c
  join apus    a on a.id = c.apu_id
  join bases   b on b.id = a.base_id
  join insumos i on i.id = c.insumo_id
 where i.descripcion_norm = obq_norm('CAÑERIA GALVANIZADA 1')
   and b.nombre = 'ORURO'
   and c.precio_origen = 1.66
 order by a.seq_origen;


-- =========================================================================
-- 6 · CORREGIR UN PRECIO
-- -------------------------------------------------------------------------
-- No es un UPDATE: se AGREGA la corrección. El insumo se busca por
-- tipo + unidad + descripción normalizada, que es la misma clave con la que
-- se dedupló al migrar, así que no hay que saberse ningún id.
--
-- La nota no es decorativa: dentro de seis meses es lo único que explica
-- por qué ese número es ese.
--
-- ⚠️ CORRER ESTO DOS VECES INSERTA DOS FILAS. Nada lo impide por sí solo, y
-- después no se sabe cuál vale. Por eso el bloque empieza borrando la
-- corrección anterior de ese mismo insumo en esa misma base: así se puede
-- repetir todas las veces que haga falta y siempre queda UNA.
-- (Ver el bloque 6b para prohibirlo de una vez y para siempre.)
-- =========================================================================
delete from precios_insumo p
 using insumos i, bases b
 where p.insumo_id = i.id
   and p.base_id   = b.id
   and p.procedencia = 'curaduria'
   and i.tipo   = 'M'
   and i.unidad = 'm'
   and i.descripcion_norm = obq_norm('CAÑERIA GALVANIZADA 1')
   and b.nombre = 'ORURO';

insert into precios_insumo (insumo_id, precio, procedencia, base_id, nota)
select i.id, 28.97, 'curaduria', b.id,
       'las otras bases dan 28,02-37,60; el 1,66 era de otro insumo'
  from insumos i
  cross join bases b
 where i.tipo   = 'M'
   and i.unidad = 'm'
   and i.descripcion_norm = obq_norm('CAÑERIA GALVANIZADA 1')
   and b.nombre = 'ORURO';


-- =========================================================================
-- 6b · QUE LA BASE NO DEJE DUPLICAR (se corre UNA sola vez)
-- -------------------------------------------------------------------------
-- Acordarse de borrar antes de insertar funciona hasta que uno se olvida.
-- Un índice único lo vuelve imposible: una sola corrección por insumo y por
-- base. Con él, el INSERT del bloque 6 se puede escribir con ON CONFLICT y
-- ya no hace falta el DELETE.
--
-- Primero hay que dejar una sola fila de cada grupo. Esta consulta MUESTRA
-- lo que sobra; conviene mirarla antes de correr el delete de abajo.
-- =========================================================================
select p.id, b.nombre as base, i.descripcion, p.precio, p.nota, p.fecha
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  left join bases b on b.id = p.base_id
 where p.procedencia = 'curaduria'
   and exists (select 1 from precios_insumo q
                where q.procedencia = 'curaduria'
                  and q.insumo_id = p.insumo_id
                  and q.base_id is not distinct from p.base_id
                  and q.id > p.id)
 order by i.descripcion, p.id;

-- Borra las repetidas y deja la MÁS RECIENTE de cada grupo:
-- delete from precios_insumo p
--  where p.procedencia = 'curaduria'
--    and exists (select 1 from precios_insumo q
--                 where q.procedencia = 'curaduria'
--                   and q.insumo_id = p.insumo_id
--                   and q.base_id is not distinct from p.base_id
--                   and q.id > p.id);

-- Y una vez sin repetidas, prohibirlas para siempre:
-- create unique index if not exists precios_insumo_curaduria
--   on precios_insumo (insumo_id, base_id)
--   where procedencia = 'curaduria';

-- Con ese índice puesto, el bloque 6 ya no necesita el DELETE previo:
-- insert into precios_insumo (insumo_id, precio, procedencia, base_id, nota)
-- select i.id, 28.97, 'curaduria', b.id, 'la nota'
--   from insumos i cross join bases b
--  where i.tipo='M' and i.unidad='m'
--    and i.descripcion_norm = obq_norm('CAÑERIA GALVANIZADA 1')
--    and b.nombre = 'ORURO'
--     on conflict (insumo_id, base_id) where procedencia = 'curaduria'
--     do update set precio = excluded.precio,
--                   nota   = excluded.nota,
--                   fecha  = current_date;


-- =========================================================================
-- 7 · CORREGIR VARIOS DE UNA VEZ
-- -------------------------------------------------------------------------
-- Mismo criterio, en lote. Se edita la lista del VALUES: base, tipo,
-- unidad, descripción, precio nuevo, nota.
--
-- Antes de correr el INSERT conviene cambiar la primera línea por
--     select x.*, i.id as insumo_id, b.id as base_id
-- y ejecutar así: si alguna fila no encuentra su insumo, no aparece en el
-- resultado, y es mejor descubrirlo mirando que después de haber escrito.
-- =========================================================================
-- El ON CONFLICT hace falta si ya se creó el índice del bloque 6b: sin él,
-- en cuanto una de las filas ya esté corregida falla el lote entero y no
-- entra ninguna. Si el índice todavía no está, esta cláusula da error; en
-- ese caso, correr primero el 6b.
insert into precios_insumo (insumo_id, precio, procedencia, base_id, nota)
select i.id, x.precio, 'curaduria', b.id, x.nota
  from (values
    ('ORURO', 'M', 'm',   'CAÑERIA GALVANIZADA 1',   28.97, 'ref. otras bases 28,02-37,60'),
    ('ORURO', 'M', 'm',   'CAÑERIA GALVANIZADA 1/2', 18.46, 'ref. otras bases'),
    ('ORURO', 'M', 'm²',  'CALAMINA GALVANIZADA N§ 28', 41.00, 'el 1,66 no corresponde')
  ) as x(base, tipo, unidad, descripcion, precio, nota)
  join bases   b on b.nombre = x.base
  join insumos i on i.tipo = x.tipo
                and i.unidad = x.unidad
                and i.descripcion_norm = obq_norm(x.descripcion)
    on conflict (insumo_id, base_id) where procedencia = 'curaduria'
    do update set precio = excluded.precio,
                  nota   = excluded.nota,
                  fecha  = current_date;


-- =========================================================================
-- 8 · VER TODO LO CORREGIDO HASTA AHORA
-- =========================================================================
select p.id, b.nombre as base, i.tipo, i.descripcion, i.unidad,
       p.precio as corregido,
       (select o.precio from precios_insumo o
         where o.insumo_id = p.insumo_id and o.base_id = p.base_id
           and o.procedencia = 'base origen'
         order by o.precio limit 1) as decia_el_origen,
       p.nota, p.fecha
  from precios_insumo p
  join insumos i on i.id = p.insumo_id
  left join bases b on b.id = p.base_id
 where p.procedencia = 'curaduria'
 order by p.id desc;


-- =========================================================================
-- 9 · DESHACER
-- -------------------------------------------------------------------------
-- Borrar una corrección puntual, con el id que devuelve la consulta 8.
-- El precio de origen sigue intacto: no hay nada que restaurar.
-- =========================================================================
-- delete from precios_insumo where procedencia = 'curaduria' and id = 12345;

-- Borrar TODAS las correcciones y empezar la curaduría de cero:
-- delete from precios_insumo where procedencia = 'curaduria';


-- =========================================================================
-- 10 · OTRAS VISTAS QUE YA ESTÁN ARMADAS
-- =========================================================================
-- Insumos cuyo precio varía más del doble entre bases (incluye variación
-- legítima por el paso del tiempo, no solo errores):
select * from v_precios_dispares limit 40;

-- Insumos que parecen el mismo escrito distinto (usa pg_trgm):
select * from v_posibles_duplicados where parecido > 0.75 limit 40;

-- Precio más reciente de cada insumo:
-- select * from v_precio_vigente limit 40;
