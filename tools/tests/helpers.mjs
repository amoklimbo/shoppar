// Infraestrutura de testes e2e do Shoppar.
//
// - Arranca um Worker LOCAL (wrangler dev) com uma D1 LOCAL descartável.
// - Serve public/ com um servidor estático (aplicando public/_headers, se existir).
// - Lança um Chromium real e redireciona TODAS as chamadas à API de produção para o
//   Worker local. Qualquer outro pedido externo é abortado: os testes nunca tocam
//   na produção.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../..");
const TOOLS = resolve(here, "..");
const STATE = join(TOOLS, ".state");
export const PROD_API = "https://shoppar.amok-limbo.workers.dev";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function parseHeadersFile() {
  const f = join(ROOT, "public/_headers");
  if (!existsSync(f)) return {};
  const out = {};
  let current = null;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      out[current] = {};
    } else if (current) {
      const i = line.indexOf(":");
      out[current][line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

function startStatic(port) {
  const rules = parseHeadersFile();
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const file = join(ROOT, "public", p);
    if (!file.startsWith(join(ROOT, "public")) || !existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    const headers = { "Content-Type": MIME[extname(file)] || "application/octet-stream" };
    for (const [pattern, hs] of Object.entries(rules)) {
      const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (re.test(p) || (p === "/index.html" && re.test("/"))) Object.assign(headers, hs);
    }
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

async function waitFor(url, ms = 150000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("timeout a aguardar " + url);
}

export async function startStack({ workerPort = 8791, webPort = 8790 } = {}) {
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });
  // Config de teste com database_id FALSO: impossível tocar na D1 real.
  const cfg = join(STATE, "wrangler.test.toml");
  writeFileSync(
    cfg,
    `name = "shoppar-test"\nmain = "${join(ROOT, "worker/src/index.js")}"\ncompatibility_date = "2026-09-21"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "shoppar-test-db"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n`,
  );
  const wr = (...a) => ["wrangler", ...a, "--config", cfg, "--persist-to", join(STATE, "d1")];
  execFileSync("npx", wr("d1", "execute", "DB", "--local", "--file", join(ROOT, "worker/schema.sql")), { cwd: TOOLS, stdio: "ignore" });
  const worker = spawn("npx", wr("dev", "--port", String(workerPort), "--ip", "127.0.0.1"), {
    cwd: TOOLS,
    stdio: "ignore",
    detached: true,
  });
  await waitFor(`http://127.0.0.1:${workerPort}/api/health`);
  const web = await startStatic(webPort);

  const exe = await chromium.executablePath();
  // --single-process/--no-zygote partilham o armazenamento entre contextos: removê-los
  // é necessário para simular dois dispositivos com localStorage independente.
  const args = chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a));
  const browser = await pw.launch({ executablePath: exe, args, headless: true });
  const apiBase = `http://127.0.0.1:${workerPort}`;
  const externalHits = [];

  async function newPage({ viewport = { width: 390, height: 844 }, context } = {}) {
    const ctx =
      context || (await browser.newContext({ viewport, serviceWorkers: "block", hasTouch: true, isMobile: viewport.width < 600 }));
    const page = await ctx.newPage();
    page.apiCalls = [];
    page.consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && page.consoleErrors.push(m.text()));
    page.on("pageerror", (e) => page.consoleErrors.push("pageerror: " + e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${webPort}`) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      if (url.startsWith(PROD_API)) {
        page.apiCalls.push(`${route.request().method()} ${new URL(url).pathname}${new URL(url).search}`);
        const target = apiBase + url.slice(PROD_API.length);
        const req = route.request();
        const resp = await fetch(target, {
          method: req.method(),
          headers: req.headers(),
          body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData(),
        }).catch(() => null);
        if (!resp) return route.abort();
        const headers = Object.fromEntries(resp.headers.entries());
        return route.fulfill({ status: resp.status, headers, body: Buffer.from(await resp.arrayBuffer()) });
      }
      externalHits.push(url);
      return route.abort();
    });
    return page;
  }

  return {
    web: `http://127.0.0.1:${webPort}`,
    api: apiBase,
    browser,
    newPage,
    externalHits,
    async stop() {
      await browser.close().catch(() => {});
      web.close();
      try {
        process.kill(-worker.pid, "SIGTERM"); // todo o grupo (npx → wrangler → workerd)
      } catch {}
    },
  };
}

export async function enterPin(page, pin) {
  for (const d of pin) await page.click(`[data-digit="${d}"]`);
  await page.click("#continuePin");
}

export async function api(stack, path, { token, method = "GET", body } = {}) {
  const r = await fetch(stack.api + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "X-Household-Token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// Simula 60 s de inatividade: o reload dispara "pagehide" (que renova a atividade),
// por isso a marca de tempo antiga é escrita por um script que corre no novo documento.
export async function expireLock(page) {
  await page.addInitScript(() => localStorage.setItem("shoppar_last_active_at", String(Date.now() - 60000)));
  await page.reload();
}
