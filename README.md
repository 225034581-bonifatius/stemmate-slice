# STEMMate Namibia – A4 vertical slice

A session-plan form that keeps working offline. One slice, all layers real:

form (browser) → validation → local storage on the device → offline queue → sync API → server file storage → visible status.

All data is made up. No pupil or personal data is used or stored.

## Run it from a clean start

You need Node.js 20 or newer (check with `node -v`). Nothing else to install, no `npm install`.

```
npm test        # runs all automated tests
npm start       # starts the app at http://localhost:3000
npm run demo    # same, plus demo tools to show conflicts
```

Windows PowerShell blocks `npm` on some computers. If so, use `npm.cmd test` and `npm.cmd start`.

## What it does

| Action | Result |
| --- | --- |
| Save Draft Locally (title only) | Draft kept on this device |
| Complete & Queue for Sync (all 5 fields) | "Saved locally (Unsynced)", then syncs if online |
| Offline or server down | Plan stays on the device, status "Sync failed", Retry button |
| Back online | Waiting plans sync automatically |
| Same plan sent twice (retry) | Server recognises it, no duplicate |
| Plan changed somewhere else | "Conflict": user chooses Keep my version or Use the server's version |
| Tab closed mid-sync | On reopening, the plan returns to the queue |

## Requirement traceability

| Requirement | Where it is built | Automated test |
| --- | --- | --- |
| FR-03 create plan, 5 categories | `client/js/validation.js`, `planStore.markReady` | `validation.test.js` (FR-03 tests), `planStore.test.js` (FR-03), `sync.test.js` (server rejects incomplete plan) |
| FR-04 keep unsynced drafts locally | `client/js/planStore.js` | `planStore.test.js` (draft survives restart), `sync.test.js` (offline keeps queue) |
| FR-05 sync without duplicates, keep local until success | `client/js/sync.js`, `server/syncService.js` | `sync.test.js` (lost response, no duplicate; server down), `server.test.js` (restart, no duplicate) |
| FR-06 clear states, retry, conflict | `client/js/sync.js`, `client/js/app.js` | `sync.test.js` (server down, 5xx, both conflict choices) |
| AR-01 keyboard and non-colour cues | `client/index.html`, `client/styles.css` | `accessibility.test.js` + manual keyboard check below |
| SR-01 profile separation | `planStore` storage key per profile | `planStore.test.js` (profiles cannot see each other) |
| SUS-01 send only what is needed | `buildPayload` in `client/js/sync.js` | `sync.test.js` (payload fields) |

## Manual checks (do these before submitting)

1. Keyboard only: press Tab through the whole page, fill the form, save, sync. Every control must be reachable and show a visible focus ring.
2. Switch Wi-Fi off: the chip changes to Offline, saving still works, switching Wi-Fi on syncs the queue.
3. `npm run demo`: tick "Pretend the server is unreachable", complete a plan, see "Sync failed", untick, press Retry.
4. `npm run demo`: sync a plan, use "Edit it on the server", edit the plan here, complete it, see the conflict.

## Known limits (honest list)

- Conflict handling is whole-plan: the user keeps one version, there is no field-by-field merge.
- The server stores data in one JSON file. Fine for a prototype, not for many users.
- No login. Profiles separate plans on a shared device but are not a security boundary.
- Automated accessibility tests check page structure only. They do not replace testing with real users and assistive technology.
- Browser localStorage is limited (about 5 MB). A full device shows a clear "no space" message and keeps earlier plans.

## Files

```
client/   index.html, styles.css, js/validation.js, js/planStore.js, js/sync.js, js/app.js
server/   server.js (HTTP), syncService.js (sync rules)
test/     automated tests (node:test)
```
