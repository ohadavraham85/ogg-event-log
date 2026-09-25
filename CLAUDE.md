# ogg-event-log

Hebrew RTL PWA — event log for the Og wastewater plant. Static files only: `index.html`, `style.css`, `app.js`, `sw.js`.

- **Bump the version on every change**: `APP_VER`/`APP_DATE` in `app.js`, `CACHE` in `sw.js` (`ogg-log-<version>`), the initial `verChip`/`verLine` text in `index.html`, and add a row to the version table in `README.md`.
- Never commit data: `*.json` is gitignored (backups contain real records and names).
- Check phone widths (320px and ~400px) for horizontal overflow after layout changes.
- GitHub Pages deploys from branch `claude/magical-bell-qcwse4`.
