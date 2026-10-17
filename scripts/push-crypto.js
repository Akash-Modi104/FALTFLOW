import {p256} from '@noble/curves/p256';
import {sha256} from '@noble/hashes/sha256';
import {hkdf} from '@noble/hashes/hkdf';
import {gcm} from '@noble/ciphers/aes';
// A standards-based VAPID signature; daily reminders carry no personal payload.
export function sign(message, privateKeyHex) {
  const digest=sha256(Uint8Array.from(message.split('').map(c=>c.charCodeAt(0))));
  return Array.from(p256.sign(digest,privateKeyHex,{lowS:true,extraEntropy:false}).toCompactRawBytes());
}
const fromB64url=s=>Uint8Array.from(atobSafe(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const utf8=s=>Uint8Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0));
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
function atobSafe(b64){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let bits=0,value=0,out='';
  for(const c of b64.replace(/=+$/,'')){const v=chars.indexOf(c);if(v<0)throw new Error('Invalid base64');value=(value<<6)|v;bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode((value>>bits)&255);}}
  return out;
}
// Encrypts a push message for one browser subscription (RFC 8291, aes128gcm).
// Apps Script has no secure random source for libraries, so the caller passes
// 48 random bytes: 32 for the one-time key and 16 for the salt.
export function encrypt(text,p256dh,authSecret,random){
  const uaPublic=fromB64url(p256dh),auth=fromB64url(authSecret),seed=Uint8Array.from(random);
  if(uaPublic.length!==65||auth.length!==16||seed.length!==48)throw new Error('Invalid push subscription keys.');
  const asPrivate=seed.slice(0,32),salt=seed.slice(32),asPublic=p256.getPublicKey(asPrivate,false);
  const shared=p256.getSharedSecret(asPrivate,uaPublic,false).slice(1,33);
  const ikm=hkdf(sha256,shared,auth,concat(utf8('WebPush: info\0'),uaPublic,asPublic),32);
  const cek=hkdf(sha256,ikm,salt,utf8('Content-Encoding: aes128gcm\0'),16);
  const nonce=hkdf(sha256,ikm,salt,utf8('Content-Encoding: nonce\0'),12);
  const body=gcm(cek,nonce).encrypt(concat(utf8(text),Uint8Array.of(2)));
  const header=concat(salt,Uint8Array.of(0,0,16,0),Uint8Array.of(65),asPublic);
  return Array.from(concat(header,body));
}
