import {STORAGE,restoreSession,saveSession,validKey,listHomes,rememberHome,forgetHome,openHome,homeEntryId} from './session.js?v=30';
import {MAX_EXPENSES,postDueBills,splitAmount,expenseBalances,settlements,pairwiseDebts,addExpense,editExpense,addComment,paidShares,expenseCurrency,currenciesInUse,removeExpense,clearSettledExpenses,removePerson,uid,iso,date,addDays,away,assignee,advance,emptyHome,validateHome,record,complete,rollOver,skip,schedule,calendar} from './core.js?v=30';
import {createSync} from './sync.js?v=30';
import {readSplitwise,splitwiseExpenses,importSplitwise} from './splitwise.js?v=30';
import {BACKEND_URL,SIGN_IN_METHODS} from './config.js?v=30';
import {writeXlsx,readXlsx,rowsToCsv} from './xlsx.js?v=30';
import {makeCode,normalizeCode,inviteId,sealKey,openKey} from './invite.js?v=30';

// ---------- Small helpers ----------
const icons={
  home:'<path d="m3 10.5 9-7 9 7V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
  wallet:'<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5V18a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 7.5Z"/><path d="M16 14h.01"/>',
  broom:'<path d="m14 3-5.5 5.5"/><path d="M8.5 8.5 4 13c-1 1-1 2.5 0 3.5L7.5 20c1 1 2.5 1 3.5 0l4.5-4.5Z"/><path d="m11 11 2 2"/><path d="M19 5l1-1M20 9h1M15 4V3"/>',
  activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check:'<path d="m5 12 4.5 4.5L19 7"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  back:'<path d="m15 6-6 6 6 6"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  people:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 21h4"/>',
  share:'<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  upload:'<path d="M12 15V3m-5 5 5-5 5 5"/><path d="M4 17v3h16v-3"/>',
  repeat:'<path d="M4 8h13l-3-3M20 16H7l3 3M20 8v3M4 16v-3"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cart:'<path d="M3 4h2l2.5 11h11L21 7H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  edit:'<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m13.5 7.5 3 3"/>',
  trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  pause:'<path d="M8 5v14M16 5v14"/>',
  play:'<path d="M7 4.5v15l12-7.5Z"/>',
  swap:'<path d="M7 7h12m-4-4 4 4-4 4M17 17H5m4 4-4-4 4-4"/>',
  hand:'<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-7.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v6m0-4a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L4.5 15a1.6 1.6 0 0 1 2.6-1.8L8 14"/>',
  dots:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  phone:'<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  key:'<circle cx="8" cy="14" r="4"/><path d="m11 11 9-9m-3 3 2.5 2.5M15 7l2.5 2.5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  logout:'<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M4 12h11m-4-4 4 4-4 4"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  spark:'<path d="m12 3 2.2 6.3L21 11l-6.8 1.7L12 21l-2.2-8.3L3 11l6.8-1.7Z"/>'
};
const I=n=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.spark}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>s.trim().split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
const avatar=(p,size='')=>`<span class="avatar c${p?.color||0}${size?' '+size:''}" title="${esc(p?.name||'No one')}">${esc(initials(p?.name||'?'))}</span>`;
const dateLabel=s=>date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const dayName=s=>s===iso()?'Today':s===addDays(iso(),1)?'Tomorrow':s===addDays(iso(),-1)?'Yesterday':date(s).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
const timeLabel=at=>{const d=new Date(at),day=iso(d);return day===iso()?d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});};
const money=(c,cur=home.currency||'EUR')=>new Intl.NumberFormat('en-GB',{style:'currency',currency:cur}).format(c/100);
const personName=id=>home.people.find(p=>p.id===id)?.name||'Former flatmate';
const firstName=id=>id===myId?'You':personName(id).split(' ')[0];
const cents=v=>Math.round(Number(String(v).replace(',','.'))*100);
const frequency=t=>t.every===1?({day:'Daily',week:'Weekly',month:'Monthly'})[t.unit]:`Every ${t.every} ${t.unit}s`;
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const $=s=>document.querySelector(s);

// ---------- State ----------
let home,mode='welcome',key='',revision=0,myId='',backend=BACKEND_URL,client=null,view='expenses',busy=false,syncState='Not connected',syncError='',deferredInstall=null,registration=null;
let account=null,authInfo=null,linked={},accountMeta=null;try{account=JSON.parse(localStorage.getItem('flatflow-account')||'null');}catch{}
let storageOK=true,refreshing=false;
let choreFilter='all',scheduleMode='week',schedulePerson='',weekOffset=0,monthOffset=0;
let expenseSearch='',expenseFilter='all',searchOpen=false,spendingMine=false;
let sheet=null; // the open sheet: {build, live}. Live sheets rebuild when the home changes.
try{({home,mode,key,revision,myId,backend,storageOK}=restoreSession(localStorage,BACKEND_URL));}catch{home=emptyHome('Your household');storageOK=false;}
try{const v=localStorage.getItem('flatflow-view');if(['expenses','chores','activity','account'].includes(v))view=v;}catch{}
function rememberCurrent(){try{rememberHome(localStorage,{home,mode,key,revision,myId,backend});}catch{}}
function persist(){try{storageOK=saveSession(localStorage,{home,mode,key,revision,myId,backend});}catch{storageOK=false;}rememberCurrent();linkCurrent();if(mode==='shared'&&validKey(key)){const current=new URLSearchParams(location.hash.slice(1)).get('home');if(!current||current===key)history.replaceState(history.state,'',storageOK?location.pathname:invitation());}if(!storageOK)toast('Keep your invitation link: this browser cannot save your home reliably.',true);}
// Turns browser and network jargon into something a flatmate can act on.
function friendly(text){const t=String(text||'');if(/failed to fetch|networkerror|load failed|network request failed/i.test(t))return 'Can’t reach Flatflow. Check your connection and try again.';if(/timed? ?out|timeout/i.test(t))return 'Flatflow is taking too long to answer. Try again in a moment.';if(/quota|storage/i.test(t)&&/exceed|full/i.test(t))return 'This browser is out of space for Flatflow. Clear older activity in Account.';if(/unexpected token|is not valid json|is not a function|cannot read propert|is not defined|is (null|undefined)/i.test(t))return 'Something went wrong. Refresh the page and try again.';return t;}
function toast(text,error=false){const el=$('#toast');el.textContent=error?friendly(text):text;el.className='toast show'+(error?' error':'');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),error?7000:4000);}
function setBusy(b){busy=b;document.querySelectorAll('[data-mutate],dialog button[type="submit"]').forEach(el=>{if(b){if(el.dataset.wasDisabled===undefined)el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}});}

// ---------- Appearance ----------
const THEMES=[['system','System'],['light','Light'],['dark','Dark']];
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
const themeChoice=()=>{try{const t=localStorage.getItem('flatflow-theme');return t==='light'||t==='dark'?t:'system';}catch{return 'system';}};
const isDark=()=>themeChoice()==='dark'||(themeChoice()==='system'&&darkQuery.matches);
function applyTheme(){const t=themeChoice();if(t==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',isDark()?'#0f1218':'#ffffff');}
function setTheme(t){try{if(t==='system')localStorage.removeItem('flatflow-theme');else localStorage.setItem('flatflow-theme',t);}catch{}applyTheme();render();}
applyTheme();darkQuery.addEventListener?.('change',()=>{applyTheme();if(home)render();});

// ---------- Navigation: four tabs, a few deeper screens, sheets for everything else ----------
const TABS=[['expenses','wallet','Expenses'],['chores','broom','Chores'],['activity','activity','Activity'],['account','user','Account']];
const PARENT={schedule:'chores',flatmates:'account',shopping:'expenses',bills:'expenses',spending:'expenses'};
const SCREEN_TITLES={schedule:'Schedule',flatmates:'Flatmates',shopping:'Shopping list',bills:'Recurring bills',spending:'Spending',activity:'Activity',account:'Account'};
const visibleTabs=()=>home?.expensesOnly?TABS.filter(([v])=>v!=='chores'):TABS;
const tabOf=v=>PARENT[v]||v;
function go(v){
  if(PARENT[v]&&!PARENT[view])history.pushState({view:v},'',location.href);
  view=v;if(!PARENT[v]){try{localStorage.setItem('flatflow-view',v);}catch{}}
  if($('#modal').open)$('#modal').close();render();window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('popstate',e=>{if(gated()||mode==='welcome')return;if(e.state?.view)view=e.state.view;else if(PARENT[view])view=PARENT[view];else return;render();});
const activeTasks=()=>home.tasks.filter(t=>!t.paused);
const dueTasks=()=>activeTasks().filter(t=>t.due<=iso());
const openPayments=()=>currenciesInUse(home).reduce((n,c)=>n+settlements(home,c).length,0);

// ---------- Banners (connection, identity, storage) ----------
function banners(){
  let out='';
  if(mode==='shared'&&!['Synced','Connecting…','Saving…'].includes(syncState)){
    if(syncState==='Home not found')out+=`<div class="banner"><span><b>This home isn’t on Flatflow’s server any more.</b> It may have been deleted. Remove it from this device, or ask a flatmate for a fresh invite.</span><button class="link" data-action="dropMissing">Remove from this device</button><button class="link" data-action="newHome">Create a new home</button></div>`;
    else out+=`<div class="banner"><span>${syncState==='Offline'?'You’re offline.':'Flatflow couldn’t sync this home.'} You’re seeing the last saved version.${syncError&&syncState!=='Offline'?` ${esc(friendly(syncError))}`:''}</span><button class="link" data-action="reconnect">Try again</button></div>`;
  }
  if(!account&&!myId&&home.people.length&&view!=='account')out+=`<div class="banner soft"><span>Which one is you? Pick your name to see your chores and what you owe.</span><div class="chips">${home.people.slice(0,8).map(p=>`<button class="chip plain" data-action="setMe" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></div>`;
  if(!storageOK)out+='<div class="banner">Keep your invitation link. This browser cannot reliably remember your home.</div>';
  return out;
}
const needPeople=()=>home.people.length<2;
function setupHead(what){return `<section class="head"><p class="headline">Getting started<b>Who ${home.expensesOnly?'shares costs here':'lives here'}?</b></p><p class="note" style="margin-top:8px">Add your ${home.expensesOnly?'group':'flatmates'} first, then ${what}.</p><div class="pills"><button class="pill primary" data-action="addPerson">${I('plus')}Add ${home.expensesOnly?'someone':'a flatmate'}</button>${mode==='shared'?`<button class="pill" data-action="share">${I('share')}Invite with a link or code</button>`:''}</div></section>`;}

// ---------- Expenses ----------
const CURRENCIES=['EUR','GBP','USD','INR','CHF','PLN','SEK','DKK','NOK','CZK','CAD','AUD','JPY','SGD','AED','NZD','HUF','RON','TRY','ZAR','BRL','MXN'];
const EXPENSE_CATEGORIES=['Groceries','Rent','Utilities','Internet','Household supplies','Eating out','Transport','Entertainment','Travel','Gifts','Other'];
const CATEGORY_ICONS={Groceries:'🛒',Rent:'🏠',Utilities:'💡',Internet:'📶','Household supplies':'🧽','Eating out':'🍽️',Transport:'🚆',Entertainment:'🎬',Travel:'✈️',Gifts:'🎁','Carried over':'📦',Other:'🧾'};
const SPLIT_MODES=[['equal','equally'],['exact','by exact amounts'],['percent','by percentages'],['shares','by shares'],['adjust','equally, with adjustments'],['itemized','by items on a receipt']];
const expenseIcon=e=>e.kind==='settle'?'🤝':CATEGORY_ICONS[e.category]||'🧾';
const names=ids=>ids.map(personName);
const myNet=e=>(paidShares(e)[myId]||0)-(e.shares[myId]||0);
const paidByText=e=>{const p=Object.keys(paidShares(e));return p.length>1?`${esc(firstName(e.paidBy))} and ${p.length-1} other${p.length>2?'s':''} paid`:`${esc(firstName(e.paidBy))} paid`;};
// The headline answers "what do I owe?" in one line, then names who owes whom.
function moneyHead(){
  const cur=home.currency||'EUR',expenses=home.expenses||[];
  let head,lines=[];
  if(myId&&home.people.some(p=>p.id===myId)){
    const v=expenseBalances(home,cur)[myId]||0;
    head=v>0?`You are owed<b class="pos">${money(v,cur)}</b>`:v<0?`You owe<b class="neg">${money(-v,cur)}</b>`:`Your balance<b>All settled up</b>`;
    for(const c of currenciesInUse(home)){for(const s of settlements(home,c)){if(s.to===myId)lines.push(`<li><b>${esc(personName(s.from))}</b> owes you <b class="pos">${money(s.amount,c)}</b></li>`);else if(s.from===myId)lines.push(`<li>You owe <b>${esc(personName(s.to))}</b> <b class="neg">${money(s.amount,c)}</b></li>`);}}
  }else{const open=openPayments();head=`Balances<b>${open?plural(open,'payment')+' to settle':'All settled up'}</b>`;
    for(const c of currenciesInUse(home))for(const s of settlements(home,c))lines.push(`<li><b>${esc(personName(s.from))}</b> owes <b>${esc(personName(s.to))}</b> ${money(s.amount,c)}</li>`);}
  const shown=lines.slice(0,3),more=lines.length-shown.length;
  const open=openPayments();
  return `<section class="head"><p class="headline">${head}</p>${shown.length||more?`<ul class="sublines">${shown.join('')}${more>0?`<li><button data-action="balances">and ${plural(more,'more')}</button></li>`:''}</ul>`:''}<div class="pills"><button class="pill ${open?'primary':''}" data-action="settleUp">${I('hand')}Settle up</button><button class="pill" data-action="balances">${I('people')}Balances</button>${home.expensesOnly?'':`<button class="pill" data-action="go" data-id="shopping">${I('cart')}Shopping${(home.shopping||[]).filter(i=>!i.done).length?` <span class="badge">${(home.shopping||[]).filter(i=>!i.done).length}</span>`:''}</button>`}<button class="pill" data-action="expenseMenu">${I('dots')}More</button></div></section>`;
}
function expenseMatches(e){
  if(expenseFilter==='mine'&&!(e.shares[myId]||paidShares(e)[myId]))return false;
  if(expenseFilter==='payments'&&e.kind!=='settle')return false;
  if(expenseFilter.startsWith('cat:')&&(e.kind!=='expense'||e.category!==expenseFilter.slice(4)))return false;
  const q=expenseSearch.trim().toLowerCase();if(!q)return true;
  return [e.title,e.category,e.notes||'',...names(Object.keys(e.shares)),...names(Object.keys(paidShares(e))),...(e.comments||[]).map(c=>c.text)].join(' ').toLowerCase().includes(q);
}
function expenseRow(e){
  const cur=expenseCurrency(home,e),mine=myNet(e),settleTo=Object.keys(e.shares)[0],involved=myId&&(e.shares[myId]||paidShares(e)[myId]);
  const d=date(e.spentOn);
  let end;
  if(e.kind==='settle')end=e.paidBy===myId?`<span class="row-end neg"><small>you paid</small><b>${money(e.amount,cur)}</b></span>`:settleTo===myId?`<span class="row-end pos"><small>you received</small><b>${money(e.amount,cur)}</b></span>`:`<span class="row-end muted"><b>${money(e.amount,cur)}</b></span>`;
  else end=involved?(mine>0?`<span class="row-end pos"><small>you lent</small><b>${money(mine,cur)}</b></span>`:mine<0?`<span class="row-end neg"><small>you borrowed</small><b>${money(-mine,cur)}</b></span>`:`<span class="row-end muted"><small>your share</small><b>${money(e.shares[myId]||0,cur)}</b></span>`):`<span class="row-end muted"><small>not involved</small><b>${money(e.amount,cur)}</b></span>`;
  const sub=e.kind==='settle'?'Payment':`${paidByText(e)} ${money(e.amount,cur)}`;
  return `<button type="button" class="row" data-action="expenseDetail" data-id="${esc(e.id)}"><span class="row-date"><small>${d.toLocaleDateString('en-GB',{month:'short'})}</small><b>${d.getDate()}</b></span><span class="row-icon">${expenseIcon(e)}</span><span class="row-main"><b>${esc(e.kind==='settle'?`${personName(e.paidBy)} paid ${personName(settleTo)}`:e.title)}</b><small>${sub}${e.notes?' · 📝':''}${e.comments?.length?` · 💬 ${e.comments.length}`:''}</small></span>${end}</button>`;
}
function expensesPage(){
  if(needPeople())return setupHead('log what you paid for')+`<div class="empty"><p>Everyone you add can be included in a split.</p></div>`;
  const expenses=home.expenses||[];
  if(!expenses.length)return moneyHead()+`<div class="empty"><h3>No expenses yet</h3><p>Add groceries, rent or anything you share. Flatflow works out who owes whom.</p><button class="btn" data-action="addExpense">${I('plus')}Add an expense</button>${account||mode!=='shared'?'':''}<button class="link" data-action="splitwise">Moving from Splitwise? Import your history</button></div>`;
  const shown=expenses.filter(expenseMatches).sort((a,b)=>b.spentOn.localeCompare(a.spentOn));
  const cats=[...new Set(expenses.filter(e=>e.kind==='expense').map(e=>e.category).filter(Boolean))].sort();
  const chip=(id,label)=>`<button class="chip plain ${expenseFilter===id?'on':''}" data-action="expenseFilter" data-id="${esc(id)}">${esc(label)}</button>`;
  let list='',month='';
  for(const e of shown){const m=date(e.spentOn).toLocaleDateString('en-GB',{month:'long',year:'numeric'});if(m!==month){month=m;list+=`<h3 class="group-title">${m}</h3>`;}list+=expenseRow(e);}
  return moneyHead()+`<section class="list"><div class="list-head"><h2>${plural(expenses.length,'expense')}</h2><button class="pill ${searchOpen?'on':''}" data-action="toggleSearch" aria-label="Search expenses" aria-expanded="${searchOpen}">${I('search')}</button></div>${searchOpen||expenseFilter!=='all'?`<div style="padding:0 16px"><input class="input" id="expense-search" type="search" placeholder="Search expenses, people, notes" aria-label="Search expenses" value="${esc(expenseSearch)}" autocomplete="off"></div><div class="filters">${chip('all','All')}${myId?chip('mine','Involving me'):''}${chip('payments','Payments')}${cats.map(c=>chip('cat:'+c,(CATEGORY_ICONS[c]||'')+' '+c)).join('')}</div>`:''}${list||'<p class="empty">No expenses match. Try another search or filter.</p>'}</section>`;
}
function settleSheet(){
  openSheet(()=>{
    const lines=currenciesInUse(home).map(cur=>{const plan=settlements(home,cur);if(!plan.length)return '';
      return `${currenciesInUse(home).length>1?`<h3 class="group-title">${esc(cur)}</h3>`:''}${plan.map(s=>`<div class="row tap" style="padding-right:12px">${avatar(home.people.find(p=>p.id===s.from)||{name:personName(s.from)})}<button type="button" class="row-main" data-action="settle" data-id="${esc([s.from,s.to,s.amount,cur].join('|'))}" data-mutate><b>${esc(firstName(s.from))} ${s.from===myId?'pay':'pays'} ${esc(s.to===myId?'you':personName(s.to))}</b><small>Tap to record this payment</small></button><span class="row-end ${s.to===myId?'pos':s.from===myId?'neg':''}"><b>${money(s.amount,cur)}</b></span><button type="button" class="small-btn ghost" data-action="remind" data-id="${esc([s.from,s.to,s.amount,cur].join('|'))}" aria-label="Send a reminder">${I('bell')}</button></div>`).join('')}`;}).join('');
    dialog('Settle up',lines?'Payments happen outside Flatflow. Record one here once the money has changed hands.':'',`${lines?`<div class="detail-rows">${lines}</div>`:'<p class="empty"><b>Everyone is settled up.</b></p>'}<button type="button" class="link" data-action="recordPayment" data-mutate>${I('plus')}Record a different payment</button><label class="switch-row"><span><b>Simplify debts</b><small>${simplifyHint()}</small></span><input type="checkbox" id="simplify" ${home.simplify===false?'':'checked'} data-mutate></label>`);
  });
}
function balancesSheet(){
  openSheet(()=>{
    const parts=currenciesInUse(home).map(cur=>{const net=expenseBalances(home,cur);if(cur!==(home.currency||'EUR')&&!Object.keys(net).length)return '';
      const ids=[...new Set([...home.people.map(p=>p.id),...Object.keys(net)])].sort((a,b)=>(net[b]||0)-(net[a]||0));
      return `${currenciesInUse(home).length>1?`<h3 class="group-title">${esc(cur)}</h3>`:''}${ids.map(id=>{const p=home.people.find(p=>p.id===id),v=net[id]||0;return `<div class="row">${avatar(p||{name:personName(id)})}<span class="row-main"><b>${esc(personName(id))}${id===myId?' <span class="badge you">You</span>':''}</b><small>${v>0?'gets back':v<0?'owes':'settled up'}</small></span><span class="row-end ${v>0?'pos':v<0?'neg':'muted'}"><b>${v?money(Math.abs(v),cur):'—'}</b></span></div>`;}).join('')}`;}).join('');
    dialog('Balances','',`<div class="detail-rows">${parts||'<p class="empty">Add flatmates to start sharing costs.</p>'}</div>`);
  });
}
// Compares both settle-up styles so the switch says what it changes for this home.
function simplifyHint(){
  const cur=currenciesInUse(home),count=f=>cur.reduce((n,c)=>n+f(c).length,0),pair=count(c=>pairwiseDebts(home,c)),simple=count(c=>settlements({...home,simplify:undefined},c));
  if(!pair&&!simple)return 'Fewest payments, even between people who didn’t share an expense.';
  if(home.simplify===false)return `Everyone pays back the person who paid for them: ${plural(pair,'payment')}. Simplified would be ${simple}.`;
  return pair===simple?`Same number of payments either way right now (${simple}); only who pays whom changes.`:`${plural(simple,'payment')} instead of ${pair}. Money may pass between people who didn’t share an expense.`;
}
function expenseMenu(){
  const expenses=home.expenses||[];
  openSheet(()=>dialog('More','',`<div class="menu"><button type="button" data-action="go" data-id="bills">${I('repeat')}Recurring bills<small>${(home.bills||[]).length||''}</small></button><button type="button" data-action="go" data-id="spending" ${expenses.length?'':'disabled'}>${I('chart')}Spending</button><button type="button" data-action="exportExpenses" ${expenses.length?'':'disabled'}>${I('download')}Export to Excel or CSV</button><button type="button" data-action="splitwise" data-mutate>${I('upload')}Import from Splitwise</button>${expenses.length&&!openPayments()?`<button type="button" class="danger" data-action="clearExpenses" data-mutate>${I('trash')}Clear settled expenses</button>`:''}</div>`));
}
function shoppingPage(){
  const list=home.shopping||[],bought=list.filter(i=>i.done);
  return `<section class="head" style="padding-top:12px"><form id="shopping-form" class="comment-add" style="margin:0"><input name="item" maxlength="80" placeholder="Add milk, bin bags, coffee…" aria-label="Item to buy" required autocomplete="off"><button class="btn" type="submit" data-mutate>${I('plus')}Add</button></form></section><section class="list">${list.map(i=>`<label class="row ${i.done?'done':''}"><input type="checkbox" class="check-box" data-shopping="${esc(i.id)}" ${i.done?'checked':''} data-mutate style="width:22px;height:22px;accent-color:var(--accent);margin:0"><span class="row-main"><b>${esc(i.item)}</b>${i.addedBy?`<small>${esc(firstName(i.addedBy))}</small>`:''}</span><button type="button" class="small-btn ghost" data-action="removeItem" data-id="${esc(i.id)}" aria-label="Remove ${esc(i.item)}" data-mutate>${I('close')}</button></label>`).join('')||'<div class="empty"><h3>Nothing on the list</h3><p>Everyone in the home sees this list. Tick items as you buy them, then log them as one expense.</p></div>'}</section>${bought.length?`<div class="buttons stack" style="padding:16px"><button class="btn" data-action="logShopping" data-mutate>${I('wallet')}Log ${plural(bought.length,'bought item')} as an expense</button><button class="link" data-action="clearBought" data-mutate>Clear bought items</button></div>`:''}`;
}
function billsPage(){
  const bills=home.bills||[];
  return `<p class="note pad" style="padding-top:14px">Rent, internet or subscriptions are logged as an expense automatically each time they fall due.</p><section class="list">${bills.map(b=>`<button type="button" class="row" data-action="billMenu" data-id="${esc(b.id)}"><span class="row-icon">${CATEGORY_ICONS[b.category]||'🧾'}</span><span class="row-main"><b>${esc(b.title)}</b><small>${b.paused?'Paused':`Next ${dateLabel(b.due)}`} · ${b.every===1?({day:'daily',week:'weekly',month:'monthly'})[b.unit]:`every ${b.every} ${b.unit}s`} · ${esc(firstName(b.paidBy))} ${b.paidBy===myId?'pay':'pays'}</small></span><span class="row-end"><b>${money(b.amount)}</b></span></button>`).join('')||`<div class="empty"><h3>No recurring bills</h3><p>Add rent or internet once and Flatflow logs it every month.</p><button class="btn" data-action="addBill">${I('plus')}Add a bill</button></div>`}</section>`;
}
function spendingPage(){
  const cur=home.currency||'EUR',list=(home.expenses||[]).filter(e=>e.kind==='expense'&&e.title!=='Earlier balances'&&expenseCurrency(home,e)===cur),value=e=>spendingMine?(e.shares[myId]||0):e.amount;
  if(!list.length)return '<div class="empty"><h3>Nothing to show yet</h3><p>Spending appears here once expenses are logged.</p></div>';
  const byCat={};for(const e of list)byCat[e.category||'Other']=(byCat[e.category||'Other']||0)+value(e);
  const cats=Object.entries(byCat).filter(([,v])=>v).sort((a,b)=>b[1]-a[1]).slice(0,8),top=Math.max(1,...cats.map(c=>c[1]));
  const months=Array.from({length:6},(_,i)=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-5+i);return iso(d).slice(0,7);});
  const byMonth=months.map(m=>list.filter(e=>e.spentOn.startsWith(m)).reduce((n,e)=>n+value(e),0)),peak=Math.max(1,...byMonth),total=byMonth[5];
  return `<section class="head"><p class="headline">${spendingMine?'Your share this month':'Spent this month'}<b>${money(total,cur)}</b></p>${myId?`<div class="seg" style="margin-top:12px"><button class="${spendingMine?'':'active'}" data-action="spending" data-id="home">Whole home</button><button class="${spendingMine?'active':''}" data-action="spending" data-id="mine">My share</button></div>`:''}</section><div style="padding:0 16px"><div class="month-bars" role="img" aria-label="${esc(months.map((m,i)=>m+': '+money(byMonth[i],cur)).join(', '))}">${months.map((m,i)=>`<div class="month-bar ${i===5?'current':''}"><span class="v">${byMonth[i]?money(byMonth[i],cur).replace(/[.,]\d\d(?=\D*$)/,''):''}</span><i style="height:${Math.max(3,Math.round(byMonth[i]/peak*100))}%"></i><small>${date(m+'-01').toLocaleDateString('en-GB',{month:'short'})}</small></div>`).join('')}</div><h3 class="group-title" style="padding-left:0">By category</h3><div class="bars">${cats.map(([c,v])=>`<div class="bar-line noavatar"><div><b>${CATEGORY_ICONS[c]||'🧾'} ${esc(c)}</b><div class="bar-track"><i style="width:${Math.round(v/top*100)}%"></i></div></div><span class="bar-end">${money(v,cur)}</span></div>`).join('')}</div><p class="note" style="margin-top:16px">${spendingMine?'Your share of':'All'} ${esc(cur)} expenses${currenciesInUse(home).length>1?'; other currencies are not included':''}.</p></div>`;
}
// Opens an expense with who paid, who owes, notes and comments.
function expenseDetail(id){
  openSheet(()=>{
    const e=(home.expenses||[]).find(e=>e.id===id);if(!e){$('#modal').close();return;}
    const cur=expenseCurrency(home,e),payers=paidShares(e),person=id=>home.people.find(p=>p.id===id)||{name:personName(id)};
    const settleTo=Object.keys(e.shares)[0];
    const who=e.kind==='settle'?`<div class="detail-rows"><div class="row">${avatar(person(e.paidBy))}<span class="row-main"><b>${esc(personName(e.paidBy))} paid ${esc(personName(settleTo))}</b>${e.notes?`<small>${esc(e.notes)}</small>`:''}</span><span class="row-end"><b>${money(e.amount,cur)}</b></span></div></div>`:
      `<h3 class="sheet-section">Paid by</h3><div class="detail-rows">${Object.entries(payers).map(([id,v])=>`<div class="row">${avatar(person(id))}<span class="row-main"><b>${esc(personName(id))}</b></span><span class="row-end"><b>${money(v,cur)}</b></span></div>`).join('')}</div><h3 class="sheet-section">Split</h3><div class="detail-rows">${Object.entries(e.shares).filter(([,v])=>v).map(([id,v])=>{const owes=v-(payers[id]||0);return `<div class="row">${avatar(person(id))}<span class="row-main"><b>${esc(personName(id))}</b><small>${owes>0?`owes ${money(owes,cur)}`:owes<0?`gets back ${money(-owes,cur)}`:'paid their share'}</small></span><span class="row-end ${owes>0?'neg':owes<0?'pos':'muted'}"><b>${money(v,cur)}</b></span></div>`;}).join('')}</div>`;
    const comments=(e.comments||[]).map(c=>`<div class="comment">${avatar(person(c.by),'sm')}<div><b>${esc(c.by?personName(c.by):'Someone')}</b> <small>${new Date(c.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small><p>${esc(c.text)}</p></div></div>`).join('');
    dialog(esc(e.kind==='settle'?'Payment':e.title),'',
    `<div class="detail"><div class="big">${expenseIcon(e)} ${money(e.amount,cur)}</div><div class="meta">${dateLabel(e.spentOn)}${e.category&&e.kind==='expense'?' · '+esc(e.category):''}${e.currency?' · '+esc(cur):''}</div></div>${who}${e.notes&&e.kind!=='settle'?`<p class="summary">📝 ${esc(e.notes)}</p>`:''}<div><h3 class="sheet-section">Comments</h3>${comments||'<p class="note">No comments yet.</p>'}<div class="comment-add"><input name="comment" maxlength="300" placeholder="Add a comment" aria-label="Add a comment" autocomplete="off"><button class="btn small" type="submit" data-mutate>Post</button></div></div><div class="buttons">${e.kind==='expense'&&e.title!=='Earlier balances'?`<button type="button" class="btn secondary" data-action="editExpense" data-id="${esc(e.id)}" data-mutate>${I('edit')}Edit</button>`:''}<button type="button" class="btn danger" data-action="deleteExpense" data-id="${esc(e.id)}" data-mutate>${I('trash')}Delete</button></div>`,
    '',async f=>{const text=String(f.get('comment')||'').trim();if(!text)return;await mutate(h=>addComment(h,id,myId,text),'Comment added');});
  });
}
// Add, edit, or make a recurring bill. "Paid by you and split equally" is the whole form for most expenses.
function expenseForm(recurring=false,preset={},editing=null){
  if(home.people.length<2){toast('Add at least two people to share expenses.');personForm();return;}
  const e=editing&&(home.expenses||[]).find(x=>x.id===editing);if(editing&&!e){toast('This expense no longer exists.',true);return;}
  const cur=e?expenseCurrency(home,e):home.currency||'EUR',payers=e?paidShares(e):null,multi=payers&&Object.keys(payers).length>1;
  const paidBy=e?e.paidBy:home.people.some(p=>p.id===myId)?myId:home.people[0].id;
  const included=e?Object.keys(e.shares).filter(id=>e.shares[id]>0):home.people.map(p=>p.id);
  const evenly=e&&JSON.stringify(splitAmount(e.amount,Object.fromEntries(included.map(id=>[id,1]))))===JSON.stringify(Object.fromEntries(included.map(id=>[id,e.shares[id]])));
  const startMode=e&&!evenly?'exact':'equal',people=home.people;
  const personOption=(p,sel)=>`<option value="${esc(p.id)}" ${sel?'selected':''}>${p.id===myId?'you':esc(p.name)}</option>`;
  sheet=null;
  dialog(e?'Edit expense':recurring?'Add a recurring bill':'Add expense',recurring?'Flatflow adds this expense automatically every time it falls due.':'',
  `<label class="field big">Description<input name="title" maxlength="100" required placeholder="${recurring?'e.g. Rent':'e.g. Groceries'}" value="${esc(e?.title||preset.title||'')}" autocomplete="off"></label>
  <div class="field">Amount<div class="amount-field ${recurring?'single':''}">${recurring?'':`<select name="currency" id="expense-currency" aria-label="Currency">${[...new Set([home.currency||'EUR',cur,...CURRENCIES])].map(c=>`<option ${c===cur?'selected':''}>${c}</option>`).join('')}</select>`}<input name="amount" id="expense-amount" inputmode="decimal" type="number" min="0.01" step="0.01" required placeholder="0.00" value="${e?(e.amount/100).toFixed(2):''}"></div></div>
  ${recurring?`<div class="sentence">Paid by <select name="paidBy" id="paid-by">${home.people.map(p=>personOption(p,p.id===paidBy)).join('')}</select> and split <select name="mode" id="split-mode">${SPLIT_MODES.filter(([m])=>m!=='itemized').map(([m,n])=>`<option value="${m}">${n}</option>`).join('')}</select></div><div class="form-row three"><label class="field">Next due<input type="date" name="spentOn" value="${iso()}" min="${iso()}" required></label><label class="field">Every<input type="number" name="every" min="1" max="365" value="1" required></label><label class="field">Period<select name="unit"><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option></select></label></div>`:
  `<div class="sentence">Paid by <select name="paidBy" id="paid-by">${home.people.map(p=>personOption(p,!multi&&p.id===paidBy)).join('')}<option value="__multi" ${multi?'selected':''}>several people</option></select> and split <select name="mode" id="split-mode">${SPLIT_MODES.map(([m,n])=>`<option value="${m}" ${m===startMode?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="split-rows" id="payer-list" ${multi?'':'hidden'}>${home.people.map(p=>`<div class="split-row">${avatar(p,'sm')}<span>${esc(p.name)} paid</span><input class="split-value" data-payer="${esc(p.id)}" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0.00" aria-label="${esc(p.name)} paid" value="${multi&&payers[p.id]?(payers[p.id]/100).toFixed(2):''}"></div>`).join('')}</div>`}
  <div class="field"><span id="split-label">Split between</span><div class="split-rows" id="split-list">${people.map(p=>`<div class="split-row"><input type="checkbox" aria-label="Include ${esc(p.name)}" data-split="${esc(p.id)}" ${included.includes(p.id)?'checked':''}>${avatar(p,'sm')}<span>${p.id===myId?'You':esc(p.name)}</span><input class="split-value" data-split-value="${esc(p.id)}" inputmode="decimal" type="number" step="0.01" aria-label="${esc(p.name)} amount" value="${e&&startMode==='exact'&&e.shares[p.id]?(e.shares[p.id]/100).toFixed(2):''}" hidden><b class="preview" data-preview="${esc(p.id)}"></b></div>`).join('')}</div></div>
  <div id="items-box" class="items" hidden><div id="item-rows" class="items"></div><button type="button" class="link" data-item-add>${I('plus')}Add item</button><label class="field">Tax, tip or service<input name="extra" id="items-extra" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0.00"><small>Shared in proportion to what each person ordered.</small></label></div>
  <p class="summary" id="split-summary"></p>
  ${recurring?`<label class="field">Category<select name="category">${EXPENSE_CATEGORIES.map(c=>`<option ${c==='Rent'?'selected':''}>${c}</option>`).join('')}</select></label>`:`<div class="form-row"><label class="field">Date<input type="date" name="spentOn" value="${e?.spentOn||iso()}" max="${iso()}" required></label><label class="field">Category<select name="category">${[...new Set([...EXPENSE_CATEGORIES,...(e?.category?[e.category]:[])])].map(c=>`<option value="${esc(c)}" ${c===(e?.category||preset.category||'Groceries')?'selected':''}>${(CATEGORY_ICONS[c]||'')+' '+esc(c)}</option>`).join('')}</select></label></div><label class="field">Notes<textarea name="notes" maxlength="500" placeholder="Optional">${esc(e?.notes||'')}</textarea></label>`}`,
  e?'Save changes':recurring?'Add bill':'Save',async f=>{
    const itemized=$('#split-mode').value==='itemized',amount=itemized?itemsTotal():cents(f.get('amount')),shares=computeShares(amount);
    let payersNow=null,payer=f.get('paidBy');
    if(payer==='__multi'){payersNow=Object.fromEntries([...document.querySelectorAll('[data-payer]')].map(el=>[el.dataset.payer,cents(el.value||0)]).filter(([,v])=>v>0));const sum=Object.values(payersNow).reduce((n,v)=>n+v,0);if(sum!==amount)throw new Error(`What each person paid adds up to ${money(sum,cur)}, not ${money(amount,cur)}.`);payer=Object.keys(payersNow)[0];if(!payer)throw new Error('Enter what each person paid.');}
    const values={title:f.get('title').trim(),category:String(f.get('category')||''),paidBy:payer,amount,shares,...(payersNow?{payers:payersNow}:{}),currency:f.get('currency')||undefined,notes:f.get('notes')||''};
    if(recurring){if(await mutate(h=>{h.bills=h.bills||[];if(h.bills.length>=20)throw new Error('A home can have up to 20 recurring bills.');const due=f.get('spentOn');h.bills.push({id:uid(),title:values.title,category:values.category,paidBy:values.paidBy,amount,shares,every:Number(f.get('every')),unit:f.get('unit'),due,anchorDay:date(due).getDate(),paused:false});record(h,'expense',`${values.title} repeats from ${dateLabel(due)}`);postDueBills(h);},'Recurring bill saved'))$('#modal').close();return;}
    if(e){if(await mutate(h=>editExpense(h,e.id,{...values,spentOn:f.get('spentOn')}),'Expense updated'))expenseDetail(e.id);return;}
    if(await mutate(h=>{addExpense(h,{...values,spentOn:f.get('spentOn')});preset.apply?.(h);},preset.message||'Expense added'))$('#modal').close();});
  const form=$('#dialog-form');
  const addItem=()=>{$('#item-rows').insertAdjacentHTML('beforeend',`<div class="item-row"><input class="item-name" maxlength="60" placeholder="Item" aria-label="Item name"><input class="item-price" inputmode="decimal" type="number" min="0" step="0.01" placeholder="0.00" aria-label="Item price"><button type="button" class="small-btn ghost" data-item-remove aria-label="Remove item">${I('close')}</button><div class="people">${home.people.map(p=>`<label class="mini-chip" title="${esc(p.name)}"><input type="checkbox" data-item-person="${esc(p.id)}" checked><span>${esc(initials(p.name))}</span></label>`).join('')}</div></div>`);};
  form.addEventListener('click',ev=>{if(ev.target.closest('[data-item-add]')){addItem();update();}const r=ev.target.closest('[data-item-remove]');if(r){r.closest('.item-row').remove();update();}});
  const update=()=>{
    const mode=$('#split-mode').value,itemized=mode==='itemized',cur=$('#expense-currency')?.value||home.currency||'EUR';
    $('#items-box').hidden=!itemized;$('#split-list').hidden=itemized;$('#split-label').hidden=itemized;$('#expense-amount').readOnly=itemized;
    if(itemized&&!document.querySelector('.item-row'))addItem();
    if(itemized)$('#expense-amount').value=(itemsTotal()/100).toFixed(2);
    if($('#payer-list'))$('#payer-list').hidden=$('#paid-by').value!=='__multi';
    document.querySelectorAll('[data-split-value]').forEach(el=>{el.hidden=mode==='equal';el.placeholder={percent:'%',shares:'1',adjust:'+0.00'}[mode]||'0.00';el.step=mode==='shares'?'1':'0.01';el.min=mode==='adjust'?'':'0';});
    let shares={},msg='',bad=false;try{shares=computeShares(itemized?itemsTotal():cents($('#expense-amount').value||0));msg=$('#paid-by')?.value==='__multi'?payersMessage(cur):'';}catch(err){msg=err.message;bad=true;}
    if(!bad&&msg)bad=!/looks good/.test(msg);
    document.querySelectorAll('[data-preview]').forEach(el=>{el.textContent=shares[el.dataset.preview]?money(shares[el.dataset.preview],cur):'';});
    const s=$('#split-summary');s.textContent=msg;s.hidden=!msg;s.className='summary'+(bad?' bad':'');};
  const payersMessage=cur=>{const sum=[...document.querySelectorAll('[data-payer]')].reduce((n,el)=>n+cents(el.value||0),0),amount=$('#split-mode').value==='itemized'?itemsTotal():cents($('#expense-amount').value||0);return sum===amount?'Payers add up. Split looks good.':`Payers add up to ${money(sum,cur)}. ${sum<amount?money(amount-sum,cur)+' left to assign.':money(sum-amount,cur)+' too much.'}`;};
  let lastMode=$('#split-mode').value;
  form.addEventListener('input',ev=>{if(ev.target.id==='split-mode'&&ev.target.value!==lastMode){lastMode=ev.target.value;document.querySelectorAll('[data-split-value]').forEach(el=>el.value='');}update();});
  form.addEventListener('change',update);update();
  setTimeout(()=>$('#dialog-form [name=title]')?.focus(),50);
}
// Items in the open receipt: each split equally between the people ticked for it.
function readItems(){return [...document.querySelectorAll('.item-row')].map(r=>({price:Math.max(0,cents(r.querySelector('.item-price').value||0)),people:[...r.querySelectorAll('[data-item-person]')].filter(x=>x.checked).map(x=>x.dataset.itemPerson)}));}
function itemsTotal(){return readItems().reduce((n,i)=>n+i.price,0)+Math.max(0,cents($('#items-extra')?.value||0));}
// Reads the split controls in the open expense dialog and returns exact cents per person.
function computeShares(amount){
  const mode=$('#split-mode').value,cur=$('#expense-currency')?.value||home.currency||'EUR',included=[...document.querySelectorAll('[data-split]')].filter(el=>el.checked).map(el=>el.dataset.split);
  const add=(a,b)=>{for(const [id,v] of Object.entries(b))a[id]=(a[id]||0)+v;return a;};
  if(mode==='itemized'){
    const items=readItems().filter(i=>i.price>0);if(!items.length)throw new Error('Add the items on the receipt with their prices.');
    if(items.some(i=>!i.people.length))throw new Error('Tick who had each item.');
    const subtotal=items.reduce((a,i)=>add(a,splitAmount(i.price,Object.fromEntries(i.people.map(id=>[id,1])))),{}),extra=Math.max(0,cents($('#items-extra').value||0));
    return extra?add(subtotal,splitAmount(extra,subtotal)):subtotal;
  }
  if(!(amount>0))throw new Error('Enter an amount above zero.');
  if(!included.length)throw new Error('Choose at least one person to split with.');
  const value=id=>$(`[data-split-value="${id}"]`).value;
  if(mode==='equal')return splitAmount(amount,Object.fromEntries(included.map(id=>[id,1])));
  if(mode==='shares')return splitAmount(amount,Object.fromEntries(included.map(id=>[id,Math.max(0,Number(value(id))||0)])));
  if(mode==='percent'){const pct=Object.fromEntries(included.map(id=>[id,Math.max(0,Number(value(id))||0)])),sum=Object.values(pct).reduce((n,v)=>n+v,0);if(Math.abs(sum-100)>0.001)throw new Error(`Percentages add up to ${Math.round(sum*100)/100}%. ${sum<100?Math.round((100-sum)*100)/100+'% left to assign.':'That’s too much.'}`);return splitAmount(amount,pct);}
  if(mode==='adjust'){const adj=Object.fromEntries(included.map(id=>[id,cents(value(id)||0)])),rest=amount-Object.values(adj).reduce((n,v)=>n+v,0);if(rest<0)throw new Error(`Adjustments are ${money(-rest,cur)} more than the total.`);const shares=add(rest?splitAmount(rest,Object.fromEntries(included.map(id=>[id,1]))):{},adj);if(Object.values(shares).some(v=>v<0))throw new Error('An adjustment makes someone’s share negative.');return Object.fromEntries(Object.entries(shares).filter(([,v])=>v>0));}
  const shares=Object.fromEntries(included.map(id=>[id,Math.max(0,cents(value(id)||0))]).filter(([,v])=>v>0)),sum=Object.values(shares).reduce((n,v)=>n+v,0);
  if(sum!==amount)throw new Error(`Exact amounts add up to ${money(sum,cur)}. ${sum<amount?money(amount-sum,cur)+' left to assign.':money(sum-amount,cur)+' too much.'}`);
  return shares;
}
// Splitwise-style export: one column per person, positive when they paid more
// than their share. Excel adds a sheet with everyone's balance per currency.
function expenseRows(){
  const people=[...new Set([...home.people.map(p=>p.id),...(home.expenses||[]).flatMap(e=>[...Object.keys(e.shares),...Object.keys(paidShares(e))])])];
  return {people,rows:[['Date','Description','Category','Cost','Currency',...people.map(personName)],...(home.expenses||[]).slice().reverse().sort((a,b)=>a.spentOn.localeCompare(b.spentOn)).map(e=>[e.spentOn,e.kind==='settle'?'Payment':e.title,e.kind==='settle'?'Payment':e.category,e.amount/100,expenseCurrency(home,e),...people.map(id=>((paidShares(e)[id]||0)-(e.shares[id]||0))/100)])]};
}
const exportName=ext=>`${home.name.replace(/[^\w-]+/g,'-').toLowerCase()}-expenses-${iso()}.${ext}`;
function exportExpenses(format){
  if(!(home.expenses||[]).length){toast('There are no expenses to export yet.');return;}
  if(!format){sheet=null;dialog('Export expenses','Every expense and payment, in the same layout as a Splitwise export. Excel also gets a sheet with everyone’s balance.',`<div class="menu"><button type="button" data-action="exportExpenses" data-id="xlsx">${I('download')}Excel (.xlsx)</button><button type="button" data-action="exportExpenses" data-id="csv">${I('download')}CSV</button></div>`);return;}
  const {people,rows}=expenseRows();
  if(format==='csv'){const q=v=>{const s=typeof v==='number'?v.toFixed(2):/^[=+\-@\t\r]/.test(String(v))?"'"+v:String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};download(rows.map(r=>r.map(q).join(',')).join('\n')+'\n',exportName('csv'),'text/csv');}
  else{const balances=[['Person','Currency','Balance','Status'],...currenciesInUse(home).flatMap(cur=>{const net=expenseBalances(home,cur);return people.filter(id=>net[id]).map(id=>[personName(id),cur,net[id]/100,net[id]>0?'gets back':'owes']);})];
    download(writeXlsx([{name:'Expenses',rows},{name:'Balances',rows:balances}]),exportName('xlsx'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
  if($('#modal').open)$('#modal').close();toast('Expenses exported.');
}
function paymentDialog(from,to,amount,cur){
  const people=home.people;sheet=null;
  dialog('Record a payment','Record it once the money has changed hands. Paying part of what’s owed is fine.',`<div class="form-row"><label class="field">Who paid<select name="from">${people.map(p=>`<option value="${esc(p.id)}" ${p.id===from?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label class="field">Paid to<select name="to">${people.map(p=>`<option value="${esc(p.id)}" ${p.id===to?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></div><div class="field">Amount<div class="amount-field"><select name="currency" aria-label="Currency">${[...new Set([cur,...currenciesInUse(home),...CURRENCIES])].map(c=>`<option ${c===cur?'selected':''}>${c}</option>`).join('')}</select><input name="amount" type="number" inputmode="decimal" min="0.01" step="0.01" value="${amount?(amount/100).toFixed(2):''}" required placeholder="0.00"></div></div><div class="form-row"><label class="field">Date<input type="date" name="spentOn" value="${iso()}" max="${iso()}" required></label><label class="field">How<select name="how"><option value="">Not saying</option><option>Cash</option><option>Bank transfer</option><option>PayPal</option><option>Revolut</option><option>UPI</option><option>Other</option></select></label></div>`,'Record payment',async f=>{
    const value=cents(f.get('amount')),payer=f.get('from'),receiver=f.get('to');if(!(value>0))throw new Error('Enter an amount above zero.');if(payer===receiver)throw new Error('Choose two different people.');
    if(await mutate(h=>{addExpense(h,{kind:'settle',title:'Settle up',spentOn:f.get('spentOn'),paidBy:payer,amount:value,shares:{[receiver]:value},currency:f.get('currency'),notes:f.get('how')?'Paid by '+f.get('how').toLowerCase():''});},'Payment recorded'))$('#modal').close();});
}
// A friendly nudge, sent through whatever app the person uses to message their flatmate.
async function remind(arg){
  const [from,to,amount,cur]=String(arg).split('|'),text=`Hi ${personName(from)}! A friendly reminder from Flatflow: you owe ${personName(to)} ${money(Number(amount),cur)} for ${home.name}. Record it in Flatflow once you've paid. Thanks!`;
  if(navigator.share){try{await navigator.share({text});return;}catch(err){if(err.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(text);toast('Reminder copied. Paste it into a message.');}catch{sheet=null;dialog('Send a reminder','Copy this message and send it.',`<label class="field">Message<textarea readonly>${esc(text)}</textarea></label>`);}
}
function splitwiseImport(){
  const input=document.createElement('input');input.type='file';input.accept='.csv,.xlsx,.xls,.tsv,.txt,text/csv,text/plain,text/tab-separated-values,application/vnd.ms-excel,application/octet-stream,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';input.className='file-input';document.body.append(input);
  input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;if(file.size>5000000)throw new Error('That file is too large for a Splitwise group export.');
    splitwiseDialog(readSplitwise(await spreadsheetText(file)));}catch(err){toast(err.message,true);}finally{input.remove();}},{once:true});input.click();
}
// Phones often hand over files with a missing or wrong name and type, so the
// format is read from the file's first bytes, not from its name.
async function spreadsheetText(file){
  const buf=await file.arrayBuffer(),b=new Uint8Array(buf.slice(0,4));
  if(!buf.byteLength)throw new Error('The file arrived empty. If it’s in Google Drive or another cloud app, download it to your phone first, then import it again.');
  if(b[0]===0x50&&b[1]===0x4b)return rowsToCsv(await readXlsx(buf));
  if(b[0]===0xd0&&b[1]===0xcf&&b[2]===0x11&&b[3]===0xe0)throw new Error('This is an older Excel file (.xls). Open it in Excel or Google Sheets, save it as .xlsx or CSV, then import that file.');
  let text=(b[0]===0xff&&b[1]===0xfe)?new TextDecoder('utf-16le').decode(buf):(b[0]===0xfe&&b[1]===0xff)?new TextDecoder('utf-16be').decode(buf):new TextDecoder().decode(buf);
  text=text.replace(/^﻿/,'');
  if(/^\s*</.test(text)){const rows=[...new DOMParser().parseFromString(text,'text/html').querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('th,td')].map(c=>c.textContent.trim()));if(rows.length)return rowsToCsv(rows);throw new Error('This file isn’t a spreadsheet Flatflow can read. Export your Splitwise group as CSV or Excel and try again.');}
  const first=text.split(/\r?\n/,1)[0];
  if(first.includes('\t')&&!first.includes(','))text=rowsToCsv(text.split(/\r?\n/).map(l=>l.split('\t')));
  return text;
}
function splitwiseDialog(data){
  if(!data.entries.length)throw new Error('This Splitwise export has no expenses.');
  const currencies=[...new Set(data.entries.map(e=>e.currency))],locked=(home.expenses||[]).length>0,current=home.currency||'EUR';
  const choices=locked?currencies.filter(c=>c===current):currencies;
  if(!choices.length)throw new Error(`Your home uses ${current}, but this export has no ${current} expenses.`);
  // Match by full name, ignoring Splitwise's "(removed)" tag, then by a unique first name.
  const plainName=n=>n.replace(/\s*\(removed\)\s*$/i,'').trim().toLowerCase(),first=n=>plainName(n).split(/\s+/)[0];
  const match=name=>{const exact=home.people.find(p=>plainName(p.name)===plainName(name));if(exact)return exact.id;const f=home.people.filter(p=>first(p.name)===first(name));return f.length===1?f[0].id:'new';};
  sheet=null;
  dialog('Import from Splitwise',`Found ${data.entries.length} expenses and payments between ${data.members.map(esc).join(', ')}.${data.skipped.length?` ${data.skipped.length} unreadable row${data.skipped.length===1?' was':'s were'} skipped.`:''} Match each Splitwise member to a flatmate.`,
  `${data.members.map((m,i)=>`<label class="field">${esc(m)}<select name="member-${i}"><option value="new" ${match(m)==='new'?'selected':''}>Add as a new flatmate</option><option value="skip">Leave out (balances only, and only if they’re square)</option>${home.people.map(p=>`<option value="${esc(p.id)}" ${match(m)===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`).join('')}<div class="form-row"><label class="field">Currency<select name="currency">${choices.map(c=>`<option ${c===(currencies.includes(current)?current:choices[0])?'selected':''}>${esc(c)}</option>`).join('')}</select>${currencies.length>choices.length||choices.length>1?'<small>Only expenses in this currency are imported.</small>':''}</label><label class="field">What to import<select name="mode"><option value="history">Full history</option><option value="balances">Balances only</option></select></label></div><p class="note">Long histories keep the newest ${MAX_EXPENSES} expenses. Older ones are combined into earlier balances, so everyone’s balance stays exact.</p>`,
  'Import',async f=>{
    const newPeople=[],mapping={};
    data.members.forEach((m,i)=>{const v=f.get('member-'+i);if(v==='new'){const gone=/\s*\(removed\)\s*$/i.test(m),p={id:uid(),name:m.replace(/\s*\(removed\)\s*$/i,'').trim().slice(0,60)||m.trim().slice(0,60),color:(home.people.length+newPeople.length)%6,paused:gone,awayFrom:'',awayTo:''};newPeople.push(p);mapping[m]=p.id;}else if(v!=='skip')mapping[m]=v;});
    const chosen=f.get('currency');
    if(await mutate(h=>{const {expenses}=splitwiseExpenses(data,mapping,chosen,f.get('mode'));if(!expenses.length)throw new Error('Nothing left to import: everyone is square.');if(!(h.expenses||[]).length)h.currency=chosen;else if((h.currency||'EUR')!==chosen)throw new Error(`Your home uses ${h.currency||'EUR'}.`);importSplitwise(h,expenses,newPeople);},'Splitwise history imported'))$('#modal').close();
  });
}

// ---------- Chores ----------
function choreRow(t){
  const p=assignee(t,home.people),due=!t.paused&&t.due<=iso(),mine=p?.id===myId;
  return `<div class="row ${mine&&!t.paused?'you':''}"><span class="row-icon">${esc(t.icon)}</span><button type="button" class="row-main" data-action="chore" data-id="${esc(t.id)}"><b>${esc(t.title)}</b><small>${p?(mine?'You':esc(p.name.split(' ')[0])):'Everyone is away'} · ${frequency(t)} · ${t.minutes} min${t.paused?' · Paused':''}</small></button>${due&&p?`<button type="button" class="check" data-action="done" data-id="${esc(t.id)}" data-mutate aria-label="Mark ${esc(t.title)} as done">${I('check')}</button>`:`<span class="row-end muted"><b>${t.paused?'—':dayName(t.due).replace(/^(\w{3}) /,'$1 ')}</b></span>`}</div>`;
}
function choresPage(){
  if(!home.people.length)return setupHead('set up a chore rotation');
  const today=iso(),mineFilter=choreFilter==='mine'&&myId;
  const tasks=home.tasks.filter(t=>!mineFilter||assignee(t,home.people)?.id===myId);
  const due=dueTasks(),mineDue=due.filter(t=>assignee(t,home.people)?.id===myId),week=activeTasks().filter(t=>t.due<=addDays(today,6));
  let head;
  if(!home.tasks.length)head=`Chores<b>No chores yet</b>`;
  else if(myId)head=`Today<b>${mineDue.length?plural(mineDue.length,'chore')+' for you':'Nothing for you'}</b>`;
  else head=`Today<b>${due.length?plural(due.length,'chore')+' due':'Nothing due'}</b>`;
  const sub=home.tasks.length?`<ul class="sublines"><li>${plural(due.length,'chore')} due today in the ${home.expensesOnly?'group':'flat'} · ${week.length} this week</li></ul>`:'';
  const groups=[['Overdue',t=>t.due<today],['Today',t=>t.due===today],['Tomorrow',t=>t.due===addDays(today,1)],['This week',t=>t.due>addDays(today,1)&&t.due<=addDays(today,6)],['Later',t=>t.due>addDays(today,6)]];
  const active=tasks.filter(t=>!t.paused).sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title)),paused=tasks.filter(t=>t.paused);
  let list=groups.map(([name,fn])=>{const g=active.filter(fn);return g.length?`<h3 class="group-title">${name}</h3>${g.map(choreRow).join('')}`:'';}).join('');
  if(paused.length)list+=`<h3 class="group-title">Paused</h3>${paused.map(choreRow).join('')}`;
  return `<section class="head"><p class="headline">${head}</p>${sub}<div class="pills"><button class="pill" data-action="go" data-id="schedule">${I('calendar')}Schedule</button><button class="pill" data-action="fairShare">${I('chart')}Fair share</button><button class="pill" data-action="calendar">${I('download')}Calendar</button></div></section><section class="list">${home.tasks.length?`<div class="list-head"><h2>${plural(home.tasks.length,'chore')}</h2>${myId?`<div class="seg"><button class="${choreFilter==='mine'?'':'active'}" data-action="choreFilter" data-id="all">Everyone</button><button class="${choreFilter==='mine'?'active':''}" data-action="choreFilter" data-id="mine">Mine</button></div>`:''}</div>`:''}${list||(home.tasks.length?'<p class="empty">Nothing assigned to you right now.</p>':`<div class="empty"><h3>Share the housework</h3><p>Add a chore, choose who takes turns, and Flatflow keeps the rotation fair.</p><button class="btn" data-action="addTask">${I('plus')}Add a chore</button></div>`)}</section>`;
}
function choreSheet(id){
  openSheet(()=>{
    const t=home.tasks.find(t=>t.id===id);if(!t){$('#modal').close();return;}
    const p=assignee(t,home.people),turns=schedule(home,120).filter(e=>e.task===t.id).slice(0,5),due=t.due<=iso();
    const when=t.paused?'Paused':t.due<iso()?`Overdue since ${dateLabel(t.due)}`:t.due===iso()?'Due today':`Due ${dayName(t.due)}`;
    dialog(`${esc(t.icon)} ${esc(t.title)}`,`${p?`<b>${p.id===myId?'Your':esc(p.name)+'’s'} turn</b> · `:''}${when} · ${frequency(t)} · ${t.minutes} min${t.area?' · '+esc(t.area):''}`,
    `${t.notes?`<p class="summary">${esc(t.notes)}</p>`:''}${turns.length?`<div><h3 class="sheet-section">Who’s next</h3><div class="turns">${turns.map((e,i)=>`<span class="turn ${i===0?'first':''}">${avatar(e.person)}<small>${i===0&&e.due<=iso()?'Now':dateLabel(e.due)}</small></span>`).join('')}</div></div>`:''}<div class="menu">${!t.paused&&p?`<button type="button" class="primary" data-action="done" data-id="${esc(id)}" data-mutate>${I('check')}Mark as done${due?'':' early'}</button>`:''}${!t.paused?`<button type="button" data-action="skip" data-id="${esc(id)}">${I('swap')}Pass to the next person</button><button type="button" data-action="snooze" data-id="${esc(id)}">${I('clock')}Postpone</button><button type="button" data-action="reassign" data-id="${esc(id)}">${I('people')}Give this turn to someone else</button>`:''}<button type="button" data-action="editTask" data-id="${esc(id)}">${I('edit')}Edit chore</button><button type="button" data-action="pauseTask" data-id="${esc(id)}" data-mutate>${I(t.paused?'play':'pause')}${t.paused?'Resume':'Pause'} this chore</button><button type="button" class="danger" data-action="deleteTask" data-id="${esc(id)}">${I('trash')}Delete chore</button></div>`);
  });
}
function taskForm(id=''){
  if(!home.people.length){toast('Add your flatmates first, then start a chore rotation.');personForm();return;}
  const t=home.tasks.find(t=>t.id===id)||{title:'',area:'Kitchen',icon:'🧹',minutes:15,every:1,unit:'week',due:iso(),notes:'',order:home.people.map(p=>p.id),turn:0,paused:false};
  let order=[...t.order,...home.people.filter(p=>!t.order.includes(p.id)).map(p=>p.id)];let selected=new Set(t.order);
  const ICONS=['🧹','🍳','🫧','♻️','🌿','🧊','🧺','🗑️','🛒','✨','🪴','🛁'];
  sheet=null;
  dialog(id?'Edit chore':'Add chore','',`<label class="field big">Chore<input name="title" value="${esc(t.title)}" maxlength="100" placeholder="e.g. Clean the bathroom" required autocomplete="off"></label>
  <div class="field">Icon<div class="chips">${ICONS.map(a=>`<label class="chip plain" style="padding:0 10px;font-size:18px"><input type="radio" name="icon" value="${a}" ${t.icon===a?'checked':''}>${a}</label>`).join('')}</div></div>
  <div class="sentence">Repeats every <select name="every">${Array.from({length:12},(_,i)=>i+1).map(n=>`<option ${t.every===n?'selected':''}>${n}</option>`).join('')}</select> <select name="unit">${[['day','day(s)'],['week','week(s)'],['month','month(s)']].map(([v,n])=>`<option value="${v}" ${t.unit===v?'selected':''}>${n}</option>`).join('')}</select> and takes about <select name="minutes">${[5,10,15,20,30,45,60,90,120].map(n=>`<option ${t.minutes===n?'selected':''}>${n}</option>`).join('')}${[5,10,15,20,30,45,60,90,120].includes(t.minutes)?'':`<option selected>${t.minutes}</option>`}</select> minutes</div>
  <div class="form-row"><label class="field">Next due<input type="date" name="due" value="${esc(t.due)}" required></label><label class="field">Where<select name="area">${['Kitchen','Bathroom','Living room','Whole home','Outdoors','Other'].map(a=>`<option ${t.area===a?'selected':''}>${a}</option>`).join('')}</select></label></div>
  <div class="field">Who takes turns<small>Tick who’s in, and use the arrows to set the order.</small><div class="split-rows" id="rotation-list"></div></div>
  <label class="field">Whose turn is it first?<select name="assigned" id="assigned-select"></select></label>
  <label class="field">Notes<textarea name="notes" maxlength="1000" placeholder="What does a job well done look like? (optional)">${esc(t.notes)}</textarea></label>
  ${id?`<label class="check-row"><input type="checkbox" name="paused" ${t.paused?'checked':''}>Pause this chore</label>`:''}`,'Save',async f=>{const chosen=order.filter(id=>selected.has(id));if(!chosen.length)throw new Error('Choose at least one flatmate for the rotation.');const success=await mutate(h=>{const values={title:f.get('title').trim(),area:f.get('area'),icon:f.get('icon')||'🧹',minutes:Number(f.get('minutes')),every:Number(f.get('every')),unit:f.get('unit'),due:f.get('due'),anchorDay:t.due===f.get('due')&&id?t.anchorDay:date(f.get('due')).getDate(),notes:f.get('notes').trim(),order:chosen,turn:Math.max(0,chosen.indexOf(f.get('assigned'))),paused:f.has('paused')};const old=h.tasks.find(t=>t.id===id);if(old)Object.assign(old,values);else{if(h.tasks.length>=100)throw new Error('This home supports up to 100 chores.');h.tasks.push({id:uid(),...values});}record(h,'task',`${values.title} ${id?'was updated':'joined the routine'}`);},id?'Chore updated':'Chore added');if(success)$('#modal').close();});
  const fillOrder=()=>{const assigned=$('#assigned-select').value||t.order[t.turn];$('#rotation-list').innerHTML=order.map((id,i)=>{const p=home.people.find(p=>p.id===id);return `<div class="split-row"><input type="checkbox" aria-label="Include ${esc(p.name)}" data-rotation="${esc(id)}" ${selected.has(id)?'checked':''}>${avatar(p,'sm')}<span>${esc(p.name)}</span><span class="order"><button type="button" data-move="${i}" data-dir="-1" ${i===0?'disabled':''} aria-label="Move ${esc(p.name)} up">↑</button><button type="button" data-move="${i}" data-dir="1" ${i===order.length-1?'disabled':''} aria-label="Move ${esc(p.name)} down">↓</button></span></div>`;}).join('');$('#assigned-select').innerHTML=order.filter(id=>selected.has(id)).map(id=>{const p=home.people.find(p=>p.id===id);return `<option value="${esc(id)}" ${assigned===id?'selected':''}>${esc(p.name)}</option>`;}).join('');};fillOrder();$('#rotation-list').addEventListener('change',e=>{if(e.target.dataset.rotation){e.target.checked?selected.add(e.target.dataset.rotation):selected.delete(e.target.dataset.rotation);fillOrder();}});$('#rotation-list').addEventListener('click',e=>{const b=e.target.closest('[data-move]');if(b){const i=Number(b.dataset.move),j=i+Number(b.dataset.dir);[order[i],order[j]]=[order[j],order[i]];fillOrder();}});
  setTimeout(()=>$('#dialog-form [name=title]')?.focus(),50);
}
function schedulePage(){
  const person=schedulePerson==='me'?myId:schedulePerson,mine=e=>!person||e.person?.id===person;
  const dayEvents=(events,d)=>events.filter(e=>e.due===d&&mine(e));
  const people=[['','Everyone'],...(myId?[['me','My turns']]:[]),...home.people.filter(p=>p.id!==myId).map(p=>[p.id,p.name])];
  const controls=`<div class="head" style="padding-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="seg">${[['week','Week'],['month','Month']].map(([m,n])=>`<button class="${scheduleMode===m?'active':''}" data-action="scheduleMode" data-id="${m}">${n}</button>`).join('')}</div><select class="input" id="schedule-person" aria-label="Whose turns" style="width:auto;min-height:38px;padding:6px 32px 6px 12px;font-size:14px;margin-left:auto">${people.map(([id,n])=>`<option value="${esc(id)}" ${schedulePerson===id?'selected':''}>${esc(n)}</option>`).join('')}</select></div>`;
  let body;
  if(scheduleMode==='month'){
    const first=date(iso());first.setDate(1);first.setMonth(first.getMonth()+monthOffset);
    const monthStart=iso(first),last=iso(new Date(first.getFullYear(),first.getMonth()+1,0)),gridStart=addDays(monthStart,-((first.getDay()+6)%7));
    const events=schedule(home,Math.max(1,Math.round((date(last)-date(iso()))/864e5)+1)),cells=Math.ceil((Math.round((date(last)-date(gridStart))/864e5)+1)/7)*7;
    body=`<div class="week-nav"><button data-action="prevMonth" aria-label="Previous month" ${monthOffset<=0?'disabled':''}>‹</button><b>${first.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</b><button data-action="nextMonth" aria-label="Next month" ${monthOffset>=5?'disabled':''}>›</button><button class="today" data-action="thisWeek">Today</button></div><div class="month-grid">${['Mo','Tu','We','Th','Fr','Sa','Su'].map(d=>`<div class="month-weekday">${d}</div>`).join('')}${Array.from({length:cells},(_,i)=>{const d=addDays(gridStart,i),list=d>=iso()?dayEvents(events,d):[];return `<div class="month-cell ${d===iso()?'today':''} ${d<monthStart||d>last?'outside':''} ${d<iso()?'past':''}"><span class="d">${date(d).getDate()}</span>${list.slice(0,3).map(e=>`<span class="t ${e.person?.id===myId?'you':''}" title="${esc(e.title)} · ${esc(e.person?.name||'Everyone away')}">${esc(e.icon)} ${esc(e.title)}</span>`).join('')}${list.length>3?`<span class="more">+${list.length-3}</span>`:''}</div>`;}).join('')}</div>`;
  }else{
    const start=addDays(iso(),weekOffset*7),events=schedule(home,Math.max(35,(weekOffset+1)*7));
    body=`<div class="week-nav"><button data-action="prevWeek" aria-label="Previous week" ${weekOffset<=0?'disabled':''}>‹</button><b>${dateLabel(start)} – ${dateLabel(addDays(start,6))}</b><button data-action="nextWeek" aria-label="Next week">›</button><button class="today" data-action="thisWeek">Today</button></div>${Array.from({length:7},(_,i)=>{const d=addDays(start,i),list=dayEvents(events,d);return `<section class="day ${d===iso()?'today':''}"><div class="day-title">${date(d).toLocaleDateString('en-GB',{weekday:'long'})} <small>${dateLabel(d)}${d===iso()?' · Today':''}</small></div>${list.map(e=>`<div class="day-task ${e.person?.id===myId?'you':''}">${avatar(e.person,'sm')}<span>${esc(e.icon)} ${esc(e.title)}</span><small>${e.person?esc(e.person.name.split(' ')[0]):'Everyone away'} · ${e.minutes} min</small></div>`).join('')||'<p class="day-free">Nothing planned</p>'}</section>`;}).join('')}`;
  }
  const upcoming=schedule(home,120);
  const next=activeTasks().slice().sort((a,b)=>a.title.localeCompare(b.title)).map(t=>{const turns=upcoming.filter(e=>e.task===t.id).slice(0,4);return `<div class="row wrap"><span class="row-icon">${esc(t.icon)}</span><span class="row-main"><b>${esc(t.title)}</b><small>${frequency(t)}</small></span><span class="turns" style="width:100%;padding-left:54px">${turns.map((e,i)=>`<span class="turn ${i===0?'first':''}">${avatar(e.person,'sm')}<small>${i===0&&e.due<=iso()?'Now':dateLabel(e.due)}</small></span>`).join('')}</span></div>`;}).join('');
  return controls+body+`<section class="list"><div class="list-head"><h2>Who’s next</h2></div>${next||'<p class="empty">Add a chore to see whose turn is coming up.</p>'}</section><p class="note pad" style="padding-bottom:16px">Future turns are a preview. Finishing, passing or reassigning a chore updates the schedule. Unfinished turns rotate at the next occurrence and show as missed in Activity.</p>`;
}
// Who has done how much over the last 30 days, by chore minutes, against an even split.
function fairShareSheet(){
  openSheet(()=>{
    const since=new Date(date(addDays(iso(),-29))).toISOString(),recent=home.history.filter(e=>e.at>=since);
    const stats=home.people.map(p=>({p,minutes:recent.filter(e=>e.kind==='done'&&e.person===p.id).reduce((n,e)=>n+e.minutes,0),done:recent.filter(e=>e.kind==='done'&&e.person===p.id).length,missed:recent.filter(e=>e.kind==='missed'&&e.person===p.id).length,passed:recent.filter(e=>e.kind==='skip'&&e.person===p.id).length}));
    const total=stats.reduce((n,s)=>n+s.minutes,0),fair=total/Math.max(1,stats.length),top=Math.max(1,...stats.map(s=>s.minutes));
    dialog('Fair share','Chore minutes per person over the last 30 days, compared with an even split.',total?`<div class="bars">${stats.sort((a,b)=>b.minutes-a.minutes).map(s=>{const diff=Math.round(s.minutes-fair);return `<div class="bar-line">${avatar(s.p)}<div><b>${esc(s.p.name)}${s.p.id===myId?' <span class="badge you">You</span>':''}</b><div class="bar-track"><i style="width:${Math.round(s.minutes/top*100)}%"></i></div><small>${s.done} done · ${s.minutes} min${s.passed?` · ${s.passed} passed`:''}${s.missed?` · ${s.missed} missed`:''}</small></div><span class="bar-end ${Math.abs(diff)<=15?'muted':diff>0?'pos':'neg'}">${Math.abs(diff)<=15?'Fair':diff>0?`+${diff} min`:`${diff} min`}</span></div>`;}).join('')}</div><p class="note">An even split would be ${Math.round(fair)} minutes each. Minutes come from each chore’s estimate.</p>`:'<p class="empty">Mark chores as done to see how the work is shared.</p>');
  });
}
function calendarDialog(){sheet=null;dialog('Add to your calendar','Export the next 60 days of chores with a reminder at 09:00 on each due date.',`<label class="field">Whose chores?<select name="person"><option value="">Everyone</option>${home.people.map(p=>`<option value="${esc(p.id)}" ${myId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="note">Open the downloaded .ics file in Apple Calendar, Google Calendar or your calendar app. It’s a snapshot, so export it again after changing your routine.</p>`,'Download calendar',async f=>{download(calendar(home,f.get('person')),'flatflow-chores.ics','text/calendar');$('#modal').close();toast('Your calendar file is ready.');});}

// ---------- Activity ----------
const ACTIVITY_ICONS={done:'check',skip:'swap',expense:'wallet',settle:'hand',missed:'clock',person:'people',task:'broom',snooze:'clock',assign:'people'};
function activityPage(){
  const items=home.history;
  if(!items.length)return '<div class="empty"><h3>Nothing yet</h3><p>Completed chores, new expenses and payments show up here.</p></div>';
  let out='',day='';
  for(const e of items.slice(0,200)){const d=iso(new Date(e.at));if(d!==day){day=d;out+=`<h3 class="group-title">${dayName(d)}</h3>`;}out+=`<div class="row"><span class="row-icon ${e.kind==='done'||e.kind==='settle'?'pos':e.kind==='missed'?'neg':''}">${I(ACTIVITY_ICONS[e.kind]||'spark')}</span><span class="row-main soft"><b>${esc(e.text)}</b><small>${new Date(e.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small></span></div>`;}
  return `<section class="list">${out}</section>`;
}

// ---------- Account ----------
function accountPage(){
  const who=home.people.find(p=>p.id===myId),name=who?.name||account?.name||account?.email||'You';
  const profile=`<div class="profile">${avatar(who||{name,color:0},'xl')}<div><h1>${esc(name)}</h1>${account?.email?`<small>${esc(account.email)}</small>`:''}${home.people.length?`<button class="link" data-action="${account?'switchMe':'chooseMe'}">${who?'Not you? Switch':'Which one is you?'}</button>`:''}</div></div>`;
  const row=(icon,label,action,value='',extra='')=>`<button type="button" class="row" data-action="${action}" ${extra}><span class="row-icon">${I(icon)}</span><span class="row-main"><b>${label}</b></span>${value?`<span class="value">${value}</span>`:''}${I('chevron').replace('class="icon"','class="icon chev"')}</button>`;
  const homes=listHomes(localStorage).slice().reverse(),current=mode==='welcome'?'':homeEntryId({home,mode,key});
  const signIn=!authInfo?'<p class="note pad">Checking whether sign-in is available…</p>':!authInfo.clientId?'':account?'':`<div class="section-title">Account</div><div class="section"><div style="padding:14px"><p class="note" style="margin-bottom:12px">Sign in so all your homes follow you to every phone and computer.</p><div id="google-signin" class="google"></div></div></div>`;
  return profile+signIn+`<div class="section-title">This home</div><div class="section">${row('home','Home',"homeDetails",esc(home.name))}${row('people','Flatmates','go',String(home.people.length),'data-id="flatmates"')}${mode==='shared'?row('share','Invite flatmates','share'):row('link','Share this home online','connect')}${row('bell','Notifications','notificationsSheet',pushHomes()[home.id]===myId&&myId?'On':'Off')}</div>
  <div class="section-title">Your homes</div><div class="section">${homes.map(e=>`<button type="button" class="row" data-action="${e.id===current?'homes':'switchHome'}" data-id="${esc(e.id)}" ${e.id===current?'':'data-mutate'}><span class="row-icon">${I('home')}</span><span class="row-main"><b>${esc(e.home.name)}</b><small>${e.mode==='shared'?'Shared':'This device only'}${e.myId&&e.home.people?.find(p=>p.id===e.myId)?' · '+esc(e.home.people.find(p=>p.id===e.myId).name):''}</small></span>${e.id===current?'<span class="badge you">Open</span>':I('chevron').replace('class="icon"','class="icon chev"')}</button>`).join('')}${row('key','Join with a code or link','joinLink')}${row('plus','Create a home','newHome')}</div>
  <div class="section-title">App</div><div class="section"><div class="row"><span class="row-icon">${I(isDark()?'moon':'sun')}</span><span class="row-main"><b>Appearance</b></span><div class="seg" role="group" aria-label="Theme">${THEMES.map(([v,n])=>`<button type="button" class="${themeChoice()===v?'active':''}" data-action="theme" data-id="${v}">${n}</button>`).join('')}</div></div>${row('phone','Install on your phone','install')}${row('download','Export a backup','export')}${row('upload','Restore a backup','import')}${row('trash','Clear older activity','trimActivity')}</div>
  ${account?`<div class="section-title">Account</div><div class="section"><button type="button" class="row" data-action="signOut"><span class="row-icon">${I('logout')}</span><span class="row-main"><b>Sign out</b><small>Removes your shared homes from this device</small></span></button><button type="button" class="row" data-action="signOutAll"><span class="row-icon">${I('logout')}</span><span class="row-main"><b>Sign out everywhere</b>${accountMeta?.sessions>1?`<small>Signed in on ${accountMeta.sessions} devices</small>`:''}</span></button><button type="button" class="row danger" data-action="deleteAccount"><span class="row-icon">${I('trash')}</span><span class="row-main"><b>Delete your account</b></span></button></div>`:''}
  <p class="foot">Flatflow · ${mode==='shared'?'Shared online':'Saved on this device'} · ${esc(syncState)} · <a href="./privacy.html" target="_blank" rel="noopener">Privacy</a></p>`;
}
function homeDetails(){
  sheet=null;
  dialog('Home','',`<label class="field">Name<input name="name" value="${esc(home.name)}" maxlength="80" required></label><label class="field">Currency<select name="currency">${CURRENCIES.map(c=>`<option ${c===(home.currency||'EUR')?'selected':''}>${c}</option>`).join('')}</select></label><label class="switch-row"><span><b>Track chores</b><small>Turn off for a trip or a group that only shares costs.</small></span><input type="checkbox" name="chores" ${home.expensesOnly?'':'checked'}></label>${mode==='shared'?`<p class="note">Anyone with the invitation can see and edit this home. Connection: ${esc(syncState)}.</p>`:''}<button type="button" class="link danger" data-action="forgetHome" data-id="${esc(homeEntryId({home,mode,key}))}">${I('close')}Remove this home from ${account&&mode==='shared'?'your account':'this device'}</button>${mode==='shared'?`<button type="button" class="link danger" data-action="deleteHome">${I('trash')}Delete this home for everyone</button>`:''}`,'Save',async f=>{if(await mutate(h=>{h.name=f.get('name').trim();h.currency=f.get('currency');if(f.get('chores'))delete h.expensesOnly;else h.expensesOnly=true;},'Home details saved'))$('#modal').close();});
}
function flatmatesPage(){
  const done=home.history.filter(e=>e.kind==='done'&&e.at>=new Date(date(addDays(iso(),-6))).toISOString()),cur=home.currency||'EUR',net=expenseBalances(home,cur);
  return `<section class="list">${home.people.map(p=>{const v=net[p.id]||0;return `<button type="button" class="row" data-action="editPerson" data-id="${esc(p.id)}">${avatar(p,'lg')}<span class="row-main"><b>${esc(p.name)}${p.id===myId?' <span class="badge you">You</span>':''}</b><small>${p.paused?'On a break':p.awayFrom&&p.awayTo?`Away ${dateLabel(p.awayFrom)} – ${dateLabel(p.awayTo)}`:home.expensesOnly?'':`${activeTasks().filter(t=>assignee(t,home.people)?.id===p.id).length} chores · ${done.filter(e=>e.person===p.id).length} done this week`}</small></span><span class="row-end ${v>0?'pos':v<0?'neg':'muted'}">${v?`<small>${v>0?'gets back':'owes'}</small><b>${money(Math.abs(v),cur)}</b>`:'<b>settled</b>'}</span></button>`;}).join('')||`<div class="empty"><h3>Nobody here yet</h3><p>Add everyone who shares this home.</p><button class="btn" data-action="addPerson">${I('plus')}Add a flatmate</button></div>`}</section>${mode==='shared'&&home.people.length?`<div style="padding:16px"><button class="btn secondary block" data-action="share">${I('share')}Invite with a link or code</button></div>`:''}`;
}
function personForm(id=''){
  const p=home.people.find(p=>p.id===id)||{name:'',color:home.people.length%6,paused:false,awayFrom:'',awayTo:''};
  sheet=null;
  dialog(id?'Edit flatmate':'Add a flatmate',id?'':'Add everyone who shares the home. They can join on their own phone later with an invite.',`<label class="field big">Name<input name="name" value="${esc(p.name)}" maxlength="60" required placeholder="e.g. Alex" autocomplete="off"></label><div class="field">Colour<div class="chips">${['Green','Orange','Blue','Purple','Teal','Yellow'].map((c,i)=>`<label class="chip" aria-label="${c}"><input type="radio" name="color" value="${i}" ${p.color===i?'checked':''}><span class="avatar c${i}" style="width:26px;height:26px"> </span></label>`).join('')}</div></div><div class="form-row"><label class="field">Away from<input type="date" name="awayFrom" value="${esc(p.awayFrom)}"></label><label class="field">Away until<input type="date" name="awayTo" value="${esc(p.awayTo)}"></label></div><label class="switch-row"><span><b>On a break</b><small>Skipped in every rotation until switched off.</small></span><input type="checkbox" name="paused" ${p.paused?'checked':''}></label>${id?`<button type="button" class="link danger" data-action="deletePerson" data-id="${esc(id)}">${I('trash')}Remove ${esc(p.name)} from the home</button>`:''}`,'Save',async f=>{const from=f.get('awayFrom'),to=f.get('awayTo');if(!!from!==!!to||from&&to<from)throw new Error('Enter both away dates, with the end on or after the start.');const success=await mutate(h=>{const target=h.people.find(x=>x.id===id),values={name:f.get('name').trim(),color:Number(f.get('color')),paused:f.has('paused'),awayFrom:from,awayTo:to};if(target)Object.assign(target,values);else{if(h.people.length>=30)throw new Error('This home supports up to 30 flatmates.');h.people.push({id:uid(),...values});}record(h,'person',`${values.name} ${id?'updated their availability':'joined the home'}`);},id?'Flatmate updated':'Flatmate added');if(success){if(!myId&&home.people.length===1&&!account){myId=home.people[0].id;persist();render();}$('#modal').close();}});
  setTimeout(()=>$('#dialog-form [name=name]')?.focus(),50);
}
function notificationsSheet(){
  openSheet(()=>dialog('Notifications','A reminder on your phone when your chores are due, and a message when a flatmate adds an expense you share or pays you back.',`<p class="summary">${esc(pushLabel())}</p><div class="menu"><button type="button" class="primary" data-action="notifications">${I('bell')}Turn on for this phone</button><button type="button" data-action="testPush">${I('spark')}Send a test notification</button><button type="button" data-action="disablePush">${I('close')}Turn off on this device</button><button type="button" data-action="calendar">${I('calendar')}Use calendar reminders instead</button></div><p class="note">Daily chore reminders arrive between 09:00 and 10:00 Berlin time. On iPhone, first add Flatflow to your Home Screen from Safari and open it from there.</p>`));
}
const otherHomes=()=>listHomes(localStorage).filter(e=>mode==='welcome'||e.id!==homeEntryId({home,mode,key})).length;
function homeList(){
  const current=mode==='welcome'?'':homeEntryId({home,mode,key});
  return `<div class="home-list">${listHomes(localStorage).slice().reverse().map(e=>`<div class="row">${I('home')}<span class="row-main"><b>${esc(e.home.name)}</b><small>${e.mode==='shared'?'Shared home':'This device only'}${e.myId&&e.home.people?.find(p=>p.id===e.myId)?' · you are '+esc(e.home.people.find(p=>p.id===e.myId).name):''}</small></span>${e.id===current?'<span class="badge you">Open now</span>':`<button class="small-btn primary" type="button" data-action="switchHome" data-id="${esc(e.id)}" data-mutate>Open</button><button class="small-btn ghost" type="button" data-action="forgetHome" data-id="${esc(e.id)}" aria-label="Remove ${esc(e.home.name)} from this device">${I('close')}</button>`}</div>`).join('')}</div>`;
}
function homesDialog(){
  rememberCurrent();
  openSheet(()=>dialog('Your homes','',`${homeList()}<div class="buttons stack"><button type="button" class="btn secondary" data-action="joinLink">${I('key')}Join with a code or link</button><button type="button" class="btn secondary" data-action="newHome">${I('plus')}Create a home</button></div>`));
}
function switchHome(id){
  if(busy)return;const entry=listHomes(localStorage).find(e=>e.id===id);if(!entry)throw new Error('That home is no longer on this device.');
  rememberCurrent();
  ({home,mode,key,revision,myId,backend}=openHome(entry,BACKEND_URL||backend));
  view=home.expensesOnly&&view==='chores'?'expenses':PARENT[view]?PARENT[view]:view;choreFilter='all';expenseSearch='';expenseFilter='all';searchOpen=false;weekOffset=0;monthOffset=0;
  syncState=mode==='shared'?'Connecting…':'Saved on this device';
  if(mode!=='shared'){client?.close();client=null;rollOver(home);}
  history.replaceState(null,'',location.pathname);persist();if($('#modal').open)$('#modal').close();render();toast(`Welcome back to ${home.name}.`);
  if(mode==='shared')refresh(true);
}
function forgetHomeDialog(id){
  const entry=listHomes(localStorage).find(e=>e.id===id);if(!entry)return;
  const invite=entry.mode==='shared'?`${location.origin}${location.pathname}#${new URLSearchParams({home:entry.key})}`:'';
  const isCurrent=mode!=='welcome'&&id===homeEntryId({home,mode,key});
  sheet=null;
  dialog(`Remove ${esc(entry.home.name)}?`,entry.mode==='shared'?'The home stays shared with your flatmates. You can come back any time with its invitation link.':'This home only exists on this device. Removing it deletes it for good.',invite?`<label class="field">Invitation link<input value="${esc(invite)}" readonly><small>Copy this first if you might want to come back.</small></label>`:'','Remove',async()=>{if(entry.mode==='shared'){try{await forgetPush([entry]);}catch{}}if(account&&entry.mode==='shared'){try{await connectClient();applyAccount(await client.call({action:'unlinkHome',session:account.session,key:entry.key}));}catch(err){if(!accountExpired(err))throw err;}}forgetHome(localStorage,id);
    if(isCurrent){const next=listHomes(localStorage).at(-1);client?.close();client=null;if(next)switchHome(next.id);else{({home,mode,key,revision,myId,backend}=restoreSession({getItem:()=>null},BACKEND_URL));history.replaceState(null,'',location.pathname);persist();$('#modal').close();render();}}
    else homesDialog();toast('Home removed.');});
}
function keygen(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
function newHome(kind){sheet=null;dialog('Create a home','',`<label class="field big">Name<input name="name" maxlength="80" placeholder="e.g. Flat 12 or Lisbon trip" required autocomplete="off"></label><div class="field">What’s it for?<div class="chips"><label class="chip plain"><input type="radio" name="kind" value="flat" ${kind!=='group'?'checked':''}>🏡 A flat: chores and shared costs</label><label class="chip plain"><input type="radio" name="kind" value="group" ${kind==='group'?'checked':''}>✈️ A trip or group: costs only</label></div></div><label class="check-row"><input type="checkbox" name="local"><span>Keep it on this device only<small>Not shared, no invitations. Fine for a quick personal list.</small></span></label>`,'Create',async f=>{rememberCurrent();const draft=emptyHome(f.get('name').trim());if(f.get('kind')==='group')draft.expensesOnly=true;
  // Whoever creates a home is its first flatmate, linked to their sign-in.
  const tag=await claimTag(),me=tag?{id:uid(),name:accountName(),color:0,paused:false,awayFrom:'',awayTo:'',claim:tag}:null;if(me)draft.people.push(me);validateHome(draft);if(!f.has('local')){backend=BACKEND_URL;setBusy(true);try{await connectClient();const newKey=keygen(),r=await client.call({action:'create',key:newKey,op:uid(),home:draft});home=validateHome(r.home);key=newKey;revision=r.revision;mode='shared';syncState='Synced';}finally{setBusy(false);}}else{home=draft;mode='local';key='';revision=0;syncState='Saved on this device';client?.close();client=null;}myId=me?.id||'';view='expenses';history.replaceState(null,'',location.pathname);persist();$('#modal').close();render();toast(`${home.name} is ready. Add the people who live here.`);});
  setTimeout(()=>$('#dialog-form [name=name]')?.focus(),50);}
function connectionDialog(){sheet=null;dialog('Share this home online','Flatflow keeps a shared home in sync between everyone in it.',`<label class="field">Invitation link or key<input name="key" value="${esc(key)}" placeholder="Paste an invitation, or leave empty"><small>Leave empty to share this device’s home as it is.</small></label>`,'Share online',async f=>{rememberCurrent();const input=String(f.get('key')).trim();let newKey=input;if(input.includes('#'))newKey=new URLSearchParams(input.split('#')[1]).get('home');if(newKey&&!/^[a-f0-9]{64}$/.test(newKey))throw new Error('That invitation key is invalid. Paste the full invitation link.');backend=BACKEND_URL;setBusy(true);try{await connectClient();if(!newKey)newKey=keygen();const r=await client.call(input?{action:'read',key:newKey,revision:-1}:{action:'create',key:newKey,home,op:uid()});home=validateHome(r.home);mode='shared';key=newKey;myId='';history.replaceState(null,'',location.pathname);revision=r.revision;syncState='Synced';persist();$('#modal').close();render();toast('Your home is now shared online.');}finally{setBusy(false);}});}
function invitation(){const params=new URLSearchParams({home:key});if(!BACKEND_URL)params.set('backend',backend);return `${location.origin}${location.pathname}#${params}`;}
function shareHome(){if(mode!=='shared'){connectionDialog();return;}const link=invitation();sheet=null;dialog('Invite flatmates','Anyone with the link or code can see and edit this home.',`<div class="buttons stack"><button class="btn" type="button" data-action="${navigator.share?'nativeShare':'copyInvite'}">${I('share')}${navigator.share?'Share the invitation':'Copy the invitation link'}</button>${navigator.share?`<button class="btn secondary" type="button" data-action="copyInvite">Copy the link</button>`:''}</div><label class="field">Invitation link<input value="${esc(link)}" readonly id="invite-url"></label><div id="invite-code" class="field">Invite code<small>Easier to read out or type on another phone. Works for 7 days.</small><button class="btn secondary" type="button" data-action="inviteCode">${I('key')}Get a code</button></div>`);}
// Seals the household key with a fresh code and files it with the backend.
async function inviteCode(){
  const box=$('#invite-code');if(!box||mode!=='shared')return;
  box.querySelector('button').disabled=true;
  try{
    await connectClient();const code=makeCode();
    const r=await client.call({action:'createInvite',key,invite:await inviteId(code),sealed:await sealKey(key,code)});
    box.innerHTML=`Invite code<strong class="code" aria-label="Invite code ${code.split('').join(' ')}">${code}</strong><small>Works until ${new Date(r.expires).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}. In Flatflow: Account → Join with a code or link.</small><button class="btn secondary" type="button" data-action="copyCode" data-id="${code}">Copy code</button>`;
  }catch(err){box.querySelector('button').disabled=false;throw new Error(/Unsupported/.test(err.message)?'Invite codes arrive with the next backend update. Share the link for now.':err.message);}
}
function download(content,filename,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function exportHome(){download(JSON.stringify(home,null,2),'flatflow-backup-'+iso()+'.json');toast('Your backup is ready.');}
async function importHome(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.className='file-input';document.body.append(input);input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;if(file.size>400000)throw new Error('That backup is too large.');const imported=validateHome(JSON.parse(await file.text()));sheet=null;dialog('Restore this backup?',`This replaces ${esc(home.name)} with ${esc(imported.name)}: ${imported.people.length} flatmates, ${imported.tasks.length} chores and ${(imported.expenses||[]).length} expenses. ${mode==='shared'?'Everyone in the home will see the change.':''}`,'<button class="link" type="button" data-action="export">Export the current home first</button>','Restore',async()=>{const success=await mutate(h=>{for(const k of Object.keys(h))delete h[k];Object.assign(h,imported);},'Backup restored');if(success)$('#modal').close();});}catch(err){toast(err.message,true);}finally{input.remove();}},{once:true});input.click();}

// ---------- Sign-in and welcome ----------
function signInGate(){
  const invitedKey=new URLSearchParams(location.hash.slice(1)).get('home'),invited=!!invitedKey&&invitedKey!==key;
  $('#app').innerHTML=`<main class="gate"><div class="brand"><i>${I('home')}</i>Flatflow</div><h1>${invited?'You’re invited':'Chores and costs, shared fairly.'}</h1><p>${invited?'Your flatmates invited you to their home. Sign in with Google and you’ll join it straight away.':'Sign in with Google to open your home. Everything stays private to the people in it.'}</p>${authInfo?.error?`<p class="banner">Flatflow can’t reach its server. Check your connection and try again.</p><button class="btn" data-action="retryAuth">Try again</button>`:authInfo?(authInfo.clientId?'<div id="google-signin" class="google"></div>':'<p class="note">No sign-in method is switched on for this Flatflow yet.</p>'):'<p class="note">Getting things ready…</p>'}<p class="note">Flatflow only sees your name and email address, never your Google password. <a href="./privacy.html" target="_blank" rel="noopener">How your data is handled</a></p></main>`;
  showGoogleButton();
}
function welcome(){
  $('#app').innerHTML=`<main class="gate"><div class="brand"><i>${I('home')}</i>Flatflow</div><h1>Welcome${account?.name?', '+esc(account.name.split(' ')[0]):''}.</h1><p>Create a home for your flat, or join one your flatmates already set up.</p><div class="buttons stack"><button class="btn" data-action="newHome">${I('plus')}Create a home</button><button class="btn secondary" data-action="joinLink">${I('key')}Join with a code or link</button></div>${authInfo?.clientId&&!account?`<div id="google-signin" class="google"></div>`:''}${listHomes(localStorage).length?`<div style="width:100%;text-align:left"><h3 class="group-title" style="padding-left:0">Homes on this device</h3>${homeList()}</div>`:''}</main>`;
  showGoogleButton();
}

// ---------- Render ----------
function render(){
  if(gated()){signInGate();return;}
  if(mode==='welcome'){welcome();return;}
  if(home.expensesOnly&&tabOf(view)==='chores')view='expenses';
  const pages={expenses:expensesPage,chores:choresPage,activity:activityPage,account:accountPage,schedule:schedulePage,flatmates:flatmatesPage,shopping:shoppingPage,bills:billsPage,spending:spendingPage};
  const page=pages[view]||expensesPage,tab=tabOf(view),sub=!!PARENT[view];
  const offline=mode==='shared'&&!['Synced','Connecting…','Saving…'].includes(syncState);
  const syncPill=offline?`<span class="sync-pill"><i></i>${syncState==='Offline'?'Offline':syncState==='Home not found'?'Not found':'Not synced'}</span>`:mode!=='shared'?`<span class="sync-pill" style="background:var(--bg-3);color:var(--muted)">This device only</span>`:'';
  const title=sub?`<button class="bar-back" data-action="back" aria-label="Back">${I('back')}${SCREEN_TITLES[tab]||'Back'}</button><h1 class="bar-title" style="flex:1;font-size:17px;pointer-events:none"><span>${SCREEN_TITLES[view]}</span></h1>`:tab==='expenses'||tab==='chores'?`<button class="bar-title" data-action="homes" aria-label="Switch home. Current home: ${esc(home.name)}"><span>${esc(home.name)}</span>${I('down')}</button>`:`<h1 class="bar-title" style="pointer-events:none"><span>${SCREEN_TITLES[view]}</span></h1>`;
  const fabs={expenses:['addExpense','Add expense'],chores:['addTask','Add chore'],flatmates:['addPerson','Add flatmate'],bills:['addBill','Add bill']};
  const fab=fabs[view]&&!(needPeople()&&view!=='flatmates')?fabs[view]:null;
  $('#app').innerHTML=`<div class="app"><aside class="rail"><div class="brand"><i>${I('home')}</i>Flatflow</div><button class="rail-home" data-action="homes" aria-label="Switch home">${I('home')}<span class="row-main"><b>${esc(home.name)}</b><small>${plural(home.people.length,home.expensesOnly?'member':'flatmate')}${otherHomes()?` · ${otherHomes()+1} homes`:''}</small></span>${I('down')}</button><nav class="rail-nav" aria-label="Main">${visibleTabs().map(([v,i,n])=>`<button data-action="tab" data-id="${v}" class="${tab===v?'active':''}">${I(i)}${n}</button>`).join('')}</nav>${fab?`<button class="btn rail-add" data-action="${fab[0]}">${I('plus')}${fab[1]}</button>`:''}<div class="rail-foot">${syncPill}${account?`<span>${esc(account.email||account.name||'')}</span>`:''}</div></aside><div style="min-width:0"><header class="bar">${title}<div class="bar-right">${sub?'':syncPill}</div></header><main class="main" id="main" tabindex="-1"><div class="page">${banners()}${page()}</div></main></div>${fab?`<button class="fab" data-action="${fab[0]}">${I('plus')}${fab[1]}</button>`:''}<nav class="tabs" aria-label="Main">${visibleTabs().map(([v,i,n])=>`<button data-action="tab" data-id="${v}" class="${tab===v?'active':''}" aria-current="${tab===v?'page':'false'}">${I(i)}${n}</button>`).join('')}</nav></div>`;
  setBusy(busy);showGoogleButton();if(view==='account'&&account&&!accountMeta)loadAccountMeta();
  if($('#modal').open&&sheet?.live)sheet.build();
  $('#shopping-form')?.addEventListener('submit',async e=>{e.preventDefault();const item=new FormData(e.target).get('item').trim();if(!item)return;if(await mutate(h=>{h.shopping=h.shopping||[];if(h.shopping.length>=60)throw new Error('The shopping list holds up to 60 items. Clear bought items first.');h.shopping.push({id:uid(),item,addedBy:myId||'',done:false});},'Added to the list'))$('#shopping-form input')?.focus();});
  document.querySelectorAll('[data-shopping]').forEach(el=>el.addEventListener('change',()=>mutate(h=>{const i=(h.shopping||[]).find(i=>i.id===el.dataset.shopping);if(i)i.done=el.checked;},el.checked?'Marked as bought':'Back on the list')));
  $('#expense-search')?.addEventListener('input',e=>{const position=e.target.selectionStart;expenseSearch=e.target.value;render();$('#expense-search').focus();$('#expense-search').setSelectionRange(position,position);});
  $('#schedule-person')?.addEventListener('change',e=>{schedulePerson=e.target.value;render();});
  if(searchOpen&&!expenseSearch&&render.focusSearch){render.focusSearch=false;$('#expense-search')?.focus();}
}
// A sheet is the one dialog. Live sheets rebuild themselves whenever the home changes.
function openSheet(build,live=true){sheet={build,live};build();}
function dialog(title,description,body,submitLabel,onSubmit){
  const el=$('#modal');
  el.innerHTML=`<div class="sheet-head"><h2 id="modal-title">${title}</h2><button class="close" data-action="close" aria-label="Close">${I('close')}</button></div>${description?`<p class="sheet-desc">${description}</p>`:''}<form id="dialog-form" class="sheet-body">${body}</form>${submitLabel?`<div class="sheet-foot"><button type="submit" form="dialog-form" class="btn" data-mutate>${submitLabel}</button></div>`:''}`;
  if(!el.open)el.showModal();
  el.scrollTop=0;el.querySelector('.sheet-body').scrollTop=0;
  $('#dialog-form').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;try{await onSubmit?.(new FormData(e.target),e.target);}catch(err){toast(err.message,true);}});
}
$('#modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close();});
$('#modal').addEventListener('close',()=>{sheet=null;});
$('#modal').addEventListener('change',async e=>{if(e.target.id==='simplify'){const on=e.target.checked;if(!await mutate(h=>{if(on)delete h.simplify;else h.simplify=false;},on?'Debts are simplified':'Everyone pays back whoever paid'))render();}});

// ---------- Sync ----------
async function connectClient(){if(!backend)throw new Error('Can’t reach Flatflow’s server. Check your connection and try again.');if(client?.url===backend){await client.ready;return;}client?.close();client=createSync(backend);
  // Every request carries the sign-in session; the backend refuses home actions without one.
  const call=client.call.bind(client);client.call=p=>call(account?.session&&!p.session?{...p,session:account.session}:p).catch(err=>{if(p.action!=='signOut')accountExpired(err);throw err;});
  await client.ready;}
async function refresh(force=false){if(mode!=='shared'||gated()||busy||refreshing||(!force&&document.visibilityState==='hidden'))return;refreshing=true;const requestedKey=key,requestedRevision=revision;try{if(!client)await connectClient();const r=await client.call({action:'read',key,revision:force?-1:revision});if(key!==requestedKey||busy||revision!==requestedRevision)return;if(r.home){home=validateHome(r.home);revision=r.revision;if(!home.people.some(p=>p.id===myId))myId='';persist();}const changed=syncState!=='Synced'||!!r.home;syncState='Synced';syncError='';if(changed)render();identify();sharePushKeys();if((home.bills||[]).some(b=>!b.paused&&b.due<=iso()))setTimeout(()=>mutate(()=>{},'Recurring bills added'),0);}catch(err){syncError=err.message;syncState=/Household not found/.test(err.message)?'Home not found':navigator.onLine?'Connection needs attention':'Offline';client?.close();client=null;render();}finally{refreshing=false;}}
async function mutate(fn,message='Saved'){
  if(busy)return false;if(gated()){render();return false;}if(mode==='shared'&&syncState!=='Synced'){toast('Reconnect to your home before making changes.',true);return false;}setBusy(true);const draft=structuredClone(home);let sending=false;
  try{rollOver(draft);fn(draft);validateHome(draft);if(mode==='shared'){
    if(!navigator.onLine)throw new Error('You’re offline. Reconnect to save a shared change.');
    if(!client)await connectClient();syncState='Saving…';sending=true;
    const result=await client.call({action:'write',key,revision,op:uid(),home:draft});
    if(result.conflict){try{localStorage.setItem('flatflow-conflict-draft',JSON.stringify(draft));}catch{}home=validateHome(result.home);revision=result.revision;persist();syncState='Synced';render();sheet=null;dialog('A flatmate got there first','Their change was saved and yours wasn’t applied over it. The latest version is now loaded, so try again.','<button type="button" class="link" data-action="exportDraft">Download my attempted change</button>','Got it',async()=>$('#modal').close());return false;}
    home=validateHome(result.home);revision=result.revision;syncState='Synced';
  }else home=draft;persist();render();toast(message);return true;
  }catch(err){
    // A change Flatflow or the server refused leaves the connection fine; only a failed request or a missing home breaks it.
    if(mode==='shared'&&sending){syncError=err.message;syncState=/Household not found/.test(err.message)?'Home not found':(err instanceof TypeError||/fetch|network|timed? ?out|offline|reach|sync failed|connection closed/i.test(err.message))?'Connection needs attention':'Synced';}
    toast(err.message,true);return false;}finally{setBusy(false);if(mode==='shared')render();}
}

// ---------- Personal accounts (Google sign-in) ----------
// Signing in is required once the backend has Google sign-in configured. An
// account remembers your shared homes and who you are in each, so they appear
// on every device you sign in on. Invitation links and codes join the home to
// the account that opens them.
function saveAccount(){try{if(account)localStorage.setItem('flatflow-account',JSON.stringify(account));else localStorage.removeItem('flatflow-account');}catch{}}
function accountExpired(err){if(!/sign-in has expired|Sign in to continue/.test(err?.message||''))return false;account=null;linked={};saveAccount();render();toast('Please sign in again.',true);return true;}
// Until someone signs in, the app shows only the sign-in screen. If the backend has no sign-in configured, it works as before.
const gated=()=>!account&&authInfo?.enabled!==false;
async function loadAuthConfig(){
  if(authInfo&&!authInfo.error)return;
  if(!backend){authInfo={enabled:false,clientId:''};return afterAuth();}
  try{await connectClient();const r=await client.call({action:'authConfig'});const on=m=>SIGN_IN_METHODS.includes(m);authInfo={enabled:!!r.enabled,clientId:on('google')?r.clientId||'':''};}
  catch(err){authInfo=/Unsupported/.test(err.message)?{enabled:false,clientId:''}:{enabled:null,error:true};} // Older backends don't support accounts.
  render();if(account&&authInfo.enabled)syncAccount();afterAuth();
}
// Opens a pending invitation, or syncs the open home, once nothing waits on sign-in.
function afterAuth(){
  if(gated())return;
  if(new URLSearchParams(location.hash.slice(1)).has('home'))handleInvitation();
  else if(mode==='shared'){syncState='Connecting…';render();refresh(true);}
}
let googleLoading=null;
function loadGoogle(){return googleLoading||=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.onload=()=>resolve(window.google);s.onerror=()=>{googleLoading=null;reject(new Error('Google sign-in could not load. Check your connection.'));};document.head.append(s);});}
async function showGoogleButton(){
  const el=$('#google-signin');if(!el||!authInfo?.clientId||el.dataset.ready)return;el.dataset.ready='1';
  try{const google=await loadGoogle();google.accounts.id.initialize({client_id:authInfo.clientId,callback:onGoogleCredential,auto_select:false,cancel_on_tap_outside:true});if(document.contains(el))google.accounts.id.renderButton(el,{theme:isDark()?'filled_black':'outline',size:'large',shape:'pill',text:'signin_with',width:280});}
  catch(err){el.textContent=err.message;}
}
async function onGoogleCredential(response){
  let r;setBusy(true);
  try{await connectClient();r=await client.call({action:'signIn',idToken:response.credential});account={session:r.session,name:r.account.name,email:r.account.email};linked={};saveAccount();}
  catch(err){toast(err.message,true);return;}finally{setBusy(false);render();}
  try{await applyAccount(r,true);toast(`Signed in as ${account.name||account.email}.`);}catch(err){toast(err.message,true);}
  afterAuth();
}
// Merges the account's homes into this device, and this device's shared homes into the account.
async function applyAccount(r,upload=false){
  if(!r?.homes)return;
  const local=listHomes(localStorage).filter(e=>e.mode==='shared'),server=new Map(r.homes.map(h=>[h.key,h]));
  for(const h of r.homes){
    const entry=local.find(e=>e.key===h.key);
    if(!entry)rememberHome(localStorage,{mode:'shared',key:h.key,revision:0,myId:h.person,backend,home:emptyHome(h.name)});
    else if(!entry.myId&&h.person)rememberHome(localStorage,{...entry,myId:h.person});
    linked[h.key]=h.person;
  }
  if(mode==='shared'&&server.get(key)?.person&&!myId){myId=server.get(key).person;persist();}
  if(upload)for(const e of local.filter(e=>!server.has(e.key))){try{await client.call({action:'linkHome',session:account.session,key:e.key,person:e.myId||''});linked[e.key]=e.myId||'';}catch{}}
  if(mode==='welcome'&&r.homes.length&&!new URLSearchParams(location.hash.slice(1)).has('home'))switchHome('shared:'+r.homes[0].key);else render();
}
async function syncAccount(){if(!account)return;try{await connectClient();await applyAccount(await client.call({action:'myHomes',session:account.session}),true);}catch(err){accountExpired(err);}}
function linkCurrent(){
  if(!account||!authInfo?.enabled||mode!=='shared'||!validKey(key)||linked[key]===myId)return;
  const k=key,person=myId;linked[k]=person;
  connectClient().then(()=>client.call({action:'linkHome',session:account.session,key:k,person})).catch(err=>{accountExpired(err);});
}
// Each signed-in person is linked to one flatmate per home by a short tag made
// from their Google email, so every device knows who they are without asking.
let identifying=false;
async function claimTag(){
  if(!account?.email)return '';if(/^[a-f0-9]{16}$/.test(account.claim||''))return account.claim;
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('flatflow-claim|'+account.email.trim().toLowerCase()));
  account.claim=[...new Uint8Array(d)].slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');saveAccount();return account.claim;
}
const accountName=()=>(account?.name||account?.email?.split('@')[0]||'Me').trim().slice(0,60);
async function identify(){
  if(identifying||!account||mode!=='shared'||syncState!=='Synced'||busy||$('#modal')?.open)return;identifying=true;
  try{
    const tag=await claimTag();if(!tag)return;
    const mine=home.people.find(p=>p.claim===tag);
    if(mine){if(myId!==mine.id){myId=mine.id;persist();render();}return;}
    const free=home.people.filter(p=>!p.claim);
    // Someone who picked their name before sign-in decided who they are keeps that choice.
    const known=[linked[key],myId].find(id=>id&&free.some(p=>p.id===id));
    if(known||!home.people.length){await claimPerson(known||'',tag);return;}
    whoDialog(free);
  }finally{identifying=false;}
}
function whoDialog(free=home.people.filter(p=>!p.claim)){
  const first=n=>n.trim().toLowerCase().split(/\s+/)[0],likely=p=>first(p.name)===first(accountName());
  const list=free.slice().sort((a,b)=>likely(b)-likely(a));sheet=null;
  dialog('Which one is you?',`If someone already added you to ${esc(home.name)}, pick your name so your chores and balance follow you on every device.`,
    `<div class="menu">${list.map(p=>`<button type="button" data-action="claimMe" data-id="${esc(p.id)}">${avatar(p)}${esc(p.name)}${likely(p)?'<small>Probably you</small>':''}</button>`).join('')}<button type="button" class="primary" data-action="claimMe" data-id="">${I('plus')}I’m new here<small>Add me as ${esc(accountName())}</small></button></div>`);
}
async function claimPerson(id,tag){
  tag=tag||await claimTag();if(!tag)return;let chosen=id;const name=id?home.people.find(p=>p.id===id)?.name:accountName();
  const ok=await mutate(h=>{
    for(const p of h.people)if(p.claim===tag)delete p.claim;
    if(id){const p=h.people.find(p=>p.id===id);if(!p)throw new Error('That flatmate is no longer in this home.');if(p.claim)throw new Error(`${p.name} is already linked to someone else’s account.`);p.claim=tag;}
    else{if(h.people.length>=30)throw new Error('This home supports up to 30 flatmates.');chosen=uid();h.people.push({id:chosen,name:accountName(),color:h.people.length%6,paused:false,awayFrom:'',awayTo:'',claim:tag});}
  },`Welcome, ${name}.`);
  if(ok){myId=chosen;persist();if($('#modal').open)$('#modal').close();render();}
}
// Signing out leaves nothing shared behind on this device: the open home, every
// remembered shared home and its key, the account and its reminders go. The
// account brings them back on the next sign-in. Personal, device-only homes stay.
async function signOut(){
  if(!account)return;const session=account.session;
  await leaveDevice(async()=>{try{window.google?.accounts.id.disableAutoSelect();await connectClient();await client.call({action:'signOut',session});}catch{}});
  toast('Signed out. Your shared homes were removed from this device; sign in to get them back.');
}
// Ends the account on this device: reminders off, the server told (serverCall), then every shared home and key forgotten.
async function leaveDevice(serverCall){
  setBusy(true);
  try{try{await forgetPush(listHomes(localStorage).filter(e=>e.mode==='shared'),true);}catch{}await serverCall();}finally{setBusy(false);}
  account=null;linked={};accountMeta=null;saveAccount();client?.close();client=null;
  for(const e of listHomes(localStorage).filter(e=>e.mode==='shared'))forgetHome(localStorage,e.id);
  try{localStorage.removeItem('flatflow-conflict-draft');}catch{}
  ({home,mode,key,revision,myId,backend}=restoreSession({getItem:()=>null},BACKEND_URL));view='expenses';syncState='Not connected';syncError='';
  history.replaceState(null,'',location.pathname);persist();if($('#modal').open)$('#modal').close();render();
}
async function loadAccountMeta(){try{await connectClient();accountMeta=await client.call({action:'accountInfo'});if(view==='account')render();}catch{accountMeta={};}}

// ---------- Phone notifications ----------
// Stops this device's reminders for the given remembered homes, telling the
// server to forget the device for each. Dropping the browser subscription too
// (on sign-out) means no home can reach this device afterwards.
async function forgetPush(entries,dropSubscription=false){
  const map=pushHomes(),mine=entries.filter(e=>e.mode==='shared'&&validKey(e.key)&&map[e.home?.id]);
  if(!('serviceWorker'in navigator)||(!mine.length&&!dropSubscription))return;
  const reg=await Promise.race([navigator.serviceWorker.getRegistration(),new Promise(r=>setTimeout(()=>r(null),3000))]),sub=await reg?.pushManager.getSubscription();
  if(sub&&mine.length){await connectClient();for(const e of mine){try{await client.call({action:'unsubscribePush',key:e.key,endpoint:sub.endpoint});}catch{}}}
  for(const e of mine)delete map[e.home.id];
  if(dropSubscription){savePushHomes({});if(sub){try{await sub.unsubscribe();}catch{}}}else savePushHomes(map);
}
// Homes this device gets reminders for, as {homeId: personId}. Older versions stored one {home, person}.
function pushHomes(){try{const saved=JSON.parse(localStorage.getItem('flatflow-push')||'null');if(!saved||typeof saved!=='object')return {};return typeof saved.home==='string'?{[saved.home]:saved.person}:saved;}catch{return {};}}
function savePushHomes(map){try{if(Object.keys(map).length)localStorage.setItem('flatflow-push',JSON.stringify(map));else localStorage.removeItem('flatflow-push');}catch{}}
function pushLabel(){try{if(pushHomes()[home.id]===myId&&myId&&'Notification'in window&&Notification.permission==='granted')return 'On for '+(home.people.find(p=>p.id===myId)?.name||'you')+' on this device.';}catch{}return 'Off on this device.';}
async function notifications(){
  if(mode!=='shared'){toast('Share this home online first.');return;}
  if(!myId){toast('First say which one is you, so Flatflow knows whose chores to remind.');return;}
  if(!('Notification'in window)||!('PushManager'in window)){await install();toast('Open the installed app to turn on notifications.',true);return;}
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){toast('Allow notifications in your browser or phone settings, then try again.',true);return;}
  setBusy(true);try{
    await connectClient();const config=await client.call({action:'pushConfig',key});
    if(!config.enabled||!config.publicKey)throw new Error('The notification service is not ready yet.');
    const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
    if(!sub){const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});}
    await client.call({action:'subscribePush',key,person:myId,endpoint:sub.endpoint,keys:sub.toJSON().keys});
    savePushHomes({...pushHomes(),[home.id]:myId});render();toast('Notifications are on. Send yourself a test.');
  }finally{setBusy(false);}
}
async function testPush(){if(mode!=='shared'||!myId||!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Turn on notifications first.');const sub=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(!sub)throw new Error('Turn on notifications first.');await connectClient();await client.call({action:'testPush',key,endpoint:sub.endpoint});toast('Test sent. Check your phone’s notifications.');}
// Turns off reminders for the open home only. The browser subscription is
// kept while other homes on this device still use it.
async function disablePush(){if(!('serviceWorker'in navigator))return;const map=pushHomes();delete map[home.id];const sub=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(sub){if(mode==='shared'){await connectClient();try{await client.call({action:'unsubscribePush',key,endpoint:sub.endpoint});}catch(err){if(!/Enable notifications/.test(err.message))throw err;}}if(!Object.keys(map).length)await sub.unsubscribe();}savePushHomes(map);render();toast('Notifications are off on this device.');}
// Devices that enabled reminders before expense notifications existed only
// registered their address. Send the encryption keys once so they get them too.
let pushKeysShared=false;
async function sharePushKeys(){
  if(pushKeysShared||mode!=='shared'||!myId||pushHomes()[home.id]!==myId||!('serviceWorker'in navigator))return;pushKeysShared=true;
  try{const sub=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(sub)await client.call({action:'subscribePush',key,person:myId,endpoint:sub.endpoint,keys:sub.toJSON().keys});}catch{}
}
async function install(){if(deferredInstall){await deferredInstall.prompt();const r=await deferredInstall.userChoice;if(r.outcome==='accepted')toast('Flatflow is on your home screen.');deferredInstall=null;}else{sheet=null;dialog('Install Flatflow','Flatflow works as an app on your phone, with notifications.',`<p class="summary"><b>iPhone / iPad</b><br>Open this page in Safari. Tap Share, then Add to Home Screen.</p><p class="summary"><b>Android</b><br>Open this page in Chrome. Tap the menu, then Install app or Add to Home screen.</p><p class="summary"><b>Computer</b><br>Use your browser’s Install button or menu when available.</p>`,'Got it',async()=>$('#modal').close());}}

// ---------- Invitations ----------
function joinLink(){sheet=null;dialog('Join a home','Enter the invite code or paste the invitation link your flatmate sent you.','<label class="field big">Invite code or link<input name="invite" type="text" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7M2-QX9P or https://…"></label>','Join',async f=>{const value=String(f.get('invite')).trim(),code=normalizeCode(value);let k=validKey(value)?value:new URLSearchParams(value.split('#')[1]||'').get('home');
  if(code&&!validKey(k)){backend=backend||BACKEND_URL;await connectClient();const r=await client.call({action:'redeemInvite',invite:await inviteId(code)}).catch(err=>{throw new Error(/Unsupported|Invalid household/.test(err.message)?'Invite codes aren’t switched on yet. Ask for the invitation link instead.':err.message);});k=await openKey(r.sealed,code);}
  if(!validKey(k))throw new Error('Enter an 8-character invite code or paste a complete Flatflow invitation link.');if(code)history.replaceState(null,'','#'+new URLSearchParams({home:k}));else location.hash=new URLSearchParams({home:k}).toString();await handleInvitation(!!code);});
  setTimeout(()=>$('#dialog-form [name=invite]')?.focus(),50);}
async function handleInvitation(confirmed=false){
 const params=new URLSearchParams(location.hash.slice(1));if(!params.has('home'))return;
 const invitedKey=params.get('home');if(!validKey(invitedKey)){toast('This invitation is invalid. Ask your flatmate for a new link.',true);return;}
 if(mode==='shared'&&key===invitedKey){if(syncState!=='Synced'){syncState='Connecting…';render();}await refresh(true);if($('#modal').open)$('#modal').close();return;}
 const join=async()=>{
 rememberCurrent();setBusy(true);try{await connectClient();const r=await client.call({action:'read',key:invitedKey,revision:-1});const joined=validateHome(r.home);home=joined;key=invitedKey;revision=r.revision;mode='shared';myId='';syncState='Synced';persist();$('#modal').close();view='expenses';render();if(account)setTimeout(identify,50);else toast(`You’re in ${home.name}. Pick your name to get started.`);}finally{setBusy(false);}};
 // Someone who typed an invite code has already said yes.
 if(confirmed)return join();
 sheet=null;
 dialog('Join this home?','Your flatmates invited you. You’ll see the same chores, expenses and balances as everyone else.',mode!=='welcome'?`<p class="note">${esc(home.name)} stays in your homes, so you can switch back any time.</p>`:'','Join',join);
}

// ---------- Actions ----------
const actions={
  tab:v=>go(v),go:v=>go(v),back:()=>{if(PARENT[view]&&history.state?.view===view)history.back();else go(PARENT[view]||'expenses');},
  retryAuth:()=>{authInfo=null;render();loadAuthConfig();},
  signOutAll:()=>{sheet=null;dialog('Sign out everywhere?','Every phone and computer signed in to your account, including this one, will need to sign in again.','','Sign out everywhere',async()=>{const session=account.session;await leaveDevice(async()=>{try{await connectClient();await client.call({action:'signOutAll',session});}catch{}});toast('Signed out everywhere.');});},
  deleteAccount:()=>{sheet=null;dialog('Delete your account?','Your sign-ins and the list of your homes are deleted. The homes themselves stay with your flatmates, including expenses you are part of; your name in them stays so balances still add up. This cannot be undone.',`<label class="field">Type DELETE to confirm<input name="confirm" autocomplete="off" required></label>`,'Delete my account',async f=>{if(String(f.get('confirm')).trim()!=='DELETE')throw new Error('Type DELETE to confirm.');const session=account.session;await connectClient();await client.call({action:'deleteAccount',session});await leaveDevice(async()=>{});toast('Your account is deleted.');});},
  // Removes the open shared home from Flatflow's server for every flatmate, after a clear warning.
  deleteHome:()=>{if(mode!=='shared')return;sheet=null;dialog(`Delete ${esc(home.name)} for everyone?`,'This removes the home, its chores, expenses, shopping list, invite codes and reminders from Flatflow’s server, for every flatmate. It cannot be undone.',`<p class="note">Export a backup first if anyone might want the history.</p><button class="btn secondary block" type="button" data-action="export">${I('download')}Export backup first</button>`,'Delete for everyone',async()=>{
    setBusy(true);try{await connectClient();await client.call({action:'deleteHome',key}).catch(err=>{throw new Error(/Unsupported/.test(err.message)?'Deleting homes arrives with the next backend update. Try again later.':err.message);});}finally{setBusy(false);}
    $('#modal').close();await actions.dropMissing('Deleted. This home is gone for everyone.');});},
  theme:setTheme,inviteCode,copyCode:async code=>{try{await navigator.clipboard.writeText(code);toast('Code copied.');}catch{toast('Code: '+code);}},joinLink,signOut,homes:homesDialog,switchHome,forgetHome:forgetHomeDialog,homeDetails,notificationsSheet,
  chooseMe:()=>{if(!home.people.length){personForm();return;}sheet=null;dialog('Which one is you?','Saved on this device. It sets your chores, your balance and your reminders.',`<div class="menu">${home.people.map(p=>`<button type="button" data-action="setMe" data-id="${esc(p.id)}">${avatar(p)}${esc(p.name)}${p.id===myId?'<small>Current</small>':''}</button>`).join('')}</div>`);},
  setMe:async id=>{try{if(myId&&myId!==id&&pushHomes()[home.id])await disablePush();myId=id;persist();$('#modal').open&&$('#modal').close();render();toast(`Hi ${home.people.find(p=>p.id===id)?.name||''}. This device now knows it’s you.`);}catch(err){toast(err.message,true);}},
  expenseMenu,settleUp:settleSheet,balances:balancesSheet,fairShare:fairShareSheet,chore:choreSheet,
  toggleSearch:()=>{searchOpen=!searchOpen;if(!searchOpen){expenseSearch='';expenseFilter='all';}render.focusSearch=searchOpen;render();},
  choreFilter:f=>{choreFilter=f;render();},
  claimMe:id=>claimPerson(id||''),switchMe:()=>whoDialog(home.people.filter(p=>!p.claim||p.id===myId).filter(p=>p.id!==myId)),
  // The server no longer has this home (for example after a reset), so forget it here and in the account.
  dropMissing:async(message='Removed. Start a new home or join one with a code.')=>{const id=homeEntryId({home,mode,key}),gone=key;rememberCurrent();try{await forgetPush(listHomes(localStorage).filter(e=>e.key===gone));}catch{}if(account){try{await connectClient();applyAccount(await client.call({action:'unlinkHome',session:account.session,key:gone}));}catch{}}
    forgetHome(localStorage,id);({home,mode,key,revision,myId,backend}=restoreSession({getItem:()=>null},BACKEND_URL));client?.close();client=null;syncError='';history.replaceState(null,'',location.pathname);
    const next=listHomes(localStorage).filter(e=>e.key!==gone).at(-1);if(next)switchHome(next.id);else{persist();render();}toast(String(message));},
  deletePerson:id=>{const p=home.people.find(p=>p.id===id);if(!p)return;sheet=null;dialog('Remove '+esc(p.name)+'?','They leave the home and every chore rotation. Past activity stays.','','Remove',async()=>{if(await mutate(h=>removePerson(h,id),'Flatmate removed')){if(myId===id){myId='';persist();}$('#modal').close();render();}});},
  close:()=>$('#modal').close(),addPerson:()=>personForm(),editPerson:id=>personForm(id),addTask:()=>taskForm(),editTask:id=>taskForm(id),share:shareHome,newHome,connect:connectionDialog,reconnect:async()=>{try{syncState='Connecting…';render();await connectClient();await refresh(true);if(syncState==='Synced')toast('Back in sync.');else if(syncError)toast(syncError,true);}catch(err){syncError=err.message;syncState='Connection needs attention';render();toast(err.message,true);}},
  addExpense:()=>expenseForm(),
  removeItem:id=>mutate(h=>{h.shopping=(h.shopping||[]).filter(i=>i.id!==id);},'Removed from the list'),
  clearBought:()=>mutate(h=>{h.shopping=(h.shopping||[]).filter(i=>!i.done);},'Bought items cleared'),
  logShopping:()=>{const bought=(home.shopping||[]).filter(i=>i.done),ids=new Set(bought.map(i=>i.id));expenseForm(false,{title:('Shopping: '+bought.map(i=>i.item).join(', ')).slice(0,100),message:'Shopping logged',apply:h=>{h.shopping=(h.shopping||[]).filter(i=>!ids.has(i.id));}});},addBill:()=>expenseForm(true),
  billMenu:id=>{const b=(home.bills||[]).find(b=>b.id===id);if(!b)return;sheet=null;dialog(esc(b.title),`${money(b.amount)} paid by ${esc(personName(b.paidBy))}. Next due ${dateLabel(b.due)}.`,`<div class="menu"><button type="button" data-action="pauseBill" data-id="${esc(id)}" data-mutate>${I(b.paused?'play':'pause')}${b.paused?'Resume':'Pause'} this bill</button><button type="button" class="danger" data-action="deleteBill" data-id="${esc(id)}" data-mutate>${I('trash')}Stop this bill</button></div><p class="note">Expenses already logged stay. To change the amount, stop this bill and add a new one.</p>`);},
  pauseBill:async id=>{if(await mutate(h=>{const b=h.bills.find(b=>b.id===id);b.paused=!b.paused;if(!b.paused&&b.due<iso()){b.due=iso();b.anchorDay=date(b.due).getDate();}record(h,'expense',`${b.title} ${b.paused?'paused':'resumed'}`);},'Bill updated'))$('#modal').close();},
  deleteBill:async id=>{if(await mutate(h=>{const b=h.bills.find(b=>b.id===id);h.bills=h.bills.filter(x=>x.id!==id);record(h,'expense',`${b.title} will no longer repeat`);},'Bill stopped'))$('#modal').close();},splitwise:splitwiseImport,
  settle:arg=>{const [from,to,amount,cur]=String(arg).split('|');paymentDialog(from,to,Number(amount),cur||home.currency||'EUR');},recordPayment:()=>paymentDialog(myId||home.people[0]?.id,home.people.find(p=>p.id!==myId)?.id,0,home.currency||'EUR'),remind,
  expenseDetail,editExpense:id=>expenseForm(false,{},id),exportExpenses,expenseFilter:id=>{expenseFilter=expenseFilter===id&&id!=='all'?'all':id;render();},spending:id=>{spendingMine=id==='mine';render();},
  deleteExpense:id=>{const e=(home.expenses||[]).find(e=>e.id===id);if(!e)return;sheet=null;dialog('Delete this expense?',`${esc(e.kind==='settle'?'This payment':e.title)} (${money(e.amount,expenseCurrency(home,e))}) will be removed and balances recalculated.`,'','Delete',async()=>{if(await mutate(h=>removeExpense(h,id),'Expense deleted'))$('#modal').close();});},
  clearExpenses:()=>{sheet=null;dialog('Clear settled expenses?','Everyone is settled up, so the list can be cleared to keep your home light. Export first to keep a record.','<button type="button" class="link" data-action="exportExpenses">Export expenses first</button>','Clear',async()=>{if(await mutate(h=>clearSettledExpenses(h),'Settled expenses cleared'))$('#modal').close();});},
  done:async id=>{const t=home.tasks.find(t=>t.id===id);if(await mutate(h=>complete(h,id),'Done')){const next=assignee(home.tasks.find(x=>x.id===id)||t,home.people);if(next)toast(`${t.title} done. Next: ${next.id===myId?'you':next.name}, ${dayName(home.tasks.find(x=>x.id===id).due).toLowerCase()}.`);if($('#modal').open&&sheet)$('#modal').close();}},
  skip:id=>{sheet=null;dialog('Pass this turn','The due date stays the same and the next available person takes it.',`<label class="field">Reason<input name="reason" maxlength="200" placeholder="Optional, e.g. away this weekend"></label>`,'Pass',async f=>{if(await mutate(h=>skip(h,id,f.get('reason')),'Turn passed'))$('#modal').close();});},
  snooze:id=>{const t=home.tasks.find(t=>t.id===id);sheet=null;dialog('Postpone','Move this occurrence. The same person keeps the turn.',`<label class="field">New due date<input name="due" type="date" value="${addDays(t.due<iso()?iso():t.due,1)}" min="${iso()}" required></label>`,'Postpone',async f=>{if(await mutate(h=>{const target=h.tasks.find(t=>t.id===id);target.due=f.get('due');target.anchorDay=date(target.due).getDate();record(h,'snooze',`${target.title} moved to ${dateLabel(target.due)}`);},'Chore postponed'))$('#modal').close();});},
  reassign:id=>{const t=home.tasks.find(t=>t.id===id);sheet=null;dialog('Give this turn to someone else','After they finish, the rotation continues from their place.',`<label class="field">Who takes it<select name="person">${t.order.map(id=>home.people.find(p=>p.id===id)).filter(p=>p&&!away(p,t.due)).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>`,'Reassign',async f=>{if(await mutate(h=>{const target=h.tasks.find(t=>t.id===id);const i=target.order.indexOf(f.get('person'));if(i<0)throw new Error('Choose an available person in this rotation.');target.turn=i;record(h,'assign',`${target.title} assigned to ${h.people.find(p=>p.id===f.get('person')).name}`);},'Turn reassigned'))$('#modal').close();});},
  pauseTask:async id=>{if(await mutate(h=>{const t=h.tasks.find(t=>t.id===id);t.paused=!t.paused;record(h,'task',`${t.title} ${t.paused?'paused':'resumed'}`);},'Chore updated'))$('#modal').close();},
  deleteTask:id=>{const t=home.tasks.find(t=>t.id===id);sheet=null;dialog('Delete this chore?',`${esc(t.title)} leaves the rotation. Its past activity stays.`,'','Delete',async()=>{if(await mutate(h=>{h.tasks=h.tasks.filter(t=>t.id!==id);record(h,'task',`${t.title} removed from the routine`);},'Chore deleted'))$('#modal').close();});},
  copyInvite:async()=>{try{await navigator.clipboard.writeText(invitation());toast('Invitation copied. Send it to your flatmates.');}catch{$('#invite-url')?.select();toast('Select and copy the invitation link.');}},
  nativeShare:async()=>{try{await navigator.share({title:'Join our Flatflow home',text:`Join ${home.name} on Flatflow to share chores and costs.`,url:invitation()});}catch(err){if(err.name!=='AbortError')toast('Copy the invitation instead.');}},
  trimActivity:()=>{sheet=null;dialog('Clear older activity','Keeps the latest 30 entries and removes older ones. Export a backup first to keep the full history.','<button type="button" class="link" data-action="export">Export a backup first</button>','Clear',async()=>{if(await mutate(h=>{h.history=h.history.slice(0,30);},'Older activity cleared'))$('#modal').close();});},
  export:exportHome,import:importHome,exportDraft:()=>{const d=localStorage.getItem('flatflow-conflict-draft');if(d)download(d,'flatflow-attempted-change.json');},calendar:calendarDialog,notifications,install,testPush,disablePush,
  prevWeek:()=>{weekOffset=Math.max(0,weekOffset-1);render();},nextWeek:()=>{weekOffset=Math.min(12,weekOffset+1);render();},thisWeek:()=>{weekOffset=0;monthOffset=0;render();},
  prevMonth:()=>{monthOffset=Math.max(0,monthOffset-1);render();},nextMonth:()=>{monthOffset=Math.min(5,monthOffset+1);render();},scheduleMode:m=>{scheduleMode=m;render();}
};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled)return;try{await actions[b.dataset.action]?.(b.dataset.id);}catch(err){toast(err.message,true);}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
window.addEventListener('online',()=>refresh(true));window.addEventListener('offline',()=>{if(mode==='shared'){syncState='Offline';render();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh(true);});
window.addEventListener('storage',e=>{if(e.key===STORAGE&&!busy){try{const saved=JSON.parse(e.newValue);if(saved&&saved.home.id===home.id&&saved.key===key&&saved.revision>=revision){home=validateHome(saved.home);revision=saved.revision;myId=saved.myId||'';render();}}catch{}}});
if('serviceWorker'in navigator){
  // When a new version takes over, reload once so the phone never keeps running old code.
  const hadController=!!navigator.serviceWorker.controller;let reloaded=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(hadController&&!reloaded&&!$('#modal')?.open){reloaded=true;location.reload();}});
  navigator.serviceWorker.register('./sw.js').then(r=>{registration=r;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')r?.update().catch(()=>{});});}).catch(()=>{});
}
if(mode!=='shared')rollOver(home);render();persist();
loadAuthConfig();
window.addEventListener('hashchange',()=>{if(gated())render();else handleInvitation();});
setInterval(()=>{refresh();if(mode!=='shared'){if(rollOver(home)){persist();render();}}},30000);
