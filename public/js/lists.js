import { state, store, KEYS } from "./state.js";
import { api } from "./api.js";
import { t, catLabel, listLabel, formatPrice } from "./i18n.js";
import { $, el, icon, toast, openModal, closeModal, errorText } from "./dom.js";
import { displayName } from "./names.js";
import { categoriesFor, categoryRank, isHomeList, guessCategory, suggestions, remember, learnFrom } from "./catalog.js";

const isHome = () => isHomeList(state.activeList);
const listIcon = (list) => (list.name === "Supermercado" ? "cart" : list.name === "Casa" ? "home" : "list");

let categoryTouched = false; // o utilizador escolheu a categoria à mão: a deteção automática deixa de a mudar
let mutating = 0; // operações em curso; a sincronização automática espera por elas

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
  renderCategoryChips();
  applyShopMode();
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Itens de cada lista já carregados: trocar de lista mostra logo o conteúdo, sem esperar pela rede.
const cache = new Map();
let switching = false;

export async function selectList(list, direction = 0) {
  if (state.activeList?.id === list.id || switching) return;
  switching = true;
  const panel = $(".list-panel");
  const from = state.lists.findIndex((l) => l.id === state.activeList?.id);
  const dir = direction || Math.sign(state.lists.findIndex((l) => l.id === list.id) - from);
  const animate = dir && !reducedMotion() && panel.animate;
  try {
    // 1. o conteúdo atual sai para o lado do gesto
    if (animate) {
      await panel
        .animate(
          [
            { transform: panel.style.transform || "none", opacity: Number(panel.style.opacity) || 1 },
            { transform: `translateX(${-dir * 70}px)`, opacity: 0 },
          ],
          { duration: 110, easing: "ease-in" },
        )
        .finished.catch(() => {});
    }
    // 2. aba e conteúdo mudam no mesmo instante (a partir da cache)
    state.activeList = list;
    categoryTouched = false;
    state.activeCategory = "Outros";
    panel.style.transform = "";
    panel.style.opacity = "";
    state.items = cache.get(list.id) || [];
    state.loading = !cache.has(list.id);
    renderLists();
    renderItems();
    $(".list-tab.active")?.scrollIntoView?.({ inline: "center", block: "nearest" });
    onNameInput();
    // 3. o novo conteúdo entra pelo lado oposto
    if (animate) {
      panel.animate(
        [
          { transform: `translateX(${dir * 70}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
  } finally {
    switching = false;
  }
  await loadItems().catch(() => {}); // atualiza em segundo plano; só redesenha se algo mudou
}

// Deslizar para o lado muda de lista: a lista acompanha o dedo e, ao largar, sai e a nova entra.
// Ignora campos de texto e faixas com scroll próprio.
export function initSwipe() {
  const view = $("#listsView");
  const panel = $(".list-panel");
  let start = null;
  const neighbour = (dx) => state.lists[state.lists.findIndex((l) => l.id === state.activeList?.id) + (dx < 0 ? 1 : -1)];
  const reset = () => {
    panel.style.transition = "transform 0.18s ease, opacity 0.18s ease";
    panel.style.transform = "";
    panel.style.opacity = "";
  };
  view.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.touches[0];
      start =
        e.touches.length === 1 && touch && !e.target.closest("input,textarea,select,.list-tabs,.category-row,.suggestions")
          ? { x: touch.clientX, y: touch.clientY }
          : null;
      panel.style.transition = "none";
    },
    { passive: true },
  );
  view.addEventListener(
    "touchmove",
    (e) => {
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const pull = neighbour(dx) ? 0.7 : 0.2; // sem lista ao lado, o gesto "resiste"
      panel.style.transform = `translateX(${Math.max(-140, Math.min(140, dx * pull))}px)`;
      panel.style.opacity = String(1 - Math.min(Math.abs(dx) / 500, 0.4));
    },
    { passive: true },
  );
  view.addEventListener(
    "touchend",
    (e) => {
      if (!start) return;
      const end = e.changedTouches[0];
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      start = null;
      const next = neighbour(dx);
      if (Math.abs(dx) >= 70 && Math.abs(dx) >= Math.abs(dy) * 1.6 && next) selectList(next, dx < 0 ? 1 : -1);
      else reset();
    },
    { passive: true },
  );
  view.addEventListener("touchcancel", () => ((start = null), reset()), { passive: true });
}

export async function loadLists() {
  const data = await api("/api/lists");
  state.lists = data.results || [];
  if (!state.lists.some((l) => l.id === state.activeList?.id)) state.activeList = state.lists[0] || null;
  renderLists();
  await loadItems();
  prefetchOthers();
}

// Carrega em segundo plano as outras listas, para o swipe ser instantâneo.
function prefetchOthers() {
  for (const list of state.lists) {
    if (list.id === state.activeList?.id || mutating) continue;
    api(`/api/lists/${list.id}/items`)
      .then((data) =>
        cache.set(
          list.id,
          (data.results || []).filter((i) => !hiddenIds.has(i.id)),
        ),
      )
      .catch(() => {});
  }
}

const signature = (items) =>
  items.map((i) => [i.id, i.name, i.category, i.quantity, i.unit, i.price, i.store, i.done].join("|")).join("\n");

export async function loadItems() {
  if (!state.activeList) {
    state.items = [];
    return renderItems();
  }
  const list = state.activeList;
  const data = await api(`/api/lists/${list.id}/items`);
  if (state.activeList?.id !== list.id) return; // o utilizador mudou de lista entretanto
  const items = (data.results || []).filter((i) => !hiddenIds.has(i.id));
  learnFrom(list, items);
  cache.set(list.id, items);
  const wasLoading = state.loading;
  state.loading = false;
  if (signature(items) === signature(state.items)) return wasLoading ? renderItems() : undefined; // nada mudou
  state.items = items;
  renderItems();
}

// Sincronização em segundo plano: só quando não há nada a meio.
export const canAutoSync = () => mutating === 0 && pendingBatches.size === 0 && !document.querySelector(".modal-backdrop:not([hidden])");

// ---------------------------------------------------------------- produtos
const byOrder = (a, b) => a.done - b.done || a.created_at - b.created_at;

function groupItems(items) {
  const open = new Map();
  for (const item of items.filter((i) => !i.done)) {
    if (!open.has(item.category)) open.set(item.category, []);
    open.get(item.category).push(item);
  }
  const groups = [...open.entries()]
    .sort((a, b) => categoryRank(state.activeList, a[0]) - categoryRank(state.activeList, b[0]))
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
    { class: `item ${item.done ? "done" : ""} ${fresh ? "just-done" : ""}`, onclick: () => state.shopMode && toggleItem(item) },
    el(
      "button",
      {
        type: "button",
        class: "check",
        role: "checkbox",
        "aria-checked": String(Boolean(item.done)),
        "aria-label": displayName(item.name),
        onclick: (e) => {
          e.stopPropagation();
          toggleItem(item);
        },
      },
      icon("check"),
    ),
    el(
      "div",
      { class: "item-body" },
      el("strong", { class: "item-name" }, displayName(item.name)),
      el("div", { class: "item-meta" }, meta.join(" · ")),
    ),
    el(
      "div",
      { class: "item-actions" },
      el(
        "button",
        {
          type: "button",
          class: "row-action",
          title: t("edit"),
          "aria-label": `${t("edit")}: ${displayName(item.name)}`,
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
          "aria-label": `${t("deleteItem")}: ${displayName(item.name)}`,
          onclick: () => deleteItem(item),
        },
        icon("close"),
      ),
    ),
  );
}

export function renderItems() {
  const container = $("#items");
  if (state.activeList) cache.set(state.activeList.id, state.items);
  $("#emptyState").hidden = state.items.length > 0 || Boolean(state.loading);
  const groups = groupItems(state.items);
  const showTitles = groups.length > 1 || groups.some((g) => g.bought);
  container.replaceChildren(
    ...groups.map((group) =>
      el(
        "section",
        { class: `item-group ${group.bought ? "bought" : ""}` },
        showTitles
          ? el(
              "h3",
              { class: "group-title" },
              group.title,
              el("span", { class: "group-count" }, String(group.list.length)),
              group.bought
                ? el("button", { type: "button", id: "clearCompleted", class: "ghost-button", onclick: clearCompleted }, t("clearDone"))
                : null,
            )
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
  updateHint();
}

// ---- categorias, deteção automática e sugestões
function chipRow(container, selected, onPick) {
  const set = [...categoriesFor(state.activeList)];
  if (selected && !set.includes(selected)) set.splice(set.length - 1, 0, selected); // categoria antiga de um produto existente
  container.replaceChildren(
    ...set.map((category) =>
      el(
        "button",
        {
          type: "button",
          class: `category-chip ${category === selected ? "active" : ""}`,
          "aria-pressed": String(category === selected),
          "data-category": category,
          onclick: () => onPick(category),
        },
        catLabel(category),
      ),
    ),
  );
}

export function renderCategoryChips() {
  chipRow($("#categoryChips"), state.activeCategory, (category) => {
    categoryTouched = true;
    state.activeCategory = category;
    renderCategoryChips();
  });
  chipRow($("#editCategoryChips"), state.editCategory, (category) => {
    state.editCategory = category;
    renderCategoryChips();
  });
  updateHint();
}

function updateHint() {
  const hint = $("#categoryHint");
  const show = $("#itemName").value.trim() && $("#addDetails").hidden && state.activeCategory !== "Outros";
  hint.hidden = !show;
  hint.textContent = show ? catLabel(state.activeCategory) : "";
}

export function onNameInput() {
  const name = $("#itemName").value;
  if (!name.trim()) categoryTouched = false;
  if (!categoryTouched) {
    const guess = guessCategory(state.activeList, name);
    if ((guess || "Outros") !== state.activeCategory) {
      state.activeCategory = guess || "Outros";
      renderCategoryChips();
    }
  }
  updateHint();
  renderSuggestions(name);
}

function renderSuggestions(name) {
  const box = $("#suggestions");
  const found = suggestions(state.activeList, name, 4, displayName);
  box.hidden = found.length === 0;
  box.replaceChildren(
    ...found.map((s) =>
      el(
        "button",
        { type: "button", class: "suggestion", onclick: () => applySuggestion(s) },
        s.name,
        s.price != null ? el("small", {}, formatPrice(s.price)) : null,
      ),
    ),
  );
}

function applySuggestion(s) {
  $("#itemName").value = displayName(s.name);
  state.activeCategory = categoriesFor(state.activeList).includes(s.category) ? s.category : "Outros";
  categoryTouched = true;
  $("#itemQty").value = s.quantity || 1;
  $("#itemUnit").value = s.unit || "un.";
  $("#itemPrice").value = s.price ?? "";
  renderCategoryChips();
  renderSuggestions("");
  if (s.price != null || (s.quantity || 1) !== 1 || (s.unit || "un.") !== "un.") toggleDetails(true);
  $("#itemName").focus();
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
  const list = state.activeList;
  const quantity = numberFrom($("#itemQty").value);
  const body = {
    name,
    category: state.activeCategory,
    price: numberFrom($("#itemPrice").value),
    quantity: quantity > 0 ? quantity : 1,
    unit: $("#itemUnit").value.trim() || "un.",
    store: isHome() ? $("#itemStore").value.trim() : "",
  };
  const wasManual = categoryTouched;
  $("#addItem").disabled = true;
  mutating++;
  try {
    const item = await api(`/api/lists/${list.id}/items`, { method: "POST", body });
    remember(list, item, wasManual);
    if (state.activeList?.id === list.id) {
      state.items = [...state.items, item].sort(byOrder);
      renderItems();
    }
    $("#itemName").value = "";
    $("#itemPrice").value = "";
    $("#itemQty").value = "1";
    $("#itemUnit").value = "un.";
    $("#itemStore").value = "";
    toast(t("added"));
    categoryTouched = false;
    state.activeCategory = "Outros";
    renderCategoryChips();
    renderSuggestions("");
    toggleDetails(false);
    $("#itemName").focus();
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    mutating--;
    $("#addItem").disabled = false;
  }
}

// Atualização otimista: a interface muda já; se o servidor falhar, volta ao estado real.
export async function toggleItem(item) {
  item.done = item.done ? 0 : 1;
  item.fresh = Boolean(item.done);
  state.items.sort(byOrder);
  renderItems();
  mutating++;
  try {
    const saved = await api(`/api/items/${item.id}`, { method: "PUT", body: { done: Boolean(item.done) } });
    Object.assign(item, saved); // sem novo desenho: deixa a animação de riscar terminar
  } catch (error) {
    toast(errorText(error), true);
    await loadItems().catch(() => {});
  } finally {
    mutating--;
  }
}

// ---- remover com "Desfazer": o pedido ao servidor só parte quando o aviso acaba
const UNDO_MS = 6000;
const hiddenIds = new Set();
const pendingBatches = new Set();

async function commitBatch(batch) {
  if (!pendingBatches.delete(batch)) return;
  clearTimeout(batch.timer);
  const results = await Promise.allSettled(batch.items.map((i) => api(`/api/items/${i.id}`, { method: "DELETE" })));
  batch.items.forEach((i) => hiddenIds.delete(i.id));
  if (results.some((r) => r.status === "rejected")) {
    toast(errorText(results.find((r) => r.status === "rejected").reason), true);
    await loadItems().catch(() => {});
  }
}

export const flushPendingDeletes = () => Promise.all([...pendingBatches].map(commitBatch));

function removeWithUndo(items, message) {
  if (!items.length) return;
  flushPendingDeletes();
  const ids = new Set(items.map((i) => i.id));
  const listId = state.activeList?.id;
  ids.forEach((id) => hiddenIds.add(id));
  state.items = state.items.filter((i) => !ids.has(i.id));
  renderItems();
  const batch = { items, timer: 0 };
  batch.timer = setTimeout(() => commitBatch(batch), UNDO_MS);
  pendingBatches.add(batch);
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: t("undo"),
      onClick: () => {
        if (!pendingBatches.delete(batch)) return;
        clearTimeout(batch.timer);
        ids.forEach((id) => hiddenIds.delete(id));
        if (state.activeList?.id === listId) {
          state.items = [...state.items, ...items].sort(byOrder);
          renderItems();
        }
      },
    },
  });
}

export const deleteItem = (item) => removeWithUndo([item], t("removed", { name: displayName(item.name) }));

export function clearCompleted() {
  const done = state.items.filter((i) => i.done);
  removeWithUndo(done, t("removedMany", { count: done.length }));
}

// ---- modo compras: letra grande, toque na linha para riscar, ecrã sempre ligado
let wake = null;
async function holdScreen(on) {
  try {
    if (on && "wakeLock" in navigator) wake = await navigator.wakeLock.request("screen");
    else {
      await wake?.release();
      wake = null;
    }
  } catch {
    /* sem suporte ou recusado: o modo compras funciona na mesma */
  }
}
document.addEventListener("visibilitychange", () => !document.hidden && state.shopMode && holdScreen(true));

export function applyShopMode() {
  const on = state.shopMode;
  $("#listsView").classList.toggle("shopping", on);
  $("#shopMode").setAttribute("aria-pressed", String(on));
  $("#shopMode span").textContent = t(on ? "exitShopMode" : "shopMode");
  $("#listsTitle").textContent = t(on ? "shopMode" : "myLists");
}

export function toggleShopMode() {
  state.shopMode = !state.shopMode;
  store.set(KEYS.shopMode, state.shopMode ? "1" : "0");
  applyShopMode();
  holdScreen(state.shopMode);
}

// ------------------------------------------------------------------ edição
export function openEdit(item) {
  $("#editItemId").value = item.id;
  $("#editItemName").value = item.name || "";
  $("#editItemQty").value = item.quantity ?? 1;
  $("#editItemUnit").value = item.unit || "un.";
  $("#editItemPrice").value = item.price ?? "";
  $("#editItemStore").value = item.store || "";
  state.editCategory = item.category || "Outros";
  renderCategoryChips();
  updateStoreVisibility();
  openModal("editModal", "#editItemName");
}

export async function saveEdit() {
  const id = $("#editItemId").value;
  const name = $("#editItemName").value.trim();
  if (!id || !name) return;
  const quantity = numberFrom($("#editItemQty").value);
  mutating++;
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
    remember(state.activeList, saved, true);
    const index = state.items.findIndex((i) => i.id === id);
    if (index >= 0) state.items[index] = saved;
    renderItems();
    closeModal("editModal");
    toast(t("saved"));
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    mutating--;
  }
}
