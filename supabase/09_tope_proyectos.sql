-- =========================================================================
-- OpenBOQ · 09 — el tope de proyectos por cuenta pasa de 3 a 10
-- -------------------------------------------------------------------------
-- POR QUÉ EXISTE ESTE ARCHIVO APARTE. `07_proyectos.sql` crea la tabla con
-- `create table if not exists`. En una base donde la tabla YA existe, ese
-- archivo no cambia nada: la restricción vieja —`slot between 1 and 3`—
-- sigue puesta y el cuarto proyecto se rechaza igual, aunque la aplicación
-- ofrezca diez casilleros. Esto la corrige.
--
-- QUÉ HACE. Cambia la restricción `check` de la columna `slot` para que
-- acepte de 1 a 10. No toca datos: ampliar un `check` no puede invalidar
-- ninguna fila existente —las que hay están entre 1 y 3, que sigue siendo
-- válido—, no borra nada y no reescribe la tabla.
--
-- POR QUÉ DIEZ. Medido el 2026-09-09 sobre las filas reales: un proyecto
-- guardado pesa entre 15 y 115 KB ya comprimido (el jsonb comprime 3 a 1), y
-- el disparador de `07_proyectos.sql` corta cualquiera que pase los 3 MB de
-- JSON. Diez casilleros son ~1,1 MB por cuenta en el caso peor realista.
-- Con los 419 MB libres del plan gratis entran unos 380 usuarios que llenen
-- los diez, o unos 2.300 que usen uno solo.
--
-- SE PUEDE CORRER MÁS DE UNA VEZ. Busca la restricción por su definición y
-- no por su nombre, porque el nombre lo pone Postgres solo y cambia según
-- cómo se creó la tabla.
--
-- Uso:
--     node herramientas/aplicar_sql.js --archivo=supabase/09_tope_proyectos.sql --ensayo
--     node herramientas/aplicar_sql.js --archivo=supabase/09_tope_proyectos.sql
-- =========================================================================

do $$
declare v_nombre text;
begin
  /* La restricción vieja, sea cual sea el nombre que le haya puesto
     Postgres: la que menciona `slot` y no es la nueva. */
  for v_nombre in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'usuarios_proyectos'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%slot%'
       and c.conname <> 'usuarios_proyectos_slot_1_a_10'
  loop
    execute format('alter table usuarios_proyectos drop constraint %I', v_nombre);
    raise notice 'OpenBOQ: sacada la restricción vieja %', v_nombre;
  end loop;

  if not exists (
    select 1 from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'usuarios_proyectos'
       and c.conname = 'usuarios_proyectos_slot_1_a_10'
  ) then
    alter table usuarios_proyectos
      add constraint usuarios_proyectos_slot_1_a_10 check (slot between 1 and 10);
    raise notice 'OpenBOQ: el tope de proyectos por cuenta quedó en 10';
  else
    raise notice 'OpenBOQ: el tope ya estaba en 10, no había nada que cambiar';
  end if;
end $$;

/* Comprobación: la definición que quedó puesta. Tiene que decir 1 y 10. */
select c.conname as restriccion, pg_get_constraintdef(c.oid) as definicion
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
 where t.relname = 'usuarios_proyectos' and c.contype = 'c';
