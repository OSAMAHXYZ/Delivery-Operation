# Delivery Operations

Toyota delivery note hub — coordinator queue, agent workspace, and admin inventory.

## Pages

| URL | Description |
|-----|-------------|
| [`delivery-hub/Delivery_pdf.html`](delivery-hub/Delivery_pdf.html) | Agent login, VIN workspace, print form |
| [`delivery-hub/Delivery_coordinator.html`](delivery-hub/Delivery_coordinator.html) | Coordinator — Excel upload & VIN queue |
| [`delivery-hub/admin-Delivery-pdf.html`](delivery-hub/admin-Delivery-pdf.html) | Admin inventory (password `1234`) |

Root `Delivery_*.html` files redirect to `delivery-hub/` for backward-compatible URLs.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 — APIs, static files, and WebSocket live sync share the same Node server (`server.js`).

Data persists in `delivery-inventory-data.json` (created automatically).

## Roles & passwords

| Role | Access | Password |
|------|--------|----------|
| Agents (ياسين / الفاضل / البراء) | `/delivery-hub/Delivery_pdf.html` | `1234` |
| Admin | `/delivery-hub/admin-Delivery-pdf.html` | `1234` (client gate) |
| Coordinator | `/delivery-hub/Delivery_coordinator.html` | none |

Override agent password with env `DELIVERY_AGENT_PASSWORD`.

## Workflow

1. Coordinator/Admin uploads Sales Raw Excel → `vehicles[]`
2. Coordinator pastes VINs → queue `available`
3. Agent claims → `in_stock`
4. Agent prints memo → draft saved + `out_of_delivery`
5. Agent marks delivered → `delivered`
6. Admin reviews inventory, queue, drafts, company/city analytics

## Railway

Deploy as a **Node** service (`npm start`). Do not use static-only hosting — the hub needs `/api/delivery-*` and WebSocket on the same origin.

## Project layout

```
server.js              Express + WS + inventory APIs
delivery-hub/          Main UI (HTML, CSS, live sync JS)
scripts/               Muthakara form field options & layout
templates/             Word delivery-note templates (.docx)
images/logo/           Place toyota.png here (optional)
```

See [`delivery-hub/README.md`](delivery-hub/README.md) for hub isolation rules.
