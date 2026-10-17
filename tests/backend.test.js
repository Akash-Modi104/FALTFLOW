import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {demoHome} from '../public/core.js';

function mockBackend(fetchMock=()=>({getResponseCode:()=>201})){
  const rows=[['Household key hash','Revision','Updated at','Household JSON','Last operation ID']],props=new Map(),emails=[];
  const sheet={getLastRow:()=>rows.length,getRange:(r,c,n,m)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]??'')),setValues:values=>{values.forEach((row,i)=>{rows[r-1+i]||=[];row.forEach((v,j)=>rows[r-1+i][c-1+j]=v);});}})};
  const context=vm.createContext({console,structuredClone,Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>Array.from(createHash('sha256').update(text).digest()),formatDate:()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Berlin'})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},ScriptApp:{getProjectTriggers:()=>[{getHandlerFunction:()=>'sendDailyPush_'}]},UrlFetchApp:{fetch:(...a)=>fetchMock(...a)},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:(...a)=>emails.push(a)}});
  const template=fs.readFileSync(new URL('../backend/Code.template.gs',import.meta.url),'utf8');
  let core=fs.readFileSync(new URL('../public/core.js',import.meta.url),'utf8').replaceAll('export ','').replace('crypto.randomUUID()','Utilities.getUuid()');
  for(const n of ['uid','iso','date','addDays','nextDue','away','assignee','advance','emptyHome','demoHome','validateHome','record','complete','rollOver','skip','schedule','icsEscape','calendar','validateExpenses','splitAmount','expenseBalances','settlements','addExpense','removeExpense','clearSettledExpenses','postDueBills','validateBills','compactExpenses','validateShopping'])core=core.replace(new RegExp('\\b'+n+'\\b','g'),n+'_');
  vm.runInContext(template+'\n'+core+'\n'+fs.readFileSync(new URL('../backend/Push.gs',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../backend/Accounts.gs',import.meta.url),'utf8'),context);return {rpc:r=>context.rpc(structuredClone(r)),rows,emails,props,context};
}
const key='a'.repeat(64);
test('backend rejects unknown and malformed household keys',()=>{const b=mockBackend();assert.throws(()=>b.rpc({action:'read',key:'short'}),/Invalid household/);assert.throws(()=>b.rpc({action:'read',key}),/Household not found/);});
test('backend stores hashed invitation keys and private JSON snapshots',()=>{const b=mockBackend(),h=demoHome(),r=b.rpc({action:'create',key,home:h,op:randomUUID()});assert.equal(r.revision,1);assert.notEqual(b.rows[1][0],key);assert.equal(b.rows[1][0].length,64);assert.equal(b.rpc({action:'read',key}).home.name,h.name);});
test('concurrent stale writes cannot overwrite newer household changes',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const first=structuredClone(h);first.name='First update';assert.equal(b.rpc({action:'write',key,home:first,revision:1,op:randomUUID()}).revision,2);const stale=b.rpc({action:'write',key,home:h,revision:1,op:randomUUID()});assert.equal(stale.conflict,true);assert.equal(stale.home.name,'First update');});
test('retrying the same write operation is idempotent',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const op=randomUUID(),r=b.rpc({action:'write',key,home:h,revision:1,op});assert.equal(r.revision,2);assert.equal(b.rpc({action:'write',key,home:h,revision:1,op}).revision,2);});
test('unverified addresses cannot forge a subscription through JSON',()=>{const b=mockBackend(),h=demoHome();h.people[0].email='test@example.com';h.people[0].emailVerified=true;const created=b.rpc({action:'create',key,home:h,op:randomUUID()});assert.equal(created.home.people[0].emailVerified,undefined);const next=created.home;next.people[0].email='test@example.com';next.people[0].emailVerified=true;const saved=b.rpc({action:'write',key,revision:1,home:next,op:randomUUID()});assert.equal(saved.home.people[0].emailVerified,undefined);assert.equal(b.emails.length,0);});

test('backend stores shared expenses and rejects unbalanced splits',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const [a,c]=h.people.map(p=>p.id),next=structuredClone(h);next.currency='EUR';next.expenses=[{id:randomUUID(),kind:'expense',title:'Groceries',category:'Food',spentOn:'2026-10-01',paidBy:a,amount:3000,shares:{[a]:1500,[c]:1500}}];assert.equal(b.rpc({action:'write',key,home:next,revision:1,op:randomUUID()}).home.expenses.length,1);next.expenses[0].shares[c]=1;assert.throws(()=>b.rpc({action:'write',key,home:next,revision:2,op:randomUUID()}),/not a valid/);});

test('push registration only accepts official push endpoints and existing people',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const person=h.people[0].id;for(const endpoint of ['http://localhost/admin','https://example.com/','https://fcm.googleapis.com.evil.test/fcm/send/a','https://fcm.googleapis.com/fcm/send/a#x'])assert.throws(()=>b.rpc({action:'subscribePush',key,person,endpoint}),/Unsupported notification/);assert.throws(()=>b.rpc({action:'subscribePush',key,person:'missing',endpoint:'https://fcm.googleapis.com/fcm/send/test-device'}),/Choose your name/);});
test('device subscriptions stay out of shared JSON and can be disabled',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const req={key,person:h.people[0].id,endpoint:'https://web.push.apple.com/test-device'};assert.equal(b.rpc({...req,action:'subscribePush'}).enabled,true);assert.equal([...b.props.keys()].filter(k=>k.startsWith('device_')).length,1);assert.ok(!JSON.stringify(b.rpc({action:'read',key})).includes('test-device'));b.rpc({...req,action:'unsubscribePush'});assert.equal([...b.props.keys()].filter(k=>k.startsWith('device_')).length,0);});
test('one device can receive reminders for several homes',()=>{const b=mockBackend(),h=demoHome(),other=demoHome(),key2='b'.repeat(64),endpoint='https://web.push.apple.com/shared-device';b.rpc({action:'create',key,home:h,op:randomUUID()});b.rpc({action:'create',key:key2,home:other,op:randomUUID()});b.rpc({action:'subscribePush',key,person:h.people[0].id,endpoint});b.rpc({action:'subscribePush',key:key2,person:other.people[1].id,endpoint});const devices=()=>[...b.props.keys()].filter(k=>k.startsWith('device_'));assert.equal(devices().length,2);b.rpc({action:'unsubscribePush',key,endpoint});assert.equal(devices().length,1);assert.equal(b.rpc({action:'unsubscribePush',key,endpoint}).ok,true);});

test('email operations are unavailable',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});assert.throws(()=>b.rpc({action:'requestEmail',key,person:h.people[0].id,email:'test@example.com'}),/Unsupported/);assert.equal(b.emails.length,0);});

const googleToken=(claims={})=>()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({aud:'client-123',iss:'https://accounts.google.com',exp:String(Math.floor(Date.now()/1000)+600),sub:'1234567890',email:'asha@example.com',email_verified:'true',name:'Asha',...claims})});
const idToken='aaa.bbb.ccc';
test('sign-in is off until the owner sets a Google client ID',()=>{const b=mockBackend(googleToken());assert.deepEqual({...b.rpc({action:'authConfig'})},{enabled:false,clientId:''});assert.throws(()=>b.rpc({action:'signIn',idToken}),/not set up/);b.props.set('GOOGLE_CLIENT_ID','client-123');assert.equal(b.rpc({action:'authConfig'}).enabled,true);});
test('accounts keep their homes and identity across devices',()=>{
  const b=mockBackend(googleToken());b.props.set('GOOGLE_CLIENT_ID','client-123');
  const h=demoHome(),other=demoHome(),key2='b'.repeat(64);b.rpc({action:'create',key,home:h,op:randomUUID()});b.rpc({action:'create',key:key2,home:other,op:randomUUID()});
  const phone=b.rpc({action:'signIn',idToken});assert.match(phone.session,/^[a-f0-9]{64}$/);assert.equal(phone.homes.length,0);
  b.rpc({action:'linkHome',session:phone.session,key,person:h.people[0].id});b.rpc({action:'linkHome',session:phone.session,key:key2});
  assert.throws(()=>b.rpc({action:'linkHome',session:phone.session,key:'c'.repeat(64)}),/not found/);
  assert.throws(()=>b.rpc({action:'linkHome',session:phone.session,key,person:'stranger'}),/Choose your name/);
  const laptop=b.rpc({action:'signIn',idToken});assert.notEqual(laptop.session,phone.session);
  const homes=b.rpc({action:'myHomes',session:laptop.session}).homes;
  assert.deepEqual(JSON.parse(JSON.stringify(homes.map(x=>[x.key,x.person,x.name]))),[[key,h.people[0].id,h.name],[key2,'',other.name]]);
  assert.ok(![...b.props.values()].some(v=>v.includes(idToken)));assert.ok(![...b.props.keys()].some(k=>k.includes(phone.session)));
  b.rpc({action:'unlinkHome',session:laptop.session,key:key2});assert.equal(b.rpc({action:'myHomes',session:phone.session}).homes.length,1);
  b.rpc({action:'signOut',session:phone.session});assert.throws(()=>b.rpc({action:'myHomes',session:phone.session}),/expired/);
  assert.equal(b.rpc({action:'myHomes',session:laptop.session}).homes.length,1);
});
test('sign-in rejects tokens for other apps, unverified emails and forged sessions',()=>{
  for(const [claims,error] of [[{aud:'someone-else'},/sign-in failed/],[{iss:'https://evil.test'},/sign-in failed/],[{exp:'1'},/sign-in failed/],[{email_verified:'false'},/Verify your Google email/]]){const b=mockBackend(googleToken(claims));b.props.set('GOOGLE_CLIENT_ID','client-123');assert.throws(()=>b.rpc({action:'signIn',idToken}),error);}
  const b=mockBackend(()=>({getResponseCode:()=>400}));b.props.set('GOOGLE_CLIENT_ID','client-123');assert.throws(()=>b.rpc({action:'signIn',idToken}),/sign-in failed/);
  assert.throws(()=>b.rpc({action:'myHomes',session:'f'.repeat(64)}),/expired/);assert.throws(()=>b.rpc({action:'myHomes'}),/expired/);
});

test('new expenses notify the flatmates who owe, with an encrypted message',()=>{
  const sent=[];const b=mockBackend((url,options)=>{sent.push({url,options});return {getResponseCode:()=>201};});
  b.props.set('VAPID_PRIVATE','1'.repeat(64));b.props.set('VAPID_PUBLIC','public-key');
  b.context.Utilities.base64EncodeWebSafe=v=>Buffer.from(typeof v==='string'?v:v.map(x=>x&255)).toString('base64url');
  b.context.FlatflowPushCrypto={sign:()=>Array(64).fill(1),encrypt:(text,p256dh,auth,random)=>{assert.equal(random.length,48);return [...Buffer.from(text)];}};
  const h=demoHome(),[a,j,s]=h.people.map(p=>p.id);b.rpc({action:'create',key,home:h,op:randomUUID()});
  const keys={p256dh:'B'+'a'.repeat(86),auth:'b'.repeat(22)};
  b.rpc({action:'subscribePush',key,person:a,endpoint:'https://web.push.apple.com/payer',keys});
  b.rpc({action:'subscribePush',key,person:j,endpoint:'https://web.push.apple.com/jamie',keys});
  b.rpc({action:'subscribePush',key,person:s,endpoint:'https://web.push.apple.com/sam-no-keys'});
  const next=structuredClone(h);next.expenses=[{id:randomUUID(),kind:'expense',title:'Pizza',category:'',spentOn:'2026-10-17',paidBy:a,amount:3000,shares:{[a]:1000,[j]:1000,[s]:1000}}];
  b.rpc({action:'write',key,home:next,revision:1,op:randomUUID()});
  assert.deepEqual(sent.map(x=>x.url),['https://web.push.apple.com/jamie']);
  assert.equal(sent[0].options.headers['Content-Encoding'],'aes128gcm');
  const message=JSON.parse(Buffer.from(sent[0].options.payload.map(x=>x&255)).toString());
  assert.match(message.body,/Alex added Pizza · your share EUR 10.00/);
  b.rpc({action:'write',key,home:structuredClone(next),revision:2,op:randomUUID()});assert.equal(sent.length,1);
});
