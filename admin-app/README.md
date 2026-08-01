# Admin App (React / Vite)

Premium React rebuild of the delivery admin dashboard.

## Status

Source is ready under `src/`. On this machine `npm install` is blocked (corporate SSL / 403 on registry), so the **live UI** currently ships as the redesigned HTML page:

`delivery-hub/admin-Delivery-pdf.html` + `delivery-hub/admin-saas.css`

## When npm works

```bash
cd admin-app
npm install
npm run build
```

Then `node server.js` serves the build at `/admin-app/` (already wired in `server.js`).

Dev mode (API proxy to :3000):

```bash
npm run admin:dev
```

Password remains `1234`. Filter/export/restore APIs are unchanged.
