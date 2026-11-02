export { HELP, parseArgs } from "./args.js";
export { main } from "./cli.js";
export { LlmError, UserError } from "./errors.js";
export { extractBudget, extractClient, extractHours, extractTitle } from "./extract.js";
export { loadInputs } from "./jobs.js";
export { createLlmClient } from "./llm.js";
export type { FetchLike, LlmAnnotation, LlmClient, LlmJobInput } from "./llm.js";
export { DEFAULT_WEIGHTS, loadProfile, parseProfile } from "./profile.js";
export { buildReport, renderJson, renderMarkdown } from "./report.js";
export { displayPath, run } from "./run.js";
export type { RunOptions, RunResult } from "./run.js";
export {
  APPLY_MIN_OVERALL,
  CLEAN_SCAM_SAFETY,
  MISSING_BUDGET_SCORE,
  QUARANTINE_BELOW,
  REVIEW_MIN_OVERALL,
  RUBRIC,
  buildSummary,
  clampScore,
  rankJobs,
  ratioToScore,
  recommend,
  scoreBudget,
  scoreClient,
  scoreJob,
  scoreScam,
  scoreScope,
  scoreSkills,
  skillAppears,
  weightedOverall,
} from "./score.js";
export type {
  BudgetFact,
  ClientFacts,
  DimensionScore,
  DimensionScores,
  Profile,
  Recommendation,
  Report,
  ReportJob,
  Rubric,
  ScoredJob,
  Skill,
  Weights,
} from "./types.js";
export { toolVersion } from "./version.js";
