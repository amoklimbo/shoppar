import { t } from "./i18n.js";

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];

// Cria elementos sem innerHTML: o conteúdo vindo da API nunca é interpretado como HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "list") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function icon(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon ${className}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function setIcon(svg, name) {
  svg.querySelector("use")?.setAttribute("href", `#i-${name}`);
}

let toastTimer;
export function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 2400);
}

// ---- modais acessíveis: foco, Escape e devolução do foco ao elemento de origem
const openers = new Map();
export function openModal(id, focusSelector) {
  const modal = $(`#${id}`);
  openers.set(id, document.activeElement);
  modal.hidden = false;
  setTimeout(() => (focusSelector ? $(focusSelector) : modal.querySelector("input,select,textarea,button"))?.focus(), 60);
}
export function closeModal(id) {
  const modal = $(`#${id}`);
  if (modal.hidden) return;
  modal.hidden = true;
  const opener = openers.get(id);
  openers.delete(id);
  if (opener?.isConnected) opener.focus();
}
export function closeTopModal() {
  const open = $$(".modal-backdrop").filter((m) => !m.hidden);
  const top = open[open.length - 1];
  if (top) closeModal(top.id);
  return Boolean(top);
}

// Mensagem de erro traduzida a partir do código devolvido pela API.
export function errorText(error) {
  const byCode = {
    unknown_pin: "unknownPin",
    wrong_pin: "unknownPin",
    rate_limited: "rateLimited",
    pin_in_use: "pinInUse",
    invalid_pin: "pinFormat",
    unauthenticated: "sessionExpired",
  };
  const key = byCode[error?.code];
  return key ? t(key) : error?.message || t("connectionError");
}
