# Delivery Operations

Toyota delivery note hub — coordinator queue, agent workspace, and admin inventory.

## Pages

| URL | Description |
|-----|-------------|
| [`delivery-hub/Delivery_pdf.html`](delivery-hub/Delivery_pdf.html) | Agent login, VIN workspace, print form |
| [`delivery-hub/Delivery_coordinator.html`](delivery-hub/Delivery_coordinator.html) | Coordinator — Excel upload & VIN queue |
| [`delivery-hub/admin-Delivery-pdf.html`](delivery-hub/admin-Delivery-pdf.html) | Admin inventory (password `1234`) |

Root `Delivery_*.html` files redirect to `delivery-hub/` for backward-compatible URLs.

## Project layout

```
delivery-hub/          Main UI (HTML, CSS, live sync JS)
scripts/               Muthakara form field options & layout
templates/             Word delivery-note templates (.docx)
images/logo/           Place toyota.png here (optional)
```

## Running locally

These pages call backend APIs (`/api/delivery-*`). Serve the repo from your main app server (e.g. the parent Node project with `server.js`) so API routes and static files work together.

For static preview only, open files via a local HTTP server — API features will not work without the backend.

## Admin

Default admin gate password: `1234` (client-side on the admin page).

See [`delivery-hub/README.md`](delivery-hub/README.md) for hub isolation rules.
