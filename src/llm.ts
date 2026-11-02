import { LlmError } from "./errors.js";
import { isRecord } from "./record.js";
import type { DimensionScores } from "./types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_POST_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 2_000;

const SYSTEM_PROMPT = [
  "You help a freelancer decide whether a pasted job post is worth their time.",
  'Reply with one JSON object only, no markdown: {"summary":"<string>"}.',
  "The summary is 2 to 4 sentences.",
  "Use only facts present in the post and the rule scores.",
  "Do not change the scores.",
  "Do not suggest moving off the hiring platform.",
  "Do not invent client history, budget, or contact details.",
  "Do not include links.",
].join(" ");

export interface LlmJobInput {
  title: string;
  text: string;
  overall: number;
  scores: DimensionScores;
}

export interface LlmAnnotation {
  summary: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LlmClientOptions {
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface LlmClient {
  annotate(input: LlmJobInput): Promise<LlmAnnotation>;
}

export function createLlmClient(options: LlmClientOptions = {}): LlmClient {
  return {
    async annotate(input: LlmJobInput): Promise<LlmAnnotation> {
      const env = options.env ?? process.env;
      const apiKey = (env.OPENAI_API_KEY ?? "").trim();
      if (!apiKey) {
        throw new LlmError("OPENAI_API_KEY is not set. Refusing to call the model.");
      }
      const baseUrl = (env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).trim();
      const model = (env.OPENAI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
      assertHttpBase(baseUrl);
      const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const fetchImpl = options.fetchImpl ?? defaultFetch;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const body = JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(input) },
        ],
      });

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (error instanceof LlmError) throw error;
        throw new LlmError(`LLM request failed: ${redact(errorText(error), apiKey)}`);
      }

      if (!response.ok) {
        throw new LlmError(`LLM request failed with HTTP ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await response.text());
      } catch {
        throw new LlmError("LLM response was not JSON.");
      }
      return { summary: readSummary(payload) };
    },
  };
}

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init);
}

function assertHttpBase(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LlmError(`OPENAI_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LlmError("OPENAI_BASE_URL must start with http:// or https://");
  }
}

function userPrompt(input: LlmJobInput): string {
  const post = input.text.length > MAX_POST_CHARS ? `${input.text.slice(0, MAX_POST_CHARS)}\n[truncated]` : input.text;
  const lines = [
    `Title: ${input.title}`,
    `Overall: ${input.overall}`,
    "Rule scores (0-100, higher is better, including scam safety):",
    dimensionLine("skill match", input.scores.skillMatch.score, input.scores.skillMatch.reasons),
    dimensionLine("budget", input.scores.budget.score, input.scores.budget.reasons),
    dimensionLine("client signals", input.scores.clientSignals.score, input.scores.clientSignals.reasons),
    dimensionLine("scope clarity", input.scores.scopeClarity.score, input.scores.scopeClarity.reasons),
    dimensionLine("scam safety", input.scores.scamSafety.score, input.scores.scamSafety.reasons),
    "",
    "Job post:",
    "---",
    post,
    "---",
  ];
  return lines.join("\n");
}

function dimensionLine(label: string, score: number, reasons: string[]): string {
  return `- ${label}: ${score}. ${reasons.join(" ")}`;
}

function readSummary(payload: unknown): string {
  const content = readContent(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch {
    throw new LlmError("Model response did not contain a JSON object.");
  }
  if (!isRecord(parsed) || typeof parsed.summary !== "string") {
    throw new LlmError('Model response did not include a string "summary".');
  }
  const summary = parsed.summary.trim();
  if (!summary) throw new LlmError("Model summary was empty.");
  return summary.length > MAX_SUMMARY_CHARS ? summary.slice(0, MAX_SUMMARY_CHARS) : summary;
}

function readContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new LlmError("LLM response did not include choices.");
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new LlmError("LLM response did not include message content.");
  }
  const content = first.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
    if (text.trim()) return text;
  }
  throw new LlmError("LLM response did not include message content.");
}

function stripFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ? fenced[1].trim() : trimmed;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}
