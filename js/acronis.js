import { fetchTRM } from "./trm.js";

const CATALOG_PATH = "catalogs/acronis_products.json";
const MIN_PROFIT_PCT = 20;
const ALLOWED_CATEGORIES = {
  solution: new Set(["Security + RMM", "Backup + DR", "Ultimate Protection"]),
  service: new Set(["Endpoint Security", "RMM", "Backup"]),
};
const usdUnitFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const usdTotalFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const state = {
  data: null,
  mode: "solution",
  tierIndex: 3,
  dcGroup: "G1",
  datacenterLabel: "",
  quantities: new Map(),
  openCategories: new Set(),
  search: "",
};

const elements = {
  workspaceTabs: Array.from(document.querySelectorAll("[data-workspace]")),
  cloudView: document.getElementById("cloudView"),
  acronisView: document.getElementById("acronisView"),
  commitment: document.getElementById("acronisCommitment"),
  datacenter: document.getElementById("acronisDatacenter"),
  profit: document.getElementById("acronisProfit"),
  trm: document.getElementById("acronisTrm"),
  trmStatus: document.getElementById("acronisTrmStatus"),
  priceList: document.getElementById("acronisPriceList"),
  modeTabs: Array.from(document.querySelectorAll("[data-acronis-mode]")),
  solutionCount: document.getElementById("acronisSolutionCount"),
  serviceCount: document.getElementById("acronisServiceCount"),
  search: document.getElementById("acronisSearch"),
  catalog: document.getElementById("acronisCatalog"),
  selectedCount: document.getElementById("acronisSelectedCount"),
  selectedItems: document.getElementById("acronisSelectedItems"),
  usageUsd: document.getElementById("acronisUsageUsd"),
  minimumUsd: document.getElementById("acronisMinimumUsd"),
  commitmentNotice: document.getElementById("acronisCommitmentNotice"),
  billedUsd: document.getElementById("acronisBilledUsd"),
  saleUsd: document.getElementById("acronisSaleUsd"),
  saleCop: document.getElementById("acronisSaleCop"),
  annualUsd: document.getElementById("acronisAnnualUsd"),
  reset: document.getElementById("acronisReset"),
  copy: document.getElementById("acronisCopy"),
  mobileBar: document.getElementById("acronisMobileBar"),
  mobileCount: document.getElementById("acronisMobileCount"),
  mobileTotal: document.getElementById("acronisMobileTotal"),
  mobileJumpBtn: document.getElementById("acronisMobileJumpBtn"),
};

initialize();

async function initialize() {
  bindEvents();
  const initialHash = window.location.hash.replace("#", "");
  const defaultWs = ["acronis", "kaspersky"].includes(initialHash) ? initialHash : "cloud";
  activateWorkspace(defaultWs, false);
  enforceProfit({ force: true });

  fetchTRM({
    statusEl: elements.trmStatus,
    inputEl: elements.trm,
    onUpdated: updateSummary,
  });

  try {
    if (window.__CUSTOM_ACRONIS) {
      state.data = window.__CUSTOM_ACRONIS;
    } else {
      const response = await fetch(CATALOG_PATH);
      if (!response.ok) {
        throw new Error(`Acronis catalog request failed with status ${response.status}`);
      }
      state.data = await response.json();
    }
    populateControls();
    ensureOpenCategory();
    renderCatalog();
    updateSummary();
  } catch (error) {
    console.error("Acronis calculator init error", error);
    elements.catalog.innerHTML = `
      <div class="empty-state empty-state-panel">
        <div class="icon">!</div>
        <h3>No pudimos cargar la calculadora</h3>
        <p>Revisa ${escapeHtml(CATALOG_PATH)} e intenta de nuevo.</p>
      </div>
    `;
  }
}

function bindEvents() {
  window.addEventListener("provex:update-acronis", (e) => {
    if (e.detail && (e.detail.solution || e.detail.service)) {
      state.data = e.detail;
      populateControls();
      ensureOpenCategory();
      renderCatalog();
      updateSummary();
    }
  });

  elements.workspaceTabs.forEach((tab) => {
    tab.addEventListener("click", () => activateWorkspace(tab.dataset.workspace));
  });

  elements.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.mode = tab.dataset.acronisMode;
      elements.modeTabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      });
      ensureOpenCategory();
      renderCatalog();
    });
  });

  elements.commitment.addEventListener("change", () => {
    state.tierIndex = Number(elements.commitment.value) || 0;
    renderCatalog();
    updateSummary();
  });

  elements.datacenter.addEventListener("change", () => {
    const option = elements.datacenter.selectedOptions[0];
    state.dcGroup = option?.dataset.group || "G1";
    state.datacenterLabel = option?.textContent || "";
    renderCatalog();
    updateSummary();
  });

  elements.profit.addEventListener("focus", () => {
    elements.profit.select();
  });
  elements.profit.addEventListener("input", () => {
    updateSummary();
  });
  elements.profit.addEventListener("blur", () => {
    enforceProfit({ force: true });
    updateSummary();
  });

  elements.search.addEventListener("input", () => {
    state.search = normalizeText(elements.search.value);
    renderCatalog();
  });

  elements.catalog.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-acronis-category]");
    if (!toggle) {
      return;
    }
    const category = toggle.dataset.acronisCategory;
    const wrapper = toggle.closest(".acronis-category");
    const shouldOpen = !wrapper.classList.contains("open");
    wrapper.classList.toggle("open", shouldOpen);
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      state.openCategories.add(category);
    } else {
      state.openCategories.delete(category);
    }
  });

  elements.catalog.addEventListener("input", (event) => {
    if (!event.target.matches("[data-acronis-quantity]")) {
      return;
    }
    const quantity = Math.max(0, Number(event.target.value) || 0);
    state.quantities.set(event.target.dataset.acronisQuantity, quantity);
    updateVisibleCalculations();
    updateSummary();
  });

  elements.reset.addEventListener("click", resetQuantities);
  elements.copy.addEventListener("click", copyQuote);
  elements.mobileJumpBtn?.addEventListener("click", () => {
    document.querySelector(".acronis-summary")?.scrollIntoView({ behavior: "smooth" });
  });
}

function activateWorkspace(workspace, updateHash = true) {
  const cloudView = document.getElementById("cloudView");
  const acronisView = document.getElementById("acronisView");
  const kasperskyView = document.getElementById("kasperskyView");

  if (cloudView) cloudView.hidden = workspace !== "cloud";
  if (acronisView) acronisView.hidden = workspace !== "acronis";
  if (kasperskyView) kasperskyView.hidden = workspace !== "kaspersky";

  const allTabs = Array.from(document.querySelectorAll("[data-workspace]"));
  allTabs.forEach((tab) => {
    const active = tab.dataset.workspace === workspace;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  if (updateHash) {
    const nextUrl = workspace !== "cloud"
      ? `${window.location.pathname}${window.location.search}#${workspace}`
      : `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", nextUrl);
  }
}

function populateControls() {
  elements.priceList.textContent = state.data.priceList || "Actual";
  elements.solutionCount.textContent = getFilteredItems("solution").length.toLocaleString("es-CO");
  elements.serviceCount.textContent = getFilteredItems("service").length.toLocaleString("es-CO");

  const targetIndex = state.data.commitments.indexOf(4000);
  state.tierIndex = targetIndex >= 0 ? targetIndex : 3;

  if (elements.commitment) {
    elements.commitment.value = `${formatUsdTotal(4000)} / mes`;
  }

  elements.datacenter.innerHTML = ["G1", "G2"]
    .map((group) => {
      const options = (state.data.datacenters[group] || [])
        .map(
          (datacenter, index) =>
            `<option value="${group}-${index}" data-group="${group}">${escapeHtml(datacenter.label)}</option>`,
        )
        .join("");
      return `<optgroup label="Grupo ${group}">${options}</optgroup>`;
    })
    .join("");

  const selectedOption = elements.datacenter.selectedOptions[0];
  state.dcGroup = selectedOption?.dataset.group || "G1";
  state.datacenterLabel = selectedOption?.textContent || "Grupo G1";
}

function ensureOpenCategory() {
  const firstCategory = getCurrentItems()[0]?.category;
  if (firstCategory && !Array.from(state.openCategories).some((key) => key.startsWith(`${state.mode}:`))) {
    state.openCategories.add(`${state.mode}:${firstCategory}`);
  }
}

function renderCatalog() {
  if (!state.data) {
    return;
  }

  const items = getCurrentItems().filter(matchesSearch);
  const categories = groupByCategory(items);
  if (!categories.length) {
    elements.catalog.innerHTML = `
      <div class="empty-state empty-state-panel">
        <div class="icon">⌕</div>
        <h3>Sin coincidencias</h3>
        <p>Prueba con otro nombre, SKU o categoría.</p>
      </div>
    `;
    return;
  }

  elements.catalog.innerHTML = categories
    .map(({ name, items: categoryItems }, categoryIndex) => {
      const categoryKey = `${state.mode}:${name}`;
      const open = state.search || state.openCategories.has(categoryKey);
      const total = categoryItems.reduce((sum, item) => sum + lineTotal(item), 0);
      let lastSubcategory = null;
      const rows = categoryItems
        .map((item) => {
          const subcategory = item.subcategory || "";
          const subcategoryHtml =
            subcategory && subcategory !== lastSubcategory
              ? `<div class="acronis-subcategory">${escapeHtml(subcategory)}</div>`
              : "";
          lastSubcategory = subcategory;
          return subcategoryHtml + renderProductRow(item);
        })
        .join("");

      return `
        <article class="acronis-category ${open ? "open" : ""} ${total > 0 ? "has-value" : ""}" data-category-card="${escapeAttribute(categoryKey)}">
          <button type="button" class="acronis-category-toggle" data-acronis-category="${escapeAttribute(categoryKey)}" aria-expanded="${open}">
            <span class="acronis-category-title">
              <span class="acronis-chevron" aria-hidden="true">▶</span>
              <span>
                <strong>${escapeHtml(name)}</strong>
                <small>${categoryItems.length.toLocaleString("es-CO")} conceptos</small>
              </span>
            </span>
            <span class="acronis-category-total" data-category-total="${escapeAttribute(categoryKey)}">${formatUsdTotal(total)}</span>
          </button>
          <div class="acronis-category-body">
            <div class="acronis-column-heads">
              <span>Concepto</span><span>Cantidad</span><span>Precio/u</span><span>Total</span>
            </div>
            ${rows}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProductRow(item) {
  const price = unitPrice(item);
  const quantity = getQuantity(item.id);
  const unavailable = price === null;
  const sku = item.skus.All || item.skus[state.dcGroup] || "";
  const note = formatNote(item.note);
  const total = unavailable ? 0 : price * quantity;

  return `
    <div class="acronis-product-row ${quantity > 0 && !unavailable ? "active" : ""} ${unavailable ? "unavailable" : ""}" data-acronis-row="${escapeAttribute(item.id)}">
      <div class="acronis-product-name">
        <strong>${escapeHtml(displayDescription(item.description))}</strong>
        <div class="acronis-product-meta">
          ${sku ? `<span>SKU ${escapeHtml(sku)}</span>` : ""}
          ${note ? `<span class="acronis-product-note">${escapeHtml(note)}</span>` : ""}
        </div>
        ${unavailable ? `<span class="acronis-unavailable">No disponible en ${escapeHtml(state.dcGroup)}</span>` : ""}
      </div>
      <input type="number" min="0" step="1" inputmode="numeric" class="acronis-quantity"
             value="${quantity || 0}" data-acronis-quantity="${escapeAttribute(item.id)}"
             aria-label="Cantidad para ${escapeAttribute(displayDescription(item.description))}" ${unavailable ? "disabled" : ""}>
      <div class="acronis-unit-price" data-unit-price>${unavailable ? "—" : formatUsdUnit(price)}</div>
      <div class="acronis-line-total" data-line-total>${unavailable ? "—" : formatUsdTotal(total)}</div>
    </div>
  `;
}

function updateVisibleCalculations() {
  elements.catalog.querySelectorAll("[data-acronis-row]").forEach((row) => {
    const item = findItem(row.dataset.acronisRow);
    const price = unitPrice(item);
    const quantity = getQuantity(item.id);
    const total = price === null ? 0 : price * quantity;
    row.classList.toggle("active", quantity > 0 && price !== null);
    const unitPriceEl = row.querySelector("[data-unit-price]");
    if (unitPriceEl) {
      unitPriceEl.textContent = price === null ? "—" : formatUsdUnit(price);
    }
    const lineTotalEl = row.querySelector("[data-line-total]");
    if (lineTotalEl) {
      lineTotalEl.textContent = price === null ? "—" : formatUsdTotal(total);
    }
  });

  elements.catalog.querySelectorAll("[data-category-card]").forEach((card) => {
    const total = Array.from(card.querySelectorAll("[data-acronis-row]")).reduce((sum, row) => {
      const item = findItem(row.dataset.acronisRow);
      return sum + lineTotal(item);
    }, 0);
    card.classList.toggle("has-value", total > 0);
    const catTotalEl = card.querySelector("[data-category-total]");
    if (catTotalEl) {
      catTotalEl.textContent = formatUsdTotal(total);
    }
  });
}

function updateSummary() {
  if (!state.data) {
    return;
  }

  const entries = getAllItems()
    .map((item) => ({ item, quantity: getQuantity(item.id), price: unitPrice(item) }))
    .filter((entry) => entry.quantity > 0);
  const availableEntries = entries.filter((entry) => entry.price !== null);
  const unavailableCount = entries.length - availableEntries.length;
  const usage = availableEntries.reduce(
    (sum, entry) => sum + entry.quantity * entry.price,
    0,
  );
  const commitment = Number(state.data.commitments[state.tierIndex]) || 0;
  const billed = Math.max(usage, commitment);
  const profit = getProfit();
  const marginRatio = Math.min(0.99, profit / 100);
  const sale = billed / (1 - marginRatio);
  const trm = parseTrm(elements.trm.value);

  elements.selectedCount.textContent = `${entries.length.toLocaleString("es-CO")} seleccionados`;
  elements.usageUsd.textContent = formatUsdTotal(usage);
  elements.minimumUsd.textContent = formatUsdTotal(commitment);
  elements.billedUsd.textContent = formatUsdTotal(billed);
  elements.saleUsd.textContent = formatUsdTotal(sale);
  elements.saleCop.textContent = trm ? copFormatter.format(sale * trm) : "TRM no disponible";
  elements.annualUsd.textContent = formatUsdTotal(sale * 12);
  elements.copy.disabled = availableEntries.length === 0;

  if (elements.mobileBar) {
    elements.mobileBar.hidden = entries.length === 0;
    if (elements.mobileCount) {
      elements.mobileCount.textContent = `${entries.length.toLocaleString("es-CO")} ${entries.length === 1 ? "seleccionado" : "seleccionados"}`;
    }
    if (elements.mobileTotal) {
      elements.mobileTotal.textContent = `${formatUsdTotal(sale)} / mes`;
    }
  }

  elements.commitmentNotice.classList.toggle("is-covered", usage >= commitment);
  if (usage < commitment) {
    const gap = commitment - usage;
    elements.commitmentNotice.textContent = `El consumo está ${formatUsdTotal(gap)} por debajo del compromiso. Acronis facturará el mínimo mensual seleccionado.`;
  } else {
    elements.commitmentNotice.textContent = `El consumo supera el compromiso mínimo en ${formatUsdTotal(usage - commitment)}.`;
  }
  if (unavailableCount > 0) {
    elements.commitmentNotice.textContent += ` ${unavailableCount} concepto(s) seleccionado(s) no están disponibles en ${state.dcGroup} y no se sumaron.`;
  }

  elements.selectedItems.innerHTML = entries.length
    ? entries
        .map(({ item, quantity, price }) => {
          const value = price === null ? "No disponible" : formatUsdTotal(quantity * price);
          return `
            <div class="acronis-selected-line">
              <span title="${escapeAttribute(displayDescription(item.description))}">${quantity} × ${escapeHtml(displayDescription(item.description))}</span>
              <strong>${value}</strong>
            </div>
          `;
        })
        .join("")
    : '<p class="acronis-no-selection">Agrega cantidades para construir la cotización.</p>';
}

function resetQuantities() {
  state.quantities.clear();
  elements.catalog.querySelectorAll("[data-acronis-quantity]").forEach((input) => {
    input.value = "0";
  });
  updateVisibleCalculations();
  updateSummary();
}

async function copyQuote() {
  const entries = getAllItems()
    .map((item) => ({ item, quantity: getQuantity(item.id), price: unitPrice(item) }))
    .filter((entry) => entry.quantity > 0 && entry.price !== null);
  if (!entries.length) {
    return;
  }

  const usage = entries.reduce((sum, entry) => sum + entry.quantity * entry.price, 0);
  const commitment = Number(state.data.commitments[state.tierIndex]) || 0;
  const billed = Math.max(usage, commitment);
  const marginRatio = Math.min(0.99, getProfit() / 100);
  const sale = billed / (1 - marginRatio);
  const rows = entries.map(({ item, quantity, price }) => {
    const sku = item.skus.All || item.skus[state.dcGroup] || "";
    const saleUnit = price / (1 - marginRatio);
    return [
      sku,
      displayDescription(item.description),
      quantity,
      "USD",
      saleUnit.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
      (saleUnit * quantity).toFixed(2),
    ].join("\t");
  });
  const commitmentAdjustment = Math.max(0, billed - usage) / (1 - marginRatio);
  if (commitmentAdjustment > 0) {
    rows.push(
      [
        "",
        "Ajuste por compromiso mínimo Acronis",
        1,
        "USD",
        commitmentAdjustment.toFixed(2),
        commitmentAdjustment.toFixed(2),
      ].join("\t"),
    );
  }
  const text = [
    "Cotización Acronis Cyber Cloud",
    `Datacenter\t${state.datacenterLabel}`,
    `Compromiso mensual\t${formatUsdTotal(commitment)}`,
    `Rentabilidad\t${getProfit()}%`,
    "",
    "SKU\tDescripción\tCantidad\tMoneda\tPrecio unitario venta\tSubtotal venta",
    ...rows,
    "",
    `Consumo calculado\t${formatUsdTotal(usage)}`,
    `Costo mensual facturable\t${formatUsdTotal(billed)}`,
    `Venta sugerida mensual\t${formatUsdTotal(sale)}`,
    `Venta sugerida anual\t${formatUsdTotal(sale * 12)}`,
  ].join("\n");

  const copied = await copyText(text);
  const originalLabel = elements.copy.textContent;
  elements.copy.textContent = copied ? "Cotización copiada" : "No se pudo copiar";
  window.setTimeout(() => {
    elements.copy.textContent = originalLabel;
  }, 1500);
}

function getFilteredItems(mode) {
  const all = state.data?.[mode] || [];
  const allowed = ALLOWED_CATEGORIES[mode];
  if (!allowed) {
    return all;
  }
  return all.filter((item) => allowed.has(item.category));
}

function getCurrentItems() {
  return getFilteredItems(state.mode);
}

function getAllItems() {
  return [...getFilteredItems("solution"), ...getFilteredItems("service")];
}

function findItem(id) {
  return getAllItems().find((item) => item.id === id);
}

function groupByCategory(items) {
  const categories = [];
  const byName = new Map();
  items.forEach((item) => {
    if (!byName.has(item.category)) {
      const category = { name: item.category, items: [] };
      byName.set(item.category, category);
      categories.push(category);
    }
    byName.get(item.category).items.push(item);
  });
  return categories;
}

function unitPrice(item) {
  if (!item) {
    return null;
  }
  const tiers = item.prices.All || item.prices[state.dcGroup];
  const price = tiers?.[state.tierIndex];
  return Number.isFinite(Number(price)) ? Number(price) : null;
}

function lineTotal(item) {
  const price = unitPrice(item);
  return price === null ? 0 : price * getQuantity(item.id);
}

function getQuantity(id) {
  return Math.max(0, Number(state.quantities.get(id)) || 0);
}

function matchesSearch(item) {
  if (!state.search) {
    return true;
  }
  const haystack = normalizeText(
    [item.category, item.subcategory, item.description, ...Object.values(item.skus)].join(" "),
  );
  return haystack.includes(state.search);
}

function getProfit() {
  const value = Number(elements.profit.value);
  return Number.isFinite(value) ? Math.max(MIN_PROFIT_PCT, value) : MIN_PROFIT_PCT;
}

function enforceProfit({ force = false } = {}) {
  const raw = String(elements.profit.value || "").trim();
  if (!raw && !force) {
    return;
  }
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val < MIN_PROFIT_PCT) {
    elements.profit.value = String(MIN_PROFIT_PCT);
  }
}

function parseTrm(value) {
  const parsed = Number(String(value || "").replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 100 ? parsed : 0;
}

function formatNote(note) {
  const translations = {
    "Requires Security+RMM or Ultimate Protection": "Requiere Security + RMM o Ultimate Protection",
    "Requires BDR or Ultimate Protection": "Requiere BDR o Ultimate Protection",
    "Requires EDR/XDR": "Requiere EDR o XDR",
    "Requires Backup": "Requiere Backup",
  };
  return translations[note] || note || "";
}

function displayDescription(value) {
  return String(value || "").replace(/^#\s*/, "");
}

function formatUsdUnit(value) {
  return usdUnitFormatter.format(Number(value) || 0);
}

function formatUsdTotal(value) {
  return usdTotalFormatter.format(Number(value) || 0);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue with the local fallback.
    }
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "readonly");
  helper.style.position = "fixed";
  helper.style.top = "-9999px";
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand("copy");
  helper.remove();
  return copied;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
