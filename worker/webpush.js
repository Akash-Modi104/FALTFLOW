// Web push with the platform's built-in WebCrypto: ES256 VAPID signatures and
// RFC 8291 aes128gcm encryption. Native crypto keeps each request well inside
// the Workers free plan's CPU budget.
const subtle = crypto.subtle, enc = new TextEncoder();
export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const fromHex = h => Uint8Array.from(h.match(/../g),b=>parseInt(b,16));
const concat = (...parts) => {const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};

// VAPID_PRIVATE is the 32-byte scalar as hex, VAPID_PUBLIC the uncompressed point as base64url,
// the same values the Apps Script backend uses, so existing subscriptions keep working.
async function vapidKey(privateHex, publicB64) {
  const pub = fromB64url(publicB64);
  if (!/^[a-f0-9]{64}$/i.test(privateHex) || pub.length !== 65) throw new Error('Phone reminders are not configured yet.');
  return subtle.importKey('jwk', {kty:'EC',crv:'P-256',d:b64url(fromHex(privateHex)),x:b64url(pub.slice(1,33)),y:b64url(pub.slice(33)),ext:true}, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
}

// One signed token per push service origin is enough for a whole batch.
export function vapidSigner(env) {
  const tokens = new Map();
  let key;
  return async endpoint => {
    const audience = endpoint.match(/^https:\/\/[^/]+/)[0];
    if (!tokens.has(audience)) {
      key ||= await vapidKey(env.VAPID_PRIVATE || '', env.VAPID_PUBLIC || '');
      const input = b64url(enc.encode('{"typ":"JWT","alg":"ES256"}')) + '.' + b64url(enc.encode(JSON.stringify({aud:audience,exp:Math.floor(Date.now()/1000)+3600,sub:env.VAPID_SUBJECT||'mailto:developer.akash1043@gmail.com'})));
      const signature = await subtle.sign({name:'ECDSA',hash:'SHA-256'}, key, enc.encode(input));
      tokens.set(audience, 'vapid t=' + input + '.' + b64url(signature) + ', k=' + env.VAPID_PUBLIC);
    }
    return tokens.get(audience);
  };
}

async function hkdf(ikm, salt, info, bits) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info}, key, bits));
}

// Encrypts a message so only the subscribed browser can read it.
export async function encryptPush(text, p256dh, authSecret) {
  const uaPublic = fromB64url(p256dh), auth = fromB64url(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error('Invalid push subscription keys.');
  const pair = await subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, {name:'ECDH',namedCurve:'P-256'}, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({name:'ECDH',public:uaKey}, pair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(shared, auth, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 256);
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv:nonce}, aes, concat(enc.encode(text), Uint8Array.of(2))));
  return concat(salt, Uint8Array.of(0,0,16,0), Uint8Array.of(65), asPublic, body);
}

// Only official Apple, Google and Mozilla push services may receive requests.
export function pushEndpoint(endpoint) {
  if (typeof endpoint!=='string'||endpoint.length>2048||!/^https:\/\/(?:fcm\.googleapis\.com\/fcm\/send\/|web\.push\.apple\.com\/|updates\.push\.services\.mozilla\.com\/wpush\/v2\/)[A-Za-z0-9_\-\/.?=&%]+$/.test(endpoint)) throw new Error('Unsupported notification service. Use Safari, Chrome, Edge, or Firefox.');
  return endpoint;
}

// Returns the push service's HTTP status. Without a message the push is empty
// and the service worker shows a generic reminder.
export async function sendPush(sign, endpoint, message, keys, fetcher = fetch) {
  pushEndpoint(endpoint);
  const headers = {Authorization: await sign(endpoint), TTL:'3600', Urgency:'normal', 'Content-Type':'application/octet-stream'};
  let body = new Uint8Array(0);
  if (message && keys) {headers['Content-Encoding'] = 'aes128gcm';body = await encryptPush(JSON.stringify(message), keys.p256dh, keys.auth);}
  const response = await fetcher(endpoint, {method:'POST', headers, body, redirect:'manual'});
  return response.status;
}
