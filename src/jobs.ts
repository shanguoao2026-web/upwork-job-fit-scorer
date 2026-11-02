import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { UserError } from "./errors.js";
import { normalizeText } from "./text.js";

const TEXT_EXT = new Set([".txt", ".md"]);
const MAX_BYTES = 512 * 1024;

export interface LoadedJob {
  absolutePath: string;
  text: string;
}

export function loadInputs(inputPath: string): LoadedJob[] {
  const resolved = resolve(inputPath);
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new UserError(`Input not found: ${inputPath}`);
  }
  if (stat.isFile()) {
    return [{ absolutePath: resolved, text: readJob(resolved, stat.size) }];
  }
  if (!stat.isDirectory()) {
    throw new UserError(`Input is not a file or directory: ${inputPath}`);
  }

  const names = readdirSync(resolved).sort(byName);
  const jobs: LoadedJob[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    if (!TEXT_EXT.has(extname(name).toLowerCase())) continue;
    const full = join(resolved, name);
    let child;
    try {
      child = statSync(full);
    } catch {
      continue;
    }
    if (!child.isFile()) continue;
    jobs.push({ absolutePath: full, text: readJob(full, child.size) });
  }
  return jobs;
}

function readJob(filePath: string, size: number): string {
  if (size > MAX_BYTES) {
    throw new UserError(`Job file is larger than ${MAX_BYTES} bytes: ${filePath}`);
  }
  return normalizeText(readFileSync(filePath, "utf8"));
}

function byName(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
