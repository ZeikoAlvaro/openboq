/* =========================================================================
   OpenBOQ MCP — las herramientas, tal como las ve la IA
   -------------------------------------------------------------------------
   Registra en un McpServer las operaciones del núcleo. Lo comparten el MCP
   local (stdio) y el remoto (Worker). Lo que depende del lugar —escribir un
   archivo en disco, por ejemplo— lo agrega cada uno por su cuenta.
   ========================================================================= */
import { z } from 'zod';

export const INSTRUCCIONES = `OpenBOQ arma presupuestos de obra (formularios B-1, B-2 y B-3, Bolivia) contra su Base de Datos de análisis de precios unitarios.
Cómo trabajar:
1. catalogo_info para ver las bases. Si el usuario no dice cuál, pregúntele o use la más reciente (P&C / ACTUALIZADA).
2. buscar_apu por palabras clave (ej. «hormigon zapata», «excavacion comun»). Cada resultado trae una ref «base:seq».
3. ver_apu antes de elegir si hay varios parecidos: compare unidad, componentes y costo directo.
4. crear_proyecto (con sus módulos), después agregar_items con ref + cantidad + módulo. Puede mandar muchos ítems de una vez.
5. ver_presupuesto para mostrar el B-1. Los totales los calcula el motor de OpenBOQ: NUNCA sume ni recalcule por su cuenta.
6. Lea los «avisos»: un insumo en cero o que se come el costo del análisis es un precio a revisar; dígaselo al usuario.
Las cantidades las da el usuario (cómputos métricos). No invente cantidades: si faltan, pregunte.
Si el usuario trae un presupuesto YA HECHO en Excel (presupuesto general + análisis de precios), no lo rearme ítem
por ítem: use importar_excel con todos sus archivos (o la carpeta). Lee el Excel tal cual, sin elegir nada, y
puede dejar el .boq y el .ddp escritos en la misma llamada. Informe primero los defectos que devuelve (precios en
Bs copiados como $US, análisis que no suman su total, renglones sin costo) y no los corrija sin que el usuario lo pida.`;

const txt = o => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 1) }] });
const envolver = (fn, antes, nombre) => async args => {
  try {
    if (antes) await antes(nombre);
    return txt(await fn(args || {}));
  }
  catch (e) { return { isError: true, content: [{ type: 'text', text: 'Error: ' + (e && e.message || e) }] }; }
};

const INC = z.object({
  cargas: z.number().optional().describe('% cargas sociales sobre mano de obra'),
  ivaMO: z.number().optional().describe('% IVA sobre mano de obra + cargas sociales'),
  herr: z.number().optional().describe('% herramientas menores sobre mano de obra'),
  gg: z.number().optional().describe('% gastos generales'),
  util: z.number().optional().describe('% utilidad'),
  it: z.number().optional().describe('% impuesto a las transacciones')
}).describe('Incidencias del B-2, en porcentaje');

/**
 * @param {Object} [opciones]
 * @param {Function} [opciones.antes] se llama con el nombre de la herramienta
 *   antes de cada uso; si tira un error, la herramienta no corre (topes).
 */
export function registrar(server, N, opciones) {
  const antes = opciones && opciones.antes;
  const h = (nombre, descripcion, esquema, fn, soloLectura) =>
    server.registerTool(nombre, {
      description: descripcion, inputSchema: esquema,
      annotations: { readOnlyHint: !!soloLectura }
    }, envolver(fn, antes, nombre));

  h('catalogo_info', 'Bases de precios disponibles, fecha del catálogo, incidencias por omisión y unidades.',
    {}, () => N.catalogoInfo(), true);

  h('buscar_apu', 'Busca análisis de precios unitarios (APU) por palabras. Todas las palabras tienen que aparecer. Devuelve ref, código, descripción, unidad y costo directo (sin incidencias).',
    { texto: z.string().describe('Palabras a buscar, sin tildes hace falta'),
      base_id: z.number().optional().describe('Limitar a una base (ver catalogo_info)'),
      limite: z.number().optional().describe('Máximo de resultados, por omisión 20') },
    N.buscarApu, true);

  h('ver_apu', 'Composición de un APU del catálogo: insumos, rendimientos, precios y costo directo, con avisos de precios sospechosos.',
    { ref: z.string().describe('Referencia «base:seq» que devuelve buscar_apu') }, N.verApu, true);

  h('buscar_insumo', 'Busca insumos (materiales, mano de obra, equipo) y su precio en cada base.',
    { texto: z.string(), tipo: z.enum(['material', 'mano de obra', 'equipo']).optional(),
      base_id: z.number().optional(), limite: z.number().optional() }, N.buscarInsumo, true);

  h('crear_proyecto', 'Crea un presupuesto nuevo y devuelve su proyecto_id.',
    { nombre: z.string(), entidad: z.string().optional(), ubicacion: z.string().optional(),
      moneda: z.enum(['Bs', '$US']).optional(), tipo_cambio: z.number().optional(),
      incidencias: INC.optional(),
      modulos: z.array(z.string()).optional().describe('Nombres de los módulos, en orden (ej. OBRAS PRELIMINARES, OBRA GRUESA)') },
    N.crearProyecto);

  h('agregar_modulo', 'Agrega un módulo al final del presupuesto.',
    { proyecto_id: z.string(), nombre: z.string() }, N.agregarModulo);

  h('agregar_items', 'Trae uno o varios APU del catálogo al presupuesto, con su cantidad. Devuelve el precio unitario y el parcial que calculó el motor.',
    { proyecto_id: z.string(),
      items: z.array(z.object({
        ref: z.string().describe('«base:seq» de buscar_apu'),
        cantidad: z.number().describe('Cantidad del cómputo métrico, en la unidad del APU'),
        modulo: z.union([z.number(), z.string()]).optional().describe('Número (1, 2…) o nombre del módulo; por omisión el último'),
        descripcion: z.string().optional().describe('Otra descripción para el ítem, si hace falta')
      })).min(1) },
    N.agregarItems);

  h('modificar_item', 'Cambia la cantidad o la descripción de un ítem, o lo quita.',
    { proyecto_id: z.string(), item_id: z.string(), cantidad: z.number().optional(),
      descripcion: z.string().optional(), quitar: z.boolean().optional() }, N.modificarItem);

  h('cambiar_precio_insumo', 'Cambia el precio de un insumo en ESTE proyecto (todos los ítems que lo usan). No toca la Base de Datos.',
    { proyecto_id: z.string(), descripcion: z.string().describe('Descripción exacta del insumo en el proyecto'),
      unidad: z.string().optional(), precio: z.number() }, N.cambiarPrecioInsumo);

  h('configurar_incidencias', 'Cambia las incidencias del B-2 del proyecto (cargas sociales, IVA, herramientas, gastos generales, utilidad, IT).',
    { proyecto_id: z.string(), incidencias: INC }, N.configurarIncidencias);

  h('ver_presupuesto', 'El B-1: módulos, ítems numerados, cantidades, precios unitarios, parciales, subtotales, total y avisos.',
    { proyecto_id: z.string() }, N.verPresupuesto, true);

  h('ver_analisis', 'El B-2 de un ítem del proyecto: insumos por grupo y la cadena de incidencias hasta el precio unitario.',
    { proyecto_id: z.string(), item_id: z.string() }, N.verAnalisis, true);

  h('listar_proyectos', 'Presupuestos guardados, con su total.', {}, () => N.listarProyectos(), true);
}
