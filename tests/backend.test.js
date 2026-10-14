import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
import {demoHome} from '../public/core.js';

function mockBackend(){
  const rows=[['Household key hash','Revision','Updated at','Household JSON','Last operation ID']],props=new Map(),emails=[];
  const sheet={getLastRow:()=>rows.length,getRange:(r,c,n,m)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r-1+i]?.[c-1+j]??'')),setValues:values=>{values.forEach((row,i)=>{rows[r-1+i]||=[];row.forEach((v,j)=>rows[r-1+i][c-1+j]=v);});}})};
  const context=vm.createContext({console,structuredClone,Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>Array.from(createHash('sha256').update(text).digest()),formatDate:()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Berlin'})},SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush:()=>{}},LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},MailApp:{getRemainingDailyQuota:()=>100,sendEmail:(...a)=>emails.push(a)}});
  const template=fs.readFileSync(new URL('../backend/Code.template.gs',import.meta.url),'utf8');
  let core=fs.readFileSync(new URL('../public/core.js',import.meta.url),'utf8').replaceAll('export ','').replace('crypto.randomUUID()','Utilities.getUuid()');
  for(const n of ['uid','iso','date','addDays','nextDue','away','assignee','advance','emptyHome','demoHome','validateHome','record','complete','rollOver','skip','schedule','icsEscape','calendar'])core=core.replace(new RegExp('\\b'+n+'\\b','g'),n+'_');
  vm.runInContext(template+'\n'+core,context);return {rpc:r=>context.rpc(structuredClone(r)),rows,emails};
}
const key='a'.repeat(64);
test('backend rejects unknown and malformed household keys',()=>{const b=mockBackend();assert.throws(()=>b.rpc({action:'read',key:'short'}),/Invalid household/);assert.throws(()=>b.rpc({action:'read',key}),/Household not found/);});
test('backend stores hashed invitation keys and private JSON snapshots',()=>{const b=mockBackend(),h=demoHome(),r=b.rpc({action:'create',key,home:h,op:randomUUID()});assert.equal(r.revision,1);assert.notEqual(b.rows[1][0],key);assert.equal(b.rows[1][0].length,64);assert.equal(b.rpc({action:'read',key}).home.name,h.name);});
test('concurrent stale writes cannot overwrite newer household changes',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const first=structuredClone(h);first.name='First update';assert.equal(b.rpc({action:'write',key,home:first,revision:1,op:randomUUID()}).revision,2);const stale=b.rpc({action:'write',key,home:h,revision:1,op:randomUUID()});assert.equal(stale.conflict,true);assert.equal(stale.home.name,'First update');});
test('retrying the same write operation is idempotent',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const op=randomUUID(),r=b.rpc({action:'write',key,home:h,revision:1,op});assert.equal(r.revision,2);assert.equal(b.rpc({action:'write',key,home:h,revision:1,op}).revision,2);});
test('unverified addresses cannot forge a subscription through JSON',()=>{const b=mockBackend(),h=demoHome();h.people[0].email='test@example.com';h.people[0].emailVerified=true;const created=b.rpc({action:'create',key,home:h,op:randomUUID()});assert.equal(created.home.people[0].emailVerified,undefined);const next=created.home;next.people[0].email='test@example.com';next.people[0].emailVerified=true;const saved=b.rpc({action:'write',key,revision:1,home:next,op:randomUUID()});assert.equal(saved.home.people[0].emailVerified,undefined);assert.equal(b.emails.length,0);});
test('email verification requires a valid code and rate limits code requests',()=>{const b=mockBackend(),h=demoHome();b.rpc({action:'create',key,home:h,op:randomUUID()});const person=h.people[0].id;assert.equal(b.rpc({action:'requestEmail',key,person,email:'test@example.com'}).sent,true);assert.throws(()=>b.rpc({action:'requestEmail',key,person,email:'test@example.com'}),/wait an hour/);assert.throws(()=>b.rpc({action:'verifyEmail',key,person,code:'000000'}),/Incorrect/);const code=b.emails[0][2].match(/code is (\d{6})/)[1];const verified=b.rpc({action:'verifyEmail',key,person,code});assert.equal(verified.home.people[0].emailVerified,true);assert.equal(verified.revision,2);});
