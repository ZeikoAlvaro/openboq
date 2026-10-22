/* =========================================================================
   OpenBOQ MCP — arma generado/motor.mjs a partir del código de la aplicación
   -------------------------------------------------------------------------
   El MCP no tiene un motor propio: usa EXACTAMENTE los mismos archivos que
   la aplicación (js/motor.js, js/cifrado.js, js/exportador.js). Son scripts
   de navegador que declaran constantes globales; acá se pegan en un módulo
   ES que las exporta. Así el MCP local (Node) y el remoto (Cloudflare
   Worker, donde no existe `eval` ni `vm`) importan lo mismo.

   Si se toca el motor de la aplicación, se vuelve a correr esto
   (`npm run armar`) y el MCP calcula igual que la versión nueva.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const JS = path.join(AQUI, '..', 'js');
const ARCHIVOS = ['motor.js', 'cifrado.js', 'exportador.js', 'lector_excel.js', 'importar_excel.js'];

const partes = ARCHIVOS.map(f => {
  const src = fs.readFileSync(path.join(JS, f), 'utf8').replace(/^﻿/, '').replace(/^'use strict';\s*$/m, '');
  return `/* ---------- js/${f} ---------- */\n${src}\n`;
});

const salida =
  '/* GENERADO por mcp/armar_motor.mjs — no editar a mano. */\n' +
  partes.join('\n') +
  '\nexport { MOTOR, CIFRADO, EXPORTADOR, LECTOR_EXCEL, IMPORTAR_EXCEL };\n';

fs.mkdirSync(path.join(AQUI, 'generado'), { recursive: true });
fs.writeFileSync(path.join(AQUI, 'generado', 'motor.mjs'), salida, 'utf8');
console.log('generado/motor.mjs listo (' + Math.round(salida.length / 1024) + ' kB)');
