// Personal accounts through Google sign-in. Google verifies the person; this
// backend then issues its own long-lived session so phones stay signed in.
// An account remembers which homes (invitation keys) it belongs to and who the
// person is in each, so every home follows its flatmates to any device.
// Accounts and sessions live in private script properties, never in shared JSON.
const ACCOUNT_ACTIONS = ['authConfig','signIn','myHomes','linkHome','unlinkHome','signOut'];
const SESSION_DAYS = 90;

function accountOperation_(request) {
  const props=PropertiesService.getScriptProperties();
  if(request.action==='authConfig'){const id=props.getProperty('GOOGLE_CLIENT_ID');return {enabled:!!id,clientId:id||''};}
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    if(request.action==='signIn')return signIn_(props,request.idToken);
    const sessionId='session_'+hash_(String(request.session||'')),session=JSON.parse(props.getProperty(sessionId)||'null');
    if(!/^[a-f0-9]{64}$/.test(String(request.session||''))||!session||session.exp<Date.now()){if(session)props.deleteProperty(sessionId);throw new Error('Your sign-in has expired. Sign in again.');}
    if(request.action==='signOut'){props.deleteProperty(sessionId);return {ok:true};}
    const account=readAccount_(props,session.sub);if(!account)throw new Error('Your sign-in has expired. Sign in again.');
    if(request.action==='linkHome'){
      if(!/^[a-f0-9]{64}$/.test(String(request.key||'')))throw new Error('Invalid household invitation.');
      const found=findHome_(request.key);if(!found)throw new Error('Household not found. Ask your flatmate for the invitation link.');
      const person=String(request.person||'');if(person&&!found.home.people.some(p=>p.id===person))throw new Error('Choose your name first.');
      const existing=account.homes.find(h=>h.key===request.key);
      if(existing){if(person||request.person==='')existing.person=person;}
      else{if(account.homes.length>=20)throw new Error('An account can belong to up to 20 homes.');account.homes.push({key:request.key,person:person});}
      saveAccount_(props,session.sub,account);return accountResult_(account);
    }
    if(request.action==='unlinkHome'){account.homes=account.homes.filter(h=>h.key!==request.key);saveAccount_(props,session.sub,account);return accountResult_(account);}
    if(request.action==='myHomes')return accountResult_(account);
    throw new Error('Unsupported operation.');
  } finally {lock.releaseLock();}
}

function signIn_(props,idToken) {
  const clientId=props.getProperty('GOOGLE_CLIENT_ID');
  if(!clientId)throw new Error('Sign-in is not set up for this Flatflow yet.');
  if(typeof idToken!=='string'||idToken.length>4096||!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken))throw new Error('Google sign-in failed. Try again.');
  const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(idToken),{muteHttpExceptions:true,followRedirects:false});
  if(response.getResponseCode()!==200)throw new Error('Google sign-in failed. Try again.');
  const claims=JSON.parse(response.getContentText());
  if(claims.aud!==clientId||['accounts.google.com','https://accounts.google.com'].indexOf(claims.iss)<0||Number(claims.exp)*1000<Date.now()||!/^\d{1,40}$/.test(String(claims.sub)))throw new Error('Google sign-in failed. Try again.');
  if(String(claims.email_verified)!=='true')throw new Error('Verify your Google email address, then sign in again.');
  const sub=String(claims.sub),account=readAccount_(props,sub)||{homes:[]};
  account.email=String(claims.email||'').slice(0,200);account.name=String(claims.name||claims.email||'').slice(0,100);
  saveAccount_(props,sub,account);
  // Keep at most 10 active sessions per account; expired sessions are cleaned up here.
  const all=props.getProperties(),mine=[];
  for(const id of Object.keys(all).filter(k=>k.indexOf('session_')===0)){const s=JSON.parse(all[id]);if(s.exp<Date.now())props.deleteProperty(id);else if(s.sub===sub)mine.push({id:id,exp:s.exp});}
  mine.sort((a,b)=>a.exp-b.exp).slice(0,Math.max(0,mine.length-9)).forEach(s=>props.deleteProperty(s.id));
  const token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'').toLowerCase();
  props.setProperty('session_'+hash_(token),JSON.stringify({sub:sub,exp:Date.now()+SESSION_DAYS*864e5}));
  const result=accountResult_(account);result.session=token;return result;
}

function readAccount_(props,sub){const raw=props.getProperty('account_'+hash_(sub));return raw?JSON.parse(raw):null;}
function saveAccount_(props,sub,account){props.setProperty('account_'+hash_(sub),JSON.stringify(account));}
function findHome_(key){
  const s=sheet_(),last=s.getLastRow(),hash=hash_(key);if(last<2)return null;
  const index=s.getRange(2,1,last-1,1).getValues().findIndex(r=>r[0]===hash);
  return index<0?null:readRow_(s,index+2);
}
// Lists the account's homes that still exist, with their current names.
function accountResult_(account){
  const homes=[];
  for(const h of account.homes){const found=findHome_(h.key);if(found)homes.push({key:h.key,person:found.home.people.some(p=>p.id===h.person)?h.person:'',name:found.home.name});}
  return {ok:true,account:{name:account.name,email:account.email},homes:homes};
}
