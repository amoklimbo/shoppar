// Shoppar API — Cloudflare Worker + D1.
// Todas as migrações são ADITIVAS (nunca apagam nem alteram dados existentes).

const VERSION = "3.6.0";

const LIMITS = {
  name: 120,
  category: 40,
  unit: 16,
  store: 60,
  notes: 5000,
  recipeName: 120,
  ingredient: 120,
  ingredients: 100,
  bulk: 100,
  quantity: 1_000_000,
  price: 1_000_000,
  search: 80,
};
const ACCESS_LIMIT = { max: 30, windowSec: 60 };
const DEFAULT_LISTS = ["Supermercado", "Casa"];
const SESSION = { ttlMs: 90 * 24 * 3600 * 1000, renewMs: 7 * 24 * 3600 * 1000, perHousehold: 20 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Household-Token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...CORS,
      ...extra,
    },
  });
const fail = (status, code, error, extra) => json({ error, code }, status, extra);

const now = () => Date.now();
const uid = () => crypto.randomUUID();
const clean = (value, max) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

async function sha256(value) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function readBody(req) {
  try {
    return (await req.json()) ?? {};
  } catch {
    return {};
  }
}
// Número finito dentro de (0, max]; caso contrário devolve o valor por omissão.
const positive = (value, fallback, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
};
// Preço: null quando vazio/ inválido; nunca negativo.
const priceOf = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= LIMITS.price ? n : null;
};

// ---------------------------------------------------------------- esquema
let schemaReady = null;
function ensureSchema(env) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const columns = async (table) => ((await env.DB.prepare(`PRAGMA table_info(${table})`).all()).results || []).map((c) => c.name);
    if (!(await columns("items")).includes("store")) await env.DB.prepare("ALTER TABLE items ADD COLUMN store TEXT").run();
    if (!(await columns("history")).includes("unit")) await env.DB.prepare("ALTER TABLE history ADD COLUMN unit TEXT").run();
    if (!(await columns("history")).includes("store")) await env.DB.prepare("ALTER TABLE history ADD COLUMN store TEXT").run();
    // legacy_ok: tokens antigos (o próprio id do agregado) deixam de valer depois de uma mudança de PIN.
    if (!(await columns("households")).includes("settings"))
      await env.DB.prepare("ALTER TABLE households ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'").run();
    if (!(await columns("households")).includes("legacy_ok"))
      await env.DB.prepare("ALTER TABLE households ADD COLUMN legacy_ok INTEGER NOT NULL DEFAULT 1").run();
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS recipes(
        id TEXT PRIMARY KEY, household_id TEXT NOT NULL, name TEXT NOT NULL,
        ingredients_json TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY (household_id) REFERENCES households(id))`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_household ON sessions(household_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_history_completed ON history(completed_at)"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits(
        key TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (key, window))`),
    ]);
  })().catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

// Cria Supermercado/Casa se faltarem. Atómico por lista (sem duplicados em corridas).
function ensureDefaultLists(env, householdId) {
  const ts = now();
  return env.DB.batch(
    DEFAULT_LISTS.map((name, i) =>
      env.DB.prepare(
        `INSERT INTO lists(id,household_id,name,created_at)
         SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM lists WHERE household_id=? AND name=?)`,
      ).bind(uid(), householdId, name, ts + i, householdId, name),
    ),
  );
}

// Limite por IP (guardada só como hash). Devolve true se ainda dentro do limite.
async function withinRateLimit(env, req, bucket, { max, windowSec }) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const key = `${bucket}:${(await sha256(ip)).slice(0, 32)}`;
  const win = Math.floor(now() / (windowSec * 1000));
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(key,window,count) VALUES(?,?,1)
     ON CONFLICT(key,window) DO UPDATE SET count=count+1 RETURNING count`,
  )
    .bind(key, win)
    .first();
  if (Math.random() < 0.02)
    await env.DB.prepare("DELETE FROM rate_limits WHERE window < ?")
      .bind(win - 60)
      .run();
  return (row?.count ?? 1) <= max;
}

// ------------------------------------------------------------ autenticação
const SESSION_PREFIX = "s_";
const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Sessão nova: o dispositivo recebe um token aleatório; só o hash fica na base de dados.
async function createSession(env, householdId) {
  const token = SESSION_PREFIX + bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const ts = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions(id,household_id,created_at,expires_at) VALUES(?,?,?,?)").bind(
      await sha256(token),
      householdId,
      ts,
      ts + SESSION.ttlMs,
    ),
    // mantém só as sessões mais recentes de cada agregado
    env.DB.prepare(
      `DELETE FROM sessions WHERE household_id=? AND id NOT IN
       (SELECT id FROM sessions WHERE household_id=? ORDER BY created_at DESC LIMIT ?)`,
    ).bind(householdId, householdId, SESSION.perHousehold),
  ]);
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(ts).run();
  return token;
}

// Aceita sessões (s_…) e, enquanto o agregado não mudar de PIN, o token antigo (id do agregado).
async function householdFromToken(req, env) {
  const token = req.headers.get("x-household-token");
  if (!token) return null;
  if (token.startsWith(SESSION_PREFIX)) {
    const id = await sha256(token);
    const row = await env.DB.prepare("SELECT household_id,expires_at FROM sessions WHERE id=?").bind(id).first();
    if (!row || row.expires_at <= now()) return null;
    if (row.expires_at - now() < SESSION.ttlMs - SESSION.renewMs)
      await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE id=?")
        .bind(now() + SESSION.ttlMs, id)
        .run();
    return row.household_id;
  }
  const row = await env.DB.prepare("SELECT id FROM households WHERE id=? AND legacy_ok=1").bind(token).first();
  return row?.id || null;
}
const currentSessionId = async (req) => {
  const token = req.headers.get("x-household-token") || "";
  return token.startsWith(SESSION_PREFIX) ? sha256(token) : null;
};

// POST /api/access
//  - create omitido  → comportamento histórico: entra ou cria (retrocompatível).
//  - create:false    → nunca cria; PIN desconhecido → 401 unknown_pin
//                      (ou 200 {token:null} se lookup:true, para não gerar erros na consola).
//  - create:true     → cria se não existir.
//  - com X-Household-Token válido (desbloqueio): o PIN tem de ser o desse agregado.
async function access(req, env) {
  await ensureSchema(env);
  if (!(await withinRateLimit(env, req, "access", ACCESS_LIMIT)))
    return fail(429, "rate_limited", "Too many attempts. Try again in a minute.", { "Retry-After": "60" });

  const data = await readBody(req);
  const pin = String(data.pin ?? "");
  if (!/^\d{4}$/.test(pin)) return fail(400, "invalid_pin", "PIN must contain exactly 4 digits.");
  const pinHash = await sha256(pin);
  const existing = await env.DB.prepare("SELECT id FROM households WHERE pin_hash=?").bind(pinHash).first();

  const current = await householdFromToken(req, env);
  if (current && existing && existing.id !== current) return fail(401, "wrong_pin", "Incorrect PIN.");
  if (current && !existing) return fail(401, "wrong_pin", "Incorrect PIN.");

  if (existing) {
    await ensureDefaultLists(env, existing.id);
    return json({ token: await createSession(env, existing.id), existing: true });
  }
  // lookup:true → pergunta "existe?" sem erro HTTP (o cliente decide se pede confirmação para criar).
  if (data.lookup === true && data.create !== true) return json({ token: null, existing: false, code: "unknown_pin" });
  if (data.create === false) return fail(401, "unknown_pin", "Incorrect PIN.");

  const id = uid();
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO households(id,pin_hash,created_at) VALUES(?,?,?)")
    .bind(id, pinHash, now())
    .run();
  if (!inserted.meta?.changes) {
    // Corrida: outro pedido criou o mesmo PIN entretanto.
    const winner = await env.DB.prepare("SELECT id FROM households WHERE pin_hash=?").bind(pinHash).first();
    await ensureDefaultLists(env, winner.id);
    return json({ token: await createSession(env, winner.id), existing: true });
  }
  await ensureDefaultLists(env, id);
  return json({ token: await createSession(env, id), existing: false }, 201);
}

// -------------------------------------------------------------- receitas
const recipeRow = (r) => ({ ...r, ingredients: JSON.parse(r.ingredients_json || "[]") });
const cleanIngredients = (list) =>
  (Array.isArray(list) ? list : [])
    .map((x) => clean(x, LIMITS.ingredient))
    .filter(Boolean)
    .slice(0, LIMITS.ingredients);

// ---------------------------------------------------------------- itens
const itemFields = (data, base = {}) => {
  const name = data.name !== undefined ? clean(data.name, LIMITS.name) : base.name;
  return {
    name,
    category: data.category !== undefined ? clean(data.category, LIMITS.category) || "Outros" : (base.category ?? "Outros"),
    price: data.price !== undefined ? priceOf(data.price) : (base.price ?? null),
    quantity: data.quantity !== undefined ? positive(data.quantity, 1, LIMITS.quantity) : (base.quantity ?? 1),
    unit: data.unit !== undefined ? clean(data.unit, LIMITS.unit) || "un." : (base.unit ?? "un."),
    store: data.store !== undefined ? clean(data.store, LIMITS.store) : (base.store ?? ""),
  };
};
const insertItem = (env, listId, f, ts, id = uid()) =>
  env.DB.prepare(
    `INSERT INTO items(id,list_id,name,category,price,quantity,unit,store,done,created_at,updated_at,completed_at)
     VALUES(?,?,?,?,?,?,?,?,0,?,?,NULL)`,
  ).bind(id, listId, f.name, f.category, f.price, f.quantity, f.unit, f.store, ts, ts);

const ITEM_COLUMNS = "id,list_id,name,category,price,quantity,unit,store,done,created_at,updated_at,completed_at";

// ----------------------------------------------------------------- rotas
async function route(req, env, url) {
  const path = url.pathname;
  const method = req.method;

  if (path === "/api/access" && method === "POST") return access(req, env);
  if (path === "/api/health" && method === "GET") return json({ ok: true, service: "shoppar", version: VERSION });

  await ensureSchema(env);
  const hid = await householdFromToken(req, env);
  if (!hid) return fail(401, "unauthenticated", "Not authenticated.");

  if (path === "/api/change-pin" && method === "POST") {
    const newPin = String((await readBody(req)).new_pin ?? "");
    if (!/^\d{4}$/.test(newPin)) return fail(400, "invalid_pin", "PIN must contain exactly 4 digits.");
    const hash = await sha256(newPin);
    const clash = await env.DB.prepare("SELECT id FROM households WHERE pin_hash=? AND id!=?").bind(hash, hid).first();
    if (clash) return fail(409, "pin_in_use", "This PIN is already in use.");
    // Um PIN novo termina todas as outras sessões e os tokens antigos; este dispositivo mantém a sua.
    const keep = await currentSessionId(req);
    await env.DB.batch([
      env.DB.prepare("UPDATE households SET pin_hash=?,legacy_ok=0 WHERE id=?").bind(hash, hid),
      env.DB.prepare("DELETE FROM sessions WHERE household_id=? AND id IS NOT ?").bind(hid, keep),
    ]);
    return json({ ok: true, token: keep ? req.headers.get("x-household-token") : await createSession(env, hid) });
  }

  // Preferências (idioma e tema): cópia de segurança por agregado, para quando o dispositivo perde os dados locais.
  if (path === "/api/settings") {
    const row = await env.DB.prepare("SELECT settings FROM households WHERE id=?").bind(hid).first();
    let saved = {};
    try {
      saved = JSON.parse(row?.settings || "{}");
    } catch {}
    if (method === "GET") return json(saved);
    if (method === "PUT") {
      const data = await readBody(req);
      if (["EN", "PT"].includes(data.lang)) saved.lang = data.lang;
      if (["light", "dark"].includes(data.theme)) saved.theme = data.theme;
      await env.DB.prepare("UPDATE households SET settings=? WHERE id=?").bind(JSON.stringify(saved), hid).run();
      return json(saved);
    }
  }

  if (path === "/api/lists" && method === "GET") {
    await ensureDefaultLists(env, hid);
    const r = await env.DB.prepare("SELECT id,name,created_at FROM lists WHERE household_id=? ORDER BY created_at,rowid").bind(hid).all();
    return json({ results: r.results || [] });
  }

  // Histórico de todas as listas do agregado, com filtro opcional por loja.
  if (path === "/api/history" && method === "GET") {
    const store = clean(url.searchParams.get("store"), LIMITS.store);
    const rows = await env.DB.prepare(
      `SELECT h.id,h.list_id,l.name AS list_name,h.item_name,h.category,h.price,h.quantity,h.unit,h.store,h.completed_at
       FROM history h JOIN lists l ON l.id=h.list_id
       WHERE l.household_id=? AND (?='' OR h.store=?) ORDER BY h.completed_at DESC LIMIT 500`,
    )
      .bind(hid, store, store)
      .all();
    const stores = await env.DB.prepare(
      `SELECT DISTINCT h.store FROM history h JOIN lists l ON l.id=h.list_id
       WHERE l.household_id=? AND h.store IS NOT NULL AND h.store!='' ORDER BY h.store COLLATE NOCASE LIMIT 50`,
    )
      .bind(hid)
      .all();
    return json({ results: rows.results || [], stores: (stores.results || []).map((r) => r.store) });
  }

  // Listas: itens, histórico, operações em lote
  const listMatch = path.match(/^\/api\/lists\/([^/]+)\/(items|items\/bulk|items\/done|history)$/);
  if (listMatch) {
    const [, listId, sub] = listMatch;
    const owned = await env.DB.prepare("SELECT id FROM lists WHERE id=? AND household_id=?").bind(listId, hid).first();
    if (!owned) return fail(404, "not_found", "List not found.");

    if (sub === "items" && method === "GET") {
      const r = await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE list_id=? ORDER BY done ASC,created_at ASC`)
        .bind(listId)
        .all();
      return json({ results: r.results || [] });
    }
    if (sub === "items" && method === "POST") {
      const f = itemFields(await readBody(req));
      if (!f.name) return fail(400, "name_required", "Item name is required.");
      const id = uid();
      await insertItem(env, listId, f, now(), id).run();
      return json(await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(id).first(), 201);
    }
    if (sub === "items/bulk" && method === "POST") {
      const raw = (await readBody(req)).items;
      const items = (Array.isArray(raw) ? raw : [])
        .slice(0, LIMITS.bulk)
        .map((x) => itemFields(x ?? {}))
        .filter((f) => f.name);
      if (!items.length) return fail(400, "name_required", "Item name is required.");
      const ts = now();
      const ids = items.map(() => uid());
      // created_at crescente para preservar a ordem de inserção.
      await env.DB.batch(items.map((f, i) => insertItem(env, listId, f, ts + i, ids[i])));
      const r = await env.DB.prepare(
        `SELECT ${ITEM_COLUMNS} FROM items WHERE list_id=? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at`,
      )
        .bind(listId, ...ids)
        .all();
      return json({ results: r.results || [] }, 201);
    }
    if (sub === "items/done" && method === "DELETE") {
      const r = await env.DB.prepare("DELETE FROM items WHERE list_id=? AND done=1").bind(listId).run();
      return json({ ok: true, deleted: r.meta?.changes ?? 0 });
    }
    if (sub === "history" && method === "GET") {
      const r = await env.DB.prepare(
        "SELECT id,item_name,category,price,quantity,unit,store,completed_at FROM history WHERE list_id=? ORDER BY completed_at DESC LIMIT 500",
      )
        .bind(listId)
        .all();
      return json({ results: r.results || [] });
    }
  }

  const itemMatch = path.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch) {
    const id = itemMatch[1];
    const item = await env.DB.prepare("SELECT i.* FROM items i JOIN lists l ON l.id=i.list_id WHERE i.id=? AND l.household_id=?")
      .bind(id, hid)
      .first();
    if (!item) return fail(404, "not_found", "Item not found.");

    if (method === "PUT") {
      const data = await readBody(req);
      const f = itemFields(data, item);
      if (!f.name) return fail(400, "name_required", "Item name is required.");
      const done = data.done !== undefined ? (data.done ? 1 : 0) : item.done;
      const ts = now();
      const completedAt = done ? (item.done ? item.completed_at : ts) : null;
      const statements = [
        env.DB.prepare(
          "UPDATE items SET name=?,category=?,price=?,quantity=?,unit=?,store=?,done=?,updated_at=?,completed_at=? WHERE id=?",
        ).bind(f.name, f.category, f.price, f.quantity, f.unit, f.store, done, ts, completedAt, id),
      ];
      if (done && !item.done)
        statements.push(
          env.DB.prepare(
            "INSERT INTO history(id,list_id,item_name,category,price,quantity,unit,store,completed_at) VALUES(?,?,?,?,?,?,?,?,?)",
          ).bind(uid(), item.list_id, f.name, f.category, f.price, f.quantity, f.unit, f.store, completedAt),
        );
      await env.DB.batch(statements);
      return json(await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(id).first());
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM items WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }

  if (path === "/api/recipes" && method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM recipes WHERE household_id=? ORDER BY updated_at DESC").bind(hid).all();
    return json({ results: (r.results || []).map(recipeRow) });
  }
  if (path === "/api/recipes" && method === "POST") {
    const data = await readBody(req);
    const name = clean(data.name, LIMITS.recipeName);
    if (!name) return fail(400, "name_required", "Recipe name is required.");
    const id = uid();
    const ts = now();
    await env.DB.prepare("INSERT INTO recipes(id,household_id,name,ingredients_json,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id, hid, name, JSON.stringify(cleanIngredients(data.ingredients)), clean(data.notes, LIMITS.notes), ts, ts)
      .run();
    return json(recipeRow(await env.DB.prepare("SELECT * FROM recipes WHERE id=?").bind(id).first()), 201);
  }
  const recipeMatch = path.match(/^\/api\/recipes\/([^/]+)$/);
  if (recipeMatch) {
    const id = recipeMatch[1];
    const r = await env.DB.prepare("SELECT * FROM recipes WHERE id=? AND household_id=?").bind(id, hid).first();
    if (!r) return fail(404, "not_found", "Recipe not found.");
    if (method === "GET") return json(recipeRow(r));
    if (method === "PUT") {
      const data = await readBody(req);
      const name = data.name !== undefined ? clean(data.name, LIMITS.recipeName) : r.name;
      if (!name) return fail(400, "name_required", "Recipe name is required.");
      const ingredients = Array.isArray(data.ingredients) ? cleanIngredients(data.ingredients) : JSON.parse(r.ingredients_json || "[]");
      const notes = data.notes !== undefined ? clean(data.notes, LIMITS.notes) : r.notes;
      await env.DB.prepare("UPDATE recipes SET name=?,ingredients_json=?,notes=?,updated_at=? WHERE id=?")
        .bind(name, JSON.stringify(ingredients), notes, now(), id)
        .run();
      return json(recipeRow(await env.DB.prepare("SELECT * FROM recipes WHERE id=?").bind(id).first()));
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM recipes WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
  }

  if (path === "/api/search" && method === "GET") {
    const q = clean(url.searchParams.get("q"), LIMITS.search);
    if (!q) return json({ items: [], history: [], recipes: [] });
    // Escapa % e _ para a pesquisa ser literal.
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const [items, history, recipes] = await Promise.all([
      env.DB.prepare(
        `SELECT i.id,i.list_id,i.name,i.category,i.store,l.name AS list_name FROM items i JOIN lists l ON l.id=i.list_id
         WHERE l.household_id=? AND i.name LIKE ? ESCAPE '\\' ORDER BY i.updated_at DESC LIMIT 20`,
      )
        .bind(hid, like)
        .all(),
      env.DB.prepare(
        `SELECT h.id,h.list_id,h.item_name,h.category,h.completed_at,l.name AS list_name FROM history h JOIN lists l ON l.id=h.list_id
         WHERE l.household_id=? AND h.item_name LIKE ? ESCAPE '\\' ORDER BY h.completed_at DESC LIMIT 20`,
      )
        .bind(hid, like)
        .all(),
      env.DB.prepare(
        `SELECT id,name,notes,ingredients_json FROM recipes WHERE household_id=?
         AND (name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR ingredients_json LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 20`,
      )
        .bind(hid, like, like, like)
        .all(),
    ]);
    return json({
      items: items.results || [],
      history: history.results || [],
      recipes: (recipes.results || []).map(recipeRow),
    });
  }

  return fail(404, "not_found", "Not found.");
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
    try {
      return await route(req, env, new URL(req.url));
    } catch (error) {
      console.error(error);
      return fail(500, "server_error", "Server error.");
    }
  },
};
