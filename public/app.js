const API_URL='https://COLOCA_AQUI_O_WORKER_URL';
const TOKEN_KEY='shoopar-token-v1', PIN_KEY='shoopar-pin-v1', THEME_KEY='shoopar-theme';
let token=localStorage.getItem(TOKEN_KEY), pin=localStorage.getItem(PIN_KEY), entered='', filter='all', lists=[], currentList=null, items=[];

const $=s=>document.querySelector(s);
const api=async(path,opts={})=>{
  if(API_URL.includes('COLOCA_AQUI')) throw new Error('Falta configurar o URL do Worker em public/app.js.');
  const headers={'content-type':'application/json',...(opts.headers||{})};
  if(token)headers['x-household-token']=token;
  const r=await fetch(API_URL+path,{...opts,headers});
  const d=await r.json(); if(!r.ok)throw new Error(d.error||'Erro'); return d;
};
function dots(){document.querySelectorAll('.dots i').forEach((x,i)=>x.classList.toggle('on',i<entered.length))}
function pinUI(){ $('#pinText').textContent=pin?'Introduz o PIN de 4 dígitos':'Cria um PIN de 4 dígitos'; $('#pinError').textContent=''; entered=''; dots(); }
async function submitPin(){
  if(entered.length!==4)return;
  try{
    const d=await api(pin?'/api/login':'/api/setup',{method:'POST',body:JSON.stringify({pin:entered})});
    token=d.token; pin=entered;
    localStorage.setItem(TOKEN_KEY,token); localStorage.setItem(PIN_KEY,pin);
    $('#pin').hidden=true; $('#app').hidden=false;
    await load();
  }catch(e){$('#pinError').textContent=e.message; entered=''; dots();}
}
document.querySelectorAll('.keys button').forEach(b=>b.onclick=()=>{if(b.id==='back')entered=entered.slice(0,-1);else if(entered.length<4)entered+=b.textContent.trim();dots();if(entered.length===4)setTimeout(submitPin,100)});
async function load(){lists=await api('/api/lists');if(!currentList)currentList=lists[0]?.id;renderLists();if(currentList)await loadItems()}
async function loadItems(){items=await api(`/api/lists/${currentList}/items`);render()}
function renderLists(){ $('#lists').innerHTML=lists.map(x=>`<button data-id="${x.id}" class="${x.id===currentList?'active':''}">${x.name}</button>`).join('');document.querySelectorAll('#lists button').forEach(b=>b.onclick=async()=>{currentList=b.dataset.id;renderLists();await loadItems()})}
function money(n){return n==null?'':Number(n).toLocaleString('pt-PT',{style:'currency',currency:'EUR'})}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function render(){
  const visible=items.filter(x=>filter==='all'||(filter==='pending'&&!x.done)||(filter==='done'&&x.done));
  $('#items').innerHTML=visible.map(x=>`<li class="${x.done?'done':''}"><button class="check" data-done="${x.id}"></button><div class="body"><span class="name">${escapeHtml(x.name)}</span><span class="meta">${escapeHtml(x.category)} · ${x.quantity} ${escapeHtml(x.unit)}${x.price!=null?' · '+money(x.price):''}</span></div><button class="del" data-del="${x.id}">×</button></li>`).join('');
  $('#remaining').textContent=items.filter(x=>!x.done).length;
  const total=items.filter(x=>!x.done&&x.price!=null).reduce((s,x)=>s+x.price*x.quantity,0);
  $('#cost').textContent=money(total)||'0,00 €';
  document.querySelectorAll('[data-done]').forEach(b=>b.onclick=async()=>{const x=items.find(i=>i.id===b.dataset.done);await api('/api/items/'+x.id,{method:'PUT',body:JSON.stringify({...x,done:!x.done})});await loadItems()});
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await api('/api/items/'+b.dataset.del,{method:'DELETE'});await loadItems()});
}
$('#add').onclick=async()=>{const name=$('#name').value.trim();if(!name)return;await api(`/api/lists/${currentList}/items`,{method:'POST',body:JSON.stringify({name,category:$('#category').value,price:$('#price').value,quantity:$('#qty').value,unit:'un.'})});$('#name').value='';$('#price').value='';$('#qty').value='1';await loadItems();$('#name').focus()};
$('#name').onkeydown=e=>{if(e.key==='Enter')$('#add').click()};
document.querySelectorAll('.filters button').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render()});
$('#clear').onclick=async()=>{for(const x of items.filter(i=>i.done))await api('/api/items/'+x.id,{method:'DELETE'});await loadItems()};
$('#history').onclick=async()=>{const h=await api(`/api/lists/${currentList}/history`);$('#historyList').innerHTML=h.length?h.map(x=>`<div class="hist"><b>${escapeHtml(x.item_name)}</b><br><small>${new Date(x.completed_at).toLocaleString('pt-PT')} · ${escapeHtml(x.category)}</small></div>`).join(''):'<p>Sem histórico.</p>';$('#modal').hidden=false};
$('#closeModal').onclick=()=>$('#modal').hidden=true;
$('#theme').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem(THEME_KEY,document.body.classList.contains('dark')?'dark':'light')};
$('#lock').onclick=()=>{if(pin){$('#app').hidden=true;$('#pin').hidden=false;pinUI()}};
if(localStorage.getItem(THEME_KEY)==='dark')document.body.classList.add('dark');
pinUI();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
setInterval(async()=>{if(!$('#app').hidden&&currentList){try{const fresh=await api(`/api/lists/${currentList}/items`);if(JSON.stringify(fresh)!==JSON.stringify(items)){items=fresh;render()}}catch{}}},5000);
