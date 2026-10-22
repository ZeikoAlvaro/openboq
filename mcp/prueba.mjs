/* =========================================================================
   OpenBOQ MCP — prueba de punta a punta
   -------------------------------------------------------------------------
   Un cliente MCP de verdad (por el protocolo, en memoria) arma un
   presupuesto con el MCP local y se comprueba:
     · que el total que devuelve es el mismo que da el motor usado directo,
       como lo usa la aplicación;
     · que el .boq guardado se vuelve a abrir con el mismo total;
     · que el .ddp sale con forma de .ddp (un zip);
     · que los errores vuelven como error y no rompen el servidor.
   ========================================================================= */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { crearServidor, cargarCatalogo } from './local.mjs';
import { MOTOR } from './generado/motor.mjs';

const errores = [];
const ok = (c, m) => console.log((c ? '  ✓ ' : '  ✗ ') + m) || (c ? 0 : errores.push(m));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openboq-mcp-'));
const catalogo = await cargarCatalogo();
const { server } = await crearServidor({ dir, catalogo });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const cli = new Client({ name: 'prueba', version: '1' });
await cli.connect(b);

const llamar = async (name, args) => {
  const r = await cli.callTool({ name, arguments: args || {} });
  const t = r.content[0].text;
  return r.isError ? { error: t } : JSON.parse(t);
};

const lista = await cli.listTools();
ok(lista.tools.length >= 15, 'el servidor ofrece ' + lista.tools.length + ' herramientas');

const info = await llamar('catalogo_info');
ok(info.bases.length > 0, 'catálogo con ' + info.bases.length + ' bases, generado ' + info.generado_en);

const exc = await llamar('buscar_apu', { texto: 'excavacion', limite: 5 });
const hor = await llamar('buscar_apu', { texto: 'hormigon zapata', limite: 5 });
ok(exc.length > 0 && hor.length > 0, `buscar_apu encuentra excavación (${exc.length}) y hormigón de zapatas (${hor.length})`);

const apu = await llamar('ver_apu', { ref: hor[0].ref });
ok(apu.componentes.length > 0 && apu.costo_directo > 0, `ver_apu: ${apu.descripcion} · ${apu.componentes.length} insumos · CD ${apu.costo_directo}`);

const p = await llamar('crear_proyecto', {
  nombre: 'Prueba MCP — aula', entidad: 'GAD Oruro', modulos: ['OBRAS PRELIMINARES', 'OBRA GRUESA']
});
ok(!!p.proyecto_id && p.modulos.length === 2, 'crear_proyecto: ' + p.proyecto_id);

const ag = await llamar('agregar_items', { proyecto_id: p.proyecto_id, items: [
  { ref: exc[0].ref, cantidad: 125.5, modulo: 1 },
  { ref: hor[0].ref, cantidad: 18.75, modulo: 'OBRA GRUESA' },
  { ref: '999:1', cantidad: 1 }
] });
ok(ag.agregados.length === 2, 'agregar_items agrega los dos buenos');
ok(ag.errores.length === 1 && /No existe la base/.test(ag.errores[0]), 'y avisa el malo sin cortar: ' + ag.errores[0]);

const b1 = await llamar('ver_presupuesto', { proyecto_id: p.proyecto_id });
ok(b1.items === 2 && b1.modulos[1].items[0].numero === 2, 'B-1 con numeración corrida (el primero de OBRA GRUESA es el 2)');

/* el mismo presupuesto armado con el motor directo, como la aplicación */
MOTOR.cargarCatalogo(catalogo);
MOTOR.proyectoNuevo('directo');
const P = MOTOR.proyecto();
P.modulos.push({ id: MOTOR.nid(), n: 'OBRA GRUESA', items: [] });
const ref = r => { const [bid, seq] = r.split(':'); const bb = MOTOR.BD.bases.find(x => x.id === +bid); return [bb, bb.apus.find(x => String(x.seq) === seq)]; };
P.moduloActivo = 0; MOTOR.importarApu(...ref(exc[0].ref), 125.5);
P.moduloActivo = 1; MOTOR.importarApu(...ref(hor[0].ref), 18.75);
const directo = MOTOR.totalGeneral();
ok(b1.total === directo, `el total del MCP (${b1.total}) es el del motor directo (${directo})`);

const it2 = b1.modulos[1].items[0];
const mod = await llamar('modificar_item', { proyecto_id: p.proyecto_id, item_id: it2.item_id, cantidad: 20 });
ok(mod.item.parcial === Math.round(it2.precio_unitario * 20 * 100) / 100, 'modificar_item: parcial = P.U. × 20');

const b2 = await llamar('ver_analisis', { proyecto_id: p.proyecto_id, item_id: it2.item_id });
ok(b2.cadena.length > 0 && b2.precio_unitario === it2.precio_unitario, `ver_analisis: B-2 con ${b2.cadena.length} filas y el mismo P.U.`);

const inc = await llamar('configurar_incidencias', { proyecto_id: p.proyecto_id, incidencias: { util: 10 } });
const b1b = await llamar('ver_presupuesto', { proyecto_id: p.proyecto_id });
ok(inc.incidencias.util === 10 && b1b.total > mod.total, `con utilidad 10 % el total sube: ${mod.total} → ${b1b.total}`);

const fuera = fs.mkdtempSync(path.join(os.tmpdir(), 'openboq-salida-'));
const boq = path.join(fuera, 'salida.boq');
await llamar('guardar_boq', { proyecto_id: p.proyecto_id, ruta: boq });
MOTOR.deserializar(fs.readFileSync(boq, 'utf8'));
ok(MOTOR.totalGeneral() === b1b.total, 'el .boq guardado se abre con el mismo total');

const ddp = path.join(fuera, 'salida.ddp');
const ex = await llamar('exportar_ddp', { proyecto_id: p.proyecto_id, ruta: ddp });
const cab = fs.existsSync(ddp) ? fs.readFileSync(ddp).subarray(0, 2).toString('latin1') : '';
ok(cab === 'PK', 'exportar_ddp escribe el contenedor de PRESCOM' + (ex.error ? ' — ' + ex.error : ''));

const mal = await llamar('guardar_boq', { proyecto_id: p.proyecto_id, ruta: path.join(dir, 'x.exe') });
ok(!!mal.error, 'no escribe nada que no termine en .boq');
const nadie = await llamar('ver_presupuesto', { proyecto_id: '../../etc' });
ok(!!nadie.error, 'un proyecto_id con ruta se rechaza');

const lp = await llamar('listar_proyectos');
ok(lp.length === 1 && lp[0].total === b1b.total, 'listar_proyectos lo muestra con su total');

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(fuera, { recursive: true, force: true });
console.log('\n' + (errores.length ? 'PROBLEMAS:\n - ' + errores.join('\n - ') : 'SIN ERRORES'));
process.exit(errores.length ? 1 : 0);
