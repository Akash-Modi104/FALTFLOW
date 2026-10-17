// This project serves only the Flatflow spreadsheet identified below.
// Keep the spreadsheet private. The web app serves a message bridge only;
// every data operation requires a randomly generated household capability key.
const SPREADSHEET_ID = '__SPREADSHEET_ID__';
const ALLOWED_ORIGINS = ['https://akash-modi104.github.io','http://localhost:4173','http://127.0.0.1:4173'];

function doGet(e) {
  const origin = String(e.parameter.origin || '');
  const nonce = String(e.parameter.nonce || '');
  if (ALLOWED_ORIGINS.indexOf(origin) < 0 || !/^[\w-]{20,80}$/.test(nonce))
    return HtmlService.createHtmlOutput('Flatflow backend is ready. Open the Flatflow app to connect.');
  const config = JSON.stringify({origin:origin,nonce:nonce}).replace(/</g,'\\u003c');
  const html = '<!doctype html><meta charset="utf-8"><script>'+
    'const config='+config+';'+
    'function reply(data){window.top.postMessage(Object.assign({channel:"flatflow",nonce:config.nonce},data),config.origin)};'+
    'window.addEventListener("message",function(e){if(e.source!==window.top||e.origin!==config.origin)return;const d=e.data;if(!d||d.channel!=="flatflow"||d.nonce!==config.nonce)return;'+
    'google.script.run.withSuccessHandler(function(result){reply({id:d.id,result:result})}).withFailureHandler(function(err){reply({id:d.id,error:err.message||"Sync failed"})}).rpc(d.payload)});'+
    'reply({type:"ready"});</script>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s)).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function sheet_(){return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Homes');}
function readRow_(s,row){const values=s.getRange(row,1,1,5).getValues()[0];return {hash:values[0],revision:Number(values[1]),home:JSON.parse(values[3]),op:String(values[4])};}
function saveRow_(s,row,entry,op){validateHome_(entry.home);s.getRange(row,1,1,5).setValues([[entry.hash,entry.revision,new Date().toISOString(),JSON.stringify(entry.home),op||'']]);SpreadsheetApp.flush();}
function publicResult_(entry){return {ok:true,revision:entry.revision,home:entry.home};}

// The sole remotely callable data function. Private helpers end in underscore.
function rpc(request) {
  if(request&&ACCOUNT_ACTIONS.indexOf(request.action)>=0)return accountOperation_(request);
  if(!request||!request.key||!/^[a-f0-9]{64}$/.test(request.key))throw new Error('Invalid household invitation.');
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    const s=sheet_();if(!s)throw new Error('Homes sheet not found.');
    const hash=hash_(request.key),last=s.getLastRow();
    const rows=last>1?s.getRange(2,1,last-1,1).getValues():[];
    const index=rows.findIndex(r=>r[0]===hash),row=index+2;
    if(request.action==='create'){
      if(index>=0)return publicResult_(readRow_(s,row));
      if(last>50)throw new Error('Household limit reached. Ask the app owner.');
      validateHome_(request.home);
      const entry={hash:hash,revision:1,home:request.home};
      entry.home.people.forEach(p=>{delete p.email;delete p.emailVerified;});
      saveRow_(s,last+1,entry,request.op);return publicResult_(entry);
    }
    if(index<0)throw new Error('Household not found. Ask your flatmate for the invitation link.');
    const entry=readRow_(s,row);
    if(rollOver_(entry.home,Utilities.formatDate(new Date(),'Europe/Berlin','yyyy-MM-dd'))){entry.revision++;saveRow_(s,row,entry,'rollover-'+Utilities.getUuid());}
    if(request.action==='read')return Number(request.revision)===entry.revision?{ok:true,unchanged:true,revision:entry.revision}:publicResult_(entry);
    if(request.action==='write'){
      if(typeof request.op!=='string'||!/^[\w-]{20,80}$/.test(request.op))throw new Error('Invalid operation.');
      if(entry.op===request.op)return publicResult_(entry);
      if(Number(request.revision)!==entry.revision)return {ok:false,conflict:true,revision:entry.revision,home:entry.home};
      validateHome_(request.home);
      // Verification is controlled by the server, never by editable JSON.
      request.home.people.forEach(p=>{const previous=entry.home.people.find(x=>x.id===p.id);if(previous&&previous.emailVerified){p.email=previous.email;p.emailVerified=true;}else{delete p.email;delete p.emailVerified;}});
      entry.home=request.home;entry.revision++;saveRow_(s,row,entry,request.op);return publicResult_(entry);
    }
    if(['pushConfig','subscribePush','unsubscribePush','testPush'].includes(request.action))return pushOperation_(request,entry);
    throw new Error('Unsupported operation.');
  } finally {lock.releaseLock();}
}

