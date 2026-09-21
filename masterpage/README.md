# Toyota BO & Stock — Master Page

Internal Back Order & Stock Management web application for Toyota Saudi Arabia.

Built with **Next.js**, **React**, **TypeScript**, **Tailwind CSS**, **Prisma**, **PostgreSQL**, and **Recharts**.

## Run locally

```bash
cd masterpage
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000/dashboard

The app ships with a **demo data layer** so you can explore the UI immediately. Connect PostgreSQL when ready:

```bash
npx prisma migrate dev
npm run db:seed
```

## Structure

```
masterpage/
├── prisma/schema.prisma      PostgreSQL models
├── prisma/seed.ts            Sample Toyota seed data
├── src/app/                  App Router pages
├── src/components/           UI + layout + feature components
├── src/services/             Matching, audit, import logic
├── src/lib/                  Auth, i18n, demo store, Prisma
└── src/config/navigation.ts  Sidebar navigation
```

## Modules (phased)

| Phase | Status |
|-------|--------|
| 1. Shell, dashboard, auth, schema | ✅ |
| 2. Stock, back orders, Excel upload | ✅ (demo + preview) |
| 3. VIN matching + BO queue | ✅ |
| 4. Quality audit + violations | ✅ |
| 5. Reports + admin + audit trail | ✅ (demo) |

## Roles

| Role | Access |
|------|--------|
| Admin | Rules, upload, users |
| Manager | Allocations, reports |
| Sales | Assigned BOs |
| Quality Auditor | Audits, violations |
| Viewer | Read-only dashboards |

## Languages

English + Arabic labels with RTL toggle in the top bar.

## Demo login

Use any demo user on `/login` — password is not enforced in demo mode.
