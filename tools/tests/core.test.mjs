import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startStack, enterPin, expireLock } from "./helpers.mjs";

let stack;
before(async () => {
  stack = await startStack({ workerPort: 8791, webPort: 8790 });
});
after(async () => {
  await stack?.stop();
  assert.deepEqual(stack?.externalHits ?? [], [], "pedidos externos inesperados");
});

// Entra com PIN; se for um PIN novo, confirma a criação do agregado (fluxo novo).
async function login(page, pin) {
  await page.goto(stack.web);
  await enterPin(page, pin);
  const create = page.locator("#pinCreateConfirm");
  await Promise.race([page.waitForSelector("#app:not([hidden])"), create.waitFor({ state: "visible" }).catch(() => {})]);
  if (await create.isVisible().catch(() => false)) await create.click();
  await page.waitForSelector("#app:not([hidden])");
}

test("PIN novo cria agregado com Supermercado e Casa; versão visível", async () => {
  const page = await stack.newPage();
  await page.goto(stack.web);
  assert.match(await page.textContent(".app-version"), /^v\d+\.\d+/);
  await login(page, "4101");
  await page.waitForSelector(".list-tab");
  assert.equal(await page.locator(".list-tab").count(), 2);
  assert.deepEqual(page.consoleErrors, []);
});

test("adicionar, concluir, editar, histórico e eliminar produto", async () => {
  const page = await stack.newPage();
  await login(page, "4102");
  await page.fill("#itemName", "Leite");
  await page.click("#detailsToggle");
  await page.fill("#itemPrice", "1,5");
  await page.click("#addItem");
  await page.waitForSelector(".item .item-name");
  assert.equal(await page.textContent(".item .item-name"), "Leite");

  await page.click(".item .check");
  await page.waitForSelector(".item.done");

  await page.click('.nav-item[data-view="historyView"]');
  await page.waitForSelector(".history-row");
  assert.match(await page.textContent(".history-row"), /Leite/);

  await page.click('.nav-item[data-view="listsView"]');
  await page.click(".item .row-action:not(.danger)");
  await page.fill("#editItemName", "Leite Magro");
  await page.click("#editSave");
  await page.waitForFunction(() => document.querySelector(".item .item-name")?.textContent === "Leite Magro");

  page.on("dialog", (d) => d.accept());
  await page.click(".item .row-action.danger");
  await page.waitForSelector(".item", { state: "detached" });
  assert.deepEqual(page.consoleErrors, []);
});

test("receitas: criar, aparecer na lista e adicionar ingredientes à lista", async () => {
  const page = await stack.newPage();
  await login(page, "4103");
  await page.click('.nav-item[data-view="recipesView"]');
  await page.click("#addRecipe");
  await page.fill("#recipeName", "Massa");
  await page.fill("#recipeIngredients", "Esparguete\nTomate\nManjericão");
  await page.click("#recipeSave");
  await page.waitForSelector(".recipe-card");
  await page.click("[data-recipe-add]");
  await page.waitForSelector("#recipeAddModal:not([hidden])");
  await page.click("#recipeAddConfirm");
  await page.waitForSelector("#recipeAddModal", { state: "hidden" });
  await page.click('.nav-item[data-view="listsView"]');
  await page.waitForFunction(() => document.querySelectorAll(".item").length === 3);
  assert.deepEqual(page.consoleErrors, []);
});

test("bloqueio: depois de 30 s pede o PIN, e o PIN certo desbloqueia", async () => {
  const page = await stack.newPage();
  await login(page, "4104");
  await expireLock(page);
  await page.waitForSelector("#pinScreen:not([hidden])");
  await enterPin(page, "4104");
  await page.waitForSelector("#app:not([hidden])");
});

test("idioma e tema são guardados por dispositivo", async () => {
  const page = await stack.newPage();
  await login(page, "4105");
  await page.click('.nav-item[data-view="settingsView"]');
  await page.click("#langPTApp");
  await page.click("#settingsTheme");
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "pt-PT");
});
