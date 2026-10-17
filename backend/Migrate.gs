// Copies every home, account, session and phone subscription to the Cloudflare
// backend. Run from the owner's editor after setting the script properties
// CLOUDFLARE_URL (the worker address) and MIGRATION_TOKEN (the same value as the
// worker's secret). It only reads from this project, so it can be run again
// right before switching the app over; newer copies are never overwritten.
function migrateToCloudflare(){
  if(Session.getActiveUser().getEmail()!=='developer.akash1043@gmail.com')throw new Error('Run the migration from the owner’s Apps Script editor.');
  const props=PropertiesService.getScriptProperties(),url=String(props.getProperty('CLOUDFLARE_URL')||'').replace(/\/+$/,''),token=props.getProperty('MIGRATION_TOKEN');
  if(!/^https:\/\/[\w.-]+$/.test(url)||!token)throw new Error('Set the CLOUDFLARE_URL and MIGRATION_TOKEN script properties first.');
  const send=body=>{
    const response=UrlFetchApp.fetch(url+'/migrate',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token},payload:JSON.stringify(body),muteHttpExceptions:true,followRedirects:false});
    if(response.getResponseCode()!==200)throw new Error('Cloudflare returned '+response.getResponseCode()+': '+response.getContentText().slice(0,300));
    return JSON.parse(response.getContentText()).imported;
  };
  const s=sheet_(),last=s.getLastRow(),rows=last>1?s.getRange(2,1,last-1,5).getValues():[];
  let homes=0,records=0;
  for(let i=0;i<rows.length;i+=10){
    const chunk=rows.slice(i,i+10).filter(r=>r[0]).map(r=>({hash:String(r[0]),revision:Number(r[1]),updatedAt:r[2] instanceof Date?r[2].toISOString():String(r[2]),home:String(r[3]),op:String(r[4]||'')}));
    if(chunk.length)homes+=send({homes:chunk});
  }
  const all=props.getProperties(),names=Object.keys(all).filter(k=>/^(account|session|device)_[a-f0-9]{64}$/.test(k));
  for(let i=0;i<names.length;i+=50){const properties={};names.slice(i,i+50).forEach(k=>properties[k]=all[k]);records+=send({properties:properties});}
  console.log('Copied '+homes+' homes and '+records+' accounts, sessions and devices to '+url+'.');
}
