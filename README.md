# Flatflow

Shared-flat chore rotation PWA, hosted on GitHub Pages with a private Google Sheet backend. No ChatGPT subscription or OpenAI API is needed to run it.

## Using your home

Create a shared household and send its invitation from Settings → Invite flatmates. You can belong to several homes: tap the home name (sidebar, or top of the screen on phones) to switch homes, join another with an invitation, or create a new one. Homes are remembered per device. Each person chooses their own name under Settings → I am on their device. My chores filters their assignments. This is household-link access, not individual authenticated accounts: anyone holding the invitation can manage the home.

Add chores with daily, weekly, monthly or custom intervals, select participants and rotation order. Complete, pass, postpone or reassign a turn. Set away dates or breaks for flatmates. Flatmates shows a 30-day fair-share view of chore minutes per person against an even split. Delete a flatmate from their edit screen after reassigning any chores where they are the only participant. Updates sync online; cached chores can be viewed offline. Export/import JSON backups in Settings.

## Invite codes

Settings → Share your home → **Get a code** gives a short code such as `K7M2-QX9P` that flatmates type in under **Join with a code or link**. A code works for 7 days and each home keeps its 3 newest. The app encrypts the household key with the code (PBKDF2 + AES-GCM) before sending it, so the backend only stores that sealed copy under a hash of the code, never the code or the key. Codes need the current backend: redeploy Apps Script with `npm run deploy-backend`, or on Cloudflare re-run the `schema.sql` command below, which adds the `invites` table.

## Shared expenses

Expenses splits shared costs Splitwise-style. Log who paid, then split equally, by exact amounts or by shares (for example 2 : 1). Flatflow keeps a running balance per flatmate and suggests the fewest payments needed to settle up. Record a payment once money changes hands; payments happen outside the app. Amounts are stored as integer cents with each person's exact share, so balances never drift from rounding. The Expenses page also holds a shared shopping list: tick items as bought, then log them together as one expense. Add rent, internet or subscriptions as recurring bills: they're logged as expenses automatically each time they fall due. Choose the household currency in Settings. Moving from Splitwise? Export your group (Splitwise group → Settings → Export as spreadsheet) and use Expenses → Import from Splitwise: match each member to a flatmate, then import the full history or only the balances still owed. A home keeps up to 100 expenses. When it's full, or nearing what one Google Sheets cell can hold, the oldest 30 are folded into a few "Earlier balances" entries with exactly the same effect on balances. Once everyone is square, you can clear settled expenses. Flatmates with an open balance cannot be deleted until they settle up.

## Personal sign-in

Sign-in with Google is required once `GOOGLE_CLIENT_ID` is set on the backend: until someone signs in, the app shows only the sign-in screen, and the backend refuses every home action (read, write, create, notifications, invite codes) without a valid session. Opening a home with its invitation link, invite code or a device that already had it adds the home to the signed-in account, so flatmates who joined by link before sign-in existed just sign in once and keep everything. An account remembers every home the person belongs to and who they are in each, so their homes appear on any phone or computer they sign in on. Accounts and sessions are stored privately on the backend (only hashes of Google ids and session tokens); Flatflow never sees Google passwords, and only verified Google emails can sign in. Without `GOOGLE_CLIENT_ID` the app works with invitation links alone, as before.

To switch it on (owner, once):
1. In Google Cloud Console → APIs & Services → OAuth consent screen, create an External app with your contact email, then publish it. Only the basic `openid`, `email` and `profile` scopes are used, so Google verification isn't needed.
2. Under Credentials → Create credentials → OAuth client ID → Web application, add `https://akash-modi104.github.io` (and `http://localhost:4173` for development) as Authorized JavaScript origins. Copy the client ID.
3. In the Apps Script project → Project Settings → Script properties, add `GOOGLE_CLIENT_ID` with that client ID.
4. Rebuild and redeploy the backend (below). Until then the app simply shows that sign-in isn't switched on yet.

## Phone notifications

Use Settings → Enable phone notifications after choosing your name. On iPhone/iPad (iOS 16.4+), first add Flatflow to the Home Screen from Safari, open that installed app, and allow notifications. On Android use Chrome. Every device subscribes separately. A daily Apps Script trigger sends a push between 09:00 and 10:00 Europe/Berlin only when the chosen person has due chores and is available. Notifications work while the app is closed, subject to phone/browser permissions and network availability. Use Send a test notification to verify your device. There are no email reminders.

Push uses standard ES256 VAPID authentication. Daily chore reminders have an empty payload, and the service worker shows a generic reminder. When a flatmate adds an expense you share, or pays you back, the devices of the people involved (not the payer) get a short message such as "Alex added Pizza · your share EUR 10.00". These messages are end-to-end encrypted to each device (RFC 8291, aes128gcm), so push services can't read them. Devices enabled before this feature share their encryption keys automatically the next time the app opens. Device endpoints are stored in private Apps Script properties, never in shared JSON. Official Apple, Google and Mozilla push endpoint hosts are allowed. Expired subscriptions are removed. Selecting a different name disables the existing subscription; enable it again for the new name.

## Free Cloudflare backend (optional)

`worker/` is a second backend for Cloudflare's Workers Free plan with a D1 database. It answers the same requests as the Apps Script backend, so the app works with either: `public/config.js` decides which one it uses (a `script.google.com` address uses Apps Script, an address ending in `/rpc` uses the worker). It needs no payment method, and on the free plan going over a limit makes requests fail until the next day instead of costing money. Compared with Apps Script it answers in tens of milliseconds instead of seconds, keeps each home in its own database row instead of one Sheet cell, and has no iframe bridge.

Set it up once from a computer with Node (all free, no card):
1. Create a free Cloudflare account, then run `npx wrangler@4.151.1 login`.
2. `npx wrangler@4.151.1 d1 create flatflow` and put the printed `database_id` in `wrangler.toml`.
3. `npx wrangler@4.151.1 d1 execute flatflow --remote --file worker/schema.sql`
4. `npm run deploy-worker` prints the worker address, such as `https://flatflow.<you>.workers.dev`.

To copy the data from the Sheet: set a long random `MIGRATION_TOKEN` with `wrangler secret put`, add the same value and the worker address as the `MIGRATION_TOKEN` and `CLOUDFLARE_URL` script properties in Apps Script, then run `migrateToCloudflare` from the Apps Script editor. It copies every home, account, sign-in session and phone subscription, and the `VAPID_PRIVATE`, `VAPID_PUBLIC` and `GOOGLE_CLIENT_ID` values (worker secrets with those names override them). Keeping the same VAPID keys keeps every phone's notifications working. It can be run again; a home is never replaced by an older copy. To switch over, run it once more, set `BACKEND_URL` in `public/config.js` to the worker address followed by `/rpc`, and deploy the app. `APPS_SCRIPT_URL` stays in that file, so `npm run deploy-backend` keeps working. Then delete the `MIGRATION_TOKEN` secret, which turns the copy endpoint off. Invitation links, sign-ins and notifications keep working. To go back, point `BACKEND_URL` at the Apps Script address again.

Daily chore reminders come from a cron trigger that runs every five minutes between 09:00 and 10:00 Berlin time and handles 25 phones per run, up to 300 phones a day. The worker allows up to 200 homes and 300 phones.

## Development and deployment

```
npm ci
npm test
npm run build
npm run dev
```

GitHub Actions tests and deploys `dist` to Pages. Enable Pages with GitHub Actions as source. Public configuration is in `public/config.js`; never put household keys or private push keys there.

To rebuild the backend, run `node scripts/build-push.mjs` then `node scripts/build-backend.mjs SHEET_ID`. Paste `backend/Code.gs` into the bound Apps Script project, replacing its contents, then Deploy → Manage deployments → edit the existing deployment → Version: New version → Deploy, which keeps the same URL. Keep the Sheet private, with a Homes tab and five columns: Household key hash, Revision, Updated at, Household JSON, Last operation ID. Deploy a web app as the owner, accessible to Anyone. Data requests require a random 256-bit invitation key; only its SHA-256 hash is stored. Writes use revision checking and operation IDs to protect against conflicts/retries.

For one-command redeploys, enable the Apps Script API at script.google.com/home/usersettings, then once run `npx @google/clasp@2.4.2 login` and `npx @google/clasp@2.4.2 clone SCRIPT_ID --rootDir backend/deploy` (the script ID is in Apps Script → Project Settings). After that, `FLATFLOW_SHEET_ID=your-sheet-id npm run deploy-backend` builds the backend, pushes it and updates the existing web app deployment named in `public/config.js`, so the URL stays the same. `backend/deploy/` and `.clasp.json` are git-ignored.

Generate a P-256 VAPID key pair securely and store the private key as hex in the script property `VAPID_PRIVATE`, and the uncompressed public key as base64url in `VAPID_PUBLIC`. Never commit the private key. Run `setupPhoneReminders` from the owner’s editor, reviewing Google’s permissions for Sheets, triggers and external requests. The setup function is owner-restricted. Publish a new deployment version after code changes. Google Apps Script and push service quotas apply; delivery is not guaranteed to the minute.

`backend/PushCrypto.gs` bundles MIT-licensed @noble/curves and @noble/hashes; rebuild with esbuild. Automated tests cover rotation, deletion safeguards, optimistic sync conflicts, private subscriptions, endpoint validation and VAPID signature verification.
