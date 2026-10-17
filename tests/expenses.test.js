import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {MAX_EXPENSES,demoHome,validateHome,splitAmount,expenseBalances,settlements,addExpense,removeExpense,clearSettledExpenses,removePerson,iso} from '../public/core.js';

test('equal and weighted splits always add up to the exact amount',()=>{
  assert.deepEqual(splitAmount(1000,{a:1,b:1,c:1}),{a:334,b:333,c:333});
  assert.deepEqual(splitAmount(1001,{a:2,b:1}),{a:667,b:334});
  for(const amount of [1,7,99,12345])assert.equal(Object.values(splitAmount(amount,{a:1,b:3,c:5,d:1})).reduce((n,v)=>n+v,0),amount);
  assert.throws(()=>splitAmount(0,{a:1}),/above zero/);
  assert.throws(()=>splitAmount(100,{a:0}),/at least one/);
});

test('balances and simplified settlements net to zero',()=>{
  const h=demoHome(),[a,b,c,d]=h.people.map(p=>p.id);
  addExpense(h,{title:'Groceries',spentOn:iso(),paidBy:a,amount:4000,shares:splitAmount(4000,{[a]:1,[b]:1,[c]:1,[d]:1})});
  addExpense(h,{title:'Internet',spentOn:iso(),paidBy:b,amount:3000,shares:splitAmount(3000,{[a]:1,[b]:1,[c]:1})});
  validateHome(h);
  const net=expenseBalances(h);
  assert.deepEqual(net,{[a]:2000,[b]:1000,[c]:-2000,[d]:-1000});
  const plan=settlements(h);
  assert.ok(plan.length<=3);
  for(const s of plan)addExpense(h,{kind:'settle',title:'Settle up',spentOn:iso(),paidBy:s.from,amount:s.amount,shares:{[s.to]:s.amount}});
  assert.deepEqual(expenseBalances(h),{});
  assert.equal(h.history[0].kind,'settle');
  clearSettledExpenses(h);assert.equal(h.expenses.length,0);
});

test('expenses are validated and protect flatmates with open balances',()=>{
  const h=demoHome(),[a,b]=h.people.map(p=>p.id);
  validateHome(h); // older homes without expenses stay valid
  const e=addExpense(h,{title:'Pizza',spentOn:iso(),paidBy:a,amount:2000,shares:{[a]:1000,[b]:1000}});
  assert.throws(()=>removePerson(h,b),/Settle up/);
  assert.throws(()=>clearSettledExpenses(h),/Settle every balance/);
  const bad=structuredClone(h);bad.expenses[0].shares[a]=999;assert.throws(()=>validateHome(bad),/not a valid/);
  const currency=structuredClone(h);currency.currency='euro';assert.throws(()=>validateHome(currency),/not a valid/);
  assert.throws(()=>addExpense(h,{title:'x',spentOn:iso(),paidBy:'stranger',amount:1,shares:{stranger:1}}),/current flatmates/);
  removeExpense(h,e.id);assert.deepEqual(expenseBalances(h),{});
  removePerson(h,b);validateHome(h);
});

test('recurring bills post on their due dates and survive validation',async()=>{
  const {postDueBills,rollOver,addDays}=await import('../public/core.js');
  const h=demoHome(),[a,b]=h.people.map(p=>p.id),start=addDays(iso(),-40);
  h.bills=[{id:'rent',title:'Rent',category:'Rent',paidBy:a,amount:120000,shares:{[a]:60000,[b]:60000},every:1,unit:'month',due:start,anchorDay:Number(start.slice(8)),paused:false}];
  validateHome(h);
  assert.equal(postDueBills(h),true);assert.equal(h.expenses.length,2);assert.ok(h.bills[0].due>iso());
  assert.deepEqual(expenseBalances(h),{[a]:120000,[b]:-120000});
  assert.equal(postDueBills(h),false);validateHome(h);
  h.bills[0].due=iso();removeExpense(h,h.expenses[0].id);h.people=h.people.filter(p=>p.id!==b);rollOver(h);assert.equal(h.bills[0].paused,true);
});
test('a full expense list folds old expenses into exact carried-over balances',()=>{
  const h=demoHome(),[a,b,c]=h.people.map(p=>p.id);
  for(let i=0;i<MAX_EXPENSES+30;i++)addExpense(h,{title:'Snack '+i,spentOn:iso(),paidBy:[a,b,c][i%3],amount:300+i,shares:splitAmount(300+i,{[a]:1,[b]:1,[c]:1})});
  const net=JSON.stringify(expenseBalances(h));
  assert.ok(h.expenses.length<=MAX_EXPENSES);assert.ok(h.expenses.some(e=>e.title==='Earlier balances'));
  validateHome(h);
  const exact={};for(let i=0;i<MAX_EXPENSES+30;i++){const amount=300+i,shares=splitAmount(amount,{[a]:1,[b]:1,[c]:1}),payer=[a,b,c][i%3];exact[payer]=(exact[payer]||0)+amount;for(const [id,v] of Object.entries(shares))exact[id]=(exact[id]||0)-v;}
  for(const id of Object.keys(exact))if(!exact[id])delete exact[id];
  assert.deepEqual(JSON.parse(net),exact);
});

test('shopping lists are validated',()=>{
  const h=demoHome();h.shopping=[{id:'milk',item:'Milk',addedBy:h.people[0].id,done:false}];validateHome(h);
  h.shopping.push({id:'milk',item:'Eggs',addedBy:'',done:true});assert.throws(()=>validateHome(h),/not a valid/);
  h.shopping=[{id:'x',item:'',addedBy:'',done:false}];assert.throws(()=>validateHome(h),/not a valid/);
});

test('several payers, other currencies, notes and comments keep balances exact',async()=>{
  const {editExpense,addComment,currenciesInUse,pairwiseDebts}=await import('../public/core.js');
  const h=demoHome(),[a,b,c]=h.people.map(p=>p.id);h.currency='EUR';
  const e=addExpense(h,{title:'Dinner',spentOn:iso(),paidBy:a,payers:{[a]:6000,[b]:3000},amount:9000,shares:splitAmount(9000,{[a]:1,[b]:1,[c]:1}),notes:'  Birthday  '});
  assert.equal(e.paidBy,a);assert.equal(e.notes,'Birthday');
  assert.deepEqual(expenseBalances(h),{[a]:3000,[c]:-3000});
  addExpense(h,{title:'Train',spentOn:iso(),paidBy:c,amount:5000,currency:'GBP',shares:{[a]:2500,[c]:2500}});
  assert.deepEqual(currenciesInUse(h),['EUR','GBP']);
  assert.deepEqual(expenseBalances(h,'GBP'),{[c]:2500,[a]:-2500});
  assert.deepEqual(settlements(h,'GBP'),[{from:a,to:c,amount:2500}]);
  assert.throws(()=>removePerson(h,c),/Settle up/);
  addComment(h,e.id,b,'I paid by card');validateHome(h);
  assert.throws(()=>addComment(h,e.id,b,' '),/Write a comment/);
  const edited=editExpense(h,e.id,{title:'Dinner out',category:'Eating out',spentOn:iso(),paidBy:a,amount:9000,shares:splitAmount(9000,{[a]:1,[c]:2})});
  assert.equal(edited.id,e.id);assert.equal(edited.comments.length,1);assert.equal(edited.payers,undefined);
  assert.deepEqual(expenseBalances(h),{[a]:6000,[c]:-6000});validateHome(h);
  assert.throws(()=>addExpense(h,{title:'x',spentOn:iso(),paidBy:a,payers:{[a]:100,[b]:50},amount:200,shares:{[a]:200}}),/add up/);
  const bad=structuredClone(h);bad.expenses[1].payers={[a]:1};assert.throws(()=>validateHome(bad),/not a valid/);
  const bad2=structuredClone(h);bad2.expenses[0].currency='gbp';assert.throws(()=>validateHome(bad2),/not a valid/);
  assert.throws(()=>clearSettledExpenses(h),/Settle every/);
  assert.ok(Array.isArray(pairwiseDebts(h)));
});

test('person-to-person debts match the simplified totals',async()=>{
  const {pairwiseDebts}=await import('../public/core.js');
  const h=demoHome(),[a,b,c]=h.people.map(p=>p.id);
  addExpense(h,{title:'A',spentOn:iso(),paidBy:a,amount:3000,shares:{[b]:3000}});
  addExpense(h,{title:'B',spentOn:iso(),paidBy:b,amount:3000,shares:{[c]:3000}});
  addExpense(h,{title:'C',spentOn:iso(),paidBy:a,payers:{[a]:1000,[c]:2000},amount:3000,shares:{[b]:3000}});
  const pairs=pairwiseDebts(h),sum={};for(const p of pairs){sum[p.from]=(sum[p.from]||0)-p.amount;sum[p.to]=(sum[p.to]||0)+p.amount;}
  for(const k of Object.keys(sum))if(!sum[k])delete sum[k];
  assert.deepEqual(sum,expenseBalances(h));
  assert.deepEqual(pairs.map(p=>[p.from,p.to,p.amount]),[[b,a,4000],[c,b,1000]]);
  assert.equal(settlements(h).length,2);
  h.simplify=false;validateHome(h);assert.deepEqual(settlements(h),pairs);
  h.simplify='no';assert.throws(()=>validateHome(h),/not a valid/);
});

test('folding old expenses keeps each currency separate',()=>{
  const h=demoHome(),[a,b]=h.people.map(p=>p.id);h.currency='EUR';
  for(let i=0;i<MAX_EXPENSES+10;i++)addExpense(h,{title:'T'+i,spentOn:iso(),paidBy:i%2?a:b,amount:100+i,currency:i%3?'EUR':'USD',shares:{[a]:50,[b]:50+i}});
  validateHome(h);assert.ok(h.expenses.length<=MAX_EXPENSES);
  let eur={},usd={};for(let i=0;i<MAX_EXPENSES+10;i++){const t=i%3?eur:usd,p=i%2?a:b;t[p]=(t[p]||0)+100+i;t[a]=(t[a]||0)-50;t[b]=(t[b]||0)-(50+i);}
  for(const t of [eur,usd])for(const k of Object.keys(t))if(!t[k])delete t[k];
  assert.deepEqual(expenseBalances(h,'EUR'),eur);assert.deepEqual(expenseBalances(h,'USD'),usd);
});

test('a long Splitwise history imports in full, folding only what would not fit',async()=>{
  const {importSplitwise}=await import('../public/splitwise.js');
  const h=demoHome(),[a,b]=h.people.map(p=>p.id);h.expenses=[];
  const make=n=>Array.from({length:n},(_,i)=>({id:crypto.randomUUID(),kind:'expense',title:'Item '+i,category:'General',spentOn:'2026-01-'+String(1+i%28).padStart(2,'0'),paidBy:i%2?a:b,amount:1000+i,shares:{[a]:500,[b]:500+i}}));
  importSplitwise(h,make(499));validateHome(h);assert.equal(h.expenses.length,499);
  const net=JSON.stringify(expenseBalances(h));
  importSplitwise(h,make(200));validateHome(h);assert.ok(h.expenses.length<=MAX_EXPENSES);assert.ok(h.expenses.some(e=>e.title==='Earlier balances'));
});

test('a flatmate can carry a sign-in link tag, and a malformed one is refused',()=>{
  const h=demoHome();h.people[0].claim='0123456789abcdef';validateHome(h);
  h.people[0].claim='not-a-tag';assert.throws(()=>validateHome(h),/not a valid/);
});
