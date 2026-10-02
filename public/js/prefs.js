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
// Copia de segurança das preferências no agregado: se este dispositivo perder o armazenamento local
// (modo privado, limpeza do navegador), ao entrar recupera o último idioma e tema escolhidos.
const pushSettings = () => {
  if (store.get(KEYS.token)) api("/api/settings", { method: "PUT", body: { lang: state.lang, theme: state.theme } }).catch(() => {});
};

export async function restoreSettings() {
  try {
    const remote = await api("/api/settings");
    let changed = false;
    if (store.get(KEYS.lang) === null && ["EN", "PT"].includes(remote.lang)) {
      state.lang = remote.lang;
      store.set(KEYS.lang, remote.lang);
      changed = true;
    }
    if (store.get(KEYS.theme) === null && ["light", "dark"].includes(remote.theme)) {
      state.theme = remote.theme;
      store.set(KEYS.theme, remote.theme);
      applyTheme();
      changed = true;
    }
    if (changed) applyLanguage();
    if (store.get(KEYS.lang) !== null || store.get(KEYS.theme) !== null) pushSettings();
  } catch {
    /* sem rede ou servidor antigo: ficam as preferências locais */
  }
}

export function setLanguage(lang) {
  state.lang = lang;
  store.set(KEYS.lang, lang);
  applyLanguage();
  pushSettings();
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
  pushSettings();
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
    const result = await api("/api/change-pin", { method: "POST", body: { new_pin: p1 } });
    if (result.token) store.set(KEYS.token, result.token); // este dispositivo mantém-se ligado; os outros pedem o PIN novo
    closeModal("pinChangeModal");
    toast(t("saved"));
  } catch (e) {
    error.textContent = errorText(e);
  }
}
