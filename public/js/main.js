import { APP_VERSION, state } from "./state.js";
import { setUnauthorizedHandler, api } from "./api.js";
import { t } from "./i18n.js";
import { $, $$, toast, closeModal, closeTopModal, errorText } from "./dom.js";
import { applyLanguage, applyTheme, setLanguage, toggleTheme, openPinChange, savePinChange } from "./prefs.js";
import {
  addDigit,
  removeDigit,
  submitPin,
  confirmCreate,
  cancelCreate,
  checkAppLock,
  rememberBackground,
  sessionExpired,
  startAuth,
} from "./auth.js";
import {
  loadLists,
  addItem,
  toggleDetails,
  toggleShopMode,
  onNameInput,
  initSwipe,
  canAutoSync,
  flushPendingDeletes,
  saveEdit,
} from "./lists.js";
import { loadHistory } from "./history.js";
import { loadRecipes, openRecipe, saveRecipe, confirmRecipeAdd } from "./recipes.js";
import { openSearch, onSearchInput } from "./search.js";
import { showView, currentView } from "./views.js";

const digitsOnly = (input) => () => (input.value = input.value.replace(/\D/g, "").slice(0, 4));

async function sync() {
  const button = $("#sync");
  button.classList.add("syncing");
  try {
    await loadLists();
    if (currentView() === "historyView") await loadHistory();
    if (currentView() === "recipesView") await loadRecipes();
    toast(t("syncDone"));
  } catch (error) {
    toast(error.status === 401 ? errorText(error) : t("syncError"), true);
  } finally {
    button.classList.remove("syncing");
  }
}

// Cabeçalho fixo, viewport visual (teclado do iPhone) e bloqueio do scroll de fundo com modais abertos.
function initViewport() {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const sync = () => {
    if (!vv) return;
    const keyboard = window.innerHeight - vv.height > 120;
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.style.setProperty("--vv-height", `${vv.height}px`);
    root.style.setProperty("--vv-safe-bottom", keyboard ? "0px" : "env(safe-area-inset-bottom)");
  };
  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);
  sync();
  const bar = document.querySelector(".topbar");
  const onScroll = () => bar?.classList.toggle("scrolled", window.scrollY > 4);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const update = () => document.body.classList.toggle("modal-open", Boolean(document.querySelector(".modal-backdrop:not([hidden])")));
  new MutationObserver(update).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
}

function bind() {
  initViewport();
  // PIN
  $$("[data-digit]").forEach((b) => b.addEventListener("click", () => addDigit(b.dataset.digit)));
  $("#deleteDigit").addEventListener("click", removeDigit);
  $("#continuePin").addEventListener("click", submitPin);
  $("#pinCreateConfirm").addEventListener("click", confirmCreate);
  $("#pinCreateCancel").addEventListener("click", cancelCreate);
  document.addEventListener("keydown", (e) => {
    if (
      $("#pinScreen").hidden ||
      !$("#pinCreate").hidden ||
      e.target.closest("input,textarea,select") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    )
      return;
    if (/^\d$/.test(e.key)) addDigit(e.key);
    else if (e.key === "Backspace") removeDigit();
    else if (e.key === "Enter") submitPin();
  });

  // Preferências
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => setLanguage(b.dataset.lang)));
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#settingsTheme").addEventListener("click", toggleTheme);
  $("#changePin").addEventListener("click", openPinChange);
  $("#pinChangeSave").addEventListener("click", savePinChange);
  $("#newPin").addEventListener("input", digitsOnly($("#newPin")));
  $("#confirmPin").addEventListener("input", digitsOnly($("#confirmPin")));

  // Listas
  $("#sync").addEventListener("click", sync);
  $("#addItem").addEventListener("click", addItem);
  $("#detailsToggle").addEventListener("click", () => toggleDetails());
  $("#itemName").addEventListener("keydown", (e) => e.key === "Enter" && addItem());
  $("#itemName").addEventListener("input", onNameInput);
  $("#shopMode").addEventListener("click", toggleShopMode);
  $("#editSave").addEventListener("click", saveEdit);
  initSwipe();
  // Navegação inferior: ativa no toque (touchend) e no clique. Em iOS, depois de fazer scroll, o primeiro
  // toque podia perder-se; os dois caminhos juntos garantem uma só ação, à primeira.
  $$(".nav-item").forEach((b) => {
    let touchStart = null;
    let lastTouch = 0;
    b.addEventListener("touchstart", (e) => (touchStart = e.touches[0]), { passive: true });
    b.addEventListener(
      "touchend",
      (e) => {
        const end = e.changedTouches[0];
        if (!touchStart || Math.hypot(end.clientX - touchStart.clientX, end.clientY - touchStart.clientY) > 12) return;
        lastTouch = Date.now();
        showView(b.dataset.view);
      },
      { passive: true },
    );
    b.addEventListener("click", () => Date.now() - lastTouch > 600 && showView(b.dataset.view));
  });

  // Receitas e pesquisa
  $("#addRecipe").addEventListener("click", () => openRecipe());
  $("#recipeSave").addEventListener("click", saveRecipe);
  $("#recipeAddConfirm").addEventListener("click", confirmRecipeAdd);
  $("#searchToggle").addEventListener("click", openSearch);
  $("#searchInput").addEventListener("input", onSearchInput);

  // Fechar modais: botões [data-close], clique no fundo e Escape
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
  $$(".modal-backdrop").forEach((m) => m.addEventListener("click", (e) => e.target === m && closeModal(m.id)));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeTopModal() && e.preventDefault());
}

// Sincronização automática: a cada 20 s com a app aberta e ao voltar ao primeiro plano.
async function refreshQuietly() {
  if (document.hidden || $("#app").hidden || !canAutoSync()) return;
  try {
    await loadLists();
    if (currentView() === "historyView") await loadHistory();
    if (currentView() === "recipesView") await loadRecipes();
  } catch {
    /* silencioso: o botão Sincronizar mostra erros */
  }
}
setInterval(refreshQuietly, 20000);
window.addEventListener("online", refreshQuietly);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    rememberBackground();
    flushPendingDeletes();
  } else {
    checkAppLock();
    refreshQuietly();
  }
});
window.addEventListener("pagehide", () => {
  rememberBackground();
  flushPendingDeletes();
});
window.addEventListener("pageshow", checkAppLock);

setUnauthorizedHandler(sessionExpired);
document.querySelectorAll(".app-version,.app-version-inside").forEach((e) => (e.textContent = `v${APP_VERSION}`));
applyTheme();
applyLanguage();
bind();
startAuth();

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
