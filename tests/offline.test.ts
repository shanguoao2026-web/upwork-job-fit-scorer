import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { root } from "./root.js";

describe("offline boundaries", () => {
  it("keeps network calls inside the optional LLM client", () => {
    const srcDir = join(root, "src");
    const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
    assert.ok(files.includes("llm.ts"));
    let combined = "";
    for (const name of files) {
      const text = readFileSync(join(srcDir, name), "utf8");
      combined += `\n${text}`;
      if (name !== "llm.ts") {
        assert.doesNotMatch(text, /\bfetch\s*\(/, `${name} should not call fetch`);
      }
    }
    assert.match(readFileSync(join(srcDir, "llm.ts"), "utf8"), /\bfetch\s*\(/);
    assert.doesNotMatch(combined, /https?:\/\/[^\s"'`]*upwork\.com/i);
  });

  it("does not put live personal contact details in the fixtures", () => {
    const profile = readFileSync(join(root, "fixtures/profile.yaml"), "utf8");
    assert.match(profile, /Jordan Hale/);
    const jobsDir = join(root, "fixtures/jobs");
    const jobs = readdirSync(jobsDir).filter((name) => name.endsWith(".txt"));
    assert.equal(jobs.length, 6);
    const blob = jobs.map((name) => readFileSync(join(jobsDir, name), "utf8")).join("\n");
    assert.match(blob, /example\.com/);
    assert.doesNotMatch(blob, /@(?!example\.com)\S+\.\S+/);
    assert.doesNotMatch(blob, /https?:\/\/(?!example\.com|wa\.me|t\.me)\S+/);
  });
});
