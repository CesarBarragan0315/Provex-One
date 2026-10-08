- **Base de datos:** `products.json` estatico
- **Hosting sugerido:** GitHub Pages, Netlify, Vercel o servidor local

---

## Estructura del proyecto

```text
.
├── index.html          <- solo estructura HTML
├── css/
│   └── styles.css      <- todos los estilos
├── js/
│   ├── search.js       <- busqueda, filtros y estado UI
│   ├── tables.js       <- render de tablas y helpers visuales
│   └── trm.js          <- carga automatica de TRM
├── products.json       <- base de datos de productos
├── extract_data.py     <- script para regenerar products.json
├── README.md
└── .gitignore
```

---

## Funcionalidades

- Busqueda por nombre de producto
- Filtros por tipo, segmento y periodo
- Tabla por mayorista con comparacion lado a lado
- Indicador de mejor precio entre mayoristas
- Configuracion de rentabilidad, cantidad y moneda
- Conversion USD a COP con TRM ajustable
- Vista responsive para movil y desktop
- Calculadora Acronis por solucion o por servicio
- Siete niveles de compromiso mensual y precios por grupo de datacenter
- Aplicacion automatica del consumo minimo, rentabilidad, TRM y estimado anual
- Busqueda de conceptos Acronis y copia de la cotizacion

---

## Setup local

```bash
# Python
python -m http.server 8080

# Luego abre
http://localhost:8080
```

Tambien puedes usar Live Server en VS Code o cualquier servidor HTTP estatico.

---

## Actualizar datos

Cuando recibas nuevas listas de precios en Excel:

```bash
# 1. Reemplaza los archivos Excel en data/

# 2. Regenera el JSON
python extract_data.py

# 3. Guarda y publica cambios
git add products.json
git commit -m "Update: listas de precios"
git push
```

Para actualizar solamente la calculadora Acronis, coloca en la raiz el archivo con nombre `Calculadora Acronis*.xlsx` y ejecuta:

```bash
python -m extractors.acronis
```

Se utilizara automaticamente el archivo Acronis mas reciente y se regenerara `catalogs/acronis_products.json`.

---

## Personalizacion

### Cambiar rentabilidad por defecto

Busca en `index.html`:

```html
<input type="number" id="profitPct" class="profit-input" value="6" min="6" max="999">
```

### Cambiar la TRM por defecto

Busca en `index.html`:

```html
<input type="number" id="trmInput" class="profit-input wide-input" value="4200">
```

### Agregar un nuevo mayorista

1. En `extract_data.py`, agrega la lectura del nuevo Excel.
2. Asegurate de que cada producto tenga `distributor: "NUEVO_MAYORISTA"`.
3. Agrega el nuevo chip y tab en `index.html`.
4. Agrega el color del nuevo mayorista en `css/styles.css`.
5. Registra el mayorista en `js/tables.js` y `js/search.js`.

---

## Estructura de products.json

```json
[
  {
    "distributor": "LOL",
    "type": "NCE",
    "partNumber": "CFQ7TTC...",
    "name": "Microsoft 365 Business Basic",
    "term": "P1Y",
    "billing": "Annual",
    "price": 6.0,
    "erp": 8.0,
    "segment": "Commercial"
  }
]
```
## PROVEXONE VERSION FINAL
