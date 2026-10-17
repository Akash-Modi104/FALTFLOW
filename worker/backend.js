// Flatflow backend for Cloudflare Workers + D1, on the free plan.
// Same RPC actions and responses as the Apps Script backend, so the app works
// with either. Invitation keys, session tokens and Google account ids are only
// ever stored as SHA-256 hashes.
import {validateHome, rollOver, away, assignee} from '../public/core.js';
import {vapidSigner, sendPush, pushEndpoint} from './webpush.js';

export const MAX_HOMES = 200, MAX_DEVICES = 300, SESSION_DAYS = 90, INVITE_DAYS = 7, MAX_INVITES = 1000;
export const ACCOUNT_ACTIONS = ['authConfig','signIn','myHomes','linkHome','unlinkHome','signOut'];
const PUSH_ACTIONS = ['pushConfig','subscribePush','unsubscribePush','testPush'];

export async function hash(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const berlinDate = (d = new Date()) => d.toLocaleDateString('en-CA', {timeZone:'Europe/Berlin'});
const berlinHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Berlin', hour:'2-digit', hourCycle:'h23'}).format(d));
const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
const validKey = k => typeof k==='string' && /^[a-f0-9]{64}$/.test(k);
const fail = message => {const e = new Error(message);e.expose = true;throw e;};

// Values copied from the Apps Script project by the migration. Worker secrets
// with the same names take precedence.
export const SETTINGS = ['VAPID_PRIVATE','VAPID_PUBLIC','GOOGLE_CLIENT_ID'];
let cachedSettings = null;
export async function withSettings(env, maxAge = 60000) {
  if (!cachedSettings || cachedSettings.db !== env.DB || Date.now() - cachedSettings.at > maxAge) {
    const {results} = await env.DB.prepare('SELECT name, value FROM settings').all();
    cachedSettings = {db:env.DB, at:Date.now(), values:Object.fromEntries(results.map(r=>[r.name, r.value]))};
  }
  const merged = {...env};
  for (const name of SETTINGS) if (!merged[name] && cachedSettings.values[name]) merged[name] = cachedSettings.values[name];
  return merged;
}

export function createBackend(env, {fetcher = fetch, waitUntil = p => p} = {}) {
  const db = env.DB;
  const readHome = async h => {
    const row = await db.prepare('SELECT hash, revision, home, op FROM homes WHERE hash = ?').bind(h).first();
    return row ? {hash:row.hash, revision:row.revision, home:JSON.parse(row.home), op:row.op} : null;
  };
  const publicResult = entry => ({ok:true, revision:entry.revision, home:entry.home});
  // Saves only if nobody else wrote in between; returns false when another write won.
  const saveHome = async (entry, previousRevision, op) => {
    validateHome(entry.home);
    const result = await db.prepare('UPDATE homes SET revision = ?, updated_at = ?, home = ?, op = ? WHERE hash = ? AND revision = ?')
      .bind(entry.revision, new Date().toISOString(), JSON.stringify(entry.home), op || '', entry.hash, previousRevision).run();
    return result.meta.changes === 1;
  };
  const rolledOver = async entry => {
    if (!rollOver(entry.home, berlinDate())) return entry;
    const previous = entry.revision;entry.revision++;
    return await saveHome(entry, previous, 'rollover-' + crypto.randomUUID()) ? entry : readHome(entry.hash);
  };

  async function rpc(request) {
    if (request && ACCOUNT_ACTIONS.includes(request.action)) return accountOperation(request);
    const member = await requireMember(request);
    if (request && request.action === 'redeemInvite') return redeemInvite(request);
    if (!request || !validKey(request.key)) fail('Invalid household invitation.');
    const h = await hash(request.key);
    if (request.action === 'create') {
      const existing = await readHome(h);
      if (existing) return publicResult(existing);
      const count = (await db.prepare('SELECT COUNT(*) AS n FROM homes').first()).n;
      if (count >= MAX_HOMES) fail('Household limit reached. Ask the app owner.');
      validateHome(request.home);
      request.home.people.forEach(p=>{delete p.email;delete p.emailVerified;});
      const entry = {hash:h, revision:1, home:request.home};
      await db.prepare('INSERT OR IGNORE INTO homes (hash, revision, updated_at, home, op) VALUES (?, 1, ?, ?, ?)').bind(h, new Date().toISOString(), JSON.stringify(entry.home), String(request.op || '')).run();
      await linkMember(member, request.key);
      return publicResult(await readHome(h));
    }
    let entry = await readHome(h);
    if (!entry) fail('Household not found. Ask your flatmate for the invitation link.');
    await linkMember(member, request.key);
    entry = await rolledOver(entry);
    if (request.action === 'createInvite') return createInvite(request, entry);
    if (request.action === 'read') return Number(request.revision) === entry.revision ? {ok:true, unchanged:true, revision:entry.revision} : publicResult(entry);
    if (request.action === 'write') {
      if (typeof request.op !== 'string' || !/^[\w-]{20,80}$/.test(request.op)) fail('Invalid operation.');
      if (entry.op === request.op) return publicResult(entry);
      if (Number(request.revision) !== entry.revision) return {ok:false, conflict:true, revision:entry.revision, home:entry.home};
      validateHome(request.home);
      // Verification is controlled by the server, never by editable JSON.
      request.home.people.forEach(p=>{const previous=entry.home.people.find(x=>x.id===p.id);if(previous&&previous.emailVerified){p.email=previous.email;p.emailVerified=true;}else{delete p.email;delete p.emailVerified;}});
      const before = entry.home, previous = entry.revision;
      const next = {hash:h, revision:previous + 1, home:request.home};
      if (!await saveHome(next, previous, request.op)) {const latest = await readHome(h);return {ok:false, conflict:true, revision:latest.revision, home:latest.home};}
      waitUntil(notifyExpenses(h, before, next.home).catch(err=>console.log('Notifications skipped: ' + err.message)));
      return publicResult(next);
    }
    if (PUSH_ACTIONS.includes(request.action)) return pushOperation(request, entry);
    fail('Unsupported operation.');
  }

  // Once Google sign-in is configured, every home action needs a signed-in
  // account. Opening a home with its key (link, code or a device that already
  // had it) adds the home to that account.
  async function requireMember(request) {
    if (!env.GOOGLE_CLIENT_ID) return null;
    const session = validKey(String(request?.session || '')) ? await db.prepare('SELECT sub, exp FROM sessions WHERE id = ?').bind(await hash(request.session)).first() : null;
    if (!session || session.exp < Date.now()) fail('Sign in to continue.');
    const id = await hash(session.sub), account = await readAccount(id);
    if (!account) fail('Sign in to continue.');
    return {id, account};
  }
  async function linkMember(member, key) {
    if (!member || member.account.homes.some(x=>x.key===key)) return;
    if (member.account.homes.length >= 20) fail('An account can belong to up to 20 homes. Leave one first.');
    member.account.homes.push({key, person:''});
    await saveAccount(member.id, member.account);
  }

  // Short invite codes. The app encrypts the household key with the code before
  // sending it, so only that sealed copy is kept, filed under a hash of the code.
  // Codes last 7 days; a home keeps its 3 newest.
  async function createInvite(request, entry) {
    if (!validKey(String(request.invite || '')) || typeof request.sealed !== 'string' || !/^[\w-]{40,200}$/.test(request.sealed)) fail('Invalid invite code.');
    const now = Date.now(), exp = now + INVITE_DAYS * 864e5;
    await db.prepare('DELETE FROM invites WHERE exp < ?').bind(now).run();
    await db.prepare('DELETE FROM invites WHERE home = ? AND id NOT IN (SELECT id FROM invites WHERE home = ? ORDER BY exp DESC LIMIT 2)').bind(entry.hash, entry.hash).run();
    if ((await db.prepare('SELECT COUNT(*) AS n FROM invites').first()).n >= MAX_INVITES) fail('Too many open invite codes. Try again tomorrow, or share the link.');
    await db.prepare('INSERT OR REPLACE INTO invites (id, home, sealed, exp) VALUES (?, ?, ?, ?)').bind(request.invite, entry.hash, request.sealed, exp).run();
    return {ok:true, expires:new Date(exp).toISOString()};
  }
  async function redeemInvite(request) {
    if (!validKey(String(request.invite || ''))) fail('Check the invite code and try again.');
    const row = await db.prepare('SELECT sealed, exp FROM invites WHERE id = ?').bind(request.invite).first();
    if (!row || row.exp < Date.now()) fail('That invite code is wrong or has expired. Ask for a new one.');
    return {ok:true, sealed:row.sealed};
  }

  // Personal accounts through Google sign-in. Google verifies the person; the
  // backend then issues its own long-lived session so phones stay signed in.
  async function accountOperation(request) {
    if (request.action === 'authConfig') {const id = env.GOOGLE_CLIENT_ID || '';return {enabled:!!id, clientId:id};}
    if (request.action === 'signIn') return signIn(request.idToken);
    const session = validKey(String(request.session || '')) ? await db.prepare('SELECT id, sub, exp FROM sessions WHERE id = ?').bind(await hash(request.session)).first() : null;
    if (!session || session.exp < Date.now()) {
      if (session) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
      fail('Your sign-in has expired. Sign in again.');
    }
    if (request.action === 'signOut') {await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();return {ok:true};}
    const accountId = await hash(session.sub), account = await readAccount(accountId);
    if (!account) fail('Your sign-in has expired. Sign in again.');
    if (request.action === 'linkHome') {
      if (!validKey(String(request.key || ''))) fail('Invalid household invitation.');
      const found = await readHome(await hash(request.key));
      if (!found) fail('Household not found. Ask your flatmate for the invitation link.');
      const person = String(request.person || '');
      if (person && !found.home.people.some(p=>p.id===person)) fail('Choose your name first.');
      const existing = account.homes.find(x=>x.key===request.key);
      if (existing) {if (person || request.person === '') existing.person = person;}
      else {if (account.homes.length >= 20) fail('An account can belong to up to 20 homes.');account.homes.push({key:request.key, person});}
      await saveAccount(accountId, account);return accountResult(account);
    }
    if (request.action === 'unlinkHome') {account.homes = account.homes.filter(x=>x.key!==request.key);await saveAccount(accountId, account);return accountResult(account);}
    if (request.action === 'myHomes') return accountResult(account);
    fail('Unsupported operation.');
  }

  async function signIn(idToken) {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) fail('Sign-in is not set up for this Flatflow yet.');
    if (typeof idToken !== 'string' || idToken.length > 4096 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken)) fail('Google sign-in failed. Try again.');
    const response = await fetcher('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), {redirect:'manual'});
    if (response.status !== 200) fail('Google sign-in failed. Try again.');
    const claims = await response.json();
    if (claims.aud !== clientId || !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) || Number(claims.exp) * 1000 < Date.now() || !/^\d{1,40}$/.test(String(claims.sub))) fail('Google sign-in failed. Try again.');
    if (String(claims.email_verified) !== 'true') fail('Verify your Google email address, then sign in again.');
    const sub = String(claims.sub), accountId = await hash(sub), account = await readAccount(accountId) || {homes:[]};
    account.email = String(claims.email || '').slice(0,200);account.name = String(claims.name || claims.email || '').slice(0,100);
    await saveAccount(accountId, account);
    // Keep at most 10 active sessions per account and clean up expired ones.
    await db.prepare('DELETE FROM sessions WHERE exp < ?').bind(Date.now()).run();
    await db.prepare('DELETE FROM sessions WHERE sub = ? AND id NOT IN (SELECT id FROM sessions WHERE sub = ? ORDER BY exp DESC LIMIT 9)').bind(sub, sub).run();
    const session = token();
    await db.prepare('INSERT INTO sessions (id, sub, exp) VALUES (?, ?, ?)').bind(await hash(session), sub, Date.now() + SESSION_DAYS * 864e5).run();
    const result = await accountResult(account);result.session = session;return result;
  }
  const readAccount = async id => {const row = await db.prepare('SELECT data FROM accounts WHERE id = ?').bind(id).first();return row ? JSON.parse(row.data) : null;};
  const saveAccount = (id, account) => db.prepare('INSERT INTO accounts (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').bind(id, JSON.stringify(account)).run();
  // Lists the account's homes that still exist, with their current names.
  async function accountResult(account) {
    const homes = [];
    for (const x of account.homes) {const found = await readHome(await hash(x.key));if (found) homes.push({key:x.key, person:found.home.people.some(p=>p.id===x.person) ? x.person : '', name:found.home.name});}
    return {ok:true, account:{name:account.name, email:account.email}, homes};
  }

  // Push devices are stored privately, one record per device and home.
  const deviceId = (endpoint, homeHash) => hash(pushEndpoint(endpoint) + '|' + homeHash);
  const readDevice = id => db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
  const pushConfig = () => ({publicKey:env.VAPID_PUBLIC || null, enabled:!!env.VAPID_PRIVATE && !!env.VAPID_PUBLIC});
  // Records created before multi-home support were keyed by endpoint alone.
  const dropLegacy = async (endpoint, homeHash) => db.prepare('DELETE FROM devices WHERE id = ? AND home = ?').bind(await hash(endpoint), homeHash).run();
  async function pushOperation(request, entry) {
    if (request.action === 'pushConfig') return pushConfig();
    const endpoint = pushEndpoint(request.endpoint), id = await deviceId(endpoint, entry.hash), old = await readDevice(id);
    if (request.action === 'subscribePush') {
      if (!entry.home.people.some(p=>p.id===request.person)) fail('Choose your name first.');
      if (!old) {
        const counts = await db.prepare('SELECT COUNT(*) AS total, SUM(home = ?) AS here FROM devices').bind(entry.hash).first();
        if ((counts.here || 0) >= 30) fail('This home has reached its 30-device limit.');
        if (counts.total >= MAX_DEVICES) fail('Device capacity reached.');
      }
      await dropLegacy(endpoint, entry.hash);
      const keys = pushKeys(request.keys) || (old?.keys ? JSON.parse(old.keys) : null);
      await db.prepare('INSERT INTO devices (id, home, person, endpoint, keys, sent, test_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET home = excluded.home, person = excluded.person, endpoint = excluded.endpoint, keys = excluded.keys')
        .bind(id, entry.hash, request.person, endpoint, keys ? JSON.stringify(keys) : null, old?.sent || '', old?.test_at || 0).run();
      return {ok:true, enabled:true};
    }
    if (request.action === 'unsubscribePush') {await db.prepare('DELETE FROM devices WHERE id = ?').bind(id).run();await dropLegacy(endpoint, entry.hash);return {ok:true};}
    if (!old || old.home !== entry.hash) fail('Enable notifications on this device first.');
    if (request.action === 'testPush') {
      if (Date.now() - old.test_at < 60000) fail('Wait a minute before sending another test.');
      await db.prepare('UPDATE devices SET test_at = ? WHERE id = ?').bind(Date.now(), id).run();
      if (!pushConfig().enabled) fail('Phone reminders are not configured yet.');
      const code = await sendPush(vapidSigner(env), endpoint, null, null, fetcher);
      if (code === 404 || code === 410) {await db.prepare('DELETE FROM devices WHERE id = ?').bind(id).run();fail('Device subscription expired. Enable notifications again.');}
      if (code < 200 || code >= 300) fail('Notification service returned ' + code + '. Try again later.');
      return {ok:true, sent:true};
    }
    fail('Unsupported notification operation.');
  }

  // After a write, tells the flatmates involved about newly added expenses and payments.
  // Only devices that shared their encryption keys get a message; nobody gets one for their own payment.
  async function notifyExpenses(homeHash, before, after) {
    const known = new Set((before.expenses || []).map(e=>e.id));
    const added = (after.expenses || []).filter(e=>!known.has(e.id) && e.title !== 'Earlier balances');
    if (!added.length || !pushConfig().enabled) return;
    const name = id => (after.people.find(p=>p.id===id) || {}).name || 'A flatmate', cur = after.currency || 'EUR', money = c => cur + ' ' + (c/100).toFixed(2);
    const messages = {};
    for (const e of added) for (const id of Object.keys(e.shares)) {
      if (id === e.paidBy || !e.shares[id]) continue;
      (messages[id] ||= []).push(e.kind === 'settle' ? name(e.paidBy) + ' paid you ' + money(e.amount) : name(e.paidBy) + ' added ' + e.title + ' · your share ' + money(e.shares[id]));
    }
    const {results} = await db.prepare('SELECT * FROM devices WHERE home = ? AND keys IS NOT NULL').bind(homeHash).all();
    const sign = vapidSigner(env);let sent = 0;
    for (const d of results) {
      const lines = messages[d.person];
      if (!lines || sent >= 20) continue;
      const message = {title:after.name + ' · ' + (lines.length === 1 ? 'New expense' : lines.length + ' new expenses'), body:lines.length > 3 ? lines.length + ' new expenses and payments involve you.' : lines.join('\n'), tag:'flatflow-expense'};
      try {const status = await sendPush(sign, d.endpoint, message, JSON.parse(d.keys), fetcher);sent++;if (status === 404 || status === 410) await db.prepare('DELETE FROM devices WHERE id = ?').bind(d.id).run();}
      catch (err) {console.log('Expense notification failed: ' + err.message);}
    }
  }

  // Daily chore reminders between 09:00 and 10:00 Berlin time. The cron runs every
  // five minutes in that window and handles a small batch each time, which keeps
  // every run inside the free plan's per-invocation limits.
  async function daily(now = new Date(), batch = 25) {
    if (berlinHour(now) !== 9 || !pushConfig().enabled) return 0;
    const today = berlinDate(now);
    const {results} = await db.prepare('SELECT * FROM devices WHERE sent <> ? ORDER BY home LIMIT ?').bind(today, batch).all();
    const homes = new Map(), sign = vapidSigner(env);let pushed = 0;
    for (const d of results) {
      if (!homes.has(d.home)) {const entry = await readHome(d.home);homes.set(d.home, entry && await rolledOver(entry));}
      const h = homes.get(d.home)?.home, person = h?.people.find(p=>p.id===d.person);
      const due = person && !away(person, today) && h.tasks.some(t=>!t.paused && t.due <= today && assignee(t, h.people)?.id === person.id);
      if (!h) {await db.prepare('DELETE FROM devices WHERE id = ?').bind(d.id).run();continue;}
      if (due) {
        try {
          const status = await sendPush(sign, d.endpoint, null, null, fetcher);
          if (status === 404 || status === 410) {await db.prepare('DELETE FROM devices WHERE id = ?').bind(d.id).run();continue;}
          if (status < 200 || status >= 300) {console.log('Push delivery status ' + status);continue;}
          pushed++;
        } catch {console.log('Push service unavailable; device will be retried.');continue;}
      }
      // Checked for today, whether or not anything was due.
      await db.prepare('UPDATE devices SET sent = ? WHERE id = ?').bind(today, d.id).run();
    }
    return pushed;
  }

  // One-time copy from the Apps Script backend, enabled only while the owner has set
  // MIGRATION_TOKEN. Rows can be sent again: a home is replaced only by the same or a
  // newer revision, so re-running right before switching over is safe.
  async function migrate(body) {
    const statements = [];
    for (const row of body.homes || []) {
      if (!/^[a-f0-9]{64}$/.test(row.hash) || !Number.isInteger(row.revision)) fail('Invalid home row.');
      JSON.parse(row.home);
      statements.push(db.prepare('INSERT INTO homes (hash, revision, updated_at, home, op) VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, home = excluded.home, op = excluded.op WHERE excluded.revision >= homes.revision')
        .bind(row.hash, row.revision, String(row.updatedAt || new Date().toISOString()), row.home, String(row.op || '')));
    }
    for (const [name, raw] of Object.entries(body.properties || {})) {
      const [, kind, id] = name.match(/^(account|session|device)_([a-f0-9]{64})$/) || [];
      if (!kind) continue;
      const v = JSON.parse(raw);
      if (kind === 'account') statements.push(db.prepare('INSERT OR REPLACE INTO accounts (id, data) VALUES (?, ?)').bind(id, JSON.stringify({homes:v.homes || [], email:v.email || '', name:v.name || ''})));
      if (kind === 'session' && v.exp > Date.now()) statements.push(db.prepare('INSERT OR REPLACE INTO sessions (id, sub, exp) VALUES (?, ?, ?)').bind(id, String(v.sub), v.exp));
      if (kind === 'device') statements.push(db.prepare('INSERT OR REPLACE INTO devices (id, home, person, endpoint, keys, sent, test_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, String(v.home), String(v.person), pushEndpoint(v.endpoint), v.keys ? JSON.stringify(v.keys) : null, String(v.sent || ''), Number(v.testAt) || 0));
    }
    for (const [name, value] of Object.entries(body.settings || {})) {
      if (!SETTINGS.includes(name) || typeof value !== 'string' || value.length > 512) fail('Invalid setting.');
      statements.push(db.prepare('INSERT OR REPLACE INTO settings (name, value) VALUES (?, ?)').bind(name, value));
    }
    if (statements.length) await db.batch(statements);
    return {ok:true, imported:statements.length};
  }

  return {rpc, daily, migrate};
}

// Browser subscription keys let the server send an end-to-end encrypted message.
function pushKeys(keys) {
  if (!keys || typeof keys !== 'object') return null;
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  return /^[\w-]{86,88}$/.test(p256dh) && /^[\w-]{21,24}$/.test(auth) ? {p256dh, auth} : null;
}
