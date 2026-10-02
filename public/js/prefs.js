// Preferências por dispositivo (idioma, tema) e alteração do PIN do agregado.
import { state, store, KEYS } from "./state.js";
import { api } from "./api.js";
import { t, translateDocument } from "./i18n.js";
import { $, setIcon, toast, openModal, closeModal, errorText } from "./dom.js";
import { renderLists, renderItems } from "./lists.js";
import { renderHistory } from "./history.js";
import { renderRecipes } from "./recipes.js";

const THEME_COLORS = { light: "#f1f2e4", dark: "#161a14" };

export function applyLanguage() {
  translateDocument();
  updateThemeControls();
  renderLists();
  renderItems();
  renderHistory();
  renderRecipes();
}
export function setLanguage(lang) {
  state.lang = lang;
  store.set(KEYS.lang, lang);
  applyLanguage();
}

function updateThemeControls() {
  const dark = state.theme === "dark";
  const toggle = $("#themeToggle");
  setIcon(toggle.querySelector("svg"), dark ? "sun" : "moon");
  toggle.title = dark ? t("light") : t("dark");
  toggle.setAttribute("aria-pressed", String(dark));
  $("#settingsTheme").textContent = dark ? t("dark") : t("light");
}
export function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('meta[name="theme-color"]').setAttribute("content", THEME_COLORS[state.theme]);
  updateThemeControls();
}
export function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  store.set(KEYS.theme, state.theme);
  applyTheme();
}

export function openPinChange() {
  $("#newPin").value = "";
  $("#confirmPin").value = "";
  $("#pinChangeError").textContent = "";
  openModal("pinChangeModal", "#newPin");
}
export async function savePinChange() {
  const [p1, p2] = [$("#newPin").value.trim(), $("#confirmPin").value.trim()];
  const error = $("#pinChangeError");
  error.textContent = "";
  if (!/^\d{4}$/.test(p1) || !/^\d{4}$/.test(p2)) return void (error.textContent = t("pinFormat"));
  if (p1 !== p2) return void (error.textContent = t("pinMismatch"));
  try {
    await api("/api/change-pin", { method: "POST", body: { new_pin: p1 } });
    closeModal("pinChangeModal");
    toast(t("saved"));
  } catch (e) {
    error.textContent = errorText(e);
  }
}
