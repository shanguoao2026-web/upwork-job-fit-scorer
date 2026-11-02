#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HELP, parseArgs } from "./args.js";
import { LlmError, UserError } from "./errors.js";
import type { FetchLike } from "./llm.js";
import { run } from "./run.js";
import { toolVersion } from "./version.js";

export interface Io {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: Date;
  cwd?: string;
}

export async function main(argv: string[], io: Partial<Io> = {}): Promise<number> {
  const stdout = io.stdout ?? ((line: string) => console.log(line));
  const stderr = io.stderr ?? ((line: string) => console.error(line));
  try {
    const args = parseArgs(argv);
    if (args.help) {
      stdout(HELP);
      return 0;
    }
    if (args.version) {
      stdout(`upwork-job-fit-scorer ${toolVersion()}`);
      return 0;
    }
    if (!args.inputPath || !args.profilePath) {
      throw new UserError("Both --input and --profile are required. Use --help for usage.");
    }
    const result = await run({
      inputPath: args.inputPath,
      profilePath: args.profilePath,
      outputDir: args.outputDir,
      format: args.format,
      minScore: args.minScore,
      useLlm: args.useLlm,
      ...(io.now ? { now: io.now } : {}),
      ...(io.cwd ? { cwd: io.cwd } : {}),
      ...(io.env ? { env: io.env } : {}),
      ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
    });
    stdout(`Wrote ${result.report.shownCount} job(s) to ${result.outputPaths.join(" and ")}`);
    return 0;
  } catch (error) {
    if (error instanceof UserError || error instanceof LlmError) {
      stderr(error.message);
      return error.exitCode;
    }
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun()) {
  main(process.argv).then(
    (code) => {
      process.exit(code);
    },
    () => {
      process.exit(1);
    },
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
