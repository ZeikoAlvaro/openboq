-- =========================================================================
-- OpenBOQ — curaduría de DESCRIPCIONES desde el SQL Editor de Supabase
-- -------------------------------------------------------------------------
-- El punto de `.Ayudante` no es del insumo: es el truco de ordenamiento de la
-- BDA 2020.1, que lo usaba para que ciertas filas quedaran arriba en su propia
-- lista. Al importar quedó pegado al nombre y, como el insumo está
-- deduplicado, sale impreso en las 21 bases y en el B-2 de cualquier proyecto.
--
-- NO SE CORRE ENTERO. Se ejecuta UN bloque por vez, se mira el resultado y
-- recién entonces se pasa al siguiente. En el SQL Editor: seleccionar con el
-- mouse solo el bloque que se quiere correr y Ctrl+Enter. Sin selección corre
-- TODO el editor, que acá no es lo que se busca.
--
-- ANTES DE EMPEZAR, el respaldo. Desde la terminal, en la carpeta del
-- proyecto:
--
--     npm run respaldar
--
-- Es lo barato que evita lo caro: el 2026-08-02 un UPDATE sin WHERE dejó los
-- 9.808 precios en 20,00.
--
-- DOS COSAS QUE CONVIENE SABER ANTES DE TOCAR NADA:
--
-- 1. `descripcion_norm` NO cambia con esto. `obq_norm` ya reemplaza todo lo
--    que no sea letra o número por un espacio y hace btrim, así que `.Ayudante`
--    y `Ayudante` normalizan igual. Por eso el UPDATE no puede violar
--    `unique (tipo, unidad, descripcion_norm)`, y por eso `obq_curar`, que
--    busca por la norma, sigue encontrando todo después del rename.
--
-- 2. Y por lo mismo, si dos insumos ya normalizan igual es porque tienen
--    distinta unidad o distinto tipo: son filas legítimamente separadas. El
--    bloque 3 las lista para decidirlas una por una, y el UPDATE del bloque 5
--    las deja afuera solo.
--
-- CUANDO TERMINE, EL PASO QUE FALTA. El UPDATE en Supabase no llega a la
-- aplicación por sí solo: `MOTOR.aplicarDelta` empareja por descripción
-- literal, así que una descripción cambiada no engancha con la fila vieja y el
-- delta la descarta en silencio. Hay que regenerar el catálogo y publicar:
--
--     npm run catalogo:generar
--     (subir el ?v= de index.html y sw.js, y desplegar)
-- =========================================================================


-- =========================================================================
-- 1 · PANORAMA — cuánto hay, y cuánto sale sin decidir nada
-- =========================================================================
select
  (select count(*) from insumos where descripcion ~ '^[.]')            as con_punto,
  (select count(*) from insumos i
    where i.descripcion ~ '^[.]'
      and not exists (select 1 from insumos o
                       where o.id <> i.id
                         and o.descripcion_norm = i.descripcion_norm)) as rename_limpio,
  (select count(*) from insumos i
    where i.descripcion ~ '^[.]'
      and exists (select 1 from insumos o
                   where o.id <> i.id
                     and o.descripcion_norm = i.descripcion_norm))     as a_decidir;
-- Al 2026-09-10: 177 · 171 · 6


-- =========================================================================
-- 2 · LOS QUE SALEN LIMPIOS — mirarlos antes de tocarlos
-- -------------------------------------------------------------------------
-- `bases` y `apus` dicen cuánto pesa cada uno: cuántas bases lo cotizan y
-- cuántos análisis lo llevan adentro.
-- =========================================================================
select i.id,
       i.tipo,
       i.descripcion                                              as antes,
       btrim(regexp_replace(i.descripcion, '^[.]+\s*', ''))       as despues,
       i.unidad,
       (select count(distinct p.base_id) from precios_insumo p
         where p.insumo_id = i.id)                                as bases,
       (select count(distinct c.apu_id) from apu_componentes c
         where c.insumo_id = i.id)                                as apus
  from insumos i
 where i.descripcion ~ '^[.]'
   and not exists (select 1 from insumos o
                    where o.id <> i.id
                      and o.descripcion_norm = i.descripcion_norm)
 order by apus desc, i.descripcion;


-- =========================================================================
-- 3 · LOS QUE HAY QUE DECIDIR — ya existe otro insumo con ese nombre
-- -------------------------------------------------------------------------
-- Sacarles el punto los deja llamándose igual que otro, con distinta unidad.
-- No es un error de la base: son dos filas distintas y el modelo las separa
-- por unidad. Pero en el B-3 el usuario va a ver dos renglones con el mismo
-- nombre, y ese es justamente el terreno donde nació el precio imposible de
-- «Piedra cortada» a 200 Bs/pza: alguien copió el precio del hermano en m³.
--
-- Tres salidas por fila, y la decisión es de quien conoce el dato:
--   a) dejarle el punto (no hacer nada);
--   b) sacarle el punto igual, asumiendo dos renglones con el mismo nombre;
--   c) darle un nombre que lo distinga: 'Piedra cortada (bloque)' y listo.
-- =========================================================================
select i.id,
       i.descripcion                                              as antes,
       btrim(regexp_replace(i.descripcion, '^[.]+\s*', ''))       as despues,
       i.unidad,
       (select string_agg(o.id || ' · ' || o.descripcion || ' / ' || o.unidad, ' | ')
          from insumos o
         where o.id <> i.id
           and o.descripcion_norm = i.descripcion_norm)           as el_otro,
       (select count(distinct c.apu_id) from apu_componentes c
         where c.insumo_id = i.id)                                as apus,
       (select round(min(p.precio), 2) || ' … ' || round(max(p.precio), 2)
          from precios_insumo p where p.insumo_id = i.id)         as precios
  from insumos i
 where i.descripcion ~ '^[.]'
   and exists (select 1 from insumos o
                where o.id <> i.id
                  and o.descripcion_norm = i.descripcion_norm)
 order by i.descripcion;
-- Al 2026-09-10 son seis:
--   .Lija / m           contra  Lija / hoja  y  Lija / pza
--   .Sellador / l       contra  Sellador / gal
--   .Dinamita / pza     contra  Dinamita / carga
--   .Paja / amarr       contra  Paja / kg
--   .Teflón / pza       contra  Teflon / rollo      (difieren solo en el acento)
--   .Piedra Cortada / m3 contra Piedra cortada / pza  ← el del precio imposible


-- =========================================================================
-- 4 · LA VUELTA ATRÁS — generar el SQL que deshace, y guardarlo
-- -------------------------------------------------------------------------
-- Correr ESTE bloque ANTES del 5, copiar el resultado y pegarlo en un archivo
-- de texto. Son los UPDATE que devuelven cada descripción a como estaba. El
-- respaldo `.gz` también sirve, pero restaurarlo entero por un rename es
-- desproporcionado; esto revierte solo lo que se tocó.
-- =========================================================================
select 'update insumos set descripcion = ' || quote_literal(i.descripcion) ||
       ' where id = ' || i.id || ';'                              as deshacer
  from insumos i
 where i.descripcion ~ '^[.]'
   and not exists (select 1 from insumos o
                    where o.id <> i.id
                      and o.descripcion_norm = i.descripcion_norm)
 order by i.id;


-- =========================================================================
-- 5 · EL UPDATE — los 171 que salen limpios
-- -------------------------------------------------------------------------
-- Va entero, de una: BEGIN, el UPDATE, el conteo y el COMMIT seleccionados
-- juntos. Si el número que devuelve no es el que se esperaba, en vez de
-- COMMIT se corre ROLLBACK y no pasó nada.
--
-- La condición NOT EXISTS es la misma del bloque 2: los que chocan quedan
-- afuera sin tener que escribir ningún id a mano, así que este bloque sigue
-- siendo correcto aunque la base cambie.
-- =========================================================================
begin;

update insumos i
   set descripcion = btrim(regexp_replace(i.descripcion, '^[.]+\s*', ''))
 where i.descripcion ~ '^[.]'
   and not exists (select 1 from insumos o
                    where o.id <> i.id
                      and o.descripcion_norm = i.descripcion_norm);

-- Tiene que dar 6: los seis del bloque 3, los únicos que quedan con punto.
select count(*) as quedan_con_punto from insumos where descripcion ~ '^[.]';

commit;
-- rollback;   -- ← esto en lugar del commit si el número no cuadra


-- =========================================================================
-- 6 · VERIFICAR DESPUÉS
-- -------------------------------------------------------------------------
-- Lo que importa no es solo que el punto se haya ido: es que no se haya
-- perdido ni duplicado ningún insumo, y que la norma siga siendo la misma
-- —si cambiara, los precios y los componentes dejarían de encontrarse por
-- nombre en el resto del circuito—.
-- =========================================================================
select
  (select count(*) from insumos)                                       as insumos,
  (select count(*) from insumos where descripcion ~ '^[.]')            as con_punto,
  (select count(*) from insumos where descripcion <> btrim(descripcion)) as con_espacios,
  (select count(*) from insumos i
    where i.descripcion_norm <> obq_norm(i.descripcion))               as norma_desalineada,
  (select count(*) from precios_insumo)                                as precios,
  (select count(*) from apu_componentes)                               as componentes;
-- `norma_desalineada` tiene que dar 0. Si no, el trigger no corrió.

-- Y una mirada a los que más pesan, para ver los nombres ya limpios:
select i.descripcion, i.unidad,
       (select count(distinct c.apu_id) from apu_componentes c
         where c.insumo_id = i.id) as apus
  from insumos i
 where i.descripcion_norm in ('ALAMBRE DE AMARRE', 'AYUDANTE', 'ALQUITRAN')
 order by apus desc;


-- =========================================================================
-- 7 · LOS SEIS, DE A UNO
-- -------------------------------------------------------------------------
-- Plantilla. Se cambia el id y el nombre, y se corre una fila por vez.
-- Ejemplos de las tres salidas del bloque 3:
--
--   -- (b) sacarle el punto igual:
--   update insumos set descripcion = 'Teflón' where id = 39653;
--
--   -- (c) darle un nombre que lo distinga del hermano en otra unidad:
--   update insumos set descripcion = 'Piedra cortada (bloque)' where id = 39588;
--
-- Antes de correr cualquiera de las dos, mirar contra qué choca:
--     select * from insumos where descripcion_norm = obq_norm('Teflon');
--
-- Y después, la vuelta atrás de esa fila sola:
--     update insumos set descripcion = '.Teflón' where id = 39653;
-- =========================================================================


-- =========================================================================
-- 8 · LOS DOS PRECIOS IMPOSIBLES — cuando estén decididos
-- -------------------------------------------------------------------------
-- Esto NO es un UPDATE sobre el precio. La regla de la casa: el precio de
-- origen no se toca; corregir es AGREGAR una fila con procedencia
-- 'curaduria', que el generador del catálogo prefiere. Por eso toda
-- corrección se deshace con `obq_descurar` y nunca se pierde lo que decía el
-- archivo original. La función vive en `supabase/04_curar.sql`.
--
--   select obq_curar('Ex Fondo de Inversión Social',
--                    'Bloque.de.suelo-cemento(29x14x10)', 'pza',
--                    1.78,
--                    'Curaduria «limpieza» relleno un origen 0,00 con 330 Bs/pza. '
--                    'Referencia: SUELO CEMENTO / pza en ORURO.');
--
--   select obq_curar('Ex Fondo de Inversión Social',
--                    'Piedra cortada', 'pza',
--                    ???,
--                    'La consolidacion 20260816 le copio el precio de su hermano '
--                    'en m3. Los precios de origen van de 2,10 a 112,20.');
--
-- Los valores los decide Alvaro; la planilla con las ocho filas está en
-- `supabase/curaduria_precios_imposibles_2026-09-10.csv`.
--
-- Para ver cómo quedó y para deshacer:
--     select * from v_mis_curadurias;
--     select obq_descurar('Ex Fondo de Inversión Social', 'Piedra cortada', 'pza');
-- =========================================================================
