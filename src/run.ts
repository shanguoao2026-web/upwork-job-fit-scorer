import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { UserError } from "./errors.js";
import { loadInputs } from "./jobs.js";
import { createLlmClient, type FetchLike } from "./llm.js";
import { loadProfile } from "./profile.js";
import { buildReport, renderJson, renderMarkdown } from "./report.js";
import { scoreJob } from "./score.js";
import type { Report } from "./types.js";
import { toolVersion } from "./version.js";

const REPORT_FILES = new Set(["report.md", "report.json"]);

export interface RunOptions {
  inputPath: string;
  profilePath: string;
  outputDir: string;
  format?: "both" | "md" | "json";
  minScore?: number;
  useLlm?: boolean;
  now?: Date;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  version?: string;
}

export interface RunResult {
  report: Report;
  outputPaths: string[];
}

export async function run(options: RunOptions): Promise<RunResult> {
  const minScore = options.minScore ?? 0;
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
    throw new UserError("--min-score must be a number from 0 to 100.");
  }
  const format = options.format ?? "both";
  const cwd = resolve(options.cwd ?? process.cwd());
  const inputPath = resolve(cwd, options.inputPath);
  const profilePath = resolve(cwd, options.profilePath);
  const outputDir = resolve(cwd, options.outputDir);
  const now = options.now ?? new Date();

  const profile = loadProfile(profilePath);
  const loaded = loadInputs(inputPath).filter((job) => !isGeneratedReport(job.absolutePath, outputDir));
  if (loaded.length === 0) {
    throw new UserError(`No .txt or .md job posts found in ${options.inputPath}`);
  }

  const scored = loaded.map((job) =>
    scoreJob(profile, {
      source: displayPath(job.absolutePath, cwd),
      text: job.text,
      now,
    }),
  );
  const shown = scored.filter((job) => job.overall >= minScore);

  if (options.useLlm) {
    const client = createLlmClient({
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.env ? { env: options.env } : {}),
    });
    for (const job of shown) {
      const note = await client.annotate({
        title: job.title,
        text: job.text,
        overall: job.overall,
        scores: job.scores,
      });
      job.llmSummary = note.summary;
    }
  }

  const report = buildReport({
    profile,
    jobs: shown,
    jobCount: scored.length,
    hiddenByMinScore: scored.length - shown.length,
    generatedAt: now.toISOString(),
    mode: options.useLlm ? "rules+llm" : "rules",
    toolVersion: options.version ?? toolVersion(),
  });

  await mkdir(outputDir, { recursive: true });
  const outputPaths: string[] = [];
  if (format !== "json") {
    const mdPath = resolve(outputDir, "report.md");
    await writeFile(mdPath, renderMarkdown(report), "utf8");
    outputPaths.push(mdPath);
  }
  if (format !== "md") {
    const jsonPath = resolve(outputDir, "report.json");
    await writeFile(jsonPath, renderJson(report), "utf8");
    outputPaths.push(jsonPath);
  }
  return { report, outputPaths };
}

export function displayPath(filePath: string, cwd: string): string {
  const rel = relative(cwd, resolve(filePath));
  if (rel === "") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return resolve(filePath);
  return rel;
}

function isGeneratedReport(filePath: string, outputDir: string): boolean {
  return resolve(dirname(filePath)) === resolve(outputDir) && REPORT_FILES.has(basename(filePath));
}
