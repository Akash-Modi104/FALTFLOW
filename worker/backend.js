// Flatflow backend for Cloudflare Workers + D1, on the free plan.
// Invitation keys, session tokens, sign-in ids and email addresses are only
// ever stored as SHA-256 hashes.
import {validateHome, rollOver, away, assignee} from '../public/core.js';
import {vapidSigner, sendPush, pushEndpoint} from './webpush.js';

export const MAX_HOMES = 200, MAX_DEVICES = 300, SESSION_DAYS = 90, INVITE_DAYS = 7, MAX_INVITES = 1000;
export const ACCOUNT_ACTIONS = ['authConfig','signIn','emailCode','emailVerify','githubSignIn','passkeyChallenge','passkeySignIn','myHomes','linkHome','unlinkHome','signOut','signOutAll','deleteAccount','accountInfo','passkeyOptions','passkeyRegister','passkeyRemove'];
const MAX_PASSKEYS = 10;
const b64url = {decode:s => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), c => c.charCodeAt(0)), encode:b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')};
const validB64url = (s, max = 2048) => typeof s === 'string' && s.length > 0 && s.length <= max && /^[\w-]+$/.test(s);
// Sign-in attempts per address per minute, before the server stops answering them.
const AUTH_LIMIT = 20, CODE_MINUTES = 10, CODE_TRIES = 5;
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

// Push keys and sign-in credentials kept in the settings table. Worker secrets
// with the same names take precedence. BREVO_* switch on email codes, GITHUB_*
// switch on GitHub sign-in; each method appears in the app once configured.
export const SETTINGS = ['VAPID_PRIVATE','VAPID_PUBLIC','GOOGLE_CLIENT_ID','BREVO_API_KEY','BREVO_SENDER','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET'];
const normalizeEmail = e => {const v = String(e || '').trim().toLowerCase();if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('Enter a valid email address.');return v;};
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

  async function rpc(request, {ip = '', origin = ''} = {}) {
    if (request && ['signIn','emailCode','emailVerify','githubSignIn','passkeySignIn','redeemInvite'].includes(request.action)) await limit(request.action + ':' + ip, AUTH_LIMIT, 60000);
    if (request && ACCOUNT_ACTIONS.includes(request.action)) return accountOperation(request, origin);
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

  // Once any sign-in method is configured, every home action needs a signed-in
  // account. Opening a home with its key (link, code or a device that already
  // had it) adds the home to that account.
  const emailEnabled = () => !!env.BREVO_API_KEY && !!env.BREVO_SENDER;
  const githubEnabled = () => !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET;
  const authEnabled = () => !!env.GOOGLE_CLIENT_ID || emailEnabled() || githubEnabled();
  // Sessions name their account as 'a:' + id; ones issued before sign-in methods
  // were added still carry the Google id and are moved over at the next sign-in.
  const sessionAccount = s => s.sub.startsWith('a:') ? s.sub.slice(2) : hash(s.sub);
  async function requireMember(request) {
    if (!authEnabled()) return null;
    const session = validKey(String(request?.session || '')) ? await db.prepare('SELECT sub, exp FROM sessions WHERE id = ?').bind(await hash(request.session)).first() : null;
    if (!session || session.exp < Date.now()) fail('Sign in to continue.');
    const id = await sessionAccount(session), account = await readAccount(id);
    if (!account) fail('Sign in to continue.');
    return {id, account};
  }
  // A small counter per key and minute, so guessing codes or hammering sign-in gets nowhere.
  async function limit(key, max, windowMs) {
    const id = await hash('limit:' + key), now = Date.now();
    const row = await db.prepare('SELECT n, reset FROM limits WHERE id = ?').bind(id).first();
    if (row && row.reset > now && row.n >= max) fail('Too many attempts. Wait a minute and try again.');
    if (row && row.reset > now) await db.prepare('UPDATE limits SET n = n + 1 WHERE id = ?').bind(id).run();
    else await db.prepare('INSERT OR REPLACE INTO limits (id, n, reset) VALUES (?, 1, ?)').bind(id, now + windowMs).run();
    if (Math.random() < 0.02) await db.prepare('DELETE FROM limits WHERE reset < ?').bind(now).run();
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

  // Personal accounts. Google, GitHub or an emailed code verifies the person; the
  // backend then issues its own long-lived session so phones stay signed in.
  // One person is one account whichever way they sign in: methods are tied
  // together by the verified email address.
  async function accountOperation(request, origin) {
    if (request.action === 'authConfig') return {enabled:authEnabled(), clientId:env.GOOGLE_CLIENT_ID || '', email:emailEnabled(), github:githubEnabled() ? env.GITHUB_CLIENT_ID : '', passkeys:authEnabled()};
    if (request.action === 'passkeyChallenge') return passkeyChallenge(origin);
    if (request.action === 'passkeySignIn') return passkeySignIn(request, origin);
    if (request.action === 'signIn') return signIn(request.idToken);
    if (request.action === 'emailCode') return emailCode(request);
    if (request.action === 'emailVerify') return emailVerify(request);
    if (request.action === 'githubSignIn') return githubSignIn(request);
    const session = validKey(String(request.session || '')) ? await db.prepare('SELECT id, sub, exp FROM sessions WHERE id = ?').bind(await hash(request.session)).first() : null;
    if (!session || session.exp < Date.now()) {
      if (session) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
      fail('Your sign-in has expired. Sign in again.');
    }
    if (request.action === 'signOut') {await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();return {ok:true};}
    const accountId = await sessionAccount(session), account = await readAccount(accountId);
    if (!account) fail('Your sign-in has expired. Sign in again.');
    if (request.action === 'signOutAll') {await db.prepare('DELETE FROM sessions WHERE sub = ? OR sub = ?').bind('a:' + accountId, session.sub).run();return {ok:true};}
    if (request.action === 'deleteAccount') {
      // Homes stay with the flatmates; only this person's account, sign-ins and sessions go.
      await db.prepare('DELETE FROM sessions WHERE sub = ? OR sub = ?').bind('a:' + accountId, session.sub).run();
      await db.prepare('DELETE FROM logins WHERE account = ?').bind(accountId).run();
      await db.prepare('DELETE FROM passkeys WHERE account = ?').bind(accountId).run();
      await db.prepare('DELETE FROM accounts WHERE id = ?').bind(accountId).run();
      return {ok:true};
    }
    if (request.action === 'accountInfo') {
      const {results} = await db.prepare('SELECT provider FROM logins WHERE account = ?').bind(accountId).all();
      const sessions = (await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE (sub = ? OR sub = ?) AND exp > ?').bind('a:' + accountId, session.sub, Date.now()).first()).n;
      const passkeys = (await db.prepare('SELECT id, name, created FROM passkeys WHERE account = ? ORDER BY created').bind(accountId).all()).results;
      return {ok:true, account:{name:account.name, email:account.email}, providers:[...new Set(results.map(r=>r.provider))], sessions, passkeys};
    }
    if (request.action === 'passkeyOptions') return passkeyOptions(accountId, account, origin);
    if (request.action === 'passkeyRegister') return passkeyRegister(request, accountId, origin);
    if (request.action === 'passkeyRemove') {if (!validB64url(request.id)) fail('Unknown passkey.');await db.prepare('DELETE FROM passkeys WHERE id = ? AND account = ?').bind(request.id, accountId).run();return {ok:true};}
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
    const sub = String(claims.sub), email = normalizeEmail(claims.email);
    const {accountId, account} = await resolveAccount('google', sub, email, String(claims.name || '').slice(0,100));
    // Sessions from before sign-in methods were added still carry the Google id.
    await db.prepare('UPDATE sessions SET sub = ? WHERE sub = ?').bind('a:' + accountId, sub).run();
    return issueSession(accountId, account);
  }
  // Finds the account for a sign-in: the same method seen before, else the same
  // verified email (through another method, or on an account from before methods
  // were tracked), else a new one. Then remembers both ways to find it.
  async function resolveAccount(provider, subject, email, name) {
    const loginId = await hash(provider + ':' + subject), emailId = await hash('email:' + email);
    const find = async id => (await db.prepare('SELECT account FROM logins WHERE id = ?').bind(id).first())?.account;
    let accountId = await find(loginId) || await find(emailId);
    // Accounts from before methods were tracked have no login rows yet; they are found by their email.
    if (!accountId) accountId = (await db.prepare("SELECT id FROM accounts WHERE json_extract(data, '$.email') = ? LIMIT 1").bind(email).first())?.id;
    if (!accountId && provider === 'google' && await readAccount(await hash(subject))) accountId = await hash(subject);
    if (!accountId) accountId = await hash('account:' + token());
    const account = await readAccount(accountId) || {homes:[]};
    account.email = email;
    if (name) account.name = name; else if (!account.name) account.name = email.split('@')[0].slice(0,100);
    await saveAccount(accountId, account);
    await db.prepare('INSERT OR REPLACE INTO logins (id, account, provider) VALUES (?, ?, ?)').bind(loginId, accountId, provider).run();
    await db.prepare('INSERT OR REPLACE INTO logins (id, account, provider) VALUES (?, ?, ?)').bind(emailId, accountId, 'email').run();
    return {accountId, account};
  }
  // Keep at most 10 active sessions per account and clean up expired ones.
  async function issueSession(accountId, account) {
    const sub = 'a:' + accountId;
    await db.prepare('DELETE FROM sessions WHERE exp < ?').bind(Date.now()).run();
    await db.prepare('DELETE FROM sessions WHERE sub = ? AND id NOT IN (SELECT id FROM sessions WHERE sub = ? ORDER BY exp DESC LIMIT 9)').bind(sub, sub).run();
    const session = token();
    await db.prepare('INSERT INTO sessions (id, sub, exp) VALUES (?, ?, ?)').bind(await hash(session), sub, Date.now() + SESSION_DAYS * 864e5).run();
    const result = await accountResult(account);result.session = session;return result;
  }
  // Email sign-in: a six-digit code sent through Brevo's free plan. The code is
  // kept hashed with the address, expires after ten minutes and allows five tries.
  async function emailCode(request) {
    if (!emailEnabled()) fail('Email sign-in is not set up for this Flatflow yet.');
    const email = normalizeEmail(request.email);
    await limit('emailCode:' + email, 1, 60000);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await db.prepare('INSERT OR REPLACE INTO codes (id, code, exp, tries) VALUES (?, ?, ?, 0)').bind(await hash('code:' + email), await hash(email + '|' + code), Date.now() + CODE_MINUTES * 60000).run();
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {method:'POST', headers:{'api-key':env.BREVO_API_KEY, 'Content-Type':'application/json', 'Accept':'application/json'}, body:JSON.stringify({
      sender:{name:'Flatflow', email:env.BREVO_SENDER}, to:[{email}], subject:code + ' is your Flatflow sign-in code',
      textContent:'Your Flatflow sign-in code is ' + code + '. It works for ' + CODE_MINUTES + ' minutes.\n\nIf you didn’t ask for it, you can ignore this email; nobody can sign in without the code.'})});
    if (response.status < 200 || response.status >= 300) fail('The sign-in email could not be sent. Try again in a minute.');
    return {ok:true, sent:true};
  }
  async function emailVerify(request) {
    const email = normalizeEmail(request.email), code = String(request.code || '').replace(/\D/g, ''), id = await hash('code:' + email);
    const row = await db.prepare('SELECT code, exp, tries FROM codes WHERE id = ?').bind(id).first();
    if (!row || row.exp < Date.now()) fail('That code has expired. Ask for a new one.');
    if (row.tries >= CODE_TRIES) {await db.prepare('DELETE FROM codes WHERE id = ?').bind(id).run();fail('Too many attempts. Ask for a new code.');}
    if (code.length !== 6 || row.code !== await hash(email + '|' + code)) {await db.prepare('UPDATE codes SET tries = tries + 1 WHERE id = ?').bind(id).run();fail('That code isn’t right. Check the email and try again.');}
    await db.prepare('DELETE FROM codes WHERE id = ?').bind(id).run();
    const {accountId, account} = await resolveAccount('email', email, email, '');
    return issueSession(accountId, account);
  }
  // GitHub sign-in: the app sends the one-time code GitHub gave it; the secret
  // never leaves the server. Only a verified GitHub email can sign in.
  async function githubSignIn(request) {
    if (!githubEnabled()) fail('GitHub sign-in is not set up for this Flatflow yet.');
    const code = String(request.code || ''), redirect = String(request.redirectUri || '');
    if (!/^[\w-]{10,200}$/.test(code) || !/^https?:\/\/[\w.:-]+\/[\w./-]*$/.test(redirect)) fail('GitHub sign-in failed. Try again.');
    const headers = {'Accept':'application/json', 'Content-Type':'application/json', 'User-Agent':'Flatflow'};
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {method:'POST', headers, body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID, client_secret:env.GITHUB_CLIENT_SECRET, code, redirect_uri:redirect})});
    const accessToken = exchange.status === 200 ? (await exchange.json()).access_token : '';
    if (!accessToken) fail('GitHub sign-in failed. Try again.');
    const api = async path => {const r = await fetcher('https://api.github.com' + path, {headers:{...headers, 'Authorization':'Bearer ' + accessToken}});return r.status === 200 ? r.json() : null;};
    const user = await api('/user'), emails = await api('/user/emails') || [];
    if (!user || !/^\d{1,20}$/.test(String(user.id))) fail('GitHub sign-in failed. Try again.');
    const verified = emails.find(e=>e.primary && e.verified) || emails.find(e=>e.verified);
    if (!verified) fail('Add a verified email address to your GitHub account, then try again.');
    const {accountId, account} = await resolveAccount('github', String(user.id), normalizeEmail(verified.email), String(user.name || user.login || '').slice(0,100));
    return issueSession(accountId, account);
  }
  // Passkeys (WebAuthn): the phone or computer proves it holds a key the account
  // registered earlier, with a fingerprint, face or PIN checked on the device.
  // No third party is involved. The relying party is the app's own host.
  const rpIdFor = origin => {try {return new URL(origin).hostname;} catch {return '';}};
  const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  async function newChallenge(purpose, accountId = '') {
    const challenge = b64url.encode(crypto.getRandomValues(new Uint8Array(32)));
    await db.prepare('DELETE FROM codes WHERE exp < ?').bind(Date.now()).run();
    await db.prepare('INSERT INTO codes (id, code, exp, tries) VALUES (?, ?, ?, 0)').bind(await hash('challenge:' + purpose + ':' + challenge), accountId || '-', Date.now() + 5 * 60000).run();
    return challenge;
  }
  // Each challenge is accepted once, within five minutes, for the purpose it was issued for.
  async function takeChallenge(purpose, challenge) {
    if (!validB64url(challenge, 64)) fail('Passkey sign-in failed. Try again.');
    const id = await hash('challenge:' + purpose + ':' + challenge), row = await db.prepare('SELECT code, exp FROM codes WHERE id = ?').bind(id).first();
    await db.prepare('DELETE FROM codes WHERE id = ?').bind(id).run();
    if (!row || row.exp < Date.now()) fail('That passkey request expired. Try again.');
    return row.code === '-' ? '' : row.code;
  }
  // Checks what the browser signed: the right ceremony, our challenge, our origin and our host.
  async function clientChecks(request, type, origin) {
    if (!validB64url(request.clientDataJSON, 4096) || !validB64url(request.authenticatorData, 4096) || !validB64url(request.id, 1024)) fail('Passkey sign-in failed. Try again.');
    let data;try {data = JSON.parse(new TextDecoder().decode(b64url.decode(request.clientDataJSON)));} catch {fail('Passkey sign-in failed. Try again.');}
    if (data.type !== type || data.origin !== origin || !validB64url(String(data.challenge || ''), 64)) fail('Passkey sign-in failed. Try again.');
    const authData = b64url.decode(request.authenticatorData);
    if (authData.length < 37 || !sameBytes(authData.slice(0, 32), await sha256(new TextEncoder().encode(rpIdFor(origin)))) || !(authData[32] & 1)) fail('Passkey sign-in failed. Try again.');
    const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
    return {challenge:String(data.challenge), authData, counter};
  }
  async function passkeyOptions(accountId, account, origin) {
    if (!rpIdFor(origin)) fail('Passkeys need the app to be opened from its own address.');
    const existing = (await db.prepare('SELECT id FROM passkeys WHERE account = ?').bind(accountId).all()).results;
    if (existing.length >= MAX_PASSKEYS) fail('An account can have up to ' + MAX_PASSKEYS + ' passkeys. Remove one first.');
    return {ok:true, challenge:await newChallenge('register', accountId), rpId:rpIdFor(origin), userId:b64url.encode(new TextEncoder().encode(accountId.slice(0, 32))), name:account.email, displayName:account.name || account.email, exclude:existing.map(r=>r.id)};
  }
  async function passkeyRegister(request, accountId, origin) {
    const {challenge, authData} = await clientChecks(request, 'webauthn.create', origin);
    if (await takeChallenge('register', challenge) !== accountId) fail('That passkey request expired. Try again.');
    // The credential id in the signed authenticator data must be the one the browser reports.
    if (authData.length < 55 || !(authData[32] & 0x40)) fail('Passkey sign-in failed. Try again.');
    const idLength = (authData[53] << 8) | authData[54];
    if (!sameBytes(authData.slice(55, 55 + idLength), b64url.decode(request.id))) fail('Passkey sign-in failed. Try again.');
    const alg = Number(request.publicKeyAlgorithm);
    if (![-7, -257].includes(alg) || !validB64url(request.publicKey, 4096)) fail('This device’s passkey type isn’t supported.');
    try {await importPasskey(request.publicKey, alg);} catch {fail('This device’s passkey type isn’t supported.');}
    const name = String(request.name || 'Passkey').slice(0, 60);
    await db.prepare('INSERT OR REPLACE INTO passkeys (id, account, public_key, alg, counter, name, created) VALUES (?, ?, ?, ?, 0, ?, ?)').bind(request.id, accountId, request.publicKey, alg, name, new Date().toISOString()).run();
    return {ok:true};
  }
  const importPasskey = (spki, alg) => crypto.subtle.importKey('spki', b64url.decode(spki), alg === -7 ? {name:'ECDSA', namedCurve:'P-256'} : {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['verify']);
  async function passkeyChallenge(origin) {
    if (!authEnabled()) fail('Sign-in is not set up for this Flatflow yet.');
    if (!rpIdFor(origin)) fail('Passkeys need the app to be opened from its own address.');
    return {ok:true, challenge:await newChallenge('signin'), rpId:rpIdFor(origin)};
  }
  // WebAuthn ECDSA signatures come DER-encoded; WebCrypto wants raw r||s.
  const rawSignature = der => {
    if (der[0] !== 0x30) return der;
    const int = o => {const len = der[o + 1];let start = o + 2, n = len;while (n > 32 && der[start] === 0) {start++;n--;}const out = new Uint8Array(32);out.set(der.slice(start, start + n), 32 - n);return [out, o + 2 + len];};
    const [r, next] = int(2), [s] = int(next);return new Uint8Array([...r, ...s]);
  };
  async function passkeySignIn(request, origin) {
    const {challenge, authData, counter} = await clientChecks(request, 'webauthn.get', origin);
    await takeChallenge('signin', challenge);
    const row = await db.prepare('SELECT * FROM passkeys WHERE id = ?').bind(request.id).first();
    if (!row || !validB64url(request.signature, 2048)) fail('That passkey isn’t registered here. Sign in another way, then add it in Settings.');
    const signed = new Uint8Array([...authData, ...await sha256(b64url.decode(request.clientDataJSON))]);
    const key = await importPasskey(row.public_key, row.alg), signature = b64url.decode(request.signature);
    const valid = await crypto.subtle.verify(row.alg === -7 ? {name:'ECDSA', hash:'SHA-256'} : {name:'RSASSA-PKCS1-v1_5'}, key, row.alg === -7 ? rawSignature(signature) : signature, signed);
    if (!valid || (counter && counter <= row.counter)) fail('Passkey sign-in failed. Try again.');
    await db.prepare('UPDATE passkeys SET counter = ?, used = ? WHERE id = ?').bind(counter, new Date().toISOString(), row.id).run();
    const account = await readAccount(row.account);
    if (!account) {await db.prepare('DELETE FROM passkeys WHERE id = ?').bind(row.id).run();fail('That passkey’s account no longer exists.');}
    return issueSession(row.account, account);
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
    const name = id => (after.people.find(p=>p.id===id) || {}).name || 'A flatmate', money = (e, c) => (e.currency || after.currency || 'EUR') + ' ' + (c/100).toFixed(2);
    const messages = {};
    for (const e of added) for (const id of Object.keys(e.shares)) {
      // Co-payers who covered their own share have nothing to hear about.
      if (id === e.paidBy || !e.shares[id] || (e.payers && (e.payers[id] || 0) >= e.shares[id])) continue;
      (messages[id] ||= []).push(e.kind === 'settle' ? name(e.paidBy) + ' paid you ' + money(e, e.amount) : name(e.paidBy) + ' added ' + e.title + ' · your share ' + money(e, e.shares[id]));
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

  return {rpc, daily};
}

// Browser subscription keys let the server send an end-to-end encrypted message.
function pushKeys(keys) {
  if (!keys || typeof keys !== 'object') return null;
  const p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
  return /^[\w-]{86,88}$/.test(p256dh) && /^[\w-]{21,24}$/.test(auth) ? {p256dh, auth} : null;
}
