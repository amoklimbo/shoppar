const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Household-Token",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Cache-Control": "no-store"
    }
  });

const now = () => Date.now();

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function household(req, env) {
  const token = req.headers.get("x-household-token");
  if (!token) return null;

  const row = await env.DB
    .prepare("SELECT id FROM households WHERE id = ?")
    .bind(token)
    .first();

  return row?.id || null;
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response("", {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, X-Household-Token",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
        }
      });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // ------------------------------------------------------------
      // ONE authentication endpoint:
      // - Existing PIN => join existing household
      // - New PIN      => create household + default lists
      // ------------------------------------------------------------
      if (path === "/api/access" && req.method === "POST") {
        const data = await body(req);
        const pin = String(data?.pin ?? "");

        if (!/^\d{4}$/.test(pin)) {
          return json({ error: "PIN must contain exactly 4 digits." }, 400);
        }

        const pinHash = await sha256(pin);

        const existing = await env.DB
          .prepare("SELECT id FROM households WHERE pin_hash = ?")
          .bind(pinHash)
          .first();

        if (existing) {
          return json({
            token: existing.id,
            existing: true
          });
        }

        const householdId = uid();
        const created = now();

        await env.DB
          .prepare("INSERT INTO households(id, pin_hash, created_at) VALUES(?, ?, ?)")
          .bind(householdId, pinHash, created)
          .run();

        await env.DB
          .prepare("INSERT INTO lists(id, household_id, name, created_at) VALUES(?, ?, ?, ?)")
          .bind(uid(), householdId, "Supermercado", created)
          .run();

        await env.DB
          .prepare("INSERT INTO lists(id, household_id, name, created_at) VALUES(?, ?, ?, ?)")
          .bind(uid(), householdId, "Casa", created)
          .run();

        return json({
          token: householdId,
          existing: false
        }, 201);
      }

      if (path === "/api/health" && req.method === "GET") {
        return json({ ok: true, service: "shoppar" });
      }

      const hid = await household(req, env);
      if (!hid) {
        return json({ error: "Not authenticated." }, 401);
      }

      // Lists
      if (path === "/api/lists" && req.method === "GET") {
        const result = await env.DB
          .prepare("SELECT id, name, created_at FROM lists WHERE household_id = ? ORDER BY created_at")
          .bind(hid)
          .all();

        return json({ results: result.results || [] });
      }

      // Items in a list
      const listMatch = path.match(/^\/api\/lists\/([^/]+)\/items$/);
      if (listMatch) {
        const listId = listMatch[1];

        const owned = await env.DB
          .prepare("SELECT id FROM lists WHERE id = ? AND household_id = ?")
          .bind(listId, hid)
          .first();

        if (!owned) return json({ error: "List not found." }, 404);

        if (req.method === "GET") {
          const result = await env.DB
            .prepare(`
              SELECT id, list_id, name, category, price, quantity, unit, done,
                     created_at, updated_at, completed_at
              FROM items
              WHERE list_id = ?
              ORDER BY done ASC, created_at ASC
            `)
            .bind(listId)
            .all();

          return json({ results: result.results || [] });
        }

        if (req.method === "POST") {
          const data = await body(req);
          const name = String(data?.name ?? "").trim();

          if (!name) return json({ error: "Item name is required." }, 400);

          const itemId = uid();
          const created = now();
          const category = String(data?.category ?? "Outros").trim() || "Outros";
          const price = data?.price === null || data?.price === "" || data?.price === undefined
            ? null
            : Number(data.price);
          const quantity = Number(data?.quantity ?? 1);
          const unit = String(data?.unit ?? "un.").trim() || "un.";

          await env.DB
            .prepare(`
              INSERT INTO items(
                id, list_id, name, category, price, quantity, unit,
                done, created_at, updated_at, completed_at
              ) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)
            `)
            .bind(itemId, listId, name, category, Number.isFinite(price) ? price : null,
                  Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                  unit, created, created)
            .run();

          const item = await env.DB
            .prepare("SELECT * FROM items WHERE id = ?")
            .bind(itemId)
            .first();

          return json(item, 201);
        }
      }

      // Update item
      const itemMatch = path.match(/^\/api\/items\/([^/]+)$/);
      if (itemMatch) {
        const itemId = itemMatch[1];

        const item = await env.DB
          .prepare(`
            SELECT i.*
            FROM items i
            JOIN lists l ON l.id = i.list_id
            WHERE i.id = ? AND l.household_id = ?
          `)
          .bind(itemId, hid)
          .first();

        if (!item) return json({ error: "Item not found." }, 404);

        if (req.method === "PUT") {
          const data = await body(req);
          const name = data?.name !== undefined ? String(data.name).trim() : item.name;
          const category = data?.category !== undefined
            ? String(data.category).trim() || "Outros"
            : item.category;
          const price = data?.price !== undefined
            ? (data.price === null || data.price === "" ? null : Number(data.price))
            : item.price;
          const quantity = data?.quantity !== undefined
            ? Number(data.quantity)
            : item.quantity;
          const unit = data?.unit !== undefined
            ? String(data.unit).trim() || "un."
            : item.unit;
          const done = data?.done !== undefined ? (data.done ? 1 : 0) : item.done;
          const updated = now();
          const completedAt = done
            ? (item.done ? item.completed_at : updated)
            : null;

          await env.DB
            .prepare(`
              UPDATE items
              SET name = ?, category = ?, price = ?, quantity = ?, unit = ?,
                  done = ?, updated_at = ?, completed_at = ?
              WHERE id = ?
            `)
            .bind(
              name,
              category,
              Number.isFinite(price) ? price : null,
              Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
              unit,
              done,
              updated,
              completedAt,
              itemId
            )
            .run();

          // When an item is completed, keep a snapshot in history.
          if (done && !item.done) {
            await env.DB
              .prepare(`
                INSERT INTO history(
                  id, list_id, item_name, category, price, quantity, completed_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?)
              `)
              .bind(
                uid(),
                item.list_id,
                name,
                category,
                Number.isFinite(price) ? price : null,
                Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                completedAt
              )
              .run();
          }

          const updatedItem = await env.DB
            .prepare("SELECT * FROM items WHERE id = ?")
            .bind(itemId)
            .first();

          return json(updatedItem);
        }

        if (req.method === "DELETE") {
          await env.DB
            .prepare("DELETE FROM items WHERE id = ?")
            .bind(itemId)
            .run();

          return json({ ok: true });
        }
      }

      // History
      const historyMatch = path.match(/^\/api\/lists\/([^/]+)\/history$/);
      if (historyMatch && req.method === "GET") {
        const listId = historyMatch[1];

        const owned = await env.DB
          .prepare("SELECT id FROM lists WHERE id = ? AND household_id = ?")
          .bind(listId, hid)
          .first();

        if (!owned) return json({ error: "List not found." }, 404);

        const result = await env.DB
          .prepare(`
            SELECT id, item_name, category, price, quantity, completed_at
            FROM history
            WHERE list_id = ?
            ORDER BY completed_at DESC
          `)
          .bind(listId)
          .all();

        return json({ results: result.results || [] });
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error(error);
      return json({
        error: "Server error.",
        detail: String(error?.message || error)
      }, 500);
    }
  }
};
