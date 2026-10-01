# StockFlow: Order Fulfillment Hub

A simple fulfillment app for a small e-commerce business that ships 200-300 orders a day from its own warehouse. It replaces spreadsheets and shared folders with one place where the office and the warehouse team see the same order status.

**Stack:** React 18 + Vite (web), Express + TypeScript (API), Prisma + SQLite (database), JWT login. No Docker needed.

## Run locally

Requires [Node.js](https://nodejs.org) 18.18 or newer (20+ recommended) and Git. No database server or Docker is needed.

```bash
git clone https://github.com/sumitmeena3112-sudo/stockflow-wms.git
cd stockflow-wms
npm run setup   # creates apps/api/.env, installs dependencies, creates the SQLite DB, loads demo data (about 30 s)
npm run dev     # API on :4000, web on :5173
```

Open http://localhost:5173 and sign in:

| Team                | Email                  | Password     |
| ------------------- | ---------------------- | ------------ |
| Office (admin)      | admin@stockflow.local  | Admin@12345  |
| Warehouse (picker)  | picker@stockflow.local | Picker@12345 |

These are demo accounts for local use. Change `JWT_SECRET` in `apps/api/.env` (copy from `.env.example`) for anything real.

To reset the demo data, stop the app, delete `apps/api/prisma/dev.db`, then run `npm run setup` again.

## The workflow it supports

| Step | What the app does |
| --- | --- |
| 1. Order received | Orders carry a channel, a same-day **priority** flag and a **ship-by deadline**. |
| 2. Order processed | Office picks a courier (cost, speed, pickup time). The app **suggests one**: fastest for priority orders, cheapest for the rest. Processing creates a **printable shipping label** and **reserves stock**. Many orders can be processed in one click. |
| 3. Picking | A pick list shows the exact bin. The picker **scans the SKU**; the wrong product or variant is blocked and logged. Stock in the **second warehouse** is flagged and must be **moved to the main warehouse** before it can be picked. |
| 4. Packing | Each item is **verified again** as it goes in the box. |
| 5. Staging | The box moves to its courier's staging lane. |
| 6. Shipping | When the courier arrives, one click hands over every staged box for that courier and deducts the stock. |
| Inbound | Deliveries are **counted**, damage noted, then **put away** on shelves. Stock is only sellable after put-away. Differences are logged as issues. |

## How it answers the problems in the brief

| Problem | Answer |
| --- | --- |
| Hard to see order status | Dashboard pipeline, order list with filters, step tracker and full history on every order |
| Delays go unnoticed | Alerts for overdue, due soon, **no progress for too long**, and courier pickup time passed |
| Priority orders miss deadlines | Priority flag, deadline, urgency-sorted task queue |
| Stock missing or can't be found | Reserved vs on-hand per bin, exact bin on the pick list, short stock is refused and logged |
| Wrong product or variant shipped | SKU scan at pick **and** pack; mismatches blocked and logged |
| Boxes misplaced or courier misses pickup | Staging lanes, per-courier handover, missed-pickup alert |
| Problems handled informally | **Issues** log: automatic entries plus manual reports, open until resolved with a note |
| Team not comfortable with technology | A single **Warehouse** screen lists tasks in order, with large buttons; pickers land there on sign-in |

## Layout

```
apps/api   Express API, Prisma schema (prisma/), stock allocation (src/allocate.ts),
           delay alerts (src/alerts.ts), courier suggestion (src/courier.ts)
apps/web   React single-page app
```

## Tests

```bash
npm test
```

## License

MIT, see [LICENSE](LICENSE).
