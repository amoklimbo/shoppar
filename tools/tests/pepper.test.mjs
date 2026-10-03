import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startStack, api } from "./helpers.mjs";

let stack;
before(async () => {
  stack = await startStack({ workerPort: 8789, webPort: 8788, vars: { PIN_PEPPER: "segredo-de-teste-0123456789" } });
});
after(async () => {
  await stack?.stop();
});

const sha = (pin) => createHash("sha256").update(pin).digest("hex");
const rows = (sql) => JSON.parse(stack.sql(sql))[0].results;

test("com PIN_PEPPER: novos agregados guardam HMAC (v2:…), nunca o SHA-256 do PIN", async () => {
  const r = await api(stack, "/api/access", { method: "POST", body: { pin: "6101" } });
  assert.equal(r.status, 201);
  const [row] = rows("SELECT pin_hash FROM households");
  assert.match(row.pin_hash, /^v2:[0-9a-f]{64}$/);
  assert.notEqual(row.pin_hash, sha("6101"));
  const again = await api(stack, "/api/access", { method: "POST", body: { pin: "6101", create: false } });
  assert.equal(again.status, 200);
  const wrong = await api(stack, "/api/access", { method: "POST", body: { pin: "6102", create: false } });
  assert.equal(wrong.status, 401);
});

test("agregado antigo (SHA-256) entra com o PIN certo e é migrado para HMAC", async () => {
  stack.sql(`INSERT INTO households(id,pin_hash,created_at) VALUES('legacy-hh','${sha("6201")}',1)`);
  const r = await api(stack, "/api/access", { method: "POST", body: { pin: "6201", create: false } });
  assert.equal(r.status, 200);
  const [row] = rows("SELECT pin_hash FROM households WHERE id='legacy-hh'");
  assert.match(row.pin_hash, /^v2:/);
  const back = await api(stack, "/api/access", { method: "POST", body: { pin: "6201", create: false } });
  assert.equal(back.status, 200, "continua a entrar depois da migração");
  const lists = async (t) => (await api(stack, "/api/lists", { token: t })).data.results.length;
  assert.equal(await lists(back.data.token), 2);
});

test("mudar o PIN grava HMAC e recusa um PIN já usado (mesmo por agregado antigo)", async () => {
  stack.sql(`INSERT INTO households(id,pin_hash,created_at) VALUES('legacy-2','${sha("6301")}',1)`);
  const a = await api(stack, "/api/access", { method: "POST", body: { pin: "6401" } });
  const clash = await api(stack, "/api/change-pin", { token: a.data.token, method: "POST", body: { new_pin: "6301" } });
  assert.equal(clash.status, 409);
  const ok = await api(stack, "/api/change-pin", { token: a.data.token, method: "POST", body: { new_pin: "6402" } });
  assert.equal(ok.status, 200);
  const probe = await api(stack, "/api/access", { method: "POST", body: { pin: "6402", create: false } });
  assert.equal(probe.status, 200);
  assert.equal((await api(stack, "/api/access", { method: "POST", body: { pin: "6401", create: false } })).status, 401);
});
