const API = "https://shoppar.amok-limbo.workers.dev";
const TOKEN_KEY = "shoppar_token";
const PIN_KEY = "shoppar_pin";
const LANG_KEY = "shoppar_lang";
const THEME_KEY = "shoppar_theme";
const LOCK_TIMEOUT = 30 * 1000;
let backgroundAt = null;

const state = {
  lang: localStorage.getItem(LANG_KEY) || "EN",
  theme: localStorage.getItem(THEME_KEY) || "dark",
  lists: [],
  activeList: null,
  items: [],
  history: [],
  activeCategory: "Outros",
  editCategory: "Outros"
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const translations = {
  EN:{
    subtitle:"Shared shopping list", shared:"Shared household", pinTitle:"Enter your 4-digit PIN",
    pinHint:"Use the same PIN on both devices.", continue:"Continue", invalidPin:"PIN must contain 4 digits.",
    connectionError:"Could not connect. Please try again.", shopping:"SHOPPING", myLists:"My lists",
    addItem:"Add product", addItemHint:"Add a product with quantity, price and category.",
    itemPlaceholder:"What do you need?", add:"Add product", quantity:"Quantity", unit:"Unit", price:"Price",
    total:"Total", clearDone:"Clear completed", empty:"Your list is empty.", emptyHint:"Add your first product above.",
    historyEyebrow:"ACTIVITY", history:"History", historyEmpty:"Nothing completed yet.",
    historyEmptyHint:"Completed products will appear here.", preferences:"PREFERENCES", settings:"Settings",
    language:"Language", languageHint:"Only this device changes.", appearance:"Appearance",
    appearanceHint:"Only this device changes.", sharedPin:"Shared PIN",
    sharedPinHint:"The same PIN connects your devices to the same household.", changePin:"Change PIN",
    aboutText:"Shared shopping, made simple.", listsNav:"Lists", historyNav:"History", settingsNav:"Settings",
    editEyebrow:"PRODUCT", edit:"Edit product", save:"Save changes", cancel:"Cancel", itemName:"Product",
    category:"Category", deleteItem:"Delete product", light:"Light", dark:"Dark", noHistory:"No completed products.",
    confirmDelete:"Delete this product?", syncDone:"Synced", syncing:"Syncing…", saved:"Saved", added:"Added",
    syncError:"Sync failed. Please try again."
  },
  PT:{
    subtitle:"Lista de compras partilhada", shared:"Agregado familiar partilhado", pinTitle:"Introduz o PIN de 4 dígitos",
    pinHint:"Usa o mesmo PIN nos dois dispositivos.", continue:"Continuar", invalidPin:"O PIN tem de ter 4 dígitos.",
    connectionError:"Não foi possível ligar. Tenta novamente.", shopping:"COMPRAS", myLists:"As minhas listas",
    addItem:"Adicionar produto", addItemHint:"Adiciona um produto com quantidade, preço e categoria.",
    itemPlaceholder:"O que precisas?", add:"Adicionar produto", quantity:"Quantidade", unit:"Unidade", price:"Preço",
    total:"Total", clearDone:"Limpar concluídos", empty:"A lista está vazia.", emptyHint:"Adiciona o primeiro produto acima.",
    historyEyebrow:"ATIVIDADE", history:"Histórico", historyEmpty:"Ainda não há produtos concluídos.",
    historyEmptyHint:"Os produtos concluídos aparecem aqui.", preferences:"PREFERÊNCIAS", settings:"Definições",
    language:"Idioma", languageHint:"Só altera este dispositivo.", appearance:"Aparência",
    appearanceHint:"Só altera este dispositivo.", sharedPin:"PIN partilhado",
    sharedPinHint:"O mesmo PIN liga os teus dispositivos ao mesmo agregado familiar.", changePin:"Alterar PIN",
    aboutText:"Compras partilhadas, de forma simples.", listsNav:"Listas", historyNav:"Histórico", settingsNav:"Definições",
    editEyebrow:"PRODUTO", edit:"Editar produto", save:"Guardar alterações", cancel:"Cancelar", itemName:"Produto",
    category:"Categoria", deleteItem:"Eliminar produto", light:"Claro", dark:"Escuro", noHistory:"Não há produtos concluídos.",
    confirmDelete:"Eliminar este produto?", syncDone:"Sincronizado", syncing:"A sincronizar…", saved:"Guardado", added:"Adicionado",
    syncError:"A sincronização falhou. Tenta novamente."
  }
};

const categoryNames = {
  EN:{Outros:"Other",Fruta:"Fruit",Vegetais:"Vegetables",Laticínios:"Dairy",Casa:"Home",Higiene:"Hygiene"},
  PT:{Outros:"Outros",Fruta:"Fruta",Vegetais:"Vegetais",Laticínios:"Laticínios",Casa:"Casa",Higiene:"Higiene"}
};

function t(k){return translations[state.lang]?.[k] || translations.EN[k] || k;}
function catLabel(c){return categoryNames[state.lang]?.[c] || c;}

function applyLanguage(){
  document.documentElement.lang = state.lang==="PT" ? "pt-PT":"en";
  $$("[data-i18n]").forEach(e=>e.textContent=t(e.dataset.i18n));
  $$("[data-i18n-placeholder]").forEach(e=>e.placeholder=t(e.dataset.i18nPlaceholder));
  $$("[data-category-label]").forEach(e=>e.textContent=catLabel(e.dataset.categoryLabel));
  $$("[data-lang]").forEach(e=>e.classList.toggle("active",e.dataset.lang===state.lang));
  updateCategoryButtons();
  updateThemeButton();
  renderItems();
  renderHistory();
}

function setLanguage(lang){
  state.lang=lang; localStorage.setItem(LANG_KEY,lang); applyLanguage();
}

function applyTheme(){
  document.documentElement.dataset.theme=state.theme;
  updateThemeButton();
}

function updateThemeButton(){
  const icon=$("#themeToggle"), setting=$("#settingsTheme");
  if(icon){icon.textContent=state.theme==="dark"?"☀️":"◐";icon.title=state.theme==="dark"?t("light"):t("dark");}
  if(setting) setting.textContent=state.theme==="dark"?t("dark"):t("light");
}

function toggleTheme(){
  state.theme=state.theme==="dark"?"light":"dark";
  localStorage.setItem(THEME_KEY,state.theme); applyTheme();
}

async function api(path,options={}){
  const headers=new Headers(options.headers||{});
  headers.set("Content-Type","application/json");
  const token=localStorage.getItem(TOKEN_KEY);
  if(token) headers.set("X-Household-Token",token);
  const r=await fetch(`${API}${path}`,{...options,headers});
  let data={}; try{data=await r.json()}catch{}
  if(!r.ok){const e=new Error(data.error||t("connectionError"));e.status=r.status;throw e;}
  return data;
}

// App lock: keep the token for synchronization, but hide the app after
// 30 seconds in the background. Returning before 30s keeps the session.
// Returning after 30s requires the 4-digit PIN again.
function lockApp() {
  $("#app").hidden = true;
  $("#pinScreen").hidden = false;
  entered = "";
  updatePinDots();
  $("#pinError").textContent = "";
}

async function checkAppLock() {
  if (backgroundAt === null) return;
  const elapsed = Date.now() - backgroundAt;
  backgroundAt = null;
  if (elapsed >= LOCK_TIMEOUT && localStorage.getItem(TOKEN_KEY)) {
    lockApp();
    return;
  }
  if (localStorage.getItem(TOKEN_KEY) && !$("#app").hidden) {
    try { await loadLists(!!localStorage.getItem(PIN_KEY)); await loadHistory(); } catch {}
  }
}

// PIN
let entered="";
function updatePinDots(){
  $$(".pin-dot").forEach((d,i)=>d.classList.toggle("filled",i<entered.length));
  $("#continuePin").disabled=entered.length!==4;
}
function addDigit(d){if(entered.length<4){entered+=d;updatePinDots();}}
function removeDigit(){entered=entered.slice(0,-1);updatePinDots();}
async function submitPin(){
  if(entered.length!==4)return;
  const pin=entered; $("#pinError").textContent=""; $("#continuePin").disabled=true;
  try{
    const result=await api("/api/access",{method:"POST",body:JSON.stringify({pin})});
    localStorage.setItem(TOKEN_KEY,result.token); localStorage.setItem(PIN_KEY,pin);
    $("#pinScreen").hidden=true; $("#app").hidden=false; entered=""; updatePinDots();
    await loadLists();
  }catch(e){$("#pinError").textContent=e.message||t("connectionError");entered="";updatePinDots();}
}

// Data
async function refreshSessionFromPin(){
  const pin=localStorage.getItem(PIN_KEY);
  if(!/^\d{4}$/.test(pin||"")) return false;
  const result=await api("/api/access",{method:"POST",body:JSON.stringify({pin})});
  if(result?.token) localStorage.setItem(TOKEN_KEY,result.token);
  return true;
}

async function loadLists(reconnect=false){
  if(reconnect) await refreshSessionFromPin();
  const data=await api("/api/lists"); state.lists=data.results||[];
  if(!state.activeList || !state.lists.some(x=>x.id===state.activeList.id)) state.activeList=state.lists[0]||null;
  renderLists(); await loadItems();
}
async function loadItems(){
  if(!state.activeList){state.items=[];renderItems();return;}
  const data=await api(`/api/lists/${state.activeList.id}/items`); state.items=data.results||[]; renderItems();
}
async function loadHistory(){
  if(!state.activeList){state.history=[];renderHistory();return;}
  const data=await api(`/api/lists/${state.activeList.id}/history`); state.history=data.results||[]; renderHistory();
}

function renderLists(){
  const c=$("#listTabs"); c.innerHTML="";
  state.lists.forEach(list=>{
    const b=document.createElement("button");
    b.className=`list-tab ${state.activeList?.id===list.id?"active":""}`;
    b.innerHTML=`<span>${list.name==="Supermercado"?"🛒":list.name==="Casa"?"⌂":"☷"}</span>${list.name==="Supermercado"?(state.lang==="PT"?"Supermercado":"Supermarket"):list.name}`;
    b.onclick=async()=>{state.activeList=list;renderLists();await loadItems();};
    c.appendChild(b);
  });
}

function formatPrice(p){
  if(p===null||p===undefined||p==="")return "";
  const n=Number(p); if(!Number.isFinite(n))return "";
  return new Intl.NumberFormat(state.lang==="PT"?"pt-PT":"en-GB",{style:"currency",currency:"EUR"}).format(n);
}

function renderItems(){
  if(!$("#items"))return;
  const c=$("#items"); c.innerHTML="";
  const empty=$("#emptyState");
  empty.hidden=state.items.length>0;
  state.items.forEach(item=>{
    const row=document.createElement("article"); row.className=`item ${item.done?"done":""}`;
    const check=document.createElement("button");check.className="check";check.textContent=item.done?"✓":"";check.onclick=()=>toggleItem(item);
    const body=document.createElement("div");body.className="item-body";
    const name=document.createElement("strong");name.className="item-name";name.textContent=item.name;
    const meta=document.createElement("div");meta.className="item-meta";
    meta.innerHTML=`<span class="cat-badge">${catLabel(item.category)}</span><span>${item.quantity} ${item.unit}</span>${formatPrice(item.price)?`<span>${formatPrice(item.price)}</span>`:""}`;
    body.append(name,meta);
    const actions=document.createElement("div");actions.className="item-actions";
    const edit=document.createElement("button");edit.className="row-action";edit.textContent="✎";edit.title=t("edit");edit.onclick=()=>openEdit(item);
    const del=document.createElement("button");del.className="row-action danger";del.textContent="×";del.title=t("deleteItem");del.onclick=()=>deleteItem(item);
    actions.append(edit,del);row.append(check,body,actions);c.appendChild(row);
  });
  updateTotal();
}

function updateTotal(){
  const total=state.items.filter(i=>!i.done).reduce((s,i)=>s+((Number(i.price)||0)*(Number(i.quantity)||1)),0);
  $("#total").textContent=formatPrice(total)||formatPrice(0);
}

function updateCategoryButtons(){
  $$(".category-chip[data-category]").forEach(b=>{
    b.classList.toggle("active",b.dataset.category===state.activeCategory);
    const label=b.querySelector("[data-category-label]");
    if(label)label.textContent=catLabel(b.dataset.category);
  });
  $$(".category-chip[data-edit-category]").forEach(b=>{
    b.classList.toggle("active",b.dataset.editCategory===state.editCategory);
    b.textContent=catLabel(b.dataset.editCategory);
  });
}

async function addItem(){
  const name=$("#itemName").value.trim(); if(!name||!state.activeList)return;
  const priceRaw=$("#itemPrice").value.trim(); const price=priceRaw===""?null:Number(priceRaw.replace(",","."));
  const qty=Number($("#itemQty").value||1), unit=$("#itemUnit").value.trim()||"un.";
  try{
    await api(`/api/lists/${state.activeList.id}/items`,{method:"POST",body:JSON.stringify({
      name,category:state.activeCategory,price:Number.isFinite(price)?price:null,
      quantity:Number.isFinite(qty)&&qty>0?qty:1,unit
    })});
    $("#itemName").value="";$("#itemPrice").value="";$("#itemQty").value="1";$("#itemUnit").value="un.";
    toast(t("added")); await loadItems();
  }catch(e){toast(e.message,true);}
}

async function toggleItem(item){
  try{
    await api(`/api/items/${item.id}`,{method:"PUT",body:JSON.stringify({done:!item.done})});
    await loadItems(); await loadHistory();
  }catch(e){toast(e.message,true);}
}

async function deleteItem(item){
  if(!confirm(t("confirmDelete")))return;
  try{await api(`/api/items/${item.id}`,{method:"DELETE"});await loadItems();}catch(e){toast(e.message,true);}
}

async function clearCompleted(){
  for(const item of state.items.filter(i=>i.done)) await api(`/api/items/${item.id}`,{method:"DELETE"});
  await loadItems(); toast(t("syncDone"));
}

// Edit
function openEdit(item){
  $("#editItemId").value=item.id;$("#editItemName").value=item.name||"";
  $("#editItemQty").value=item.quantity??1;$("#editItemUnit").value=item.unit||"un.";
  $("#editItemPrice").value=item.price??"";$("#editItemCategory").value=item.category||"Outros";
  state.editCategory=item.category||"Outros";updateCategoryButtons();$("#editModal").hidden=false;
}
function closeEdit(){$("#editModal").hidden=true;}
async function saveEdit(){
  const id=$("#editItemId").value,name=$("#editItemName").value.trim();if(!id||!name)return;
  const raw=$("#editItemPrice").value.trim(),price=raw===""?null:Number(raw.replace(",",".")),qty=Number($("#editItemQty").value||1);
  try{
    await api(`/api/items/${id}`,{method:"PUT",body:JSON.stringify({
      name,quantity:Number.isFinite(qty)&&qty>0?qty:1,unit:$("#editItemUnit").value.trim()||"un.",
      price:Number.isFinite(price)?price:null,category:state.editCategory
    })});
    closeEdit();await loadItems();toast(t("saved"));
  }catch(e){toast(e.message,true);}
}

// History
function formatDate(ts){
  const d=new Date(Number(ts));
  return new Intl.DateTimeFormat(state.lang==="PT"?"pt-PT":"en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
function renderHistory(){
  if(!$("#historyList"))return;
  const c=$("#historyList");c.innerHTML="";
  $("#historyEmpty").hidden=state.history.length>0;
  let total=0;
  state.history.forEach(h=>{
    total+=(Number(h.price)||0)*(Number(h.quantity)||1);
    const row=document.createElement("article");row.className="history-row";
    row.innerHTML=`<div class="history-check">✓</div><div class="history-body"><strong>${escapeHtml(h.item_name)}</strong><div><span>${catLabel(h.category)}</span><span>${h.quantity} ${escapeHtml(h.unit||"un.")}</span></div></div><div class="history-right"><strong>${formatPrice(h.price)||"—"}</strong><small>${formatDate(h.completed_at)}</small></div>`;
    c.appendChild(row);
  });
  $("#historyTotal").textContent=formatPrice(total)||formatPrice(0);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function showView(id){
  $$(".view").forEach(v=>v.hidden=v.id!==id);
  $$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.view===id));
  if(id==="historyView")loadHistory();
}
function toast(msg,error=false){
  const el=$("#toast");el.textContent=msg;el.classList.toggle("error",error);el.classList.add("show");
  clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove("show"),1800);
}

function bind(){
  $$("[data-digit]").forEach(b=>b.onclick=()=>addDigit(b.dataset.digit));
  $("#deleteDigit").onclick=removeDigit;$("#continuePin").onclick=submitPin;
  $("#langENPin").onclick=()=>setLanguage("EN");$("#langPTPin").onclick=()=>setLanguage("PT");
  $("#langENApp").onclick=()=>setLanguage("EN");$("#langPTApp").onclick=()=>setLanguage("PT");
  $("#themeToggle").onclick=toggleTheme;$("#settingsTheme").onclick=toggleTheme;
  $("#sync").onclick=async()=>{
    try{
      $("#sync").classList.add("syncing");
      await loadLists(true);
      await loadHistory();
      toast(t("syncDone"));
    }catch(e){ toast(t("syncError"),true); }
    finally{ $("#sync").classList.remove("syncing"); }
  };
  $("#addItem").onclick=addItem;$("#itemName").onkeydown=e=>{if(e.key==="Enter")addItem();};
  $("#clearCompleted").onclick=clearCompleted;
  $("#editClose").onclick=closeEdit;$("#editCancel").onclick=closeEdit;$("#editSave").onclick=saveEdit;
  $$("[data-category]").forEach(b=>b.onclick=()=>{state.activeCategory=b.dataset.category;updateCategoryButtons();});
  $$("[data-edit-category]").forEach(b=>b.onclick=()=>{state.editCategory=b.dataset.editCategory;updateCategoryButtons();});
  $$(".nav-item").forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $("#changePin").onclick=()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(PIN_KEY);$("#app").hidden=true;$("#pinScreen").hidden=false;showView("listsView");};
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (localStorage.getItem(TOKEN_KEY)) backgroundAt = Date.now();
    return;
  }
  checkAppLock();
});

window.addEventListener("pageshow", checkAppLock);

async function start(){
  applyTheme();applyLanguage();bind();updatePinDots();
  const token=localStorage.getItem(TOKEN_KEY);
  if(!token){$("#pinScreen").hidden=false;$("#app").hidden=true;return;}
  try{
    $("#pinScreen").hidden=true;$("#app").hidden=false;
    await loadLists(!!localStorage.getItem(PIN_KEY));
    await loadHistory();
  }catch(e){localStorage.removeItem(TOKEN_KEY);$("#pinScreen").hidden=false;$("#app").hidden=true;}
}
start();
