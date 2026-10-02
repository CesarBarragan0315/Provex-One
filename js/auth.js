import { loginRequest, microsoftEntraConfig } from "./auth-config.js";

export const ADMIN_PRICE_EMAIL = "analista.tecnico@provexpress.com.co";

export function isPriceAdminUser() {
  const accountEmail = (
    state.currentAccount?.username ||
    state.currentAccount?.idTokenClaims?.preferred_username ||
    state.currentAccount?.idTokenClaims?.email ||
    ""
  ).toLowerCase().trim();
  return accountEmail === ADMIN_PRICE_EMAIL.toLowerCase();
}

const MSAL_SOURCES = [
  "https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js",
  "https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.3/lib/msal-browser.min.js",
];

const state = {
  msalApp: null,
  currentAccount: null,
  appBooted: false,
};

const elements = {
  authGate: document.getElementById("authGate"),
  authConnectBtn: document.getElementById("authConnectBtn"),
  authStatus: document.getElementById("authStatus"),
  authUser: document.getElementById("authUser"),
  authLogoutBtn: document.getElementById("authLogoutBtn"),
  appShell: document.getElementById("appShell"),
};

export async function initializeAuthApp() {
  bindEvents();
  updateAuthStatus("Verificando acceso corporativo...");

  try {
    await loadMsal();
    const app = initMsal();
    const redirectResult = await app.handleRedirectPromise();

    state.currentAccount = redirectResult?.account || app.getAllAccounts()[0] || null;

    if (state.currentAccount) {
      setActiveAccount(state.currentAccount);
      await unlockApp();
      return;
    }

    setLoggedOutUi();
    updateAuthStatus("Ingresa con tu cuenta corporativa de Provexpress");
  } catch (error) {
    console.error("Auth init error", error);
    setLoggedOutUi();
    updateAuthStatus(formatAuthError(error));
  }
}

function bindEvents() {
  elements.authConnectBtn?.addEventListener("click", connectMicrosoft);
  elements.authLogoutBtn?.addEventListener("click", logoutMicrosoft);
}

function initMsal() {
  if (!window.msal) {
    throw new Error("MSAL no esta disponible");
  }

  if (state.msalApp) {
    return state.msalApp;
  }

  state.msalApp = new window.msal.PublicClientApplication({
    auth: {
      clientId: microsoftEntraConfig.clientId,
      authority: `https://login.microsoftonline.com/${microsoftEntraConfig.tenantId}`,
      redirectUri: getAuthRedirectUri(),
      postLogoutRedirectUri: getAuthRedirectUri(),
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  });

  return state.msalApp;
}

function loadMsal() {
  if (window.msal) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const loadSource = (index) => {
      if (!MSAL_SOURCES[index]) {
        reject(new Error("No se pudo cargar la libreria Microsoft"));
        return;
      }

      const script = document.createElement("script");
      script.src = MSAL_SOURCES[index];
      script.async = true;
      script.onload = () => {
        if (window.msal) {
          resolve();
          return;
        }

        loadSource(index + 1);
      };
      script.onerror = () => loadSource(index + 1);
      document.head.appendChild(script);
    };

    loadSource(0);
  });
}

async function connectMicrosoft() {
  if (!elements.authConnectBtn) {
    return;
  }

  elements.authConnectBtn.disabled = true;
  updateAuthStatus("Redirigiendo a Microsoft...");

  try {
    const app = initMsal();
    await app.loginRedirect(loginRequest);
  } catch (error) {
    console.error("Microsoft login error", error);
    elements.authConnectBtn.disabled = false;
    updateAuthStatus(formatAuthError(error));
  }
}

async function logoutMicrosoft() {
  try {
    const app = initMsal();
    await app.logoutRedirect({
      account: state.currentAccount || undefined,
      postLogoutRedirectUri: getAuthRedirectUri(),
    });
  } catch (error) {
    console.error("Microsoft logout error", error);
    updateAuthStatus("No pudimos cerrar la sesion en este momento.");
  }
}

async function unlockApp() {
  setAuthenticatedUi();

  if (!state.appBooted) {
    const modulesToLoad = [
      import("./search.js"),
      import("./acronis.js"),
      import("./kaspersky.js"),
    ];
    if (isPriceAdminUser()) {
      modulesToLoad.push(
        import("./admin-pricing.js")
          .then((m) => m.initAdminPricing?.())
          .catch((err) => console.error("Admin pricing init error", err))
      );
    }
    const modules = await Promise.allSettled(modulesToLoad);
    modules.forEach((moduleResult) => {
      if (moduleResult.status === "rejected") {
        console.error("Provex One module init error", moduleResult.reason);
      }
    });
    state.appBooted = true;
  } else if (isPriceAdminUser()) {
    import("./admin-pricing.js")
      .then((m) => m.initAdminPricing?.())
      .catch((err) => console.error("Admin pricing init error", err));
  }
}

function setLoggedOutUi() {
  document.body.classList.add("auth-pending");
  document.body.classList.remove("auth-ready");
  elements.authGate?.classList.remove("auth-hidden");
  elements.appShell?.classList.add("app-locked");
  elements.appShell?.setAttribute("aria-hidden", "true");

  if (elements.authUser) {
    elements.authUser.hidden = true;
    elements.authUser.textContent = "";
  }

  if (elements.authLogoutBtn) {
    elements.authLogoutBtn.hidden = true;
  }

  if (elements.authConnectBtn) {
    elements.authConnectBtn.disabled = false;
  }

  const adminBtn = document.getElementById("adminPricingBtn");
  if (adminBtn) adminBtn.hidden = true;
  const adminBanner = document.getElementById("adminPricingBanner");
  if (adminBanner) adminBanner.hidden = true;
}

function setAuthenticatedUi() {
  document.body.classList.remove("auth-pending");
  document.body.classList.add("auth-ready");
  elements.authGate?.classList.add("auth-hidden");
  elements.appShell?.classList.remove("app-locked");
  elements.appShell?.setAttribute("aria-hidden", "false");

  if (elements.authUser) {
    elements.authUser.hidden = false;
    elements.authUser.textContent = getDisplayName();
  }

  if (elements.authLogoutBtn) {
    elements.authLogoutBtn.hidden = false;
  }

  if (elements.authConnectBtn) {
    elements.authConnectBtn.disabled = false;
  }

  const isAdmin = isPriceAdminUser();
  const adminBtn = document.getElementById("adminPricingBtn");
  if (adminBtn) adminBtn.hidden = !isAdmin;
  const adminBanner = document.getElementById("adminPricingBanner");
  if (adminBanner) adminBanner.hidden = !isAdmin;

  updateAuthStatus(`Conectado como ${getDisplayName()}`);
}

function setActiveAccount(account) {
  state.currentAccount = account;
  state.msalApp?.setActiveAccount?.(account);
}

function getDisplayName() {
  return (
    state.currentAccount?.name ||
    state.currentAccount?.username ||
    "Usuario corporativo"
  );
}

function updateAuthStatus(message) {
  if (elements.authStatus) {
    elements.authStatus.textContent = message;
  }
}

function formatAuthError(error) {
  const message = String(error?.errorMessage || error?.message || "").toLowerCase();

  if (message.includes("aadsts50105") || message.includes("not assigned to a role")) {
    return "Tu cuenta no tiene acceso asignado a Provex One. Pide habilitacion al administrador.";
  }

  if (message.includes("popup_window_error") || message.includes("user_cancelled")) {
    return "La autenticacion se interrumpio antes de completarse. Intenta de nuevo.";
  }

  return "No pudimos iniciar el acceso corporativo. Intenta de nuevo.";
}

function getAuthRedirectUri() {
  const origin = window.location.origin || "";
  let path = window.location.pathname || "/";
  path = path.split("?")[0].split("#")[0];

  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"/index.html".length) || "/";
  }

  if (!path.endsWith("/")) {
    path += "/";
  }

  return `${origin}${path}`;
}
