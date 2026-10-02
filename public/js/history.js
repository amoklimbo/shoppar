import { displayName } from "./names.js";
import { state } from "./state.js";
import { api } from "./api.js";
import { t, catLabel, listLabel, formatPrice, formatDate } from "./i18n.js";
import { $, el, icon } from "./dom.js";

// Histórico de todas as listas, com filtros por lista e por loja (aplicados aqui, sobre as últimas 500 compras).
const filter = { list: "", store: "" };
let stores = [];

export async function loadHistory() {
  const data = await api("/api/history");
  state.history = data.results || [];
  stores = data.stores || [];
  if (filter.store && !stores.includes(filter.store)) filter.store = "";
  renderHistory();
}

function chips(label, options, current, onPick) {
  return el(
    "div",
    { class: "history-filter", role: "group", "aria-label": label },
    ...options.map(([value, text]) =>
      el(
        "button",
        {
          type: "button",
          class: `category-chip ${value === current ? "active" : ""}`,
          "aria-pressed": String(value === current),
          onclick: () => onPick(value),
        },
        text,
      ),
    ),
  );
}

function renderFilters() {
  const lists = [...new Map(state.history.map((h) => [h.list_id, h.list_name])).entries()];
  const box = $("#historyFilters");
  box.hidden = lists.length < 2 && stores.length === 0;
  box.replaceChildren(
    lists.length > 1
      ? chips(
          t("lists"),
          [["", t("allFilter")], ...lists.map(([id, name]) => [id, listLabel({ name })])],
          filter.list,
          (value) => ((filter.list = value), renderHistory()),
        )
      : "",
    stores.length
      ? chips(
          t("store"),
          [["", t("allFilter")], ...stores.map((x) => [x, x])],
          filter.store,
          (value) => ((filter.store = value), renderHistory()),
        )
      : "",
  );
}

export function renderHistory() {
  renderFilters();
  const rows = state.history.filter((h) => (!filter.list || h.list_id === filter.list) && (!filter.store || h.store === filter.store));
  $("#historyEmpty").hidden = rows.length > 0;
  let total = 0;
  $("#historyList").replaceChildren(
    ...rows.map((h) => {
      total += (Number(h.price) || 0) * (Number(h.quantity) || 1);
      const quantity = h.unit ? `${h.quantity} ${h.unit}` : String(h.quantity);
      return el(
        "article",
        { class: "history-row" },
        el("div", { class: "history-check" }, icon("check")),
        el(
          "div",
          { class: "history-body" },
          el("strong", {}, displayName(h.item_name)),
          el(
            "div",
            {},
            el("span", {}, catLabel(h.category)),
            el("span", {}, quantity),
            h.list_name && !filter.list ? el("span", {}, listLabel({ name: h.list_name })) : null,
            h.store ? el("span", {}, h.store) : null,
          ),
        ),
        el("div", { class: "history-right" }, el("strong", {}, formatPrice(h.price) || "—"), el("small", {}, formatDate(h.completed_at))),
      );
    }),
  );
  $("#historyTotal").textContent = formatPrice(total) || formatPrice(0);
}
