import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,verify,createECDH,hkdfSync,createDecipheriv,randomBytes} from 'node:crypto';
import {p256} from '@noble/curves/p256';
import {sign,encrypt} from '../scripts/push-crypto.js';
test('VAPID uses standard ES256 signatures verifiable by Node crypto',()=>{
 const secret='1'.repeat(64),publicKey=p256.getPublicKey(secret,false),b=v=>Buffer.from(v).toString('base64url');
 const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:b(publicKey.slice(1,33)),y:b(publicKey.slice(33))},format:'jwk'});
 const message=b('{"typ":"JWT","alg":"ES256"}')+'.'+b('{"aud":"https://web.push.apple.com","exp":2000000000}');
 const signature=Buffer.from(sign(message,secret));assert.equal(signature.length,64);
 assert.equal(verify('sha256',Buffer.from(message),{key,dsaEncoding:'ieee-p1363'},signature),true);
 assert.equal(verify('sha256',Buffer.from(message+'x'),{key,dsaEncoding:'ieee-p1363'},signature),false);
});

test('push messages are encrypted per RFC 8291 and readable only by the subscriber',()=>{
  const ua=createECDH('prime256v1');ua.generateKeys();const auth=randomBytes(16);
  const body=Buffer.from(encrypt('{"title":"Rent · your share €600"}',ua.getPublicKey().toString('base64url'),auth.toString('base64url'),[...randomBytes(48)]));
  const salt=body.subarray(0,16),rs=body.readUInt32BE(16),idlen=body[20],asPublic=body.subarray(21,21+idlen),ct=body.subarray(21+idlen);
  assert.equal(rs,4096);assert.equal(idlen,65);
  const shared=ua.computeSecret(asPublic);
  const ikm=Buffer.from(hkdfSync('sha256',shared,auth,Buffer.concat([Buffer.from('WebPush: info\0'),ua.getPublicKey(),asPublic]),32));
  const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const d=createDecipheriv('aes-128-gcm',cek,nonce);d.setAuthTag(ct.subarray(-16));
  const plain=Buffer.concat([d.update(ct.subarray(0,-16)),d.final()]);
  assert.equal(plain[plain.length-1],2);assert.equal(plain.subarray(0,-1).toString(),'{"title":"Rent · your share €600"}');
  assert.throws(()=>encrypt('x','short',auth.toString('base64url'),[...randomBytes(48)]),/Invalid push subscription keys/);
});
