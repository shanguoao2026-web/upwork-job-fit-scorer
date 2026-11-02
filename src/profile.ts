import { readFileSync, statSync } from "node:fs";
import { parse } from "yaml";
import { UserError } from "./errors.js";
import { isRecord } from "./record.js";
import type { Profile, Skill, Weights } from "./types.js";

export const DEFAULT_WEIGHTS: Weights = {
  skillMatch: 0.3,
  budget: 0.25,
  clientSignals: 0.15,
  scopeClarity: 0.15,
  scamSafety: 0.15,
};

export const DEFAULT_REFERENCE_HOURS = 10;
export const DEFAULT_CURRENCY = "USD";

const PROFILE_KEYS = new Set([
  "name",
  "title",
  "skills",
  "hourly_floor",
  "reference_hours",
  "currency",
  "red_flags",
  "weights",
]);

const WEIGHT_KEYS: ReadonlyArray<readonly [string, keyof Weights]> = [
  ["skill_match", "skillMatch"],
  ["budget", "budget"],
  ["client_signals", "clientSignals"],
  ["scope_clarity", "scopeClarity"],
  ["scam_safety", "scamSafety"],
];

export function loadProfile(profilePath: string): Profile {
  let raw: string;
  try {
    const stat = statSync(profilePath);
    if (!stat.isFile()) {
      throw new UserError(`Profile is not a file: ${profilePath}`);
    }
    raw = readFileSync(profilePath, "utf8");
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Profile not found: ${profilePath}`);
  }
  return parseProfile(raw, profilePath);
}

export function parseProfile(raw: string, source = "profile"): Profile {
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(`Could not parse ${source} as YAML: ${detail}`);
  }
  if (!isRecord(parsed)) {
    throw new UserError(`${source} must be a YAML mapping.`);
  }
  for (const key of Object.keys(parsed)) {
    if (!PROFILE_KEYS.has(key)) {
      throw new UserError(`${source} has unknown key "${key}".`);
    }
  }
  if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    throw new UserError(`${source} needs a non-empty skills list.`);
  }

  const skills = parsed.skills.map((entry, index) => parseSkill(entry, index, source));
  const seen = new Set<string>();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    if (seen.has(key)) {
      throw new UserError(`${source} lists the skill "${skill.name}" more than once.`);
    }
    seen.add(key);
  }

  return {
    name: optionalText(parsed.name, "name", source),
    title: optionalText(parsed.title, "title", source),
    skills,
    hourlyFloor: positiveNumber(parsed.hourly_floor, "hourly_floor", source),
    referenceHours:
      parsed.reference_hours === undefined
        ? DEFAULT_REFERENCE_HOURS
        : positiveNumber(parsed.reference_hours, "reference_hours", source, 1000),
    currency: parseCurrency(parsed.currency, source),
    redFlags: parseRedFlags(parsed.red_flags, source),
    weights: parsed.weights === undefined ? { ...DEFAULT_WEIGHTS } : parseWeights(parsed.weights, source),
  };
}

function parseSkill(entry: unknown, index: number, source: string): Skill {
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) throw new UserError(`${source} skills[${index}] is empty.`);
    return { name, aliases: [] };
  }
  if (!isRecord(entry) || typeof entry.name !== "string") {
    throw new UserError(`${source} skills[${index}] must be a string or a { name, aliases } mapping.`);
  }
  const name = entry.name.trim();
  if (!name) throw new UserError(`${source} skills[${index}].name is empty.`);
  const extra = Object.keys(entry).filter((key) => key !== "name" && key !== "aliases");
  if (extra.length > 0) {
    throw new UserError(`${source} skills[${index}] has unknown key "${extra[0]}".`);
  }
  const aliasesRaw = entry.aliases ?? [];
  if (!Array.isArray(aliasesRaw) || aliasesRaw.some((alias) => typeof alias !== "string")) {
    throw new UserError(`${source} skills[${index}].aliases must be a list of strings.`);
  }
  const aliases = aliasesRaw.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
  return { name, aliases };
}

function optionalText(value: unknown, key: string, source: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new UserError(`${source} ${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    throw new UserError(`${source} ${key} must be 200 characters or fewer.`);
  }
  return trimmed;
}

function positiveNumber(value: unknown, key: string, source: string, max = 1_000_000): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new UserError(`${source} ${key} must be a number greater than 0.`);
  }
  if (value > max) {
    throw new UserError(`${source} ${key} must be ${max} or less.`);
  }
  return value;
}

function parseCurrency(value: unknown, source: string): string {
  if (value === undefined || value === null) return DEFAULT_CURRENCY;
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new UserError(`${source} currency must be a 3-letter code such as USD.`);
  }
  return value.toUpperCase();
}

function parseRedFlags(value: unknown, source: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new UserError(`${source} red_flags must be a list of strings.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new UserError(`${source} red_flags[${index}] must be a string.`);
    }
    const phrase = entry.trim();
    if (phrase.length < 3) {
      throw new UserError(`${source} red_flags[${index}] must be at least 3 characters.`);
    }
    return phrase;
  });
}

function parseWeights(value: unknown, source: string): Weights {
  if (!isRecord(value)) {
    throw new UserError(`${source} weights must be a mapping.`);
  }
  const allowed = new Set(WEIGHT_KEYS.map(([yamlKey]) => yamlKey));
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new UserError(`${source} weights has unknown key "${key}".`);
    }
  }
  const weights = {} as Weights;
  let sum = 0;
  for (const [yamlKey, field] of WEIGHT_KEYS) {
    if (!(yamlKey in value)) {
      throw new UserError(`${source} weights.${yamlKey} is required when weights is set.`);
    }
    const raw = value[yamlKey];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      throw new UserError(`${source} weights.${yamlKey} must be a number from 0 to 1.`);
    }
    weights[field] = raw;
    sum += raw;
  }
  if (Math.abs(sum - 1) > 0.001) {
    throw new UserError(`${source} weights must sum to 1 (got ${sum}).`);
  }
  return weights;
}
