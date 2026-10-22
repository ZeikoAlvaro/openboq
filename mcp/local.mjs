#!/usr/bin/env node
/* =========================================================================
   OpenBOQ MCP — servidor LOCAL (stdio)
   -------------------------------------------------------------------------
   Corre en la máquina del usuario y lo lanza el programa de IA que acepte
   servidores MCP locales (de escritorio o de consola, o uno con un modelo
   propio). El catálogo no sale de la máquina.

   De dónde sale el catálogo, en orden:
     1. OPENBOQ_CATALOGO, si apunta a un archivo;
     2. ../data/catalogo.js (en claro, el de desarrollo);
     3. ../data/catalogo.obq.js (el cifrado que se publica), descifrado con
        la clave de la aplicación, igual que lo hace el navegador.

   Dónde guarda los proyectos: OPENBOQ_MCP_DIR, o «Documentos\OpenBOQ-MCP».
   Cada proyecto es un .boq común: se abre con OpenBOQ tal cual.

   Registro: en la configuración de servidores MCP del programa de IA, un
   servidor «openboq» con el comando  node "<ruta>\OpenBOQ\mcp\local.mjs"
   (ver README.md de esta carpeta).
   ========================================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MOTOR, CIFRADO, EXPORTADOR, IMPORTAR_EXCEL } from './generado/motor.mjs';
import { crearNucleo } from './nucleo.mjs';
import { registrar, INSTRUCCIONES } from './herramientas.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(AQUI, '..', 'data');

/* ------------------------------------------------------------ catálogo */
function valorDe(src, nombre) {
  const i = src.indexOf(nombre + '=');
  if (i < 0) throw new Error('el archivo no trae ' + nombre);
  return src.slice(i + nombre.length + 1).trim().replace(/;\s*$/, '');
}

export async function cargarCatalogo() {
  const pedido = process.env.OPENBOQ_CATALOGO;
  const claro = pedido && !pedido.endsWith('.obq.js') ? pedido : path.join(DATA, 'catalogo.js');
  if (fs.existsSync(claro)) return JSON.parse(valorDe(fs.readFileSync(claro, 'utf8'), 'window.OPENBOQ_DB'));

  const cifrado = pedido && pedido.endsWith('.obq.js') ? pedido : path.join(DATA, 'catalogo.obq.js');
  if (!fs.existsSync(cifrado)) return null;
  globalThis.window = globalThis.window || globalThis;
  window.OPENBOQ_CIFRADO = JSON.parse(valorDe(fs.readFileSync(cifrado, 'utf8'), 'window.OPENBOQ_CIFRADO'));
  return CIFRADO.abrirDeLaApp();
}

/* ------------------------------------------------------------ almacén en carpeta */
export function almacenCarpeta(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ruta = id => {
    if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new Error('proyecto_id inválido: ' + id);
    return path.join(dir, id + '.boq');
  };
  return {
    dir,
    leer: async id => { const r = ruta(id); return fs.existsSync(r) ? fs.readFileSync(r, 'utf8') : null; },
    escribir: async (id, t) => fs.writeFileSync(ruta(id), t, 'utf8'),
    listar: async () => fs.readdirSync(dir).filter(f => f.endsWith('.boq')).map(f => f.slice(0, -4))
      .filter(id => /^[a-z0-9-]{1,60}$/.test(id))
  };
}

/* ------------------------------------------------------------ servidor */
export async function crearServidor(opciones) {
  const o = opciones || {};
  const catalogo = o.catalogo !== undefined ? o.catalogo : await cargarCatalogo();
  const dir = o.dir || process.env.OPENBOQ_MCP_DIR || path.join(os.homedir(), 'Documents', 'OpenBOQ-MCP');
  const almacen = almacenCarpeta(dir);
  const N = crearNucleo({ MOTOR, catalogo, almacen, IMPORTAR_EXCEL });

  const server = new McpServer({ name: 'openboq', version: '0.1.0' }, { instructions: INSTRUCCIONES });
  registrar(server, N);

  /* lo propio del local: archivos en disco */
  const destino = (ruta, ext) => {
    const r = path.resolve(ruta);
    if (!r.toLowerCase().endsWith(ext)) throw new Error('La ruta tiene que terminar en ' + ext);
    return r;
  };
  const ok = v => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 1) }] });
  const mal = e => ({ isError: true, content: [{ type: 'text', text: 'Error: ' + (e && e.message || e) }] });

  server.registerTool('guardar_boq', {
    description: 'Guarda el proyecto como archivo .boq en la ruta indicada, para abrirlo en OpenBOQ (ARCHIVO → Abrir).',
    inputSchema: { proyecto_id: z.string(), ruta: z.string().describe('Ruta completa terminada en .boq') }
  }, async ({ proyecto_id, ruta }) => {
    try {
      const r = destino(ruta, '.boq');
      fs.writeFileSync(r, await N.textoBoq(proyecto_id), 'utf8');
      return ok({ guardado: r });
    } catch (e) { return mal(e); }
  });

  server.registerTool('exportar_ddp', {
    description: 'Exporta el proyecto al formato de PRESCOM (.ddp), con el mismo exportador de la aplicación.',
    inputSchema: { proyecto_id: z.string(), ruta: z.string().describe('Ruta completa terminada en .ddp') }
  }, async ({ proyecto_id, ruta }) => {
    try {
      const r = destino(ruta, '.ddp');
      const res = await N.conProyecto(proyecto_id, P => EXPORTADOR.ddp({ proyecto: P }));
      if (!res.datos) return mal(new Error(res.errores.join(' · ')));
      fs.writeFileSync(r, res.datos);
      return ok({ exportado: r, avisos: res.avisos });
    } catch (e) { return mal(e); }
  });

  server.registerTool('importar_excel', {
    description: 'Convierte un presupuesto en Excel (.xls o .xlsx) en un proyecto de OpenBOQ, SIN elegir nada: ' +
      'lee el presupuesto general (B-1), los análisis de precios unitarios (B-2) y, si vienen, los desgloses de ' +
      'insumos (B-3). Se le pasan TODOS los archivos de la obra juntos (pueden ser uno o varios libros) o la carpeta. ' +
      'Reconoce el Excel exportado por PRESCOM, el de hojas «Actividad:», el de una hoja por ítem (Formulario B-2) ' +
      'y el de secciones (A) a (G); si está en dólares lo pasa a bolivianos. Devuelve el proyecto y lo que el ' +
      'evaluador tiene que revisar: precios en Bs copiados como $US, análisis que no suman su total, ítems cuyo ' +
      'análisis no da el precio del archivo. Con «boq» y/o «ddp» deja los archivos escritos en una sola llamada. ' +
      'NO corrija nada por su cuenta: informe los avisos al usuario tal cual.',
    inputSchema: {
      rutas: z.array(z.string()).optional().describe('Rutas completas de los .xls/.xlsx de la obra'),
      carpeta: z.string().optional().describe('O una carpeta: se toman todos los .xls/.xlsx de adentro'),
      boq: z.string().optional().describe('Ruta .boq donde guardar el resultado (opcional)'),
      ddp: z.string().optional().describe('Ruta .ddp donde exportar a formato PRESCOM (opcional)')
    }
  }, async ({ rutas, carpeta, boq, ddp }) => {
    try {
      let lista = (rutas || []).map(r => path.resolve(r));
      if (carpeta) lista = lista.concat(fs.readdirSync(carpeta).filter(f => /\.xlsx?$/i.test(f) && !f.startsWith('~$'))
        .map(f => path.join(path.resolve(carpeta), f)));
      if (!lista.length) throw new Error('Indique «rutas» (los Excel de la obra) o «carpeta».');
      const archivos = lista.map(r => ({ nombre: path.basename(r), datos: new Uint8Array(fs.readFileSync(r)) }));
      const res = await N.importarExcel(archivos);
      if (boq) { const r = destino(boq, '.boq'); fs.writeFileSync(r, await N.textoBoq(res.proyecto_id), 'utf8'); res.boq = r; }
      if (ddp) {
        const r = destino(ddp, '.ddp');
        const e = await N.conProyecto(res.proyecto_id, P => EXPORTADOR.ddp({ proyecto: P }));
        if (!e.datos) res.ddp_error = e.errores.join(' · ');
        else { fs.writeFileSync(r, e.datos); res.ddp = r; res.ddp_avisos = e.avisos; }
      }
      return ok(res);
    } catch (e) { return mal(e); }
  });

  server.registerTool('abrir_boq', {
    description: 'Abre un archivo .boq existente (hecho en OpenBOQ o importado de PRESCOM) para seguir trabajándolo.',
    inputSchema: { ruta: z.string() }
  }, async ({ ruta }) => {
    try { return ok(await N.importarBoq(fs.readFileSync(destino(ruta, '.boq'), 'utf8'))); }
    catch (e) { return mal(e); }
  });

  return { server, N, almacen };
}

/* arranca solo si se lo llama directo (no cuando lo importa la prueba) */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await crearServidor();
  await server.connect(new StdioServerTransport());
}
