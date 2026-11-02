/**
 * Very short tokens that are also ordinary English words.
 * These match only in their canonical capitalization ("Go", not "go").
 */
const CASE_SENSITIVE: Record<string, string> = {
  go: "Go",
  r: "R",
  c: "C",
};

export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[–—]/g, "-");
}

export function phrasePresent(haystack: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  const key = trimmed.toLowerCase();
  const canonical = CASE_SENSITIVE[key];
  if (canonical) {
    const body = escapeRegExp(canonical);
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "u");
    return re.test(haystack);
  }
  const body = escapeRegExp(key).replace(/\s+/g, "\\s+");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(haystack);
}

export function formatAmount(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${formatAmount(amount)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
