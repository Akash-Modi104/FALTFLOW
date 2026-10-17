// Short invite codes such as K7M2-QX9P. The household key is encrypted in the
// browser with a key derived from the code, so the backend only ever holds a
// sealed copy, filed under a hash of the code. The code itself is never sent.
const ALPHABET='23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
const enc=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64url=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));

export function makeCode(){
  const out=[];
  while(out.length<8){for(const b of crypto.getRandomValues(new Uint8Array(16)))if(b<248&&out.length<8)out.push(ALPHABET[b%31]);}
  return out.slice(0,4).join('')+'-'+out.slice(4).join('');
}
// Accepts what people type: lower case, spaces or a missing dash.
export function normalizeCode(input){
  const s=String(input||'').toUpperCase().replace(/[\s-]/g,'');
  return /^[2-9A-HJKMNP-Z]{8}$/.test(s)?s.slice(0,4)+'-'+s.slice(4):'';
}
export const looksLikeCode=input=>!!normalizeCode(input);
export async function inviteId(code){return hex(await crypto.subtle.digest('SHA-256',enc.encode('flatflow-invite|'+code)));}
async function codeKey(code){
  const base=await crypto.subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:enc.encode('flatflow-invite-key'),iterations:200000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealKey(householdKey,code){
  const iv=crypto.getRandomValues(new Uint8Array(12)),raw=Uint8Array.from(householdKey.match(/../g),h=>parseInt(h,16));
  const sealed=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await codeKey(code),raw));
  return b64url(new Uint8Array([...iv,...sealed]));
}
export async function openKey(sealed,code){
  try{const bytes=fromB64url(sealed);return hex(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await codeKey(code),bytes.slice(12)));}
  catch{throw new Error('That invite code is wrong or has expired. Ask for a new one.');}
}
