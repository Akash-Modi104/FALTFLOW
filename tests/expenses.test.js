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
