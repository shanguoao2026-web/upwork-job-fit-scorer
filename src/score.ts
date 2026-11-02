import { extractBudget, extractClient, extractTitle } from "./extract.js";
import { formatMoney, normalizeText, phrasePresent } from "./text.js";
import type {
  BudgetFact,
  ClientFacts,
  DimensionScore,
  DimensionScores,
  Profile,
  Recommendation,
  Rubric,
  ScoredJob,
  Skill,
  Weights,
} from "./types.js";

export const APPLY_MIN_OVERALL = 75;
export const REVIEW_MIN_OVERALL = 55;
export const QUARANTINE_BELOW = 50;
export const MISSING_BUDGET_SCORE = 40;
export const CLEAN_SCAM_SAFETY = 100;

export const RUBRIC: Rubric = {
  applyMinOverall: APPLY_MIN_OVERALL,
  reviewMinOverall: REVIEW_MIN_OVERALL,
  quarantineScamSafetyBelow: QUARANTINE_BELOW,
  cleanScamSafetyForApply: CLEAN_SCAM_SAFETY,
  missingBudgetScore: MISSING_BUDGET_SCORE,
};

/** Aliases applied on top of names and profile aliases. Keys are lowercase skill names. */
const BUILTIN_ALIASES: Record<string, readonly string[]> = {
  typescript: ["ts"],
  javascript: ["js", "ecmascript"],
  "node.js": ["node", "nodejs", "node js"],
  nodejs: ["node", "node.js", "node js"],
  react: ["react.js", "reactjs", "react js"],
  postgresql: ["postgres", "psql"],
  postgres: ["postgresql", "psql"],
  "next.js": ["nextjs", "next js"],
  nextjs: ["next.js", "next js"],
  "vue.js": ["vue", "vuejs"],
  vue: ["vue.js", "vuejs"],
  kubernetes: ["k8s"],
  golang: ["Go"],
  go: ["golang"],
  "c++": ["cpp"],
  "c#": ["csharp", "c sharp"],
};

const SCAM_RULES: ReadonlyArray<{
  id: string;
  label: string;
  penalty: number;
  patterns: RegExp[];
}> = [
  {
    id: "off_platform",
    label: "Asks to move off-platform",
    penalty: 35,
    patterns: [
      /\boff[\s-]?platform\b/i,
      /\boutside\s+(?:of\s+)?(?:upwork|the\s+platform)\b/i,
      /\b(?:e-?mail)\s+me\s+(?:at|directly)\b/i,
      /\bcontact\s+me\s+(?:at|via)\s+\S+@\S+/i,
      /\bmy\s+(?:e-?mail|gmail|yahoo|outlook)\s+(?:is|address)\b/i,
      /\b(?:continue|move|take)\s+(?:this\s+)?(?:chat|conversation|discussion)\s+(?:off(?:\s+the\s+platform)?|to\s+(?:e-?mail|gmail|skype|discord)|on\s+(?:e-?mail|gmail|skype|discord)|via\s+(?:e-?mail|gmail|skype|discord))\b/i,
      /\bskype\b/i,
    ],
  },
  {
    id: "pay_to_start",
    label: "Asks you to pay to start",
    penalty: 40,
    patterns: [
      /\bpay\s+to\s+(?:start|begin|apply|join)\b/i,
      /\bpay\s+(?:a\s+)?fee\s+before\b/i,
      /\bregistration\s+fee\b/i,
      /\bprocessing\s+fee\b/i,
      /\bgift\s*cards?\b/i,
      /\b(?:buy|purchase)\s+(?:your\s+own\s+|the\s+|a\s+)?(?:equipment|laptop|software|kit|course)\b/i,
      /\bsend\s+(?:me\s+)?(?:money|funds|a\s+payment)\s+first\b/i,
      /\byou(?:'ll| will)\s+be\s+reimbursed\b/i,
      /\btraining\s+fee\b/i,
      /\bdeposit\s+required\s+before\b/i,
    ],
  },
  {
    id: "telegram",
    label: "Asks for Telegram contact",
    penalty: 30,
    patterns: [/\btelegram\b/i, /\bt\.me\/\w/i],
  },
  {
    id: "whatsapp",
    label: "Asks for WhatsApp contact",
    penalty: 30,
    patterns: [/\bwhats\s*app\b/i, /\bwa\.me\/\w/i],
  },
  {
    id: "crypto",
    label: "Mentions crypto payment",
    penalty: 25,
    patterns: [
      /\bbitcoin\b/i,
      /\bbtc\b/i,
      /\busdt\b/i,
      /\bethereum\b/i,
      /\bcrypto(?:currency)?\b/i,
      /\bwallet\s+address\b/i,
      /\bmetamask\b/i,
      /\bpay(?:\s+\w+){0,3}\s+in\s+eth\b/i,
    ],
  },
  {
    id: "fake_check",
    label: "Fake-check or overpayment language",
    penalty: 40,
    patterns: [
      /\bcashier'?s?\s+chec?k\b/i,
      /\bchec?k\s+by\s+(?:courier|mail)\b/i,
      /\boverpay(?:ment)?\b/i,
      /\bmobile\s+deposit\b/i,
      /\bmoney\s+order\b/i,
      /\bwire\s+(?:back\s+)?the\s+(?:extra|difference)\b/i,
    ],
  },
  {
    id: "unpaid",
    label: "Asks for unpaid work",
    penalty: 20,
    patterns: [
      /\bunpaid\b/i,
      /\bwork\s+for\s+free\b/i,
      /\bspec(?:ulative)?\s+work\b/i,
      /\bfor\s+exposure\b/i,
      /\bfree\s+(?:test|sample)\s+(?:task|project|work)\b/i,
    ],
  },
];

const CUSTOM_PENALTY = 15;

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Map pay / floor to 0–100.
 * 1.5× floor and above is 100. Exactly the floor is 80. Half the floor is 40. Zero is 0.
 * The segments meet at those points.
 */
export function ratioToScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio >= 1.5) return 100;
  if (ratio >= 1) return Math.round(80 + ((ratio - 1) / 0.5) * 20);
  if (ratio >= 0.5) return Math.round(40 + ((ratio - 0.5) / 0.5) * 40);
  return Math.round((ratio / 0.5) * 40);
}

export function skillAppears(skill: Skill, text: string): boolean {
  return phrasesFor(skill).some((phrase) => phrasePresent(text, phrase));
}

export function scoreSkills(skills: Skill[], text: string): DimensionScore & {
  matched: string[];
  missing: string[];
} {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of skills) {
    if (skillAppears(skill, text)) matched.push(skill.name);
    else missing.push(skill.name);
  }
  const score = skills.length === 0 ? 0 : Math.round((matched.length / skills.length) * 100);
  const reasons = [
    matched.length === 0
      ? `Matched 0/${skills.length} profile skills.`
      : `Matched ${matched.length}/${skills.length} profile skills: ${matched.join(", ")}.`,
  ];
  reasons.push(
    missing.length === 0
      ? "Every profile skill appears in the post."
      : `Not mentioned: ${missing.join(", ")}.`,
  );
  return { score, reasons, matched, missing };
}

export function scoreBudget(
  fact: BudgetFact | null,
  floor: number,
  referenceHours: number,
  currency: string,
): DimensionScore {
  if (!fact) {
    return {
      score: MISSING_BUDGET_SCORE,
      reasons: [
        `No hourly rate or fixed budget found (score ${MISSING_BUDGET_SCORE}). Compare the post yourself before applying.`,
      ],
    };
  }
  const midpoint = (fact.min + fact.max) / 2;
  if (fact.kind === "hourly") {
    const ratio = midpoint / floor;
    const score = ratioToScore(ratio);
    const range =
      fact.min === fact.max
        ? `${formatMoney(fact.min, currency)}/hr`
        : `${formatMoney(fact.min, currency)}-${formatMoney(fact.max, currency)}/hr`;
    return {
      score,
      reasons: [
        `Hourly ${range}; midpoint ${formatMoney(midpoint, currency)} versus floor ${formatMoney(floor, currency)} (ratio ${ratio.toFixed(2)}, score ${score}).`,
      ],
    };
  }

  if (fact.hours != null && fact.hours > 0) {
    const implied = midpoint / fact.hours;
    const ratio = implied / floor;
    const score = ratioToScore(ratio);
    return {
      score,
      reasons: [
        `Fixed ${formatMoney(midpoint, currency)} over about ${formatAmountHours(fact.hours)} hours implies ${formatMoney(implied, currency)}/hr versus floor ${formatMoney(floor, currency)} (ratio ${ratio.toFixed(2)}, score ${score}).`,
      ],
    };
  }

  const referencePay = floor * referenceHours;
  const ratio = midpoint / referencePay;
  const score = ratioToScore(ratio);
  const assumed = fact.assumed ? " Unlabeled amount, treated as a fixed budget." : "";
  return {
    score,
    reasons: [
      `Fixed ${formatMoney(midpoint, currency)} with no hour estimate. Compared with ${referenceHours} hours at the floor (${formatMoney(referencePay, currency)}). Ratio ${ratio.toFixed(2)}, score ${score}.${assumed}`,
    ],
  };
}

export function scoreClient(facts: ClientFacts, now: Date): DimensionScore {
  let score = 50;
  const reasons = ["Started at 50; pasted text often omits client badges."];

  if (facts.paymentVerified === true) {
    score += 15;
    reasons.push("Payment method is verified (+15).");
  } else if (facts.paymentVerified === false) {
    score -= 15;
    reasons.push("Payment method is not verified (-15).");
  } else {
    reasons.push("No payment-verification line found.");
  }

  if (facts.rating != null) {
    if (facts.rating >= 4.8) {
      score += 15;
      reasons.push(`Rating ${formatAmountHours(facts.rating)} is strong (+15).`);
    } else if (facts.rating >= 4.5) {
      score += 10;
      reasons.push(`Rating ${formatAmountHours(facts.rating)} is solid (+10).`);
    } else if (facts.rating >= 4) {
      score += 5;
      reasons.push(`Rating ${formatAmountHours(facts.rating)} is acceptable (+5).`);
    } else {
      score -= 15;
      reasons.push(`Rating ${formatAmountHours(facts.rating)} is below 4.0 (-15).`);
    }
  } else {
    reasons.push("No client rating found.");
  }

  if (facts.totalSpent != null) {
    if (facts.totalSpent >= 10000) {
      score += 10;
      reasons.push(`Client spend ${facts.totalSpent} is at least 10000 (+10).`);
    } else if (facts.totalSpent >= 1000) {
      score += 5;
      reasons.push(`Client spend ${facts.totalSpent} is at least 1000 (+5).`);
    } else {
      reasons.push(`Client spend ${facts.totalSpent} is under 1000 (no change).`);
    }
  } else {
    reasons.push("No client spend figure found.");
  }

  if (facts.hires != null) {
    if (facts.hires >= 5) {
      score += 8;
      reasons.push(`${facts.hires} hires (+8).`);
    } else if (facts.hires >= 1) {
      score += 4;
      reasons.push(`${facts.hires} hire${facts.hires === 1 ? "" : "s"} (+4).`);
    } else {
      score -= 8;
      reasons.push("0 hires (-8).");
    }
  } else {
    reasons.push("No hire count found.");
  }

  if (facts.memberSinceYear != null) {
    const years = now.getUTCFullYear() - facts.memberSinceYear;
    if (years >= 3) {
      score += 7;
      reasons.push(`Member since ${facts.memberSinceYear} (${years} years, +7).`);
    } else if (years >= 1) {
      score += 3;
      reasons.push(`Member since ${facts.memberSinceYear} (${years} years, +3).`);
    } else if (years >= 0) {
      reasons.push(`Member since ${facts.memberSinceYear} (less than a year, no change).`);
    } else {
      reasons.push(`Member since ${facts.memberSinceYear} is in the future (ignored).`);
    }
  } else {
    reasons.push("No membership date found.");
  }

  if (facts.longTerm) {
    score += 5;
    reasons.push("Post describes long-term or ongoing work (+5).");
  }

  return { score: clampScore(score), reasons };
}

export function scoreScope(text: string): DimensionScore {
  const body = normalizeText(text).trim();
  let score = 20;
  const reasons: string[] = [];
  const length = body.length;

  if (length >= 600) {
    score += 20;
    reasons.push(`Description is ${length} characters, long enough to judge the work.`);
  } else if (length >= 280) {
    score += 12;
    reasons.push(`Description is ${length} characters.`);
  } else if (length < 140) {
    score -= 8;
    reasons.push(`Description is short (${length} characters).`);
  } else {
    reasons.push(`Description is ${length} characters.`);
  }

  const bullets = body.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
  if (bullets >= 3) {
    score += 18;
    reasons.push(`Found ${bullets} list items.`);
  } else if (bullets >= 1) {
    score += 8;
    reasons.push(`Found ${bullets} list item${bullets === 1 ? "" : "s"}.`);
  } else {
    reasons.push("No bullet or numbered list of tasks.");
  }

  if (/\b(deliverables?|milestones?|acceptance criteria|definition of done)\b/i.test(body)) {
    score += 16;
    reasons.push("Mentions deliverables, milestones, or acceptance criteria.");
  } else {
    reasons.push("Does not mention deliverables or acceptance criteria.");
  }

  if (
    /\b(deadline|due date|timeline|\d+\s+weeks?|\d+\s+days?|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
      body,
    )
  ) {
    score += 16;
    reasons.push("Mentions a timeline or deadline.");
  } else {
    reasons.push("No timeline or deadline found.");
  }

  if (/\b(you will|responsibilities|requirements|must have|we need)\b/i.test(body)) {
    score += 12;
    reasons.push("States responsibilities or requirements.");
  } else {
    reasons.push("Does not state responsibilities or requirements.");
  }

  if (/\b(rockstar|ninja|guru|wizard|simple task|quick task|easy money)\b/i.test(body)) {
    score -= 12;
    reasons.push("Uses vague hype wording instead of a concrete scope.");
  }

  return { score: clampScore(score), reasons };
}

export interface ScamResult extends DimensionScore {
  hits: string[];
}

export function scoreScam(text: string, redFlags: string[]): ScamResult {
  const body = normalizeText(text);
  const hits: string[] = [];
  const reasons: string[] = [];
  let penalty = 0;

  for (const rule of SCAM_RULES) {
    const found = firstMatch(body, rule.patterns);
    if (!found) continue;
    penalty += rule.penalty;
    hits.push(rule.label);
    reasons.push(`${rule.label} (-${rule.penalty}). Matched "${snippet(found)}".`);
  }

  const seen = new Set<string>();
  for (const phrase of redFlags) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    if (!body.toLowerCase().includes(key)) continue;
    seen.add(key);
    penalty += CUSTOM_PENALTY;
    const label = `Profile red-flag phrase: ${phrase}`;
    hits.push(label);
    reasons.push(`${label} (-${CUSTOM_PENALTY}).`);
  }

  const score = clampScore(100 - penalty);
  if (hits.length === 0) {
    reasons.push(
      "No off-platform, pay-to-start, Telegram, WhatsApp, crypto, fake-check, or unpaid-work language found.",
    );
  } else {
    reasons.push(`Scam safety is ${score} after ${hits.length} hit${hits.length === 1 ? "" : "s"}.`);
  }
  return { score, reasons, hits };
}

export function weightedOverall(scores: DimensionScores, weights: Weights): number {
  return clampScore(
    scores.skillMatch.score * weights.skillMatch +
      scores.budget.score * weights.budget +
      scores.clientSignals.score * weights.clientSignals +
      scores.scopeClarity.score * weights.scopeClarity +
      scores.scamSafety.score * weights.scamSafety,
  );
}

export function recommend(overall: number, scamSafety: number): Recommendation {
  if (scamSafety < QUARANTINE_BELOW) return "skip";
  if (scamSafety < CLEAN_SCAM_SAFETY) {
    return overall >= REVIEW_MIN_OVERALL ? "review" : "skip";
  }
  if (overall >= APPLY_MIN_OVERALL) return "apply";
  if (overall >= REVIEW_MIN_OVERALL) return "review";
  return "skip";
}

export function rankJobs<T extends ScoredJob>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const aQuarantine = a.scores.scamSafety.score < QUARANTINE_BELOW ? 1 : 0;
    const bQuarantine = b.scores.scamSafety.score < QUARANTINE_BELOW ? 1 : 0;
    if (aQuarantine !== bQuarantine) return aQuarantine - bQuarantine;
    if (a.overall !== b.overall) return b.overall - a.overall;
    if (a.scores.scamSafety.score !== b.scores.scamSafety.score) {
      return b.scores.scamSafety.score - a.scores.scamSafety.score;
    }
    if (a.scores.skillMatch.score !== b.scores.skillMatch.score) {
      return b.scores.skillMatch.score - a.scores.skillMatch.score;
    }
    return a.source.localeCompare(b.source);
  });
}

export function buildSummary(
  recommendation: Recommendation,
  scores: DimensionScores,
): string {
  const head = recommendation === "apply" ? "Apply" : recommendation === "review" ? "Review" : "Skip";
  return `${head}. ${scores.skillMatch.reasons[0] ?? ""} ${scores.budget.reasons[0] ?? ""} ${scores.scamSafety.reasons[0] ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreJob(
  profile: Profile,
  input: { source: string; text: string; now?: Date },
): ScoredJob {
  const text = normalizeText(input.text);
  const now = input.now ?? new Date();
  const skills = scoreSkills(profile.skills, text);
  const budgetFact = extractBudget(text);
  const client = extractClient(text);
  const scam = scoreScam(text, profile.redFlags);
  const scores: DimensionScores = {
    skillMatch: { score: skills.score, reasons: skills.reasons },
    budget: scoreBudget(budgetFact, profile.hourlyFloor, profile.referenceHours, profile.currency),
    clientSignals: scoreClient(client, now),
    scopeClarity: scoreScope(text),
    scamSafety: { score: scam.score, reasons: scam.reasons },
  };
  const overall = weightedOverall(scores, profile.weights);
  const recommendation = recommend(overall, scores.scamSafety.score);
  return {
    source: input.source,
    title: extractTitle(text),
    text,
    overall,
    recommendation,
    summary: buildSummary(recommendation, scores),
    llmSummary: null,
    scores,
    matchedSkills: skills.matched,
    missingSkills: skills.missing,
    budget: budgetFact,
    client,
    scamHits: scam.hits,
  };
}

function phrasesFor(skill: Skill): string[] {
  const builtin = BUILTIN_ALIASES[skill.name.trim().toLowerCase()] ?? [];
  const all = [skill.name, ...skill.aliases, ...builtin];
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const phrase of all) {
    const key = phrase.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase.trim());
  }
  return phrases;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const found = text.match(pattern);
    if (found?.[0]) return found[0];
  }
  return null;
}

function snippet(match: string): string {
  const oneLine = match.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}

function formatAmountHours(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "");
}
