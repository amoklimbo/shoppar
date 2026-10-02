import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startStack, enterPin, api, ROOT } from "./helpers.mjs";

const read = (f) => readFileSync(join(ROOT, f), "utf8");
let stack;
before(async () => {
  stack = await startStack({ workerPort: 8795, webPort: 8794 });
});
after(async () => {
  await stack?.stop();
});

async function login(page, pin) {
  await page.goto(stack.web);
  await enterPin(page, pin);
  const create = page.locator("#pinCreateConfirm");
  await Promise.race([page.waitForSelector("#app:not([hidden])"), create.waitFor({ state: "visible" }).catch(() => {})]);
  if (await create.isVisible().catch(() => false)) await create.click();
  await page.waitForSelector("#app:not([hidden])");
}
async function household(pin) {
  const r = await api(stack, "/api/access", { method: "POST", body: { pin } });
  const lists = (await api(stack, "/api/lists", { token: r.data.token })).data.results;
  return { token: r.data.token, lists };
}

// ------------------------------------------------------------ estáticos
test("versão igual no frontend, service worker, HTML e Worker", () => {
  const version = read("public/js/state.js").match(/APP_VERSION = "([\d.]+)"/)[1];
  assert.match(read("public/sw.js"), new RegExp(`CACHE = "shoppar-v${version.replace(".", "-")}"`));
  assert.equal(
    [...read("public/index.html").matchAll(/>v([\d.]+)</g)].every((m) => m[1] === version),
    true,
  );
  assert.match(read("worker/src/index.js"), new RegExp(`VERSION = "${version}\\.\\d+"`));
});

test("i18n: EN e PT têm as mesmas chaves e todas as chaves usadas existem", async () => {
  const { translations } = await import(join(ROOT, "public/js/translations.js"));
  assert.deepEqual(Object.keys(translations.EN).sort(), Object.keys(translations.PT).sort());
  const used = new Set();
  for (const m of read("public/index.html").matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)) used.add(m[1]);
  for (const f of readdirSync(join(ROOT, "public/js"))) for (const m of read(`public/js/${f}`).matchAll(/\bt\("(\w+)"/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !(k in translations.EN));
  assert.deepEqual(missing, []);
});

test("service worker lista só ficheiros que existem", () => {
  const shell = [...read("public/sw.js").matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]).filter((p) => p !== "/");
  for (const p of shell) assert.doesNotThrow(() => readFileSync(join(ROOT, "public", p)), p);
});

// ------------------------------------------------------------------ API
test("API: validação — limites, preço negativo, quantidade inválida", async () => {
  const { token, lists } = await household("6101");
  const post = (b) => api(stack, `/api/lists/${lists[0].id}/items`, { token, method: "POST", body: b });
  const long = await post({ name: "x".repeat(500), price: -5, quantity: -2, unit: "u".repeat(50) });
  assert.equal(long.status, 201);
  assert.equal(long.data.name.length, 120);
  assert.equal(long.data.price, null);
  assert.equal(long.data.quantity, 1);
  assert.equal(long.data.unit.length, 16);
  assert.equal((await post({ name: "   " })).status, 400);
  assert.equal((await post({ name: "ok", price: "abc" })).data.price, null);
});

test("API: lote de itens, limpar concluídos e unidade no histórico", async () => {
  const { token, lists } = await household("6102");
  const bulk = await api(stack, `/api/lists/${lists[0].id}/items/bulk`, {
    token,
    method: "POST",
    body: { items: [{ name: "A" }, { name: "B", unit: "kg" }, { name: "" }] },
  });
  assert.equal(bulk.status, 201);
  assert.deepEqual(
    bulk.data.results.map((i) => i.name),
    ["A", "B"],
  );
  await api(stack, `/api/items/${bulk.data.results[1].id}`, { token, method: "PUT", body: { done: true } });
  const history = (await api(stack, `/api/lists/${lists[0].id}/history`, { token })).data.results;
  assert.equal(history[0].unit, "kg");
  const cleared = await api(stack, `/api/lists/${lists[0].id}/items/done`, { token, method: "DELETE" });
  assert.equal(cleared.data.deleted, 1);
  const left = (await api(stack, `/api/lists/${lists[0].id}/items`, { token })).data.results;
  assert.deepEqual(
    left.map((i) => i.name),
    ["A"],
  );
});

test("API: isolamento entre agregados e listas por ordem estável", async () => {
  const a = await household("6103");
  const b = await household("6104");
  assert.deepEqual(
    a.lists.map((l) => l.name),
    ["Supermercado", "Casa"],
  );
  const r = await api(stack, `/api/lists/${a.lists[0].id}/items`, { token: b.token });
  assert.equal(r.status, 404);
  assert.equal((await api(stack, "/api/lists")).status, 401);
});

test("API: pesquisa trata % e _ como texto literal", async () => {
  const { token, lists } = await household("6105");
  for (const name of ["100% sumo", "pão"]) await api(stack, `/api/lists/${lists[0].id}/items`, { token, method: "POST", body: { name } });
  const r = await api(stack, "/api/search?q=%25", { token });
  assert.deepEqual(
    r.data.items.map((i) => i.name),
    ["100% sumo"],
  );
});

test("API: desbloqueio exige o PIN do próprio agregado", async () => {
  const a = await household("6106");
  await household("6107");
  const ok = await api(stack, "/api/access", { token: a.token, method: "POST", body: { pin: "6106", create: false } });
  assert.equal(ok.status, 200);
  const other = await api(stack, "/api/access", { token: a.token, method: "POST", body: { pin: "6107", create: false } });
  assert.equal(other.status, 401);
  assert.equal(other.data.code, "wrong_pin");
});

// ------------------------------------------------------------------- UI
test("UI: o PIN nunca fica guardado e a chave antiga é removida", async () => {
  const page = await stack.newPage();
  await page.addInitScript(() => localStorage.setItem("shoppar_pin", "1234"));
  await login(page, "6201");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  assert.equal(keys.includes("shoppar_pin"), false);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("6201")), false);
});

test("UI: conteúdo vindo da API nunca é interpretado como HTML", async () => {
  const { token, lists } = await household("6202");
  const evil = `<img src=x onerror="window.__xss=1">`;
  await api(stack, `/api/lists/${lists[0].id}/items`, { token, method: "POST", body: { name: evil, category: evil } });
  const done = await api(stack, `/api/lists/${lists[0].id}/items`, { token, method: "POST", body: { name: evil, category: evil } });
  await api(stack, `/api/items/${done.data.id}`, { token, method: "PUT", body: { done: true } });
  await api(stack, "/api/recipes", { token, method: "POST", body: { name: evil, ingredients: [evil], notes: evil } });
  const page = await stack.newPage();
  await login(page, "6202");
  await page.waitForSelector(".item");
  await page.click('.nav-item[data-view="historyView"]');
  await page.waitForSelector(".history-row");
  await page.click('.nav-item[data-view="recipesView"]');
  await page.waitForSelector(".recipe-card");
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator("img[src='x']").count(), 0);
  assert.match(await page.textContent(".recipe-card strong"), /<img/);
});

test("UI: acessibilidade básica — nomes, diálogos, Escape e sem scroll horizontal", async () => {
  const page = await stack.newPage();
  await login(page, "6203");
  await page.fill("#itemName", "Pão");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  const unnamed = await page.evaluate(
    () =>
      [...document.querySelectorAll("#app button, #pinScreen button")].filter(
        (b) => !(b.textContent.trim() || b.getAttribute("aria-label")),
      ).length,
  );
  assert.equal(unnamed, 0, "botões sem nome acessível");
  for (const m of await page.locator(".modal").all()) assert.equal(await m.getAttribute("role"), "dialog");
  await page.click(".item .row-action:not(.danger)");
  await page.waitForSelector("#editModal:not([hidden])");
  await page.waitForFunction(() => document.activeElement.id === "editItemName");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#editModal", { state: "hidden" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(
    await page.evaluate(() => /user-scalable|maximum-scale/.test(document.querySelector('meta[name="viewport"]').content)),
    false,
  );
});

test("UI: concluir é imediato (otimista) e o total só conta o que falta", async () => {
  const page = await stack.newPage();
  await login(page, "6204");
  await page.fill("#itemName", "Leite");
  await page.fill("#itemPrice", "2");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  const before = await page.textContent("#total");
  await page.click(".item .check");
  await page.waitForSelector(".item.done");
  assert.notEqual(await page.textContent("#total"), before);
  assert.equal(await page.getAttribute(".item .check", "aria-checked"), "true");
  await page.click("#clearCompleted");
  await page.waitForSelector(".item", { state: "detached" });
});

test("cabeçalhos de segurança estão definidos (CSP, nosniff)", async () => {
  const r = await fetch(stack.web + "/");
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
});

// Último: esgota o limite de pedidos de /api/access (restantes testes já correram).
test("API: demasiados pedidos a /api/access → 429", async () => {
  let last;
  for (let i = 0; i < 40; i++)
    last = await api(stack, "/api/access", { method: "POST", body: { pin: "0000", create: false, lookup: true } });
  assert.equal(last.status, 429);
  assert.equal(last.data.code, "rate_limited");
});
