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
    const p=entry.home.people.find(p=>p.id===request.person);
    if(!p)throw new Error('Person not found.');
    const props=PropertiesService.getScriptProperties(),prop='verify_'+hash+'_'+p.id;
    if(request.action==='requestEmail'){
      const email=String(request.email||'').trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)throw new Error('Enter a valid email address.');
      const previous=props.getProperty(prop);if(previous&&Date.now()-JSON.parse(previous).at<3600000)throw new Error('Please wait an hour before requesting another code.');
      if(MailApp.getRemainingDailyQuota()<5)throw new Error('Email limit reached. Try tomorrow or use calendar reminders.');
      const code=String(Math.floor(100000+Math.random()*900000));
      props.setProperty(prop,JSON.stringify({email:email,code:hash_(code),at:Date.now(),attempts:0}));
      MailApp.sendEmail(email,'Verify your Flatflow reminders','Your code is '+code+'. It expires in 15 minutes. Enter it in Flatflow to subscribe to daily chore reminders. If you did not request this, ignore this email.');
      return {ok:true,sent:true};
    }
    if(request.action==='verifyEmail'){
      const raw=props.getProperty(prop);if(!raw)throw new Error('Request a verification code first.');const v=JSON.parse(raw);
      if(Date.now()-v.at>900000||v.attempts>=5)throw new Error('Code expired. Request a new one in an hour.');
      v.attempts++;props.setProperty(prop,JSON.stringify(v));
      if(hash_(String(request.code))!==v.code)throw new Error('Incorrect verification code.');
      p.email=v.email;p.emailVerified=true;props.deleteProperty(prop);entry.revision++;saveRow_(s,row,entry,'email-'+Utilities.getUuid());return publicResult_(entry);
    }
    if(request.action==='unsubscribeEmail'){delete p.email;delete p.emailVerified;entry.revision++;saveRow_(s,row,entry,'email-'+Utilities.getUuid());return publicResult_(entry);}
    throw new Error('Unsupported operation.');
  } finally {lock.releaseLock();}
}

// Run once in the Apps Script editor after reviewing Google's permissions.
// The reminder trigger runs once daily at about 09:00 Europe/Berlin.
function installDailyReminders_() {
  sheet_();
  const existing=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sendDailyReminders_');
  if(!existing.length)ScriptApp.newTrigger('sendDailyReminders_').timeBased().everyDays(1).atHour(9).inTimezone('Europe/Berlin').create();
  console.log('Daily reminders installed. '+MailApp.getRemainingDailyQuota()+' recipients remaining today.');
}
function sendDailyReminders_(){
  const s=sheet_(),last=s.getLastRow();if(last<2)return;
  const today=Utilities.formatDate(new Date(),'Europe/Berlin','yyyy-MM-dd'),props=PropertiesService.getScriptProperties();
  for(let row=2;row<=last;row++){
    let entry;
    const lock=LockService.getScriptLock();lock.waitLock(15000);
    try{entry=readRow_(s,row);if(rollOver_(entry.home,today)){entry.revision++;saveRow_(s,row,entry,'rollover-'+Utilities.getUuid());}}finally{lock.releaseLock();}
    const h=entry.home;
    for(const p of h.people){
      if(!p.emailVerified||!p.email||away_(p,today))continue;
      const due=h.tasks.filter(t=>!t.paused&&t.due<=today&&assignee_(t,h.people)?.id===p.id);
      const key='sent_'+entry.hash+'_'+p.id;
      if(!due.length||props.getProperty(key)===today||MailApp.getRemainingDailyQuota()<1)continue;
      MailApp.sendEmail(p.email,'Your Flatflow chores · '+h.name,'Hi '+p.name+',\n\nYour chores for today:\n'+due.map(t=>'• '+t.title+' ('+t.minutes+' min; due '+t.due+')').join('\n')+'\n\nOpen your saved Flatflow household invitation to mark them done. Unsubscribe anytime in Flatflow Settings → Email reminders.');
      props.setProperty(key,today);
    }
  }
}
