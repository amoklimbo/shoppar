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

const households = async () => {
  // contagem via PINs distintos não é possível; usa o endpoint de teste indireto:
  // cada /api/access com create:false nunca cria. Aqui contamos por tokens distintos.
  return null;
};

test("PIN alterado noutro dispositivo NÃO cria agregado vazio no Sync do dispositivo antigo", async () => {
  // Dispositivo A cria o agregado e guarda um produto.
  const ctxA = await stack.browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const A = await stack.newPage({ context: ctxA });
  await login(A, "5101");
  await A.fill("#itemName", "Leite");
  await A.click("#addItem");
  await A.waitForSelector(".item");

  // Dispositivo B entra com o mesmo PIN.
  const ctxB = await stack.browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const B = await stack.newPage({ context: ctxB });
  await login(B, "5101");
  await B.waitForSelector(".item");

  // A muda o PIN.
  await A.click('.nav-item[data-view="settingsView"]');
  await A.click("#changePin");
  await A.fill("#newPin", "5102");
  await A.fill("#confirmPin", "5102");
  await A.click("#pinChangeSave");
  await A.waitForSelector("#pinChangeModal", { state: "hidden" });

  // B faz Sync com o PIN antigo guardado: tem de continuar a ver "Leite".
  await B.click("#sync");
  await B.waitForTimeout(800);
  assert.equal(await B.locator(".item .item-name").first().textContent(), "Milk");
  // e o PIN antigo não pode ter criado um agregado novo
  const probe = await api(stack, "/api/access", { method: "POST", body: { pin: "5101", create: false } });
  assert.equal(probe.status, 401, "PIN antigo não deve existir nem ter sido recriado");
});

test("API: create:false nunca cria agregado; PIN desconhecido → 401", async () => {
  const r = await api(stack, "/api/access", { method: "POST", body: { pin: "5201", create: false } });
  assert.equal(r.status, 401);
  assert.equal(r.data.code, "unknown_pin");
  const again = await api(stack, "/api/access", { method: "POST", body: { pin: "5201", create: false } });
  assert.equal(again.status, 401, "continua inexistente");
  const made = await api(stack, "/api/access", { method: "POST", body: { pin: "5201", create: true } });
  assert.equal(made.status, 201);
  const back = await api(stack, "/api/access", { method: "POST", body: { pin: "5201", create: false } });
  assert.equal(back.status, 200);
  assert.equal(back.data.token, made.data.token);
});

test("API retrocompatível: sem o campo create, comportamento antigo (cria)", async () => {
  const r = await api(stack, "/api/access", { method: "POST", body: { pin: "5301" } });
  assert.equal(r.status, 201);
});

test("UI: PIN errado num dispositivo já ligado mostra erro e não troca de agregado", async () => {
  const page = await stack.newPage();
  await login(page, "5401");
  await page.fill("#itemName", "Pão");
  await page.click("#addItem");
  await page.waitForSelector(".item");
  const token = await page.evaluate(() => localStorage.getItem("shoppar_token"));
  await expireLock(page);
  await page.waitForSelector("#pinScreen:not([hidden])");
  await enterPin(page, "9999");
  await page.waitForFunction(() => document.querySelector("#pinError")?.textContent.trim().length > 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("shoppar_token")), token, "token não pode mudar");
  await enterPin(page, "5401");
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForSelector(".item");
});

test("UI: PIN novo num dispositivo novo pede confirmação antes de criar", async () => {
  const page = await stack.newPage();
  await page.goto(stack.web);
  await enterPin(page, "5501");
  await page.waitForSelector("#pinCreateConfirm", { state: "visible" });
  assert.equal(await page.evaluate(() => localStorage.getItem("shoppar_token")), null);
  await page.click("#pinCreateConfirm");
  await page.waitForSelector("#app:not([hidden])");
});
