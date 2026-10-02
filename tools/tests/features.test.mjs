import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startStack, enterPin, api, expireLock } from "./helpers.mjs";

let stack;
before(async () => {
  stack = await startStack({ workerPort: 8793, webPort: 8792 });
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
const token = (page) => page.evaluate(() => localStorage.getItem("shoppar_token"));
async function addViaUi(page, name) {
  await page.fill("#itemName", name);
  await page.click("#addItem");
  await page.waitForFunction((n) => [...document.querySelectorAll(".item-name")].some((e) => e.textContent === n), name);
}

test("PIN: ao completar 4 dígitos entra sozinho, sem botão Continuar", async () => {
  const page = await stack.newPage();
  await login(page, "3131"); // cria o agregado
  assert.equal(await page.locator("#continuePin").count(), 0);
  await expireLock(page);
  await page.waitForSelector("#pinScreen:not([hidden])");
  await enterPin(page, "3131");
  await page.waitForSelector("#app:not([hidden])", { timeout: 5000 });
});

test("PIN errado no desbloqueio mostra erro e não entra", async () => {
  const page = await stack.newPage();
  await login(page, "3232");
  await expireLock(page);
  await enterPin(page, "9999");
  await page.waitForFunction(() => document.querySelector("#pinError")?.textContent.trim().length > 0);
  assert.equal(await page.locator("#app").isHidden(), true);
});

test("categoria detetada ao escrever; Casa tem categorias próprias", async () => {
  const page = await stack.newPage();
  await login(page, "3333");
  await page.fill("#itemName", "Leite");
  assert.equal((await page.textContent("#categoryHint")).trim(), "Dairy");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  assert.match(await page.textContent(".item-meta"), /Dairy/);

  await page.click(".list-tab:nth-child(2)");
  await page.click("#detailsToggle");
  const chips = await page.$$eval("#categoryChips [data-category]", (els) => els.map((e) => e.dataset.category));
  assert.ok(chips.includes("Limpeza") && chips.includes("Bricolage"));
  assert.ok(!chips.includes("Fruta"));
  await page.fill("#itemName", "Detergente da loiça");
  assert.equal(await page.getAttribute('#categoryChips [data-category="Limpeza"]', "aria-pressed"), "true");
  await page.click('#categoryChips [data-category="Jardim"]'); // escolha manual vence a deteção
  await page.fill("#itemName", "Detergente da loiça!");
  assert.equal(await page.getAttribute('#categoryChips [data-category="Jardim"]', "aria-pressed"), "true");
});

test("sugestões a partir do que já foi usado, com unidade e último preço", async () => {
  const page = await stack.newPage();
  await login(page, "3434");
  await page.click("#detailsToggle");
  await page.fill("#itemName", "Azeite virgem");
  await page.fill("#itemPrice", "7,5");
  await page.fill("#itemUnit", "l");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  await page.fill("#itemName", "azei");
  await page.waitForSelector(".suggestion");
  assert.match(await page.textContent(".suggestion"), /Azeite virgem/);
  await page.click(".suggestion");
  assert.equal(await page.inputValue("#itemName"), "Azeite virgem");
  assert.equal(await page.inputValue("#itemUnit"), "l");
  assert.equal(await page.inputValue("#itemPrice"), "7.5");
});

test("remover tem Desfazer e só apaga no servidor depois do aviso", async () => {
  const page = await stack.newPage();
  await login(page, "3535");
  await addViaUi(page, "Pão");
  const tk = await token(page);
  const list = (await api(stack, "/api/lists", { token: tk })).data.results[0];
  const count = async () => (await api(stack, `/api/lists/${list.id}/items`, { token: tk })).data.results.length;

  await page.click(".item .row-action.danger");
  await page.waitForSelector(".item", { state: "detached" });
  await page.click(".toast-action"); // Desfazer
  await page.waitForSelector(".item");
  assert.equal(await count(), 1);

  await page.click(".item .row-action.danger");
  await page.waitForSelector(".item", { state: "detached" });
  assert.equal(await count(), 1, "ainda não apagou no servidor");
  await page.waitForFunction(() => !document.querySelector(".toast.show"), null, { timeout: 9000 });
  await page.waitForTimeout(500);
  assert.equal(await count(), 0);
});

test("deslizar para o lado muda de lista", async () => {
  const ctx = await stack.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await stack.newPage({ context: ctx });
  await login(page, "3636");
  const swipe = (from, to) =>
    page.evaluate(
      ([a, b]) => {
        const target = document.querySelector("#items") || document.querySelector("#listsView");
        const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400 });
        const fire = (type, x) =>
          target.dispatchEvent(
            new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch(x)], changedTouches: [touch(x)] }),
          );
        fire("touchstart", a);
        fire("touchend", b);
      },
      [from, to],
    );
  const active = () => page.textContent(".list-tab.active");
  assert.match(await active(), /Supermarket/);
  await swipe(300, 80);
  await page.waitForFunction(() => /Casa/.test(document.querySelector(".list-tab.active")?.textContent));
  await swipe(80, 300);
  await page.waitForFunction(() => /Supermarket/.test(document.querySelector(".list-tab.active")?.textContent));
  await swipe(300, 280); // curto demais: não muda
  assert.match(await active(), /Supermarket/);
  await ctx.close();
});

test("modo compras: toque na linha risca, esconde adicionar e fica guardado", async () => {
  const page = await stack.newPage();
  await login(page, "3737");
  await addViaUi(page, "Maçã");
  await page.click("#shopMode");
  assert.equal(await page.locator(".add-bar").isVisible(), false);
  assert.equal(await page.getAttribute("#shopMode", "aria-pressed"), "true");
  await page.click(".item-name");
  await page.waitForSelector(".item.done");
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForSelector(".item");
  assert.equal(await page.locator(".add-bar").isVisible(), false);
  await page.click("#shopMode");
  assert.equal(await page.locator(".add-bar").isVisible(), true);
});

test("sincronização automática traz alterações feitas noutro dispositivo", async () => {
  const page = await stack.newPage();
  await login(page, "3838");
  await page.waitForSelector("#emptyState", { state: "visible" });
  const tk = await token(page);
  const list = (await api(stack, "/api/lists", { token: tk })).data.results[0];
  await api(stack, `/api/lists/${list.id}/items`, { token: tk, method: "POST", body: { name: "Chegou de fora", category: "Outros" } });
  await page.waitForSelector(".item-name", { timeout: 30000 });
  assert.equal(await page.textContent(".item-name"), "Chegou de fora");
});
