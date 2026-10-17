import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createECDH,createPublicKey,verify,hkdfSync,createDecipheriv,randomBytes} from 'node:crypto';
import {demoHome,addDays} from '../public/core.js';
import {createBackend,hash,berlinDate,withSettings} from '../worker/backend.js';
import worker from '../worker/index.js';

// A tiny D1 stand-in on Node's built-in SQLite, with the same statement API.
function d1(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind:(...a)=>statement(sql,a),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})});
  return {sqlite,prepare:sql=>statement(sql),batch:async list=>{sqlite.exec('BEGIN');try{const out=[];for(const s of list)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const vapid=(()=>{const e=createECDH('prime256v1');e.generateKeys();return {VAPID_PRIVATE:e.getPrivateKey('hex').padStart(64,'0'),VAPID_PUBLIC:e.getPublicKey().toString('base64url')};})();
function setup({fetcher,env={}}={}){
  const sent=[],pending=[],db=d1();
  const fetchMock=fetcher||(async(url,options)=>{sent.push({url,options});return new Response(null,{status:201});});
  const fullEnv={DB:db,...env};
  const b=createBackend(fullEnv,{fetcher:fetchMock,waitUntil:p=>pending.push(p)});
  return {db,sent,env:fullEnv,backend:b,rpc:r=>b.rpc(structuredClone(r)),settle:()=>Promise.all(pending.splice(0)),daily:(...a)=>b.daily(...a)};
}
const key='a'.repeat(64),key2='b'.repeat(64);

test('worker stores hashed invitation keys and serves the same responses',async()=>{
  const w=setup(),h=demoHome(),r=await w.rpc({action:'create',key,home:h,op:randomUUID()});
  assert.equal(r.revision,1);const row=w.db.sqlite.prepare('SELECT * FROM homes').get();
  assert.equal(row.hash,await hash(key));assert.ok(!JSON.stringify(row).includes(key));
  assert.equal((await w.rpc({action:'read',key})).home.name,h.name);
  assert.equal((await w.rpc({action:'read',key,revision:1})).unchanged,true);
  await assert.rejects(w.rpc({action:'read',key:'short'}),/Invalid household/);
  await assert.rejects(w.rpc({action:'read',key:key2}),/Household not found/);
});
test('stale writes conflict and retried operations are idempotent',async()=>{
  const w=setup(),h=demoHome();await w.rpc({action:'create',key,home:h,op:randomUUID()});
  const first=structuredClone(h);first.name='First update';const op=randomUUID();
  assert.equal((await w.rpc({action:'write',key,home:first,revision:1,op})).revision,2);
  assert.equal((await w.rpc({action:'write',key,home:first,revision:1,op})).revision,2);
  const stale=await w.rpc({action:'write',key,home:h,revision:1,op:randomUUID()});
  assert.equal(stale.conflict,true);assert.equal(stale.home.name,'First update');
  const bad=structuredClone(first);bad.people[0].email='x@example.com';bad.people[0].emailVerified=true;
  assert.equal((await w.rpc({action:'write',key,home:bad,revision:2,op:randomUUID()})).home.people[0].emailVerified,undefined);
  bad.schema=2;await assert.rejects(w.rpc({action:'write',key,home:bad,revision:3,op:randomUUID()}),/not a valid/);
});
test('overdue turns roll over on read, like the Apps Script backend',async()=>{
  const w=setup(),h=demoHome();h.tasks[0].due=addDays(berlinDate(),-30);
  await w.rpc({action:'create',key,home:h,op:randomUUID()});
  const r=await w.rpc({action:'read',key});assert.equal(r.revision,2);assert.ok(r.home.history.some(e=>e.kind==='missed'));
});

test('push devices stay private, are limited to official services and can be removed',async()=>{
  const w=setup({env:vapid}),h=demoHome(),person=h.people[0].id;await w.rpc({action:'create',key,home:h,op:randomUUID()});
  assert.deepEqual(await w.rpc({action:'pushConfig',key}),{publicKey:vapid.VAPID_PUBLIC,enabled:true});
  for(const endpoint of ['http://localhost/admin','https://fcm.googleapis.com.evil.test/fcm/send/a'])await assert.rejects(w.rpc({action:'subscribePush',key,person,endpoint}),/Unsupported notification/);
  await assert.rejects(w.rpc({action:'subscribePush',key,person:'missing',endpoint:'https://web.push.apple.com/x'}),/Choose your name/);
  const endpoint='https://web.push.apple.com/device';
  await w.rpc({action:'subscribePush',key,person,endpoint});
  assert.ok(!JSON.stringify(await w.rpc({action:'read',key})).includes('device'));
  assert.equal((await w.rpc({action:'testPush',key,endpoint})).sent,true);
  assert.match(w.sent[0].options.headers.Authorization,/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  await assert.rejects(w.rpc({action:'testPush',key,endpoint}),/Wait a minute/);
  await w.rpc({action:'unsubscribePush',key,endpoint});
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,0);
});

test('VAPID tokens verify and expense messages decrypt only for the subscriber',async()=>{
  const ua=createECDH('prime256v1');ua.generateKeys();const auth=randomBytes(16);
  const keys={p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')};
  const w=setup({env:vapid}),h=demoHome(),[a,j]=h.people.map(p=>p.id);await w.rpc({action:'create',key,home:h,op:randomUUID()});
  await w.rpc({action:'subscribePush',key,person:a,endpoint:'https://fcm.googleapis.com/fcm/send/payer',keys});
  await w.rpc({action:'subscribePush',key,person:j,endpoint:'https://fcm.googleapis.com/fcm/send/jamie',keys});
  const next=structuredClone(h);next.expenses=[{id:randomUUID(),kind:'expense',title:'Pizza',category:'',spentOn:'2026-10-17',paidBy:a,amount:2000,shares:{[a]:1000,[j]:1000}}];
  await w.rpc({action:'write',key,home:next,revision:1,op:randomUUID()});await w.settle();
  assert.deepEqual(w.sent.map(x=>x.url),['https://fcm.googleapis.com/fcm/send/jamie']);
  const {headers,body}=w.sent[0].options;assert.equal(headers['Content-Encoding'],'aes128gcm');
  const [,jwt]=headers.Authorization.match(/^vapid t=([^,]+), k=/),[p1,p2,sig]=jwt.split('.');
  const pub=Buffer.from(vapid.VAPID_PUBLIC,'base64url'),jwk={kty:'EC',crv:'P-256',x:pub.subarray(1,33).toString('base64url'),y:pub.subarray(33).toString('base64url')};
  assert.equal(verify('sha256',Buffer.from(p1+'.'+p2),{key:createPublicKey({key:jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(sig,'base64url')),true);
  assert.equal(JSON.parse(Buffer.from(p2,'base64url')).aud,'https://fcm.googleapis.com');
  const data=Buffer.from(body),salt=data.subarray(0,16),asPublic=data.subarray(21,86),ct=data.subarray(86);
  assert.equal(data.readUInt32BE(16),4096);
  const ikm=Buffer.from(hkdfSync('sha256',ua.computeSecret(asPublic),auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),asPublic]),32));
  const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const d=createDecipheriv('aes-128-gcm',cek,nonce);d.setAuthTag(ct.subarray(-16));
  const plain=Buffer.concat([d.update(ct.subarray(0,-16)),d.final()]);assert.equal(plain.at(-1),2);
  assert.match(JSON.parse(plain.subarray(0,-1)).body,/Alex added Pizza · your share EUR 10.00/);
});

test('daily reminders go out once, only in the Berlin 9 o’clock hour, to people with chores due',async()=>{
  const w=setup({env:vapid}),h=demoHome();h.tasks.forEach(t=>t.due=berlinDate());
  await w.rpc({action:'create',key,home:h,op:randomUUID()});
  for(const p of h.people)await w.rpc({action:'subscribePush',key,person:p.id,endpoint:'https://web.push.apple.com/'+p.id});
  const today=berlinDate(),nine=new Date(`${today}T09:30:00+02:00`),noon=new Date(`${today}T12:00:00+02:00`);
  const berlinNine=new Date(nine.getTime()+((9-Number(nine.toLocaleString('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'})))*3600e3));
  assert.equal(await w.daily(noon),0);assert.equal(w.sent.length,0);
  const first=await w.daily(berlinNine);assert.ok(first>=1);assert.ok(first<=h.people.length);
  assert.equal(await w.daily(berlinNine),0);assert.equal(w.sent.length,first);
});

const googleToken=(claims={})=>async()=>Response.json({aud:'client-123',iss:'https://accounts.google.com',exp:String(Math.floor(Date.now()/1000)+600),sub:'1234567890',email:'asha@example.com',email_verified:'true',name:'Asha',...claims});
test('accounts keep their homes across devices and sessions are hashed',async()=>{
  const off=setup({fetcher:googleToken()});assert.deepEqual(await off.rpc({action:'authConfig'}),{enabled:false,clientId:''});
  await assert.rejects(off.rpc({action:'signIn',idToken:'a.b.c'}),/not set up/);
  const w=setup({fetcher:googleToken(),env:{GOOGLE_CLIENT_ID:'client-123'}}),h=demoHome(),other=demoHome();
  const phone=await w.rpc({action:'signIn',idToken:'a.b.c'});assert.match(phone.session,/^[a-f0-9]{64}$/);
  await assert.rejects(w.rpc({action:'create',key,home:h,op:randomUUID()}),/Sign in to continue/);
  await w.rpc({action:'create',key,home:h,op:randomUUID(),session:phone.session});await w.rpc({action:'create',key:key2,home:other,op:randomUUID(),session:phone.session});
  await w.rpc({action:'linkHome',session:phone.session,key,person:h.people[0].id});await w.rpc({action:'linkHome',session:phone.session,key:key2});
  await assert.rejects(w.rpc({action:'linkHome',session:phone.session,key,person:'stranger'}),/Choose your name/);
  const laptop=await w.rpc({action:'signIn',idToken:'a.b.c'});
  assert.deepEqual((await w.rpc({action:'myHomes',session:laptop.session})).homes.map(x=>[x.key,x.person,x.name]),[[key,h.people[0].id,h.name],[key2,'',other.name]]);
  assert.ok(!JSON.stringify(w.db.sqlite.prepare('SELECT * FROM sessions').all()).includes(phone.session));
  await w.rpc({action:'signOut',session:phone.session});await assert.rejects(w.rpc({action:'myHomes',session:phone.session}),/expired/);
  for(const [claims,error] of [[{aud:'other'},/sign-in failed/],[{email_verified:'false'},/Verify your Google email/]]){const x=setup({fetcher:googleToken(claims),env:{GOOGLE_CLIENT_ID:'client-123'}});await assert.rejects(x.rpc({action:'signIn',idToken:'a.b.c'}),error);}
});

test('migration copies Sheet rows and script properties, never replacing newer data',async()=>{
  const w=setup(),h=demoHome(),homeHash=await hash(key),sub='1234567890',session='c'.repeat(64);
  const properties={['account_'+await hash(sub)]:JSON.stringify({homes:[{key,person:h.people[0].id}],email:'asha@example.com',name:'Asha'}),
    ['session_'+await hash(session)]:JSON.stringify({sub,exp:Date.now()+864e5}),
    ['device_'+await hash('https://web.push.apple.com/d|'+homeHash)]:JSON.stringify({home:homeHash,person:h.people[0].id,endpoint:'https://web.push.apple.com/d',keys:null,sent:'',testAt:0}),
    VAPID_PRIVATE:'never copied'};
  await w.backend.migrate({homes:[{hash:homeHash,revision:5,updatedAt:'2026-10-17T10:00:00Z',home:JSON.stringify(h),op:'x'}],properties});
  assert.equal((await w.rpc({action:'read',key})).revision,5);
  const older=structuredClone(h);older.name='Old copy';
  await w.backend.migrate({homes:[{hash:homeHash,revision:4,home:JSON.stringify(older)}]});
  assert.equal((await w.rpc({action:'read',key})).home.name,h.name);
  assert.equal((await w.rpc({action:'myHomes',session})).homes[0].key,key);
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) AS n FROM devices').get().n,1);
  assert.ok(!JSON.stringify(w.db.sqlite.prepare('SELECT * FROM accounts').all()).includes('never copied'));
  await assert.rejects(w.backend.migrate({settings:{OTHER:'x'}}),/Invalid setting/);
  await w.backend.migrate({settings:{...vapid,GOOGLE_CLIENT_ID:'client-123'}});
  const env=await withSettings({DB:w.db,GOOGLE_CLIENT_ID:'from-secret'},0);
  assert.equal(env.VAPID_PRIVATE,vapid.VAPID_PRIVATE);assert.equal(env.GOOGLE_CLIENT_ID,'from-secret');
});

test('HTTP layer only answers Flatflow origins and hides the migration endpoint',async()=>{
  const db=d1(),env={DB:db},ctx={waitUntil(){}};
  const post=(path,body,headers={})=>worker.fetch(new Request('https://flatflow.example.workers.dev'+path,{method:'POST',body:JSON.stringify(body),headers}),env,ctx);
  assert.equal((await post('/rpc',{action:'authConfig'},{Origin:'https://evil.test'})).status,403);
  const preflight=await worker.fetch(new Request('https://flatflow.example.workers.dev/rpc',{method:'OPTIONS',headers:{Origin:'https://akash-modi104.github.io'}}),env,ctx);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://akash-modi104.github.io');
  const ok=await post('/rpc',{action:'authConfig'},{Origin:'https://akash-modi104.github.io'});
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'),'https://akash-modi104.github.io');assert.deepEqual(await ok.json(),{enabled:false,clientId:''});
  const bad=await post('/rpc',{action:'read',key:'x'},{Origin:'https://akash-modi104.github.io'});assert.equal(bad.status,400);assert.match((await bad.json()).error,/Invalid household/);
  assert.equal((await post('/migrate',{homes:[]},{Authorization:'Bearer x'})).status,404);
  env.MIGRATION_TOKEN='secret-token';
  assert.equal((await post('/migrate',{homes:[]},{Authorization:'Bearer wrong-token'})).status,404);
  assert.equal((await post('/migrate',{homes:[]},{Authorization:'Bearer secret-token'})).status,200);
});

test('with sign-in on, every home action needs a session and links the home to the account',async()=>{
  const w=setup({fetcher:googleToken(),env:{GOOGLE_CLIENT_ID:'client-123'}}),h=demoHome();
  const owner=await w.rpc({action:'signIn',idToken:'a.b.c'});await w.rpc({action:'create',key,home:h,op:randomUUID(),session:owner.session});
  for(const r of [{action:'read',key},{action:'write',key,home:h,revision:1,op:randomUUID()},{action:'subscribePush',key,person:h.people[0].id,endpoint:'https://web.push.apple.com/x'},{action:'redeemInvite',invite:'e'.repeat(64)},{action:'read',key,session:'f'.repeat(64)}])await assert.rejects(w.rpc(r),/Sign in to continue/);
  const friend=await w.rpc({action:'signIn',idToken:'a.b.c'});await w.rpc({action:'signOut',session:owner.session});
  assert.equal((await w.rpc({action:'read',key,session:friend.session})).home.name,h.name);
  assert.equal((await w.rpc({action:'myHomes',session:friend.session})).homes.length,1);
  await assert.rejects(w.rpc({action:'read',key,session:owner.session}),/Sign in to continue/);
});
