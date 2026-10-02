import { state } from "./state.js";
import { translations, categoryNames } from "./translations.js";

export function t(key, vars) {
  let text = translations[state.lang]?.[key] ?? translations.EN[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, v);
  return text;
}

export const catLabel = (category) => categoryNames[state.lang]?.[category] || category;

export const listLabel = (list) => (list.name === "Supermercado" ? (state.lang === "PT" ? "Supermercado" : "Supermarket") : list.name);

const locale = () => (state.lang === "PT" ? "pt-PT" : "en-GB");

export function formatPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(n);
}

export function formatDate(ts) {
  return new Intl.DateTimeFormat(locale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(ts)));
}

// Aplica as traduções ao HTML estático.
export function translateDocument() {
  document.documentElement.lang = state.lang === "PT" ? "pt-PT" : "en";
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll("[data-i18n-placeholder]")) e.placeholder = t(e.dataset.i18nPlaceholder);
  for (const e of document.querySelectorAll("[data-i18n-aria]")) e.setAttribute("aria-label", t(e.dataset.i18nAria));
  for (const e of document.querySelectorAll("[data-category-label]")) e.textContent = catLabel(e.dataset.categoryLabel);
  for (const e of document.querySelectorAll("[data-lang]")) {
    const active = e.dataset.lang === state.lang;
    e.classList.toggle("active", active);
    e.setAttribute("aria-pressed", String(active));
  }
}
