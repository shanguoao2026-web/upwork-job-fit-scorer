import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createLlmClient } from "../src/llm.js";
import { parseProfile } from "../src/profile.js";
import { run } from "../src/run.js";
import { scoreJob } from "../src/score.js";
import type { LlmJobInput } from "../src/llm.js";
import { fixedNow, root } from "./root.js";

const profile = parseProfile("name: Jordan Hale\nskills: [TypeScript]\nhourly_floor: 50\n");
const scored = scoreJob(profile, {
  source: "one.txt",
  text: "Title: Typed API\n\nBuild a TypeScript service. Hourly: $80/hr.\n",
  now: fixedNow,
});

const input: LlmJobInput = {
  title: scored.title,
  text: scored.text,
  overall: scored.overall,
  scores: scored.scores,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chat(content: unknown, status = 200): Response {
  return jsonResponse({ choices: [{ message: { content } }] }, status);
}

describe("llm client", () => {
  it("does not call fetch when the API key is missing", async () => {
    let called = false;
    const client = createLlmClient({
      env: {},
      fetchImpl: async () => {
        called = true;
        return chat('{"summary":"nope"}');
      },
    });
    await assert.rejects(() => client.annotate(input), /OPENAI_API_KEY/);
    assert.equal(called, false);
  });

  it("rejects a non-http base URL before fetch", async () => {
    let called = false;
    const client = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "file:///tmp/model" },
      fetchImpl: async () => {
        called = true;
        return chat('{"summary":"nope"}');
      },
    });
    await assert.rejects(() => client.annotate(input), /http/);
    assert.equal(called, false);
  });

  it("posts to the chat completions endpoint and parses a fenced summary", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const client = createLlmClient({
      env: {
        OPENAI_API_KEY: "sk-test-secret-value",
        OPENAI_BASE_URL: "http://llm.test/v1/",
        OPENAI_MODEL: "fixture-model",
      },
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return chat('```json\n{"summary":"Worth a careful read."}\n```');
      },
    });
    const note = await client.annotate(input);
    assert.equal(note.summary, "Worth a careful read.");
    assert.equal(seen.length, 1);
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.url, "http://llm.test/v1/chat/completions");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), "Bearer sk-test-secret-value");
    assert.equal(call.init.redirect, "error");
    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      temperature: number;
      messages: Array<{ content: string }>;
    };
    assert.equal(body.model, "fixture-model");
    assert.equal(body.temperature, 0);
    assert.match(body.messages[1]?.content ?? "", /Typed API/);
    assert.match(body.messages[1]?.content ?? "", /scam safety/);
    assert.doesNotMatch(JSON.stringify(body), /sk-test-secret-value/);
  });

  it("reads summary text from an array of content parts", async () => {
    const client = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://llm.test/v1" },
      fetchImpl: async () => chat([{ type: "text", text: '{"summary":"Array note."}' }]),
    });
    const note = await client.annotate(input);
    assert.equal(note.summary, "Array note.");
  });

  it("hides the API key when the transport throws", async () => {
    const client = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test-secret-value", OPENAI_BASE_URL: "http://llm.test/v1" },
      fetchImpl: async () => {
        throw new Error("connect failed for sk-test-secret-value");
      },
    });
    await assert.rejects(() => client.annotate(input), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /LLM request failed/);
      assert.doesNotMatch(error.message, /sk-test-secret-value/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    });
  });

  it("reports HTTP failures without reading a success summary", async () => {
    const client = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test-secret-value", OPENAI_BASE_URL: "http://llm.test/v1" },
      fetchImpl: async () => jsonResponse({ error: "no" }, 401),
    });
    await assert.rejects(() => client.annotate(input), /HTTP 401/);
  });

  it("rejects an empty summary and non-JSON content", async () => {
    const empty = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://llm.test/v1" },
      fetchImpl: async () => chat('{"summary":"  "}'),
    });
    await assert.rejects(() => empty.annotate(input), /empty/);
    const broken = createLlmClient({
      env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://llm.test/v1" },
      fetchImpl: async () => chat("not json"),
    });
    await assert.rejects(() => broken.annotate(input), /JSON object/);
  });
});

describe("run with a stubbed model", () => {
  it("does not call fetch in rules mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-rules-"));
    let called = false;
    try {
      const result = await run({
        inputPath: join(root, "fixtures/jobs/api-dashboard.txt"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        now: fixedNow,
        cwd: root,
        env: { OPENAI_API_KEY: "sk-should-not-be-used" },
        fetchImpl: async () => {
          called = true;
          throw new Error("network");
        },
      });
      assert.equal(called, false);
      assert.equal(result.report.mode, "rules");
      assert.equal(result.report.jobs[0]?.llmSummary, null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("attaches the model note without changing scores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-llm-"));
    const rulesDir = await mkdtemp(join(tmpdir(), "ujfs-llm-rules-"));
    try {
      const rules = await run({
        inputPath: join(root, "fixtures/jobs"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: rulesDir,
        now: fixedNow,
        cwd: root,
      });
      const withModel = await run({
        inputPath: join(root, "fixtures/jobs"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        now: fixedNow,
        cwd: root,
        useLlm: true,
        env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://llm.test/v1", OPENAI_MODEL: "fixture-model" },
        fetchImpl: async () => chat('{"summary":"Rules still decide."}'),
      });
      assert.equal(withModel.report.mode, "rules+llm");
      assert.equal(withModel.report.jobs.length, rules.report.jobs.length);
      for (const [index, job] of withModel.report.jobs.entries()) {
        const baseline = rules.report.jobs[index];
        assert.ok(baseline);
        assert.equal(job.overall, baseline.overall);
        assert.equal(job.scores.skillMatch.score, baseline.scores.skillMatch.score);
        assert.equal(job.scores.budget.score, baseline.scores.budget.score);
        assert.equal(job.scores.scamSafety.score, baseline.scores.scamSafety.score);
        assert.equal(job.llmSummary, "Rules still decide.");
      }
      const markdown = await readFile(join(dir, "report.md"), "utf8");
      assert.match(markdown, /Model note/);
      assert.match(markdown, /Rules still decide/);
      const json = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        mode: string;
        jobs: Array<{ llmSummary: string }>;
      };
      assert.equal(json.mode, "rules+llm");
      assert.equal(json.jobs[0]?.llmSummary, "Rules still decide.");
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(rulesDir, { recursive: true, force: true });
    }
  });
});
