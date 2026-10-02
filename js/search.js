import {
  buildDistributorCopyText,
  DIST_ORDER,
  renderTables,
  showEmptyState,
  showLoadingState,
} from "./tables.js";
import { fetchTRM } from "./trm.js";

const SUGGESTION_LIMIT = 8;
const MIN_PROFIT_PCT = 6;
const CLOUD_CATALOG_PATHS = ["catalogs/cloud_products.json", "products.json"];
const TYPE_OPTION_DEFS = [
  { value: "NCE", label: "NCE" },
  { value: "SUSCRIPCION", label: "Software Suscripción" },
  { value: "PERPETUO", label: "Perpetuo (Pago único)" },
];
const SEGMENT_OPTION_DEFS = [
  { value: "Commercial", label: "Commercial" },
  { value: "Education", label: "Education" },
];
const TERM_OPTION_DEFS = [
  { value: "mensual", label: "1 Mes (P1M)" },
  { value: "anual", label: "1 Año (P1Y)" },
  { value: "trianual", label: "3 Años (P3Y)" },
  { value: "onetime", label: "Pago único (Perpetuo)" },
];
const BILLING_OPTION_DEFS = [
  { value: "mensual", label: "Pago Mensual" },
  { value: "anual", label: "Pago Anual" },
  { value: "trianual", label: "Pago Trianual" },
  { value: "onetime", label: "Pago único (One-Time)" },
];

// Abreviaturas y aliases de busqueda. Cada palabra del query se expande
// antes de tokenizar, permitiendo busquedas mas naturales y flexibles.
const SEARCH_ALIASES = {
  // Abreviaturas comunes
  m365: "microsoft 365",
  o365: "office 365",
  biz: "business",
  std: "standard",
  prem: "premium",
  ent: "enterprise",
  ess: "essentials",
  exch: "exchange",
  spo: "sharepoint",
  def: "defender",
  proj: "project",
  vis: "visio",
  aad: "entra",
  entra: "entra",
  win: "windows",
  subs: "subscription",
  bp: "business premium",
  bs: "business standard",
  bb: "business basic",
  teams: "teams",
  intune: "intune",
  copilot: "copilot",
  copiloto: "copilot",
  fabric: "fabric",
  pbi: "power bi",
  rds: "remote desktop",
  cal: "cal",
  ltsc: "ltsc",
  d365: "dynamics 365",
  bc: "business central",
  ws: "windows server",
  sql: "sql server",

  // Términos en español y sinónimos naturales
  estandar: "standard",
  basico: "basic",
  basica: "basic",
  empresa: "business",
  empresas: "business",
  negocio: "business",
  servidor: "server",
  servidores: "server",
  correo: "exchange",
  buzon: "exchange",
  buzones: "exchange",
  antivirus: "defender",
  seguridad: "defender",
  proteccion: "defender",
  educacion: "education",
  colegio: "education",
  universidad: "education",
  ofimatica: "apps",
  oficina: "office",
  remoto: "remote desktop",
  escritorio: "remote desktop",
  almacenamiento: "storage",
  auditoria: "audit",
  respaldo: "backup",
  mensual: "p1m",
  anual: "p1y",
  trianual: "p3y",
  perpetuo: "ltsc",
  permanente: "ltsc",
  vitalicio: "ltsc",
};

const state = {
  products: [],
  activeDists: new Set(["LOL"]),
  currentResults: createEmptyResults(),
  hasSearched: false,
  activeMobileDist: "LOL",
  isLoadingProducts: true,
  loadError: false,
  selectedProducts: [],
  searchSuggestions: [],
  activeSuggestionIndex: -1,
  autoSelectedFilters: {
    type: false,
    segment: false,
    term: false,
    billing: false,
  },
};

const elements = {
  totalCount: document.getElementById("totalCount"),
  cloudSectionTabs: document.getElementById("cloudSectionTabs"),
  cloudSectionHelper: document.getElementById("cloudSectionHelper"),
  searchComposer: document.getElementById("searchComposer"),
  searchResultsCount: document.getElementById("searchResultsCount"),
  searchInput: document.getElementById("searchInput"),
  searchClearBtn: document.getElementById("searchClearBtn"),
  searchButton: document.getElementById("searchButton"),
  searchSuggestions: document.getElementById("searchSuggestions"),
  selectedProductsSection: document.getElementById("selectedProductsSection"),
  selectedProductsList: document.getElementById("selectedProductsList"),
  searchWarning: document.getElementById("searchWarning"),
  clearSelectedProducts: document.getElementById("clearSelectedProducts"),
  typeFilter: document.getElementById("typeFilter"),
  segFilter: document.getElementById("segFilter"),
  termFilterGroup: document.getElementById("termFilterGroup"),
  billingFilterGroup: document.getElementById("billingFilterGroup"),
  termFilter: document.getElementById("termFilter"),
  billingFilter: document.getElementById("billingFilter"),
  filterChips: Array.from(document.querySelectorAll(".filter-chip")),
  profitPct: document.getElementById("profitPct"),
  qtyInput: document.getElementById("qtyInput"),
  trmInput: document.getElementById("trmInput"),
  trmStatus: document.getElementById("trmStatus"),
  mobileTabs: Array.from(document.querySelectorAll(".dist-tab")),
  resultsArea: document.getElementById("resultsArea"),
};

// Expande cada palabra del query usando el mapa de aliases, palabra por palabra.
// "m365 biz std" → "microsoft 365 business standard"
function expandAliases(query) {
  return normalizeText(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => SEARCH_ALIASES[word] || word)
    .join(" ");
}

// Devuelve true si TODAS las palabras del query coinciden como prefijo o subtexto
// de AL MENOS UNA palabra o el texto del producto/SKU.
function queryWordsMatchProduct(queryWords, productWords, fullSearchText = "") {
  return queryWords.every((qw) =>
    productWords.some((pw) => pw.startsWith(qw) || pw.includes(qw)) ||
    (fullSearchText && fullSearchText.includes(qw)),
  );
}

initialize();

function initialize() {
  bindEvents();
  enforceMinProfitPct({ force: true });
  syncCloudSectionTabs(elements.typeFilter ? elements.typeFilter.value : "NCE");
  updateCloudSectionHelper(elements.typeFilter ? elements.typeFilter.value : "NCE");
  renderSelectedProducts();
  renderSearchWarning();
  loadProducts();

  fetchTRM({
    statusEl: elements.trmStatus,
    inputEl: elements.trmInput,
  });
}

function bindEvents() {
  elements.searchButton.addEventListener("click", handleSearchButtonClick);
  elements.searchInput.addEventListener("keydown", handleSearchInputKeydown);
  elements.searchInput.addEventListener("input", handleSearchInputInput);
  elements.searchInput.addEventListener("focus", handleSearchInputFocus);
  if (elements.searchClearBtn) {
    elements.searchClearBtn.addEventListener("click", handleSearchClearClick);
  }

  window.addEventListener("provex:update-products", (e) => {
    if (Array.isArray(e.detail)) {
      state.products = e.detail.map(enrichProduct);
      if (elements.totalCount) {
        elements.totalCount.textContent = `${state.products.length.toLocaleString("es-CO")} productos - 3 mayoristas`;
      }
      syncCloudFilterOptions();
      updateSearchSuggestions();
      renderSearchWarning();
      runSearch();
    }
  });
  elements.searchSuggestions.addEventListener("click", handleSuggestionClick);
  elements.selectedProductsList.addEventListener("click", handleSelectedProductRemove);
  elements.clearSelectedProducts.addEventListener("click", clearSelectedProducts);
  elements.resultsArea.addEventListener("click", handleResultsAreaClick);

  if (elements.cloudSectionTabs) {
    elements.cloudSectionTabs.addEventListener("click", handleCloudSectionTabClick);
  }

  document.addEventListener("click", (event) => {
    if (
      elements.searchComposer.contains(event.target) ||
      elements.searchSuggestions.contains(event.target)
    ) {
      return;
    }

    hideSearchSuggestions();
  });

  elements.typeFilter.addEventListener("change", () => {
    const currentSection = elements.typeFilter.value;
    syncCloudSectionTabs(currentSection);
    if (currentSection === "PERPETUO") {
      if (elements.termFilter) elements.termFilter.value = "onetime";
      if (elements.billingFilter) elements.billingFilter.value = "onetime";
      state.autoSelectedFilters.term = true;
      state.autoSelectedFilters.billing = true;
    } else {
      if (elements.termFilter && elements.termFilter.value === "onetime") {
        elements.termFilter.value = "";
        state.autoSelectedFilters.term = false;
      }
      if (elements.billingFilter && elements.billingFilter.value === "onetime") {
        elements.billingFilter.value = "";
        state.autoSelectedFilters.billing = false;
      }
    }
    updateCloudSectionHelper(currentSection);
    state.autoSelectedFilters.type = false;
    syncCloudFilterOptions();
    updateSearchSuggestions();
    renderSearchWarning();
    runSearch();
  });

  [
    { element: elements.segFilter, key: "segment" },
    { element: elements.termFilter, key: "term" },
    { element: elements.billingFilter, key: "billing" },
  ].forEach(({ element, key }) => {
    if (!element) return;
    element.addEventListener("change", () => {
      state.autoSelectedFilters[key] = false;
      syncCloudFilterOptions();
      updateSearchSuggestions();
      renderSearchWarning();
      runSearch();
    });
  });


  elements.profitPct.addEventListener("focus", () => {
    elements.profitPct.select();
  });

  elements.profitPct.addEventListener("input", () => {
    if (state.hasSearched) {
      renderCurrentResults();
    }
  });

  elements.profitPct.addEventListener("blur", () => {
    enforceMinProfitPct({ force: true });
    if (state.hasSearched) {
      renderCurrentResults();
    }
  });

  elements.qtyInput.addEventListener("focus", () => {
    elements.qtyInput.select();
  });

  elements.qtyInput.addEventListener("input", () => {
    if (state.hasSearched) {
      renderCurrentResults();
    }
  });

}

function handleCloudSectionTabClick(event) {
  const button = event.target.closest(".cloud-section-tab");
  if (!button) return;

  const section = button.dataset.section || "";
  setCloudSection(section);
}

function setCloudSection(section) {
  syncCloudSectionTabs(section);
  elements.typeFilter.value = section;
  state.autoSelectedFilters.type = false;

  if (section === "PERPETUO") {
    if (elements.termFilter) elements.termFilter.value = "onetime";
    if (elements.billingFilter) elements.billingFilter.value = "onetime";
    state.autoSelectedFilters.term = true;
    state.autoSelectedFilters.billing = true;
  } else {
    if (elements.termFilter && elements.termFilter.value === "onetime") {
      elements.termFilter.value = "";
      state.autoSelectedFilters.term = false;
    }
    if (elements.billingFilter && elements.billingFilter.value === "onetime") {
      elements.billingFilter.value = "";
      state.autoSelectedFilters.billing = false;
    }
  }

  updateCloudSectionHelper(section);
  syncCloudFilterOptions();
  updateSearchSuggestions();
  renderSearchWarning();

  runSearch();
}

function syncCloudSectionTabs(section) {
  if (!elements.cloudSectionTabs) return;

  elements.cloudSectionTabs.querySelectorAll(".cloud-section-tab").forEach((tab) => {
    const isMatch = (tab.dataset.section || "") === (section || "");
    tab.classList.toggle("active", isMatch);
    tab.setAttribute("aria-selected", isMatch ? "true" : "false");
  });
}

function updateCloudSectionHelper(section) {
  if (section === "PERPETUO") {
    if (elements.termFilterGroup) elements.termFilterGroup.hidden = true;
    if (elements.billingFilterGroup) elements.billingFilterGroup.hidden = true;
    if (elements.cloudSectionHelper) {
      elements.cloudSectionHelper.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200">
          💎 Licenciamiento Perpetuo: Licencia permanente de por vida (Pago único, sin cuotas ni vencimiento)
        </span>
      `;
    }
  } else if (section === "SUSCRIPCION") {
    if (elements.termFilterGroup) elements.termFilterGroup.hidden = false;
    if (elements.billingFilterGroup) elements.billingFilterGroup.hidden = false;
    if (elements.cloudSectionHelper) {
      elements.cloudSectionHelper.innerHTML = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-50 text-cyan-800 border border-cyan-200">
          Suscripciones de Servidores y Software (1Y / 3Y)
        </span>
      `;
    }
  } else if (section === "NCE") {
    if (elements.termFilterGroup) elements.termFilterGroup.hidden = false;
    if (elements.billingFilterGroup) elements.billingFilterGroup.hidden = false;
    if (elements.cloudSectionHelper) {
      elements.cloudSectionHelper.innerHTML = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          Suscripciones Cloud Modernas (M365, O365, Copilot, Defender)
        </span>
      `;
    }
  } else {
    if (elements.termFilterGroup) elements.termFilterGroup.hidden = false;
    if (elements.billingFilterGroup) elements.billingFilterGroup.hidden = false;
    if (elements.cloudSectionHelper) {
      elements.cloudSectionHelper.innerHTML = "";
    }
  }
}

async function loadProducts() {
  state.isLoadingProducts = true;
  state.loadError = false;

  try {
    const data = window.__CUSTOM_PRODUCTS || (await fetchCatalogData(CLOUD_CATALOG_PATHS));
    state.products = Array.isArray(data)
      ? data.map(enrichProduct)
      : [];

    if (elements.totalCount) {
      elements.totalCount.textContent = `${state.products.length.toLocaleString("es-CO")} productos - 3 mayoristas`;
    }
  } catch (error) {
    state.products = [];
    state.loadError = true;
    if (elements.totalCount) {
      elements.totalCount.textContent = "Error cargando datos";
    }
  } finally {
    state.isLoadingProducts = false;
    syncCloudFilterOptions();
    updateSearchSuggestions();
    renderSearchWarning();
    runSearch();
  }
}

async function fetchCatalogData(paths) {
  let lastError = null;

  for (const path of paths) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Catalog request failed with status ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Catalog request failed");
}

function handleSearchInputKeydown(event) {
  if (event.key === "Escape") {
    hideSearchSuggestions();
    return;
  }

  const suggestionButtons = Array.from(
    elements.searchSuggestions ? elements.searchSuggestions.querySelectorAll(".search-suggestion") : [],
  );

  if (suggestionButtons.length > 0 && !elements.searchSuggestions.hidden) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeSuggestionIndex = (state.activeSuggestionIndex + 1) % suggestionButtons.length;
      updateActiveSuggestion(suggestionButtons);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeSuggestionIndex =
        (state.activeSuggestionIndex - 1 + suggestionButtons.length) % suggestionButtons.length;
      updateActiveSuggestion(suggestionButtons);
      return;
    }

    if (event.key === "Enter" && state.activeSuggestionIndex >= 0) {
      event.preventDefault();
      const selectedBtn = suggestionButtons[state.activeSuggestionIndex];
      if (selectedBtn && selectedBtn.dataset.productName) {
        addSelectedProduct(selectedBtn.dataset.productName);
        return;
      }
    }
  }

  if (event.key === "Enter") {
    event.preventDefault();
    hideSearchSuggestions();
    runSearch();
  }
}

function updateActiveSuggestion(buttons) {
  buttons.forEach((btn, idx) => {
    btn.classList.toggle("active", idx === state.activeSuggestionIndex);
    if (idx === state.activeSuggestionIndex) {
      btn.scrollIntoView({ block: "nearest" });
    }
  });
}

function handleSearchInputInput() {
  const hasText = Boolean(elements.searchInput.value.trim());
  if (elements.searchClearBtn) {
    elements.searchClearBtn.hidden = !hasText;
  }
  state.activeSuggestionIndex = -1;
  syncCloudFilterOptions();
  updateSearchSuggestions();
  renderSearchWarning();
  runSearch();
}

function handleSearchClearClick() {
  elements.searchInput.value = "";
  if (elements.searchClearBtn) {
    elements.searchClearBtn.hidden = true;
  }
  state.activeSuggestionIndex = -1;
  elements.searchInput.focus();
  syncCloudFilterOptions();
  updateSearchSuggestions();
  renderSearchWarning();
  runSearch();
}

function handleSearchInputFocus() {
  const hasText = Boolean(elements.searchInput.value.trim());
  if (elements.searchClearBtn) {
    elements.searchClearBtn.hidden = !hasText;
  }
  syncCloudFilterOptions();
  updateSearchSuggestions();
  renderSearchWarning();
}

function syncCloudFilterOptions() {
  if (!state.products.length || state.loadError) {
    return;
  }

  const context = getSelectionContext();
  const activeFilters = getActiveSecondaryFilters();
  const baseProducts = state.products.filter((product) => matchesSelectionContext(product, context));
  const productsForOptions = baseProducts.length ? baseProducts : state.products;
  const autoSelectSingle = context.hasFocus;

  const availableTypes = getOrderedFilterValues(
    productsForOptions.filter((product) => matchesSecondaryFilters(product, activeFilters, new Set(["type"]))),
    "type",
    TYPE_OPTION_DEFS,
  );
  const availableSegments = getOrderedFilterValues(
    productsForOptions.filter((product) => matchesSecondaryFilters(product, activeFilters, new Set(["segment"]))),
    "segment",
    SEGMENT_OPTION_DEFS,
  );
  const availableTerms = getOrderedFilterValues(
    productsForOptions.filter((product) => matchesSecondaryFilters(product, activeFilters, new Set(["term"]))),
    "normalizedTerm",
    TERM_OPTION_DEFS,
  );
  const availableBillings = getOrderedFilterValues(
    productsForOptions.filter((product) => matchesSecondaryFilters(product, activeFilters, new Set(["billing"]))),
    "normalizedBilling",
    BILLING_OPTION_DEFS,
  );

  setDynamicSelectOptions("type", elements.typeFilter, availableTypes, {
    allLabel: "Todas las secciones",
    autoSelectSingle,
  });
  setDynamicSelectOptions("segment", elements.segFilter, availableSegments, {
    allLabel: "Todos los segmentos",
    autoSelectSingle,
  });
  setDynamicSelectOptions("term", elements.termFilter, availableTerms, {
    allLabel: "Todos los periodos",
    autoSelectSingle,
  });
  setDynamicSelectOptions("billing", elements.billingFilter, availableBillings, {
    allLabel: "Todos los planes",
    autoSelectSingle,
  });
}

function getSelectionContext() {
  const query = expandAliases(normalizeText(elements.searchInput.value));
  const words = query.split(/\s+/).filter(Boolean);

  return {
    words,
    hasFocus: words.length > 0,
  };
}

function getActiveSecondaryFilters() {
  return {
    type: elements.typeFilter ? elements.typeFilter.value : "",
    segment: elements.segFilter ? normalizeText(elements.segFilter.value) : "",
    term: elements.termFilter ? elements.termFilter.value : "",
    billing: elements.billingFilter ? elements.billingFilter.value : "",
  };
}

function matchesSelectionContext(product, context) {
  if (!context.hasFocus) {
    return true;
  }

  const productWords =
    product.searchWords ||
    (product.searchText || normalizeText(product.name || "")).split(/\s+/).filter(Boolean);
  return queryWordsMatchProduct(context.words, productWords, product.searchText || "");
}

function handleSuggestionClick(event) {
  const button = event.target.closest("[data-product-name]");
  if (!button) {
    return;
  }

  addSelectedProduct(button.dataset.productName);
}

function handleSelectedProductRemove(event) {
  const button = event.target.closest("[data-remove-product]");
  if (!button) {
    return;
  }

  removeSelectedProduct(button.dataset.removeProduct);
}

async function handleResultsAreaClick(event) {
  const quickChip = event.target.closest(".empty-quick-chip");
  if (quickChip && quickChip.dataset.quickSearch) {
    elements.searchInput.value = quickChip.dataset.quickSearch;
    if (elements.searchClearBtn) elements.searchClearBtn.hidden = false;
    runSearch();
    return;
  }

  const resetBtn = event.target.closest("#emptyResetFilters");
  if (resetBtn) {
    elements.searchInput.value = "";
    if (elements.searchClearBtn) elements.searchClearBtn.hidden = true;
    setCloudSection("");
    resetCurrentInputFilters();
    runSearch();
    return;
  }

  const copyButton = event.target.closest("[data-copy-dist]");
  if (copyButton) {
    const dist = copyButton.dataset.copyDist;
    const products = state.currentResults?.[dist] || [];
    if (!dist || !products.length) {
      return;
    }

    const text = buildDistributorCopyText({
      dist,
      products,
      profitPct: getProfitPct(),
      qty: Math.max(1, parseInt(elements.qtyInput.value, 10) || 1),
    });

    const copied = await copyTextToClipboard(text);
    flashCopyButtonState(copyButton, copied ? "Copiado" : "No se pudo copiar");
  }
}

function handleSearchButtonClick() {
  hideSearchSuggestions();
  runSearch();
}

function runSearch() {
  const query = normalizeText(elements.searchInput.value);

  if (state.isLoadingProducts) {
    showLoadingState(elements.resultsArea, "Cargando catalogo...");
    return;
  }

  if (state.loadError) {
    showEmptyState(elements.resultsArea, {
      icon: "&#9888;",
      title: "No se pudieron cargar los productos",
      message: "Revisa catalogs/cloud_products.json o products.json e intenta de nuevo.",
    });
    return;
  }

  const criteria = getSearchCriteria(query);
  state.hasSearched = true;

  const filteredProducts = state.products.filter((product) => matchesProduct(product, criteria));
  state.currentResults = groupResultsByDistributor(filteredProducts, criteria);
  renderCurrentResults();
}

function getSearchCriteria(query) {
  const expandedQuery = expandAliases(query);
  return {
    currentInput: {
      words: expandedQuery.split(/\s+/).filter(Boolean),
      type: elements.typeFilter ? elements.typeFilter.value : "",
      segment: elements.segFilter ? normalizeText(elements.segFilter.value) : "",
      term: elements.termFilter ? elements.termFilter.value : "",
      billing: elements.billingFilter ? elements.billingFilter.value : "",
    },
    selectedProducts: [...state.selectedProducts],
  };
}

function matchesProduct(product, criteria) {
  const hasSelectedProducts = criteria.selectedProducts.length > 0;
  const hasSearchWords = criteria.currentInput.words.length > 0;

  if (hasSelectedProducts) {
    const matchesSelected = criteria.selectedProducts.some((selection) =>
      matchesSelectedProductProfile(product, selection, criteria.currentInput),
    );

    if (!hasSearchWords) {
      return matchesSelected;
    }

    return (
      matchesSelected ||
      (matchesSelectionOrQuery(product, criteria.currentInput) &&
        matchesSecondaryFilters(product, criteria.currentInput))
    );
  }

  return (
    matchesSelectionOrQuery(product, criteria.currentInput) &&
    matchesSecondaryFilters(product, criteria.currentInput)
  );
}

function matchesSelectionOrQuery(product, criteria) {
  if (!criteria.words.length) {
    return true;
  }

  const productWords =
    product.searchWords ||
    (product.searchText || normalizeText(String(product.name || "").trim())).split(/\s+/).filter(Boolean);
  return queryWordsMatchProduct(criteria.words, productWords, product.searchText || "");
}

function matchesSecondaryFilters(product, criteria, ignoredKeys = new Set()) {
  const segment = normalizeText(product.segment);

  if (!ignoredKeys.has("type") && criteria.type) {
    if (product.type !== criteria.type) {
      return false;
    }
  }

  if (!ignoredKeys.has("segment") && criteria.segment && segment !== criteria.segment) {
    return false;
  }

  if (!ignoredKeys.has("term") && criteria.term && product.normalizedTerm !== criteria.term) {
    return false;
  }

  if (!ignoredKeys.has("billing") && criteria.billing && product.normalizedBilling !== criteria.billing) {
    return false;
  }

  return true;
}

function updateSearchSuggestions() {
  const query = normalizeText(elements.searchInput.value);

  if (!query || state.isLoadingProducts || state.loadError) {
    state.searchSuggestions = [];
    state.activeSuggestionIndex = -1;
    renderSearchSuggestions();
    return;
  }

  const activeFilters = getActiveSecondaryFilters();
  const selectedIds = new Set(state.selectedProducts.map((selection) => selection.id));
  const seenNames = new Set();
  const expandedQuery = expandAliases(query);
  const criteria = {
    currentInput: {
      words: expandedQuery.split(/\s+/).filter(Boolean),
      ...activeFilters,
    },
    words: expandedQuery.split(/\s+/).filter(Boolean),
    ...activeFilters,
  };

  const candidates = [];
  for (const product of state.products) {
    const productName = product.canonicalName || String(product.name || "").trim();
    const candidateSelectionId = getSelectedProductId(productName, activeFilters, {
      type: Boolean(activeFilters.type),
      segment: Boolean(activeFilters.segment),
      term: Boolean(activeFilters.term),
      billing: Boolean(activeFilters.billing),
    });

    if (!productName || selectedIds.has(candidateSelectionId) || seenNames.has(productName)) {
      continue;
    }

    if (!matchesSecondaryFilters(product, criteria)) {
      continue;
    }

    const productWords =
      product.searchWords ||
      (product.searchText || normalizeText(productName)).split(/\s+/).filter(Boolean);
    if (!queryWordsMatchProduct(criteria.words, productWords, product.searchText || "")) {
      continue;
    }

    const score = getProductRelevanceScore(product, criteria);
    candidates.push({ name: productName, type: product.type, score });
    seenNames.add(productName);
  }

  candidates.sort((a, b) => b.score - a.score);
  state.searchSuggestions = candidates.slice(0, SUGGESTION_LIMIT);
  state.activeSuggestionIndex = -1;
  renderSearchSuggestions();
}

function renderSearchSuggestions() {
  const query = normalizeText(elements.searchInput.value);

  if (!query) {
    elements.searchSuggestions.hidden = true;
    elements.searchSuggestions.innerHTML = "";
    return;
  }

  if (!state.searchSuggestions.length) {
    elements.searchSuggestions.innerHTML =
      '<div class="search-suggestion-empty">Presiona Enter para buscar todas las coincidencias</div>';
    elements.searchSuggestions.hidden = false;
    return;
  }

  elements.searchSuggestions.innerHTML = state.searchSuggestions
    .map((item, index) => {
      const name = typeof item === "string" ? item : item.name;
      const type = typeof item === "object" ? item.type : "";
      const typeTag =
        type === "NCE"
          ? '<span class="tag-pill tag-nce text-[10px] uppercase font-bold">NCE</span>'
          : type === "PERPETUO"
          ? '<span class="tag-pill tag-perp text-[10px] uppercase font-bold">PERPETUO</span>'
          : '<span class="tag-pill tag-subs text-[10px] uppercase font-bold">SUBS</span>';

      return `
        <button type="button" class="search-suggestion ${index === state.activeSuggestionIndex ? "active" : ""}" data-product-name="${escapeAttribute(name)}">
          <span class="truncate pr-2">${highlightSearchText(name, query)}</span>
          ${typeTag}
        </button>
      `;
    })
    .join("");

  elements.searchSuggestions.hidden = false;
}

function highlightSearchText(text, query) {
  if (!query) return escapeHtml(text);
  const words = query.split(/\s+/).filter(Boolean);
  let result = escapeHtml(text);
  words.forEach((w) => {
    if (w.length >= 2) {
      const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      result = result.replace(regex, '<span class="search-suggestion-match">$1</span>');
    }
  });
  return result;
}

function hideSearchSuggestions() {
  elements.searchSuggestions.hidden = true;
}

function addSelectedProduct(name) {
  const selection = createSelectedProductSelection(name);

  if (!selection || state.selectedProducts.some((item) => item.id === selection.id)) {
    return;
  }

  state.selectedProducts = [...state.selectedProducts, selection];
  elements.searchInput.value = "";
  state.searchSuggestions = [];
  resetCurrentInputFilters();
  syncCloudFilterOptions();
  renderSelectedProducts();
  renderSearchSuggestions();
  renderSearchWarning();

  runSearch();
}

function removeSelectedProduct(selectionId) {
  state.selectedProducts = state.selectedProducts.filter((item) => item.id !== selectionId);
  syncCloudFilterOptions();
  renderSelectedProducts();
  updateSearchSuggestions();
  renderSearchWarning();

  runSearch();
}

function clearSelectedProducts() {
  if (!state.selectedProducts.length) {
    return;
  }

  state.selectedProducts = [];
  syncCloudFilterOptions();
  renderSelectedProducts();
  updateSearchSuggestions();
  renderSearchWarning();

  runSearch();
}

function renderSelectedProducts() {
  if (!state.selectedProducts.length) {
    elements.selectedProductsSection.hidden = true;
    elements.selectedProductsList.innerHTML = "";
    return;
  }

  elements.selectedProductsSection.hidden = false;
  elements.selectedProductsList.innerHTML = state.selectedProducts
    .map(
      (selection) => `
        <div class="selected-product-chip">
          <div class="selected-product-copy">
            <span class="selected-product-name">${escapeHtml(selection.name)}</span>
            ${
              selection.metaLabel
                ? `<span class="selected-product-meta">${escapeHtml(selection.metaLabel)}</span>`
                : ""
            }
          </div>
          <button
            type="button"
            class="selected-product-remove"
            data-remove-product="${escapeAttribute(selection.id)}"
            aria-label="Quitar ${escapeAttribute(selection.displayLabel)}"
          >
            &times;
          </button>
        </div>
      `,
    )
    .join("");
}

function groupResultsByDistributor(products, criteria = null) {
  const grouped = createEmptyResults();
  const dedupedProducts = dedupeLogicalProducts(products);

  dedupedProducts.forEach((product) => {
    if (grouped[product.distributor]) {
      grouped[product.distributor].push(product);
    }
  });

  Object.values(grouped).forEach((distProducts) => {
    distProducts.sort((left, right) =>
      compareProducts(left, right, state.selectedProducts, criteria),
    );
  });

  return grouped;
}

function dedupeLogicalProducts(products) {
  const bestByLogicalKey = new Map();

  products.forEach((product) => {
    const logicalKey = [product.distributor, product.comparisonKey || ""].join("__");
    const existing = bestByLogicalKey.get(logicalKey);

    if (!existing || isPreferredProduct(product, existing)) {
      bestByLogicalKey.set(logicalKey, product);
    }
  });

  return Array.from(bestByLogicalKey.values());
}

function isPreferredProduct(candidate, current) {
  const candidateQuality = getProductQualityScore(candidate);
  const currentQuality = getProductQualityScore(current);

  if (candidateQuality !== currentQuality) {
    return candidateQuality > currentQuality;
  }

  const candidatePrice = Number(candidate.price) || 0;
  const currentPrice = Number(current.price) || 0;

  if (candidatePrice !== currentPrice) {
    return candidatePrice < currentPrice;
  }

  const candidateName = String(candidate.name || "");
  const currentName = String(current.name || "");

  if (candidateName.length !== currentName.length) {
    return candidateName.length < currentName.length;
  }

  return candidateName.localeCompare(currentName, "es", { sensitivity: "base" }) < 0;
}

function getProductQualityScore(product) {
  let score = 0;

  if (String(product.billing || "").trim()) {
    score += 3;
  }

  if (String(product.term || "").trim()) {
    score += 2;
  }

  if (String(product.partNumber || "").trim()) {
    score += 1;
  }

  if (String(product.normalizedBilling || "").trim()) {
    score += 1;
  }

  if (String(product.normalizedTerm || "").trim()) {
    score += 1;
  }

  if (String(product.strictPeriodKey || "").trim()) {
    score += 1;
  }

  return score;
}

function getProductRelevanceScore(product, criteria) {
  if (
    !criteria ||
    !criteria.currentInput ||
    !criteria.currentInput.words ||
    !criteria.currentInput.words.length
  ) {
    return 0;
  }

  const queryWords = criteria.currentInput.words;
  const fullQuery = queryWords.join(" ");
  const cleanQuery = normalizeText(fullQuery);
  const canonical = normalizeText(product.canonicalName || product.name || "");
  const partNumber = normalizeText(product.partNumber || "");
  const productId = normalizeText(product.productId || "");
  let score = 0;

  if (canonical === cleanQuery) {
    score += 1000;
  } else if (canonical.startsWith(cleanQuery)) {
    score += 600;
  } else if (canonical.includes(cleanQuery)) {
    score += 350;
  } else if (queryWords.every((w) => canonical.includes(w))) {
    score += 200;
  } else {
    score += 100;
  }

  if (partNumber === cleanQuery || productId === cleanQuery) {
    score += 800;
  } else if (partNumber.includes(cleanQuery) || productId.includes(cleanQuery)) {
    score += 400;
  }

  score += Math.max(0, 80 - Math.min(80, canonical.length));
  return score;
}

function compareProducts(left, right, selectedProducts, criteria = null) {
  const leftOrder = getSelectedProductOrder(left, selectedProducts);
  const rightOrder = getSelectedProductOrder(right, selectedProducts);

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  if (
    criteria &&
    criteria.currentInput &&
    criteria.currentInput.words &&
    criteria.currentInput.words.length > 0
  ) {
    const leftScore = getProductRelevanceScore(left, criteria);
    const rightScore = getProductRelevanceScore(right, criteria);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
  }

  const leftName = left.canonicalName || left.name;
  const rightName = right.canonicalName || right.name;
  const nameCompare = String(leftName || "").localeCompare(String(rightName || ""), "es", {
    sensitivity: "base",
  });

  if (nameCompare !== 0) {
    return nameCompare;
  }

  return (Number(left.price) || 0) - (Number(right.price) || 0);
}

function renderCurrentResults() {
  const totalMatches = Object.values(state.currentResults).reduce(
    (acc, list) => acc + (list ? list.length : 0),
    0,
  );

  if (elements.searchResultsCount) {
    if (normalizeText(elements.searchInput.value) || state.selectedProducts.length) {
      elements.searchResultsCount.textContent = `${totalMatches.toLocaleString("es-CO")} ${
        totalMatches === 1 ? "resultado" : "resultados"
      }`;
    } else {
      elements.searchResultsCount.textContent = "";
    }
  }

  renderTables({
    resultsArea: elements.resultsArea,
    currentResults: state.currentResults,
    activeDists: state.activeDists,
    activeMobileDist: state.activeMobileDist,
    profitPct: getProfitPct(),
    qty: Math.max(1, parseInt(elements.qtyInput.value, 10) || 1),
    selectionCount: state.selectedProducts.length,
  });
}

function getProfitPct() {
  const value = Number(elements.profitPct.value);
  return Number.isFinite(value) ? Math.max(MIN_PROFIT_PCT, value) : MIN_PROFIT_PCT;
}

function enforceMinProfitPct({ force = false } = {}) {
  const raw = String(elements.profitPct.value || "").trim();
  if (!raw && !force) {
    return;
  }
  const val = Number(raw);
  if (!raw || !Number.isFinite(val) || val < MIN_PROFIT_PCT) {
    elements.profitPct.value = String(MIN_PROFIT_PCT);
  }
}

async function copyTextToClipboard(text) {
  if (!text) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below.
    }
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "readonly");
  helper.style.position = "fixed";
  helper.style.top = "-9999px";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.focus();
  helper.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(helper);
  return copied;
}

function flashCopyButtonState(button, label) {
  if (!button) {
    return;
  }

  const originalLabel = button.dataset.originalLabel || button.textContent.trim() || "Copiar tabla";
  button.dataset.originalLabel = originalLabel;
  button.textContent = label;
  button.disabled = true;

  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.disabled = false;
  }, 1400);
}

function createSelectedProductSelection(name) {
  if (!name) {
    return null;
  }

  const filters = getActiveSecondaryFilters();
  const locks = {
    type: Boolean(filters.type) && !state.autoSelectedFilters.type,
    segment: Boolean(filters.segment) && !state.autoSelectedFilters.segment,
    term: Boolean(filters.term) && !state.autoSelectedFilters.term,
    billing: Boolean(filters.billing) && !state.autoSelectedFilters.billing,
  };
  const metaParts = [];

  if (locks.type) {
    metaParts.push(getOptionLabel(filters.type, TYPE_OPTION_DEFS));
  }

  if (locks.segment) {
    metaParts.push(getOptionLabel(filters.segment, SEGMENT_OPTION_DEFS));
  }

  if (locks.term) {
    metaParts.push(getOptionLabel(filters.term, TERM_OPTION_DEFS));
  }

  if (locks.billing) {
    metaParts.push(getOptionLabel(filters.billing, BILLING_OPTION_DEFS));
  }

  const metaLabel = metaParts.join(" · ");

  return {
    id: getSelectedProductId(name, filters, locks),
    name,
    type: locks.type ? filters.type : "",
    segment: locks.segment ? filters.segment : "",
    term: locks.term ? filters.term : "",
    billing: locks.billing ? filters.billing : "",
    typeLocked: locks.type,
    segmentLocked: locks.segment,
    termLocked: locks.term,
    billingLocked: locks.billing,
    metaLabel,
    displayLabel: metaLabel ? `${name} · ${metaLabel}` : name,
  };
}

function getSelectedProductId(name, filters, locks = {}) {
  return [
    name,
    locks.type ? filters.type || "" : "",
    locks.segment ? filters.segment || "" : "",
    locks.term ? filters.term || "" : "",
    locks.billing ? filters.billing || "" : "",
  ].join("__");
}

function resetCurrentInputFilters() {
  elements.typeFilter.value = "";
  elements.segFilter.value = "";
  elements.termFilter.value = "";
  if (elements.billingFilter) elements.billingFilter.value = "";
  state.autoSelectedFilters.type = false;
  state.autoSelectedFilters.segment = false;
  state.autoSelectedFilters.term = false;
  state.autoSelectedFilters.billing = false;
}

function matchesSelectedProductProfile(product, selection, currentInput = {}) {
  const canonical = product.canonicalName || product.name || "";
  const rawName = product.name || "";
  if (canonical !== selection.name && rawName !== selection.name) {
    return false;
  }

  return matchesSecondaryFilters(product, {
    type: selection.typeLocked ? selection.type : currentInput.type || "",
    segment: selection.segmentLocked ? selection.segment : currentInput.segment || "",
    term: selection.termLocked ? selection.term : currentInput.term || "",
    billing: selection.billingLocked ? selection.billing : currentInput.billing || "",
  });
}

function getSelectedProductOrder(product, selectedProducts) {
  const index = selectedProducts.findIndex((selection) => matchesSelectedProductProfile(product, selection));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function renderSearchWarning() {
  if (!elements.searchWarning) {
    return;
  }

  const message = getSearchWarningMessage();
  elements.searchWarning.hidden = !message;
  elements.searchWarning.textContent = message;
}

function getSearchWarningMessage() {
  if (!state.products.length || state.loadError) {
    return "";
  }

  const currentInput = {
    type: elements.typeFilter ? elements.typeFilter.value : "",
    segment: elements.segFilter ? normalizeText(elements.segFilter.value) : "",
    term: elements.termFilter ? elements.termFilter.value : "",
    billing: elements.billingFilter ? elements.billingFilter.value : "",
  };

  if (currentInput.type) {
    const conflictingSelections = state.selectedProducts.filter(
      (selection) => selection.typeLocked && selection.type && selection.type !== currentInput.type,
    );

    if (conflictingSelections.length) {
      const lockedTypes = Array.from(
        new Set(conflictingSelections.map((selection) => getOptionLabel(selection.type, TYPE_OPTION_DEFS))),
      );
      return `Hay productos seleccionados fijados como ${lockedTypes.join(
        ", ",
      )}. Si quieres ver solo ${getOptionLabel(
        currentInput.type,
        TYPE_OPTION_DEFS,
      )}, quita esos chips y agrégalos de nuevo con ese tipo.`;
    }
  }

  if (!currentInput.type) {
    const ambiguousSelections = state.selectedProducts.filter((selection) => {
      if (selection.typeLocked) {
        return false;
      }

      return getMatchingTypesForSelection(selection, currentInput).length > 1;
    });

    if (ambiguousSelections.length) {
      const sampleNames = ambiguousSelections
        .slice(0, 2)
        .map((selection) => selection.name)
        .join(", ");
      return `${sampleNames} existe en varios tipos. Elige "Tipo" para evitar mezclar NCE, Suscripción o Perpetuo.`;
    }
  }

  return "";
}

function getMatchingTypesForSelection(selection, currentInput) {
  return Array.from(
    new Set(
      state.products
        .filter((product) => (product.canonicalName || product.name) === selection.name)
        .filter((product) =>
          matchesSecondaryFilters(product, {
            type: "",
            segment: selection.segmentLocked ? selection.segment : currentInput.segment || "",
            term: selection.termLocked ? selection.term : currentInput.term || "",
            billing: selection.billingLocked ? selection.billing : currentInput.billing || "",
          }),
        )
        .map((product) => product.type)
        .filter(Boolean),
    ),
  );
}

function getStrictPeriodKey(product) {
  if (product?.strictPeriodKey) {
    return product.strictPeriodKey;
  }

  const term = product?.normalizedTerm || canonicalizeTerm(product);
  const billing = product?.normalizedBilling || canonicalizeBilling(product);
  const combo = `${term}|${billing}`;

  switch (combo) {
    case "mensual|mensual":
      return "mensual_mensual";
    case "anual|anual":
      return "anual_anual";
    case "anual|mensual":
      return "anual_mensual";
    case "trianual|anual":
      return "trianual_anual";
    case "trianual|trianual":
      return "trianual_trianual";
    case "trianual|mensual":
      return "trianual_mensual";
    case "onetime|onetime":
      return "onetime_onetime";
    default:
      return "";
  }
}

function canonicalizeTerm(product) {
  const term = normalizeText(product?.term);
  const partNumber = normalizeText(product?.partNumber);
  const name = normalizeText(product?.name)
    .replace(/\u00a0/g, " ")
    .replace(/â€“|–/g, "-");

  if (hasAnySuffix(partNumber, ["p3yt", "p3ya", "p3ym", ":p3y"])) {
    return "trianual";
  }

  if (hasAnySuffix(partNumber, ["p1ya", "p1ym", ":p1y"])) {
    return "anual";
  }

  if (hasAnySuffix(partNumber, ["p1mm", ":p1m"])) {
    return "mensual";
  }

  if (term.includes("p3y") || term.includes("trianual") || term.includes("trien") || /3\s*year/.test(name)) {
    return "trianual";
  }

  if (term.includes("p1y") || term.includes("anual") || /1\s*year/.test(name)) {
    return "anual";
  }

  if (term.includes("p1m") || term.includes("mensual") || term.includes("month")) {
    return "mensual";
  }

  if (term.includes("onetime") || term.includes("one time") || term.includes("perpetual")) {
    return "onetime";
  }

  return "";
}

function canonicalizeBilling(product) {
  const billing = normalizeText(product?.billing);
  const partNumber = normalizeText(product?.partNumber);
  const name = normalizeText(product?.name)
    .replace(/\u00a0/g, " ")
    .replace(/â€“|–/g, "-");

  if (hasAnySuffix(partNumber, ["p3yt"])) {
    return "trianual";
  }

  if (hasAnySuffix(partNumber, ["p3ya", "p1ya"])) {
    return "anual";
  }

  if (hasAnySuffix(partNumber, ["p3ym", "p1ym", "p1mm", ":p1m"])) {
    return "mensual";
  }

  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+tri\b|\((?:nce|csp)\s+(?:com|edu|nfp)\s+tri\)/i.test(name)) {
    return "trianual";
  }

  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+ann\b|\((?:nce|csp)\s+(?:com|edu|nfp)\s+ann\)/i.test(name)) {
    return "anual";
  }

  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+mth\b|\((?:nce|csp)\s+(?:com|edu|nfp)\s+mth\)/i.test(name)) {
    return "mensual";
  }

  if (billing.includes("trien") || billing.includes("trianual")) {
    return "trianual";
  }

  if (billing.includes("annual") || billing.includes("anual")) {
    return "anual";
  }

  if (billing.includes("monthly") || billing.includes("mensual")) {
    return "mensual";
  }

  if (billing.includes("onetime") || billing.includes("one time")) {
    return "onetime";
  }

  return "";
}

function createEmptyResults() {
  return DIST_ORDER.reduce((accumulator, dist) => {
    accumulator[dist] = [];
    return accumulator;
  }, {});
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function enrichProduct(product) {
  const canonicalName = String(product.canonicalName || getCanonicalProductName(product.name || "")).trim();
  const normalizedTerm = String(product.normalizedTerm || canonicalizeTerm(product)).trim();
  const normalizedBilling = String(product.normalizedBilling || canonicalizeBilling(product)).trim();
  const strictPeriodKey = String(
    product.strictPeriodKey ||
      getStrictPeriodKey({
        ...product,
        normalizedTerm,
        normalizedBilling,
      }),
  ).trim();
  const comparisonKey = [
    canonicalName,
    strictPeriodKey || "sin_periodo",
    product.type || "",
    normalizeText(product.segment),
  ].join("__");
  const rawType = String(product.type || "").trim().toUpperCase();
  const type =
    rawType === "NCE"
      ? "NCE"
      : rawType === "PERPETUO" || rawType === "PERPETUAL"
      ? "PERPETUO"
      : "SUSCRIPCION";
  const searchText = normalizeText(`${canonicalName} ${product.name || ""} ${product.partNumber || ""} ${product.productId || ""}`);
  return {
    ...product,
    type,
    canonicalName,
    normalizedTerm,
    normalizedBilling,
    strictPeriodKey,
    comparisonKey,
    searchText,
    searchWords: searchText.split(/\s+/).filter(Boolean),
  };
}

function getCanonicalProductName(value) {
  let normalized = String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/â€“|–/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized.replace(/\s+\((?:NCE|CSP)[^)]+\)$/i, "");
  normalized = normalized.replace(/\s+NCE\s+[A-Z]{3}\s+(?:ANN|MTH|TRI)$/i, "");
  normalized = normalized.replace(/\s*-\s*(?:1|3)\s*year(?:\s+subscription)?$/i, "");
  normalized = normalized.replace(/\s+(?:1|3)\s*year(?:\s+subscription)?$/i, "");
  normalized = normalized.replace(/\s*-\s*$/, "");

  return normalized.replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function hasAnySuffix(value, suffixes) {
  return suffixes.some((suffix) => value.endsWith(suffix));
}

function getOrderedFilterValues(products, key, optionDefs) {
  const rawValues = products
    .map((product) => {
      if (key === "segment") {
        return String(product.segment || "").trim();
      }

      return String(product[key] || "").trim();
    })
    .filter(Boolean);
  const uniqueValues = Array.from(new Set(rawValues));
  const orderedValues = optionDefs
    .map((option) => option.value)
    .filter((value) => uniqueValues.includes(value));
  const dynamicValues = uniqueValues
    .filter((value) => !orderedValues.includes(value))
    .sort((left, right) => left.localeCompare(right, "es", { sensitivity: "base" }));

  return orderedValues.concat(dynamicValues).map((value) => ({
    value,
    label: getOptionLabel(value, optionDefs),
  }));
}

function getOptionLabel(value, optionDefs) {
  const normalizedValue = normalizeText(value);
  const optionDef = optionDefs.find((option) => normalizeText(option.value) === normalizedValue);
  return optionDef?.label || value;
}

function setDynamicSelectOptions(filterKey, select, options, { allLabel, autoSelectSingle = false }) {
  if (!select) {
    return;
  }

  const previousValue = select.value;
  const previousWasAuto = state.autoSelectedFilters[filterKey];
  const newHtml = [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(
      options.map(
        (option) =>
          `<option value="${escapeAttribute(option.value)}">${escapeHtml(option.label)}</option>`,
      ),
    )
    .join("");

  if (select.innerHTML !== newHtml) {
    select.innerHTML = newHtml;
  }

  select.disabled = options.length === 0;
  const availableValues = options.map((option) => option.value);
  const hasSingleAutoOption = autoSelectSingle && availableValues.length === 1;
  const nextAutoValue = hasSingleAutoOption ? availableValues[0] : "";

  if (availableValues.includes(previousValue)) {
    if (previousWasAuto && previousValue !== nextAutoValue) {
      select.value = "";
      state.autoSelectedFilters[filterKey] = false;
      return;
    }

    select.value = previousValue;
    return;
  }

  if (hasSingleAutoOption) {
    select.value = nextAutoValue;
    state.autoSelectedFilters[filterKey] = true;
    return;
  }

  select.value = "";
  state.autoSelectedFilters[filterKey] = false;
}
