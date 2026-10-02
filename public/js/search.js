import { state } from "./state.js";
import { api } from "./api.js";
import { t, catLabel } from "./i18n.js";
import { $, el, openModal, closeModal, errorText } from "./dom.js";
import { selectList } from "./lists.js";
import { showView } from "./views.js";

let timer;
export function openSearch() {
  $("#searchInput").value = "";
  $("#searchResults").replaceChildren();
  openModal("searchModal", "#searchInput");
}
export function closeSearch() {
  clearTimeout(timer);
  closeModal("searchModal");
}
export function onSearchInput() {
  clearTimeout(timer);
  timer = setTimeout(doSearch, 180);
}

async function doSearch() {
  const q = $("#searchInput").value.trim();
  const box = $("#searchResults");
  if (!q) return box.replaceChildren();
  box.replaceChildren(el("div", { class: "search-loading" }, "…"));
  try {
    renderResults(await api(`/api/search?q=${encodeURIComponent(q)}`));
  } catch (error) {
    box.replaceChildren(el("div", { class: "search-empty" }, errorText(error)));
  }
}

function renderResults(data) {
  const groups = [
    ["items", t("searchProduct")],
    ["history", t("searchHistory")],
    ["recipes", t("searchRecipe")],
  ];
  const nodes = [];
  for (const [key, label] of groups) {
    const rows = data[key] || [];
    if (!rows.length) continue;
    nodes.push(el("div", { class: "search-group-title" }, label));
    for (const x of rows) {
      const sub = x.list_name || (x.category ? catLabel(x.category) : "");
      nodes.push(
        el(
          "button",
          { type: "button", class: "search-result", onclick: () => openResult(key, x) },
          el("strong", {}, x.name || x.item_name),
          el("small", {}, sub),
        ),
      );
    }
  }
  $("#searchResults").replaceChildren(...(nodes.length ? nodes : [el("div", { class: "search-empty" }, t("searchNothing"))]));
}

async function openResult(key, row) {
  closeSearch();

  if (key === "recipes") return showView("recipesView");
  const list = state.lists.find((l) => l.id === row.list_id);
  if (!list) return;
  showView("listsView");
  await selectList(list);
}
