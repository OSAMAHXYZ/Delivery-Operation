# Delivery Hub documentation

## Empty-class API reference (edit guide)

**[`DeliveryHub.empty-classes.js`](./DeliveryHub.empty-classes.js)** — full program map as empty classes:

- Data models: `Vehicle`, `QueueItem`, `Draft`, `DraftPayload`, …
- Server helpers + **every HTTP route** as `DeliveryHubApi` methods
- Agent UI (`Delivery_pdf.html`) classes
- Coordinator UI classes
- Admin UI classes
- End-to-end flows (memo / warehouse / showroom / unassigned)

Method bodies throw `not implemented` on purpose — use them as a checklist when changing behavior.

## Live source files

| Role | File |
|------|------|
| Server / API | `../server.js` |
| Hub home | `../index.html` |
| Hub home | `../delivery-hub/index.html` |
| Coordinator | `../delivery-hub/Delivery_coordinator.html` |
| Agent memo | `../delivery-hub/Delivery_pdf.html` |
| Warehouse | `../delivery-hub/warehouse-entry.html` |
| Admin | `../delivery-hub/admin-Delivery-pdf.html` |
| Live sync | `../delivery-hub/delivery-hub-live.js` |
| Data store | `../delivery-inventory-data.json` (runtime) |

## Quick roles

| Role | Who | Password |
|------|-----|----------|
| Coordinator | no login | — |
| Agent | ياسين / الفاضل / البراء | `1234` (or `DELIVERY_AGENT_PASSWORD`) |
| Warehouse | مستودع / warehouse | `1234` |
| Admin UI | client gate only | `1234` |
