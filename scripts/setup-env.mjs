// Creates apps/api/.env from .env.example on a fresh clone (never overwrites an existing .env).
import { copyFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const example = new URL("../apps/api/.env.example", import.meta.url);
const target = new URL("../apps/api/.env", import.meta.url);

if (existsSync(target)) {
  console.log("apps/api/.env already exists, leaving it as is.");
} else {
  copyFileSync(example, target);
  // give this machine its own random secret instead of the placeholder
  const text = readFileSync(target, "utf8").replace(
    /JWT_SECRET=.*/,
    `JWT_SECRET="${randomBytes(32).toString("hex")}"`,
  );
  writeFileSync(target, text);
  console.log("Created apps/api/.env");
}
