import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreSession,saveSession,STORAGE,CONNECTION} from '../public/session.js';
import {emptyHome,demoHome} from '../public/core.js';
const key='a'.repeat(64);
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const shared=()=>({home:emptyHome('Real flat'),mode:'shared',key,revision:8,myId:'spandan',backend:'endpoint'});
test('new browser opens welcome with no fabricated people or chores',()=>{const s=restoreSession(storage());assert.equal(s.mode,'welcome');assert.equal(s.home.people.length,0);assert.equal(s.home.tasks.length,0);});
test('reopening keeps household, revision, invitation and personal identity',()=>{const db=storage(),s=shared();assert.equal(saveSession(db,s),true);const restored=restoreSession(db);for(const k of ['mode','key','revision','myId'])assert.equal(restored[k],s[k]);assert.equal(restored.home.id,s.home.id);});
test('invalid cached household retains connection and reloads from server',()=>{const db=storage(),s=shared();s.home.people=[{invalid:true}];db.setItem(STORAGE,JSON.stringify(s));const r=restoreSession(db);assert.equal(r.mode,'shared');assert.equal(r.key,key);assert.equal(r.revision,0);assert.equal(r.home.people.length,0);});
test('corrupted JSON recovers connection from independent record',()=>{const db=storage();saveSession(db,shared());db.setItem(STORAGE,'broken');const r=restoreSession(db);assert.equal(r.key,key);assert.equal(r.mode,'shared');assert.equal(r.myId,'spandan');});
test('missing cache still recovers shared connection',()=>{const db=storage();saveSession(db,shared());db.removeItem(STORAGE);assert.equal(restoreSession(db).key,key);});
test('legacy demo cannot masquerade as a real household',()=>{const db=storage();db.setItem(STORAGE,JSON.stringify({mode:'demo',home:demoHome()}));assert.equal(restoreSession(db).mode,'welcome');});
test('personal households survive reopening and intentionally replace recovery record',()=>{const db=storage();saveSession(db,shared());const local={...shared(),mode:'local',key:''};saveSession(db,local);assert.equal(db.getItem(CONNECTION),null);assert.equal(restoreSession(db).home.id,local.home.id);assert.equal(restoreSession(db).mode,'local');});
test('blocked device storage reports failure without inventing demo data',()=>{const db={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};assert.equal(saveSession(db,shared()),false);assert.equal(restoreSession(db).mode,'welcome');});

test('welcome remains welcome after reopening before joining',()=>{const db=storage();saveSession(db,restoreSession(db));assert.equal(restoreSession(db).mode,'welcome');});
