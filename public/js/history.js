import { state } from "./state.js";
import { api } from "./api.js";
import { t, catLabel, formatPrice, formatDate } from "./i18n.js";
import { $, el, icon } from "./dom.js";

export async function loadHistory() {
  if (!state.activeList) {
    state.history = [];
    return renderHistory();
  }
  const listId = state.activeList.id;
  const data = await api(`/api/lists/${listId}/history`);
  if (state.activeList?.id !== listId) return;
  state.history = data.results || [];
  renderHistory();
}

export function renderHistory() {
  $("#historyEmpty").hidden = state.history.length > 0;
  let total = 0;
  $("#historyList").replaceChildren(
    ...state.history.map((h) => {
      total += (Number(h.price) || 0) * (Number(h.quantity) || 1);
      const quantity = h.unit ? `${h.quantity} ${h.unit}` : String(h.quantity);
      return el(
        "article",
        { class: "history-row" },
        el("div", { class: "history-check" }, icon("check")),
        el(
          "div",
          { class: "history-body" },
          el("strong", {}, h.item_name),
          el("div", {}, el("span", {}, catLabel(h.category)), el("span", {}, quantity)),
        ),
        el("div", { class: "history-right" }, el("strong", {}, formatPrice(h.price) || "—"), el("small", {}, formatDate(h.completed_at))),
      );
    }),
  );
  $("#historyTotal").textContent = formatPrice(total) || formatPrice(0);
}
