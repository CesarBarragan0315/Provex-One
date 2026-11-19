
export const DIST_ORDER = ["LOL"];

export const DIST_CLASS_SUFFIX = {
  LOL: "lol",
};

const TERM_LABELS = {
  p1m: "1 Mes",
  p1y: "1 Año",
  p3y: "3 Años",
  onetime: "Pago único",
  "one time": "Pago único",
  anual: "1 Año",
  mensual: "1 Mes",
  trianual: "3 Años",
  trial: "Trial (Prueba)",
  nan: "-",
  "": "-",
};

const BILLING_LABELS = {
  monthly: "Facturación Mensual",
  annual: "Facturación Anual",
  triennial: "Facturación Trianual",
  onetime: "Pago único",
  "one time": "Pago único",
  anual: "Facturación Anual",
  mensual: "Facturación Mensual",
  trianual: "Facturación Trianual",
  trial: "Sin facturación (Trial)",
  nan: "-",
  "": "-",
};

const MAX_ROWS_PER_DIST = 100;
const MIN_PROFIT_PCT = 6;
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function showEmptyState(
  resultsArea,
  {
    icon = "&#128269;",
    title = "Sin resultados para esta búsqueda",
    message = "Prueba con otra palabra clave, código SKU o ajusta los filtros seleccionados.",
    showReset = true,
  } = {},
) {
  const quickSearches = [
    "Business Standard",
    "Business Premium",
    "Business Basic",
    "Copilot",
    "Windows Server 2025",
    "Office LTSC 2024",
    "Exchange Online",
  ];

  resultsArea.innerHTML = `
    <div class="empty-state">
      <div class="icon">${icon}</div>
      <h3 class="text-base font-bold text-slate-800 mb-1">${escHtml(title)}</h3>
      <p class="text-sm text-muted max-w-md mx-auto">${escHtml(message)}</p>
      
      ${
        showReset
          ? `<button type="button" class="empty-reset-btn" id="emptyResetFilters">
              <span>↻</span> Restablecer filtros y ver todo
            </button>`
          : ""
      }

      <div class="empty-quick-searches">
        <span class="text-xs text-muted w-full block mb-1">Búsquedas rápidas:</span>
        ${quickSearches
          .map(
            (term) =>
              `<button type="button" class="empty-quick-chip" data-quick-search="${escHtml(term)}">${escHtml(term)}</button>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

export function showLoadingState(resultsArea, message = "Buscando...") {
  resultsArea.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      ${escHtml(message)}
    </div>
  `;
}

export function renderTables({
  resultsArea,
  currentResults,
  activeDists,
  activeMobileDist,
  profitPct,
  qty,
  selectionCount = 0,
}) {
  const visibleDists = DIST_ORDER.filter((dist) => activeDists.has(dist));
  const visibleTotal = getVisibleTotal(currentResults, visibleDists);

  if (visibleTotal === 0) {
    showEmptyState(resultsArea, {
      icon: "&#128533;",
      title: "No encontramos productos con estos filtros",
      message: "Puedes limpiar los filtros o probar con una de las búsquedas sugeridas.",
      showReset: true,
    });
    return;
  }

  const bestByName = getBestByName(currentResults, visibleDists);
  const displayedTotal = visibleDists.reduce(
    (sum, dist) => sum + Math.min(currentResults[dist].length, MAX_ROWS_PER_DIST),
    0,
  );

  let html = buildSummaryStrip({
    currentResults,
    visibleDists,
    profitPct,
    qty,
    visibleTotal,
  });

  const resultsLabel =
    selectionCount > 0
      ? `Comparando ${selectionCount} producto${selectionCount === 1 ? "" : "s"} seleccionados`
      : "Mostrando resultados por mayorista";

  html += `
    <div class="results-header">
      <div class="results-count">
        ${resultsLabel} - <span>${displayedTotal.toLocaleString("es-CO")}</span> registros
      </div>
    </div>
    <div class="tables-grid">
  `;

  for (const dist of visibleDists) {
    html += buildDistributorCard({
      dist,
      products: currentResults[dist],
      bestByName,
      profitPct,
      qty,
    });
  }

  html += "</div>";
  resultsArea.innerHTML = html;
  
}

export function getPriceDisplay(price) {
  const safePrice = Number(price) || 0;
  return usdFormatter.format(safePrice);
}

function buildSummaryStrip({ currentResults, visibleDists, profitPct, qty, visibleTotal }) {
  const allPrices = [];
  const commercialPrices = [];

  visibleDists.forEach((dist) => {
    currentResults[dist].forEach((product) => {
      const price = Number(product.price) || 0;
      allPrices.push(price);
      if (product.type !== "TRIAL") {
        commercialPrices.push(price);
      }
    });
  });

  const targetPrices = commercialPrices.length ? commercialPrices : allPrices;
  if (!targetPrices.length) {
    return "";
  }

  const minPrice = Math.min(...targetPrices);
  const averagePrice = targetPrices.reduce((sum, value) => sum + value, 0) / targetPrices.length;
  const marginRatio = Math.min(0.99, profitPct / 100);
  const minimumSale = (minPrice / (1 - marginRatio)) * qty;

  return `
    <div class="summary-strip">
      <div class="summary-card">
        <div class="summary-label">Precio minimo</div>
        <div class="summary-val">${getPriceDisplay(minPrice)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Precio promedio</div>
        <div class="summary-val">${getPriceDisplay(averagePrice)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Venta minima (x${qty})</div>
        <div class="summary-val green">${getPriceDisplay(minimumSale)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Resultados visibles</div>
        <div class="summary-val">${visibleTotal.toLocaleString("es-CO")}</div>
      </div>
    </div>
  `;
}

function buildDistributorCard({ dist, products, bestByName, profitPct, qty }) {
  const shownProducts = products.slice(0, MAX_ROWS_PER_DIST);
  const badgeClass = `dist-badge-${DIST_CLASS_SUFFIX[dist]}`;

  let html = `
    <div class="dist-card" data-dist="${dist}">
      <div class="dist-header">
        <div class="dist-name">
          <div class="dist-badge ${badgeClass}"></div>
          ${escHtml(dist)}
        </div>
        <div class="dist-header-actions">
          <div class="dist-count">${products.length.toLocaleString("es-CO")} productos</div>
          ${
            shownProducts.length
              ? `<button type="button" class="copy-table-button" data-copy-dist="${dist}">
                  Copiar tabla
                </button>`
              : ""
          }
        </div>
      </div>
      <div class="dist-table-wrap">
  `;

  if (!products.length) {
    html += '<div class="dist-empty">Sin resultados para este mayorista</div>';
  } else {
    html += `
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Modalidad / Plazo</th>
            <th class="right">P. Unit.</th>
            <th class="right">Venta x${qty}</th>
            <th class="right">Ganancia</th>
          </tr>
        </thead>
        <tbody>
    `;

    shownProducts.forEach((product) => {
      const unitPrice = Number(product.price) || 0;
      const marginRatio = Math.min(0.99, profitPct / 100);
      const saleUnit = unitPrice / (1 - marginRatio);
      const saleTotal = saleUnit * qty;
      const costTotal = unitPrice * qty;
      const profit = saleTotal - costTotal;
      const productDisplayName = getComparableName(product);
      const comparisonKey = getComparisonKey(product);
      const { tagClass, label } = getTypeMeta(product.type);
      const isPerp = product.type === "PERPETUO" || product.strictPeriodKey === "onetime_onetime";
      const isTrial = product.type === "TRIAL";
      const isBestPrice = !isTrial && unitPrice === bestByName[comparisonKey];

      html += `
        <tr class="${isBestPrice ? "best-price" : ""}">
          <td class="td-name" data-label="Producto">
            <div class="prod-name">
              ${escHtml(String(productDisplayName || "").substring(0, 70))}
              ${isBestPrice ? '<span class="best-badge">Mejor</span>' : ""}
            </div>
            <div class="prod-seg">
              <span class="tag-pill ${tagClass}">${label}</span>
              ${escHtml(product.segment || "")}
            </div>
            ${
              product.partNumber
                ? `<div class="prod-part">P/N: ${escHtml(product.partNumber)}</div>`
                : ""
            }
          </td>
          <td data-label="Modalidad / Plazo">
            ${
              isPerp
                ? `<div class="flex flex-col gap-0.5">
                    <span class="term-text font-semibold text-purple-700">De por vida (Permanente)</span>
                    <span class="text-[11px] text-muted font-medium">Pago único · Sin vencimiento</span>
                  </div>`
                : isTrial
                ? `<div class="flex flex-col gap-0.5">
                    <span class="term-text font-semibold text-amber-700">Licencia Trial${product.term ? ` (${escHtml(product.term)})` : ""}</span>
                    <span class="text-[11px] text-muted font-medium">Evaluación · Sin facturación mensual</span>
                  </div>`
                : `<div class="flex flex-col gap-0.5">
                    <span class="term-text font-medium text-slate-800">${product.type === "NCE" ? "Compromiso " : "Suscripción "}${escHtml(formatTerm(product.normalizedTerm || product.term))}</span>
                    <span class="text-[11px] text-muted">${escHtml(formatBilling(product.normalizedBilling || product.billing))}</span>
                  </div>`
            }
          </td>
          <td class="td-right price-cell" data-label="P. Unit.">${getPriceDisplay(unitPrice)}</td>
          <td class="td-right price-cell sale-cell" data-label="Venta">${getPriceDisplay(saleTotal)}</td>
          <td class="td-right profit-cell ${profit >= 0 ? "profit-positive" : "profit-negative"}" data-label="Ganancia">${getPriceDisplay(profit)}</td>
        </tr>
      `;
    });

    html += "</tbody></table>";

    if (products.length > MAX_ROWS_PER_DIST) {
      html += `
        <div class="limit-note">
          Mostrando ${MAX_ROWS_PER_DIST} de ${products.length} - refina la busqueda para ver mas
        </div>
      `;
    }
  }

  html += "</div></div>";
  return html;
}

function getVisibleTotal(currentResults, visibleDists) {
  return visibleDists.reduce((sum, dist) => sum + currentResults[dist].length, 0);
}

export function buildDistributorCopyText({ dist, products, profitPct, qty }) {
  const shownProducts = products.slice(0, MAX_ROWS_PER_DIST);
  const safeQty = Math.max(1, Number(qty) || 1);
  const safeProfitPct = Math.max(MIN_PROFIT_PCT, Number(profitPct) || 0);
  const headers = ["No. Parte", "Descripcion", "Cant.", "Moneda", "Precio Uni.", "SubTotal"];

  const rows = shownProducts.map((product) => {
    const costUnit = Number(product.price) || 0;
    const marginRatio = Math.min(0.99, safeProfitPct / 100);
    const saleUnit = costUnit / (1 - marginRatio);
    const subtotal = saleUnit * safeQty;

    return [
      String(product.partNumber || "").trim(),
      getComparableName(product),
      String(safeQty),
      "USD",
      formatPlainNumber(saleUnit),
      formatPlainNumber(subtotal),
    ];
  });

  return [headers, ...rows].map((row) => row.map(toClipboardCell).join("\t")).join("\n");
}

function getBestByName(currentResults, visibleDists) {
  const bestByName = {};

  visibleDists.forEach((dist) => {
    currentResults[dist].forEach((product) => {
      if (product.type === "TRIAL") {
        return;
      }
      const productName = getComparisonKey(product);
      const unitPrice = Number(product.price) || 0;
      if (!bestByName[productName] || unitPrice < bestByName[productName]) {
        bestByName[productName] = unitPrice;
      }
    });
  });

  return bestByName;
}

function getComparableName(product) {
  return String(product.canonicalName || product.name || "").trim();
}

function getComparisonKey(product) {
  return String(product.comparisonKey || getComparableName(product)).trim();
}

function getTypeMeta(type) {
  if (type === "NCE") {
    return { tagClass: "tag-nce", label: "NCE" };
  }

  if (type === "TRIAL") {
    return { tagClass: "tag-trial", label: "TRIAL" };
  }

  if (type === "SUSCRIPCION") {
    return { tagClass: "tag-subs", label: "SOFTWARE SUBS" };
  }

  return { tagClass: "tag-perp", label: "PERPETUO" };
}

function formatTerm(term) {
  const normalized = String(term ?? "").trim();
  const key = normalized.toLowerCase();
  return TERM_LABELS[key] || normalized || "-";
}

function formatBilling(billing) {
  const normalized = String(billing ?? "").trim();
  const key = normalized.toLowerCase();
  return BILLING_LABELS[key] || normalized || "-";
}

function formatPlainNumber(value) {
  return (Number(value) || 0).toFixed(2);
}

function toClipboardCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
