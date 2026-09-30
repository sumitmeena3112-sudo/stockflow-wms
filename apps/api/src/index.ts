import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { catalog } from "./routes/catalog.js";
import { inventory } from "./routes/inventory.js";
import { orders } from "./routes/orders.js";
import { support } from "./routes/support.js";
import { errorHandler } from "./http.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", catalog);
app.use("/api", inventory);
app.use("/api", orders);
app.use("/api", support);
app.use(errorHandler);

// In production the API also serves the built web app, so one service is enough.
const webDist = path.resolve(import.meta.dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
