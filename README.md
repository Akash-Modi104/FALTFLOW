# Flatflow

Shared-flat chore rotation PWA, hosted on GitHub Pages with a private Google Sheet backend. No ChatGPT subscription or OpenAI API is needed to run it.

## Using your home

Create a shared household and send its invitation from Settings → Invite flatmates. You can belong to several homes: tap the home name (sidebar, or top of the screen on phones) to switch homes, join another with an invitation, or create a new one. Homes are remembered per device. Each person chooses their own name under Settings → I am on their device. My chores filters their assignments. This is household-link access, not individual authenticated accounts: anyone holding the invitation can manage the home.

Add chores with daily, weekly, monthly or custom intervals, select participants and rotation order. Complete, pass, postpone or reassign a turn. Set away dates or breaks for flatmates. Delete a flatmate from their edit screen after reassigning any chores where they are the only participant. Updates sync online; cached chores can be viewed offline. Export/import JSON backups in Settings.

## Shared expenses

Expenses splits shared costs Splitwise-style. Log who paid, then split equally, by exact amounts or by shares (for example 2 : 1). Flatflow keeps a running balance per flatmate and suggests the fewest payments needed to settle up. Record a payment once money changes hands; payments happen outside the app. Amounts are stored as integer cents with each person's exact share, so balances never drift from rounding. Choose the household currency in Settings. A home keeps up to 100 expenses; once everyone is square, clear settled expenses to keep the household small. Flatmates with an open balance cannot be deleted until they settle up.

## Phone notifications

Use Settings → Enable phone notifications after choosing your name. On iPhone/iPad (iOS 16.4+), first add Flatflow to the Home Screen from Safari, open that installed app, and allow notifications. On Android use Chrome. Every device subscribes separately. A daily Apps Script trigger sends a push between 09:00 and 10:00 Europe/Berlin only when the chosen person has due chores and is available. Notifications work while the app is closed, subject to phone/browser permissions and network availability. Use Send a test notification to verify your device. There are no email reminders.

Push uses standard ES256 VAPID authentication and an empty notification payload. The service worker displays a generic reminder; private chore information is not sent in the push payload. Device endpoints are stored in private Apps Script properties, never in shared JSON. Official Apple, Google and Mozilla push endpoint hosts are allowed. Expired subscriptions are removed. Selecting a different name disables the existing subscription; enable it again for the new name.

## Development and deployment

```
npm ci
npm test
npm run build
npm run dev
```

GitHub Actions tests and deploys `dist` to Pages. Enable Pages with GitHub Actions as source. Public configuration is in `public/config.js`; never put household keys or private push keys there.

To rebuild the backend, run `node scripts/build-push.mjs` then `node scripts/build-backend.mjs SHEET_ID`. Paste `backend/Code.gs` into the bound Apps Script project. Keep the Sheet private, with a Homes tab and five columns: Household key hash, Revision, Updated at, Household JSON, Last operation ID. Deploy a web app as the owner, accessible to Anyone. Data requests require a random 256-bit invitation key; only its SHA-256 hash is stored. Writes use revision checking and operation IDs to protect against conflicts/retries.

Generate a P-256 VAPID key pair securely and store the private key as hex in the script property `VAPID_PRIVATE`, and the uncompressed public key as base64url in `VAPID_PUBLIC`. Never commit the private key. Run `setupPhoneReminders` from the owner’s editor, reviewing Google’s permissions for Sheets, triggers and external requests. The setup function is owner-restricted. Publish a new deployment version after code changes. Google Apps Script and push service quotas apply; delivery is not guaranteed to the minute.

`backend/PushCrypto.gs` bundles MIT-licensed @noble/curves and @noble/hashes; rebuild with esbuild. Automated tests cover rotation, deletion safeguards, optimistic sync conflicts, private subscriptions, endpoint validation and VAPID signature verification.
