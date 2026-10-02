// Ecrã do PIN e bloqueio automático.
// O token (id do agregado) fica no dispositivo; o PIN nunca é guardado.
import { state, store, KEYS, LOCK_TIMEOUT } from "./state.js";
import { access } from "./api.js";
import { t } from "./i18n.js";
import { $, $$, errorText } from "./dom.js";
import { loadLists } from "./lists.js";

let entered = "";
let pendingPin = null;
let activityTimer = null;
let submitting = false;

const appVisible = () => !$("#app").hidden;

// ------------------------------------------------------------ teclado do PIN
export function updatePinDots() {
  $$(".pin-dot").forEach((dot, i) => dot.classList.toggle("filled", i < entered.length));
  $("#pinDots").setAttribute("aria-label", t("pinProgress", { count: entered.length }));
}
export function addDigit(d) {
  if (entered.length >= 4 || submitting) return;
  entered += d;
  updatePinDots();
  if (entered.length === 4) setTimeout(submitPin, 150); // deixa o 4.º ponto desenhar-se; depois desbloqueia sozinho
}
export function removeDigit() {
  entered = entered.slice(0, -1);
  updatePinDots();
}
function resetPin() {
  entered = "";
  pendingPin = null;
  updatePinDots();
  showCreateBox(false);
  $("#pinError").textContent = "";
}
function showCreateBox(visible) {
  $("#pinCreate").hidden = !visible;
  $(".keypad").hidden = visible;
  if (visible) $("#pinCreateConfirm").focus();
}

export async function submitPin() {
  if (entered.length !== 4 || submitting) return;
  submitting = true;
  const pin = entered;
  const unlocking = Boolean(store.get(KEYS.token));
  $("#pinError").textContent = "";
  try {
    // Nunca cria agregados aqui: um PIN mal escrito não pode abrir um agregado vazio.
    const result = await access(pin, { create: false, unlock: unlocking, lookup: !unlocking });
    if (!result.token) {
      pendingPin = pin;
      showCreateBox(true);
      entered = "";
      return updatePinDots();
    }
    await enterApp(result.token);
  } catch (error) {
    if (error.code === "unknown_pin") {
      pendingPin = pin;
      showCreateBox(true);
    } else {
      $("#pinError").textContent = errorText(error);
    }
    entered = "";
    updatePinDots();
  } finally {
    submitting = false;
  }
}

export async function confirmCreate() {
  if (!pendingPin) return;
  $("#pinCreateConfirm").disabled = true;
  try {
    const result = await access(pendingPin, { create: true });
    await enterApp(result.token);
  } catch (error) {
    resetPin();
    $("#pinError").textContent = errorText(error);
  } finally {
    $("#pinCreateConfirm").disabled = false;
  }
}
export const cancelCreate = () => resetPin();

async function enterApp(token) {
  store.set(KEYS.token, token);
  store.remove(KEYS.legacyPin);
  store.remove(KEYS.lastActive);
  $("#pinScreen").hidden = true;
  $("#app").hidden = false;
  resetPin();
  startActivityTracking();
  try {
    await loadLists();
  } catch {
    /* o 401 já trata do regresso ao PIN; erros de rede mostram-se no próximo Sync */
  }
}

// ------------------------------------------------------------------ bloqueio
export function lockApp(message = "") {
  store.remove(KEYS.lastActive);
  clearInterval(activityTimer);
  $("#app").hidden = true;
  $("#pinScreen").hidden = false;
  resetPin();
  $("#pinError").textContent = message;
}
// O token deixou de ser válido (agregado inexistente): pede novamente o PIN.
export function sessionExpired() {
  if ($("#pinScreen").hidden === false) return;
  store.remove(KEYS.token);
  lockApp(t("sessionExpired"));
}

function markActive() {
  if (store.get(KEYS.token) && appVisible() && !document.hidden) store.set(KEYS.lastActive, Date.now());
}
function startActivityTracking() {
  clearInterval(activityTimer);
  activityTimer = setInterval(markActive, 5000);
  markActive();
}
export function rememberBackground() {
  if (store.get(KEYS.token) && appVisible()) store.set(KEYS.lastActive, Date.now());
}
// Chamado quando a app volta ao primeiro plano.
export async function checkAppLock() {
  if (!store.get(KEYS.token) || !appVisible()) return;
  const last = Number(store.get(KEYS.lastActive) || 0);
  if (!last) return markActive();
  if (Date.now() - last >= LOCK_TIMEOUT) return lockApp();
  markActive();
  try {
    await loadLists();
  } catch {}
}

export async function startAuth() {
  store.remove(KEYS.legacyPin);
  updatePinDots();
  const token = store.get(KEYS.token);
  const last = Number(store.get(KEYS.lastActive) || 0);
  if (!token || !last || Date.now() - last >= LOCK_TIMEOUT) {
    $("#pinScreen").hidden = false;
    $("#app").hidden = true;
    return;
  }
  $("#pinScreen").hidden = true;
  $("#app").hidden = false;
  startActivityTracking();
  try {
    await loadLists();
  } catch {
    /* sem rede: mantém o dispositivo ligado ao agregado; o Sync tenta de novo */
  }
}
