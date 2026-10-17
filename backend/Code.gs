// This project serves only the Flatflow spreadsheet identified below.
// Keep the spreadsheet private. The web app serves a message bridge only;
// every data operation requires a randomly generated household capability key.
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID';
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
  if(request&&request.action==='redeemInvite')return redeemInvite_(request);
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
    if(request.action==='createInvite')return createInvite_(request,entry);
    if(request.action==='read')return Number(request.revision)===entry.revision?{ok:true,unchanged:true,revision:entry.revision}:publicResult_(entry);
    if(request.action==='write'){
      if(typeof request.op!=='string'||!/^[\w-]{20,80}$/.test(request.op))throw new Error('Invalid operation.');
      if(entry.op===request.op)return publicResult_(entry);
      if(Number(request.revision)!==entry.revision)return {ok:false,conflict:true,revision:entry.revision,home:entry.home};
      validateHome_(request.home);
      // Verification is controlled by the server, never by editable JSON.
      request.home.people.forEach(p=>{const previous=entry.home.people.find(x=>x.id===p.id);if(previous&&previous.emailVerified){p.email=previous.email;p.emailVerified=true;}else{delete p.email;delete p.emailVerified;}});
      const before=entry.home;entry.home=request.home;entry.revision++;saveRow_(s,row,entry,request.op);
      try{notifyExpenses_(entry.hash,before,entry.home);}catch(err){console.log('Notifications skipped: '+err.message);}
      return publicResult_(entry);
    }
    if(['pushConfig','subscribePush','unsubscribePush','testPush'].includes(request.action))return pushOperation_(request,entry);
    throw new Error('Unsupported operation.');
  } finally {lock.releaseLock();}
}


// Short invite codes. The app encrypts the household key with the code before
// sending it, so only that sealed copy is kept, filed under a hash of the code.
// Codes last 7 days; a home keeps its 3 newest.
const INVITE_DAYS=7;
function createInvite_(request,entry){
  if(!/^[a-f0-9]{64}$/.test(String(request.invite||''))||typeof request.sealed!=='string'||!/^[\w-]{40,200}$/.test(request.sealed))throw new Error('Invalid invite code.');
  const props=PropertiesService.getScriptProperties(),all=props.getProperties(),now=Date.now(),mine=[];let total=0;
  for(const k of Object.keys(all).filter(k=>k.indexOf('invite_')===0)){const v=JSON.parse(all[k]);if(v.exp<now){props.deleteProperty(k);continue;}total++;if(v.home===entry.hash)mine.push({k:k,exp:v.exp});}
  mine.sort((a,b)=>a.exp-b.exp).slice(0,Math.max(0,mine.length-2)).forEach(x=>{props.deleteProperty(x.k);total--;});
  if(total>=300)throw new Error('Too many open invite codes. Try again tomorrow, or share the link.');
  const exp=now+INVITE_DAYS*864e5;props.setProperty('invite_'+request.invite,JSON.stringify({home:entry.hash,sealed:request.sealed,exp:exp}));
  return {ok:true,expires:new Date(exp).toISOString()};
}
function redeemInvite_(request){
  const id=String(request.invite||'');if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Check the invite code and try again.');
  const v=JSON.parse(PropertiesService.getScriptProperties().getProperty('invite_'+id)||'null');
  if(!v||v.exp<Date.now())throw new Error('That invite code is wrong or has expired. Ask for a new one.');
  return {ok:true,sealed:v.sealed};
}

var FlatflowPushCrypto=(()=>{var Se=Object.defineProperty;var cr=Object.getOwnPropertyDescriptor;var ar=Object.getOwnPropertyNames;var ur=Object.prototype.hasOwnProperty;var lr=(t,e)=>{for(var r in e)Se(t,r,{get:e[r],enumerable:!0})},dr=(t,e,r,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let o of ar(e))!ur.call(t,o)&&o!==r&&Se(t,o,{get:()=>e[o],enumerable:!(n=cr(e,o))||n.enumerable});return t};var hr=t=>dr(Se({},"__esModule",{value:!0}),t);var co={};lr(co,{encrypt:()=>fo,sign:()=>so});var Bt=typeof globalThis=="object"&&"crypto"in globalThis?globalThis.crypto:void 0;function St(t){return t instanceof Uint8Array||ArrayBuffer.isView(t)&&t.constructor.name==="Uint8Array"}function vt(t){if(!Number.isSafeInteger(t)||t<0)throw new Error("positive integer expected, got "+t)}function J(t,...e){if(!St(t))throw new Error("Uint8Array expected");if(e.length>0&&!e.includes(t.length))throw new Error("Uint8Array expected of length "+e+", got length="+t.length)}function At(t){if(typeof t!="function"||typeof t.create!="function")throw new Error("Hash should be wrapped by utils.createHasher");vt(t.outputLen),vt(t.blockLen)}function Ct(t,e=!0){if(t.destroyed)throw new Error("Hash instance has been destroyed");if(e&&t.finished)throw new Error("Hash#digest() has already been called")}function tn(t,e){J(t);let r=e.outputLen;if(t.length<r)throw new Error("digestInto() expects output buffer of length at least "+r)}function F(...t){for(let e=0;e<t.length;e++)t[e].fill(0)}function Ft(t){return new DataView(t.buffer,t.byteOffset,t.byteLength)}function tt(t,e){return t<<32-e|t>>>e}var en=typeof Uint8Array.from([]).toHex=="function"&&typeof Uint8Array.fromHex=="function",pr=Array.from({length:256},(t,e)=>e.toString(16).padStart(2,"0"));function lt(t){if(J(t),en)return t.toHex();let e="";for(let r=0;r<t.length;r++)e+=pr[t[r]];return e}var ut={_0:48,_9:57,A:65,F:70,a:97,f:102};function Fe(t){if(t>=ut._0&&t<=ut._9)return t-ut._0;if(t>=ut.A&&t<=ut.F)return t-(ut.A-10);if(t>=ut.a&&t<=ut.f)return t-(ut.a-10)}function _t(t){if(typeof t!="string")throw new Error("hex string expected, got "+typeof t);if(en)return Uint8Array.fromHex(t);let e=t.length,r=e/2;if(e%2)throw new Error("hex string expected, got unpadded hex of length "+e);let n=new Uint8Array(r);for(let o=0,s=0;o<r;o++,s+=2){let i=Fe(t.charCodeAt(s)),f=Fe(t.charCodeAt(s+1));if(i===void 0||f===void 0){let c=t[s]+t[s+1];throw new Error('hex string expected, got non-hex character "'+c+'" at index '+s)}n[o]=i*16+f}return n}function nn(t){if(typeof t!="string")throw new Error("string expected");return new Uint8Array(new TextEncoder().encode(t))}function bt(t){return typeof t=="string"&&(t=nn(t)),J(t),t}function et(...t){let e=0;for(let n=0;n<t.length;n++){let o=t[n];J(o),e+=o.length}let r=new Uint8Array(e);for(let n=0,o=0;n<t.length;n++){let s=t[n];r.set(s,o),o+=s.length}return r}var Tt=class{};function te(t){let e=n=>t().update(bt(n)).digest(),r=t();return e.outputLen=r.outputLen,e.blockLen=r.blockLen,e.create=()=>t(),e}function ee(t=32){if(Bt&&typeof Bt.getRandomValues=="function")return Bt.getRandomValues(new Uint8Array(t));if(Bt&&typeof Bt.randomBytes=="function")return Uint8Array.from(Bt.randomBytes(t));throw new Error("crypto.getRandomValues must be defined")}var Ue=BigInt(0),_e=BigInt(1);function Zt(t,e=""){if(typeof t!="boolean"){let r=e&&`"${e}"`;throw new Error(r+"expected boolean, got type="+typeof t)}return t}function xt(t,e,r=""){let n=St(t),o=t?.length,s=e!==void 0;if(!n||s&&o!==e){let i=r&&`"${r}" `,f=s?` of length ${e}`:"",c=n?`length=${o}`:`type=${typeof t}`;throw new Error(i+"expected Uint8Array"+f+", got "+c)}return t}function Dt(t){let e=t.toString(16);return e.length&1?"0"+e:e}function rn(t){if(typeof t!="string")throw new Error("hex string expected, got "+typeof t);return t===""?Ue:BigInt("0x"+t)}function Nt(t){return rn(lt(t))}function Ie(t){return J(t),rn(lt(Uint8Array.from(t).reverse()))}function ne(t,e){return _t(t.toString(16).padStart(e*2,"0"))}function Le(t,e){return ne(t,e).reverse()}function P(t,e,r){let n;if(typeof e=="string")try{n=_t(e)}catch(s){throw new Error(t+" must be hex string or Uint8Array, cause: "+s)}else if(St(e))n=Uint8Array.from(e);else throw new Error(t+" must be hex string or Uint8Array");let o=n.length;if(typeof r=="number"&&o!==r)throw new Error(t+" of length "+r+" expected, got "+o);return n}var Ae=t=>typeof t=="bigint"&&Ue<=t;function on(t,e,r){return Ae(t)&&Ae(e)&&Ae(r)&&e<=t&&t<r}function sn(t,e,r,n){if(!on(e,r,n))throw new Error("expected valid "+t+": "+r+" <= n < "+n+", got "+e)}function re(t){let e;for(e=0;t>Ue;t>>=_e,e+=1);return e}var yt=t=>(_e<<BigInt(t))-_e;function fn(t,e,r){if(typeof t!="number"||t<2)throw new Error("hashLen must be a number");if(typeof e!="number"||e<2)throw new Error("qByteLen must be a number");if(typeof r!="function")throw new Error("hmacFn must be a function");let n=l=>new Uint8Array(l),o=l=>Uint8Array.of(l),s=n(t),i=n(t),f=0,c=()=>{s.fill(1),i.fill(0),f=0},u=(...l)=>r(i,s,...l),h=(l=n(0))=>{i=u(o(0),l),s=u(),l.length!==0&&(i=u(o(1),l),s=u())},d=()=>{if(f++>=1e3)throw new Error("drbg: tried 1000 values");let l=0,x=[];for(;l<e;){s=u();let y=s.slice();x.push(y),l+=s.length}return et(...x)};return(l,x)=>{c(),h(l);let y;for(;!(y=x(d()));)h();return c(),y}}function jt(t,e,r={}){if(!t||typeof t!="object")throw new Error("expected valid options object");function n(o,s,i){let f=t[o];if(i&&f===void 0)return;let c=typeof f;if(c!==s||f===null)throw new Error(`param "${o}" is invalid: expected ${s}, got ${c}`)}Object.entries(e).forEach(([o,s])=>n(o,s,!1)),Object.entries(r).forEach(([o,s])=>n(o,s,!0))}function He(t){let e=new WeakMap;return(r,...n)=>{let o=e.get(r);if(o!==void 0)return o;let s=t(r,...n);return e.set(r,s),s}}var Y=BigInt(0),z=BigInt(1),Ut=BigInt(2),un=BigInt(3),ln=BigInt(4),dn=BigInt(5),gr=BigInt(7),hn=BigInt(8),br=BigInt(9),pn=BigInt(16);function nt(t,e){let r=t%e;return r>=Y?r:e+r}function cn(t,e){if(t===Y)throw new Error("invert: expected non-zero number");if(e<=Y)throw new Error("invert: expected positive modulus, got "+e);let r=nt(t,e),n=e,o=Y,s=z,i=z,f=Y;for(;r!==Y;){let u=n/r,h=n%r,d=o-i*u,a=s-f*u;n=r,r=h,o=i,s=f,i=d,f=a}if(n!==z)throw new Error("invert: does not exist");return nt(o,e)}function Oe(t,e,r){if(!t.eql(t.sqr(e),r))throw new Error("Cannot find square root")}function gn(t,e){let r=(t.ORDER+z)/ln,n=t.pow(e,r);return Oe(t,n,e),n}function xr(t,e){let r=(t.ORDER-dn)/hn,n=t.mul(e,Ut),o=t.pow(n,r),s=t.mul(e,o),i=t.mul(t.mul(s,Ut),o),f=t.mul(s,t.sub(i,t.ONE));return Oe(t,f,e),f}function yr(t){let e=it(t),r=bn(t),n=r(e,e.neg(e.ONE)),o=r(e,n),s=r(e,e.neg(n)),i=(t+gr)/pn;return(f,c)=>{let u=f.pow(c,i),h=f.mul(u,n),d=f.mul(u,o),a=f.mul(u,s),l=f.eql(f.sqr(h),c),x=f.eql(f.sqr(d),c);u=f.cmov(u,h,l),h=f.cmov(a,d,x);let y=f.eql(f.sqr(h),c),S=f.cmov(u,h,y);return Oe(f,S,c),S}}function bn(t){if(t<un)throw new Error("sqrt is not defined for small field");let e=t-z,r=0;for(;e%Ut===Y;)e/=Ut,r++;let n=Ut,o=it(t);for(;an(o,n)===1;)if(n++>1e3)throw new Error("Cannot find square root: probably non-prime P");if(r===1)return gn;let s=o.pow(n,e),i=(e+z)/Ut;return function(c,u){if(c.is0(u))return u;if(an(c,u)!==1)throw new Error("Cannot find square root");let h=r,d=c.mul(c.ONE,s),a=c.pow(u,e),l=c.pow(u,i);for(;!c.eql(a,c.ONE);){if(c.is0(a))return c.ZERO;let x=1,y=c.sqr(a);for(;!c.eql(y,c.ONE);)if(x++,y=c.sqr(y),x===h)throw new Error("Cannot find square root");let S=z<<BigInt(h-x-1),L=c.pow(d,S);h=x,d=c.sqr(L),a=c.mul(a,d),l=c.mul(l,L)}return l}}function wr(t){return t%ln===un?gn:t%hn===dn?xr:t%pn===br?yr(t):bn(t)}var mr=["create","isValid","is0","neg","inv","sqrt","sqr","eql","add","sub","mul","pow","div","addN","subN","mulN","sqrN"];function Te(t){let e={ORDER:"bigint",MASK:"bigint",BYTES:"number",BITS:"number"},r=mr.reduce((n,o)=>(n[o]="function",n),e);return jt(t,r),t}function Er(t,e,r){if(r<Y)throw new Error("invalid exponent, negatives unsupported");if(r===Y)return t.ONE;if(r===z)return e;let n=t.ONE,o=e;for(;r>Y;)r&z&&(n=t.mul(n,o)),o=t.sqr(o),r>>=z;return n}function oe(t,e,r=!1){let n=new Array(e.length).fill(r?t.ZERO:void 0),o=e.reduce((i,f,c)=>t.is0(f)?i:(n[c]=i,t.mul(i,f)),t.ONE),s=t.inv(o);return e.reduceRight((i,f,c)=>t.is0(f)?i:(n[c]=t.mul(i,n[c]),t.mul(i,f)),s),n}function an(t,e){let r=(t.ORDER-z)/Ut,n=t.pow(e,r),o=t.eql(n,t.ONE),s=t.eql(n,t.ZERO),i=t.eql(n,t.neg(t.ONE));if(!o&&!s&&!i)throw new Error("invalid Legendre symbol result");return o?1:s?0:-1}function se(t,e){e!==void 0&&vt(e);let r=e!==void 0?e:t.toString(2).length,n=Math.ceil(r/8);return{nBitLength:r,nByteLength:n}}function it(t,e,r=!1,n={}){if(t<=Y)throw new Error("invalid field: expected ORDER > 0, got "+t);let o,s,i=!1,f;if(typeof e=="object"&&e!=null){if(n.sqrt||r)throw new Error("cannot specify opts in two arguments");let a=e;a.BITS&&(o=a.BITS),a.sqrt&&(s=a.sqrt),typeof a.isLE=="boolean"&&(r=a.isLE),typeof a.modFromBytes=="boolean"&&(i=a.modFromBytes),f=a.allowedLengths}else typeof e=="number"&&(o=e),n.sqrt&&(s=n.sqrt);let{nBitLength:c,nByteLength:u}=se(t,o);if(u>2048)throw new Error("invalid field: expected ORDER of <= 2048 bytes");let h,d=Object.freeze({ORDER:t,isLE:r,BITS:c,BYTES:u,MASK:yt(c),ZERO:Y,ONE:z,allowedLengths:f,create:a=>nt(a,t),isValid:a=>{if(typeof a!="bigint")throw new Error("invalid field element: expected bigint, got "+typeof a);return Y<=a&&a<t},is0:a=>a===Y,isValidNot0:a=>!d.is0(a)&&d.isValid(a),isOdd:a=>(a&z)===z,neg:a=>nt(-a,t),eql:(a,l)=>a===l,sqr:a=>nt(a*a,t),add:(a,l)=>nt(a+l,t),sub:(a,l)=>nt(a-l,t),mul:(a,l)=>nt(a*l,t),pow:(a,l)=>Er(d,a,l),div:(a,l)=>nt(a*cn(l,t),t),sqrN:a=>a*a,addN:(a,l)=>a+l,subN:(a,l)=>a-l,mulN:(a,l)=>a*l,inv:a=>cn(a,t),sqrt:s||(a=>(h||(h=wr(t)),h(d,a))),toBytes:a=>r?Le(a,u):ne(a,u),fromBytes:(a,l=!0)=>{if(f){if(!f.includes(a.length)||a.length>u)throw new Error("Field.fromBytes: expected "+f+" bytes, got "+a.length);let y=new Uint8Array(u);y.set(a,r?0:y.length-a.length),a=y}if(a.length!==u)throw new Error("Field.fromBytes: expected "+u+" bytes, got "+a.length);let x=r?Ie(a):Nt(a);if(i&&(x=nt(x,t)),!l&&!d.isValid(x))throw new Error("invalid field element: outside of range 0..ORDER");return x},invertBatch:a=>oe(d,a),cmov:(a,l,x)=>x?l:a});return Object.freeze(d)}function xn(t){if(typeof t!="bigint")throw new Error("field order must be bigint");let e=t.toString(2).length;return Math.ceil(e/8)}function Ce(t){let e=xn(t);return e+Math.ceil(e/2)}function yn(t,e,r=!1){let n=t.length,o=xn(e),s=Ce(e);if(n<16||n<s||n>1024)throw new Error("expected "+s+"-1024 bytes of input, got "+n);let i=r?Ie(t):Nt(t),f=nt(i,e-z)+z;return r?Le(f,o):ne(f,o)}function Br(t,e,r,n){if(typeof t.setBigUint64=="function")return t.setBigUint64(e,r,n);let o=BigInt(32),s=BigInt(4294967295),i=Number(r>>o&s),f=Number(r&s),c=n?4:0,u=n?0:4;t.setUint32(e+c,i,n),t.setUint32(e+u,f,n)}function wn(t,e,r){return t&e^~t&r}function mn(t,e,r){return t&e^t&r^e&r}var Pt=class extends Tt{constructor(e,r,n,o){super(),this.finished=!1,this.length=0,this.pos=0,this.destroyed=!1,this.blockLen=e,this.outputLen=r,this.padOffset=n,this.isLE=o,this.buffer=new Uint8Array(e),this.view=Ft(this.buffer)}update(e){Ct(this),e=bt(e),J(e);let{view:r,buffer:n,blockLen:o}=this,s=e.length;for(let i=0;i<s;){let f=Math.min(o-this.pos,s-i);if(f===o){let c=Ft(e);for(;o<=s-i;i+=o)this.process(c,i);continue}n.set(e.subarray(i,i+f),this.pos),this.pos+=f,i+=f,this.pos===o&&(this.process(r,0),this.pos=0)}return this.length+=e.length,this.roundClean(),this}digestInto(e){Ct(this),tn(e,this),this.finished=!0;let{buffer:r,view:n,blockLen:o,isLE:s}=this,{pos:i}=this;r[i++]=128,F(this.buffer.subarray(i)),this.padOffset>o-i&&(this.process(n,0),i=0);for(let d=i;d<o;d++)r[d]=0;Br(n,o-8,BigInt(this.length*8),s),this.process(n,0);let f=Ft(e),c=this.outputLen;if(c%4)throw new Error("_sha2: outputLen should be aligned to 32bit");let u=c/4,h=this.get();if(u>h.length)throw new Error("_sha2: outputLen bigger than state");for(let d=0;d<u;d++)f.setUint32(4*d,h[d],s)}digest(){let{buffer:e,outputLen:r}=this;this.digestInto(e);let n=e.slice(0,r);return this.destroy(),n}_cloneInto(e){e||(e=new this.constructor),e.set(...this.get());let{blockLen:r,buffer:n,length:o,finished:s,destroyed:i,pos:f}=this;return e.destroyed=i,e.finished=s,e.length=o,e.pos=f,o%r&&e.buffer.set(n),e}clone(){return this._cloneInto()}},dt=Uint32Array.from([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]);var Z=Uint32Array.from([3418070365,3238371032,1654270250,914150663,2438529370,812702999,355462360,4144912697,1731405415,4290775857,2394180231,1750603025,3675008525,1694076839,1203062813,3204075428]),D=Uint32Array.from([1779033703,4089235720,3144134277,2227873595,1013904242,4271175723,2773480762,1595750129,1359893119,2917565137,2600822924,725511199,528734635,4215389547,1541459225,327033209]);var ie=BigInt(4294967295),En=BigInt(32);function vr(t,e=!1){return e?{h:Number(t&ie),l:Number(t>>En&ie)}:{h:Number(t>>En&ie)|0,l:Number(t&ie)|0}}function Bn(t,e=!1){let r=t.length,n=new Uint32Array(r),o=new Uint32Array(r);for(let s=0;s<r;s++){let{h:i,l:f}=vr(t[s],e);[n[s],o[s]]=[i,f]}return[n,o]}var Ne=(t,e,r)=>t>>>r,Re=(t,e,r)=>t<<32-r|e>>>r,It=(t,e,r)=>t>>>r|e<<32-r,Lt=(t,e,r)=>t<<32-r|e>>>r,zt=(t,e,r)=>t<<64-r|e>>>r-32,Gt=(t,e,r)=>t>>>r-32|e<<64-r;function ft(t,e,r,n){let o=(e>>>0)+(n>>>0);return{h:t+r+(o/2**32|0)|0,l:o|0}}var vn=(t,e,r)=>(t>>>0)+(e>>>0)+(r>>>0),Sn=(t,e,r,n)=>e+r+n+(t/2**32|0)|0,An=(t,e,r,n)=>(t>>>0)+(e>>>0)+(r>>>0)+(n>>>0),_n=(t,e,r,n,o)=>e+r+n+o+(t/2**32|0)|0,Un=(t,e,r,n,o)=>(t>>>0)+(e>>>0)+(r>>>0)+(n>>>0)+(o>>>0),In=(t,e,r,n,o,s)=>e+r+n+o+s+(t/2**32|0)|0;var Ar=Uint32Array.from([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),wt=new Uint32Array(64),fe=class extends Pt{constructor(e=32){super(64,e,8,!1),this.A=dt[0]|0,this.B=dt[1]|0,this.C=dt[2]|0,this.D=dt[3]|0,this.E=dt[4]|0,this.F=dt[5]|0,this.G=dt[6]|0,this.H=dt[7]|0}get(){let{A:e,B:r,C:n,D:o,E:s,F:i,G:f,H:c}=this;return[e,r,n,o,s,i,f,c]}set(e,r,n,o,s,i,f,c){this.A=e|0,this.B=r|0,this.C=n|0,this.D=o|0,this.E=s|0,this.F=i|0,this.G=f|0,this.H=c|0}process(e,r){for(let d=0;d<16;d++,r+=4)wt[d]=e.getUint32(r,!1);for(let d=16;d<64;d++){let a=wt[d-15],l=wt[d-2],x=tt(a,7)^tt(a,18)^a>>>3,y=tt(l,17)^tt(l,19)^l>>>10;wt[d]=y+wt[d-7]+x+wt[d-16]|0}let{A:n,B:o,C:s,D:i,E:f,F:c,G:u,H:h}=this;for(let d=0;d<64;d++){let a=tt(f,6)^tt(f,11)^tt(f,25),l=h+a+wn(f,c,u)+Ar[d]+wt[d]|0,y=(tt(n,2)^tt(n,13)^tt(n,22))+mn(n,o,s)|0;h=u,u=c,c=f,f=i+l|0,i=s,s=o,o=n,n=l+y|0}n=n+this.A|0,o=o+this.B|0,s=s+this.C|0,i=i+this.D|0,f=f+this.E|0,c=c+this.F|0,u=u+this.G|0,h=h+this.H|0,this.set(n,o,s,i,f,c,u,h)}roundClean(){F(wt)}destroy(){this.set(0,0,0,0,0,0,0,0),F(this.buffer)}};var Ln=Bn(["0x428a2f98d728ae22","0x7137449123ef65cd","0xb5c0fbcfec4d3b2f","0xe9b5dba58189dbbc","0x3956c25bf348b538","0x59f111f1b605d019","0x923f82a4af194f9b","0xab1c5ed5da6d8118","0xd807aa98a3030242","0x12835b0145706fbe","0x243185be4ee4b28c","0x550c7dc3d5ffb4e2","0x72be5d74f27b896f","0x80deb1fe3b1696b1","0x9bdc06a725c71235","0xc19bf174cf692694","0xe49b69c19ef14ad2","0xefbe4786384f25e3","0x0fc19dc68b8cd5b5","0x240ca1cc77ac9c65","0x2de92c6f592b0275","0x4a7484aa6ea6e483","0x5cb0a9dcbd41fbd4","0x76f988da831153b5","0x983e5152ee66dfab","0xa831c66d2db43210","0xb00327c898fb213f","0xbf597fc7beef0ee4","0xc6e00bf33da88fc2","0xd5a79147930aa725","0x06ca6351e003826f","0x142929670a0e6e70","0x27b70a8546d22ffc","0x2e1b21385c26c926","0x4d2c6dfc5ac42aed","0x53380d139d95b3df","0x650a73548baf63de","0x766a0abb3c77b2a8","0x81c2c92e47edaee6","0x92722c851482353b","0xa2bfe8a14cf10364","0xa81a664bbc423001","0xc24b8b70d0f89791","0xc76c51a30654be30","0xd192e819d6ef5218","0xd69906245565a910","0xf40e35855771202a","0x106aa07032bbd1b8","0x19a4c116b8d2d0c8","0x1e376c085141ab53","0x2748774cdf8eeb99","0x34b0bcb5e19b48a8","0x391c0cb3c5c95a63","0x4ed8aa4ae3418acb","0x5b9cca4f7763e373","0x682e6ff3d6b2b8a3","0x748f82ee5defb2fc","0x78a5636f43172f60","0x84c87814a1f0ab72","0x8cc702081a6439ec","0x90befffa23631e28","0xa4506cebde82bde9","0xbef9a3f7b2c67915","0xc67178f2e372532b","0xca273eceea26619c","0xd186b8c721c0c207","0xeada7dd6cde0eb1e","0xf57d4f7fee6ed178","0x06f067aa72176fba","0x0a637dc5a2c898a6","0x113f9804bef90dae","0x1b710b35131c471b","0x28db77f523047d84","0x32caab7b40c72493","0x3c9ebe0a15c9bebc","0x431d67c49c100d4c","0x4cc5d4becb3e42b6","0x597f299cfc657e2a","0x5fcb6fab3ad6faec","0x6c44198c4a475817"].map(t=>BigInt(t))),_r=Ln[0],Ur=Ln[1],mt=new Uint32Array(80),Et=new Uint32Array(80),ce=class extends Pt{constructor(e=64){super(128,e,16,!1),this.Ah=D[0]|0,this.Al=D[1]|0,this.Bh=D[2]|0,this.Bl=D[3]|0,this.Ch=D[4]|0,this.Cl=D[5]|0,this.Dh=D[6]|0,this.Dl=D[7]|0,this.Eh=D[8]|0,this.El=D[9]|0,this.Fh=D[10]|0,this.Fl=D[11]|0,this.Gh=D[12]|0,this.Gl=D[13]|0,this.Hh=D[14]|0,this.Hl=D[15]|0}get(){let{Ah:e,Al:r,Bh:n,Bl:o,Ch:s,Cl:i,Dh:f,Dl:c,Eh:u,El:h,Fh:d,Fl:a,Gh:l,Gl:x,Hh:y,Hl:S}=this;return[e,r,n,o,s,i,f,c,u,h,d,a,l,x,y,S]}set(e,r,n,o,s,i,f,c,u,h,d,a,l,x,y,S){this.Ah=e|0,this.Al=r|0,this.Bh=n|0,this.Bl=o|0,this.Ch=s|0,this.Cl=i|0,this.Dh=f|0,this.Dl=c|0,this.Eh=u|0,this.El=h|0,this.Fh=d|0,this.Fl=a|0,this.Gh=l|0,this.Gl=x|0,this.Hh=y|0,this.Hl=S|0}process(e,r){for(let B=0;B<16;B++,r+=4)mt[B]=e.getUint32(r),Et[B]=e.getUint32(r+=4);for(let B=16;B<80;B++){let C=mt[B-15]|0,V=Et[B-15]|0,$=It(C,V,1)^It(C,V,8)^Ne(C,V,7),st=Lt(C,V,1)^Lt(C,V,8)^Re(C,V,7),M=mt[B-2]|0,_=Et[B-2]|0,at=It(M,_,19)^zt(M,_,61)^Ne(M,_,6),Q=Lt(M,_,19)^Gt(M,_,61)^Re(M,_,6),H=An(st,Q,Et[B-7],Et[B-16]),b=_n(H,$,at,mt[B-7],mt[B-16]);mt[B]=b|0,Et[B]=H|0}let{Ah:n,Al:o,Bh:s,Bl:i,Ch:f,Cl:c,Dh:u,Dl:h,Eh:d,El:a,Fh:l,Fl:x,Gh:y,Gl:S,Hh:L,Hl:T}=this;for(let B=0;B<80;B++){let C=It(d,a,14)^It(d,a,18)^zt(d,a,41),V=Lt(d,a,14)^Lt(d,a,18)^Gt(d,a,41),$=d&l^~d&y,st=a&x^~a&S,M=Un(T,V,st,Ur[B],Et[B]),_=In(M,L,C,$,_r[B],mt[B]),at=M|0,Q=It(n,o,28)^zt(n,o,34)^zt(n,o,39),H=Lt(n,o,28)^Gt(n,o,34)^Gt(n,o,39),b=n&s^n&f^s&f,g=o&i^o&c^i&c;L=y|0,T=S|0,y=l|0,S=x|0,l=d|0,x=a|0,{h:d,l:a}=ft(u|0,h|0,_|0,at|0),u=f|0,h=c|0,f=s|0,c=i|0,s=n|0,i=o|0;let p=vn(at,H,g);n=Sn(p,_,Q,b),o=p|0}({h:n,l:o}=ft(this.Ah|0,this.Al|0,n|0,o|0)),{h:s,l:i}=ft(this.Bh|0,this.Bl|0,s|0,i|0),{h:f,l:c}=ft(this.Ch|0,this.Cl|0,f|0,c|0),{h:u,l:h}=ft(this.Dh|0,this.Dl|0,u|0,h|0),{h:d,l:a}=ft(this.Eh|0,this.El|0,d|0,a|0),{h:l,l:x}=ft(this.Fh|0,this.Fl|0,l|0,x|0),{h:y,l:S}=ft(this.Gh|0,this.Gl|0,y|0,S|0),{h:L,l:T}=ft(this.Hh|0,this.Hl|0,L|0,T|0),this.set(n,o,s,i,f,c,u,h,d,a,l,x,y,S,L,T)}roundClean(){F(mt,Et)}destroy(){F(this.buffer),this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)}},qe=class extends ce{constructor(){super(48),this.Ah=Z[0]|0,this.Al=Z[1]|0,this.Bh=Z[2]|0,this.Bl=Z[3]|0,this.Ch=Z[4]|0,this.Cl=Z[5]|0,this.Dh=Z[6]|0,this.Dl=Z[7]|0,this.Eh=Z[8]|0,this.El=Z[9]|0,this.Fh=Z[10]|0,this.Fl=Z[11]|0,this.Gh=Z[12]|0,this.Gl=Z[13]|0,this.Hh=Z[14]|0,this.Hl=Z[15]|0}};var ae=te(()=>new fe);var Hn=te(()=>new ce),On=te(()=>new qe);var ue=class extends Tt{constructor(e,r){super(),this.finished=!1,this.destroyed=!1,At(e);let n=bt(r);if(this.iHash=e.create(),typeof this.iHash.update!="function")throw new Error("Expected instance of class which extends utils.Hash");this.blockLen=this.iHash.blockLen,this.outputLen=this.iHash.outputLen;let o=this.blockLen,s=new Uint8Array(o);s.set(n.length>o?e.create().update(n).digest():n);for(let i=0;i<s.length;i++)s[i]^=54;this.iHash.update(s),this.oHash=e.create();for(let i=0;i<s.length;i++)s[i]^=106;this.oHash.update(s),F(s)}update(e){return Ct(this),this.iHash.update(e),this}digestInto(e){Ct(this),J(e,this.outputLen),this.finished=!0,this.iHash.digestInto(e),this.oHash.update(e),this.oHash.digestInto(e),this.destroy()}digest(){let e=new Uint8Array(this.oHash.outputLen);return this.digestInto(e),e}_cloneInto(e){e||(e=Object.create(Object.getPrototypeOf(this),{}));let{oHash:r,iHash:n,finished:o,destroyed:s,blockLen:i,outputLen:f}=this;return e=e,e.finished=o,e.destroyed=s,e.blockLen=i,e.outputLen=f,e.oHash=r._cloneInto(e.oHash),e.iHash=n._cloneInto(e.iHash),e}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.oHash.destroy(),this.iHash.destroy()}},Rt=(t,e,r)=>new ue(t,e).update(r).digest();Rt.create=(t,e)=>new ue(t,e);var qt=BigInt(0),Ht=BigInt(1);function Wt(t,e){let r=e.negate();return t?r:e}function de(t,e){let r=oe(t.Fp,e.map(n=>n.Z));return e.map((n,o)=>t.fromAffine(n.toAffine(r[o])))}function Rn(t,e){if(!Number.isSafeInteger(t)||t<=0||t>e)throw new Error("invalid window size, expected [1.."+e+"], got W="+t)}function Ve(t,e){Rn(t,e);let r=Math.ceil(e/t)+1,n=2**(t-1),o=2**t,s=yt(t),i=BigInt(t);return{windows:r,windowSize:n,mask:s,maxNumber:o,shiftBy:i}}function Tn(t,e,r){let{windowSize:n,mask:o,maxNumber:s,shiftBy:i}=r,f=Number(t&o),c=t>>i;f>n&&(f-=s,c+=Ht);let u=e*n,h=u+Math.abs(f)-1,d=f===0,a=f<0,l=e%2!==0;return{nextN:c,offset:h,isZero:d,isNeg:a,isNegF:l,offsetF:u}}function Ir(t,e){if(!Array.isArray(t))throw new Error("array expected");t.forEach((r,n)=>{if(!(r instanceof e))throw new Error("invalid point at index "+n)})}function Lr(t,e){if(!Array.isArray(t))throw new Error("array of scalars expected");t.forEach((r,n)=>{if(!e.isValid(r))throw new Error("invalid scalar at index "+n)})}var ke=new WeakMap,qn=new WeakMap;function Ke(t){return qn.get(t)||1}function Cn(t){if(t!==qt)throw new Error("invalid wNAF")}var le=class{constructor(e,r){this.BASE=e.BASE,this.ZERO=e.ZERO,this.Fn=e.Fn,this.bits=r}_unsafeLadder(e,r,n=this.ZERO){let o=e;for(;r>qt;)r&Ht&&(n=n.add(o)),o=o.double(),r>>=Ht;return n}precomputeWindow(e,r){let{windows:n,windowSize:o}=Ve(r,this.bits),s=[],i=e,f=i;for(let c=0;c<n;c++){f=i,s.push(f);for(let u=1;u<o;u++)f=f.add(i),s.push(f);i=f.double()}return s}wNAF(e,r,n){if(!this.Fn.isValid(n))throw new Error("invalid scalar");let o=this.ZERO,s=this.BASE,i=Ve(e,this.bits);for(let f=0;f<i.windows;f++){let{nextN:c,offset:u,isZero:h,isNeg:d,isNegF:a,offsetF:l}=Tn(n,f,i);n=c,h?s=s.add(Wt(a,r[l])):o=o.add(Wt(d,r[u]))}return Cn(n),{p:o,f:s}}wNAFUnsafe(e,r,n,o=this.ZERO){let s=Ve(e,this.bits);for(let i=0;i<s.windows&&n!==qt;i++){let{nextN:f,offset:c,isZero:u,isNeg:h}=Tn(n,i,s);if(n=f,!u){let d=r[c];o=o.add(h?d.negate():d)}}return Cn(n),o}getPrecomputes(e,r,n){let o=ke.get(r);return o||(o=this.precomputeWindow(r,e),e!==1&&(typeof n=="function"&&(o=n(o)),ke.set(r,o))),o}cached(e,r,n){let o=Ke(e);return this.wNAF(o,this.getPrecomputes(o,e,n),r)}unsafe(e,r,n,o){let s=Ke(e);return s===1?this._unsafeLadder(e,r,o):this.wNAFUnsafe(s,this.getPrecomputes(s,e,n),r,o)}createCache(e,r){Rn(r,this.bits),qn.set(e,r),ke.delete(e)}hasCache(e){return Ke(e)!==1}};function Vn(t,e,r,n){let o=e,s=t.ZERO,i=t.ZERO;for(;r>qt||n>qt;)r&Ht&&(s=s.add(o)),n&Ht&&(i=i.add(o)),o=o.double(),r>>=Ht,n>>=Ht;return{p1:s,p2:i}}function kn(t,e,r,n){Ir(r,t),Lr(n,e);let o=r.length,s=n.length;if(o!==s)throw new Error("arrays of points and scalars must have equal length");let i=t.ZERO,f=re(BigInt(o)),c=1;f>12?c=f-3:f>4?c=f-2:f>0&&(c=2);let u=yt(c),h=new Array(Number(u)+1).fill(i),d=Math.floor((e.BITS-1)/c)*c,a=i;for(let l=d;l>=0;l-=c){h.fill(i);for(let y=0;y<s;y++){let S=n[y],L=Number(S>>BigInt(l)&u);h[L]=h[L].add(r[y])}let x=i;for(let y=h.length-1,S=i;y>0;y--)S=S.add(h[y]),x=x.add(S);if(a=a.add(x),l!==0)for(let y=0;y<c;y++)a=a.double()}return a}function Nn(t,e,r){if(e){if(e.ORDER!==t)throw new Error("Field.ORDER must match order: Fp == p, Fn == n");return Te(e),e}else return it(t,{isLE:r})}function Kn(t,e,r={},n){if(n===void 0&&(n=t==="edwards"),!e||typeof e!="object")throw new Error(`expected valid ${t} CURVE object`);for(let c of["p","n","h"]){let u=e[c];if(!(typeof u=="bigint"&&u>qt))throw new Error(`CURVE.${c} must be positive bigint`)}let o=Nn(e.p,r.Fp,n),s=Nn(e.n,r.Fn,n),f=["Gx","Gy","a",t==="weierstrass"?"b":"d"];for(let c of f)if(!o.isValid(e[c]))throw new Error(`CURVE.${c} must be valid field element of CURVE.Fp`);return e=Object.freeze(Object.assign({},e)),{CURVE:e,Fp:o,Fn:s}}var Mn=(t,e)=>(t+(t>=0?e:-e)/Zn)/e;function Hr(t,e,r){let[[n,o],[s,i]]=e,f=Mn(i*t,r),c=Mn(-o*t,r),u=t-f*n-c*s,h=-f*o-c*i,d=u<pt,a=h<pt;d&&(u=-u),a&&(h=-h);let l=yt(Math.ceil(re(r)/2))+kt;if(u<pt||u>=l||h<pt||h>=l)throw new Error("splitScalar (endomorphism): failed, k="+t);return{k1neg:d,k1:u,k2neg:a,k2:h}}function Ze(t){if(!["compact","recovered","der"].includes(t))throw new Error('Signature format must be "compact", "recovered", or "der"');return t}function Me(t,e){let r={};for(let n of Object.keys(e))r[n]=t[n]===void 0?e[n]:t[n];return Zt(r.lowS,"lowS"),Zt(r.prehash,"prehash"),r.format!==void 0&&Ze(r.format),r}var De=class extends Error{constructor(e=""){super(e)}},ht={Err:De,_tlv:{encode:(t,e)=>{let{Err:r}=ht;if(t<0||t>256)throw new r("tlv.encode: wrong tag");if(e.length&1)throw new r("tlv.encode: unpadded data");let n=e.length/2,o=Dt(n);if(o.length/2&128)throw new r("tlv.encode: long form length too big");let s=n>127?Dt(o.length/2|128):"";return Dt(t)+s+o+e},decode(t,e){let{Err:r}=ht,n=0;if(t<0||t>256)throw new r("tlv.encode: wrong tag");if(e.length<2||e[n++]!==t)throw new r("tlv.decode: wrong tlv");let o=e[n++],s=!!(o&128),i=0;if(!s)i=o;else{let c=o&127;if(!c)throw new r("tlv.decode(long): indefinite length not supported");if(c>4)throw new r("tlv.decode(long): byte length is too big");let u=e.subarray(n,n+c);if(u.length!==c)throw new r("tlv.decode: length bytes not complete");if(u[0]===0)throw new r("tlv.decode(long): zero leftmost byte");for(let h of u)i=i<<8|h;if(n+=c,i<128)throw new r("tlv.decode(long): not minimal encoding")}let f=e.subarray(n,n+i);if(f.length!==i)throw new r("tlv.decode: wrong value length");return{v:f,l:e.subarray(n+i)}}},_int:{encode(t){let{Err:e}=ht;if(t<pt)throw new e("integer: negative integers are not allowed");let r=Dt(t);if(Number.parseInt(r[0],16)&8&&(r="00"+r),r.length&1)throw new e("unexpected DER parsing assertion: unpadded hex");return r},decode(t){let{Err:e}=ht;if(t[0]&128)throw new e("invalid signature integer: negative");if(t[0]===0&&!(t[1]&128))throw new e("invalid signature integer: unnecessary leading zero");return Nt(t)}},toSig(t){let{Err:e,_int:r,_tlv:n}=ht,o=P("signature",t),{v:s,l:i}=n.decode(48,o);if(i.length)throw new e("invalid signature: left bytes after parsing");let{v:f,l:c}=n.decode(2,s),{v:u,l:h}=n.decode(2,c);if(h.length)throw new e("invalid signature: left bytes after parsing");return{r:r.decode(f),s:r.decode(u)}},hexFromSig(t){let{_tlv:e,_int:r}=ht,n=e.encode(2,r.encode(t.r)),o=e.encode(2,r.encode(t.s)),s=n+o;return e.encode(48,s)}},pt=BigInt(0),kt=BigInt(1),Zn=BigInt(2),he=BigInt(3),Or=BigInt(4);function Vt(t,e){let{BYTES:r}=t,n;if(typeof e=="bigint")n=e;else{let o=P("private key",e);try{n=t.fromBytes(o)}catch{throw new Error(`invalid private key: expected ui8a of size ${r}, got ${typeof e}`)}}if(!t.isValidNot0(n))throw new Error("invalid private key: out of range [1..N-1]");return n}function Tr(t,e={}){let r=Kn("weierstrass",t,e),{Fp:n,Fn:o}=r,s=r.CURVE,{h:i,n:f}=s;jt(e,{},{allowInfinityPoint:"boolean",clearCofactor:"function",isTorsionFree:"function",fromBytes:"function",toBytes:"function",endo:"object",wrapPrivateKey:"boolean"});let{endo:c}=e;if(c&&(!n.is0(s.a)||typeof c.beta!="bigint"||!Array.isArray(c.basises)))throw new Error('invalid endo: expected "beta": bigint and "basises": array');let u=jn(n,o);function h(){if(!n.isOdd)throw new Error("compression is not supported: Field does not have .isOdd()")}function d(H,b,g){let{x:p,y:w}=b.toAffine(),m=n.toBytes(p);if(Zt(g,"isCompressed"),g){h();let A=!n.isOdd(w);return et(Dn(A),m)}else return et(Uint8Array.of(4),m,n.toBytes(w))}function a(H){xt(H,void 0,"Point");let{publicKey:b,publicKeyUncompressed:g}=u,p=H.length,w=H[0],m=H.subarray(1);if(p===b&&(w===2||w===3)){let A=n.fromBytes(m);if(!n.isValid(A))throw new Error("bad point: is not on curve, wrong x");let v=y(A),E;try{E=n.sqrt(v)}catch(k){let N=k instanceof Error?": "+k.message:"";throw new Error("bad point: is not on curve, sqrt error"+N)}h();let U=n.isOdd(E);return(w&1)===1!==U&&(E=n.neg(E)),{x:A,y:E}}else if(p===g&&w===4){let A=n.BYTES,v=n.fromBytes(m.subarray(0,A)),E=n.fromBytes(m.subarray(A,A*2));if(!S(v,E))throw new Error("bad point: is not on curve");return{x:v,y:E}}else throw new Error(`bad point: got length ${p}, expected compressed=${b} or uncompressed=${g}`)}let l=e.toBytes||d,x=e.fromBytes||a;function y(H){let b=n.sqr(H),g=n.mul(b,H);return n.add(n.add(g,n.mul(H,s.a)),s.b)}function S(H,b){let g=n.sqr(b),p=y(H);return n.eql(g,p)}if(!S(s.Gx,s.Gy))throw new Error("bad curve params: generator point");let L=n.mul(n.pow(s.a,he),Or),T=n.mul(n.sqr(s.b),BigInt(27));if(n.is0(n.add(L,T)))throw new Error("bad curve params: a or b");function B(H,b,g=!1){if(!n.isValid(b)||g&&n.is0(b))throw new Error(`bad point coordinate ${H}`);return b}function C(H){if(!(H instanceof _))throw new Error("ProjectivePoint expected")}function V(H){if(!c||!c.basises)throw new Error("no endo");return Hr(H,c.basises,o.ORDER)}let $=He((H,b)=>{let{X:g,Y:p,Z:w}=H;if(n.eql(w,n.ONE))return{x:g,y:p};let m=H.is0();b==null&&(b=m?n.ONE:n.inv(w));let A=n.mul(g,b),v=n.mul(p,b),E=n.mul(w,b);if(m)return{x:n.ZERO,y:n.ZERO};if(!n.eql(E,n.ONE))throw new Error("invZ was invalid");return{x:A,y:v}}),st=He(H=>{if(H.is0()){if(e.allowInfinityPoint&&!n.is0(H.Y))return;throw new Error("bad point: ZERO")}let{x:b,y:g}=H.toAffine();if(!n.isValid(b)||!n.isValid(g))throw new Error("bad point: x or y not field elements");if(!S(b,g))throw new Error("bad point: equation left != right");if(!H.isTorsionFree())throw new Error("bad point: not in prime-order subgroup");return!0});function M(H,b,g,p,w){return g=new _(n.mul(g.X,H),g.Y,g.Z),b=Wt(p,b),g=Wt(w,g),b.add(g)}class _{constructor(b,g,p){this.X=B("x",b),this.Y=B("y",g,!0),this.Z=B("z",p),Object.freeze(this)}static CURVE(){return s}static fromAffine(b){let{x:g,y:p}=b||{};if(!b||!n.isValid(g)||!n.isValid(p))throw new Error("invalid affine point");if(b instanceof _)throw new Error("projective point not allowed");return n.is0(g)&&n.is0(p)?_.ZERO:new _(g,p,n.ONE)}static fromBytes(b){let g=_.fromAffine(x(xt(b,void 0,"point")));return g.assertValidity(),g}static fromHex(b){return _.fromBytes(P("pointHex",b))}get x(){return this.toAffine().x}get y(){return this.toAffine().y}precompute(b=8,g=!0){return Q.createCache(this,b),g||this.multiply(he),this}assertValidity(){st(this)}hasEvenY(){let{y:b}=this.toAffine();if(!n.isOdd)throw new Error("Field doesn't support isOdd");return!n.isOdd(b)}equals(b){C(b);let{X:g,Y:p,Z:w}=this,{X:m,Y:A,Z:v}=b,E=n.eql(n.mul(g,v),n.mul(m,w)),U=n.eql(n.mul(p,v),n.mul(A,w));return E&&U}negate(){return new _(this.X,n.neg(this.Y),this.Z)}double(){let{a:b,b:g}=s,p=n.mul(g,he),{X:w,Y:m,Z:A}=this,v=n.ZERO,E=n.ZERO,U=n.ZERO,I=n.mul(w,w),k=n.mul(m,m),N=n.mul(A,A),O=n.mul(w,m);return O=n.add(O,O),U=n.mul(w,A),U=n.add(U,U),v=n.mul(b,U),E=n.mul(p,N),E=n.add(v,E),v=n.sub(k,E),E=n.add(k,E),E=n.mul(v,E),v=n.mul(O,v),U=n.mul(p,U),N=n.mul(b,N),O=n.sub(I,N),O=n.mul(b,O),O=n.add(O,U),U=n.add(I,I),I=n.add(U,I),I=n.add(I,N),I=n.mul(I,O),E=n.add(E,I),N=n.mul(m,A),N=n.add(N,N),I=n.mul(N,O),v=n.sub(v,I),U=n.mul(N,k),U=n.add(U,U),U=n.add(U,U),new _(v,E,U)}add(b){C(b);let{X:g,Y:p,Z:w}=this,{X:m,Y:A,Z:v}=b,E=n.ZERO,U=n.ZERO,I=n.ZERO,k=s.a,N=n.mul(s.b,he),O=n.mul(g,m),R=n.mul(p,A),K=n.mul(w,v),W=n.add(g,p),q=n.add(m,A);W=n.mul(W,q),q=n.add(O,R),W=n.sub(W,q),q=n.add(g,w);let j=n.add(m,v);return q=n.mul(q,j),j=n.add(O,K),q=n.sub(q,j),j=n.add(p,w),E=n.add(A,v),j=n.mul(j,E),E=n.add(R,K),j=n.sub(j,E),I=n.mul(k,q),E=n.mul(N,K),I=n.add(E,I),E=n.sub(R,I),I=n.add(R,I),U=n.mul(E,I),R=n.add(O,O),R=n.add(R,O),K=n.mul(k,K),q=n.mul(N,q),R=n.add(R,K),K=n.sub(O,K),K=n.mul(k,K),q=n.add(q,K),O=n.mul(R,q),U=n.add(U,O),O=n.mul(j,q),E=n.mul(W,E),E=n.sub(E,O),O=n.mul(W,R),I=n.mul(j,I),I=n.add(I,O),new _(E,U,I)}subtract(b){return this.add(b.negate())}is0(){return this.equals(_.ZERO)}multiply(b){let{endo:g}=e;if(!o.isValidNot0(b))throw new Error("invalid scalar: out of range");let p,w,m=A=>Q.cached(this,A,v=>de(_,v));if(g){let{k1neg:A,k1:v,k2neg:E,k2:U}=V(b),{p:I,f:k}=m(v),{p:N,f:O}=m(U);w=k.add(O),p=M(g.beta,I,N,A,E)}else{let{p:A,f:v}=m(b);p=A,w=v}return de(_,[p,w])[0]}multiplyUnsafe(b){let{endo:g}=e,p=this;if(!o.isValid(b))throw new Error("invalid scalar: out of range");if(b===pt||p.is0())return _.ZERO;if(b===kt)return p;if(Q.hasCache(this))return this.multiply(b);if(g){let{k1neg:w,k1:m,k2neg:A,k2:v}=V(b),{p1:E,p2:U}=Vn(_,p,m,v);return M(g.beta,E,U,w,A)}else return Q.unsafe(p,b)}multiplyAndAddUnsafe(b,g,p){let w=this.multiplyUnsafe(g).add(b.multiplyUnsafe(p));return w.is0()?void 0:w}toAffine(b){return $(this,b)}isTorsionFree(){let{isTorsionFree:b}=e;return i===kt?!0:b?b(_,this):Q.unsafe(this,f).is0()}clearCofactor(){let{clearCofactor:b}=e;return i===kt?this:b?b(_,this):this.multiplyUnsafe(i)}isSmallOrder(){return this.multiplyUnsafe(i).is0()}toBytes(b=!0){return Zt(b,"isCompressed"),this.assertValidity(),l(_,this,b)}toHex(b=!0){return lt(this.toBytes(b))}toString(){return`<Point ${this.is0()?"ZERO":this.toHex()}>`}get px(){return this.X}get py(){return this.X}get pz(){return this.Z}toRawBytes(b=!0){return this.toBytes(b)}_setWindowSize(b){this.precompute(b)}static normalizeZ(b){return de(_,b)}static msm(b,g){return kn(_,o,b,g)}static fromPrivateKey(b){return _.BASE.multiply(Vt(o,b))}}_.BASE=new _(s.Gx,s.Gy,n.ONE),_.ZERO=new _(n.ZERO,n.ONE,n.ZERO),_.Fp=n,_.Fn=o;let at=o.BITS,Q=new le(_,e.endo?Math.ceil(at/2):at);return _.BASE.precompute(8),_}function Dn(t){return Uint8Array.of(t?2:3)}function jn(t,e){return{secretKey:e.BYTES,publicKey:1+t.BYTES,publicKeyUncompressed:1+2*t.BYTES,publicKeyHasPrefix:!0,signature:2*e.BYTES}}function Cr(t,e={}){let{Fn:r}=t,n=e.randomBytes||ee,o=Object.assign(jn(t.Fp,r),{seed:Ce(r.ORDER)});function s(l){try{return!!Vt(r,l)}catch{return!1}}function i(l,x){let{publicKey:y,publicKeyUncompressed:S}=o;try{let L=l.length;return x===!0&&L!==y||x===!1&&L!==S?!1:!!t.fromBytes(l)}catch{return!1}}function f(l=n(o.seed)){return yn(xt(l,o.seed,"seed"),r.ORDER)}function c(l,x=!0){return t.BASE.multiply(Vt(r,l)).toBytes(x)}function u(l){let x=f(l);return{secretKey:x,publicKey:c(x)}}function h(l){if(typeof l=="bigint")return!1;if(l instanceof t)return!0;let{secretKey:x,publicKey:y,publicKeyUncompressed:S}=o;if(r.allowedLengths||x===y)return;let L=P("key",l).length;return L===y||L===S}function d(l,x,y=!0){if(h(l)===!0)throw new Error("first arg must be private key");if(h(x)===!1)throw new Error("second arg must be public key");let S=Vt(r,l);return t.fromHex(x).multiply(S).toBytes(y)}return Object.freeze({getPublicKey:c,getSharedSecret:d,keygen:u,Point:t,utils:{isValidSecretKey:s,isValidPublicKey:i,randomSecretKey:f,isValidPrivateKey:s,randomPrivateKey:f,normPrivateKeyToScalar:l=>Vt(r,l),precompute(l=8,x=t.BASE){return x.precompute(l,!1)}},lengths:o})}function Nr(t,e,r={}){At(e),jt(r,{},{hmac:"function",lowS:"boolean",randomBytes:"function",bits2int:"function",bits2int_modN:"function"});let n=r.randomBytes||ee,o=r.hmac||((g,...p)=>Rt(e,g,et(...p))),{Fp:s,Fn:i}=t,{ORDER:f,BITS:c}=i,{keygen:u,getPublicKey:h,getSharedSecret:d,utils:a,lengths:l}=Cr(t,r),x={prehash:!1,lowS:typeof r.lowS=="boolean"?r.lowS:!1,format:void 0,extraEntropy:!1},y="compact";function S(g){let p=f>>kt;return g>p}function L(g,p){if(!i.isValidNot0(p))throw new Error(`invalid signature ${g}: out of range 1..Point.Fn.ORDER`);return p}function T(g,p){Ze(p);let w=l.signature,m=p==="compact"?w:p==="recovered"?w+1:void 0;return xt(g,m,`${p} signature`)}class B{constructor(p,w,m){this.r=L("r",p),this.s=L("s",w),m!=null&&(this.recovery=m),Object.freeze(this)}static fromBytes(p,w=y){T(p,w);let m;if(w==="der"){let{r:U,s:I}=ht.toSig(xt(p));return new B(U,I)}w==="recovered"&&(m=p[0],w="compact",p=p.subarray(1));let A=i.BYTES,v=p.subarray(0,A),E=p.subarray(A,A*2);return new B(i.fromBytes(v),i.fromBytes(E),m)}static fromHex(p,w){return this.fromBytes(_t(p),w)}addRecoveryBit(p){return new B(this.r,this.s,p)}recoverPublicKey(p){let w=s.ORDER,{r:m,s:A,recovery:v}=this;if(v==null||![0,1,2,3].includes(v))throw new Error("recovery id invalid");if(f*Zn<w&&v>1)throw new Error("recovery id is ambiguous for h>1 curve");let U=v===2||v===3?m+f:m;if(!s.isValid(U))throw new Error("recovery id 2 or 3 invalid");let I=s.toBytes(U),k=t.fromBytes(et(Dn((v&1)===0),I)),N=i.inv(U),O=V(P("msgHash",p)),R=i.create(-O*N),K=i.create(A*N),W=t.BASE.multiplyUnsafe(R).add(k.multiplyUnsafe(K));if(W.is0())throw new Error("point at infinify");return W.assertValidity(),W}hasHighS(){return S(this.s)}toBytes(p=y){if(Ze(p),p==="der")return _t(ht.hexFromSig(this));let w=i.toBytes(this.r),m=i.toBytes(this.s);if(p==="recovered"){if(this.recovery==null)throw new Error("recovery bit must be present");return et(Uint8Array.of(this.recovery),w,m)}return et(w,m)}toHex(p){return lt(this.toBytes(p))}assertValidity(){}static fromCompact(p){return B.fromBytes(P("sig",p),"compact")}static fromDER(p){return B.fromBytes(P("sig",p),"der")}normalizeS(){return this.hasHighS()?new B(this.r,i.neg(this.s),this.recovery):this}toDERRawBytes(){return this.toBytes("der")}toDERHex(){return lt(this.toBytes("der"))}toCompactRawBytes(){return this.toBytes("compact")}toCompactHex(){return lt(this.toBytes("compact"))}}let C=r.bits2int||function(p){if(p.length>8192)throw new Error("input is too large");let w=Nt(p),m=p.length*8-c;return m>0?w>>BigInt(m):w},V=r.bits2int_modN||function(p){return i.create(C(p))},$=yt(c);function st(g){return sn("num < 2^"+c,g,pt,$),i.toBytes(g)}function M(g,p){return xt(g,void 0,"message"),p?xt(e(g),void 0,"prehashed message"):g}function _(g,p,w){if(["recovered","canonical"].some(R=>R in w))throw new Error("sign() legacy options not supported");let{lowS:m,prehash:A,extraEntropy:v}=Me(w,x);g=M(g,A);let E=V(g),U=Vt(i,p),I=[st(U),st(E)];if(v!=null&&v!==!1){let R=v===!0?n(l.secretKey):v;I.push(P("extraEntropy",R))}let k=et(...I),N=E;function O(R){let K=C(R);if(!i.isValidNot0(K))return;let W=i.inv(K),q=t.BASE.multiply(K).toAffine(),j=i.create(q.x);if(j===pt)return;let Jt=i.create(W*i.create(N+j*U));if(Jt===pt)return;let Qe=(q.x===j?0:2)|Number(q.y&kt),Je=Jt;return m&&S(Jt)&&(Je=i.neg(Jt),Qe^=1),new B(j,Je,Qe)}return{seed:k,k2sig:O}}function at(g,p,w={}){g=P("message",g);let{seed:m,k2sig:A}=_(g,p,w);return fn(e.outputLen,i.BYTES,o)(m,A)}function Q(g){let p,w=typeof g=="string"||St(g),m=!w&&g!==null&&typeof g=="object"&&typeof g.r=="bigint"&&typeof g.s=="bigint";if(!w&&!m)throw new Error("invalid signature, expected Uint8Array, hex string or Signature instance");if(m)p=new B(g.r,g.s);else if(w){try{p=B.fromBytes(P("sig",g),"der")}catch(A){if(!(A instanceof ht.Err))throw A}if(!p)try{p=B.fromBytes(P("sig",g),"compact")}catch{return!1}}return p||!1}function H(g,p,w,m={}){let{lowS:A,prehash:v,format:E}=Me(m,x);if(w=P("publicKey",w),p=M(P("message",p),v),"strict"in m)throw new Error("options.strict was renamed to lowS");let U=E===void 0?Q(g):B.fromBytes(P("sig",g),E);if(U===!1)return!1;try{let I=t.fromBytes(w);if(A&&U.hasHighS())return!1;let{r:k,s:N}=U,O=V(p),R=i.inv(N),K=i.create(O*R),W=i.create(k*R),q=t.BASE.multiplyUnsafe(K).add(I.multiplyUnsafe(W));return q.is0()?!1:i.create(q.x)===k}catch{return!1}}function b(g,p,w={}){let{prehash:m}=Me(w,x);return p=M(p,m),B.fromBytes(g,"recovered").recoverPublicKey(p).toBytes()}return Object.freeze({keygen:u,getPublicKey:h,getSharedSecret:d,utils:a,lengths:l,Point:t,sign:at,verify:H,recoverPublicKey:b,Signature:B,hash:e})}function Rr(t){let e={a:t.a,b:t.b,p:t.Fp.ORDER,n:t.n,h:t.h,Gx:t.Gx,Gy:t.Gy},r=t.Fp,n=t.allowedPrivateKeyLengths?Array.from(new Set(t.allowedPrivateKeyLengths.map(i=>Math.ceil(i/2)))):void 0,o=it(e.n,{BITS:t.nBitLength,allowedLengths:n,modFromBytes:t.wrapPrivateKey}),s={Fp:r,Fn:o,allowInfinityPoint:t.allowInfinityPoint,endo:t.endo,isTorsionFree:t.isTorsionFree,clearCofactor:t.clearCofactor,fromBytes:t.fromBytes,toBytes:t.toBytes};return{CURVE:e,curveOpts:s}}function qr(t){let{CURVE:e,curveOpts:r}=Rr(t),n={hmac:t.hmac,randomBytes:t.randomBytes,lowS:t.lowS,bits2int:t.bits2int,bits2int_modN:t.bits2int_modN};return{CURVE:e,curveOpts:r,hash:t.hash,ecdsaOpts:n}}function Vr(t,e){let r=e.Point;return Object.assign({},e,{ProjectivePoint:r,CURVE:Object.assign({},t,se(r.Fn.ORDER,r.Fn.BITS))})}function Pn(t){let{CURVE:e,curveOpts:r,hash:n,ecdsaOpts:o}=qr(t),s=Tr(e,r),i=Nr(s,n,o);return Vr(t,i)}function pe(t,e){let r=n=>Pn({...t,hash:n});return{...r(e),create:r}}var zn={p:BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),n:BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),h:BigInt(1),a:BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),b:BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),Gx:BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),Gy:BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")},Gn={p:BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff"),n:BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973"),h:BigInt(1),a:BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc"),b:BigInt("0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef"),Gx:BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),Gy:BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f")},Wn={p:BigInt("0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"),n:BigInt("0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409"),h:BigInt(1),a:BigInt("0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc"),b:BigInt("0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00"),Gx:BigInt("0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66"),Gy:BigInt("0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650")},kr=it(zn.p),Kr=it(Gn.p),Mr=it(Wn.p);var Yn=pe({...zn,Fp:kr,lowS:!1},ae);var jo=pe({...Gn,Fp:Kr,lowS:!1},On);var Po=pe({...Wn,Fp:Mr,lowS:!1,allowedPrivateKeyLengths:[130,131,132]},Hn);var ge=Yn;var Yt=ae;function Zr(t,e,r){return At(t),r===void 0&&(r=new Uint8Array(t.outputLen)),Rt(t,bt(r),bt(e))}var je=Uint8Array.from([0]),Xn=Uint8Array.of();function Dr(t,e,r,n=32){At(t),vt(n);let o=t.outputLen;if(n>255*o)throw new Error("Length should be <= 255*HashLen");let s=Math.ceil(n/o);r===void 0&&(r=Xn);let i=new Uint8Array(s*o),f=Rt.create(t,e),c=f._cloneInto(),u=new Uint8Array(f.outputLen);for(let h=0;h<s;h++)je[0]=h+1,c.update(h===0?Xn:u).update(r).update(je).digestInto(u),i.set(u,o*h),f._cloneInto(c);return f.destroy(),c.destroy(),F(u,je),i.slice(0,n)}var be=(t,e,r,n,o)=>Dr(t,Zr(t,e,r),n,o);function $n(t){return t instanceof Uint8Array||ArrayBuffer.isView(t)&&t.constructor.name==="Uint8Array"}function jr(t){if(typeof t!="boolean")throw new Error(`boolean expected, not ${t}`)}function G(t,...e){if(!$n(t))throw new Error("Uint8Array expected");if(e.length>0&&!e.includes(t.length))throw new Error("Uint8Array expected of length "+e+", got length="+t.length)}function Xt(t,e=!0){if(t.destroyed)throw new Error("Hash instance has been destroyed");if(e&&t.finished)throw new Error("Hash#digest() has already been called")}function Pe(t,e){G(t);let r=e.outputLen;if(t.length<r)throw new Error("digestInto() expects output buffer of length at least "+r)}function Qn(t){return new Uint8Array(t.buffer,t.byteOffset,t.byteLength)}function rt(t){return new Uint32Array(t.buffer,t.byteOffset,Math.floor(t.byteLength/4))}function ot(...t){for(let e=0;e<t.length;e++)t[e].fill(0)}function Kt(t){return new DataView(t.buffer,t.byteOffset,t.byteLength)}var Pr=new Uint8Array(new Uint32Array([287454020]).buffer)[0]===68;function zr(t){if(typeof t!="string")throw new Error("string expected");return new Uint8Array(new TextEncoder().encode(t))}function Mt(t){if(typeof t=="string")t=zr(t);else if($n(t))t=Ot(t);else throw new Error("Uint8Array expected, got "+typeof t);return t}function Jn(t,e){if(t.length!==e.length)return!1;let r=0;for(let n=0;n<t.length;n++)r|=t[n]^e[n];return r===0}var Fn=(t,e)=>{function r(n,...o){if(G(n),!Pr)throw new Error("Non little-endian hardware is not yet supported");if(t.nonceLength!==void 0){let h=o[0];if(!h)throw new Error("nonce / iv required");t.varSizeNonce?G(h):G(h,t.nonceLength)}let s=t.tagLength;s&&o[1]!==void 0&&G(o[1]);let i=e(n,...o),f=(h,d)=>{if(d!==void 0){if(h!==2)throw new Error("cipher output not supported");G(d)}},c=!1;return{encrypt(h,d){if(c)throw new Error("cannot encrypt() twice with same key + nonce");return c=!0,G(h),f(i.encrypt.length,d),i.encrypt(h,d)},decrypt(h,d){if(G(h),s&&h.length<s)throw new Error("invalid ciphertext length: smaller than tagLength="+s);return f(i.decrypt.length,d),i.decrypt(h,d)}}}return Object.assign(r,t),r};function tr(t,e,r=!0){if(e===void 0)return new Uint8Array(t);if(e.length!==t)throw new Error("invalid output length, expected "+t+", got: "+e.length);if(r&&!$t(e))throw new Error("invalid output, must be aligned");return e}function xe(t,e,r,n){if(typeof t.setBigUint64=="function")return t.setBigUint64(e,r,n);let o=BigInt(32),s=BigInt(4294967295),i=Number(r>>o&s),f=Number(r&s),c=n?4:0,u=n?0:4;t.setUint32(e+c,i,n),t.setUint32(e+u,f,n)}function er(t,e,r){jr(r);let n=new Uint8Array(16),o=Kt(n);return xe(o,0,BigInt(e),r),xe(o,8,BigInt(t),r),n}function $t(t){return t.byteOffset%4===0}function Ot(t){return Uint8Array.from(t)}var gt=16,Ge=new Uint8Array(16),ct=rt(Ge),Gr=225,Wr=(t,e,r,n)=>{let o=n&1;return{s3:r<<31|n>>>1,s2:e<<31|r>>>1,s1:t<<31|e>>>1,s0:t>>>1^Gr<<24&-(o&1)}},X=t=>(t>>>0&255)<<24|(t>>>8&255)<<16|(t>>>16&255)<<8|t>>>24&255|0;function Yr(t){t.reverse();let e=t[15]&1,r=0;for(let n=0;n<t.length;n++){let o=t[n];t[n]=o>>>1|r,r=(o&1)<<7}return t[0]^=-e&225,t}var Xr=t=>t>64*1024?8:t>1024?4:2,ye=class{constructor(e,r){this.blockLen=gt,this.outputLen=gt,this.s0=0,this.s1=0,this.s2=0,this.s3=0,this.finished=!1,e=Mt(e),G(e,16);let n=Kt(e),o=n.getUint32(0,!1),s=n.getUint32(4,!1),i=n.getUint32(8,!1),f=n.getUint32(12,!1),c=[];for(let x=0;x<128;x++)c.push({s0:X(o),s1:X(s),s2:X(i),s3:X(f)}),{s0:o,s1:s,s2:i,s3:f}=Wr(o,s,i,f);let u=Xr(r||1024);if(![1,2,4,8].includes(u))throw new Error("ghash: invalid window size, expected 2, 4 or 8");this.W=u;let d=128/u,a=this.windowSize=2**u,l=[];for(let x=0;x<d;x++)for(let y=0;y<a;y++){let S=0,L=0,T=0,B=0;for(let C=0;C<u;C++){if(!(y>>>u-C-1&1))continue;let{s0:$,s1:st,s2:M,s3:_}=c[u*x+C];S^=$,L^=st,T^=M,B^=_}l.push({s0:S,s1:L,s2:T,s3:B})}this.t=l}_updateBlock(e,r,n,o){e^=this.s0,r^=this.s1,n^=this.s2,o^=this.s3;let{W:s,t:i,windowSize:f}=this,c=0,u=0,h=0,d=0,a=(1<<s)-1,l=0;for(let x of[e,r,n,o])for(let y=0;y<4;y++){let S=x>>>8*y&255;for(let L=8/s-1;L>=0;L--){let T=S>>>s*L&a,{s0:B,s1:C,s2:V,s3:$}=i[l*f+T];c^=B,u^=C,h^=V,d^=$,l+=1}}this.s0=c,this.s1=u,this.s2=h,this.s3=d}update(e){Xt(this),e=Mt(e),G(e);let r=rt(e),n=Math.floor(e.length/gt),o=e.length%gt;for(let s=0;s<n;s++)this._updateBlock(r[s*4+0],r[s*4+1],r[s*4+2],r[s*4+3]);return o&&(Ge.set(e.subarray(n*gt)),this._updateBlock(ct[0],ct[1],ct[2],ct[3]),ot(ct)),this}destroy(){let{t:e}=this;for(let r of e)r.s0=0,r.s1=0,r.s2=0,r.s3=0}digestInto(e){Xt(this),Pe(e,this),this.finished=!0;let{s0:r,s1:n,s2:o,s3:s}=this,i=rt(e);return i[0]=r,i[1]=n,i[2]=o,i[3]=s,e}digest(){let e=new Uint8Array(gt);return this.digestInto(e),this.destroy(),e}},ze=class extends ye{constructor(e,r){e=Mt(e),G(e);let n=Yr(Ot(e));super(n,r),ot(n)}update(e){e=Mt(e),Xt(this);let r=rt(e),n=e.length%gt,o=Math.floor(e.length/gt);for(let s=0;s<o;s++)this._updateBlock(X(r[s*4+3]),X(r[s*4+2]),X(r[s*4+1]),X(r[s*4+0]));return n&&(Ge.set(e.subarray(o*gt)),this._updateBlock(X(ct[3]),X(ct[2]),X(ct[1]),X(ct[0])),ot(ct)),this}digestInto(e){Xt(this),Pe(e,this),this.finished=!0;let{s0:r,s1:n,s2:o,s3:s}=this,i=rt(e);return i[0]=r,i[1]=n,i[2]=o,i[3]=s,e.reverse()}};function nr(t){let e=(n,o)=>t(o,n.length).update(Mt(n)).digest(),r=t(new Uint8Array(16),0);return e.outputLen=r.outputLen,e.blockLen=r.blockLen,e.create=(n,o)=>t(n,o),e}var We=nr((t,e)=>new ye(t,e)),$r=nr((t,e)=>new ze(t,e));var Xe=16,Qr=4,we=new Uint8Array(Xe),Jr=283;function $e(t){return t<<1^Jr&-(t>>7)}function rr(t,e){let r=0;for(;e>0;e>>=1)r^=t&-(e&1),t=$e(t);return r}var Fr=(()=>{let t=new Uint8Array(256);for(let r=0,n=1;r<256;r++,n^=$e(n))t[r]=n;let e=new Uint8Array(256);e[0]=99;for(let r=0;r<255;r++){let n=t[255-r];n|=n<<8,e[t[r]]=(n^n>>4^n>>5^n>>6^n>>7^99)&255}return ot(t),e})();var to=t=>t<<24|t>>>8,Ye=t=>t<<8|t>>>24;function eo(t,e){if(t.length!==256)throw new Error("Wrong sbox length");let r=new Uint32Array(256).map((u,h)=>e(t[h])),n=r.map(Ye),o=n.map(Ye),s=o.map(Ye),i=new Uint32Array(256*256),f=new Uint32Array(256*256),c=new Uint16Array(256*256);for(let u=0;u<256;u++)for(let h=0;h<256;h++){let d=u*256+h;i[d]=r[u]^n[h],f[d]=o[u]^s[h],c[d]=t[u]<<8|t[h]}return{sbox:t,sbox2:c,T0:r,T1:n,T2:o,T3:s,T01:i,T23:f}}var sr=eo(Fr,t=>rr(t,3)<<24|t<<16|t<<8|rr(t,2));var no=(()=>{let t=new Uint8Array(16);for(let e=0,r=1;e<16;e++,r=$e(r))t[e]=r;return t})();function ro(t){G(t);let e=t.length;if(![16,24,32].includes(e))throw new Error("aes: invalid key size, should be 16, 24 or 32, got "+e);let{sbox2:r}=sr,n=[];$t(t)||n.push(t=Ot(t));let o=rt(t),s=o.length,i=c=>Qt(r,c,c,c,c),f=new Uint32Array(e+28);f.set(o);for(let c=s;c<f.length;c++){let u=f[c-1];c%s===0?u=i(to(u))^no[c/s-1]:s>6&&c%s===4&&(u=i(u)),f[c]=f[c-s]^u}return ot(...n),f}function me(t,e,r,n,o,s){return t[r<<8&65280|n>>>8&255]^e[o>>>8&65280|s>>>24&255]}function Qt(t,e,r,n,o){return t[e&255|r&65280]|t[n>>>16&255|o>>>16&65280]<<16}function or(t,e,r,n,o){let{sbox2:s,T01:i,T23:f}=sr,c=0;e^=t[c++],r^=t[c++],n^=t[c++],o^=t[c++];let u=t.length/4-2;for(let x=0;x<u;x++){let y=t[c++]^me(i,f,e,r,n,o),S=t[c++]^me(i,f,r,n,o,e),L=t[c++]^me(i,f,n,o,e,r),T=t[c++]^me(i,f,o,e,r,n);e=y,r=S,n=L,o=T}let h=t[c++]^Qt(s,e,r,n,o),d=t[c++]^Qt(s,r,n,o,e),a=t[c++]^Qt(s,n,o,e,r),l=t[c++]^Qt(s,o,e,r,n);return{s0:h,s1:d,s2:a,s3:l}}function Ee(t,e,r,n,o){G(r,Xe),G(n),o=tr(n.length,o);let s=r,i=rt(s),f=Kt(s),c=rt(n),u=rt(o),h=e?0:12,d=n.length,a=f.getUint32(h,e),{s0:l,s1:x,s2:y,s3:S}=or(t,i[0],i[1],i[2],i[3]);for(let T=0;T+4<=c.length;T+=4)u[T+0]=c[T+0]^l,u[T+1]=c[T+1]^x,u[T+2]=c[T+2]^y,u[T+3]=c[T+3]^S,a=a+1>>>0,f.setUint32(h,a,e),{s0:l,s1:x,s2:y,s3:S}=or(t,i[0],i[1],i[2],i[3]);let L=Xe*Math.floor(c.length/Qr);if(L<d){let T=new Uint32Array([l,x,y,S]),B=Qn(T);for(let C=L,V=0;C<d;C++,V++)o[C]=n[C]^B[V];ot(T)}return o}function oo(t,e,r,n,o){let s=o?o.length:0,i=t.create(r,n.length+s);o&&i.update(o);let f=er(8*n.length,8*s,e);i.update(n),i.update(f);let c=i.digest();return ot(f),c}var ir=Fn({blockSize:16,nonceLength:12,tagLength:16,varSizeNonce:!0},function(e,r,n){if(r.length<8)throw new Error("aes/gcm: invalid nonce length");let o=16;function s(f,c,u){let h=oo(We,!1,f,u,n);for(let d=0;d<c.length;d++)h[d]^=c[d];return h}function i(){let f=ro(e),c=we.slice(),u=we.slice();if(Ee(f,!1,u,u,c),r.length===12)u.set(r);else{let d=we.slice(),a=Kt(d);xe(a,8,BigInt(r.length*8),!1);let l=We.create(c).update(r).update(d);l.digestInto(u),l.destroy()}let h=Ee(f,!1,u,we);return{xk:f,authKey:c,counter:u,tagMask:h}}return{encrypt(f){let{xk:c,authKey:u,counter:h,tagMask:d}=i(),a=new Uint8Array(f.length+o),l=[c,u,h,d];$t(f)||l.push(f=Ot(f)),Ee(c,!1,h,f,a.subarray(0,f.length));let x=s(u,d,a.subarray(0,a.length-o));return l.push(x),a.set(x,f.length),ot(...l),a},decrypt(f){let{xk:c,authKey:u,counter:h,tagMask:d}=i(),a=[c,u,d,h];$t(f)||a.push(f=Ot(f));let l=f.subarray(0,-o),x=f.subarray(-o),y=s(u,d,l);if(a.push(y),!Jn(y,x))throw new Error("aes/gcm: invalid ghash tag");let S=Ee(c,!1,h,l);return ot(...a),S}}});function so(t,e){let r=Yt(Uint8Array.from(t.split("").map(n=>n.charCodeAt(0))));return Array.from(ge.sign(r,e,{lowS:!0,extraEntropy:!1}).toCompactRawBytes())}var fr=t=>Uint8Array.from(io(t.replace(/-/g,"+").replace(/_/g,"/")),e=>e.charCodeAt(0)),Be=t=>Uint8Array.from(unescape(encodeURIComponent(t)),e=>e.charCodeAt(0)),ve=(...t)=>{let e=new Uint8Array(t.reduce((n,o)=>n+o.length,0)),r=0;for(let n of t)e.set(n,r),r+=n.length;return e};function io(t){let e="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",r=0,n=0,o="";for(let s of t.replace(/=+$/,"")){let i=e.indexOf(s);if(i<0)throw new Error("Invalid base64");n=n<<6|i,r+=6,r>=8&&(r-=8,o+=String.fromCharCode(n>>r&255))}return o}function fo(t,e,r,n){let o=fr(e),s=fr(r),i=Uint8Array.from(n);if(o.length!==65||s.length!==16||i.length!==48)throw new Error("Invalid push subscription keys.");let f=i.slice(0,32),c=i.slice(32),u=ge.getPublicKey(f,!1),h=ge.getSharedSecret(f,o,!1).slice(1,33),d=be(Yt,h,s,ve(Be("WebPush: info\0"),o,u),32),a=be(Yt,d,c,Be("Content-Encoding: aes128gcm\0"),16),l=be(Yt,d,c,Be("Content-Encoding: nonce\0"),12),x=ir(a,l).encrypt(ve(Be(t),Uint8Array.of(2))),y=ve(c,Uint8Array.of(0,0,16,0),Uint8Array.of(65),u);return Array.from(ve(y,x))}return hr(co);})();
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/utils.js:
@noble/curves/esm/abstract/modular.js:
@noble/curves/esm/abstract/curve.js:
@noble/curves/esm/abstract/weierstrass.js:
@noble/curves/esm/_shortw_utils.js:
@noble/curves/esm/nist.js:
@noble/curves/esm/p256.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/ciphers/esm/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/

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
  const name=id=>(after.people.find(p=>p.id===id)||{}).name||'A flatmate',cur=after.currency||'EUR',money=c=>cur+' '+(c/100).toFixed(2);
  const messages={};
  for(const e of added)for(const id of Object.keys(e.shares)){
    if(id===e.paidBy||!e.shares[id])continue;
    (messages[id]=messages[id]||[]).push(e.kind==='settle'?name(e.paidBy)+' paid you '+money(e.amount):name(e.paidBy)+' added '+e.title+' · your share '+money(e.shares[id]));
  }
  const props=PropertiesService.getScriptProperties(),all=props.getProperties();let sent=0;
  for(const key of Object.keys(all).filter(k=>k.indexOf('device_')===0)){
    const d=JSON.parse(all[key]),lines=messages[d.person];
    if(d.home!==homeHash||!lines||!d.keys||sent>=20)continue;
    const message={title:after.name+' · '+(lines.length===1?'New expense':lines.length+' new expenses'),body:lines.length>3?lines.length+' new expenses and payments involve you.':lines.join('\n'),tag:'flatflow-expense'};
    try{const status=sendPush_(d.endpoint,message,d.keys);sent++;if(status===404||status===410)props.deleteProperty(key);}catch(err){console.log('Expense notification failed: '+err.message);}
  }
}

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

// Copies every home, account, session and phone subscription, plus the push keys
// and Google client ID, to the Cloudflare backend. Run from the owner's editor after
// setting the script properties CLOUDFLARE_URL (the worker address) and
// MIGRATION_TOKEN (the same value as the worker's secret), or a temporary
// MIGRATION_CONFIG = {url, token} file. It only reads from this project, so it can
// be run again right before switching the app over; newer copies are never overwritten.
function migrateToCloudflare(){
  if(Session.getActiveUser().getEmail()!=='developer.akash1043@gmail.com')throw new Error('Run the migration from the owner’s Apps Script editor.');
  const props=PropertiesService.getScriptProperties(),config=typeof MIGRATION_CONFIG==='object'?MIGRATION_CONFIG:{};
  const url=String(props.getProperty('CLOUDFLARE_URL')||config.url||'').replace(/\/+$/,''),token=props.getProperty('MIGRATION_TOKEN')||config.token;
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
  // The same VAPID keys keep every phone's existing subscription working.
  const settings={};['VAPID_PRIVATE','VAPID_PUBLIC','GOOGLE_CLIENT_ID'].forEach(k=>{if(props.getProperty(k))settings[k]=props.getProperty(k);});
  send({settings:settings});
  console.log('Copied '+homes+' homes and '+records+' accounts, sessions and devices and '+Object.keys(settings).join(', ')+' to '+url+'.');
}

function clone_(v){return JSON.parse(JSON.stringify(v));}
const uid_ = () => Utilities.getUuid();
const iso_ = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const date_ = s => new Date(`${s}T12:00:00`);
const addDays_ = (s,n) => { const d=date_(s);d.setDate(d.getDate()+n);return iso_(d); };
function nextDue_(t) {
  if(t.unit !== 'month') return addDays_(t.due,t.every*(t.unit==='week'?7:1));
  const d=date_(t.due), day=t.anchorDay||d.getDate();
  d.setDate(1);d.setMonth(d.getMonth()+t.every);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(day,last));return iso_(d);
}
const away_ = (p,on=iso_()) => !!(p && (p.paused || (p.awayFrom && p.awayTo && on>=p.awayFrom && on<=p.awayTo)));
function assignee_(t,people,on=t.due) {
  for(let i=0;i<t.order.length;i++){
    const id=t.order[(t.turn+i)%t.order.length], p=people.find(x=>x.id===id);
    if(p&&!away_(p,on))return p;
  }
  return null;
}
function advance_(t,people,on=t.due) {
  const p=assignee_(t,people,on);
  t.turn=p?(t.order.indexOf(p.id)+1)%t.order.length:(t.turn+1)%Math.max(1,t.order.length);
}
const emptyHome_ = name => ({schema:1,id:uid_(),name:name||'Our happy place',people:[],tasks:[],history:[],created: new Date().toISOString()});
function demoHome_(){
  const h=emptyHome_('The Sunday Club');
  h.people=['Alex','Jamie','Sam','Taylor'].map((name,i)=>({id:uid_(),name,color:i,paused:false,awayFrom:'',awayTo:''}));
  h.tasks=[['Kitchen reset','Kitchen','🍳',20,1,'day',0],['Take out the recycling','Whole home','♻️',10,1,'week',0],['Bathroom sparkle','Bathroom','🫧',25,1,'week',1],['Vacuum the living room','Living room','🧹',15,1,'week',2],['Water the plants','Living room','🌿',5,3,'day',3],['Deep-clean the fridge','Kitchen','🧊',30,1,'month',5]].map((a,i)=>({id:uid_(),title:a[0],area:a[1],icon:a[2],minutes:a[3],every:a[4],unit:a[5],due:addDays_(iso_(),a[6]),anchorDay:date_(addDays_(iso_(),a[6])).getDate(),order:h.people.map(p=>p.id),turn:i%4,notes:'',paused:false}));
  return h;
}
function validateHome_(h){
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  if(h&&h.currency!==undefined&&(typeof h.currency!=='string'||!/^[A-Z]{3}$/.test(h.currency)))fail();
  if(!h||h.schema!==1||typeof h.id!=='string'||typeof h.name!=='string'||!h.name.trim()||h.name.length>80||!Array.isArray(h.people)||!Array.isArray(h.tasks)||!Array.isArray(h.history)||h.people.length>30||h.tasks.length>100||h.history.length>200)fail();
  const validDate = s => typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(date_(s))&&iso_(date_(s))===s;
  const ids=new Set();
  for(const p of h.people){if(!p||typeof p.id!=='string'||ids.has(p.id)||!/^[\w-]{1,80}$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||!Number.isInteger(p.color)||p.color<0||p.color>5||typeof p.paused!=='boolean'||(p.awayFrom&&!validDate(p.awayFrom))||(p.awayTo&&!validDate(p.awayTo))||(p.awayFrom&&p.awayTo&&p.awayTo<p.awayFrom))fail();ids.add(p.id);}
  const taskIds=new Set();
  for(const t of h.tasks){if(!t||typeof t.id!=='string'||!/^[\w-]{1,80}$/.test(t.id)||taskIds.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>100||typeof t.area!=='string'||t.area.length>60||typeof t.icon!=='string'||t.icon.length>16||typeof t.notes!=='string'||t.notes.length>1000||typeof t.paused!=='boolean'||!Number.isInteger(t.every)||t.every<1||t.every>365||!['day','week','month'].includes(t.unit)||!validDate(t.due)||!Number.isInteger(t.anchorDay)||t.anchorDay<1||t.anchorDay>31||!Number.isInteger(t.minutes)||t.minutes<1||t.minutes>600||!Array.isArray(t.order)||new Set(t.order).size!==t.order.length||!t.order.length||t.order.some(id=>!ids.has(id))||!Number.isInteger(t.turn)||t.turn<0||t.turn>=t.order.length)fail();taskIds.add(t.id);}
  for(const e of h.history){if(!e||typeof e.id!=='string'||typeof e.text!=='string'||e.text.length>500||typeof e.at!=='string'||isNaN(Date.parse(e.at))||typeof e.kind!=='string'||typeof e.person!=='string'||typeof e.task!=='string'||!Number.isFinite(e.minutes)||e.minutes<0||e.minutes>600)fail();}
  validateExpenses_(h,validDate);
  if(JSON.stringify(h).length>40000)throw new Error('This home is too large. Export a backup and clear older activity first.');
  return h;
}
function record_(h,kind,text,person='',task='',minutes=0){h.history.unshift({id:uid_(),kind,text,person,task,minutes,at:new Date().toISOString()});h.history=h.history.slice(0,200);}
function complete_(h,id){const t=h.tasks.find(t=>t.id===id);if(!t||t.paused)throw new Error('This task is unavailable.');const p=assignee_(t,h.people);if(!p)throw new Error('Everyone in this rotation is away_. Edit the task to add someone available.');record_(h,'done',`${p.name} completed ${t.title}`,p.id,t.id,t.minutes);advance_(t,h.people);t.due=nextDue_(t);}
// A turn lasts until the next scheduled occurrence. Unfinished turns expire
// at that boundary, so daily/weekly/monthly rotations continue automatically.
function rollOver_(h,today=iso_()){
  let changed=false;
  for(const t of h.tasks.filter(t=>!t.paused)){
    let n=0;
    while(nextDue_(t)<=today){
      if(++n>50000)throw new Error('This chore starts too far in the past. Choose a recent due date_.');
      const p=assignee_(t,h.people);
      if(n<=200)record_(h,'missed',`${t.title} was not completed for ${t.due}${p?' · '+p.name:''}`,p?.id||'',t.id);
      advance_(t,h.people);t.due=nextDue_(t);changed=true;
    }
  }
  return postDueBills_(h,today)||changed;
}
function skip_(h,id,reason){const t=h.tasks.find(t=>t.id===id),p=t&&assignee_(t,h.people);if(!p)throw new Error('No one is available for this task.');const other=t.order.filter(id=>id!==p.id).find(id=>{const x=h.people.find(p=>p.id===id);return x&&!away_(x,t.due);});if(!other)throw new Error('Add another available person before passing this turn.');advance_(t,h.people);record_(h,'skip_',`${p.name} passed ${t.title}${reason?`: ${reason}`:''}`,p.id,t.id);}
function schedule_(h,days=35){const result=[],end=addDays_(iso_(),days);for(const original of h.tasks.filter(t=>!t.paused)){const t=clone_(original);for(let i=0;i<400&&t.due<=end;i++){const p=assignee_(t,h.people);result.push({task:t.id,title:t.title,icon:t.icon,area:t.area,due:t.due,person:p,minutes:t.minutes});advance_(t,h.people);t.due=nextDue_(t);}}return result.sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title));}
const icsEscape_=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
function calendar_(h,person=''){
  const events=schedule_(h,60).filter(e=>e.due>=iso_()&&(!person||e.person?.id===person));
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Flatflow//Household chores//EN','CALSCALE:GREGORIAN',...events.flatMap(e=>['BEGIN:VEVENT',`UID:${h.id}-${e.task}-${e.due}@flatflow`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${e.due.replaceAll('-','')}`,`DTEND;VALUE=DATE:${addDays_(e.due,1).replaceAll('-','')}`,`SUMMARY:${icsEscape_(e.title+' · '+(e.person?.name||'Unassigned'))}`,`DESCRIPTION:${icsEscape_('Flatflow chore. '+e.minutes+' minutes. Schedule snapshot: re-after changes.')}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${icsEscape_(e.title)}`,'TRIGGER:PT9H','END:VALARM','END:VEVENT']),'END:VCALENDAR'].join('\r\n')+'\r\n';
}

function removePerson_(h,id){
  const person=h.people.find(p=>p.id===id);if(!person)throw new Error('This flatmate no longer exists.');
  const solo=h.tasks.filter(t=>t.order.length===1&&t.order[0]===id);
  if(solo.length)throw new Error('Reassign these chores before deleting this flatmate: '+solo.map(t=>t.title).join(', '));
  if(expenseBalances_(h)[id])throw new Error('Settle up with '+person.name+' before deleting them.');
  for(const t of h.tasks){if(!t.order.includes(id))continue;const current=assignee_(t,h.people)?.id;const next=t.order[(t.order.indexOf(id)+1)%t.order.length];t.order=t.order.filter(x=>x!==id);t.turn=Math.max(0,t.order.indexOf(current&&current!==id?current:next));}
  h.people=h.people.filter(p=>p.id!==id);record_(h,'person',person.name+' left the home');
}

// Shared expenses. Amounts are integer cents; each expense stores the exact
// share owed by every participant, so balances never drift from rounding.
// Settlements are expenses of kind 'settle': the payer is owed back by the receiver.
function validateExpenses_(h,validDate){
  validateBills_(h,validDate);validateShopping_(h);
  if(h.expenses===undefined)return;
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  const validId=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id),ids=new Set();
  if(!Array.isArray(h.expenses)||h.expenses.length>100)fail();
  for(const e of h.expenses){
    if(!e||!validId(e.id)||ids.has(e.id)||!['expense','settle'].includes(e.kind)||typeof e.title!=='string'||!e.title.trim()||e.title.length>100||typeof e.category!=='string'||e.category.length>30||!validDate(e.spentOn)||!validId(e.paidBy)||!Number.isInteger(e.amount)||e.amount<1||e.amount>100000000||!e.shares||typeof e.shares!=='object'||Array.isArray(e.shares))fail();
    const shares=Object.entries(e.shares);
    if(!shares.length||shares.length>30||shares.some(([id,v])=>!validId(id)||!Number.isInteger(v)||v<0)||shares.reduce((n,[,v])=>n+v,0)!==e.amount)fail();
    ids.add(e.id);
  }
}
// Splits cents by weight with the largest-remainder method; ties go to earlier people.
function splitAmount_(amount,weights){
  const entries=Object.entries(weights).filter(([,w])=>w>0),total=entries.reduce((n,[,w])=>n+w,0);
  if(!Number.isInteger(amount)||amount<1)throw new Error('Enter an amount above zero.');
  if(!entries.length||!(total>0))throw new Error('Choose at least one flatmate to split with.');
  const parts=entries.map(([id,w],i)=>{const exact=amount*w/total;return {id,i,cents:Math.floor(exact),rest:exact-Math.floor(exact)};});
  let left=amount-parts.reduce((n,p)=>n+p.cents,0);
  for(const p of parts.slice().sort((a,b)=>b.rest-a.rest||a.i-b.i)){if(!left)break;p.cents++;left--;}
  return Object.fromEntries(parts.map(p=>[p.id,p.cents]));
}
// Positive: the flatmate is owed money. Negative: they owe the household.
function expenseBalances_(h){
  const net={};
  for(const e of h.expenses||[]){net[e.paidBy]=(net[e.paidBy]||0)+e.amount;for(const [id,v] of Object.entries(e.shares))net[id]=(net[id]||0)-v;}
  for(const id of Object.keys(net))if(!net[id])delete net[id];
  return net;
}
// Greedy debt simplification: at most n-1 payments, largest debts first.
function settlements_(h){
  const net=expenseBalances_(h),owe=[],owed=[];
  for(const [id,v] of Object.entries(net))(v<0?owe:owed).push({id,v:Math.abs(v)});
  owe.sort((a,b)=>b.v-a.v||a.id.localeCompare(b.id));owed.sort((a,b)=>b.v-a.v||a.id.localeCompare(b.id));
  const result=[];let i=0,j=0;
  while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i].v,owed[j].v);result.push({from:owe[i].id,to:owed[j].id,amount});owe[i].v-=amount;owed[j].v-=amount;if(!owe[i].v)i++;if(!owed[j].v)j++;}
  return result;
}
function addExpense_(h,e){
  const people=new Set(h.people.map(p=>p.id));
  if(!people.has(e.paidBy)||Object.keys(e.shares).some(id=>!people.has(id)))throw new Error('Choose current flatmates for this expense.');
  h.expenses=h.expenses||[];
  compactExpenses_(h);
  const expense={id:uid_(),kind:e.kind||'expense',title:e.title,category:e.category||'',spentOn:e.spentOn,paidBy:e.paidBy,amount:e.amount,shares:e.shares};
  h.expenses.unshift(expense);
  const payer=h.people.find(p=>p.id===e.paidBy).name,cents=`${h.currency||'EUR'} ${(e.amount/100).toFixed(2)}`;
  if(expense.kind==='settle')record_(h,'settle',`${payer} paid ${h.people.find(p=>p.id===Object.keys(e.shares)[0]).name} ${cents}`,e.paidBy);
  else record_(h,'expense',`${payer} paid ${cents} for ${e.title}`,e.paidBy);
  return expense;
}
function removeExpense_(h,id){
  const e=(h.expenses||[]).find(e=>e.id===id);if(!e)throw new Error('This expense no longer exists.');
  h.expenses=h.expenses.filter(x=>x.id!==id);record_(h,'expense',`${e.title} was removed from expenses`);
}
// Once everyone is square, old expenses can be cleared to keep the household small.
function clearSettledExpenses_(h){
  if(Object.keys(expenseBalances_(h)).length)throw new Error('Settle every balance before clearing expenses.');
  const n=(h.expenses||[]).length;h.expenses=[];record_(h,'expense',`${n} settled expense${n===1?'':'s'} cleared`);
}
// When the expense list is full, the 30 oldest expenses are folded into a few
// "Earlier balances" entries with the same net effect, so balances stay exact.
// Also runs when the home nears the size a Google Sheets cell can hold.
function compactExpenses_(h){
  while(h.expenses.length>30&&(h.expenses.length>=100||JSON.stringify(h).length>34000))foldOldest(h);
}
function foldOldest(h){
  const old=h.expenses.slice(-30),net={};
  for(const e of old){net[e.paidBy]=(net[e.paidBy]||0)+e.amount;for(const [id,v] of Object.entries(e.shares))net[id]=(net[id]||0)-v;}
  const carried=[];
  const owe=[],owed=[];for(const [id,v] of Object.entries(net))if(v)(v<0?owe:owed).push({id,v:Math.abs(v)});
  owe.sort((a,b)=>b.v-a.v);owed.sort((a,b)=>b.v-a.v);let i=0,j=0;
  const day=old.map(e=>e.spentOn).sort().pop();
  while(i<owe.length&&j<owed.length){const amount=Math.min(owe[i].v,owed[j].v);carried.push({id:uid_(),kind:'expense',title:'Earlier balances',category:'Carried over',spentOn:day,paidBy:owed[j].id,amount,shares:{[owe[i].id]:amount}});owe[i].v-=amount;owed[j].v-=amount;if(!owe[i].v)i++;if(!owed[j].v)j++;}
  h.expenses=h.expenses.slice(0,-30).concat(carried);
}
// Recurring bills (rent, internet…) post a normal expense each time they fall due.
function validateBills_(h,validDate){
  if(h.bills===undefined)return;
  const fail=()=>{throw new Error('This is not a valid Flatflow backup. No data was changed.');};
  const validId=id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id),ids=new Set();
  if(!Array.isArray(h.bills)||h.bills.length>20)fail();
  for(const b of h.bills){
    if(!b||!validId(b.id)||ids.has(b.id)||typeof b.title!=='string'||!b.title.trim()||b.title.length>100||typeof b.category!=='string'||b.category.length>30||!validId(b.paidBy)||!Number.isInteger(b.amount)||b.amount<1||b.amount>100000000||!b.shares||typeof b.shares!=='object'||Array.isArray(b.shares)||!validDate(b.due)||!['day','week','month'].includes(b.unit)||!Number.isInteger(b.every)||b.every<1||b.every>365||!Number.isInteger(b.anchorDay)||b.anchorDay<1||b.anchorDay>31||typeof b.paused!=='boolean')fail();
    const shares=Object.entries(b.shares);
    if(!shares.length||shares.length>30||shares.some(([id,v])=>!validId(id)||!Number.isInteger(v)||v<0)||shares.reduce((n,[,v])=>n+v,0)!==b.amount)fail();
    ids.add(b.id);
  }
}
function postDueBills_(h,today=iso_()){
  let changed=false;
  for(const b of (h.bills||[]).filter(b=>!b.paused)){
    for(let n=0;b.due<=today&&n<24;n++){
      const ids=new Set(h.people.map(p=>p.id));
      if(!ids.has(b.paidBy)||Object.keys(b.shares).some(id=>!ids.has(id))){b.paused=true;record_(h,'expense',`${b.title} was paused because a flatmate in it left`);changed=true;break;}
      addExpense_(h,{title:b.title,category:b.category,spentOn:b.due,paidBy:b.paidBy,amount:b.amount,shares:b.shares});
      b.due=nextDue_(b);changed=true;
    }
  }
  return changed;
}
// Shared shopping list; bought items can be logged together as one expense.
function validateShopping_(h){
  if(h.shopping===undefined)return;
  const ok=i=>i&&typeof i.id==='string'&&/^[\w-]{1,80}$/.test(i.id)&&typeof i.item==='string'&&i.item.trim()&&i.item.length<=80&&typeof i.addedBy==='string'&&i.addedBy.length<=80&&typeof i.done==='boolean';
  if(!Array.isArray(h.shopping)||h.shopping.length>60||!h.shopping.every(ok)||new Set(h.shopping.map(i=>i.id)).size!==h.shopping.length)throw new Error('This is not a valid Flatflow backup. No data was changed.');
}
