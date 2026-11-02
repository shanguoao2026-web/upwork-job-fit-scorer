import { UserError } from "./errors.js";

export const HELP = `upwork-job-fit-scorer — rank pasted job posts against your skills profile

The tool reads job text you already saved. It does not log in anywhere,
scrape job boards, or open a network connection unless you pass --llm.

Usage:
  upwork-job-fit-scorer --input <file-or-dir> --profile <profile.yaml> [options]

Required:
  -i, --input <path>      A job post file, or a folder of .txt and .md posts
                          (the folder is not recursive)
  -p, --profile <path>    YAML profile with skills, hourly_floor, and optional
                          red_flags

Options:
  -o, --output <dir>      Output directory (default: ./job-fit-report)
  -f, --format <name>     both, md, or json (default: both)
      --min-score <n>     Hide jobs with overall score below n (0-100, default 0)
      --llm               Add a note from an OpenAI-compatible chat model
  -h, --help              Show this help
  -v, --version           Show the version

Scoring:
  Each job gets five scores from 0 to 100, plus a weighted overall score.
  Higher is better on every score, including scam safety.
    skill match       share of your profile skills found in the post
    budget vs floor   hourly midpoint, or a fixed budget against your floor
    client signals    payment, rating, spend, hires, and membership lines
    scope clarity     length, lists, deliverables, timeline, requirements
    scam safety       off-platform, pay-to-start, Telegram, WhatsApp, crypto,
                      fake check, unpaid work, and your red_flags phrases

  Apply: overall >= 75 and scam safety is 100.
  Review: overall >= 55 and scam safety >= 50, when the post is not an Apply.
  Skip: everything else.
  Posts with scam safety below 50 are ranked after safer posts.

LLM (optional, off by default):
  OPENAI_BASE_URL   default https://api.openai.com/v1
  OPENAI_API_KEY    required when --llm is set; otherwise the command stops
                    before any request
  OPENAI_MODEL      default gpt-4o-mini
  Scores stay on the rules. The model only adds a note.

Examples:
  upwork-job-fit-scorer --input ./jobs --profile ./profile.yaml
  upwork-job-fit-scorer -i ./jobs/one-post.txt -p ./profile.yaml -o ./out
  upwork-job-fit-scorer -i ./jobs -p ./profile.yaml --format json --min-score 60
  upwork-job-fit-scorer -i ./jobs -p ./profile.yaml --llm

Exit codes:
  0  report written
  2  bad arguments, profile, or input
  3  --llm was set and the model call failed or is not configured
  1  unexpected error
`;

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  inputPath?: string;
  profilePath?: string;
  outputDir: string;
  format: "both" | "md" | "json";
  minScore: number;
  useLlm: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const tokens = argv.slice(2);
  if (tokens.some((token) => token === "--help" || token === "-h")) {
    return defaults({ help: true });
  }
  if (tokens.some((token) => token === "--version" || token === "-v")) {
    return defaults({ version: true });
  }

  const parsed = defaults({});
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token === "--") {
      if (tokens.slice(i + 1).length > 0) throw new UserError("Unexpected argument.");
      break;
    }
    if (token === "--llm") {
      parsed.useLlm = true;
      continue;
    }

    const eq = token.startsWith("--") ? token.indexOf("=") : -1;
    const key = eq === -1 ? token : token.slice(0, eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (!takesValue(key)) {
      throw new UserError(`Unknown option: ${token}`);
    }
    if (value === undefined) {
      const next = tokens[i + 1];
      if (!isValue(next)) throw new UserError(`Missing value for ${key}.`);
      value = next;
      i += 1;
    }
    if (value === "") throw new UserError(`Missing value for ${key}.`);
    assign(parsed, key, value);
  }
  return parsed;
}

function defaults(overrides: Partial<ParsedArgs>): ParsedArgs {
  return {
    help: false,
    version: false,
    outputDir: "job-fit-report",
    format: "both",
    minScore: 0,
    useLlm: false,
    ...overrides,
  };
}

function takesValue(key: string): boolean {
  return (
    key === "--input" ||
    key === "-i" ||
    key === "--profile" ||
    key === "-p" ||
    key === "--output" ||
    key === "-o" ||
    key === "--format" ||
    key === "-f" ||
    key === "--min-score"
  );
}

function isValue(token: string | undefined): token is string {
  if (token === undefined) return false;
  if (!token.startsWith("-")) return true;
  return /^-?\d+(\.\d+)?$/.test(token);
}

function assign(parsed: ParsedArgs, key: string, value: string): void {
  switch (key) {
    case "--input":
    case "-i":
      parsed.inputPath = value;
      return;
    case "--profile":
    case "-p":
      parsed.profilePath = value;
      return;
    case "--output":
    case "-o":
      parsed.outputDir = value;
      return;
    case "--format":
    case "-f": {
      const format = value.toLowerCase();
      if (format !== "both" && format !== "md" && format !== "json") {
        throw new UserError("--format must be both, md, or json.");
      }
      parsed.format = format;
      return;
    }
    case "--min-score": {
      const score = Number(value);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        throw new UserError("--min-score must be a number from 0 to 100.");
      }
      parsed.minScore = score;
      return;
    }
    default:
      throw new UserError(`Unknown option: ${key}`);
  }
}
