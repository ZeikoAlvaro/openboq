# OpenBOQ

**Presupuestos de obra en el navegador:** análisis de precios unitarios, cómputos métricos,
formularios B-1, B-2 y B-3, cronograma y curva S. Gratis, sin instalar y pensado para Bolivia.

**Probarlo:** <https://openboq.pages.dev>

> BOQ = *Bill of Quantities*, el presupuesto por ítems y cantidades.

---

## Qué hace

| Módulo | Qué se puede hacer |
|---|---|
| **Presupuesto** | Ítems por módulos con cantidad, precio unitario, parcial y desglose material / mano de obra / equipo. El total se recalcula solo. |
| **Base de datos** | Análisis de precios unitarios de referencia de 15 bases iniciales. Se busca el ítem, se ve su análisis, se trae al presupuesto y se edita sin restricciones. |
| **Análisis (B-2)** | Materiales, mano de obra y equipo, con la cadena de incidencias: cargas sociales, IVA de mano de obra, herramientas menores, gastos generales, utilidad e IT. |
| **Insumos (B-3)** | Precios elementales del proyecto. Cambiar un precio recalcula todos los ítems que lo usan; doble clic muestra dónde se usa. |
| **Cómputos** | Planilla de cómputos métricos que vuelca la cantidad al ítem. |
| **Cronograma** | Duraciones, predecesoras, diagrama de barras y curva S, desde el mismo presupuesto. |
| **Reportes** | B-1, B-2, B-3, requerimiento de insumos, cómputos, cronograma y resumen por módulos, para imprimir o guardar en PDF. |
| **Excel** | Libro `.xlsx` real, una hoja por reporte, sin librerías externas. |
| **PRESCOM** | Importa proyectos de PRESCOM y los exporta de vuelta en su formato, con el membrete y los rótulos del original. Disponible en <https://openboq.pages.dev>; el módulo no se distribuye en este repositorio. |
| **Nube** | Con sesión de Google, los proyectos se guardan en el Google Drive del propio usuario. Ver [docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md). |

Además: interfaz simple de cuatro pasos para quien nunca usó un programa de presupuestos, tema
oscuro, moneda Bs / $US, formatos de incidencias propios, edición masiva de rendimientos y
comparación de dos proyectos en Excel.

> **Los precios de la base son de referencia.** No son precios oficiales: se revisan y ajustan a
> cada proyecto, zona y fecha.

---

## Cómo funciona, en corto

OpenBOQ **no tiene servidor propio**. Es un sitio estático (HTML, CSS y JavaScript sin framework ni
paso de compilación) y todo el cálculo ocurre en el navegador. Una vez abierta, la aplicación sigue
calculando aunque se corte la conexión.

| Pieza | Para qué | Si no está |
|---|---|---|
| Navegador | cálculo, proyecto abierto, reportes, Excel, PRESCOM | — |
| Cloudflare Pages | entrega los archivos del sitio | no se puede abrir la aplicación |
| Supabase | inicio de sesión, puesta al día del catálogo, aportes anónimos de precios | la aplicación funciona con el catálogo que trae |
| Google Drive del usuario | guardar y recuperar proyectos en la nube | se trabaja con archivos `.boq` locales |

El detalle está en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

---

## Correrlo en tu equipo

Requisitos: Node.js 18 o superior y un navegador Chromium actualizado (Chrome o Edge).

```bash
git clone https://github.com/ZeikoAlvaro/openboq.git
cd openboq
npm install          # solo para pruebas y herramientas; la aplicación no usa dependencias
npm run servir       # http://localhost:8731
```

Hace falta servirlo por HTTP: abriendo `index.html` con doble clic, el service worker y parte de
la carga del catálogo no funcionan.

## Pruebas

```bash
npm test                     # todas
node herramientas/probar.js cronograma     # solo las que contengan «cronograma»
node herramientas/probar.js --detalle      # con la salida completa
```

Algunas pruebas necesitan archivos que no están en el repositorio (el catálogo sin cifrar o
proyectos reales de PRESCOM). Si faltan, se **omiten** con aviso en lugar de fallar. Ver
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## Estructura

```
openboq/
├── index.html              la aplicación
├── drive.html              página de vuelta del permiso de Google Drive
├── privacidad.html         política de privacidad
├── sw.js  manifest.webmanifest   instalable como aplicación (PWA)
├── css/                    estilos (estilo.css, ui2.css)
├── js/
│   ├── motor.js            cálculo y estado del proyecto
│   ├── ui.js  ui2.js       interfaz
│   ├── importador.js       PRESCOM: importar  (no incluido en este repositorio)
│   ├── exportador.js       PRESCOM: exportar  (no incluido en este repositorio)
│   ├── reportes.js         formularios imprimibles
│   ├── xlsx.js             generador de .xlsx
│   ├── nube.js             sesión, aportes y reportes (Supabase)
│   ├── nube-config.js      direcciones públicas de Supabase y Google
│   ├── drive.js            guardar y abrir proyectos en Google Drive
│   ├── sync.js             puesta al día del catálogo
│   ├── cifrado.js          apertura del catálogo publicado
│   └── acceso.js           indicador de conexión
├── data/catalogo.obq.js    catálogo de precios de referencia (cifrado)
├── ejemplos/               proyecto de demostración ficticio
├── supabase/               esquema SQL, políticas RLS y funciones
├── escritorio/             aplicación de Windows (Electron)
├── herramientas/           servidor local, pruebas, empaquetado, diagnóstico
├── pruebas/                pruebas automáticas (jsdom)
└── docs/                   documentación técnica
```

Qué hace cada pieza y cómo se conectan: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

---

## Aportar

Reportes de errores, precios mal cargados, mejoras de código y documentación son bienvenidos.
Cómo hacerlo: [CONTRIBUTING.md](CONTRIBUTING.md).

Dentro de la aplicación también se puede reportar desde **AYUDA → Reportar un error o una
observación**.

## Versiones

Lo nuevo de cada versión está en [CHANGELOG.md](CHANGELOG.md).

## Licencia

MIT, ver [LICENSE](LICENSE). La licencia cubre el código. Los precios de referencia provienen de
bases de terceros y de aportes de usuarios, y se entregan sin garantía.

PRESCOM es marca de sus respectivos titulares. OpenBOQ es un proyecto independiente y no está
afiliado a ellos.
