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
import { loadLists, addItem, toggleDetails, clearCompleted, saveEdit, updateCategoryButtons } from "./lists.js";
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

function bind() {
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
  $("#clearCompleted").addEventListener("click", clearCompleted);
  $("#editSave").addEventListener("click", saveEdit);
  $$("[data-category]").forEach((b) =>
    b.addEventListener("click", () => ((state.activeCategory = b.dataset.category), updateCategoryButtons())),
  );
  $$("[data-edit-category]").forEach((b) =>
    b.addEventListener("click", () => ((state.editCategory = b.dataset.editCategory), updateCategoryButtons())),
  );
  $$(".nav-item").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

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

document.addEventListener("visibilitychange", () => (document.hidden ? rememberBackground() : checkAppLock()));
window.addEventListener("pagehide", rememberBackground);
window.addEventListener("pageshow", checkAppLock);

setUnauthorizedHandler(sessionExpired);
document.querySelectorAll(".app-version,.app-version-inside").forEach((e) => (e.textContent = `v${APP_VERSION}`));
applyTheme();
applyLanguage();
bind();
startAuth();

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
