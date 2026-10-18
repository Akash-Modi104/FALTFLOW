import {emptyHome,validateHome} from './core.js?v=28';
export const STORAGE='flatflow-v1', CONNECTION='flatflow-connection-v1';
export const validKey=k=>typeof k==='string'&&/^[a-f0-9]{64}$/.test(k);
export function restoreSession(storage,backend=''){
  const fresh={home:emptyHome('Your household'),mode:'welcome',key:'',revision:0,myId:'',backend,storageOK:true};
  let saved=null,connection=null;
  try{saved=JSON.parse(storage.getItem(STORAGE)||'null');}catch{fresh.storageOK=false;}
  try{connection=JSON.parse(storage.getItem(CONNECTION)||'null');}catch{}
  const shared=saved?.mode==='shared'&&validKey(saved.key)?saved:validKey(connection?.key)?connection:null;
  if(shared){Object.assign(fresh,{mode:'shared',key:shared.key,myId:shared.myId||'',backend:backend||shared.backend||''});}
  if(saved&&['local','shared'].includes(saved.mode)){
    try{const h=validateHome(saved.home);if(!shared||saved.key===shared.key){fresh.home=h;fresh.revision=saved.revision||0;if(!shared)fresh.mode='local';fresh.myId=saved.myId||'';}}
    catch{fresh.storageOK=false;}
  }
  return fresh;
}
export function saveSession(storage,state){
  // Keep connection recovery independent of household-cache parsing/validation.
  const connection=state.mode==='shared'?{key:state.key,myId:state.myId,backend:state.backend}:null;
  let ok=true;
  try{if(connection)storage.setItem(CONNECTION,JSON.stringify(connection));else storage.removeItem(CONNECTION);}catch{ok=false;}
  try{storage.setItem(STORAGE,JSON.stringify(state));}catch{ok=false;}
  return ok;
}
// Every home opened on this device, so flatmates can belong to several homes
// and switch between them. Shared homes are identified by their invitation key,
// personal homes by their household id. Each entry keeps the last cached copy.
export const HOMES='flatflow-homes-v1';
export const homeEntryId=s=>s.mode==='shared'?'shared:'+s.key:'local:'+s.home.id;
export function listHomes(storage){
  try{const list=JSON.parse(storage.getItem(HOMES)||'[]');return Array.isArray(list)?list.filter(e=>e&&(e.mode==='shared'?validKey(e.key):e.mode==='local')&&e.home&&typeof e.home.name==='string'):[];}catch{return [];}
}
export function rememberHome(storage,state){
  if(!['shared','local'].includes(state.mode)||(state.mode==='shared'&&!validKey(state.key)))return false;
  const entry={id:homeEntryId(state),mode:state.mode,key:state.mode==='shared'?state.key:'',revision:state.revision||0,myId:state.myId||'',backend:state.backend||'',home:state.home,opened:new Date().toISOString()};
  const list=listHomes(storage).filter(e=>e.id!==entry.id);list.push(entry);
  try{storage.setItem(HOMES,JSON.stringify(list.slice(-20)));return true;}catch{return false;}
}
export function forgetHome(storage,id){
  const list=listHomes(storage).filter(e=>e.id!==id);
  try{storage.setItem(HOMES,JSON.stringify(list));return true;}catch{return false;}
}
// Restores a remembered home. A cached copy that no longer validates is
// replaced by an empty placeholder; shared homes then reload from the server.
export function openHome(entry,backend=''){
  let home,cached=true;
  try{home=validateHome(structuredClone(entry.home));}
  catch{if(entry.mode!=='shared')throw new Error('This saved home is damaged. Import a backup instead.');home=emptyHome(entry.home.name||'Your household');cached=false;}
  return {home,mode:entry.mode,key:entry.key||'',revision:cached?entry.revision||0:0,myId:entry.myId||'',backend:backend||entry.backend||''};
}
