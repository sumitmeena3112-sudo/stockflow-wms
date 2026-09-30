import "dotenv/config";
import express from "express";
import cors from "cors";
import { catalog } from "./routes/catalog.js";
import { inventory } from "./routes/inventory.js";
import { orders } from "./routes/orders.js";
import { errorHandler } from "./http.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", catalog);
app.use("/api", inventory);
app.use("/api", orders);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
