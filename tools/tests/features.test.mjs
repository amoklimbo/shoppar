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
  const before = await page.locator(".item-name").count();
  await page.fill("#itemName", name);
  await page.click("#addItem");
  await page.waitForFunction((count) => document.querySelectorAll(".item-name").length > count, before);
}

test("PIN: ao completar 4 dígitos entra sozinho, e o botão Continuar continua disponível", async () => {
  const page = await stack.newPage();
  await login(page, "3131"); // cria o agregado
  assert.equal(await page.locator("#continuePin").count(), 1);
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
  await page.waitForFunction(() => /Casa/.test(document.querySelector(".list-tab.active")?.textContent));
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

test("nomes comuns aparecem na língua da app, sem alterar o que ficou guardado", async () => {
  const page = await stack.newPage();
  await login(page, "3939");
  await addViaUi(page, "Leite");
  assert.equal(await page.textContent(".item-name"), "Milk"); // app em inglês
  const tk = await token(page);
  const list = (await api(stack, "/api/lists", { token: tk })).data.results[0];
  const stored = (await api(stack, `/api/lists/${list.id}/items`, { token: tk })).data.results[0];
  assert.equal(stored.name, "Leite");
  await page.click('.nav-item[data-view="settingsView"]');
  await page.click("#langPTApp");
  await page.click('.nav-item[data-view="listsView"]');
  assert.equal(await page.textContent(".item-name"), "Leite");
});

test("conservas: atum é detetado como Conservas", async () => {
  const page = await stack.newPage();
  await login(page, "4040");
  await page.fill("#itemName", "Atum");
  assert.equal((await page.textContent("#categoryHint")).trim(), "Canned food");
});

test("o botão Continuar funciona e fica desligado até haver 4 dígitos", async () => {
  const page = await stack.newPage();
  await page.goto(stack.web);
  assert.equal(await page.locator("#continuePin").isDisabled(), true);
  for (const d of "424") await page.click(`[data-digit="${d}"]`);
  assert.equal(await page.locator("#continuePin").isDisabled(), true);
});

test("Supermercado mostra as categorias novas e 'Atum' vai para Conservas ao adicionar", async () => {
  const page = await stack.newPage();
  await login(page, "4141");
  await page.click("#detailsToggle");
  const chips = await page.$$eval("#categoryChips [data-category]", (els) => els.map((e) => e.dataset.category));
  for (const c of ["Conservas", "Snacks e doces", "Animais", "Bebé"]) assert.ok(chips.includes(c), c);
  await page.fill("#itemName", "Atum");
  assert.equal(await page.getAttribute('#categoryChips [data-category="Conservas"]', "aria-pressed"), "true");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  assert.match(await page.textContent(".item-meta"), /Canned food/);
});

test("categoria antiga 'Outros' lembrada não impede a deteção automática", async () => {
  const page = await stack.newPage();
  await login(page, "4242");
  await page.evaluate(() =>
    localStorage.setItem(
      "shoppar_known",
      JSON.stringify({ "s:atum": { name: "Atum", category: "Outros", unit: "un.", quantity: 1, price: null, count: 1, at: 1 } }),
    ),
  );
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.fill("#itemName", "Atum");
  assert.equal(await page.getAttribute('#categoryChips [data-category="Conservas"]', "aria-pressed"), "true");
});

test("swipe: aba e conteúdo mudam no mesmo instante (sem janela em que não coincidem)", async () => {
  const ctx = await stack.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await stack.newPage({ context: ctx });
  await login(page, "4343");
  const tk = await token(page);
  const lists = (await api(stack, "/api/lists", { token: tk })).data.results;
  const post = (l, name) => api(stack, `/api/lists/${l.id}/items`, { token: tk, method: "POST", body: { name, category: "Outros" } });
  await post(lists[0], "AAA");
  await post(lists[1], "BBB");
  await page.reload();
  await page.waitForSelector(".item-name");
  await page.waitForTimeout(800); // deixa a pré-carga da outra lista terminar
  await page.evaluate(() => {
    window.__mismatch = 0;
    window.__frames = 0;
    const tick = () => {
      const tab = document.querySelector(".list-tab.active")?.textContent || "";
      const names = [...document.querySelectorAll(".item-name")].map((e) => e.textContent).join(",");
      const expected = /Casa/.test(tab) ? "BBB" : "AAA";
      window.__frames++;
      if (names && names !== expected) window.__mismatch++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const target = document.querySelector("#listsView");
    const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 400 });
    const fire = (type, x) =>
      target.dispatchEvent(
        new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch(x)], changedTouches: [touch(x)] }),
      );
    fire("touchstart", 300);
    fire("touchend", 80);
  });
  await page.waitForFunction(() => /Casa/.test(document.querySelector(".list-tab.active")?.textContent));
  await page.waitForTimeout(600);
  const mismatch = await page.evaluate(() => window.__mismatch);
  assert.equal(mismatch, 0);
  assert.equal(await page.textContent(".item-name"), "BBB");
  await ctx.close();
});

test("sessões: token aleatório; PIN novo termina as outras sessões e os tokens antigos", async () => {
  const a = await api(stack, "/api/access", { method: "POST", body: { pin: "5151" } });
  assert.match(a.data.token, /^s_[0-9a-f]{64}$/);
  const b = await api(stack, "/api/access", { method: "POST", body: { pin: "5151" } });
  assert.notEqual(a.data.token, b.data.token);
  assert.equal((await api(stack, "/api/lists", { token: b.data.token })).status, 200);
  assert.equal((await api(stack, "/api/lists", { token: "s_" + "0".repeat(64) })).status, 401);

  // token antigo = id do agregado (guardado por versões anteriores)
  const id = JSON.parse(stack.sql("SELECT id FROM households WHERE created_at > 0 ORDER BY created_at DESC LIMIT 1"))[0].results[0].id;
  assert.equal((await api(stack, "/api/lists", { token: id })).status, 200, "token antigo ainda vale");

  const changed = await api(stack, "/api/change-pin", { token: a.data.token, method: "POST", body: { new_pin: "5152" } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.token, a.data.token, "o dispositivo que mudou mantém a sessão");
  assert.equal((await api(stack, "/api/lists", { token: a.data.token })).status, 200);
  assert.equal((await api(stack, "/api/lists", { token: b.data.token })).status, 401, "outras sessões terminam");
  assert.equal((await api(stack, "/api/lists", { token: id })).status, 401, "token antigo deixa de valer");
});

test("sessão expirada é recusada", async () => {
  const a = await api(stack, "/api/access", { method: "POST", body: { pin: "5161" } });
  stack.sql("UPDATE sessions SET expires_at = 1");
  assert.equal((await api(stack, "/api/lists", { token: a.data.token })).status, 401);
});

test("histórico reúne todas as listas e filtra por loja", async () => {
  const page = await stack.newPage();
  await login(page, "4444");
  const tk = await token(page);
  const [shop, home] = (await api(stack, "/api/lists", { token: tk })).data.results;
  const done = async (list, body) => {
    const item = await api(stack, `/api/lists/${list.id}/items`, { token: tk, method: "POST", body });
    await api(stack, `/api/items/${item.data.id}`, { token: tk, method: "PUT", body: { done: true } });
  };
  await done(shop, { name: "Pão", category: "Padaria", price: 1 });
  await done(home, { name: "Esponja", category: "Limpeza", price: 2, store: "Leroy" });
  await done(home, { name: "Parafusos", category: "Bricolage", price: 3, store: "Aqui" });
  await page.click('.nav-item[data-view="historyView"]');
  await page.waitForFunction(() => document.querySelectorAll(".history-row").length === 3);
  assert.match(await page.textContent("#historyTotal"), /6/);
  await page.click('.history-filter:last-child .category-chip:has-text("Leroy")');
  await page.waitForFunction(() => document.querySelectorAll(".history-row").length === 1);
  assert.match(await page.textContent(".history-row"), /Sponge/);
  assert.match(await page.textContent("#historyTotal"), /2/);
});

test("swipe funciona também em áreas vazias do ecrã (fora da lista)", async () => {
  const ctx = await stack.browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await stack.newPage({ context: ctx });
  await login(page, "4545");
  await page.waitForSelector("#emptyState", { state: "visible" });
  await page.evaluate(() => {
    const target = document.documentElement; // área sem conteúdo
    const touch = (x) => new Touch({ identifier: 1, target, clientX: x, clientY: 700 });
    const fire = (type, x) =>
      target.dispatchEvent(
        new TouchEvent(type, { bubbles: true, touches: type === "touchend" ? [] : [touch(x)], changedTouches: [touch(x)] }),
      );
    fire("touchstart", 300);
    fire("touchend", 80);
  });
  await page.waitForFunction(() => /Casa/.test(document.querySelector(".list-tab.active")?.textContent));
  await ctx.close();
});

test("navegação inferior: um só toque muda de secção, mesmo depois de fazer scroll", async () => {
  const ctx = await stack.browser.newContext({
    viewport: { width: 390, height: 600 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: "block",
  });
  const page = await stack.newPage({ context: ctx });
  await login(page, "4646");
  const tk = await token(page);
  const list = (await api(stack, "/api/lists", { token: tk })).data.results[0];
  await api(stack, `/api/lists/${list.id}/items/bulk`, {
    token: tk,
    method: "POST",
    body: { items: Array.from({ length: 30 }, (_, i) => ({ name: `Produto ${i}`, category: "Outros" })) },
  });
  await page.reload();
  await page.waitForSelector(".item");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.tap('.nav-item[data-view="historyView"]');
  await page.waitForSelector("#historyView:not([hidden])", { timeout: 2000 });
  await page.tap('.nav-item[data-view="settingsView"]');
  await page.waitForSelector("#settingsView:not([hidden])", { timeout: 2000 });
  await ctx.close();
});

test("definições ficam guardadas e recuperam-se do agregado se o dispositivo as perder", async () => {
  const page = await stack.newPage();
  await login(page, "4747");
  await page.click('.nav-item[data-view="settingsView"]');
  await page.click("#langPTApp");
  await page.click("#settingsTheme");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  // normal: reabrir mantém PT e escuro
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("shoppar_lang")), "PT");
  // o dispositivo perde as definições locais (modo privado, limpeza do navegador)
  await page.evaluate(() => {
    localStorage.removeItem("shoppar_lang");
    localStorage.removeItem("shoppar_theme");
  });
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => localStorage.getItem("shoppar_lang") === "PT" && document.documentElement.dataset.theme === "dark");
  assert.equal(await page.textContent("#listsTitle"), "As minhas listas");
});
