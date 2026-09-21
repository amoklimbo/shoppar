const API = "https://shoppar.amok-limbo.workers.dev";
const TOKEN_KEY = "shoppar_token";
const PIN_KEY = "shoppar_pin";
const LANG_KEY = "shoppar_lang";

const state = {
  lang: localStorage.getItem(LANG_KEY) || "EN",
  lists: [],
  activeList: null,
  items: []
};

const $ = (sel) => document.querySelector(sel);

const translations = {
  EN: {
    appTitle: "Shoppar",
    subtitle: "Shared shopping list",
    pinTitle: "Enter your 4-digit PIN",
    pinSetup: "Create your shared PIN",
    pinHint: "Use the same PIN on both iPhones.",
    continue: "Continue",
    invalidPin: "PIN must contain 4 digits.",
    connectionError: "Could not connect. Please try again.",
    lists: "Lists",
    addItem: "Add item",
    itemPlaceholder: "What do you need?",
    add: "Add",
    empty: "Your list is empty.",
    supermarket: "Supermarket",
    home: "Home",
    history: "History",
    clearDone: "Clear completed",
    quantity: "Qty",
    price: "Price",
    category: "Category",
    other: "Other",
    logout: "Change PIN",
    sync: "Sync"
  },
  PT: {
    appTitle: "Shoppar",
    subtitle: "Lista de compras partilhada",
    pinTitle: "Introduz o PIN de 4 dígitos",
    pinSetup: "Cria o teu PIN partilhado",
    pinHint: "Usa o mesmo PIN nos dois iPhones.",
    continue: "Continuar",
    invalidPin: "O PIN tem de ter 4 dígitos.",
    connectionError: "Não foi possível ligar. Tenta novamente.",
    lists: "Listas",
    addItem: "Adicionar artigo",
    itemPlaceholder: "O que precisas?",
    add: "Adicionar",
    empty: "A lista está vazia.",
    supermarket: "Supermercado",
    home: "Casa",
    history: "Histórico",
    clearDone: "Limpar concluídos",
    quantity: "Qtd.",
    price: "Preço",
    category: "Categoria",
    other: "Outros",
    logout: "Alterar PIN",
    sync: "Sincronizar"
  }
};

function t(key) {
  return translations[state.lang]?.[key] || translations.EN[key] || key;
}

function applyLanguage() {
  document.documentElement.lang = state.lang === "PT" ? "pt-PT" : "en";
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  const input = $("#itemName");
  if (input) input.placeholder = t("itemPlaceholder");
  $("#langEN")?.classList.toggle("active", state.lang === "EN");
  $("#langPT")?.classList.toggle("active", state.lang === "PT");
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem(LANG_KEY, lang);
  applyLanguage();
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");

  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set("X-Household-Token", token);

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers
  });

  let data = {};
  try { data = await response.json(); } catch {}

  if (!response.ok) {
    const error = new Error(data.error || t("connectionError"));
    error.status = response.status;
    throw error;
  }

  return data;
}

// ---------- PIN ----------
let entered = "";

function updatePinDots() {
  document.querySelectorAll(".pin-dot").forEach((dot, i) => {
    dot.classList.toggle("filled", i < entered.length);
  });
  $("#continuePin").disabled = entered.length !== 4;
}

function addDigit(digit) {
  if (entered.length >= 4) return;
  entered += digit;
  updatePinDots();
}

function removeDigit() {
  entered = entered.slice(0, -1);
  updatePinDots();
}

async function submitPin() {
  if (entered.length !== 4) return;

  const pin = entered;
  $("#pinError").textContent = "";
  $("#continuePin").disabled = true;

  try {
    // ONE endpoint. Existing PIN joins; new PIN creates.
    const result = await api("/api/access", {
      method: "POST",
      body: JSON.stringify({ pin })
    });

    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(PIN_KEY, pin);

    $("#pinScreen").hidden = true;
    $("#app").hidden = false;

    entered = "";
    updatePinDots();
    await loadLists();
  } catch (error) {
    $("#pinError").textContent = error.message || t("connectionError");
    entered = "";
    updatePinDots();
  }
}

function showPinScreen() {
  $("#pinScreen").hidden = false;
  $("#app").hidden = true;
  entered = "";
  updatePinDots();
}

// ---------- App ----------
async function loadLists() {
  const data = await api("/api/lists");
  state.lists = data.results || [];

  if (!state.activeList || !state.lists.some(l => l.id === state.activeList.id)) {
    state.activeList = state.lists[0] || null;
  }

  renderLists();
  await loadItems();
}

async function loadItems() {
  if (!state.activeList) {
    state.items = [];
    renderItems();
    return;
  }

  const data = await api(`/api/lists/${state.activeList.id}/items`);
  state.items = data.results || [];
  renderItems();
}

function renderLists() {
  const container = $("#listTabs");
  container.innerHTML = "";

  state.lists.forEach(list => {
    const button = document.createElement("button");
    button.className = `list-tab ${state.activeList?.id === list.id ? "active" : ""}`;
    button.textContent =
      list.name === "Supermercado" ? t("supermarket") :
      list.name === "Casa" ? t("home") :
      list.name;

    button.addEventListener("click", async () => {
      state.activeList = list;
      renderLists();
      await loadItems();
    });

    container.appendChild(button);
  });
}

function formatPrice(price) {
  if (price === null || price === undefined || price === "") return "";
  const value = Number(price);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(state.lang === "PT" ? "pt-PT" : "en-GB", {
    style: "currency",
    currency: "EUR"
  }).format(value);
}

function renderItems() {
  const container = $("#items");
  container.innerHTML = "";

  if (!state.items.length) {
    container.innerHTML = `<div class="empty">${t("empty")}</div>`;
    updateTotal();
    return;
  }

  state.items.forEach(item => {
    const row = document.createElement("div");
    row.className = `item ${item.done ? "done" : ""}`;

    const check = document.createElement("button");
    check.className = "check";
    check.setAttribute("aria-label", item.done ? "Undo" : "Complete");
    check.textContent = item.done ? "✓" : "";
    check.addEventListener("click", () => toggleItem(item));

    const body = document.createElement("div");
    body.className = "item-body";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.name;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const qty = `${item.quantity} ${item.unit}`;
    const price = formatPrice(item.price);
    meta.textContent = price ? `${qty} · ${price}` : qty;

    body.append(name, meta);

    const del = document.createElement("button");
    del.className = "delete";
    del.textContent = "×";
    del.setAttribute("aria-label", "Delete");
    del.addEventListener("click", () => deleteItem(item));

    row.append(check, body, del);
    container.appendChild(row);
  });

  updateTotal();
}

function updateTotal() {
  const total = state.items
    .filter(i => !i.done && i.price !== null && i.price !== undefined)
    .reduce((sum, i) => sum + Number(i.price) * Number(i.quantity || 1), 0);

  $("#total").textContent = formatPrice(total);
}

async function addItem() {
  const input = $("#itemName");
  const name = input.value.trim();
  if (!name || !state.activeList) return;

  const priceInput = $("#itemPrice");
  const qtyInput = $("#itemQty");

  const price = priceInput.value.trim() === "" ? null : Number(priceInput.value.replace(",", "."));
  const quantity = Number(qtyInput.value || 1);

  try {
    await api(`/api/lists/${state.activeList.id}/items`, {
      method: "POST",
      body: JSON.stringify({
        name,
        category: "Outros",
        price: Number.isFinite(price) ? price : null,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: "un."
      })
    });

    input.value = "";
    priceInput.value = "";
    qtyInput.value = "1";
    await loadItems();
    input.focus();
  } catch (error) {
    alert(error.message || t("connectionError"));
  }
}

async function toggleItem(item) {
  try {
    await api(`/api/items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ done: !item.done })
    });
    await loadItems();
  } catch (error) {
    alert(error.message || t("connectionError"));
  }
}

async function deleteItem(item) {
  try {
    await api(`/api/items/${item.id}`, { method: "DELETE" });
    await loadItems();
  } catch (error) {
    alert(error.message || t("connectionError"));
  }
}

async function clearCompleted() {
  const completed = state.items.filter(i => i.done);
  for (const item of completed) {
    await api(`/api/items/${item.id}`, { method: "DELETE" });
  }
  await loadItems();
}

function bindEvents() {
  document.querySelectorAll("[data-digit]").forEach(button => {
    button.addEventListener("click", () => addDigit(button.dataset.digit));
  });

  $("#deleteDigit").addEventListener("click", removeDigit);
  $("#continuePin").addEventListener("click", submitPin);

  $("#langEN").addEventListener("click", () => setLanguage("EN"));
  $("#langPT").addEventListener("click", () => setLanguage("PT"));

  $("#addItem").addEventListener("click", addItem);
  $("#itemName").addEventListener("keydown", e => {
    if (e.key === "Enter") addItem();
  });

  $("#sync").addEventListener("click", loadLists);
  $("#clearCompleted").addEventListener("click", clearCompleted);

  $("#logout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PIN_KEY);
    showPinScreen();
  });
}

async function start() {
  applyLanguage();
  bindEvents();

  const token = localStorage.getItem(TOKEN_KEY);

  if (!token) {
    showPinScreen();
    return;
  }

  try {
    $("#pinScreen").hidden = true;
    $("#app").hidden = false;
    await loadLists();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    showPinScreen();
  }
}

start();
