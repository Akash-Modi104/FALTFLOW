import {emptyHome,validateHome} from './core.js?v=4';
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
