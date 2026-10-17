export const uid = () => crypto.randomUUID();
export const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const date = s => new Date(`${s}T12:00:00`);
export const addDays = (s,n) => { const d=date(s);d.setDate(d.getDate()+n);return iso(d); };
export function nextDue(t) {
  if(t.unit !== 'month') return addDays(t.due,t.every*(t.unit==='week'?7:1));
  const d=date(t.due), day=t.anchorDay||d.getDate();
  d.setDate(1);d.setMonth(d.getMonth()+t.every);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(day,last));return iso(d);
}
export const away = (p,on=iso()) => !!(p && (p.paused || (p.awayFrom && p.awayTo && on>=p.awayFrom && on<=p.awayTo)));
export function assignee(t,people,on=t.due) {
  for(let i=0;i<t.order.length;i++){
    const id=t.order[(t.turn+i)%t.order.length], p=people.find(x=>x.id===id);
    if(p&&!away(p,on))return p;
  }
  return null;
}
export function advance(t,people,on=t.due) {
  const p=assignee(t,people,on);
  t.turn=p?(t.order.indexOf(p.id)+1)%t.order.length:(t.turn+1)%Math.max(1,t.order.length);
}
export const emptyHome = name => ({schema:1,id:uid(),name:name||'Our happy place',people:[],tasks:[],history:[],created: new Date().toISOString()});
export function demoHome(){
  const h=emptyHome('The Sunday Club');
  h.people=['Alex','Jamie','Sam','Taylor'].map((name,i)=>({id:uid(),name,color:i,paused:false,awayFrom:'',awayTo:''}));
  h.tasks=[['Kitchen reset','Kitchen','🍳',20,1,'day',0],['Take out the recycling','Whole home','♻️',10,1,'week',0],['Bathroom sparkle','Bathroom','🫧',25,1,'week',1],['Vacuum the living room','Living room','🧹',15,1,'week',2],['Water the plants','Living room','🌿',5,3,'day',3],['Deep-clean the fridge','Kitchen','🧊',30,1,'month',5]].map((a,i)=>({id:uid(),title:a[0],area:a[1],icon:a[2],minutes:a[3],every:a[4],unit:a[5],due:addDays(iso(),a[6]),anchorDay:date(addDays(iso(),a[6])).getDate(),order:h.people.map(p=>p.id),turn:i%4,notes:'',paused:false}));
  return h;
}
export function validateHome(h){
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  if(h&&h.currency!==undefined&&(typeof h.currency!=='string'||!/^[A-Z]{3}$/.test(h.currency)))fail();
  if(!h||h.schema!==1||typeof h.id!=='string'||typeof h.name!=='string'||!h.name.trim()||h.name.length>80||!Array.isArray(h.people)||!Array.isArray(h.tasks)||!Array.isArray(h.history)||h.people.length>30||h.tasks.length>100||h.history.length>200)fail();
  const validDate = s => typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(date(s))&&iso(date(s))===s;
  const ids=new Set();
  for(const p of h.people){if(!p||typeof p.id!=='string'||ids.has(p.id)||!/^[\w-]{1,80}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||!Number.isInteger(p.color)||p.color<0||p.color>5||typeof p.paused!=='boolean'||(p.awayFrom&&!validDate(p.awayFrom))||(p.awayTo&&!validDate(p.awayTo))||(p.awayFrom&&p.awayTo&&p.awayTo<p.awayFrom))fail();ids.add(p.id);}
  const taskIds=new Set();
  for(const t of h.tasks){if(!t||typeof t.id!=='string'||!/^[\w-]{1,80}$/.test(t.id)||taskIds.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>100||typeof t.area!=='string'||t.area.length>60||typeof t.icon!=='string'||t.icon.length>16||typeof t.notes!=='string'||t.notes.length>1000||typeof t.paused!=='boolean'||!Number.isInteger(t.every)||t.every<1||t.every>365||!['day','week','month'].includes(t.unit)||!validDate(t.due)||!Number.isInteger(t.anchorDay)||t.anchorDay<1||t.anchorDay>31||!Number.isInteger(t.minutes)||t.minutes<1||t.minutes>600||!Array.isArray(t.order)||new Set(t.order).size!==t.order.length||!t.order.length||t.order.some(id=>!ids.has(id))||!Number.isInteger(t.turn)||t.turn<0||t.turn>=t.order.length)fail();taskIds.add(t.id);}
  for(const e of h.history){if(!e||typeof e.id!=='string'||typeof e.text!=='string'||e.text.length>500||typeof e.at!=='string'||isNaN(Date.parse(e.at))||typeof e.kind!=='string'||typeof e.person!=='string'||typeof e.task!=='string'||!Number.isFinite(e.minutes)||e.minutes<0||e.minutes>600)fail();}
  validateExpenses(h,validDate);
  if(JSON.stringify(h).length>40000)throw new Error('This home is too large. Export a backup and clear older activity first.');
  return h;
}
export function record(h,kind,text,person='',task='',minutes=0){h.history.unshift({id:uid(),kind,text,person,task,minutes,at:new Date().toISOString()});h.history=h.history.slice(0,200);}
export function complete(h,id){const t=h.tasks.find(t=>t.id===id);if(!t||t.paused)throw new Error('This task is unavailable.');const p=assignee(t,h.people);if(!p)throw new Error('Everyone in this rotation is away. Edit the task to add someone available.');record(h,'done',`${p.name} completed ${t.title}`,p.id,t.id,t.minutes);advance(t,h.people);t.due=nextDue(t);}
// A turn lasts until the next scheduled occurrence. Unfinished turns expire
// at that boundary, so daily/weekly/monthly rotations continue automatically.
export function rollOver(h,today=iso()){
  let changed=false;
  for(const t of h.tasks.filter(t=>!t.paused)){
    let n=0;
    while(nextDue(t)<=today){
      if(++n>50000)throw new Error('This chore starts too far in the past. Choose a recent due date.');
      const p=assignee(t,h.people);
      if(n<=200)record(h,'missed',`${t.title} was not completed for ${t.due}${p?' · '+p.name:''}`,p?.id||'',t.id);
      advance(t,h.people);t.due=nextDue(t);changed=true;
    }
  }
  return postDueBills(h,today)||changed;
}
export function skip(h,id,reason){const t=h.tasks.find(t=>t.id===id),p=t&&assignee(t,h.people);if(!p)throw new Error('No one is available for this task.');const other=t.order.filter(id=>id!==p.id).find(id=>{const x=h.people.find(p=>p.id===id);return x&&!away(x,t.due);});if(!other)throw new Error('Add another available person before passing this turn.');advance(t,h.people);record(h,'skip',`${p.name} passed ${t.title}${reason?`: ${reason}`:''}`,p.id,t.id);}
export function schedule(h,days=35){const result=[],end=addDays(iso(),days);for(const original of h.tasks.filter(t=>!t.paused)){const t=structuredClone(original);for(let i=0;i<400&&t.due<=end;i++){const p=assignee(t,h.people);result.push({task:t.id,title:t.title,icon:t.icon,area:t.area,due:t.due,person:p,minutes:t.minutes});advance(t,h.people);t.due=nextDue(t);}}return result.sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title));}
const icsEscape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function calendar(h,person=''){
  const events=schedule(h,60).filter(e=>e.due>=iso()&&(!person||e.person?.id===person));
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flatflow//Household chores//EN','CALSCALE:GREGORIAN',...events.flatMap(e=>['BEGIN:VEVENT',`UID:${h.id}-${e.task}-${e.due}@flatflow`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${e.due.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays(e.due,1).replaceAll('-','')}`,`SUMMARY:${icsEscape(e.title+' · '+(e.person?.name||'Unassigned'))}`,`DESCRIPTION:${icsEscape('Flatflow chore. '+e.minutes+' minutes. Schedule snapshot: re-export after changes.')}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(e.title)}`,'TRIGGER:PT9H','END:VALARM','END:VEVENT']),'END:VCALENDAR'].join('\r\n')+'\r\n';
}

export function removePerson(h,id){
  const person=h.people.find(p=>p.id===id);if(!person)throw new Error('This flatmate no longer exists.');
  const solo=h.tasks.filter(t=>t.order.length===1&&t.order[0]===id);
  if(solo.length)throw new Error('Reassign these chores before deleting this flatmate: '+solo.map(t=>t.title).join(', '));
  if(currenciesInUse(h).some(c=>expenseBalances(h,c)[id]))throw new Error('Settle up with '+person.name+' before deleting them.');
  for(const t of h.tasks){if(!t.order.includes(id))continue;const current=assignee(t,h.people)?.id;const next=t.order[(t.order.indexOf(id)+1)%t.order.length];t.order=t.order.filter(x=>x!==id);t.turn=Math.max(0,t.order.indexOf(current&&current!==id?current:next));}
  h.people=h.people.filter(p=>p.id!==id);record(h,'person',person.name+' left the home');
}

// Shared expenses. Amounts are integer cents; each expense stores the exact
// share owed by every participant, so balances never drift from rounding.
// Settlements are expenses of kind 'settle': the payer is owed back by the receiver.
// Optional fields: payers {id:cents} when several people paid (paidBy is then the
// biggest payer), currency when it differs from the home's, notes and comments.
// A home may set simplify:false to settle person to person, and expensesOnly:true
// for a group or trip without chores.
function validateExpenses(h,validDate){
  validateBills(h,validDate);validateShopping(h);
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  if((h.simplify!==undefined&&typeof h.simplify!=='boolean')||(h.expensesOnly!==undefined&&typeof h.expensesOnly!=='boolean'))fail();
  if(h.expenses===undefined)return;
  const validId=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id),ids=new Set();
  const validSplit=(o,amount)=>{if(!o||typeof o!=='object'||Array.isArray(o))return false;const v=Object.entries(o);return v.length>0&&v.length<=30&&v.every(([id,n])=>validId(id)&&Number.isInteger(n)&&n>=0)&&v.reduce((n,[,x])=>n+x,0)===amount;};
  if(!Array.isArray(h.expenses)||h.expenses.length>100)fail();
  for(const e of h.expenses){
    if(!e||!validId(e.id)||ids.has(e.id)||!['expense','settle'].includes(e.kind)||typeof e.title!=='string'||!e.title.trim()||e.title.length>100||typeof e.category!=='string'||e.category.length>30||!validDate(e.spentOn)||!validId(e.paidBy)||!Number.isInteger(e.amount)||e.amount<1||e.amount>100000000||!validSplit(e.shares,e.amount))fail();
    if(e.payers!==undefined&&(!validSplit(e.payers,e.amount)||!(e.payers[e.paidBy]>0)))fail();
    if(e.currency!==undefined&&(typeof e.currency!=='string'||!/^[A-Z]{3}$/.test(e.currency)))fail();
    if(e.notes!==undefined&&(typeof e.notes!=='string'||e.notes.length>500))fail();
    if(e.comments!==undefined&&(!Array.isArray(e.comments)||e.comments.length>20||e.comments.some(c=>!c||!validId(c.id)||typeof c.by!=='string'||c.by.length>80||typeof c.text!=='string'||!c.text.trim()||c.text.length>300||typeof c.at!=='string'||isNaN(Date.parse(c.at)))))fail();
    ids.add(e.id);
  }
}
// Splits cents by weight with the largest-remainder method; ties go to earlier people.
export function splitAmount(amount,weights){
  const entries=Object.entries(weights).filter(([,w])=>w>0),total=entries.reduce((n,[,w])=>n+w,0);
  if(!Number.isInteger(amount)||amount<1)throw new Error('Enter an amount above zero.');
  if(!entries.length||!(total>0))throw new Error('Choose at least one flatmate to split with.');
  const parts=entries.map(([id,w],i)=>{const exact=amount*w/total;return {id,i,cents:Math.floor(exact),rest:exact-Math.floor(exact)};});
  let left=amount-parts.reduce((n,p)=>n+p.cents,0);
  for(const p of parts.slice().sort((a,b)=>b.rest-a.rest||a.i-b.i)){if(!left)break;p.cents++;left--;}
  return Object.fromEntries(parts.map(p=>[p.id,p.cents]));
}
export const paidShares=e=>e.payers||{[e.paidBy]:e.amount};
export const expenseCurrency=(h,e)=>e.currency||h.currency||'EUR';
// Every currency with expenses, the home's own first.
export function currenciesInUse(h){const home=h.currency||'EUR',set=new Set((h.expenses||[]).map(e=>expenseCurrency(h,e)));set.delete(home);return [home,...[...set].sort()];}
// Positive: the flatmate is owed money. Negative: they owe the household.
export function expenseBalances(h,currency=h.currency||'EUR'){
  const net={};
  for(const e of h.expenses||[]){if(expenseCurrency(h,e)!==currency)continue;for(const [id,v] of Object.entries(paidShares(e)))net[id]=(net[id]||0)+v;for(const [id,v] of Object.entries(e.shares))net[id]=(net[id]||0)-v;}
  for(const id of Object.keys(net))if(!net[id])delete net[id];
  return net;
}
// Who owes whom without simplifying: each share is owed to whoever paid,
// split between several payers in proportion to what they paid.
export function pairwiseDebts(h,currency=h.currency||'EUR'){
  const pair={};
  const add=(from,to,v)=>{if(from===to||!v)return;const [a,b]=from<to?[from,to]:[to,from],k=a+'|'+b;pair[k]=(pair[k]||0)+(from===a?v:-v);};
  for(const e of h.expenses||[]){if(expenseCurrency(h,e)!==currency)continue;const payers=paidShares(e);for(const [id,v] of Object.entries(e.shares)){if(!v)continue;const parts=Object.keys(payers).length===1?{[e.paidBy]:v}:splitAmount(v,payers);for(const [to,x] of Object.entries(parts))add(id,to,x);}}
  return Object.entries(pair).filter(([,v])=>v).map(([k,v])=>{const [a,b]=k.split('|');return v>0?{from:a,to:b,amount:v}:{from:b,to:a,amount:-v};}).sort((x,y)=>y.amount-x.amount||x.from.localeCompare(y.from));
}
// Greedy debt simplification: at most n-1 payments, largest debts first.
// Homes that turned simplifying off settle person to person instead.
export function settlements(h,currency=h.currency||'EUR'){
  if(h.simplify===false)return pairwiseDebts(h,currency);
  const net=expenseBalances(h,currency),owe=[],owed=[];
  for(const [id,v] of Object.entries(net))(v<0?owe:owed).push({id,v:Math.abs(v)});
  owe.sort((a,b)=>b.v-a.v||a.id.localeCompare(b.id));owed.sort((a,b)=>b.v-a.v||a.id.localeCompare(b.id));
  const result=[];let i=0,j=0;
  while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i].v,owed[j].v);result.push({from:owe[i].id,to:owed[j].id,amount});owe[i].v-=amount;owed[j].v-=amount;if(!owe[i].v)i++;if(!owed[j].v)j++;}
  return result;
}
const moneyText=(cur,c)=>`${cur} ${(c/100).toFixed(2)}`;
// Normalises the optional fields shared by new and edited expenses.
function expenseFields(h,e){
  const people=new Set(h.people.map(p=>p.id)),payers=e.payers&&Object.keys(e.payers).filter(id=>e.payers[id]>0).length>1?Object.fromEntries(Object.entries(e.payers).filter(([,v])=>v>0)):null;
  const paidBy=payers?Object.entries(payers).sort((a,b)=>b[1]-a[1])[0][0]:e.paidBy;
  if(!people.has(paidBy)||Object.keys(e.shares).some(id=>!people.has(id))||(payers&&Object.keys(payers).some(id=>!people.has(id))))throw new Error('Choose current flatmates for this expense.');
  if(payers&&Object.values(payers).reduce((n,v)=>n+v,0)!==e.amount)throw new Error('What each person paid must add up to the total.');
  const out={paidBy,amount:e.amount,shares:e.shares};
  if(payers)out.payers=payers;
  if(e.currency&&e.currency!==(h.currency||'EUR'))out.currency=e.currency;
  if(e.notes&&e.notes.trim())out.notes=e.notes.trim().slice(0,500);
  return out;
}
export function addExpense(h,e){
  h.expenses=h.expenses||[];
  const fields=expenseFields(h,e);
  compactExpenses(h);
  const expense={id:uid(),kind:e.kind||'expense',title:e.title,category:e.category||'',spentOn:e.spentOn,...fields};
  h.expenses.unshift(expense);
  const payer=h.people.find(p=>p.id===expense.paidBy).name,cents=moneyText(expenseCurrency(h,expense),e.amount);
  if(expense.kind==='settle')record(h,'settle',`${payer} paid ${h.people.find(p=>p.id===Object.keys(e.shares)[0]).name} ${cents}`,expense.paidBy);
  else record(h,'expense',`${expense.payers?payer+' and others':payer} paid ${cents} for ${e.title}`,expense.paidBy);
  return expense;
}
// Edits keep the expense's id and comments.
export function editExpense(h,id,e){
  const i=(h.expenses||[]).findIndex(x=>x.id===id);if(i<0)throw new Error('This expense no longer exists.');
  const old=h.expenses[i];
  h.expenses[i]={id,kind:old.kind,title:e.title,category:e.category||'',spentOn:e.spentOn,...expenseFields(h,e),...(old.comments?{comments:old.comments}:{})};
  record(h,'expense',`${e.title} was edited`);
  return h.expenses[i];
}
export function addComment(h,id,by,text){
  const e=(h.expenses||[]).find(x=>x.id===id);if(!e)throw new Error('This expense no longer exists.');
  text=String(text||'').trim();if(!text)throw new Error('Write a comment first.');if(text.length>300)throw new Error('Keep comments under 300 characters.');
  e.comments=[...(e.comments||[]),{id:uid(),by:by||'',text,at:new Date().toISOString()}].slice(-20);
}
export function removeExpense(h,id){
  const e=(h.expenses||[]).find(e=>e.id===id);if(!e)throw new Error('This expense no longer exists.');
  h.expenses=h.expenses.filter(x=>x.id!==id);record(h,'expense',`${e.title} was removed from expenses`);
}
// Once everyone is square, old expenses can be cleared to keep the household small.
export function clearSettledExpenses(h){
  if(currenciesInUse(h).some(c=>Object.keys(expenseBalances(h,c)).length))throw new Error('Settle every balance before clearing expenses.');
  const n=(h.expenses||[]).length;h.expenses=[];record(h,'expense',`${n} settled expense${n===1?'':'s'} cleared`);
}
// When the expense list is full, the 30 oldest expenses are folded into a few
// "Earlier balances" entries with the same net effect, so balances stay exact.
// Also runs when the home nears the size limit for one home.
function compactExpenses(h){
  while(h.expenses.length>30&&(h.expenses.length>=100||JSON.stringify(h).length>34000))foldOldest(h);
}
function foldOldest(h){
  const old=h.expenses.slice(-30),carried=[],day=old.map(e=>e.spentOn).sort().pop();
  for(const currency of new Set(old.map(e=>expenseCurrency(h,e)))){
    const net={};
    for(const e of old){if(expenseCurrency(h,e)!==currency)continue;for(const [id,v] of Object.entries(paidShares(e)))net[id]=(net[id]||0)+v;for(const [id,v] of Object.entries(e.shares))net[id]=(net[id]||0)-v;}
    const owe=[],owed=[];for(const [id,v] of Object.entries(net))if(v)(v<0?owe:owed).push({id,v:Math.abs(v)});
    owe.sort((a,b)=>b.v-a.v);owed.sort((a,b)=>b.v-a.v);let i=0,j=0;
    while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i].v,owed[j].v);carried.push({id:uid(),kind:'expense',title:'Earlier balances',category:'Carried over',spentOn:day,paidBy:owed[j].id,amount,shares:{[owe[i].id]:amount},...(currency!==(h.currency||'EUR')?{currency}:{})});owe[i].v-=amount;owed[j].v-=amount;if(!owe[i].v)i++;if(!owed[j].v)j++;}
  }
  h.expenses=h.expenses.slice(0,-30).concat(carried);
}
// Recurring bills (rent, internet…) post a normal expense each time they fall due.
function validateBills(h,validDate){
  if(h.bills===undefined)return;
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  const validId=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id),ids=new Set();
  if(!Array.isArray(h.bills)||h.bills.length>20)fail();
  for(const b of h.bills){
    if(!b||!validId(b.id)||ids.has(b.id)||typeof b.title!=='string'||!b.title.trim()||b.title.length>100||typeof b.category!=='string'||b.category.length>30||!validId(b.paidBy)||!Number.isInteger(b.amount)||b.amount<1||b.amount>100000000||!b.shares||typeof b.shares!=='object'||Array.isArray(b.shares)||!validDate(b.due)||!['day','week','month'].includes(b.unit)||!Number.isInteger(b.every)||b.every<1||b.every>365||!Number.isInteger(b.anchorDay)||b.anchorDay<1||b.anchorDay>31||typeof b.paused!=='boolean')fail();
    const shares=Object.entries(b.shares);
    if(!shares.length||shares.length>30||shares.some(([id,v])=>!validId(id)||!Number.isInteger(v)||v<0)||shares.reduce((n,[,v])=>n+v,0)!==b.amount)fail();
    ids.add(b.id);
  }
}
export function postDueBills(h,today=iso()){
  let changed=false;
  for(const b of (h.bills||[]).filter(b=>!b.paused)){
    for(let n=0;b.due<=today&&n<24;n++){
      const ids=new Set(h.people.map(p=>p.id));
      if(!ids.has(b.paidBy)||Object.keys(b.shares).some(id=>!ids.has(id))){b.paused=true;record(h,'expense',`${b.title} was paused because a flatmate in it left`);changed=true;break;}
      addExpense(h,{title:b.title,category:b.category,spentOn:b.due,paidBy:b.paidBy,amount:b.amount,shares:b.shares});
      b.due=nextDue(b);changed=true;
    }
  }
  return changed;
}
// Shared shopping list; bought items can be logged together as one expense.
function validateShopping(h){
  if(h.shopping===undefined)return;
  const ok=i=>i&&typeof i.id==='string'&&/^[\w-]{1,80}$/.test(i.id)&&typeof i.item==='string'&&i.item.trim()&&i.item.length<=80&&typeof i.addedBy==='string'&&i.addedBy.length<=80&&typeof i.done==='boolean';
  if(!Array.isArray(h.shopping)||h.shopping.length>60||!h.shopping.every(ok)||new Set(h.shopping.map(i=>i.id)).size!==h.shopping.length)throw new Error('This is not a valid Flatflow backup. No data was changed.');
}
