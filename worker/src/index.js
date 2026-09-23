const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Household-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store"
  }
});
const now=()=>Date.now();
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
async function sha256(value){const data=new TextEncoder().encode(value);const hash=await crypto.subtle.digest("SHA-256",data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function body(req){try{return await req.json()}catch{return null}}
async function household(req,env){const token=req.headers.get("x-household-token");if(!token)return null;const row=await env.DB.prepare("SELECT id FROM households WHERE id = ?").bind(token).first();return row?.id||null}

let schemaReady=null;
async function ensureV2Schema(env){
  if(schemaReady)return schemaReady;
  schemaReady=(async()=>{
    const cols=await env.DB.prepare("PRAGMA table_info(items)").all();
    if(!(cols.results||[]).some(c=>c.name==="store")){
      await env.DB.prepare("ALTER TABLE items ADD COLUMN store TEXT").run();
    }
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS recipes(
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ingredients_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (household_id) REFERENCES households(id)
    )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_recipes_household ON recipes(household_id)").run();
  })().catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}
async function ensureDefaultLists(env, householdId){
  const defaults=["Supermercado","Casa"];
  for(const name of defaults){
    const exists=await env.DB.prepare("SELECT id FROM lists WHERE household_id=? AND name=?").bind(householdId,name).first();
    if(!exists){
      await env.DB.prepare("INSERT INTO lists(id,household_id,name,created_at) VALUES(?,?,?,?)").bind(uid(),householdId,name,now()).run();
    }
  }
}

function recipeRow(r){return {...r,ingredients:JSON.parse(r.ingredients_json||"[]")}}

export default {async fetch(req,env){
  if(req.method==="OPTIONS")return new Response("",{status:204,headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, X-Household-Token","Access-Control-Allow-Methods":"GET, POST, PUT, DELETE, OPTIONS"}});
  const url=new URL(req.url),path=url.pathname;
  try{
    if(path==="/api/access"&&req.method==="POST"){
      const data=await body(req),pin=String(data?.pin??"");
      if(!/^\d{4}$/.test(pin))return json({error:"PIN must contain exactly 4 digits."},400);
      const pinHash=await sha256(pin);
      const existing=await env.DB.prepare("SELECT id FROM households WHERE pin_hash = ?").bind(pinHash).first();
      if(existing){await ensureDefaultLists(env,existing.id);return json({token:existing.id,existing:true});}
      const householdId=uid(),created=now();
      await env.DB.prepare("INSERT INTO households(id,pin_hash,created_at) VALUES(?,?,?)").bind(householdId,pinHash,created).run();
      await env.DB.prepare("INSERT INTO lists(id,household_id,name,created_at) VALUES(?,?,?,?)").bind(uid(),householdId,"Supermercado",created).run();
      await env.DB.prepare("INSERT INTO lists(id,household_id,name,created_at) VALUES(?,?,?,?)").bind(uid(),householdId,"Casa",created).run();
      return json({token:householdId,existing:false},201);
    }
    if(path==="/api/health"&&req.method==="GET")return json({ok:true,service:"shoppar",version:"2.6.0"});
    const hid=await household(req,env); if(!hid)return json({error:"Not authenticated."},401);
    await ensureV2Schema(env);
    await ensureDefaultLists(env,hid);

    if(path==="/api/change-pin"&&req.method==="POST"){
      const data=await body(req),newPin=String(data?.new_pin??"");
      if(!/^\d{4}$/.test(newPin))return json({error:"PIN must contain exactly 4 digits."},400);
      const newHash=await sha256(newPin);
      const collision=await env.DB.prepare("SELECT id FROM households WHERE pin_hash = ? AND id != ?").bind(newHash,hid).first();
      if(collision)return json({error:"This PIN is already in use."},409);
      await env.DB.prepare("UPDATE households SET pin_hash = ? WHERE id = ?").bind(newHash,hid).run();
      return json({ok:true,token:hid});
    }

    if(path==="/api/lists"&&req.method==="GET"){
      const r=await env.DB.prepare("SELECT id,name,created_at FROM lists WHERE household_id=? ORDER BY created_at").bind(hid).all();
      return json({results:r.results||[]});
    }

    const listMatch=path.match(/^\/api\/lists\/([^/]+)\/items$/);
    if(listMatch){
      const listId=listMatch[1];
      const owned=await env.DB.prepare("SELECT id,name FROM lists WHERE id=? AND household_id=?").bind(listId,hid).first();
      if(!owned)return json({error:"List not found."},404);
      if(req.method==="GET"){
        const r=await env.DB.prepare(`SELECT id,list_id,name,category,price,quantity,unit,store,done,created_at,updated_at,completed_at FROM items WHERE list_id=? ORDER BY done ASC,created_at ASC`).bind(listId).all();
        return json({results:r.results||[]});
      }
      if(req.method==="POST"){
        const data=await body(req),name=String(data?.name??"").trim();if(!name)return json({error:"Item name is required."},400);
        const itemId=uid(),created=now(),category=String(data?.category??"Outros").trim()||"Outros";
        const price=data?.price===null||data?.price===""||data?.price===undefined?null:Number(data.price);
        const quantity=Number(data?.quantity??1),unit=String(data?.unit??"un.").trim()||"un.",store=String(data?.store??"").trim();
        await env.DB.prepare(`INSERT INTO items(id,list_id,name,category,price,quantity,unit,store,done,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?, ?,0,?,?,NULL)`).bind(itemId,listId,name,category,Number.isFinite(price)?price:null,Number.isFinite(quantity)&&quantity>0?quantity:1,unit,store,created,created).run();
        return json(await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(itemId).first(),201);
      }
    }

    const itemMatch=path.match(/^\/api\/items\/([^/]+)$/);
    if(itemMatch){
      const itemId=itemMatch[1];
      const item=await env.DB.prepare(`SELECT i.* FROM items i JOIN lists l ON l.id=i.list_id WHERE i.id=? AND l.household_id=?`).bind(itemId,hid).first();
      if(!item)return json({error:"Item not found."},404);
      if(req.method==="PUT"){
        const data=await body(req),name=data?.name!==undefined?String(data.name).trim():item.name,category=data?.category!==undefined?(String(data.category).trim()||"Outros"):item.category;
        const price=data?.price!==undefined?(data.price===null||data.price===""?null:Number(data.price)):item.price;
        const quantity=data?.quantity!==undefined?Number(data.quantity):item.quantity,unit=data?.unit!==undefined?(String(data.unit).trim()||"un."):item.unit;
        const store=data?.store!==undefined?String(data.store).trim():item.store||"",done=data?.done!==undefined?(data.done?1:0):item.done,updated=now();
        const completedAt=done?(item.done?item.completed_at:updated):null;
        await env.DB.prepare(`UPDATE items SET name=?,category=?,price=?,quantity=?,unit=?,store=?,done=?,updated_at=?,completed_at=? WHERE id=?`).bind(name,category,Number.isFinite(price)?price:null,Number.isFinite(quantity)&&quantity>0?quantity:1,unit,store,done,updated,completedAt,itemId).run();
        if(done&&!item.done){await env.DB.prepare(`INSERT INTO history(id,list_id,item_name,category,price,quantity,completed_at) VALUES(?,?,?,?,?,?,?)`).bind(uid(),item.list_id,name,category,Number.isFinite(price)?price:null,Number.isFinite(quantity)&&quantity>0?quantity:1,completedAt).run()}
        return json(await env.DB.prepare("SELECT * FROM items WHERE id=?").bind(itemId).first());
      }
      if(req.method==="DELETE"){await env.DB.prepare("DELETE FROM items WHERE id=?").bind(itemId).run();return json({ok:true})}
    }

    const historyMatch=path.match(/^\/api\/lists\/([^/]+)\/history$/);
    if(historyMatch&&req.method==="GET"){
      const listId=historyMatch[1];const owned=await env.DB.prepare("SELECT id FROM lists WHERE id=? AND household_id=?").bind(listId,hid).first();if(!owned)return json({error:"List not found."},404);
      const r=await env.DB.prepare(`SELECT id,item_name,category,price,quantity,completed_at FROM history WHERE list_id=? ORDER BY completed_at DESC`).bind(listId).all();return json({results:r.results||[]});
    }

    if(path==="/api/recipes"&&req.method==="GET"){
      const r=await env.DB.prepare("SELECT * FROM recipes WHERE household_id=? ORDER BY updated_at DESC").bind(hid).all();return json({results:(r.results||[]).map(recipeRow)});
    }
    if(path==="/api/recipes"&&req.method==="POST"){
      const data=await body(req),name=String(data?.name??"").trim();if(!name)return json({error:"Recipe name is required."},400);
      const ingredients=Array.isArray(data?.ingredients)?data.ingredients.map(x=>String(x).trim()).filter(Boolean):[];const notes=String(data?.notes??"").trim(),ts=now(),id=uid();
      await env.DB.prepare("INSERT INTO recipes(id,household_id,name,ingredients_json,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,hid,name,JSON.stringify(ingredients),notes,ts,ts).run();return json(recipeRow(await env.DB.prepare("SELECT * FROM recipes WHERE id=?").bind(id).first()),201);
    }
    const recipeMatch=path.match(/^\/api\/recipes\/([^/]+)$/);
    if(recipeMatch){
      const id=recipeMatch[1];const r=await env.DB.prepare("SELECT * FROM recipes WHERE id=? AND household_id=?").bind(id,hid).first();if(!r)return json({error:"Recipe not found."},404);
      if(req.method==="GET")return json(recipeRow(r));
      if(req.method==="PUT"){
        const data=await body(req),name=data?.name!==undefined?String(data.name).trim():r.name,ingredients=Array.isArray(data?.ingredients)?data.ingredients.map(x=>String(x).trim()).filter(Boolean):JSON.parse(r.ingredients_json||"[]"),notes=data?.notes!==undefined?String(data.notes).trim():r.notes,ts=now();
        await env.DB.prepare("UPDATE recipes SET name=?,ingredients_json=?,notes=?,updated_at=? WHERE id=?").bind(name,JSON.stringify(ingredients),notes,ts,id).run();return json(recipeRow(await env.DB.prepare("SELECT * FROM recipes WHERE id=?").bind(id).first()));
      }
      if(req.method==="DELETE"){await env.DB.prepare("DELETE FROM recipes WHERE id=?").bind(id).run();return json({ok:true})}
    }

    if(path==="/api/search"&&req.method==="GET"){
      const q=(url.searchParams.get("q")||"").trim().slice(0,80);if(!q)return json({items:[],history:[],recipes:[]});const like=`%${q}%`;
      const [items,history,recipes]=await Promise.all([
        env.DB.prepare(`SELECT i.id,i.list_id,i.name,i.category,i.store,l.name AS list_name FROM items i JOIN lists l ON l.id=i.list_id WHERE l.household_id=? AND i.name LIKE ? ORDER BY i.updated_at DESC LIMIT 20`).bind(hid,like).all(),
        env.DB.prepare(`SELECT h.id,h.list_id,h.item_name,h.category,h.completed_at,l.name AS list_name FROM history h JOIN lists l ON l.id=h.list_id WHERE l.household_id=? AND h.item_name LIKE ? ORDER BY h.completed_at DESC LIMIT 20`).bind(hid,like).all(),
        env.DB.prepare(`SELECT id,name,notes,ingredients_json FROM recipes WHERE household_id=? AND (name LIKE ? OR notes LIKE ? OR ingredients_json LIKE ?) ORDER BY updated_at DESC LIMIT 20`).bind(hid,like,like,like).all()
      ]);
      return json({items:items.results||[],history:history.results||[],recipes:(recipes.results||[]).map(recipeRow)});
    }
    return json({error:"Not found."},404);
  }catch(error){console.error(error);return json({error:"Server error.",detail:String(error?.message||error)},500)}
}};
