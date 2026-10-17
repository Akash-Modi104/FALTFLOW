import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {demoHome,validateHome,expenseBalances} from '../public/core.js';
import {parseCsv,readSplitwise,splitwiseExpenses,importSplitwise} from '../public/splitwise.js';

const csv=`﻿Date,Description,Category,Cost,Currency,Alex,Jamie,Sam\r
2026-09-01,"Groceries, big shop",Groceries,90.00,EUR,60.00,-30.00,-30.00\r
2026-09-03,Internet,Utilities,40.00,EUR,-20.00,20.00,0.00\r
2026-09-05,Dinner,Dining out,30.00,EUR,10.00,10.00,-20.00\r
2026-09-07,Sam paid Alex,Payment,10.00,EUR,-10.00,0.00,10.00\r
2026-09-08,Train,Transport,12.00,USD,6.00,-6.00,0.00\r
\r
2026-10-17,Total balance, , ,EUR,40.00,0.00,-40.00\r
`;
test('csv parser handles quotes, commas and line endings',()=>{assert.deepEqual(parseCsv('a,"b, ""c"""\r\n1,2\n'),[['a','b, "c"'],['1','2']]);});
test('Splitwise exports become exact Flatflow expenses with matching balances',()=>{
  const data=readSplitwise(csv);assert.deepEqual(data.members,['Alex','Jamie','Sam']);assert.equal(data.entries.length,5);
  const h=demoHome(),[a,j,s]=h.people.map(p=>p.id),mapping={Alex:a,Jamie:j,Sam:s};
  const {expenses,ignored}=splitwiseExpenses(data,mapping,'EUR');assert.equal(ignored,1);
  importSplitwise(h,expenses);validateHome(h);
  assert.deepEqual(expenseBalances(h),{[a]:4000,[s]:-4000});
  const shop=h.expenses.find(e=>e.title==='Groceries, big shop');assert.equal(shop.amount,9000);assert.equal(shop.shares[a],3000);
  assert.equal(h.expenses.filter(e=>e.kind==='settle').length,1);
  assert.equal(h.history[0].text,`Imported ${expenses.length} expenses from Splitwise`);
});
test('balances-only import keeps just what is still owed',()=>{
  const h=demoHome(),[a,j,s]=h.people.map(p=>p.id);
  const {expenses}=splitwiseExpenses(readSplitwise(csv),{Alex:a,Jamie:j,Sam:s},'EUR','balances');
  assert.equal(expenses.length,1);importSplitwise(h,expenses);validateHome(h);assert.deepEqual(expenseBalances(h),{[a]:4000,[s]:-4000});
});
test('unmapped members with money involved and non-Splitwise files are rejected',()=>{
  const h=demoHome(),[a,j]=h.people.map(p=>p.id);
  assert.throws(()=>splitwiseExpenses(readSplitwise(csv),{Alex:a,Jamie:j},'EUR'),/Choose a flatmate for Sam/);
  assert.throws(()=>readSplitwise('name,amount\nx,1'),/Splitwise group export/);
});
