const API = "https://shoppar.amok-limbo.workers.dev";
const APP_VERSION = "2.8";
const TOKEN_KEY = "shoppar_token";
const PIN_KEY = "shoppar_pin";
const LANG_KEY = "shoppar_lang";
const THEME_KEY = "shoppar_theme";
const LOCK_TIMEOUT = 30 * 1000;
const LAST_ACTIVE_KEY = "shoppar_last_active_at";
let backgroundAt = null;
let activityTimer = null;
let entered = "";
let searchTimer = null;

const state = {
  lang: localStorage.getItem(LANG_KEY) || "EN",
  theme: localStorage.getItem(THEME_KEY) || "light",
  lists: [], activeList: null, items: [], history: [], recipes: [],
  activeCategory: "Outros", editCategory: "Outros", editingRecipeId: null
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/\'/g, "&#039;");

const translations = {
  EN:{subtitle:"Shared shopping list",shared:"Shared household",pinTitle:"Enter your 4-digit PIN",pinHint:"Use the same PIN on both devices.",continue:"Continue",invalidPin:"The PIN must contain 4 digits.",connectionError:"Could not connect. Please try again.",shopping:"SHOPPING",myLists:"My lists",addItem:"Add product",addItemHint:"Add a product with quantity, price and category.",itemPlaceholder:"What do you need?",add:"Add product",quantity:"Quantity",unit:"Unit",price:"Price",store:"Store",storePlaceholder:"Where do you buy it?",total:"Total",clearDone:"Clear completed",empty:"Your list is empty.",emptyHint:"Add your first product above.",historyEyebrow:"ACTIVITY",history:"History",historyEmpty:"Nothing completed yet.",historyEmptyHint:"Completed products will appear here.",preferences:"PREFERENCES",settings:"Settings",language:"Language",languageHint:"Only this device changes.",appearance:"Appearance",appearanceHint:"Only this device changes.",sharedPin:"Shared PIN",sharedPinHint:"The same PIN connects your devices to the same household.",changePin:"Change PIN",aboutText:"Shared shopping, made simple.",listsNav:"Lists",historyNav:"History",settingsNav:"Settings",recipesNav:"Recipes",editEyebrow:"PRODUCT",edit:"Edit product",save:"Save changes",cancel:"Cancel",itemName:"Product",category:"Category",deleteItem:"Delete product",light:"Light",dark:"Dark",noHistory:"No completed products.",confirmDelete:"Delete this product?",syncDone:"Synced",syncing:"Syncing…",saved:"Saved",added:"Added",syncError:"Sync failed. Please try again.",pinChangeEyebrow:"SECURITY",changePinTitle:"Change PIN",changePinHint:"Choose a new 4-digit PIN. It stays connected to this shared household on all devices.",newPin:"New PIN",confirmPin:"Confirm PIN",savePin:"Save PIN",pinMismatch:"The PINs do not match.",pinFormat:"The PIN must contain exactly 4 digits.",pinInUse:"This PIN is already in use.",recipesEyebrow:"RECIPES",recipes:"Dishes & recipes",newRecipe:"New recipe",recipesEmpty:"No recipes yet.",recipesEmptyHint:"Create a recipe and keep its ingredients here.",recipeEyebrow:"RECIPE",recipeName:"Recipe name",ingredients:"Ingredients",ingredientsPlaceholder:"One ingredient per line",recipeNotes:"Notes",notesPlaceholder:"Preparation or notes",addToList:"Add ingredients to list",editRecipe:"Edit recipe",deleteRecipe:"Delete recipe",recipeSaved:"Recipe saved",recipeDeleted:"Recipe deleted",recipeAdded:"Ingredients added",recipeError:"Could not save recipe.",searchEyebrow:"SEARCH",search:"Search",searchPlaceholder:"Search products, history or recipes…",searchNothing:"No results.",searchProduct:"Product",searchRecipe:"Recipe",searchHistory:"History",searchIn:"in",homeStoreHint:"Where to buy it"},
  PT:{subtitle:"Lista de compras partilhada",shared:"Agregado familiar partilhado",pinTitle:"Introduz o PIN de 4 dígitos",pinHint:"Usa o mesmo PIN nos dois dispositivos.",continue:"Continuar",invalidPin:"O PIN tem de ter 4 dígitos.",connectionError:"Não foi possível ligar. Tenta novamente.",shopping:"COMPRAS",myLists:"As minhas listas",addItem:"Adicionar produto",addItemHint:"Adiciona um produto com quantidade, preço e categoria.",itemPlaceholder:"O que precisas?",add:"Adicionar produto",quantity:"Quantidade",unit:"Unidade",price:"Preço",store:"Loja",storePlaceholder:"Onde compras?",total:"Total",clearDone:"Limpar concluídos",empty:"A lista está vazia.",emptyHint:"Adiciona o primeiro produto acima.",historyEyebrow:"ATIVIDADE",history:"Histórico",historyEmpty:"Ainda não há produtos concluídos.",historyEmptyHint:"Os produtos concluídos aparecem aqui.",preferences:"PREFERÊNCIAS",settings:"Definições",language:"Idioma",languageHint:"Só altera este dispositivo.",appearance:"Aparência",appearanceHint:"Só altera este dispositivo.",sharedPin:"PIN partilhado",sharedPinHint:"O mesmo PIN liga os teus dispositivos ao mesmo agregado familiar.",changePin:"Alterar PIN",aboutText:"Compras partilhadas, de forma simples.",listsNav:"Listas",historyNav:"Histórico",settingsNav:"Definições",recipesNav:"Receitas",editEyebrow:"PRODUTO",edit:"Editar produto",save:"Guardar alterações",cancel:"Cancelar",itemName:"Produto",category:"Categoria",deleteItem:"Eliminar produto",light:"Claro",dark:"Escuro",noHistory:"Não há produtos concluídos.",confirmDelete:"Eliminar este produto?",syncDone:"Sincronizado",syncing:"A sincronizar…",saved:"Guardado",added:"Adicionado",syncError:"A sincronização falhou. Tenta novamente.",pinChangeEyebrow:"SEGURANÇA",changePinTitle:"Alterar PIN",changePinHint:"Escolhe um novo PIN de 4 dígitos. O agregado mantém-se ligado em todos os dispositivos.",newPin:"Novo PIN",confirmPin:"Confirmar PIN",savePin:"Guardar PIN",pinMismatch:"Os PINs não coincidem.",pinFormat:"O PIN tem de ter exatamente 4 dígitos.",pinInUse:"Este PIN já está a ser utilizado.",recipesEyebrow:"RECEITAS",recipes:"Pratos e receitas",newRecipe:"Nova receita",recipesEmpty:"Ainda não tens receitas.",recipesEmptyHint:"Cria uma receita e guarda os ingredientes aqui.",recipeEyebrow:"RECEITA",recipeName:"Nome da receita",ingredients:"Ingredientes",ingredientsPlaceholder:"Um ingrediente por linha",recipeNotes:"Notas",notesPlaceholder:"Preparação ou notas",addToList:"Adicionar ingredientes à lista",editRecipe:"Editar receita",deleteRecipe:"Eliminar receita",recipeSaved:"Receita guardada",recipeDeleted:"Receita eliminada",recipeAdded:"Ingredientes adicionados",recipeError:"Não foi possível guardar a receita.",searchEyebrow:"PESQUISA",search:"Pesquisar",searchPlaceholder:"Pesquisar produtos, histórico ou receitas…",searchNothing:"Não foram encontrados resultados.",searchProduct:"Produto",searchRecipe:"Receita",searchHistory:"Histórico",searchIn:"em",homeStoreHint:"Onde comprar"}
};
const categoryNames={EN:{Outros:"Other",Fruta:"Fruit",Vegetais:"Vegetables",Laticínios:"Dairy",Casa:"Home",Higiene:"Hygiene"},PT:{Outros:"Outros",Fruta:"Fruta",Vegetais:"Vegetais",Laticínios:"Laticínios",Casa:"Casa",Higiene:"Higiene"}};
function t(k){return translations[state.lang]?.[k]||translations.EN[k]||k}
function catLabel(c){return categoryNames[state.lang]?.[c]||c}

function applyLanguage(){
  document.documentElement.lang=state.lang==="PT"?"pt-PT":"en";
  $$('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));
  $$('[data-i18n-placeholder]').forEach(e=>e.placeholder=t(e.dataset.i18nPlaceholder));
  $$('[data-category-label]').forEach(e=>e.textContent=catLabel(e.dataset.categoryLabel));
  $$('[data-lang]').forEach(e=>e.classList.toggle('active',e.dataset.lang===state.lang));
  updateCategoryButtons(); updateThemeButton(); updateStoreVisibility(); renderItems(); renderHistory(); renderRecipes();
}
function setLanguage(lang){state.lang=lang;localStorage.setItem(LANG_KEY,lang);applyLanguage()}
function applyTheme(){document.documentElement.dataset.theme=state.theme;updateThemeButton()}
function updateThemeButton(){const i=$('#themeToggle'),s=$('#settingsTheme');if(i){i.textContent=state.theme==='dark'?'☀️':'◐';i.title=state.theme==='dark'?t('light'):t('dark')}if(s)s.textContent=state.theme==='dark'?t('dark'):t('light')}
function toggleTheme(){state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem(THEME_KEY,state.theme);applyTheme()}

async function rawAccess(pin){const r=await fetch(`${API}/api/access`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin}),cache:'no-store'});let d={};try{d=await r.json()}catch{}if(!r.ok){const e=new Error(d.error||t('connectionError'));e.status=r.status;throw e}return d}
async function api(path,options={},retried=false){const headers=new Headers(options.headers||{});headers.set('Content-Type','application/json');const token=localStorage.getItem(TOKEN_KEY);if(token)headers.set('X-Household-Token',token);const r=await fetch(`${API}${path}`,{...options,headers,cache:'no-store'});let d={};try{d=await r.json()}catch{}if(r.status===401&&!retried&&localStorage.getItem(PIN_KEY)&&path!=='/api/access'){try{const a=await rawAccess(localStorage.getItem(PIN_KEY));if(a?.token){localStorage.setItem(TOKEN_KEY,a.token);return api(path,options,true)}}catch{}}if(!r.ok){const e=new Error(d.error||t('connectionError'));e.status=r.status;throw e}return d}

function markActive(){
  if(localStorage.getItem(TOKEN_KEY)&&!$('#app').hidden&&!document.hidden){
    localStorage.setItem(LAST_ACTIVE_KEY,String(Date.now()));
  }
}
function lockApp(){
  localStorage.removeItem(LAST_ACTIVE_KEY);
  backgroundAt=null;
  $('#app').hidden=true;
  $('#pinScreen').hidden=false;
  entered='';
  updatePinDots();
  $('#pinError').textContent='';
}
function rememberBackground(){
  if(localStorage.getItem(TOKEN_KEY)&&!$('#app').hidden){
    const now=Date.now();
    backgroundAt=now;
    localStorage.setItem(LAST_ACTIVE_KEY,String(now));
  }
}
async function checkAppLock(){
  const stored=Number(localStorage.getItem(LAST_ACTIVE_KEY)||0);
  const startedAt=backgroundAt ?? (stored || null);
  if(!startedAt){
    if(localStorage.getItem(TOKEN_KEY)&&!$('#app').hidden)markActive();
    return;
  }
  const elapsed=Date.now()-startedAt;
  backgroundAt=null;
  if(elapsed>=LOCK_TIMEOUT&&localStorage.getItem(TOKEN_KEY)){
    lockApp();
    return;
  }
  if(localStorage.getItem(TOKEN_KEY)&&!$('#app').hidden){
    markActive();
    try{await loadLists(true)}catch{}
  }
}
function startActivityTracking(){
  clearInterval(activityTimer);
  activityTimer=setInterval(()=>{ if(!document.hidden && !$('#app').hidden) markActive(); },5000);
  markActive();
}
function updatePinDots(){$$('.pin-dot').forEach((d,i)=>d.classList.toggle('filled',i<entered.length));$('#continuePin').disabled=entered.length!==4}
function addDigit(d){if(entered.length<4){entered+=d;updatePinDots()}}
function removeDigit(){entered=entered.slice(0,-1);updatePinDots()}
async function submitPin(){if(entered.length!==4)return;const pin=entered;$('#pinError').textContent='';$('#continuePin').disabled=true;try{const r=await rawAccess(pin);localStorage.setItem(TOKEN_KEY,r.token);localStorage.setItem(PIN_KEY,pin);localStorage.removeItem(LAST_ACTIVE_KEY);$('#pinScreen').hidden=true;$('#app').hidden=false;entered='';updatePinDots();markActive();startActivityTracking();await loadLists()}catch(e){$('#pinError').textContent=e.message||t('connectionError');entered='';updatePinDots()}}
async function refreshSessionFromPin(){const pin=localStorage.getItem(PIN_KEY);if(!/^\d{4}$/.test(pin||''))return false;const r=await rawAccess(pin);if(!r?.token)return false;localStorage.setItem(TOKEN_KEY,r.token);return true}

async function loadLists(reconnect=false){if(reconnect)await refreshSessionFromPin();const d=await api('/api/lists');state.lists=d.results||[];if(!state.activeList||!state.lists.some(x=>x.id===state.activeList.id))state.activeList=state.lists[0]||null;renderLists();await loadItems()}
async function loadItems(){if(!state.activeList){state.items=[];renderItems();return}const d=await api(`/api/lists/${state.activeList.id}/items`);state.items=d.results||[];renderItems()}
async function loadHistory(){if(!state.activeList){state.history=[];renderHistory();return}const d=await api(`/api/lists/${state.activeList.id}/history`);state.history=d.results||[];renderHistory()}
async function loadRecipes(){const d=await api('/api/recipes');state.recipes=d.results||[];renderRecipes()}

function renderLists(){
  const c=$('#listTabs');
  if(!c)return;
  c.replaceChildren();
  const lists=Array.isArray(state.lists)?state.lists:[];
  lists.forEach(list=>{
    const b=document.createElement('button');
    b.type='button';
    b.className=`list-tab ${state.activeList?.id===list.id?'active':''}`;
    const icon=list.name==='Supermercado'?'🛒':list.name==='Casa'?'⌂':'☷';
    const label=list.name==='Supermercado'?(state.lang==='PT'?'Supermercado':'Supermarket'):list.name;
    const iconEl=document.createElement('span');
    iconEl.textContent=icon;
    const textEl=document.createElement('span');
    textEl.textContent=label;
    b.append(iconEl,textEl);
    b.addEventListener('click',async()=>{state.activeList=list;renderLists();await loadItems();updateStoreVisibility()});
    c.appendChild(b);
  });
}
function formatPrice(p){if(p===null||p===undefined||p==='')return '';const n=Number(p);if(!Number.isFinite(n))return '';return new Intl.NumberFormat(state.lang==='PT'?'pt-PT':'en-GB',{style:'currency',currency:'EUR'}).format(n)}
function renderItems(){if(!$('#items'))return;const c=$('#items');c.innerHTML='';$('#emptyState').hidden=state.items.length>0;state.items.forEach(item=>{const row=document.createElement('article');row.className=`item ${item.done?'done':''}`;const check=document.createElement('button');check.className='check';check.textContent=item.done?'✓':'';check.onclick=()=>toggleItem(item);const body=document.createElement('div');body.className='item-body';const name=document.createElement('strong');name.className='item-name';name.textContent=item.name;const meta=document.createElement('div');meta.className='item-meta';const parts=[catLabel(item.category),`${item.quantity} ${item.unit}`];if(formatPrice(item.price))parts.push(formatPrice(item.price));if(item.store&&state.activeList?.name==='Casa')parts.push(`⌖ ${item.store}`);meta.textContent=parts.join(' · ');body.append(name,meta);const actions=document.createElement('div');actions.className='item-actions';const edit=document.createElement('button');edit.className='row-action';edit.textContent='✎';edit.title=t('edit');edit.onclick=()=>openEdit(item);const del=document.createElement('button');del.className='row-action danger';del.textContent='×';del.title=t('deleteItem');del.onclick=()=>deleteItem(item);actions.append(edit,del);row.append(check,body,actions);c.appendChild(row)});updateTotal()}
function updateTotal(){const total=state.items.filter(i=>!i.done).reduce((s,i)=>s+(Number(i.price)||0)*(Number(i.quantity)||1),0);$('#total').textContent=formatPrice(total)||formatPrice(0)}
function updateCategoryButtons(){$$('.category-chip[data-category]').forEach(b=>{b.classList.toggle('active',b.dataset.category===state.activeCategory);const l=b.querySelector('[data-category-label]');if(l)l.textContent=catLabel(b.dataset.category)});$$('.category-chip[data-edit-category]').forEach(b=>{b.classList.toggle('active',b.dataset.editCategory===state.editCategory);const l=b.querySelector('[data-category-label]');if(l)l.textContent=catLabel(b.dataset.editCategory)})}
function updateStoreVisibility(){const isCasa=state.activeList?.name==='Casa';$('#storeField').hidden=!isCasa;$('#editStoreField').hidden=!isCasa}

async function addItem(){const name=$('#itemName').value.trim();if(!name||!state.activeList)return;const raw=$('#itemPrice').value.trim(),price=raw===''?null:Number(raw.replace(',','.')),qty=Number($('#itemQty').value||1),unit=$('#itemUnit').value.trim()||'un.';try{await api(`/api/lists/${state.activeList.id}/items`,{method:'POST',body:JSON.stringify({name,category:state.activeCategory,price:Number.isFinite(price)?price:null,quantity:Number.isFinite(qty)&&qty>0?qty:1,unit,store:state.activeList.name==='Casa'?$('#itemStore').value.trim():''})});$('#itemName').value='';$('#itemPrice').value='';$('#itemQty').value='1';$('#itemUnit').value='un.';$('#itemStore').value='';toast(t('added'));await loadItems()}catch(e){toast(e.message,true)}}
async function toggleItem(item){try{await api(`/api/items/${item.id}`,{method:'PUT',body:JSON.stringify({done:!item.done})});await loadItems();if($('#historyView').hidden===false)await loadHistory()}catch(e){toast(e.message,true)}}
async function deleteItem(item){if(!confirm(t('confirmDelete')))return;try{await api(`/api/items/${item.id}`,{method:'DELETE'});await loadItems()}catch(e){toast(e.message,true)}}
async function clearCompleted(){for(const item of state.items.filter(i=>i.done))await api(`/api/items/${item.id}`,{method:'DELETE'});await loadItems();toast(t('syncDone'))}
function openEdit(item){$('#editItemId').value=item.id;$('#editItemName').value=item.name||'';$('#editItemQty').value=item.quantity??1;$('#editItemUnit').value=item.unit||'un.';$('#editItemPrice').value=item.price??'';$('#editItemCategory').value=item.category||'Outros';$('#editItemStore').value=item.store||'';state.editCategory=item.category||'Outros';updateCategoryButtons();updateStoreVisibility();$('#editModal').hidden=false}
function closeEdit(){$('#editModal').hidden=true}
async function saveEdit(){const id=$('#editItemId').value,name=$('#editItemName').value.trim();if(!id||!name)return;const raw=$('#editItemPrice').value.trim(),price=raw===''?null:Number(raw.replace(',','.')),qty=Number($('#editItemQty').value||1);try{await api(`/api/items/${id}`,{method:'PUT',body:JSON.stringify({name,quantity:Number.isFinite(qty)&&qty>0?qty:1,unit:$('#editItemUnit').value.trim()||'un.',price:Number.isFinite(price)?price:null,category:state.editCategory,store:state.activeList?.name==='Casa'?$('#editItemStore').value.trim():''})});closeEdit();await loadItems();toast(t('saved'))}catch(e){toast(e.message,true)}}

function formatDate(ts){const d=new Date(Number(ts));return new Intl.DateTimeFormat(state.lang==='PT'?'pt-PT':'en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)}
function renderHistory(){if(!$('#historyList'))return;const c=$('#historyList');c.innerHTML='';$('#historyEmpty').hidden=state.history.length>0;let total=0;state.history.forEach(h=>{total+=(Number(h.price)||0)*(Number(h.quantity)||1);const row=document.createElement('article');row.className='history-row';row.innerHTML=`<div class="history-check">✓</div><div class="history-body"><strong>${escapeHtml(h.item_name)}</strong><div><span>${catLabel(h.category)}</span><span>${h.quantity} ${escapeHtml(h.unit||'un.')}</span></div></div><div class="history-right"><strong>${formatPrice(h.price)||'—'}</strong><small>${formatDate(h.completed_at)}</small></div>`;c.appendChild(row)});$('#historyTotal').textContent=formatPrice(total)||formatPrice(0)}

function renderRecipes(){const c=$('#recipesList');if(!c)return;c.innerHTML='';$('#recipesEmpty').hidden=state.recipes.length>0;state.recipes.forEach(r=>{const card=document.createElement('article');card.className='recipe-card';const ingredients=Array.isArray(r.ingredients)?r.ingredients:[];card.innerHTML=`<div class="recipe-card-head"><div><span class="recipe-mark">✦</span><strong>${escapeHtml(r.name)}</strong></div><div class="recipe-actions"><button class="row-action" title="${t('editRecipe')}">✎</button><button class="row-action danger" title="${t('deleteRecipe')}">×</button></div></div><div class="recipe-ingredients">${ingredients.slice(0,6).map(x=>`<span>• ${escapeHtml(x)}</span>`).join('')}${ingredients.length>6?`<span class="more">+${ingredients.length-6}</span>`:''}</div>${r.notes?`<p class="recipe-notes">${escapeHtml(r.notes)}</p>`:''}<div class="recipe-footer"><button class="secondary small" data-recipe-add="${r.id}">${t('addToList')}</button></div>`;card.querySelector('.row-action').onclick=()=>openRecipe(r);card.querySelectorAll('.row-action')[1].onclick=()=>deleteRecipe(r);card.querySelector('[data-recipe-add]').onclick=()=>addRecipeToList(r);c.appendChild(card)})}
function openRecipe(r=null){state.editingRecipeId=r?.id||null;$('#recipeName').value=r?.name||'';$('#recipeIngredients').value=(r?.ingredients||[]).join('\n');$('#recipeNotes').value=r?.notes||'';$('#recipeError').textContent='';$('#recipeModal').hidden=false}
function closeRecipe(){$('#recipeModal').hidden=true;state.editingRecipeId=null}
async function saveRecipe(){const name=$('#recipeName').value.trim();if(!name)return;const ingredients=$('#recipeIngredients').value.split('\n').map(x=>x.trim()).filter(Boolean);const notes=$('#recipeNotes').value.trim();try{const body=JSON.stringify({name,ingredients,notes});if(state.editingRecipeId)await api(`/api/recipes/${state.editingRecipeId}`,{method:'PUT',body});else await api('/api/recipes',{method:'POST',body});closeRecipe();await loadRecipes();toast(t('recipeSaved'))}catch(e){$('#recipeError').textContent=e.message||t('recipeError')}}
async function deleteRecipe(r){if(!confirm(t('confirmDelete')))return;try{await api(`/api/recipes/${r.id}`,{method:'DELETE'});await loadRecipes();toast(t('recipeDeleted'))}catch(e){toast(e.message,true)}}
async function addRecipeToList(r){if(!state.activeList){toast(t('connectionError'),true);return}try{for(const ingredient of (r.ingredients||[]))await api(`/api/lists/${state.activeList.id}/items`,{method:'POST',body:JSON.stringify({name:ingredient,category:'Outros',quantity:1,unit:'un.',price:null,store:state.activeList.name==='Casa'?'':''})});await loadItems();toast(t('recipeAdded'))}catch(e){toast(e.message,true)}}

function showView(id){$$('.view').forEach(v=>v.hidden=v.id!==id);$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));if(id==='historyView')loadHistory();if(id==='recipesView')loadRecipes()}
function toast(msg,error=false){const el=$('#toast');el.textContent=msg;el.classList.toggle('error',error);el.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove('show'),1800)}

function openSearch(){$('#searchInput').value='';$('#searchResults').innerHTML='';$('#searchModal').hidden=false;setTimeout(()=>$('#searchInput').focus(),80)}
function closeSearch(){$('#searchModal').hidden=true;clearTimeout(searchTimer)}
async function doSearch(){const q=$('#searchInput').value.trim();const c=$('#searchResults');if(!q){c.innerHTML='';return}c.innerHTML='<div class="search-loading">…</div>';try{const d=await api(`/api/search?q=${encodeURIComponent(q)}`);renderSearchResults(d)}catch(e){c.innerHTML=`<div class="search-empty">${escapeHtml(e.message||t('connectionError'))}</div>`}}
function renderSearchResults(d){const c=$('#searchResults');c.innerHTML='';const groups=[['items',t('searchProduct')],['history',t('searchHistory')],['recipes',t('searchRecipe')]];let count=0;groups.forEach(([key,label])=>{const arr=d[key]||[];if(!arr.length)return;count+=arr.length;const h=document.createElement('div');h.className='search-group-title';h.textContent=label;c.appendChild(h);arr.forEach(x=>{const row=document.createElement('button');row.className='search-result';const sub=x.list_name?`${x.list_name}`:x.category?catLabel(x.category):'';row.innerHTML=`<strong>${escapeHtml(x.name||x.item_name)}</strong><small>${escapeHtml(sub)}</small>`;row.onclick=()=>{closeSearch();if(key==='recipes'){showView('recipesView')}else{const list=state.lists.find(l=>l.id===x.list_id);if(list){state.activeList=list;showView('listsView');loadItems()}}};c.appendChild(row)})});if(!count)c.innerHTML=`<div class="search-empty">${t('searchNothing')}</div>`}

function openPinChange(){$('#newPin').value='';$('#confirmPin').value='';$('#pinChangeError').textContent='';$('#pinChangeModal').hidden=false;setTimeout(()=>$('#newPin').focus(),80)}
function closePinChange(){$('#pinChangeModal').hidden=true}
async function savePinChange(){const p1=$('#newPin').value.trim(),p2=$('#confirmPin').value.trim();$('#pinChangeError').textContent='';if(!/^\d{4}$/.test(p1)||!/^\d{4}$/.test(p2)){$('#pinChangeError').textContent=t('pinFormat');return}if(p1!==p2){$('#pinChangeError').textContent=t('pinMismatch');return}try{await api('/api/change-pin',{method:'POST',body:JSON.stringify({new_pin:p1})});localStorage.setItem(PIN_KEY,p1);closePinChange();toast(t('saved'))}catch(e){$('#pinChangeError').textContent=e.status===409?t('pinInUse'):(e.message||t('connectionError'))}}

function bind(){
  $$('[data-digit]').forEach(b=>b.onclick=()=>addDigit(b.dataset.digit));$('#deleteDigit').onclick=removeDigit;$('#continuePin').onclick=submitPin;
  $('#langENPin').onclick=()=>setLanguage('EN');$('#langPTPin').onclick=()=>setLanguage('PT');$('#langENApp').onclick=()=>setLanguage('EN');$('#langPTApp').onclick=()=>setLanguage('PT');
  $('#themeToggle').onclick=toggleTheme;$('#settingsTheme').onclick=toggleTheme;
  $('#sync').onclick=async()=>{try{$('#sync').classList.add('syncing');await refreshSessionFromPin();await loadLists(true);if(!$('#historyView').hidden)await loadHistory();if(!$('#recipesView').hidden)await loadRecipes();toast(t('syncDone'))}catch(e){toast(t('syncError'),true)}finally{$('#sync').classList.remove('syncing')}};
  $('#addItem').onclick=addItem;$('#itemName').onkeydown=e=>{if(e.key==='Enter')addItem()};$('#clearCompleted').onclick=clearCompleted;
  $('#editClose').onclick=closeEdit;$('#editCancel').onclick=closeEdit;$('#editSave').onclick=saveEdit;
  $$('[data-category]').forEach(b=>b.onclick=()=>{state.activeCategory=b.dataset.category;updateCategoryButtons()});$$('[data-edit-category]').forEach(b=>b.onclick=()=>{state.editCategory=b.dataset.editCategory;updateCategoryButtons()});
  $$('.list-tabs').forEach(()=>{});$$('.nav-item').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $('#changePin').onclick=openPinChange;$('#pinChangeClose').onclick=closePinChange;$('#pinChangeCancel').onclick=closePinChange;$('#pinChangeSave').onclick=savePinChange;
  $('#newPin').oninput=()=>$('#newPin').value=$('#newPin').value.replace(/\D/g,'').slice(0,4);$('#confirmPin').oninput=()=>$('#confirmPin').value=$('#confirmPin').value.replace(/\D/g,'').slice(0,4);
  $('#addRecipe').onclick=()=>openRecipe();$('#recipeClose').onclick=closeRecipe;$('#recipeCancel').onclick=closeRecipe;$('#recipeSave').onclick=saveRecipe;
  $('#searchToggle').onclick=openSearch;$('#searchClose').onclick=closeSearch;$('#searchInput').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(doSearch,180)};
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){rememberBackground();return;}
  checkAppLock();
});
window.addEventListener('pagehide',rememberBackground);
window.addEventListener('pageshow',checkAppLock);
async function start(){
  applyTheme();
  applyLanguage();
  bind();
  updatePinDots();
  const token=localStorage.getItem(TOKEN_KEY);
  if(!token){$('#pinScreen').hidden=false;$('#app').hidden=true;return;}
  const stored=Number(localStorage.getItem(LAST_ACTIVE_KEY)||0);
  if(!stored || Date.now()-stored>=LOCK_TIMEOUT){
    lockApp();
    return;
  }
  try{
    $('#pinScreen').hidden=true;
    $('#app').hidden=false;
    markActive();
    startActivityTracking();
    if(localStorage.getItem(PIN_KEY))await refreshSessionFromPin();
    await loadLists(false);
  }catch(e){
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LAST_ACTIVE_KEY);
    $('#pinScreen').hidden=false;
    $('#app').hidden=true;
  }
}
start();
