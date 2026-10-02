import { API, KEYS, store } from "./state.js";
import { t } from "./i18n.js";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

async function request(path, { method = "GET", body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(t("connectionError"), 0, "network");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) throw new ApiError(data.error || t("connectionError"), response.status, data.code);
  return data;
}

// Pedido autenticado com o token do agregado. Um 401 significa que o token deixou de ser
// válido: volta ao ecrã do PIN (nunca re-autentica em silêncio nem cria agregados).
export async function api(path, options = {}) {
  const token = store.get(KEYS.token);
  try {
    return await request(path, { ...options, headers: token ? { "X-Household-Token": token } : {} });
  } catch (error) {
    if (error.status === 401) onUnauthorized(error);
    throw error;
  }
}

// create:false → nunca cria. unlock:true → o PIN tem de ser o do agregado deste dispositivo.
export function access(pin, { create = false, unlock = false, lookup = false } = {}) {
  const token = store.get(KEYS.token);
  return request("/api/access", {
    method: "POST",
    body: { pin, create, lookup },
    headers: unlock && token ? { "X-Household-Token": token } : {},
  });
}
