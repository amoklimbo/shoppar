// Configuração, armazenamento local seguro e estado partilhado da aplicação.
export const API = "https://shoppar.amok-limbo.workers.dev";
export const APP_VERSION = "3.5";
export const LOCK_TIMEOUT = 30 * 1000;

export const KEYS = {
  token: "shoppar_token",
  lang: "shoppar_lang",
  theme: "shoppar_theme",
  lastActive: "shoppar_last_active_at",
  known: "shoppar_known", // produtos usados neste dispositivo (categoria, unidade, último preço)
  shopMode: "shoppar_shop_mode",
  legacyPin: "shoppar_pin", // versões antigas guardavam o PIN em claro; é removido ao arrancar
};

// localStorage pode lançar exceções (modo privado, quota): nunca deve partir a app.
export const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export const state = {
  lang: pick(store.get(KEYS.lang), ["EN", "PT"], "EN"),
  theme: pick(store.get(KEYS.theme), ["light", "dark"], "light"),
  shopMode: store.get(KEYS.shopMode) === "1",
  lists: [],
  activeList: null,
  items: [],
  history: [],
  recipes: [],
  activeCategory: "Outros",
  editCategory: "Outros",
  editingRecipeId: null,
  recipeToAdd: null,
};
