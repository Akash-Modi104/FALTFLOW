# Flatflow

A mobile-friendly shared-flat chore app hosted on GitHub Pages. A private Google Sheet and Google Apps Script provide shared storage. No ChatGPT subscription or account is used at runtime.

## Features

- Add flatmates, avatar colours, away dates and breaks
- Daily, weekly, monthly and custom schedules
- Custom participants and rotation order for each chore
- Complete, pass a turn with a reason, postpone, reassign, pause and remove
- Schedule previews, activity, and personal chore filters
- Invitations and automatic refresh every 30 seconds while online
- Conflict protection so simultaneous edits cannot silently overwrite each other
- JSON backup/restore and a recoverable local draft after conflicts
- Installable PWA on iPhone, Android and desktop, with cached offline viewing
- Browser reminders while open, calendar exports and verified opt-in daily emails

## Local development

Node 22 or newer. No dependencies are required.

```
npm test
npm run dev
npm run build
```

## Google Sheets backend setup

1. Use a private Google Sheet with a `Homes` tab and these headers: Household key hash, Revision, Updated at, Household JSON, Last operation ID.
2. Generate backend code: `node scripts/build-backend.mjs YOUR_SPREADSHEET_ID`.
3. Open Extensions → Apps Script on the Sheet. Paste `backend/Code.gs`, name the project Flatflow and save. Update `ALLOWED_ORIGINS` if moving to another host.
4. Set the Apps Script project timezone to Europe/Berlin.
5. Deploy → New deployment → Web app. Execute as yourself, access Anyone. Review and complete Google's authorization yourself.
6. Set `BACKEND_URL` in `public/config.js` to the deployed URL ending in `/exec`. It is a public endpoint, not a secret. Never publish household invitation keys.
7. To enable email reminders, run `installDailyReminders_` once from the Apps Script editor. Review Google's Sheets, trigger-management and send-email permissions. The trigger runs daily at about 09:00 Berlin time. Only verified email addresses receive reminders. Google email quotas apply.

The spreadsheet remains private. Each home is a JSON snapshot behind a randomly generated 256-bit key; only the hash is stored in the Sheet. Each home supports 30 people, 100 chores, 200 recent activity entries and 40,000 JSON characters. This deployment supports up to 50 homes. Members share editing rights. Removing a flatmate from rotations does not revoke an invitation they already hold. Edit using the app or import validated JSON. If manually editing a JSON cell in Sheets, also increase its revision so clients immediately pick up the change.

## GitHub Pages

The included `.github/workflows/pages.yml` tests, builds and publishes `dist/` on pushes to `main`. In Settings → Pages, choose GitHub Actions as the source if it is not enabled automatically. The repository contains app source only. Household names, chores and email addresses stay in the private Google Sheet, never in Git commits.

## Start using it

Choose Create your home, enter a name and choose Shared home. Add flatmates and chores. In Settings, choose yourself and use Invite flatmates. Friends open the invitation link and choose their own names. Keep a saved invitation so you can recover your household on another device.

## Offline and notifications

Previously loaded screens and chores are readable offline. Shared changes require an internet connection; unconfirmed changes are never marked as synced. Device-only mode works without a backend. Browser reminders run while the app is open. Calendar exports are snapshots of the next 60 days; re-export when the routine changes. Daily emails require a configured Apps Script trigger, verified recipient and available Google quotas. Push notifications are not configured.

## Move to another host

Copy `public/` to another HTTPS static host, keep the same Apps Script URL, and update its allowed origin. JSON exports preserve household records. App hosting and storage are independent of ChatGPT billing.
