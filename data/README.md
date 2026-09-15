# Catálogo de precios

| Archivo | Qué es | En el repositorio |
|---|---|---|
| `catalogo.obq.js` | el catálogo publicado, comprimido y cifrado (AES-256-GCM). Lo abre `js/cifrado.js`. | sí |
| `catalogo.js` | el mismo catálogo sin cifrar, que se usa en desarrollo si está presente | no |

Si `catalogo.js` existe, `index.html` lo usa directamente. Si no, abre `catalogo.obq.js`. Si
ninguno está, la aplicación arranca igual y se trabaja con bases propias o proyectos importados.

Los precios son **de referencia**: provienen de bases de terceros, de la revista de precios y de
aportes de usuarios, con curaduría manual. No son precios oficiales.

## Generar un catálogo propio desde CSV

```bash
python herramientas/generar_catalogo.py
```

El script lee dos CSV (insumos y componentes de cada análisis) y escribe `data/catalogo.js`.

**Catálogo:** un registro por insumo o análisis:

```
Fuente, Archivo DAT, Secuencia, Puntero o Codigo, Tipo, Categoria,
Tipo Descripcion, Descripcion, Unidad, Precio Detectado, Valor NBD, Es APU
```

`Tipo`: `M` material · `O` mano de obra · `E` equipo · `I` análisis.

**Componentes:** un registro por insumo dentro de cada análisis:

```
Fuente, Archivo DAT, APU Codigo, APU Puntero DAT, Nombre APU, Unidad APU,
Slot, Categoria, Insumo Codigo, Insumo Tipo, Insumo, Unidad Insumo,
Cantidad/Rendimiento
```

El script usa `Fuente`, `APU Codigo`, `Insumo Codigo`, `Slot` y `Cantidad/Rendimiento`; las demás
columnas son informativas.
