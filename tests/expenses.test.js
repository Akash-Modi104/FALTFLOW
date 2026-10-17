import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {demoHome,validateHome,splitAmount,expenseBalances,settlements,addExpense,removeExpense,clearSettledExpenses,removePerson,iso} from '../public/core.js';

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
  for(let i=0;i<130;i++)addExpense(h,{title:'Snack '+i,spentOn:iso(),paidBy:[a,b,c][i%3],amount:300+i,shares:splitAmount(300+i,{[a]:1,[b]:1,[c]:1})});
  const net=JSON.stringify(expenseBalances(h));
  assert.ok(h.expenses.length<=100);assert.ok(h.expenses.some(e=>e.title==='Earlier balances'));
  validateHome(h);
  const exact={};for(let i=0;i<130;i++){const amount=300+i,shares=splitAmount(amount,{[a]:1,[b]:1,[c]:1}),payer=[a,b,c][i%3];exact[payer]=(exact[payer]||0)+amount;for(const [id,v] of Object.entries(shares))exact[id]=(exact[id]||0)-v;}
  for(const id of Object.keys(exact))if(!exact[id])delete exact[id];
  assert.deepEqual(JSON.parse(net),exact);
});
