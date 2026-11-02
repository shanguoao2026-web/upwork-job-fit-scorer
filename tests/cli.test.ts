import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/cli.js";
import { fixedNow, root } from "./root.js";

const cli = join(root, "dist/src/cli.js");

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp" },
    timeout: 15000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("cli", () => {
  it("prints help and version without reading a profile", () => {
    const help = runCli(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--input/);
    assert.match(help.stdout, /--profile/);
    assert.match(help.stdout, /--llm/);
    assert.match(help.stdout, /skill match/);
    assert.match(help.stdout, /budget vs floor/);
    assert.match(help.stdout, /client signals/);
    assert.match(help.stdout, /scope clarity/);
    assert.match(help.stdout, /scam safety/);
    assert.match(help.stdout, /Telegram/);
    assert.match(help.stdout, /Examples:/);
    assert.equal(help.stderr, "");

    const version = runCli(["--version"]);
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), "upwork-job-fit-scorer 1.0.0");
  });

  it("scores the fixture folder with no API key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-cli-"));
    try {
      const result = runCli([
        "--input",
        "fixtures/jobs",
        "--profile",
        "fixtures/profile.yaml",
        "--output",
        dir,
        "--format",
        "both",
      ]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Wrote 6 job\(s\)/);
      const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        mode: string;
        jobCount: number;
        jobs: Array<{ title: string; overall: number; recommendation: string; source: string }>;
      };
      assert.equal(report.mode, "rules");
      assert.equal(report.jobCount, 6);
      assert.equal(report.jobs[0]?.overall, 100);
      assert.equal(report.jobs[0]?.recommendation, "apply");
      assert.match(report.jobs[0]?.title ?? "", /Northwind Studio/);
      assert.match(report.jobs[4]?.source ?? "", /telegram-crypto-scam/);
      assert.equal(report.jobs[4]?.recommendation, "skip");
      assert.match(report.jobs[5]?.source ?? "", /fake-check/);
      const markdown = await readFile(join(dir, "report.md"), "utf8");
      assert.match(markdown, /Scam safety/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns exit code 2 for bad arguments and a bad profile", async () => {
    const missing = runCli(["--input", "fixtures/jobs"]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /--profile/);

    const unknown = runCli(["--nope"]);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown option/);

    const format = runCli(["-i", "fixtures/jobs", "-p", "fixtures/profile.yaml", "--format", "xml"]);
    assert.equal(format.status, 2);
    assert.match(format.stderr, /--format/);

    const score = runCli(["-i", "fixtures/jobs", "-p", "fixtures/profile.yaml", "--min-score", "-1"]);
    assert.equal(score.status, 2);
    assert.match(score.stderr, /min-score/);

    const dir = await mkdtemp(join(tmpdir(), "ujfs-bad-profile-"));
    try {
      const profile = join(dir, "bad.yaml");
      await writeFile(profile, "skills: []\nhourly_floor: 10\n", "utf8");
      const bad = runCli(["-i", "fixtures/jobs", "-p", profile, "-o", join(dir, "out")]);
      assert.equal(bad.status, 2);
      assert.match(bad.stderr, /skills/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops --llm before any request when the key is missing", async () => {
    let called = false;
    const stderr: string[] = [];
    const code = await main(
      ["node", "upwork-job-fit-scorer", "-i", "fixtures/jobs", "-p", "fixtures/profile.yaml", "--llm"],
      {
        cwd: root,
        env: {},
        now: fixedNow,
        stderr: (line) => stderr.push(line),
        stdout: () => undefined,
        fetchImpl: async () => {
          called = true;
          throw new Error("network");
        },
      },
    );
    assert.equal(code, 3);
    assert.equal(called, false);
    assert.match(stderr.join("\n"), /OPENAI_API_KEY/);
  });

  it("writes a model note through main when fetch is stubbed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-cli-llm-"));
    try {
      const stdout: string[] = [];
      const code = await main(
        ["node", "cli", "-i", join(root, "fixtures/jobs/vague-unpaid.txt"), "-p", join(root, "fixtures/profile.yaml"), "-o", dir, "--llm"],
        {
          cwd: root,
          now: fixedNow,
          env: { OPENAI_API_KEY: "sk-test", OPENAI_BASE_URL: "http://llm.test/v1" },
          stdout: (line) => stdout.push(line),
          stderr: () => undefined,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({ choices: [{ message: { content: '{"summary":"Skip this one."}' } }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        },
      );
      assert.equal(code, 0);
      assert.match(stdout.join("\n"), /Wrote 1 job/);
      const report = JSON.parse(await readFile(join(dir, "report.json"), "utf8")) as {
        mode: string;
        jobs: Array<{ llmSummary: string; scores: { scamSafety: { score: number } } }>;
      };
      assert.equal(report.mode, "rules+llm");
      assert.equal(report.jobs[0]?.llmSummary, "Skip this one.");
      assert.equal(report.jobs[0]?.scores.scamSafety.score, 80);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
