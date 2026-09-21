const API_URL='https://shoppar.amok-limbo.workers.dev';
const TOKEN_KEY='shoppar-token-v1', PIN_KEY='shoppar-pin-v1', THEME_KEY='shoppar-theme', LANG_KEY='shoppar-lang-v1';

const translations={
  en:{
    htmlLang:'en', title:'Shopping', createPin:'Enter your 4-digit PIN', enterPin:'Enter your 4-digit PIN', remaining:'to buy', estimated:'estimated total', addProduct:'Add product...', price:'Price €', qty:'Qty.', all:'All', pending:'To buy', done:'Purchased', history:'History', clear:'Clear purchased', noHistory:'No history yet.', groceries:'Groceries', home:'Home', supermarket:'Supermarket', produce:'Fruit & vegetables', hygiene:'Hygiene', house:'Home', drinks:'Drinks', other:'Other', unit:'unit', error:'Something went wrong.', invalidPin:'Please enter 4 digits.', invalidLogin:'Invalid PIN.', continuePin:'Continue'
  },
  pt:{
    htmlLang:'pt-PT', title:'Compras', createPin:'Introduz o PIN de 4 dígitos', enterPin:'Introduz o PIN de 4 dígitos', remaining:'por comprar', estimated:'total estimado', addProduct:'Adicionar produto...', price:'Preço €', qty:'Qtd.', all:'Todos', pending:'Por comprar', done:'Comprados', history:'Histórico', clear:'Limpar comprados', noHistory:'Sem histórico.', groceries:'Supermercado', home:'Casa', supermarket:'Supermercado', produce:'Fruta e legumes', hygiene:'Higiene', house:'Casa', drinks:'Bebidas', other:'Outros', unit:'un.', error:'Ocorreu um erro.', invalidPin:'Introduz 4 dígitos.', invalidLogin:'PIN inválido.', continuePin:'Continuar'
  }
};

const categoryKeys=['supermarket','produce','hygiene','house','drinks','other'];
const legacyCategoryMap={'Supermercado':'supermarket','Fruta e legumes':'produce','Higiene':'hygiene','Casa':'house','Bebidas':'drinks','Outros':'other'};
const defaultListMap={'Supermercado':'groceries','Casa':'home'};
let token=localStorage.getItem(TOKEN_KEY), pin=localStorage.getItem(PIN_KEY), entered='', filter='all', lists=[], currentList=null, items=[];
let lang=localStorage.getItem(LANG_KEY)||'en';

const $=s=>document.querySelector(s);
const t=k=>translations[lang][k]??translations.en[k]??k;
const categoryLabel=k=>t(k);
const normalizeCategory=c=>legacyCategoryMap[c]||c||'other';
const api=async(path,opts={})=>{
  if(API_URL.includes('COLOCA_AQUI')) throw new Error('Falta configurar o URL do Worker em public/app.js.');
  const headers={'content-type':'application/json',...(opts.headers||{})};
  if(token)headers['x-household-token']=token;
  const r=await fetch(API_URL+path,{...opts,headers});
  const d=await r.json();
  if(!r.ok){const err=new Error(d.error||t('error'));err.status=r.status;throw err;}
  return d;
};

function setLanguage(next){
  if(!translations[next])return;
  lang=next;
  localStorage.setItem(LANG_KEY,lang);
  document.documentElement.lang=translations[lang].htmlLang;
  applyTranslations();
  renderLists();
  render();
  pinUI();
}

function applyTranslations(){
  $('#appTitle').textContent=t('title');
  $('#remainingLabel').textContent=t('remaining');
  $('#costLabel').textContent=t('estimated');
  $('#name').placeholder=t('addProduct');
  $('#price').placeholder=t('price');
  $('#qty').placeholder=t('qty');
  document.querySelectorAll('.filters button').forEach(b=>b.textContent=t(b.dataset.filter));
  $('#history').textContent=t('history');
  $('#clear').textContent=t('clear');
  $('#historyTitle').textContent=t('history');
  document.querySelectorAll('.language-selector [data-lang]').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang));
  renderCategories();
}

function renderCategories(){
  const current=normalizeCategory($('#category').value);
  $('#category').innerHTML=categoryKeys.map(k=>`<option value="${k}">${categoryLabel(k)}</option>`).join('');
  $('#category').value=categoryKeys.includes(current)?current:'supermarket';
}

function dots(){document.querySelectorAll('.dots i').forEach((x,i)=>x.classList.toggle('on',i<entered.length))}
function pinUI(){
  $('#pinText').textContent=pin?t('enterPin'):t('createPin');
  $('#pinError').textContent='';
  entered='';
  dots();
  const btn=$('#continuePin');
  btn.textContent=t('continuePin');
  btn.disabled=true;
}

async function submitPin(){
  if(entered.length!==4)return;
  const enteredPin=entered;
  if(enteredPin!=='0107'){
    $('#pinError').textContent=t('invalidLogin');
    entered='';
    dots();
    $('#continuePin').disabled=true;
    return;
  }
  try{
    let d;
    // First device creates the shared household; subsequent devices log in.
    try{
      d=await api('/api/login',{method:'POST',body:JSON.stringify({pin:enteredPin})});
    }catch(e){
      if(e.status!==404)throw e;
      d=await api('/api/setup',{method:'POST',body:JSON.stringify({pin:enteredPin})});
    }
    token=d.token;
    pin=enteredPin;
    localStorage.setItem(TOKEN_KEY,token);
    localStorage.setItem(PIN_KEY,pin);
    $('#pin').hidden=true;
    $('#app').hidden=false;
    await load();
  }catch(e){
    $('#pinError').textContent=e.message||t('error');
    entered='';
    dots();
    $('#continuePin').disabled=true;
  }
}

document.querySelectorAll('.language-selector [data-lang]').forEach(b=>b.onclick=()=>setLanguage(b.dataset.lang));
document.querySelectorAll('.keys button').forEach(b=>b.onclick=()=>{
  if(b.id==='back')entered=entered.slice(0,-1);
  else if(entered.length<4)entered+=b.textContent.trim();
  dots();
  $('#continuePin').disabled=entered.length!==4;
});

$('#continuePin').onclick=submitPin;

async function load(){lists=await api('/api/lists');if(!currentList)currentList=lists[0]?.id;renderLists();if(currentList)await loadItems()}
async function loadItems(){items=await api(`/api/lists/${currentList}/items`);render()}
function listName(x){return defaultListMap[x.name]?t(defaultListMap[x.name]):x.name}
function renderLists(){
  $('#lists').innerHTML=lists.map(x=>`<button data-id="${x.id}" class="${x.id===currentList?'active':''}">${escapeHtml(listName(x))}</button>`).join('');
  document.querySelectorAll('#lists button').forEach(b=>b.onclick=async()=>{currentList=b.dataset.id;renderLists();await loadItems()});
}
function money(n){return n==null?'':Number(n).toLocaleString(lang==='pt'?'pt-PT':'en-GB',{style:'currency',currency:'EUR'})}
function dateTime(ts){return new Date(ts).toLocaleString(lang==='pt'?'pt-PT':'en-GB')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function render(){
  const visible=items.filter(x=>filter==='all'||(filter==='pending'&&!x.done)||(filter==='done'&&x.done));
  $('#items').innerHTML=visible.map(x=>{
    const category=categoryLabel(normalizeCategory(x.category));
    return `<li class="${x.done?'done':''}"><button class="check" data-done="${x.id}" aria-label="${x.done?t('done'):t('pending')}"></button><div class="body"><span class="name">${escapeHtml(x.name)}</span><span class="meta">${escapeHtml(category)} · ${x.quantity} ${escapeHtml(x.unit||t('unit'))}${x.price!=null?' · '+money(x.price):''}</span></div><button class="del" data-del="${x.id}" aria-label="Delete">×</button></li>`;
  }).join('');
  $('#remaining').textContent=items.filter(x=>!x.done).length;
  const total=items.filter(x=>!x.done&&x.price!=null).reduce((s,x)=>s+x.price*x.quantity,0);
  $('#cost').textContent=money(total)||(lang==='pt'?'0,00 €':'€0.00');
  document.querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{const x=items.find(i=>i.id===b.dataset.done);await api('/api/items/'+x.id,{method:'PUT',body:JSON.stringify({...x,done:!x.done})});await loadItems()});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await api('/api/items/'+b.dataset.del,{method:'DELETE'});await loadItems()});
}

$('#add').onclick=async()=>{
  const name=$('#name').value.trim();
  if(!name)return;
  await api(`/api/lists/${currentList}/items`,{method:'POST',body:JSON.stringify({name,category:$('#category').value,price:$('#price').value,quantity:$('#qty').value,unit:lang==='pt'?'un.':'unit'})});
  $('#name').value='';$('#price').value='';$('#qty').value='1';await loadItems();$('#name').focus();
};
$('#name').onkeydown=e=>{if(e.key==='Enter')$('#add').click()};
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render()});
$('#clear').onclick=async()=>{for(const x of items.filter(i=>i.done))await api('/api/items/'+x.id,{method:'DELETE'});await loadItems()};
$('#history').onclick=async()=>{const h=await api(`/api/lists/${currentList}/history`);$('#historyList').innerHTML=h.length?h.map(x=>`<div class="hist"><b>${escapeHtml(x.item_name)}</b><br><small>${dateTime(x.completed_at)} · ${escapeHtml(categoryLabel(normalizeCategory(x.category)))}</small></div>`).join(''):`<p>${t('noHistory')}</p>`;$('#modal').hidden=false};
$('#closeModal').onclick=()=>$('#modal').hidden=true;
$('#theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem(THEME_KEY,document.body.classList.contains('dark')?'dark':'light')};
$('#lock').onclick=()=>{if(pin){$('#app').hidden=true;$('#pin').hidden=false;pinUI()}};

if(localStorage.getItem(THEME_KEY)==='dark')document.body.classList.add('dark');
document.documentElement.lang=translations[lang].htmlLang;
applyTranslations();
pinUI();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
setInterval(async()=>{if(!$('#app').hidden&&currentList){try{const fresh=await api(`/api/lists/${currentList}/items`);if(JSON.stringify(fresh)!==JSON.stringify(items)){items=fresh;render()}}catch{}}},5000);
