# OpenBOQ MCP

Servidor [MCP](https://modelcontextprotocol.io) para que una inteligencia artificial arme presupuestos de
obra (formularios B-1, B-2 y B-3) con OpenBOQ.

**La IA elige, el motor calcula.** La IA decide qué análisis, de qué base y en qué cantidad. Los precios
unitarios, parciales y totales los calcula `js/motor.js`, el mismo de la aplicación: el total que da el
MCP es el mismo que da OpenBOQ.

## Instalar

Necesita [Node.js](https://nodejs.org) 18 o más nuevo.

```
git clone https://github.com/ZeikoAlvaro/openboq.git
cd openboq/mcp
npm install --omit=dev
npm run armar
```

(O descargue el ZIP del repositorio desde *Code → Download ZIP*.) `npm run armar` arma
`generado/motor.mjs` con el código de la aplicación; se vuelve a correr cada vez que se actualiza OpenBOQ.

## Conectarlo

En la configuración de servidores MCP de su programa de IA, agregue:

```json
{
  "mcpServers": {
    "openboq": {
      "command": "node",
      "args": ["C:\\ruta\\a\\openboq\\mcp\\local.mjs"]
    }
  }
}
```

Sirve cualquier programa que acepte servidores MCP **locales** (por `stdio`), de escritorio o de consola.
Hay opciones gratuitas. Dentro de la aplicación, *HERRAMIENTAS → Importar presupuesto desde Excel →
Usar una IA (MCP)* muestra el paso a paso con ejemplos.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `catalogo_info` · `buscar_apu` · `ver_apu` · `buscar_insumo` | Consultar la Base de Datos |
| `crear_proyecto` · `agregar_modulo` · `agregar_items` · `modificar_item` | Armar el presupuesto |
| `cambiar_precio_insumo` · `configurar_incidencias` | Precios e incidencias del proyecto |
| `ver_presupuesto` · `ver_analisis` · `listar_proyectos` | B-1 y B-2 calculados por el motor |
| `importar_excel` | Convierte un presupuesto en Excel (B-1 + B-2, y B-3 si viene) en un proyecto, sin elegir nada; avisa los errores del archivo |
| `guardar_boq` · `exportar_ddp` · `abrir_boq` | Archivos `.boq` y formato PRESCOM (`.ddp`) |

Los proyectos se guardan como `.boq` en `Documentos\OpenBOQ-MCP` (o en `OPENBOQ_MCP_DIR`) y se abren en
OpenBOQ con *ARCHIVO → Abrir proyecto*.

## Cómo pedírselo

```
Con OpenBOQ, importá el presupuesto de la carpeta C:\Obras\MiObra (usá importar_excel).
Guardalo como C:\Obras\MiObra\MiObra.boq y exportalo a .ddp.
Antes de nada, decime los errores que encuentre en el Excel y no corrijas nada.
```

```
Con OpenBOQ y la base más reciente, armá el presupuesto de un muro de contención:
excavación 120 m3, hormigón ciclópeo 85 m3, relleno compactado 60 m3. Mostrame el B-1.
```

Las cantidades salen de sus cómputos métricos, no de la IA. Revise siempre lo que entrega.

## Probar

```
npm run probar
```
