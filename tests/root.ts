import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
export const fixedNow = new Date("2026-11-02T00:00:00.000Z");
