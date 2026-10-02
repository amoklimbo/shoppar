import { state } from "./state.js";
import { api } from "./api.js";
import { t, catLabel, listLabel, formatPrice } from "./i18n.js";
import { $, $$, el, icon, toast, openModal, closeModal, errorText } from "./dom.js";

const isHome = () => state.activeList?.name === "Casa";
const listIcon = (list) => (list.name === "Supermercado" ? "cart" : list.name === "Casa" ? "home" : "list");

// ------------------------------------------------------------------ listas
export function renderLists() {
  const tabs = $("#listTabs");
  tabs.replaceChildren(
    ...state.lists.map((list) => {
      const active = state.activeList?.id === list.id;
      return el(
        "button",
        {
          type: "button",
          class: `list-tab ${active ? "active" : ""}`,
          "aria-pressed": String(active),
          onclick: () => selectList(list),
        },
        icon(listIcon(list)),
        el("span", {}, listLabel(list)),
      );
    }),
  );
  updateStoreVisibility();
}

export async function selectList(list) {
  state.activeList = list;
  renderLists();
  await loadItems();
}

export async function loadLists() {
  const data = await api("/api/lists");
  state.lists = data.results || [];
  if (!state.lists.some((l) => l.id === state.activeList?.id)) state.activeList = state.lists[0] || null;
  renderLists();
  await loadItems();
}

export async function loadItems() {
  if (!state.activeList) {
    state.items = [];
    return renderItems();
  }
  const listId = state.activeList.id;
  const data = await api(`/api/lists/${listId}/items`);
  if (state.activeList?.id !== listId) return; // o utilizador mudou de lista entretanto
  state.items = data.results || [];
  renderItems();
}

// ---------------------------------------------------------------- produtos
const byOrder = (a, b) => a.done - b.done || a.created_at - b.created_at;

// Ordem aproximada de um percurso numa loja; categorias desconhecidas ficam antes de "Outros".
const STORE_ORDER = ["Fruta", "Vegetais", "Laticínios", "Higiene", "Casa"];
const rank = (category) => {
  const i = STORE_ORDER.indexOf(category);
  return i >= 0 ? i : category === "Outros" ? STORE_ORDER.length + 1 : STORE_ORDER.length;
};

function groupItems(items) {
  const open = new Map();
  for (const item of items.filter((i) => !i.done)) {
    if (!open.has(item.category)) open.set(item.category, []);
    open.get(item.category).push(item);
  }
  const groups = [...open.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, list]) => ({ title: catLabel(category), list }));
  const bought = items.filter((i) => i.done);
  if (bought.length) groups.push({ title: t("boughtGroup"), list: bought, bought: true });
  return groups;
}

function itemRow(item, withCategory) {
  const meta = [`${item.quantity} ${item.unit}`];
  if (withCategory) meta.unshift(catLabel(item.category));
  if (formatPrice(item.price)) meta.push(formatPrice(item.price));
  if (item.store && isHome()) meta.push(item.store);
  const fresh = item.fresh;
  item.fresh = false;
  return el(
    "article",
    { class: `item ${item.done ? "done" : ""} ${fresh ? "just-done" : ""}` },
    el(
      "button",
      {
        type: "button",
        class: "check",
        role: "checkbox",
        "aria-checked": String(Boolean(item.done)),
        "aria-label": item.name,
        onclick: () => toggleItem(item),
      },
      icon("check"),
    ),
    el("div", { class: "item-body" }, el("strong", { class: "item-name" }, item.name), el("div", { class: "item-meta" }, meta.join(" · "))),
    el(
      "div",
      { class: "item-actions" },
      el(
        "button",
        {
          type: "button",
          class: "row-action",
          title: t("edit"),
          "aria-label": `${t("edit")}: ${item.name}`,
          onclick: () => openEdit(item),
        },
        icon("edit"),
      ),
      el(
        "button",
        {
          type: "button",
          class: "row-action danger",
          title: t("deleteItem"),
          "aria-label": `${t("deleteItem")}: ${item.name}`,
          onclick: () => deleteItem(item),
        },
        icon("close"),
      ),
    ),
  );
}

export function renderItems() {
  const container = $("#items");
  $("#emptyState").hidden = state.items.length > 0;
  const groups = groupItems(state.items);
  const showTitles = groups.length > 1;
  container.replaceChildren(
    ...groups.map((group) =>
      el(
        "section",
        { class: `item-group ${group.bought ? "bought" : ""}` },
        showTitles
          ? el("h3", { class: "group-title" }, group.title, el("span", { class: "group-count" }, String(group.list.length)))
          : null,
        ...group.list.map((item) => itemRow(item, !showTitles)),
      ),
    ),
  );
  const pending = state.items.filter((i) => !i.done);
  const total = pending.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
  $("#total").textContent = formatPrice(total) || formatPrice(0);
  $("#remaining").textContent = !state.items.length ? "" : pending.length ? t("itemsLeft", { count: pending.length }) : t("allBought");
}

export function toggleDetails(open = $("#addDetails").hidden) {
  $("#addDetails").hidden = !open;
  $("#detailsToggle").setAttribute("aria-expanded", String(open));
}

export function updateStoreVisibility() {
  $("#storeField").hidden = !isHome();
  $("#editStoreField").hidden = !isHome();
}

const numberFrom = (value) => {
  const n = Number(String(value).trim().replace(",", "."));
  return String(value).trim() !== "" && Number.isFinite(n) ? n : null;
};

export async function addItem() {
  const name = $("#itemName").value.trim();
  if (!name || !state.activeList) return;
  const listId = state.activeList.id;
  const quantity = numberFrom($("#itemQty").value);
  const body = {
    name,
    category: state.activeCategory,
    price: numberFrom($("#itemPrice").value),
    quantity: quantity > 0 ? quantity : 1,
    unit: $("#itemUnit").value.trim() || "un.",
    store: isHome() ? $("#itemStore").value.trim() : "",
  };
  $("#addItem").disabled = true;
  try {
    const item = await api(`/api/lists/${listId}/items`, { method: "POST", body });
    if (state.activeList?.id === listId) {
      state.items = [...state.items, item].sort(byOrder);
      renderItems();
    }
    $("#itemName").value = "";
    $("#itemPrice").value = "";
    $("#itemQty").value = "1";
    $("#itemUnit").value = "un.";
    $("#itemStore").value = "";
    toast(t("added"));
    state.activeCategory = "Outros";
    updateCategoryButtons();
    toggleDetails(false);
    $("#itemName").focus();
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    $("#addItem").disabled = false;
  }
}

// Atualização otimista: a interface muda já; se o servidor falhar, volta ao estado real.
export async function toggleItem(item) {
  item.done = item.done ? 0 : 1;
  item.fresh = Boolean(item.done);
  state.items.sort(byOrder);
  renderItems();
  try {
    const saved = await api(`/api/items/${item.id}`, { method: "PUT", body: { done: Boolean(item.done) } });
    Object.assign(item, saved); // sem novo desenho: deixa a animação de riscar terminar
  } catch (error) {
    toast(errorText(error), true);
    await loadItems().catch(() => {});
  }
}

export async function deleteItem(item) {
  if (!confirm(t("confirmDelete"))) return;
  state.items = state.items.filter((i) => i.id !== item.id);
  renderItems();
  try {
    await api(`/api/items/${item.id}`, { method: "DELETE" });
  } catch (error) {
    toast(errorText(error), true);
    await loadItems().catch(() => {});
  }
}

export async function clearCompleted() {
  if (!state.activeList || !state.items.some((i) => i.done)) return;
  const listId = state.activeList.id;
  try {
    await api(`/api/lists/${listId}/items/done`, { method: "DELETE" });
    state.items = state.items.filter((i) => !i.done);
    renderItems();
    toast(t("syncDone"));
  } catch (error) {
    toast(errorText(error), true);
  }
}

// ------------------------------------------------------------------ edição
export function updateCategoryButtons() {
  for (const b of $$("[data-category]")) {
    const active = b.dataset.category === state.activeCategory;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  for (const b of $$("[data-edit-category]")) {
    const active = b.dataset.editCategory === state.editCategory;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
}

export function openEdit(item) {
  $("#editItemId").value = item.id;
  $("#editItemName").value = item.name || "";
  $("#editItemQty").value = item.quantity ?? 1;
  $("#editItemUnit").value = item.unit || "un.";
  $("#editItemPrice").value = item.price ?? "";
  $("#editItemStore").value = item.store || "";
  state.editCategory = item.category || "Outros";
  updateCategoryButtons();
  updateStoreVisibility();
  openModal("editModal", "#editItemName");
}

export async function saveEdit() {
  const id = $("#editItemId").value;
  const name = $("#editItemName").value.trim();
  if (!id || !name) return;
  const quantity = numberFrom($("#editItemQty").value);
  try {
    const saved = await api(`/api/items/${id}`, {
      method: "PUT",
      body: {
        name,
        quantity: quantity > 0 ? quantity : 1,
        unit: $("#editItemUnit").value.trim() || "un.",
        price: numberFrom($("#editItemPrice").value),
        category: state.editCategory,
        store: isHome() ? $("#editItemStore").value.trim() : "",
      },
    });
    const index = state.items.findIndex((i) => i.id === id);
    if (index >= 0) state.items[index] = saved;
    renderItems();
    closeModal("editModal");
    toast(t("saved"));
  } catch (error) {
    toast(errorText(error), true);
  }
}
