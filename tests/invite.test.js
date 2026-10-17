import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,randomUUID} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {makeCode,normalizeCode,inviteId,sealKey,openKey} from '../public/invite.js';
import {demoHome} from '../public/core.js';
import {createBackend} from '../worker/backend.js';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';

const key='c'.repeat(64);
test('invite codes are short, readable and forgiving to type',()=>{
  const codes=new Set(Array.from({length:200},makeCode));
  assert.equal(codes.size,200);
  for(const c of codes){assert.match(c,/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);assert.equal(normalizeCode(c.toLowerCase().replace('-',' ')),c);}
  assert.equal(normalizeCode('k7m2qx9p'),'K7M2-QX9P');
  for(const bad of ['K7M2-QX9','K7M2-QX9PP','O7M2-QX9P','https://x/#home=abc',''])assert.equal(normalizeCode(bad),'');
});
test('the household key is sealed with the code and opens only with it',async()=>{
  const code=makeCode(),sealed=await sealKey(key,code);
  assert.ok(!sealed.includes(key));assert.match(sealed,/^[\w-]{40,200}$/);
  assert.equal(await openKey(sealed,code),key);
  await assert.rejects(openKey(sealed,makeCode()),/wrong or has expired/);
  assert.match(await inviteId(code),/^[a-f0-9]{64}$/);assert.notEqual(await inviteId(code),await inviteId(makeCode()));
});
function d1(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind:(...a)=>statement(sql,a),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})});
  return {sqlite,prepare:sql=>statement(sql)};
}
test('worker keeps only sealed invites, the 3 newest per home, for 7 days',async()=>{
  const db=d1(),b=createBackend({DB:db}),h=demoHome();
  await b.rpc({action:'create',key,home:h,op:randomUUID()});
  const code=makeCode(),invite=await inviteId(code),sealed=await sealKey(key,code);
  const r=await b.rpc({action:'createInvite',key,invite,sealed});
  assert.ok(Date.parse(r.expires)>Date.now()+6.9*864e5);
  assert.ok(!JSON.stringify(db.sqlite.prepare('SELECT * FROM invites').all()).includes(key));
  assert.equal(await openKey((await b.rpc({action:'redeemInvite',invite})).sealed,code),key);
  await assert.rejects(b.rpc({action:'redeemInvite',invite:await inviteId(makeCode())}),/wrong or has expired/);
  await assert.rejects(b.rpc({action:'redeemInvite',invite:'nope'}),/Check the invite code/);
  await assert.rejects(b.rpc({action:'createInvite',key,invite,sealed:'x'}),/Invalid invite/);
  await assert.rejects(b.rpc({action:'createInvite',key:'d'.repeat(64),invite,sealed}),/Household not found/);
  for(let i=0;i<4;i++)await b.rpc({action:'createInvite',key,invite:await inviteId(makeCode()),sealed});
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM invites').get().n,3);
  db.sqlite.prepare('UPDATE invites SET exp = 1').run();
  const last=db.sqlite.prepare('SELECT id FROM invites').get().id;
  await assert.rejects(b.rpc({action:'redeemInvite',invite:last}),/expired/);
});
