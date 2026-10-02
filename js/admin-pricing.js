/**
 * admin-pricing.js - Módulo de Actualización de Listas de Precios para Provex One
 * Acceso exclusivo: analista.tecnico@provexpress.com.co
 */

import { ADMIN_PRICE_EMAIL, isPriceAdminUser } from "./auth.js";

const state = {
  parsedMicrosoft: null,
  microsoftMeta: null,
  parsedAcronis: null,
  acronisMeta: null,
  isPublishing: false,
};

// ── UTILIDADES DE NORMALIZACIÓN (Equivalentes a extractors/common.py) ──

function safeStr(val) {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function safeFloat(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return Number.isFinite(val) ? val : 0;
  const cleaned = String(val).replace(/[^0-9.,-]/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeHeader(val) {
  return safeStr(val)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveColumn(headers, ...candidates) {
  const normMap = {};
  for (const h of headers) {
    normMap[normalizeHeader(h)] = h;
  }
  for (const c of candidates) {
    const normC = normalizeHeader(c);
    if (normMap[normC]) return normMap[normC];
  }
  return null;
}

function normalizeNameText(val) {
  let s = safeStr(val);
  for (const d of ["â€“", "–", "—", "-"]) {
    s = s.replaceAll(d, "-");
  }
  return s.replace(/\s+/g, " ").trim();
}

function getCanonicalProductName(val) {
  let s = normalizeNameText(val);
  s = s.replace(/\s+\((?:NCE|CSP)[^)]+\)$/i, "");
  s = s.replace(/\s+NCE\s+[A-Z]{3}\s+(?:ANN|MTH|TRI)$/i, "");
  s = s.replace(/\s*-\s*(?:1|3)\s*year(?:\s+subscription)?$/i, "");
  s = s.replace(/\s+(?:1|3)\s*year(?:\s+subscription)?$/i, "");
  s = s.replace(/\s*-\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

function hasAnySuffix(str, suffixes) {
  const lower = str.toLowerCase();
  return suffixes.some((s) => lower.endsWith(s.toLowerCase()));
}

function canonicalizeTerm(term, partNumber, name) {
  const nTerm = normalizeHeader(term);
  const nPart = normalizeHeader(partNumber);
  const nName = normalizeHeader(name);

  if (hasAnySuffix(nPart, ["p3yt", "p3ya", "p3ym", ":p3y"])) return "trianual";
  if (hasAnySuffix(nPart, ["p1ya", "p1ym", ":p1y"])) return "anual";
  if (hasAnySuffix(nPart, ["p1mm", ":p1m"])) return "mensual";

  if (nTerm.includes("p3y") || nTerm.includes("trianual") || nTerm.includes("trien") || /3\s*year/i.test(nName)) {
    return "trianual";
  }
  if (nTerm.includes("p1y") || nTerm.includes("anual") || /1\s*year/i.test(nName)) {
    return "anual";
  }
  if (nTerm.includes("p1m") || nTerm.includes("mensual") || nTerm.includes("month")) {
    return "mensual";
  }
  if (nTerm.includes("onetime") || nTerm.includes("one time") || nTerm.includes("perpetual")) {
    return "onetime";
  }
  return "";
}

function canonicalizeBilling(billing, partNumber, name) {
  const nBill = normalizeHeader(billing);
  const nPart = normalizeHeader(partNumber);
  const nName = normalizeHeader(name);

  if (hasAnySuffix(nPart, ["p3yt"])) return "trianual";
  if (hasAnySuffix(nPart, ["p3ya", "p1ya"])) return "anual";
  if (hasAnySuffix(nPart, ["p3ym", "p1ym", "p1mm", ":p1m"])) return "mensual";

  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+tri\b/i.test(nName) || /\((?:nce|csp)\s+(?:com|edu|nfp)\s+tri\)/i.test(nName)) {
    return "trianual";
  }
  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+ann\b/i.test(nName) || /\((?:nce|csp)\s+(?:com|edu|nfp)\s+ann\)/i.test(nName)) {
    return "anual";
  }
  if (/\b(?:nce|csp)\s+(?:com|edu|nfp)\s+mth\b/i.test(nName) || /\((?:nce|csp)\s+(?:com|edu|nfp)\s+mth\)/i.test(nName)) {
    return "mensual";
  }
  if (nBill.includes("trien") || nBill.includes("trianual")) return "trianual";
  if (nBill.includes("annual") || nBill.includes("anual")) return "anual";
  if (nBill.includes("monthly") || nBill.includes("mensual")) return "mensual";
  if (nBill.includes("onetime") || nBill.includes("one time")) return "onetime";
  return "";
}

function getStrictPeriodKey(term, billing) {
  const combo = `${term}|${billing}`;
  const map = {
    "mensual|mensual": "mensual_mensual",
    "anual|anual": "anual_anual",
    "anual|mensual": "anual_mensual",
    "trianual|anual": "trianual_anual",
    "trianual|trianual": "trianual_trianual",
    "trianual|mensual": "trianual_mensual",
    "onetime|onetime": "onetime_onetime",
  };
  return map[combo] || "";
}

// ── EXTRACTOR MICROSOFT CLOUD (Sheets: NCE, Perpetuo, Software Subscripción) ──

export function parseMicrosoftWorkbook(workbook) {
  const items = [];
  const sheetNames = workbook.SheetNames || [];

  for (const sheetName of sheetNames) {
    const sLower = sheetName.toLowerCase();
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows || rows.length === 0) continue;

    const headers = Object.keys(rows[0] || {});
    const erpCol = resolveColumn(headers, "ERP Price", "ERP", "ERP_Price");
    const productIdCol = resolveColumn(headers, "ProductId", "Product Id", "ProductID");
    const partCol = resolveColumn(headers, "NUMERO DE PARTE", "Numero Parte", "Part Number", "ProductId", "Product Id", "ProductID");
    const nameCol = resolveColumn(headers, "SkuTitle", "Descripción", "Descripcion", "Product Title", "Title", "ProductTitle");
    const termCol = resolveColumn(headers, "TermDuration", "Term");
    const billingCol = resolveColumn(headers, "BillingPlan", "Billing Plan", "Billing");
    const priceCol = resolveColumn(headers, "PARTNER PRICE", "Partner Price", "UnitPrice", "Unit Price", "Unit_Price", "Price");
    const segmentCol = resolveColumn(headers, "Segment");

    // Tipo por defecto por nombre de hoja
    let defaultType = "NCE";
    if (sLower.includes("perpetu")) {
      defaultType = "PERPETUO";
    } else if (sLower.includes("suscrip") || sLower.includes("subscript") || sLower.includes("software")) {
      defaultType = "SUSCRIPCION";
    } else if (sLower.includes("nce")) {
      defaultType = "NCE";
    }

    for (const row of rows) {
      const name = nameCol ? safeStr(row[nameCol]) : "";
      const price = priceCol ? safeFloat(row[priceCol]) : 0;
      if (!name || price <= 0) continue;

      const rawSegment = segmentCol ? safeStr(row[segmentCol]) : "";
      const segUpper = rawSegment.toUpperCase();
      const nameUpper = name.toUpperCase();

      // Excluir Charity / NonProfit
      if (
        segUpper.includes("CHARITY") ||
        segUpper.includes("NONPROFIT") ||
        segUpper.includes("NFP") ||
        nameUpper.includes("NON-PROFIT") ||
        nameUpper.includes("NONPROFIT")
      ) {
        continue;
      }

      const normalizedSegment = (segUpper.includes("EDU") || segUpper.includes("FACULTY") || segUpper.includes("STUDENT"))
        ? "Education"
        : "Commercial";

      const productId = productIdCol ? safeStr(row[productIdCol]) : "";
      const partNumber = (partCol ? safeStr(row[partCol]) : "") || productId;
      let rawTerm = termCol ? safeStr(row[termCol]) : "";
      let rawBilling = billingCol ? safeStr(row[billingCol]) : "";
      const erp = erpCol ? safeFloat(row[erpCol]) : 0;

      let rowType = defaultType;
      if (defaultType === "PERPETUO") {
        rowType = "PERPETUO";
      } else if (sLower.includes("software")) {
        rowType = "SUSCRIPCION";
      } else if (
        name.toLowerCase().includes("server") &&
        (name.toLowerCase().includes("1 year") || name.toLowerCase().includes("3 year")) &&
        (name.toLowerCase().includes("azure") || name.toLowerCase().includes("esu") || name.toLowerCase().includes("sql"))
      ) {
        rowType = "SUSCRIPCION";
      }

      let cleanTerm = rawTerm;
      let cleanBilling = rawBilling;
      let normalizedTerm = "";
      let normalizedBilling = "";
      let strictPeriodKey = "";

      if (rowType === "PERPETUO") {
        cleanTerm = "OneTime";
        cleanBilling = "OneTime";
        normalizedTerm = "onetime";
        normalizedBilling = "onetime";
        strictPeriodKey = "onetime_onetime";
      } else {
        normalizedTerm = canonicalizeTerm(cleanTerm, partNumber, name);
        normalizedBilling = canonicalizeBilling(cleanBilling, partNumber, name);
        strictPeriodKey = getStrictPeriodKey(normalizedTerm, normalizedBilling);
      }

      items.push({
        area: "cloud",
        distributor: "LOL",
        type: rowType,
        partNumber: partNumber,
        productId: productId,
        name: normalizeNameText(name),
        term: cleanTerm,
        billing: cleanBilling,
        price: price,
        erp: erp,
        segment: normalizedSegment,
        canonicalName: getCanonicalProductName(name),
        normalizedTerm: normalizedTerm,
        normalizedBilling: normalizedBilling,
        strictPeriodKey: strictPeriodKey,
      });
    }
  }

  return items;
}

// ── EXTRACTOR ACRONIS CALCULATOR (Sheets: Pricelist USD, Solution-based, Service-based, Cloud DCs) ──

export function parseAcronisWorkbook(workbook) {
  const sheetNames = workbook.SheetNames || [];
  const required = ["Pricelist USD", "Solution-based", "Service-based", "Cloud DCs"];
  const missing = required.filter((r) => !sheetNames.includes(r));
  if (missing.length > 0) {
    throw new Error(`El archivo de Acronis no contiene las hojas obligatorias: ${missing.join(", ")}`);
  }

  // 1. Pricelist USD
  const priceRows = window.XLSX.utils.sheet_to_json(workbook.Sheets["Pricelist USD"], { header: 1, defval: "" });
  
  // Row 2 in Excel (index 1 in 0-indexed) has commitment thresholds in cols 6 to 12
  const commitRow = priceRows[1] || [];
  const commitments = [];
  for (let c = 6; c <= 12; c++) {
    const val = safeFloat(commitRow[c]);
    if (val > 0) commitments.push(val);
  }

  const prices = {};
  const skus = {};

  for (let r = 2; r < priceRows.length; r++) {
    const cells = priceRows[r] || [];
    const desc = safeStr(cells[14]);
    const dcGroup = safeStr(cells[4]);
    if (!desc || !["All", "G1", "G2"].includes(dcGroup)) continue;

    const key = desc.toLowerCase().replace(/\s+/g, " ").trim();
    const tierPrices = [];
    for (let c = 6; c <= 12; c++) {
      tierPrices.push(safeFloat(cells[c]));
    }

    if (!prices[key]) prices[key] = {};
    if (!skus[key]) skus[key] = {};

    prices[key][dcGroup] = tierPrices;
    skus[key][dcGroup] = safeStr(cells[5]);
  }

  // 2. Solution-based
  const solRows = window.XLSX.utils.sheet_to_json(workbook.Sheets["Solution-based"], { header: 1, defval: "" });
  const solution = [];
  let curCategory = "";
  let curSubcategory = "";

  const noteMap = {
    "Requires Security+RMM or Ultimate Protection": "Requiere Security + RMM o Ultimate Protection",
    "Requires BDR or Ultimate Protection": "Requiere BDR o Ultimate Protection",
    "Requires EDR/XDR": "Requiere EDR o XDR",
    "Requires Backup": "Requiere Backup",
  };

  for (let r = 7; r <= 48 && r < solRows.length; r++) {
    const rowNumber = r + 1;
    if (rowNumber === 22 || rowNumber === 36) continue; // headers / spacers
    const cells = solRows[r] || [];
    const desc = safeStr(cells[2]);
    if (!desc) continue;

    const rowCat = safeStr(cells[0]);
    const rowSub = safeStr(cells[1]);
    if (rowCat) {
      curCategory = rowCat;
      curSubcategory = rowSub;
    } else if (rowSub) {
      curSubcategory = rowSub;
    }

    const key = desc.toLowerCase().replace(/\s+/g, " ").trim();
    const itemPrices = prices[key];
    if (!itemPrices) continue;

    let note = safeStr(cells[3]);
    if (note.toLowerCase() === "yes") note = "Disponible de forma independiente";
    note = noteMap[note] || note;

    solution.push({
      id: `solution-${rowNumber}`,
      category: curCategory || "Otros",
      subcategory: curSubcategory,
      description: desc,
      note: note,
      prices: itemPrices,
      skus: skus[key] || {},
    });
  }

  // 3. Service-based
  const srvRows = window.XLSX.utils.sheet_to_json(workbook.Sheets["Service-based"], { header: 1, defval: "" });
  const service = [];
  curCategory = "";
  curSubcategory = "";

  for (let r = 5; r <= 71 && r < srvRows.length; r++) {
    const rowNumber = r + 1;
    if (rowNumber === 59) continue; // spacer
    const cells = srvRows[r] || [];
    const desc = safeStr(cells[2]);
    if (!desc) continue;

    const rowCat = safeStr(cells[0]);
    const rowSub = safeStr(cells[1]);
    if (rowCat) {
      curCategory = rowCat;
      curSubcategory = rowSub;
    } else if (rowSub) {
      curSubcategory = rowSub;
    }

    const key = desc.toLowerCase().replace(/\s+/g, " ").trim();
    const itemPrices = prices[key];
    if (!itemPrices) continue;

    let note = safeStr(cells[3]);
    if (note.toLowerCase() === "yes") note = "Disponible de forma independiente";
    note = noteMap[note] || note;

    service.push({
      id: `service-${rowNumber}`,
      category: curCategory || "Otros",
      subcategory: curSubcategory,
      description: desc,
      note: note,
      prices: itemPrices,
      skus: skus[key] || {},
    });
  }

  // 4. Cloud DCs
  const dcRows = window.XLSX.utils.sheet_to_json(workbook.Sheets["Cloud DCs"], { header: 1, defval: "" });
  const datacenters = { G1: [], G2: [] };

  for (let r = 2; r < dcRows.length; r++) {
    const cells = dcRows[r] || [];
    const group = safeStr(cells[2]);
    const country = safeStr(cells[3]);
    const city = safeStr(cells[4]);
    if (datacenters[group] && city) {
      datacenters[group].push({
        label: country ? `${city}, ${country}` : city,
        city: city,
        country: country,
      });
    }
  }

  return {
    source: "Acronis Cyber Cloud Calculator",
    currency: "USD",
    priceList: "Actualizado",
    commitments: commitments.length ? commitments : [250, 500, 1000, 2000, 4000, 7000, 10000],
    datacenters: datacenters,
    solution: solution,
    service: service,
  };
}

// ── INTEGRACIÓN CON GITHUB API ──

async function getGitHubFileSha(owner, repo, path, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) {
      const data = await res.json();
      return data.sha || null;
    }
  } catch (err) {
    console.warn("Could not get SHA for", path, err);
  }
  return null;
}

async function putGitHubFile(owner, repo, path, jsonPayload, commitMessage, token) {
  const sha = await getGitHubFileSha(owner, repo, path, token);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const jsonString = JSON.stringify(jsonPayload, null, 2);
  const utf8Bytes = new TextEncoder().encode(jsonString);
  let binary = "";
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const base64Content = btoa(binary);

  const body = {
    message: commitMessage,
    content: base64Content,
    branch: "master",
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(`GitHub API Error (${res.status}): ${errorJson.message || res.statusText}`);
  }

  return await res.json();
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── INICIALIZACIÓN DE LA UI DEL PANEL DE ADMINISTRACIÓN ──

export function initAdminPricing() {
  if (!isPriceAdminUser()) {
    return;
  }

  // 1. Mostrar botones de acceso al admin
  const adminNavBtn = document.getElementById("adminPricingBtn");
  if (adminNavBtn) adminNavBtn.hidden = false;

  const adminBanner = document.getElementById("adminPricingBanner");
  if (adminBanner) adminBanner.hidden = false;

  // 2. Vincular apertura y cierre de modal
  const modal = document.getElementById("adminPricingModal");
  const openButtons = [adminNavBtn, document.getElementById("adminPricingOpenBtn")].filter(Boolean);
  const closeButtons = [
    document.getElementById("adminPricingCloseBtn"),
    document.getElementById("adminPricingModalClose"),
  ].filter(Boolean);

  openButtons.forEach((btn) => btn.addEventListener("click", () => openModal(modal)));
  closeButtons.forEach((btn) => btn.addEventListener("click", () => closeModal(modal)));

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal(modal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeModal(modal);
  });

  // 3. Cargar token guardado
  const tokenInput = document.getElementById("adminGhToken");
  if (tokenInput) {
    const savedToken = localStorage.getItem("provex_gh_token");
    if (savedToken) tokenInput.value = savedToken;
    tokenInput.addEventListener("input", () => {
      localStorage.setItem("provex_gh_token", tokenInput.value.trim());
    });
  }

  // 4. File handlers: Microsoft
  setupDropZone({
    dropZoneId: "adminMsDropZone",
    inputId: "adminMsFileInput",
    onFileLoaded: handleMicrosoftFile,
  });

  // 5. File handlers: Acronis
  setupDropZone({
    dropZoneId: "adminAcronisDropZone",
    inputId: "adminAcronisFileInput",
    onFileLoaded: handleAcronisFile,
  });

  // 6. Botones de acción principales
  document.getElementById("adminPublishBtn")?.addEventListener("click", handlePublishToGitHub);
  document.getElementById("adminDownloadMsBtn")?.addEventListener("click", () => {
    if (state.parsedMicrosoft) downloadJsonFile("products.json", state.parsedMicrosoft);
  });
  document.getElementById("adminDownloadAcronisBtn")?.addEventListener("click", () => {
    if (state.parsedAcronis) downloadJsonFile("acronis_products.json", state.parsedAcronis);
  });
  document.getElementById("adminApplySessionBtn")?.addEventListener("click", handleApplyToSession);
}

function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function setupDropZone({ dropZoneId, inputId, onFileLoaded }) {
  const dropZone = document.getElementById(dropZoneId);
  const input = document.getElementById(inputId);
  if (!dropZone || !input) return;

  dropZone.addEventListener("click", () => input.click());

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const files = e.dataTransfer?.files;
    if (files && files[0]) onFileLoaded(files[0]);
  });

  input.addEventListener("change", () => {
    if (input.files && input.files[0]) onFileLoaded(input.files[0]);
  });
}

// ── HANDLERS DE CARGA ──

async function handleMicrosoftFile(file) {
  const statusEl = document.getElementById("adminMsStatus");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showError(statusEl, "Por favor selecciona un archivo Excel válido (.xlsx)");
    return;
  }

  showLoading(statusEl, `Leyendo y procesando "${file.name}"...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: "array" });
    const items = parseMicrosoftWorkbook(workbook);

    if (!items || items.length === 0) {
      throw new Error("No se encontraron productos válidos en el archivo. Revisa las columnas y pestañas.");
    }

    state.parsedMicrosoft = items;
    const nceCount = items.filter((i) => i.type === "NCE").length;
    const subsCount = items.filter((i) => i.type === "SUSCRIPCION").length;
    const perpCount = items.filter((i) => i.type === "PERPETUO").length;

    state.microsoftMeta = {
      filename: file.name,
      total: items.length,
      nce: nceCount,
      subs: subsCount,
      perp: perpCount,
    };

    showSuccess(
      statusEl,
      `✅ <strong>${file.name}</strong> procesado con éxito:<br>` +
        `<strong>${items.length.toLocaleString("es-CO")}</strong> productos válidos (` +
        `${nceCount.toLocaleString("es-CO")} NCE · ` +
        `${subsCount.toLocaleString("es-CO")} Suscripción · ` +
        `${perpCount.toLocaleString("es-CO")} Perpetuo)`,
    );

    document.getElementById("adminDownloadMsBtn")?.removeAttribute("disabled");
    updateActionButtonsState();
  } catch (err) {
    console.error("Microsoft Excel parse error:", err);
    showError(statusEl, `Error al procesar archivo: ${err.message}`);
  }
}

async function handleAcronisFile(file) {
  const statusEl = document.getElementById("adminAcronisStatus");
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showError(statusEl, "Por favor selecciona un archivo Excel válido (.xlsx)");
    return;
  }

  showLoading(statusEl, `Leyendo y procesando calculadora "${file.name}"...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: "array" });
    const catalog = parseAcronisWorkbook(workbook);

    state.parsedAcronis = catalog;
    state.acronisMeta = {
      filename: file.name,
      solutions: catalog.solution.length,
      services: catalog.service.length,
      commitments: catalog.commitments.length,
    };

    showSuccess(
      statusEl,
      `✅ <strong>${file.name}</strong> procesado con éxito:<br>` +
        `<strong>${catalog.solution.length}</strong> soluciones por edición · ` +
        `<strong>${catalog.service.length}</strong> servicios y almacenamiento · ` +
        `<strong>${catalog.commitments.length}</strong> niveles de compromiso detectados`,
    );

    document.getElementById("adminDownloadAcronisBtn")?.removeAttribute("disabled");
    updateActionButtonsState();
  } catch (err) {
    console.error("Acronis Excel parse error:", err);
    showError(statusEl, `Error al procesar archivo: ${err.message}`);
  }
}

function updateActionButtonsState() {
  const canPublish = Boolean(state.parsedMicrosoft || state.parsedAcronis);
  const publishBtn = document.getElementById("adminPublishBtn");
  const applyBtn = document.getElementById("adminApplySessionBtn");
  if (publishBtn) publishBtn.disabled = !canPublish;
  if (applyBtn) applyBtn.disabled = !canPublish;
}

// ── PUBLICACIÓN A GITHUB ──

async function handlePublishToGitHub() {
  const publishStatus = document.getElementById("adminPublishStatus");
  const token = localStorage.getItem("provex_gh_token");

  if (!token) {
    showError(
      publishStatus,
      "Por favor ingresa un GitHub Personal Access Token con permiso 'repo' o 'contents:write' para publicar automáticamente.",
    );
    document.getElementById("adminGhToken")?.focus();
    return;
  }

  if (!state.parsedMicrosoft && !state.parsedAcronis) {
    showError(publishStatus, "Primero debes cargar al menos un archivo Excel válido (Microsoft o Acronis).");
    return;
  }

  state.isPublishing = true;
  const publishBtn = document.getElementById("adminPublishBtn");
  if (publishBtn) publishBtn.disabled = true;

  showLoading(publishStatus, "Conectando con GitHub API y preparando commits...");

  try {
    const owner = "Provexpress";
    const repo = "Provex-One";
    const dateStr = new Date().toLocaleDateString("es-CO");

    // 1. Si cargó Microsoft:
    if (state.parsedMicrosoft) {
      showLoading(publishStatus, "Actualizando products.json y catalogs/cloud_products.json en GitHub...");
      await putGitHubFile(
        owner,
        repo,
        "products.json",
        state.parsedMicrosoft,
        `feat(precios): actualización Microsoft por analista.tecnico (${dateStr})`,
        token,
      );
      await putGitHubFile(
        owner,
        repo,
        "catalogs/cloud_products.json",
        state.parsedMicrosoft,
        `feat(precios): sincronización cloud_products.json (${dateStr})`,
        token,
      );
    }

    // 2. Si cargó Acronis:
    if (state.parsedAcronis) {
      showLoading(publishStatus, "Actualizando catalogs/acronis_products.json en GitHub...");
      await putGitHubFile(
        owner,
        repo,
        "catalogs/acronis_products.json",
        state.parsedAcronis,
        `feat(precios): actualización Acronis por analista.tecnico (${dateStr})`,
        token,
      );
    }

    // 3. Actualizar manifest
    showLoading(publishStatus, "Actualizando catálogo manifiesto...");
    let manifestSha = await getGitHubFileSha(owner, repo, "catalogs/catalog_manifest.json", token);
    const updatedManifest = {
      areas: [
        {
          id: "cloud",
          label: "Licencias Microsoft",
          kind: "comparison",
          catalog: "cloud_products.json",
          records: state.parsedMicrosoft ? state.parsedMicrosoft.length : 2434,
        },
        {
          id: "acronis",
          label: "Calculadora Acronis",
          kind: "calculator",
          catalog: "acronis_products.json",
          records: state.parsedAcronis ? state.parsedAcronis.solution.length + state.parsedAcronis.service.length : 106,
        },
        {
          id: "kaspersky",
          label: "Licencias Kaspersky",
          kind: "comparison",
          catalog: "kaspersky_products.json",
          records: 209,
        },
      ],
    };
    await putGitHubFile(
      owner,
      repo,
      "catalogs/catalog_manifest.json",
      updatedManifest,
      `feat(manifest): actualización conteos oficiales (${dateStr})`,
      token,
    );

    showSuccess(
      publishStatus,
      `🚀 <strong>¡Publicación exitosa en GitHub!</strong><br>` +
        `Los nuevos precios han quedado confirmados en la rama principal.<br>` +
        `GitHub Pages se actualizará automáticamente en <strong>1 a 2 minutos</strong> para todos los usuarios de Provexpress.`,
    );
  } catch (err) {
    console.error("Error al publicar en GitHub:", err);
    showError(publishStatus, `No se pudo publicar: ${err.message}`);
  } finally {
    state.isPublishing = false;
    if (publishBtn) publishBtn.disabled = false;
  }
}

// ── PROBAR EN ESTA SESIÓN ──

function handleApplyToSession() {
  const statusEl = document.getElementById("adminPublishStatus");
  let msg = [];

  if (state.parsedMicrosoft) {
    window.__CUSTOM_PRODUCTS = state.parsedMicrosoft;
    window.dispatchEvent(new CustomEvent("provex:update-products", { detail: state.parsedMicrosoft }));
    msg.push(`Microsoft (${state.parsedMicrosoft.length} items)`);
  }

  if (state.parsedAcronis) {
    window.__CUSTOM_ACRONIS = state.parsedAcronis;
    window.dispatchEvent(new CustomEvent("provex:update-acronis", { detail: state.parsedAcronis }));
    msg.push(`Acronis (${state.parsedAcronis.solution.length + state.parsedAcronis.service.length} items)`);
  }

  if (msg.length > 0) {
    showSuccess(
      statusEl,
      `⚡ <strong>Precios activados en esta sesión:</strong> ${msg.join(" y ")}. Ya puedes cerrar esta ventana y probarlos en vivo.`,
    );
  }
}

// ── HELPERS DE MENSAJES DE ESTADO ──

function showLoading(el, msg) {
  if (!el) return;
  el.className = "admin-status-box loading";
  el.innerHTML = `<span class="spinner"></span> ${msg}`;
}

function showSuccess(el, msg) {
  if (!el) return;
  el.className = "admin-status-box success";
  el.innerHTML = msg;
}

function showError(el, msg) {
  if (!el) return;
  el.className = "admin-status-box error";
  el.innerHTML = `⚠️ ${msg}`;
}
