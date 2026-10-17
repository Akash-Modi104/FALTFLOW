// Push endpoints are stored privately, separately from shared household JSON.
// Only official Apple, Google and Mozilla push services may receive requests.
function pushEndpoint_(endpoint) {
  if(typeof endpoint!=='string'||endpoint.length>2048||!/^https:\/\/(?:fcm\.googleapis\.com\/fcm\/send\/|web\.push\.apple\.com\/|updates\.push\.services\.mozilla\.com\/wpush\/v2\/)[A-Za-z0-9_\-\/.?=&%]+$/.test(endpoint))throw new Error('Unsupported notification service. Use Safari, Chrome, Edge, or Firefox.');
  return endpoint;
}
// One record per device and home, so a phone can get reminders for several homes.
function pushId_(endpoint,home){return 'device_'+hash_(pushEndpoint_(endpoint)+'|'+home);}
function pushConfig_(){const p=PropertiesService.getScriptProperties();return {publicKey:p.getProperty('VAPID_PUBLIC'),enabled:!!p.getProperty('VAPID_PRIVATE')&&ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='sendDailyPush_')};}
// Records created before multi-home support were keyed by endpoint alone.
function dropLegacyPush_(props,endpoint,home){const legacy='device_'+hash_(endpoint),raw=props.getProperty(legacy);if(raw&&JSON.parse(raw).home===home)props.deleteProperty(legacy);}
function pushOperation_(request,entry){
  const props=PropertiesService.getScriptProperties();
  if(request.action==='pushConfig')return pushConfig_();
  const endpoint=pushEndpoint_(request.endpoint),id=pushId_(endpoint,entry.hash),raw=props.getProperty(id),old=raw?JSON.parse(raw):null;
  if(request.action==='subscribePush'){
    if(!entry.home.people.some(p=>p.id===request.person))throw new Error('Choose your name first.');
    const devices=Object.keys(props.getProperties()).filter(k=>k.startsWith('device_')).map(k=>JSON.parse(props.getProperty(k)));
    if(!old&&devices.filter(d=>d.home===entry.hash).length>=30)throw new Error('This home has reached its 30-device limit.');
    if(!old&&devices.length>=200)throw new Error('Device capacity reached.');
    dropLegacyPush_(props,endpoint,entry.hash);
    const keys=pushKeys_(request.keys)||old?.keys||null;
    props.setProperty(id,JSON.stringify({home:entry.hash,person:request.person,endpoint:endpoint,keys:keys,sent:old?.sent||'',testAt:old?.testAt||0}));
    return {ok:true,enabled:true};
  }
  if(request.action==='unsubscribePush'){
    props.deleteProperty(id);
    dropLegacyPush_(props,endpoint,entry.hash);
    return {ok:true};
  }
  if(!old||old.home!==entry.hash)throw new Error('Enable notifications on this device first.');

  if(request.action==='testPush'){
    if(Date.now()-old.testAt<60000)throw new Error('Wait a minute before sending another test.');
    old.testAt=Date.now();props.setProperty(id,JSON.stringify(old));
    const code=sendPush_(endpoint);if(code===404||code===410){props.deleteProperty(id);throw new Error('Device subscription expired. Enable notifications again.');}
    if(code<200||code>=300)throw new Error('Notification service returned '+code+'. Try again later.');
    return {ok:true,sent:true};
  }
  throw new Error('Unsupported notification operation.');
}
function b64url_(value){return Utilities.base64EncodeWebSafe(value).replace(/=+$/,'');}
function sendPush_(endpoint,message,keys){
  pushEndpoint_(endpoint);
  const props=PropertiesService.getScriptProperties(),privateKey=props.getProperty('VAPID_PRIVATE'),publicKey=props.getProperty('VAPID_PUBLIC');
  if(!privateKey||!publicKey)throw new Error('Phone reminders are not configured yet.');
  const audience=endpoint.match(/^https:\/\/[^/]+/)[0];
  const header=b64url_('{"typ":"JWT","alg":"ES256"}');
  const claims=b64url_(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:'mailto:developer.akash1043@gmail.com'}));
  const input=header+'.'+claims;
  const signature=FlatflowPushCrypto.sign(input,privateKey).map(v=>v>127?v-256:v);
  const jwt=input+'.'+b64url_(signature);
  const headers={Authorization:'vapid t='+jwt+', k='+publicKey,TTL:'3600',Urgency:'normal'};
  let payload='';
  if(message&&keys){headers['Content-Encoding']='aes128gcm';payload=FlatflowPushCrypto.encrypt(JSON.stringify(message),keys.p256dh,keys.auth,randomBytes_(48)).map(v=>v>127?v-256:v);}
  return UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/octet-stream',headers:headers,payload:payload,muteHttpExceptions:true,followRedirects:false}).getResponseCode();
}
// Install from the editor. Never include private VAPID keys in source or GitHub.
function setupPhoneReminders(){
  if(Session.getActiveUser().getEmail()!=='developer.akash1043@gmail.com')throw new Error('Run setup from the owner’s Apps Script editor.');
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('VAPID_PRIVATE')||!props.getProperty('VAPID_PUBLIC'))throw new Error('Set the two VAPID script properties first.');
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sendDailyReminders_').forEach(t=>ScriptApp.deleteTrigger(t));
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='sendDailyPush_'))ScriptApp.newTrigger('sendDailyPush_').timeBased().everyDays(1).atHour(9).inTimezone('Europe/Berlin').create();
  console.log('Phone reminder schedule enabled for 09:00–10:00 Berlin time. No emails are sent.');
}
function sendDailyPush_(){
  const props=PropertiesService.getScriptProperties(),all=props.getProperties(),s=sheet_(),today=Utilities.formatDate(new Date(),'Europe/Berlin','yyyy-MM-dd');
  const homes={};
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try{for(let row=2;row<=s.getLastRow();row++){const entry=readRow_(s,row);if(rollOver_(entry.home,today)){entry.revision++;saveRow_(s,row,entry,'rollover-'+Utilities.getUuid());}homes[entry.hash]=entry.home;}}finally{lock.releaseLock();}
  for(const id of Object.keys(all).filter(k=>k.startsWith('device_'))){
    const d=JSON.parse(all[id]),h=homes[d.home],person=h?.people.find(p=>p.id===d.person);
    if(!person||away_(person,today)||d.sent===today)continue;
    if(!h.tasks.some(t=>!t.paused&&t.due<=today&&assignee_(t,h.people)?.id===person.id))continue;
    try{const status=sendPush_(d.endpoint);if(status===404||status===410){props.deleteProperty(id);continue;}if(status>=200&&status<300){
      const latest=props.getProperty(id);if(latest){const current=JSON.parse(latest);if(current.home===d.home&&current.person===d.person){current.sent=today;props.setProperty(id,JSON.stringify(current));}}
    }else console.log('Push delivery status '+status);}catch(e){console.log('Push service unavailable; device will be retried next day.');}
  }
}

// Browser subscription keys let the server send an end-to-end encrypted message.
function pushKeys_(keys){
  if(!keys||typeof keys!=='object')return null;
  const p256dh=String(keys.p256dh||''),auth=String(keys.auth||'');
  return /^[\w-]{86,88}$/.test(p256dh)&&/^[\w-]{21,24}$/.test(auth)?{p256dh:p256dh,auth:auth}:null;
}
function randomBytes_(n){
  let out=[];
  while(out.length<n)out=out.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,Utilities.getUuid()+Utilities.getUuid()+Date.now()).map(b=>(b+256)%256));
  return out.slice(0,n);
}
// After a write, tells the flatmates involved about newly added expenses and payments.
// Only devices that shared their encryption keys get a message; nobody gets one for their own payment.
function notifyExpenses_(homeHash,before,after){
  const known={};(before.expenses||[]).forEach(e=>known[e.id]=true);
  const added=(after.expenses||[]).filter(e=>!known[e.id]&&e.title!=='Earlier balances');
  if(!added.length)return;
  const name=id=>(after.people.find(p=>p.id===id)||{}).name||'A flatmate',money=(e,c)=>(e.currency||after.currency||'EUR')+' '+(c/100).toFixed(2);
  const messages={};
  for(const e of added)for(const id of Object.keys(e.shares)){
    // Co-payers who covered their own share have nothing to hear about.
    if(id===e.paidBy||!e.shares[id]||(e.payers&&(e.payers[id]||0)>=e.shares[id]))continue;
    (messages[id]=messages[id]||[]).push(e.kind==='settle'?name(e.paidBy)+' paid you '+money(e,e.amount):name(e.paidBy)+' added '+e.title+' · your share '+money(e,e.shares[id]));
  }
  const props=PropertiesService.getScriptProperties(),all=props.getProperties();let sent=0;
  for(const key of Object.keys(all).filter(k=>k.indexOf('device_')===0)){
    const d=JSON.parse(all[key]),lines=messages[d.person];
    if(d.home!==homeHash||!lines||!d.keys||sent>=20)continue;
    const message={title:after.name+' · '+(lines.length===1?'New expense':lines.length+' new expenses'),body:lines.length>3?lines.length+' new expenses and payments involve you.':lines.join('\n'),tag:'flatflow-expense'};
    try{const status=sendPush_(d.endpoint,message,d.keys);sent++;if(status===404||status===410)props.deleteProperty(key);}catch(err){console.log('Expense notification failed: '+err.message);}
  }
}
