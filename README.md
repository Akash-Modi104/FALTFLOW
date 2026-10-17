# Flatflow

Shared-flat chore rotation PWA, hosted on GitHub Pages with a free Cloudflare Workers + D1 backend. No ChatGPT subscription or OpenAI API is needed to run it.

## Using your home

Create a shared household and send its invitation from Settings → Invite flatmates. You can belong to several homes: tap the home name (sidebar, or top of the screen on phones) to switch homes, join another with an invitation, or create a new one. Homes are remembered per device. New homes show a Getting started checklist on the Overview, and anyone who hasn't said who they are gets a one-tap name picker. Each person's choice is saved on their own device (Settings → Who are you in this home?). On phones, the round + button adds an expense, a chore, a shopping item or a flatmate from any page. A home can also be a trip or group that only shares costs: pick that when creating it, or untick Settings → Track chores in this home. My chores filters their assignments. This is household-link access, not individual authenticated accounts: anyone holding the invitation can manage the home.

Add chores with daily, weekly, monthly or custom intervals, select participants and rotation order. Complete, pass, postpone or reassign a turn. Set away dates or breaks for flatmates. Flatmates shows a 30-day fair-share view of chore minutes per person against an even split. Delete a flatmate from their edit screen after reassigning any chores where they are the only participant. Updates sync online; cached chores can be viewed offline. Export/import JSON backups in Settings.

## Invite codes

Settings → Share your home → **Get a code** gives a short code such as `K7M2-QX9P` that flatmates type in under **Join with a code or link**. A code works for 7 days and each home keeps its 3 newest. The app encrypts the household key with the code (PBKDF2 + AES-GCM) before sending it, so the backend only stores that sealed copy under a hash of the code, never the code or the key.

## Shared expenses

Expenses splits shared costs Splitwise-style. Log who paid (one person or several), then split equally, by exact amounts, by percentages, by shares (for example 2 : 1), by adjustment (equal plus extra for some), or item by item from a receipt. Each expense can have its own currency, notes and comments, and can be edited later. Search and filter the list, see monthly and per-category spending, turn off "simplify debts" to see who owes whom directly, record partial payments, and send a reminder through your phone's share sheet. Export as Excel (.xlsx) or CSV. Flatflow keeps a running balance per flatmate and suggests the fewest payments needed to settle up. Record a payment once money changes hands; payments happen outside the app. Amounts are stored as integer cents with each person's exact share, so balances never drift from rounding. The Expenses page also holds a shared shopping list: tick items as bought, then log them together as one expense. Add rent, internet or subscriptions as recurring bills: they're logged as expenses automatically each time they fall due. Choose the household currency in Settings. Moving from Splitwise? Export your group (Splitwise group → Settings → Export as spreadsheet, CSV or Excel) and use Expenses → Import from Splitwise: match each member to a flatmate, then import the full history or only the balances still owed. A home keeps up to 100 expenses. When it's full, or nearing the size limit for one home, the oldest 30 are folded into a few "Earlier balances" entries with exactly the same effect on balances. Once everyone is square, you can clear settled expenses. Flatmates with an open balance cannot be deleted until they settle up.

## Personal sign-in

Sign-in with Google is required once `GOOGLE_CLIENT_ID` is set on the backend: until someone signs in, the app shows only the sign-in screen, and the backend refuses every home action (read, write, create, notifications, invite codes) without a valid session. Opening a home with its invitation link, invite code or a device that already had it adds the home to the signed-in account, so flatmates who joined by link before sign-in existed just sign in once and keep everything. An account remembers every home the person belongs to and who they are in each, so their homes appear on any phone or computer they sign in on. Accounts and sessions are stored privately on the backend (only hashes of Google ids and session tokens); Flatflow never sees Google passwords, and only verified Google emails can sign in. Without `GOOGLE_CLIENT_ID` the app works with invitation links alone, as before.

To switch it on (owner, once):
1. In Google Cloud Console → APIs & Services → OAuth consent screen, create an External app with your contact email, then publish it. Only the basic `openid`, `email` and `profile` scopes are used, so Google verification isn't needed.
2. Under Credentials → Create credentials → OAuth client ID → Web application, add `https://akash-modi104.github.io` (and `http://localhost:4173` for development) as Authorized JavaScript origins. Copy the client ID.
3. Store it in D1: `npx wrangler@4.151.1 d1 execute flatflow --remote --command "INSERT OR REPLACE INTO settings (name, value) VALUES ('GOOGLE_CLIENT_ID', 'your-client-id')"`. Until then the app simply shows that sign-in isn't switched on yet.

## Phone notifications

Use Settings → Enable phone notifications after choosing your name. On iPhone/iPad (iOS 16.4+), first add Flatflow to the Home Screen from Safari, open that installed app, and allow notifications. On Android use Chrome. Every device subscribes separately. A cron trigger on the worker sends a push between 09:00 and 10:00 Europe/Berlin only when the chosen person has due chores and is available. Notifications work while the app is closed, subject to phone/browser permissions and network availability. Use Send a test notification to verify your device. There are no email reminders.

Push uses standard ES256 VAPID authentication. Daily chore reminders have an empty payload, and the service worker shows a generic reminder. When a flatmate adds an expense you share, or pays you back, the devices of the people involved (not the payer) get a short message such as "Alex added Pizza · your share EUR 10.00". These messages are end-to-end encrypted to each device (RFC 8291, aes128gcm), so push services can't read them. Devices enabled before this feature share their encryption keys automatically the next time the app opens. Device endpoints are stored privately in D1, never in shared JSON. Official Apple, Google and Mozilla push endpoint hosts are allowed. Expired subscriptions are removed. Selecting a different name disables the existing subscription; enable it again for the new name.

## Backend: Cloudflare Workers + D1

`worker/` is the backend, on Cloudflare's Workers Free plan with a D1 database, live at `https://flatflow.developer-akash1043.workers.dev`. It needs no payment method; going over a free limit makes requests fail until the next day instead of costing money. `public/config.js` holds its address. The earlier Google Apps Script + Sheet backend was retired and deleted on 2026-10-17.

Set it up once from a computer with Node (all free, no card):
1. Create a free Cloudflare account, then run `npx wrangler@4.151.1 login`.
2. `npx wrangler@4.151.1 d1 create flatflow` and put the printed `database_id` in `wrangler.toml`.
3. `npx wrangler@4.151.1 d1 execute flatflow --remote --file worker/schema.sql` (run it again whenever the tables change).
4. Generate a P-256 VAPID key pair and store the private key as hex under `VAPID_PRIVATE` and the uncompressed public key as base64url under `VAPID_PUBLIC` in the `settings` table, the same way as `GOOGLE_CLIENT_ID` above (Worker secrets with those names override the table). Never commit the private key.
5. `npm run deploy-worker` publishes the worker.

Data requests require a random 256-bit invitation key; only its SHA-256 hash is stored, and session tokens and Google ids are hashed too. Writes use revision checking and operation IDs to protect against conflicts and retries. Daily chore reminders come from a cron trigger that runs every five minutes between 09:00 and 10:00 Berlin time and handles 25 phones per run, up to 300 phones a day. The worker allows up to 200 homes and 300 phones. Push delivery is not guaranteed to the minute.

## Development and deployment

```
npm ci
npm test
npm run build
npm run dev
```

GitHub Actions tests and deploys `dist` to Pages. Enable Pages with GitHub Actions as source. Public configuration is in `public/config.js`; never put household keys or private push keys there.

Automated tests cover rotation, deletion safeguards, expenses, invite codes, the worker's sync conflicts, sign-in, private subscriptions, endpoint validation, VAPID signatures and push encryption. The worker tests run against Node's built-in SQLite.
