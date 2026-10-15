import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {p256} from '@noble/curves/p256';
import {sign} from '../scripts/push-crypto.js';
test('VAPID uses standard ES256 signatures verifiable by Node crypto',()=>{
 const secret='1'.repeat(64),publicKey=p256.getPublicKey(secret,false),b=v=>Buffer.from(v).toString('base64url');
 const key=createPublicKey({key:{kty:'EC',crv:'P-256',x:b(publicKey.slice(1,33)),y:b(publicKey.slice(33))},format:'jwk'});
 const message=b('{"typ":"JWT","alg":"ES256"}')+'.'+b('{"aud":"https://web.push.apple.com","exp":2000000000}');
 const signature=Buffer.from(sign(message,secret));assert.equal(signature.length,64);
 assert.equal(verify('sha256',Buffer.from(message),{key,dsaEncoding:'ieee-p1363'},signature),true);
 assert.equal(verify('sha256',Buffer.from(message+'x'),{key,dsaEncoding:'ieee-p1363'},signature),false);
});
