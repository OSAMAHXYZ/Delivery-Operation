# BO Hub (isolated)

This folder is the **only place** for BO order lookup / BO data admin UI.

## Pages

| File | Role |
|------|------|
| `bo-order-lookup.html` | Back-order queue lookup |
| `bo-data-admin.html` | Daily Excel upload + combination queues |

## URLs

- New: `/bo-hub/bo-order-lookup.html`, `/bo-hub/bo-data-admin.html`
- Old root URLs still redirect here (`/bo-order-lookup.html`, `/bo-data-admin.html`)

## Shared backend (not in this folder)

- `scripts/bo-order-lookup.js` — queue algorithm (required by `server.js`)
- `/api/bo-data/*` routes in `server.js`

Prefer not changing those during unrelated work.

## Protection rules

1. **Do not edit these files** unless the task is explicitly about BO lookup / BO admin / queue combinations.
2. Unrelated feature pushes should **never** include `bo-hub/**`.
3. When committing BO UI changes, put `[bo-hub]` in the commit message.
4. Root `bo-order-lookup.html` / `bo-data-admin.html` are **redirect stubs only** — real code is here.
