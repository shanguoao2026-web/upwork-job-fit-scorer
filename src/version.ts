import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "./errors.js";
import { isRecord } from "./record.js";

export function toolVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"));
      if (!isRecord(parsed) || typeof parsed.version !== "string" || !parsed.version.trim()) {
        throw new UserError(`Package version is missing in ${candidate}`);
      }
      return parsed.version;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new UserError("Could not find package.json to read the version.");
}
