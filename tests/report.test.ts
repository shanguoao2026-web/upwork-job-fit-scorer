import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { run } from "../src/run.js";
import { fixedNow, root } from "./root.js";

describe("report", () => {
  it("writes a ranked markdown and JSON report for the fixtures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-report-"));
    try {
      const result = await run({
        inputPath: join(root, "fixtures/jobs"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        now: fixedNow,
        cwd: root,
      });
      assert.equal(result.report.generatedAt, "2026-11-02T00:00:00.000Z");
      assert.equal(result.report.mode, "rules");
      assert.equal(result.report.tool, "upwork-job-fit-scorer");
      assert.equal(result.report.toolVersion, "1.0.0");
      assert.equal(result.report.jobCount, 6);
      assert.equal(result.report.shownCount, 6);
      assert.equal(result.report.hiddenByMinScore, 0);
      assert.equal(result.report.quarantinedCount, 2);
      assert.equal(result.report.profile.hourlyFloor, 55);
      assert.deepEqual(
        result.report.jobs.map((job) => job.rank),
        [1, 2, 3, 4, 5, 6],
      );
      assert.equal(result.report.jobs[0]?.recommendation, "apply");
      assert.match(result.report.jobs[0]?.source ?? "", /api-dashboard\.txt$/);
      assert.equal(result.report.jobs[4]?.quarantined, true);
      assert.equal(result.report.jobs[5]?.quarantined, true);
      for (const job of result.report.jobs) {
        for (const dimension of Object.values(job.scores)) {
          assert.equal(Number.isInteger(dimension.score), true);
          assert.ok(dimension.score >= 0 && dimension.score <= 100);
          assert.ok(dimension.reasons.length > 0);
        }
      }

      const markdown = await readFile(join(dir, "report.md"), "utf8");
      const jsonText = await readFile(join(dir, "report.json"), "utf8");
      assert.match(markdown, /# Job fit report/);
      assert.match(markdown, /Jordan Hale/);
      assert.match(markdown, /Skill match/);
      assert.match(markdown, /Budget vs floor/);
      assert.match(markdown, /Client signals/);
      assert.match(markdown, /Scope clarity/);
      assert.match(markdown, /Scam safety/);
      assert.match(markdown, /Build an internal analytics API for Northwind Studio — 100\/100 — apply/);
      assert.match(markdown, /listed after safer posts/);
      const parsed = JSON.parse(jsonText) as { jobs: Array<{ summary: string }> };
      assert.match(parsed.jobs[0]?.summary ?? "", /^Apply\./);
      assert.equal(jsonText.endsWith("\n"), true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hides jobs under the minimum score", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-min-"));
    try {
      const result = await run({
        inputPath: join(root, "fixtures/jobs"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        minScore: 100,
        now: fixedNow,
        cwd: root,
        format: "json",
      });
      assert.equal(result.report.shownCount, 1);
      assert.equal(result.report.hiddenByMinScore, 5);
      assert.match(result.report.jobs[0]?.source ?? "", /api-dashboard\.txt$/);
      await assert.rejects(readFile(join(dir, "report.md"), "utf8"));
      const json = await readFile(join(dir, "report.json"), "utf8");
      assert.match(json, /Northwind Studio/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can write markdown only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-md-"));
    try {
      const result = await run({
        inputPath: join(root, "fixtures/jobs/below-floor.txt"),
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        format: "md",
        now: fixedNow,
        cwd: root,
      });
      assert.equal(result.outputPaths.length, 1);
      assert.match(result.outputPaths[0] ?? "", /report\.md$/);
      await assert.rejects(readFile(join(dir, "report.json"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores a generated report.md on a second run in the same folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-rerun-"));
    try {
      await writeFile(join(dir, "real-job.txt"), "TypeScript API\nHourly: $80/hr\n", "utf8");
      const first = await run({
        inputPath: dir,
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        now: fixedNow,
        cwd: root,
      });
      const second = await run({
        inputPath: dir,
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: dir,
        now: fixedNow,
        cwd: root,
      });
      assert.equal(first.report.jobCount, 1);
      assert.equal(second.report.jobCount, 1);
      assert.doesNotMatch(second.report.jobs[0]?.title ?? "", /Job fit report/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores nested files, hidden files, and non-text files in a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-nested-"));
    try {
      await mkdir(join(dir, "nested"));
      await writeFile(join(dir, "nested/hidden-job.txt"), "TypeScript\n", "utf8");
      await writeFile(join(dir, ".secret.txt"), "TypeScript\n", "utf8");
      await writeFile(join(dir, "notes.yaml"), "skills: [Go]\n", "utf8");
      await writeFile(join(dir, "Note.MD"), "# Markdown post\n\nTypeScript work.\n", "utf8");
      const result = await run({
        inputPath: dir,
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: join(dir, "out"),
        now: fixedNow,
        cwd: root,
      });
      assert.equal(result.report.jobCount, 1);
      assert.equal(result.report.jobs[0]?.title, "Markdown post");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a single file with no extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-one-"));
    try {
      const file = join(dir, "pasted-post");
      await writeFile(file, "Title: One file\n\nReact form. $30/hr.\n", "utf8");
      const result = await run({
        inputPath: file,
        profilePath: join(root, "fixtures/profile.yaml"),
        outputDir: join(dir, "out"),
        now: fixedNow,
        cwd: root,
      });
      assert.equal(result.report.jobCount, 1);
      assert.equal(result.report.jobs[0]?.title, "One file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when a directory has no job posts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-empty-"));
    try {
      await assert.rejects(
        () =>
          run({
            inputPath: dir,
            profilePath: join(root, "fixtures/profile.yaml"),
            outputDir: join(dir, "out"),
            now: fixedNow,
          }),
        /No \.txt or \.md job posts/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
