-- =========================================================================
-- OpenBOQ — esquema del repositorio central de precios (Supabase / Postgres)
-- -------------------------------------------------------------------------
-- Este Postgres NO lo consulta la aplicación. La aplicación sigue leyendo un
-- snapshot versionado (data/catalogo.js → el archivo que se publica). Acá
-- vive la curaduría: la base histórica migrada, los aportes que mandan los
-- usuarios y las publicaciones que salieron de todo eso.
--
-- Cómo aplicarlo: Supabase → SQL Editor → New query → pegar todo → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
-- =========================================================================

create extension if not exists pg_trgm;

-- -------------------------------------------------------------------------
-- Normalización para DEDUPLICAR (no es la misma que MOTOR.norm de la app).
-- La de la app sirve para buscar mientras se escribe; esta es más agresiva
-- porque su trabajo es decidir si dos filas son el mismo insumo:
-- sin tildes, en mayúsculas, sin espacios de más, sin puntuación suelta.
--
-- Se usa translate() y no la extensión unaccent a propósito: unaccent es
-- STABLE (depende de un diccionario) y acá hace falta algo IMMUTABLE para
-- poder indexar. La ñ pasa a n, igual que en MOTOR.norm de la aplicación.
-- -------------------------------------------------------------------------
create or replace function obq_norm(t text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(t, ''),
              'áéíóúüñÁÉÍÓÚÜÑàèìòùâêîôûäëïöçÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ',
              'aeiouunAEIOUUNaeiouaeiouaeiocAEIOUAEIOUAEIOC')),
        '[^A-Z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g'))
$$;


-- =========================================================================
-- BASES — de dónde viene cada conjunto de datos
--   origen    : las 21 bases migradas del catálogo actual (referencia)
--   arranque  : la base curada que se publica como catálogo inicial
--   publicada : cada versión que efectivamente salió a los usuarios
-- =========================================================================
create table if not exists bases (
  id          bigserial primary key,
  nombre      text        not null unique,
  tipo        text        not null check (tipo in ('origen', 'arranque', 'publicada')),
  descripcion text,
  creado_en   timestamptz not null default now()
);

-- Id que la base tiene en el catálogo publicado. NO es decorativo: la
-- aplicación guarda los análisis que el usuario editó en su navegador
-- indexados por {baseId, seq del APU} (MOTOR.BDU.cambios). Si al regenerar
-- el catálogo esos números se corren, cada probador pierde sus ediciones.
-- Por eso el snapshot se emite siempre con el id original y no con uno nuevo.
alter table bases add column if not exists id_origen int;


-- =========================================================================
-- INSUMOS — catálogo maestro, deduplicado entre todas las bases.
-- «Cemento portland / kg» es UNA fila, aunque aparezca en quince bases con
-- quince precios distintos. Los precios viven en precios_insumo.
-- =========================================================================
create table if not exists insumos (
  id               bigserial primary key,
  tipo             char(1)     not null check (tipo in ('M', 'O', 'E')),  -- Material / manO de obra / Equipo
  descripcion      text        not null,
  descripcion_norm text        not null,
  unidad           text        not null,
  creado_en        timestamptz not null default now(),
  unique (tipo, unidad, descripcion_norm)
);

create index if not exists insumos_norm_trgm
  on insumos using gin (descripcion_norm gin_trgm_ops);

-- La normalización se calcula sola: quien cargue a mano desde el Table
-- Editor no tiene que acordarse de escribirla.
create or replace function insumos_normalizar()
returns trigger language plpgsql as $$
begin
  new.descripcion_norm := obq_norm(new.descripcion);
  new.unidad           := btrim(new.unidad);
  return new;
end $$;

drop trigger if exists trg_insumos_normalizar on insumos;
create trigger trg_insumos_normalizar
  before insert or update on insumos
  for each row execute function insumos_normalizar();


-- =========================================================================
-- PRECIOS_INSUMO — serie histórica, NO se pisa.
-- Cuando sale una revista nueva o llega un aporte, se agrega una fila. El
-- precio vigente es el de fecha más alta para la procedencia que se quiera.
-- Así se puede comparar «lo que dice la revista» contra «lo que pagan en
-- Oruro» sin perder ninguno de los dos.
-- =========================================================================
create table if not exists precios_insumo (
  id           bigserial primary key,
  insumo_id    bigint        not null references insumos(id) on delete cascade,
  precio       numeric(14,4) not null check (precio >= 0),
  moneda       text          not null default 'Bs',
  fecha        date          not null default current_date,
  procedencia  text          not null,   -- 'base origen', 'revista P&C MAR26-AGO26', 'aporte usuario', 'cotizacion'
  base_id      bigint        references bases(id) on delete set null,
  aporte_id    bigint,                   -- FK al final del archivo (aportes se crea después)
  nota         text,                     -- por qué se corrigió, cuando viene de curaduría
  creado_en    timestamptz   not null default now()
);

alter table precios_insumo add column if not exists nota text;

create index if not exists precios_insumo_vigente
  on precios_insumo (insumo_id, fecha desc);
create index if not exists precios_insumo_base
  on precios_insumo (base_id);

-- OJO: una base puede aportar VARIOS precios para el mismo insumo, y no es
-- un error de carga. En las bases originales aparece, por ejemplo,
-- «CAÑERIA GALVANIZADA 1» / m tres veces a 1,66 · 28,97 · 57,92 dentro de
-- ORURO. Aplastar eso a un solo precio cambiaría el costo de los análisis
-- que usan cada variante. Son 105 casos y son, justamente, lo primero que
-- hay que curar. Por eso acá NO va un índice único por (insumo, base):
-- la idempotencia se resuelve borrando los precios de la base antes de
-- recargarla (ver herramientas/migrar_a_supabase.js).


-- =========================================================================
-- APUS — análisis de precios unitarios. Cada uno pertenece a una base.
-- =========================================================================
create table if not exists apus (
  id               bigserial primary key,
  base_id          bigint      not null references bases(id) on delete cascade,
  codigo           text,
  descripcion      text        not null,
  descripcion_norm text        not null,
  unidad           text        not null,
  seq_origen       int,        -- secuencia que tenía en la base original (.DAT)
  creado_en        timestamptz not null default now()
);

-- Para las bases migradas: permite volver del registro al archivo de origen
-- y hace determinista el mapeo al cargar los componentes.
alter table apus add column if not exists seq_origen int;
create unique index if not exists apus_base_seq on apus (base_id, seq_origen)
  where seq_origen is not null;

create index if not exists apus_base      on apus (base_id);
create index if not exists apus_norm_trgm on apus using gin (descripcion_norm gin_trgm_ops);

create or replace function apus_normalizar()
returns trigger language plpgsql as $$
begin
  new.descripcion_norm := obq_norm(new.descripcion);
  new.unidad           := btrim(new.unidad);
  return new;
end $$;

drop trigger if exists trg_apus_normalizar on apus;
create trigger trg_apus_normalizar
  before insert or update on apus
  for each row execute function apus_normalizar();


-- =========================================================================
-- APU_COMPONENTES — qué insumos lleva cada análisis y en qué rendimiento.
-- El precio NO va acá: sale de precios_insumo según la base y la fecha.
-- =========================================================================
create table if not exists apu_componentes (
  id          bigserial primary key,
  apu_id      bigint        not null references apus(id) on delete cascade,
  insumo_id   bigint        not null references insumos(id) on delete restrict,
  rendimiento numeric(16,6) not null check (rendimiento >= 0)
);

-- Precio que este componente usaba en su base de origen. Existe porque una
-- base puede traer el mismo insumo a dos precios distintos (ver la nota de
-- precios_insumo): sin esto, el costo del análisis no se puede reconstruir
-- tal como estaba. Para lo que se cargue de cero queda en null y manda
-- precios_insumo.
alter table apu_componentes add column if not exists precio_origen numeric(14,4);

-- La unicidad incluye el precio, no solo el insumo. Si un análisis repite el
-- mismo insumo AL MISMO precio, son la misma línea y los rendimientos se
-- suman. Si lo repite a precios distintos, son dos líneas y las dos tienen
-- que sobrevivir, o el costo del análisis cambia.
alter table apu_componentes
  drop constraint if exists apu_componentes_apu_id_insumo_id_key;
create unique index if not exists apu_comp_unico
  on apu_componentes (apu_id, insumo_id, coalesce(precio_origen, -1));

create index if not exists apu_comp_apu    on apu_componentes (apu_id);
create index if not exists apu_comp_insumo on apu_componentes (insumo_id);


-- =========================================================================
-- APORTES — cola de lo que mandan los usuarios desde la aplicación.
-- Llega crudo, en jsonb, y NADIE lo toca hasta que un revisor lo aprueba.
-- El hash deduplica: el mismo análisis mandado dos veces entra una sola vez.
--
-- Qué NO puede venir acá (regla de diseño, se filtra en la aplicación):
-- cantidades de obra, montos, nombre del proyecto o de la entidad.
-- Solo datos técnicos: descripción, unidad, tipo, precio, rendimiento.
-- =========================================================================
create table if not exists aportes (
  id             bigserial primary key,
  usuario_email  text,                    -- magic link de Supabase Auth
  usuario_id     uuid,                    -- auth.users.id cuando hay sesión
  payload        jsonb       not null,
  hash           text        not null unique,
  estado         text        not null default 'pendiente'
                 check (estado in ('pendiente', 'aprobado', 'rechazado', 'duplicado')),
  revisor        text,
  revisado_en    timestamptz,
  nota           text,
  app_version    text,
  creado_en      timestamptz not null default now()
);

create index if not exists aportes_cola on aportes (estado, creado_en);

alter table precios_insumo
  drop constraint if exists precios_insumo_aporte_fk;
alter table precios_insumo
  add constraint precios_insumo_aporte_fk
  foreign key (aporte_id) references aportes(id) on delete set null;


-- =========================================================================
-- PUBLICACIONES — qué se publicó, cuándo y con qué adentro.
-- Sirve para poder decir «el usuario tiene la v1.2, le falta esto».
-- =========================================================================
create table if not exists publicaciones (
  id            bigserial primary key,
  version       text        not null unique,
  fecha         timestamptz not null default now(),
  snapshot_hash text,
  n_apus        int,
  n_insumos     int,
  nota          text
);


-- =========================================================================
-- VISTAS DE CURADURÍA — para trabajar desde el Table Editor sin escribir SQL
-- =========================================================================

-- Precio vigente de cada insumo (el más reciente, sin importar procedencia).
create or replace view v_precio_vigente as
select distinct on (p.insumo_id)
       p.insumo_id, i.tipo, i.descripcion, i.unidad,
       p.precio, p.moneda, p.fecha, p.procedencia, p.base_id
from   precios_insumo p
join   insumos i on i.id = p.insumo_id
order  by p.insumo_id, p.fecha desc, p.id desc;

-- Insumos con precios muy dispares entre bases: lo primero a revisar.
create or replace view v_precios_dispares as
select i.id as insumo_id, i.tipo, i.descripcion, i.unidad,
       count(*)                        as n_precios,
       min(p.precio)                   as minimo,
       max(p.precio)                   as maximo,
       round(max(p.precio) / nullif(min(p.precio), 0), 2) as veces
from   insumos i
join   precios_insumo p on p.insumo_id = i.id
group  by i.id, i.tipo, i.descripcion, i.unidad
having count(*) > 1
   and max(p.precio) > min(p.precio) * 2
order  by veces desc;

-- Candidatos a duplicado por parecido de texto (pg_trgm).
create or replace view v_posibles_duplicados as
select a.id as id_a, a.descripcion as descripcion_a,
       b.id as id_b, b.descripcion as descripcion_b,
       a.tipo, a.unidad,
       round(similarity(a.descripcion_norm, b.descripcion_norm)::numeric, 3) as parecido
from   insumos a
join   insumos b
  on   b.id > a.id
 and   b.tipo = a.tipo
 and   b.unidad = a.unidad
 and   a.descripcion_norm % b.descripcion_norm
order  by parecido desc;


-- =========================================================================
-- SEGURIDAD — RLS prendido en todo, SIN políticas todavía.
-- Con esto, la clave pública (anon) no lee ni escribe nada. Solo entra la
-- clave de servicio, que se usa desde los scripts de migración y desde el
-- panel. Las políticas de aportes se agregan en la fase 4, cuando la
-- aplicación empiece a mandar datos.
-- =========================================================================
alter table bases           enable row level security;
alter table insumos         enable row level security;
alter table precios_insumo  enable row level security;
alter table apus            enable row level security;
alter table apu_componentes enable row level security;
alter table aportes         enable row level security;
alter table publicaciones   enable row level security;
