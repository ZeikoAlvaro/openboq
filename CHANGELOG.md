# Versiones

Lo nuevo de cada versión de OpenBOQ, de la más reciente a la más antigua.
La versión en línea siempre es la de <https://openboq.pages.dev>.

---

## 2.6 · septiembre 2026

**Repositorio**
- El módulo de PRESCOM deja de distribuirse en el repositorio público; la aplicación funciona sin
  él y oculta esas opciones.

**Interfaz**
- **Modo simple de cuatro pasos** para quien nunca usó un programa de presupuestos: buscar ítems,
  armar el presupuesto, ver el detalle del precio e imprimir. Se cambia a la interfaz completa con
  el botón ⇄. La elección se recuerda en la cuenta.
- La numeración de ítems es corrida en todo el presupuesto, igual que en el B-1 impreso.

**Precios**
- Cada insumo guarda la **fecha del precio** cuando el usuario lo decide dentro de la aplicación.
- **Formatos de incidencias:** la cadena de recargos es un dato del proyecto. El formato oficial
  siempre está disponible y se pueden crear formatos propios.
- **Edición masiva:** matriz análisis × insumo, factor sobre rendimientos, fusión de análisis y
  creación de ítems en lote.
- Catálogo depurado a **15 bases de datos iniciales**.
- El catálogo se publica cifrado y comprimido; el sitio pesa casi la mitad.

## 2.5 · septiembre 2026

- **Proyectos en Google Drive:** con sesión de Google, los proyectos y las bases propias se guardan
  en la carpeta OpenBOQ del Drive del usuario. Ver [docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md).
- El permiso de Drive sobrevive a recargar la página.
- Aviso cuando se entra desde una dirección que no es la oficial.
- Política de privacidad propia.

## 2.2 · septiembre 2026

- Inicio de sesión **solo con Google**.
- **Aplicación de Windows** (Electron) para Windows 7 a 11, con actualizaciones automáticas.

## 2.1 · agosto 2026

- Importar de PRESCOM **cierra al centavo** también en proyectos de cientos de ítems.
- El B-3 muestra solo los insumos que se usan.
- **Comparar dos proyectos en Excel:** ítem contra ítem e insumo contra insumo.

## 2.0 · agosto 2026

- Interfaz nueva con barra lateral.
- Base de precios consolidada contra el índice del INE.
- Guardar es siempre una decisión del usuario: los cambios quedan «en prueba» hasta confirmarlos.

## 1.13 · agosto 2026

- Tema oscuro.
- Pantalla de inicio renovada.
- Comparar proyectos.

## 1.12 · agosto 2026

- El presupuesto importado de PRESCOM cierra en **0,00** contra el total del archivo. En proyectos
  importados manda el precio unitario del archivo, declarado en el B-2 como «redondeo del archivo
  de origen».

## 1.11 · agosto 2026

- Proyectos en la cuenta, con candado opcional por frase.
- Refuerzo de seguridad en las vistas de la base (`security_invoker`).

## 1.10 · agosto 2026

- **Exportar a PRESCOM:** el proyecto vuelve al formato de PRESCOM con el membrete y los rótulos del
  original.

## 1.9 · agosto 2026

- Base actualizada con la revista de precios (marzo–agosto 2026).

## 1.8 · agosto 2026

- **El catálogo se pone al día solo:** baja de Supabase únicamente lo que cambió.

## 1.6 y 1.7 · agosto 2026

- Curaduría de precios: corrección de precios en cero y red de respaldos de la base.

## 1.5 · julio 2026

- Pantalla de inicio.
- El B-3 como resumen: doble clic muestra dónde se usa cada insumo.

## 1.4 · julio 2026

- **Bases propias** del usuario, separadas de lo importado.

## 1.3 · julio 2026

- Cuentas, aportes anónimos de precios y reportes desde la aplicación.

## 1.2 · julio 2026

- Acceso libre: sin clave ni registro para usar la aplicación.
- Repositorio central de precios en Supabase.
