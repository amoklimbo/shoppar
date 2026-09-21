const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-household-token',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers});
const now = () => Date.now();
const uid = () => crypto.randomUUID();

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
}

async function household(req, env) {
  const token = req.headers.get('x-household-token');
  if (!token) return null;
  const row = await env.DB.prepare('SELECT id FROM households WHERE id=?').bind(token).first();
  return row?.id || null;
}

function text(v, max=100) {
  return String(v ?? '').trim().slice(0,max);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response('', {status:204, headers});

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // First phone: create the shared household.
      if (path === '/api/setup' && req.method === 'POST') {
        const {pin} = await req.json();
        if (!/^\d{4}$/.test(String(pin || ''))) return json({error:'PIN inválido.'},400);

        const pinHash = await sha256(String(pin));
        const existing = await env.DB.prepare('SELECT id FROM households WHERE pin_hash=?').bind(pinHash).first();
        if (existing) return json({error:'Este PIN já está em utilização. Escolhe outro PIN.'},409);

        const householdId = uid();
        const created = now();

        await env.DB.prepare(
          'INSERT INTO households(id,pin_hash,created_at) VALUES(?,?,?)'
        ).bind(householdId,pinHash,created).run();

        await env.DB.prepare(
          'INSERT INTO lists(id,household_id,name,created_at) VALUES(?,?,?,?)'
        ).bind(uid(),householdId,'Supermercado',created).run();

        await env.DB.prepare(
          'INSERT INTO lists(id,household_id,name,created_at) VALUES(?,?,?,?)'
        ).bind(uid(),householdId,'Casa',created).run();

        return json({token:householdId},201);
      }

      // Any phone can join using only the same 4-digit PIN.
      if (path === '/api/login' && req.method === 'POST') {
        const {pin} = await req.json();
        if (!/^\d{4}$/.test(String(pin || ''))) return json({error:'PIN inválido.'},400);

        const pinHash = await sha256(String(pin));
        const row = await env.DB.prepare(
          'SELECT id FROM households WHERE pin_hash=?'
        ).bind(pinHash).first();

        if (!row) return json({error:'PIN incorreto ou lista inexistente.'},401);
        return json({token:row.id});
      }

      const hid = await household(req, env);
      if (!hid) return json({error:'Não autenticado.'},401);

      if (path === '/api/lists' && req.method === 'GET') {
        const r = await env.DB.prepare(
          'SELECT id,name FROM lists WHERE household_id=? ORDER BY created_at'
        ).bind(hid).all();
        return json(r.results);
      }

      const listItems = path.match(/^\/api\/lists\/([^/]+)\/items$/);
      if (listItems && req.method === 'GET') {
        const listId = listItems[1];
        const list = await env.DB.prepare(
          'SELECT id FROM lists WHERE id=? AND household_id=?'
        ).bind(listId,hid).first();
        if (!list) return json({error:'Lista inválida.'},404);

        const r = await env.DB.prepare(
          'SELECT * FROM items WHERE list_id=? ORDER BY done ASC, updated_at DESC'
        ).bind(listId).all();
        return json(r.results);
      }

      if (listItems && req.method === 'POST') {
        const listId = listItems[1];
        const list = await env.DB.prepare(
          'SELECT id FROM lists WHERE id=? AND household_id=?'
        ).bind(listId,hid).first();
        if (!list) return json({error:'Lista inválida.'},404);

        const body = await req.json();
        const name = text(body.name);
        if (!name) return json({error:'Produto vazio.'},400);

        const item = {
          id: uid(),
          listId,
          name,
          category: text(body.category) || 'Outros',
          price: body.price === '' || body.price == null ? null : Number(body.price),
          quantity: Number(body.quantity) || 1,
          unit: text(body.unit) || 'un.',
          created: now()
        };

        await env.DB.prepare(
          `INSERT INTO items
          (id,list_id,name,category,price,quantity,unit,done,created_at,updated_at,completed_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(item.id,item.listId,item.name,item.category,item.price,item.quantity,item.unit,0,item.created,item.created,null).run();

        return json(item,201);
      }

      const itemPath = path.match(/^\/api\/items\/([^/]+)$/);
      if (itemPath && (req.method === 'PUT' || req.method === 'DELETE')) {
        const itemId = itemPath[1];
        const old = await env.DB.prepare(
          `SELECT i.* FROM items i
           JOIN lists l ON l.id=i.list_id
           WHERE i.id=? AND l.household_id=?`
        ).bind(itemId,hid).first();

        if (!old) return json({error:'Produto não encontrado.'},404);

        if (req.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM items WHERE id=?').bind(itemId).run();
          return json({ok:true});
        }

        const body = await req.json();
        const done = body.done === undefined ? old.done : (body.done ? 1 : 0);
        const completedAt = done && !old.done ? now() : (done ? old.completed_at : null);
        const name = text(body.name ?? old.name);
        const category = text(body.category ?? old.category) || 'Outros';
        const price = body.price === undefined ? old.price : (body.price === '' || body.price == null ? null : Number(body.price));
        const quantity = Number(body.quantity ?? old.quantity) || 1;
        const unit = text(body.unit ?? old.unit) || 'un.';

        await env.DB.prepare(
          `UPDATE items SET name=?,category=?,price=?,quantity=?,unit=?,done=?,updated_at=?,completed_at=?
           WHERE id=?`
        ).bind(name,category,price,quantity,unit,done,now(),completedAt,itemId).run();

        if (done && !old.done) {
          await env.DB.prepare(
            `INSERT INTO history
            (id,list_id,item_name,category,price,quantity,completed_at)
            VALUES(?,?,?,?,?,?,?)`
          ).bind(uid(),old.list_id,name,category,price,quantity,completedAt).run();
        }

        return json({ok:true});
      }

      const historyPath = path.match(/^\/api\/lists\/([^/]+)\/history$/);
      if (historyPath && req.method === 'GET') {
        const listId = historyPath[1];
        const list = await env.DB.prepare(
          'SELECT id FROM lists WHERE id=? AND household_id=?'
        ).bind(listId,hid).first();
        if (!list) return json({error:'Lista inválida.'},404);

        const r = await env.DB.prepare(
          'SELECT * FROM history WHERE list_id=? ORDER BY completed_at DESC LIMIT 100'
        ).bind(listId).all();
        return json(r.results);
      }

      if (path === '/api/health') return json({ok:true});
      return json({error:'Not found'},404);

    } catch (error) {
      return json({error:error.message || 'Erro interno.'},500);
    }
  }
};
