# ogg-event-log

Hebrew RTL PWA — event log for the Og wastewater plant. Static files only: `index.html`, `style.css`, `app.js`, `sw.js`; team mode adds `cloud.js`, `firebase-config.js`, `vendor/firebase.js` (built from `tools/firebase-entry.js`) and `firestore.rules`.

- **Bump the version on every change**: `APP_VER`/`APP_DATE` in `app.js`, `CACHE` in `sw.js` (`ogg-log-<version>`), the initial `verChip`/`verLine` text and the `?v=` on `style.css`/`app.js` in `index.html`, `version.txt` (the app's update check reads it), and add a row to the version table in `README.md`. Run `tools/check-version.sh` before every commit — it must print "OK".
- Never commit data: `*.json` is gitignored (backups contain real records and names).
- Never put plant-specific values (people, locations, equipment) in the code — the site is readable by anyone with the link. Lists are built from the events on the device, values added in the app, and loaded backups.
- Team mode must stay safe: never let a stale local copy overwrite newer cloud data; keep `firestore.rules` free of real e-mails (`OWNER_EMAIL` placeholder).
- Check phone widths (320px and ~400px) for horizontal overflow after layout changes.
- GitHub Pages deploys from branch `claude/magical-bell-qcwse4`.
