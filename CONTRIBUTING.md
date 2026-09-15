# Cómo aportar a OpenBOQ

Gracias por querer mejorar OpenBOQ. Hay varias formas de ayudar, y no todas requieren programar.

---

## 1. Reportar un error

- **Desde la aplicación:** AYUDA → «Reportar un error o una observación». Llega con la versión, la
  pestaña y el navegador, que ahorra preguntas.
- **En GitHub:** abrir un *issue* con:
  1. qué hiciste, paso a paso;
  2. qué esperabas que pasara;
  3. qué pasó (captura de pantalla si se puede);
  4. navegador y versión de OpenBOQ (aparece abajo a la izquierda).

**No adjuntes proyectos reales de una entidad** (ITCP, EDTP, presupuestos aprobados). Si el error
aparece solo con un archivo, descríbelo o arma un ejemplo mínimo con datos inventados.

## 2. Reportar un precio

Los precios de la base son de referencia y pueden estar desactualizados o mal cargados. Para
reportar uno, indicar:

- insumo o análisis, con su unidad;
- base de datos donde aparece;
- precio que muestra y precio que debería tener;
- **fuente y fecha** (revista de precios, cotización, índice del INE).

Sin fuente no se puede corregir: un precio de referencia necesita decir de dónde sale.

Los análisis que guardas en tus bases propias también aportan, de forma anónima, a la base común
(ver [docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md#qué-no-va-a-drive-y-qué-no-va-a-supabase)).

## 3. Proponer una mejora

Abrir un *issue* contando el problema que resuelve antes que la solución. Ejemplo: «al revisar un
presupuesto ajeno no encuentro qué ítems cambiaron» dice más que «agregar un botón de comparar».

---

## 4. Aportar código

### Preparar el entorno

```bash
git clone https://github.com/ZeikoAlvaro/openboq.git
cd openboq
npm install
npm run servir        # http://localhost:8731
npm test
```

### Reglas del proyecto

- **Sin dependencias en la aplicación.** Nada de frameworks ni librerías en `js/`. Las dependencias
  de `package.json` son solo para pruebas y herramientas.
- **Sin paso de compilación.** Lo que está en el repositorio es lo que corre.
- **`motor.js` es la única pieza que modifica el proyecto.** La interfaz lo llama; no toca el estado
  por su cuenta.
- **Nada se aplica sin confirmar.** Los cambios del usuario pasan por el sistema de «cambios en
  prueba» de `ui.js`.
- **El cálculo no redondea en el camino:** solo el precio unitario final. Si se toca la cadena de
  incidencias, las pruebas de importación al centavo tienen que seguir cerrando en 0,00.
- **Codificación UTF-8 sin BOM** en todos los archivos. `pruebas/codificacion.test.js` lo vigila.
  (Ojo en Windows: `Set-Content -Encoding UTF8` de PowerShell 5.1 agrega BOM.)
- **Versión de caché:** si tu cambio toca archivos que carga `index.html`, sube el `?v=N` en
  `index.html` y en `sw.js` a la vez. `pruebas/version.test.js` falla si no coinciden.
- Nombres, comentarios y textos de la interfaz en **español**.

### Pruebas

Cada cambio de comportamiento lleva su prueba en `pruebas/`, con el nombre de lo que cuida. Las
pruebas no usan framework: arman un DOM con `jsdom`, evalúan los scripts y terminan con
`process.exit(0)` o `process.exit(1)`. Toma cualquiera como plantilla.

Algunas pruebas necesitan archivos que no están en el repositorio:

| Archivo | Por qué no está | Qué pasa si falta |
|---|---|---|
| `data/catalogo.js` | catálogo de precios sin cifrar | se omiten las pruebas que lo cargan |
| `js/importador.js`, `js/exportador.js` | módulo de PRESCOM, no se distribuye | se omiten las pruebas que lo cargan; la aplicación arranca sin las opciones de PRESCOM |
| `pruebas/casos-reales.local.json` | lista de proyectos reales de PRESCOM | se omiten las comprobaciones con esos proyectos |
| PostgreSQL local | prueba del esquema y RLS de `supabase/` | `sql-supabase.test.js` se omite sola |

`npm test` muestra cuántas se omitieron. Lo importante es que **ninguna falle**.

### Enviar el cambio

1. Hacer un *fork* y una rama con nombre descriptivo (`arreglo-cronograma-predecesoras`).
2. Commits chicos, con mensajes que digan qué cambia y por qué.
3. `npm test` sin fallas.
4. Abrir el *pull request* explicando el problema, la solución y cómo probarlo.

### Supabase y Google

- `js/nube-config.js` apunta al proyecto público de OpenBOQ. Para probar cambios que escriben en la
  base, usa un proyecto de Supabase propio y aplica `supabase/*.sql` en orden.
- **Nunca** subas una clave `service_role`, un `.env` o un token. Van en archivos `*.local.*`, que
  `.gitignore` ya excluye.
- Si usas un `client_id` de Google propio, registra tus orígenes y el `/drive.html`
  (ver [docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md)).

---

## 5. Documentación

Correcciones y aclaraciones en `README.md` y `docs/` son tan bienvenidas como el código.

## Conducta

Trato respetuoso, críticas sobre el trabajo y no sobre las personas. Este es un proyecto hecho para
la comunidad de ingeniería y arquitectura de Bolivia: se asume buena fe.
