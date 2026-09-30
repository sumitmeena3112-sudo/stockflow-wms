# StockFlow WMS

A small warehouse management system: receive stock into bins, reserve it when an order is confirmed, walk a pick list, and ship.

**Stack:** React 18 + Vite (web), Express + TypeScript (API), Prisma + SQLite (database), JWT auth. No Docker needed.

## Run locally

Requires Node.js 18 or newer.

```bash
npm run setup   # installs deps, creates the SQLite DB, seeds demo data
npm run dev     # API on :4000, web on :5173
```

Open http://localhost:5173 and sign in:

| Role   | Email                    | Password      |
| ------ | ------------------------ | ------------- |
| Admin  | admin@stockflow.local    | Admin@12345   |
| Picker | picker@stockflow.local   | Picker@12345  |

These are demo accounts for local use only. Change `JWT_SECRET` in `apps/api/.env` (copy from `.env.example`) for anything real.

## Order lifecycle

`DRAFT` → **confirm** (stock reserved, pick list built) → `CONFIRMED` → **pick** each row → `PICKING` → `PACKED` → **ship** (stock deducted) → `SHIPPED`.
Cancelling releases any reserved stock. Admins manage products, bins, receiving and orders; pickers can only mark pick rows as picked.

## Layout

```
apps/api   Express API, Prisma schema (prisma/), stock allocation logic (src/allocate.ts)
apps/web   React single-page app
```

## Tests

```bash
npm test
```

## License

MIT, see [LICENSE](LICENSE).
