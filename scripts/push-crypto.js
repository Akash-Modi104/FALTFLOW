import {p256} from '@noble/curves/p256';
import {sha256} from '@noble/hashes/sha256';
// A standards-based VAPID signature; notifications carry no personal payload.
export function sign(message, privateKeyHex) {
  const digest=sha256(Uint8Array.from(message.split('').map(c=>c.charCodeAt(0))));
  return Array.from(p256.sign(digest,privateKeyHex,{lowS:true,extraEntropy:false}).toCompactRawBytes());
}
