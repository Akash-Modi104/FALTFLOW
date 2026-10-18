import {uid,iso,record,compactExpenses,MAX_EXPENSES} from './core.js?v=31';
// Reads the CSV that Splitwise exports per group: Date, Description, Category,
// Cost, Currency, then one column per member holding that member's net change
// for the row (positive for whoever paid, negative for whoever owes).
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(c=>c.trim()));
}
// Accepts 12.50, 12,50, 1,234.56 and the long decimals Excel stores, such as 33.329999999999998.
const toCents=s=>{let v=String(s).trim().replace(/[^\d.,eE+-]/g,'');if(!v)return NaN;if(v.includes(',')&&v.includes('.'))v=v.replace(/,/g,'');else v=v.replace(',','.');if(!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v))return NaN;const c=Number(v)*100;return Number.isFinite(c)&&Math.abs(c-Math.round(c))<0.01?Math.round(c)||0:NaN;};
export function readSplitwise(text){
  const all=parseCsv(text.replace(/^﻿/,''));
  // The header is usually the first row, but a spreadsheet may carry a title row or two above it.
  const start=Math.max(0,all.slice(0,10).findIndex(r=>['date','description','cost','currency'].every(n=>r.some(c=>c.trim().toLowerCase()===n)))),rows=all.slice(start);
  const head=(rows[0]||[]).map(c=>c.trim()),col=n=>head.findIndex(h=>h.toLowerCase()===n);
  const at={date:col('date'),title:col('description'),category:col('category'),cost:col('cost'),currency:col('currency')},first=Math.max(...Object.values(at))+1;
  while(head.length>first&&!head[head.length-1])head.pop();
  if(Object.values(at).some(i=>i<0)||head.length<first+2)throw new Error('This doesn’t look like a Splitwise group export. In Splitwise, open the group → Settings → Export as spreadsheet, then choose that CSV file.');
  const members=head.slice(first);
  if(new Set(members.map(m=>m.toLowerCase())).size!==members.length||members.some(m=>!m))throw new Error('This export has blank or repeated member names. Rename them in Splitwise and export again.');
  const entries=[],skipped=[];
  for(const r of rows.slice(1)){
    const title=(r[at.title]||'').trim(),raw=(r[at.date]||'').trim(),day=(/^\d{5}(\.\d+)?$/.test(raw)?new Date(Date.UTC(1899,11,30)+Math.floor(Number(raw))*864e5).toISOString():raw).slice(0,10); // Excel stores dates as day numbers
    if(/^total balance$/i.test(title)||!day)continue;
    const nets=Object.fromEntries(members.map((m,i)=>[m,toCents(r[first+i]||'0')])),cost=toCents(r[at.cost]);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!(cost>0)||Object.values(nets).some(Number.isNaN)){skipped.push(title||day);continue;}
    const drift=Object.values(nets).reduce((n,v)=>n+v,0);
    if(Math.abs(drift)>members.length){skipped.push(title);continue;}
    if(drift){const top=members.reduce((a,b)=>nets[b]>nets[a]?b:a);nets[top]-=drift;}
    entries.push({date:day,title:title.slice(0,100)||'Splitwise expense',category:(r[at.category]||'').trim().slice(0,30),cost,currency:(r[at.currency]||'').trim().toUpperCase(),nets,payment:/^payment$/i.test((r[at.category]||'').trim())});
  }
  return {members,entries,skipped};
}
// Pairs who owes with who is owed, largest first. Used for one row or for totals.
function pairUp(nets){
  const owe=[],owed=[];
  for(const [id,v] of Object.entries(nets))if(v)(v<0?owe:owed).push({id,v:Math.abs(v)});
  owe.sort((a,b)=>b.v-a.v);owed.sort((a,b)=>b.v-a.v);
  const out=[];let i=0,j=0;
  while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i].v,owed[j].v);out.push({from:owe[i].id,to:owed[j].id,amount});owe[i].v-=amount;owed[j].v-=amount;if(!owe[i].v)i++;if(!owed[j].v)j++;}
  return out;
}
// Turns a Splitwise export into Flatflow expenses. mapping: Splitwise name → person id.
// 'history' keeps each row (one payer and exact shares); 'balances' adds only what is
// still owed, as opening balances, which keeps large groups small.
export function splitwiseExpenses(data,mapping,currency,mode='history'){
  const rows=data.entries.filter(e=>e.currency===currency),ignored=data.entries.length-rows.length;
  const mapNets=nets=>{const out={};for(const [name,v] of Object.entries(nets)){const id=mapping[name];if(v&&!id)throw new Error(mode==='balances'?`${name} still owes or is owed money. Match them to a flatmate or add them.`:`${name} is part of some expenses, so they can’t be left out of the full history. Match them to a flatmate, add them, or import balances only.`);if(v)out[id]=(out[id]||0)+v;}return out;};
  const expenses=[];
  if(mode==='balances'){
    // Only each person's final balance matters here, so anyone who ends up square can be left out.
    const byName={};for(const e of rows)for(const [name,v] of Object.entries(e.nets))byName[name]=(byName[name]||0)+v;
    const total=mapNets(byName);
    for(const p of pairUp(total))expenses.push({id:uid(),kind:'expense',title:'Opening balance from Splitwise',category:'Splitwise',spentOn:iso(),paidBy:p.to,amount:p.amount,shares:{[p.from]:p.amount}});
    return {expenses,ignored};
  }
  for(const e of rows){
    const nets=mapNets(e.nets),payers=Object.keys(nets).filter(id=>nets[id]>0);
    if(!payers.length)continue;
    const base={kind:e.payment?'settle':'expense',title:e.payment?'Settle up':e.title,category:e.payment?'':e.category,spentOn:e.date};
    const owing=Object.entries(nets).filter(([,v])=>v<0),owedTotal=-owing.reduce((n,[,v])=>n+v,0);
    if(payers.length===1&&!e.payment&&owedTotal<=e.cost){
      // One payer: their own share is whatever of the cost nobody else owes.
      const payer=payers[0],shares=Object.fromEntries(owing.map(([id,v])=>[id,-v]));
      if(e.cost-owedTotal)shares[payer]=e.cost-owedTotal;
      expenses.push({id:uid(),...base,paidBy:payer,amount:e.cost,shares});
    }else for(const p of pairUp(nets))expenses.push({id:uid(),...base,paidBy:p.to,amount:p.amount,shares:{[p.from]:p.amount}});
  }
  return {expenses:expenses.reverse(),ignored};
}
export function importSplitwise(h,expenses,newPeople=[]){
  for(const p of newPeople){if(h.people.length>=30)throw new Error('This home supports up to 30 flatmates.');h.people.push(p);}
  const list=[...expenses.slice().sort((a,b)=>b.spentOn.localeCompare(a.spentOn)),...(h.expenses||[])];
  h.expenses=list;
  // Very long histories keep their newest expenses; older ones become a few
  // "Earlier balances" entries with exactly the same effect on balances.
  const before=h.expenses.length;compactExpenses(h);
  record(h,'expense',`Imported ${expenses.length} expense${expenses.length===1?'':'s'} from Splitwise${h.expenses.length<before?`; the oldest were combined into earlier balances`:''}`);
}
