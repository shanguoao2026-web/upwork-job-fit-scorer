export interface Skill {
  name: string;
  aliases: string[];
}

export interface Weights {
  skillMatch: number;
  budget: number;
  clientSignals: number;
  scopeClarity: number;
  scamSafety: number;
}

export interface Profile {
  name: string | null;
  title: string | null;
  skills: Skill[];
  hourlyFloor: number;
  referenceHours: number;
  currency: string;
  redFlags: string[];
  weights: Weights;
}

export interface DimensionScore {
  score: number;
  reasons: string[];
}

export type Recommendation = "apply" | "review" | "skip";

export interface BudgetFact {
  kind: "hourly" | "fixed";
  min: number;
  max: number;
  /** Estimated hours when the post states a duration. Used for fixed budgets. */
  hours: number | null;
  /** True when the amount was not labeled hourly or fixed. */
  assumed: boolean;
}

export interface ClientFacts {
  paymentVerified: boolean | null;
  rating: number | null;
  totalSpent: number | null;
  hires: number | null;
  memberSinceYear: number | null;
  longTerm: boolean;
}

export interface DimensionScores {
  skillMatch: DimensionScore;
  budget: DimensionScore;
  clientSignals: DimensionScore;
  scopeClarity: DimensionScore;
  scamSafety: DimensionScore;
}

export interface ScoredJob {
  source: string;
  title: string;
  text: string;
  overall: number;
  recommendation: Recommendation;
  summary: string;
  llmSummary: string | null;
  scores: DimensionScores;
  matchedSkills: string[];
  missingSkills: string[];
  budget: BudgetFact | null;
  client: ClientFacts;
  scamHits: string[];
}

export interface Rubric {
  applyMinOverall: number;
  reviewMinOverall: number;
  quarantineScamSafetyBelow: number;
  cleanScamSafetyForApply: number;
  missingBudgetScore: number;
}

export interface ReportProfile {
  name: string | null;
  title: string | null;
  hourlyFloor: number;
  currency: string;
  referenceHours: number;
  skills: string[];
  redFlags: string[];
  weights: Weights;
}

export interface ReportJob {
  rank: number;
  source: string;
  title: string;
  overall: number;
  recommendation: Recommendation;
  summary: string;
  llmSummary: string | null;
  scores: DimensionScores;
  matchedSkills: string[];
  missingSkills: string[];
  budget: BudgetFact | null;
  client: ClientFacts;
  scamHits: string[];
  quarantined: boolean;
}

export interface Report {
  tool: "upwork-job-fit-scorer";
  toolVersion: string;
  generatedAt: string;
  mode: "rules" | "rules+llm";
  rubric: Rubric;
  profile: ReportProfile;
  jobCount: number;
  shownCount: number;
  hiddenByMinScore: number;
  quarantinedCount: number;
  jobs: ReportJob[];
}
