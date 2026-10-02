import { $, $$ } from "./dom.js";
import { loadHistory } from "./history.js";
import { loadRecipes } from "./recipes.js";

export function showView(id) {
  for (const view of $$(".view")) view.hidden = view.id !== id;
  for (const item of $$(".nav-item")) {
    const active = item.dataset.view === id;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  if (id === "historyView") loadHistory().catch(() => {});
  if (id === "recipesView") loadRecipes().catch(() => {});
}

export const currentView = () => $$(".view").find((v) => !v.hidden)?.id;
