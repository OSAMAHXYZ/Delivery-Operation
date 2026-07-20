# Delivery Hub (isolated)

This folder is the **only place** for the delivery note / coordinator / admin delivery UI.

## Pages

| File | Role |
|------|------|
| `Delivery_pdf.html` | Agent login + workspace + print form |
| `Delivery_coordinator.html` | Coordinator VIN upload / queue |
| `admin-Delivery-pdf.html` | Admin inventory (password `1234`) |
| `delivery-hub-theme.css` | Shared dark theme |
| `delivery-hub-live.js` | Live WebSocket sync |

## URLs

- New: `/delivery-hub/Delivery_pdf.html`
- Old root URLs still redirect here (`/Delivery_pdf.html`, etc.)

## Protection rules

See also `.cursor/rules/page-hubs-isolation.mdc` (all hubs) and `.cursor/rules/delivery-hub-isolation.mdc`.

1. **Do not edit these files** unless the task is explicitly about delivery hub.
2. Unrelated feature pushes should **never** include `delivery-hub/**`.
3. When committing delivery changes, put `[delivery-hub]` in the commit message.
4. Root `Delivery_*.html` / `admin-Delivery-pdf.html` are **redirect stubs only** — real code is here.
5. Shared APIs stay in `server.js` (`/api/delivery-*`). Changing those can affect this hub; be careful.

## Admin password

`1234` (client-side gate on admin page)
