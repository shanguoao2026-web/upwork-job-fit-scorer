import { normalizeText } from "./text.js";
import type { BudgetFact, ClientFacts } from "./types.js";

/** A dollar amount. Group 1 is the whole number, group 2 is the optional cents. */
const MONEY = String.raw`\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;

/** Dash or "to" with only spaces around it, so two amounts in different sentences are not a range. */
const RANGE_GAP = String.raw`[ \t]{0,10}(?:-|to)[ \t]{0,10}\$?[ \t]{0,10}`;

export function extractTitle(text: string): string {
  const lines = normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "Untitled job";
  let first = lines[0].replace(/^#+\s*/, "");
  const labeled = first.match(/^(?:title|job title)\s*:\s*(.+)$/i);
  if (labeled?.[1]) first = labeled[1].trim();
  if (first.length > 120) first = `${first.slice(0, 117)}...`;
  return first || "Untitled job";
}

export function extractHours(text: string): number | null {
  const normalized = normalizeText(text);
  const range = normalized.match(/\b(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s*hours?\b/i);
  if (range?.[1] && range[2]) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low > 0 && high >= low && high <= 400) return (low + high) / 2;
  }
  const labeled = normalized.match(
    /\b(?:about|around|approximately|approx\.?|estimated|estimate of|expected|roughly|up to)\s+(\d{1,3})\s*hours?\b/i,
  );
  if (labeled?.[1]) {
    const hours = Number(labeled[1]);
    if (hours > 0 && hours <= 400) return hours;
  }
  return null;
}

/**
 * Pull a pay figure out of pasted post text.
 * Client-spend lines (`$10K+ spent`) are removed first so they are not treated as the budget.
 */
export function extractBudget(text: string): BudgetFact | null {
  const normalized = withoutClientSpend(normalizeText(text));
  const hours = extractHours(normalized);

  const hourlyRange = matchRange(
    normalized,
    new RegExp(`${MONEY}${RANGE_GAP}(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?[ \t]{0,10}(?:\\/|\\bper[ \t]+)(?:hours?|hrs?)\\b`, "i"),
  );
  if (hourlyRange) return fact("hourly", hourlyRange.min, hourlyRange.max, hours, false);

  const hourlySingle = normalized.match(new RegExp(`${MONEY}[ \t]{0,10}(?:\\/|\\bper[ \t]+)(?:hours?|hrs?)\\b`, "i"));
  if (hourlySingle?.[1]) {
    const amount = readMoney(hourlySingle[1], hourlySingle[2]);
    return fact("hourly", amount, amount, hours, false);
  }

  const hourlyLabeled = normalized.match(
    new RegExp(
      `\\bhourly(?:[ \t]+(?:rate|range))?[ \t]{0,10}[:\\-][ \t]{0,10}${MONEY}(?:${RANGE_GAP}(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?)?`,
      "i",
    ),
  );
  if (hourlyLabeled?.[1]) {
    const min = readMoney(hourlyLabeled[1], hourlyLabeled[2]);
    const max = hourlyLabeled[3] ? readMoney(hourlyLabeled[3], hourlyLabeled[4]) : min;
    return fact("hourly", min, max, hours, false);
  }

  const hourlyBlock = amountsBeforeStandaloneLabel(normalized, /^\s*hourly\s*$/im);
  if (hourlyBlock) return fact("hourly", hourlyBlock.min, hourlyBlock.max, hours, false);

  const fixedLabeled = normalized.match(
    new RegExp(
      `\\b(?:est(?:imated)?\\.?[ \t]+budget|budget|fixed(?:[ \t-]?price)?)[ \t]{0,20}(?:[:\\-]|\\bis\\b|\\bof\\b)?[ \t]{0,20}${MONEY}(?:${RANGE_GAP}(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?)?`,
      "i",
    ),
  );
  if (fixedLabeled?.[1]) {
    const min = readMoney(fixedLabeled[1], fixedLabeled[2]);
    const max = fixedLabeled[3] ? readMoney(fixedLabeled[3], fixedLabeled[4]) : min;
    return fact("fixed", min, max, hours, false);
  }

  const fixedBlock = amountsBeforeStandaloneLabel(normalized, /^\s*fixed(?:[\s-]price)?\s*$/im);
  if (fixedBlock) return fact("fixed", fixedBlock.min, fixedBlock.max, hours, false);

  const bareRange = matchRange(
    normalized,
    new RegExp(`${MONEY}${RANGE_GAP}(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?`, "i"),
  );
  if (bareRange) return fact("fixed", bareRange.min, bareRange.max, hours, true);

  const bare = normalized.match(new RegExp(MONEY, "i"));
  if (bare?.[1]) {
    const amount = readMoney(bare[1], bare[2]);
    return fact("fixed", amount, amount, hours, true);
  }

  return null;
}

export function extractClient(text: string): ClientFacts {
  const normalized = normalizeText(text);
  return {
    paymentVerified: extractPayment(normalized),
    rating: extractRating(normalized),
    totalSpent: extractSpent(normalized),
    hires: extractHires(normalized),
    memberSinceYear: extractMemberYear(normalized),
    longTerm: /\blong[\s-]?term\b/i.test(normalized) || /\bongoing\b/i.test(normalized),
  };
}

function fact(
  kind: BudgetFact["kind"],
  min: number,
  max: number,
  hours: number | null,
  assumed: boolean,
): BudgetFact {
  return {
    kind,
    min: Math.min(min, max),
    max: Math.max(min, max),
    hours,
    assumed,
  };
}

function extractPayment(text: string): boolean | null {
  if (/payment(?:\s+method)?\s+(?:is\s+)?(?:not\s+verified|unverified)\b/i.test(text)) return false;
  if (/payment(?:\s+method)?\s+(?:is\s+)?verified\b/i.test(text)) return true;
  return null;
}

function extractRating(text: string): number | null {
  const labeled = text.match(/\brating\s*[:\-]?\s*([0-5](?:\.\d+)?)\b/i);
  const slash = text.match(/\b([0-5](?:\.\d+)?)\s*\/\s*5\b/);
  const raw = labeled?.[1] ?? slash?.[1];
  if (!raw) return null;
  const rating = Number(raw);
  if (!Number.isFinite(rating) || rating > 5) return null;
  return rating;
}

function extractSpent(text: string): number | null {
  const thousands = text.match(/\$\s*(\d+(?:\.\d+)?)\s*([kK])\+?\s*spent/i);
  if (thousands?.[1]) return Number(thousands[1]) * 1000;
  const plain = text.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\+?\s*spent/i);
  if (plain?.[1]) return readMoney(plain[1], plain[2]);
  const reversedThousands = text.match(/\bspent\s*[:\-]?\s*\$\s*(\d+(?:\.\d+)?)\s*([kK])\b/i);
  if (reversedThousands?.[1]) return Number(reversedThousands[1]) * 1000;
  const reversed = text.match(/\bspent\s*[:\-]?\s*\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/i);
  if (reversed?.[1]) return readMoney(reversed[1], reversed[2]);
  return null;
}

function extractHires(text: string): number | null {
  const leading = text.match(/\b(\d+)\s+hires?\b/i);
  if (leading?.[1]) return Number(leading[1]);
  const labeled = text.match(/\bhires?\s*[:\-]\s*(\d+)\b/i);
  if (labeled?.[1]) return Number(labeled[1]);
  return null;
}

function extractMemberYear(text: string): number | null {
  const match = text.match(/\bmember\s+since\s+(?:[A-Za-z]{3,9}\s+)?(\d{4})\b/i);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  if (year < 1990 || year > 2100) return null;
  return year;
}

function withoutClientSpend(text: string): string {
  return text
    .replace(/\$\s*\d+(?:\.\d+)?\s*[kK]\+?\s*spent/gi, " ")
    .replace(/\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\+?\s*spent/gi, " ")
    .replace(/\bspent\s*[:\-]?\s*\$\s*(?:\d+(?:\.\d+)?\s*[kK]|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/gi, " ");
}

function readMoney(whole: string, frac: string | undefined): number {
  return Number(`${whole.replace(/,/g, "")}${frac ? `.${frac}` : ""}`);
}

function matchRange(text: string, re: RegExp): { min: number; max: number } | null {
  const match = text.match(re);
  if (!match?.[1] || !match[3]) return null;
  return { min: readMoney(match[1], match[2]), max: readMoney(match[3], match[4]) };
}

function amountsBeforeStandaloneLabel(text: string, label: RegExp): { min: number; max: number } | null {
  const match = label.exec(text);
  if (!match) return null;
  const start = Math.max(0, match.index - 80);
  const window = text.slice(start, match.index);
  const amounts: number[] = [];
  for (const found of window.matchAll(new RegExp(MONEY, "g"))) {
    if (found[1]) amounts.push(readMoney(found[1], found[2]));
  }
  if (amounts.length >= 2) {
    const min = amounts[amounts.length - 2];
    const max = amounts[amounts.length - 1];
    if (min === undefined || max === undefined) return null;
    return { min, max };
  }
  if (amounts.length === 1 && amounts[0] !== undefined) {
    return { min: amounts[0], max: amounts[0] };
  }
  return null;
}
