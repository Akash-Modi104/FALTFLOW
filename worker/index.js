import {createBackend} from './backend.js';

const ALLOWED_ORIGINS = ['https://akash-modi104.github.io','http://localhost:4173','http://127.0.0.1:4173'];
const MAX_BODY = 256 * 1024;

const json = (data, status, origin) => new Response(JSON.stringify(data), {status, headers:{
  'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin',
  ...(origin ? {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Max-Age':'86400'} : {})
}});
// Constant-time comparison for the migration token.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Messages from Flatflow's own checks are shown to people; storage errors are not.
const publicMessage = err => err?.expose || !/D1_|SQLITE|internal/i.test(String(err?.message)) ? String(err.message || 'Sync failed') : 'Sync failed. Try again.';

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('This change is too large to sync.'), {expose:true});
  try {return JSON.parse(text);} catch {throw Object.assign(new Error('Invalid request.'), {expose:true});}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), origin = request.headers.get('Origin') || '';
    if (url.pathname === '/migrate' && request.method === 'POST') {
      // Called from the owner's Apps Script editor, never from browsers.
      if (!env.MIGRATION_TOKEN || !sameSecret(request.headers.get('Authorization') || '', 'Bearer ' + env.MIGRATION_TOKEN)) return json({error:'Not found'}, 404);
      try {return json(await createBackend(env).migrate(JSON.parse(await request.text())), 200);}
      catch (err) {return json({error:String(err.message)}, 400);}
    }
    if (url.pathname !== '/rpc') return new Response('Flatflow backend is ready. Open the Flatflow app to connect.', {headers:{'Content-Type':'text/plain'}});
    if (!ALLOWED_ORIGINS.includes(origin)) return json({error:'Open Flatflow from its own address.'}, 403);
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:json({}, 204, origin).headers});
    if (request.method !== 'POST') return json({error:'Unsupported request.'}, 405, origin);
    try {
      const backend = createBackend(env, {waitUntil:p => ctx.waitUntil(p)});
      return json(await backend.rpc(await readBody(request)), 200, origin);
    } catch (err) {
      if (!err?.expose) console.log('Request failed: ' + err?.stack);
      return json({error:publicMessage(err)}, 400, origin);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(createBackend(env).daily(new Date(event.scheduledTime)));
  }
};
