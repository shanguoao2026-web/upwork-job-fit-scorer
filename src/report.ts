import { QUARANTINE_BELOW, RUBRIC, rankJobs } from "./score.js";
import { formatMoney } from "./text.js";
import type { BudgetFact, Profile, Report, ReportJob, ScoredJob } from "./types.js";

export function buildReport(input: {
  profile: Profile;
  jobs: ScoredJob[];
  jobCount: number;
  hiddenByMinScore: number;
  generatedAt: string;
  mode: Report["mode"];
  toolVersion: string;
}): Report {
  const ranked = rankJobs(input.jobs);
  const jobs: ReportJob[] = ranked.map((job, index) => ({
    rank: index + 1,
    source: job.source,
    title: job.title,
    overall: job.overall,
    recommendation: job.recommendation,
    summary: job.summary,
    llmSummary: job.llmSummary,
    scores: job.scores,
    matchedSkills: job.matchedSkills,
    missingSkills: job.missingSkills,
    budget: job.budget,
    client: job.client,
    scamHits: job.scamHits,
    quarantined: job.scores.scamSafety.score < QUARANTINE_BELOW,
  }));
  return {
    tool: "upwork-job-fit-scorer",
    toolVersion: input.toolVersion,
    generatedAt: input.generatedAt,
    mode: input.mode,
    rubric: RUBRIC,
    profile: {
      name: input.profile.name,
      title: input.profile.title,
      hourlyFloor: input.profile.hourlyFloor,
      currency: input.profile.currency,
      referenceHours: input.profile.referenceHours,
      skills: input.profile.skills.map((skill) => skill.name),
      redFlags: input.profile.redFlags,
      weights: input.profile.weights,
    },
    jobCount: input.jobCount,
    shownCount: jobs.length,
    hiddenByMinScore: input.hiddenByMinScore,
    quarantinedCount: jobs.filter((job) => job.quarantined).length,
    jobs,
  };
}

export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderMarkdown(report: Report): string {
  const profile = profileLine(report);
  const weights = report.profile.weights;
  const lines: string[] = [
    "# Job fit report",
    "",
    `- Profile: ${profile}`,
    `- Hourly floor: ${formatMoney(report.profile.hourlyFloor, report.profile.currency)}`,
    `- Reference hours for fixed budgets: ${report.profile.referenceHours}`,
    `- Weights: skill ${weights.skillMatch}, budget ${weights.budget}, client ${weights.clientSignals}, scope ${weights.scopeClarity}, scam safety ${weights.scamSafety}`,
    `- Jobs scored: ${report.jobCount}`,
    `- Shown: ${report.shownCount}`,
    `- Hidden by min score: ${report.hiddenByMinScore}`,
    `- Quarantined (scam safety below ${report.rubric.quarantineScamSafetyBelow}): ${report.quarantinedCount}`,
    `- Generated: ${report.generatedAt}`,
    `- Mode: ${report.mode}`,
    `- Scorer: ${report.tool} ${report.toolVersion}`,
    "",
    "Scores run from 0 to 100. Higher is better on every row, including scam safety.",
    `Posts with scam safety below ${report.rubric.quarantineScamSafetyBelow} are listed after safer posts.`,
    `Apply needs overall >= ${report.rubric.applyMinOverall} and scam safety ${report.rubric.cleanScamSafetyForApply}. Review needs overall >= ${report.rubric.reviewMinOverall} and scam safety >= ${report.rubric.quarantineScamSafetyBelow}, and it is not an Apply.`,
    "",
  ];

  if (report.jobs.length === 0) {
    lines.push("No jobs met the minimum score.");
    lines.push("");
    return `${lines.join("\n")}`;
  }

  for (const job of report.jobs) {
    lines.push(`## ${job.rank}. ${job.title} — ${job.overall}/100 — ${job.recommendation}`);
    lines.push("");
    lines.push(`- Source: \`${job.source}\``);
    lines.push(`- Pay: ${payLine(job.budget, report.profile.currency)}`);
    lines.push(`- Skills: ${skillLine(job)}`);
    if (job.scamHits.length > 0) {
      lines.push(`- Red flags: ${job.scamHits.join("; ")}`);
    }
    if (job.quarantined) {
      lines.push(
        `- Placement: listed after safer posts because scam safety is below ${report.rubric.quarantineScamSafetyBelow}.`,
      );
    }
    lines.push("");
    lines.push("| Dimension | Score |");
    lines.push("| --- | ---: |");
    lines.push(`| Skill match | ${job.scores.skillMatch.score} |`);
    lines.push(`| Budget vs floor | ${job.scores.budget.score} |`);
    lines.push(`| Client signals | ${job.scores.clientSignals.score} |`);
    lines.push(`| Scope clarity | ${job.scores.scopeClarity.score} |`);
    lines.push(`| Scam safety | ${job.scores.scamSafety.score} |`);
    lines.push(`| Overall | ${job.overall} |`);
    lines.push("");
    for (const [label, dimension] of [
      ["Skill match", job.scores.skillMatch],
      ["Budget vs floor", job.scores.budget],
      ["Client signals", job.scores.clientSignals],
      ["Scope clarity", job.scores.scopeClarity],
      ["Scam safety", job.scores.scamSafety],
    ] as const) {
      lines.push(`**${label}.**`);
      for (const reason of dimension.reasons) {
        lines.push(`- ${reason}`);
      }
      lines.push("");
    }
    lines.push(`**Recommendation.** ${recommendationParagraph(job)}`);
    lines.push("");
    if (job.llmSummary) {
      lines.push("**Model note.**");
      lines.push("");
      for (const part of job.llmSummary.split(/\n+/)) {
        if (part.trim()) lines.push(`> ${part.trim()}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}`;
}

function profileLine(report: Report): string {
  const { name, title } = report.profile;
  if (name && title) return `${name} — ${title}`;
  return name ?? title ?? "Untitled profile";
}

function skillLine(job: ReportJob): string {
  const matched = job.matchedSkills.length > 0 ? job.matchedSkills.join(", ") : "none matched";
  if (job.missingSkills.length === 0) return matched;
  return `${matched} (missing ${job.missingSkills.join(", ")})`;
}

function payLine(budget: BudgetFact | null, currency: string): string {
  if (!budget) return "not stated";
  const amount =
    budget.min === budget.max
      ? formatMoney(budget.min, currency)
      : `${formatMoney(budget.min, currency)}-${formatMoney(budget.max, currency)}`;
  if (budget.kind === "hourly") return `hourly ${amount}`;
  const hours = budget.hours == null ? "" : ` over about ${budget.hours} hours`;
  const assumed = budget.assumed ? " (unlabeled amount)" : "";
  return `fixed ${amount}${hours}${assumed}`;
}

function recommendationParagraph(job: ReportJob): string {
  if (job.quarantined) {
    return "Skip. Scam safety is below 50, so this post is a policy or fraud risk even if other scores look attractive.";
  }
  if (job.recommendation === "apply") {
    return "Apply. Overall clears 75 and the scam screen is clean.";
  }
  if (job.recommendation === "review") {
    return "Review. Worth a careful read: the overall score is at least 55, or a caution phrase keeps it out of the apply band.";
  }
  return "Skip. Overall is below 55.";
}
