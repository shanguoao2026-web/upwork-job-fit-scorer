import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadProfile } from "../src/profile.js";
import { rankJobs, scoreJob } from "../src/score.js";
import type { ScoredJob } from "../src/types.js";
import { fixedNow, root } from "./root.js";

const profile = loadProfile(join(root, "fixtures/profile.yaml"));

function job(name: string): ScoredJob {
  const text = readFileSync(join(root, "fixtures/jobs", name), "utf8");
  return scoreJob(profile, { source: name, text, now: fixedNow });
}

describe("fictional fixtures", () => {
  it("scores the Northwind post as a clean apply", () => {
    const scored = job("api-dashboard.txt");
    assert.equal(scored.title, "Build an internal analytics API for Northwind Studio");
    assert.equal(scored.scores.skillMatch.score, 100);
    assert.deepEqual(scored.matchedSkills, ["TypeScript", "Node.js", "PostgreSQL", "React"]);
    assert.equal(scored.budget?.kind, "hourly");
    assert.equal(scored.budget?.min, 75);
    assert.equal(scored.budget?.max, 95);
    assert.equal(scored.scores.budget.score, 100);
    assert.match(scored.scores.budget.reasons[0] ?? "", /USD 75-USD 95\/hr/);
    assert.equal(scored.scores.clientSignals.score, 100);
    assert.equal(scored.client.totalSpent, 25000);
    assert.equal(scored.scores.scopeClarity.score, 100);
    assert.equal(scored.scores.scamSafety.score, 100);
    assert.equal(scored.overall, 100);
    assert.equal(scored.recommendation, "apply");
    assert.equal(scored.scores.skillMatch.reasons.length > 0, true);
    assert.equal(scored.scores.clientSignals.reasons.length > 0, true);
    assert.equal(scored.scores.scopeClarity.reasons.length > 0, true);
  });

  it("scores the fixed-price Brightlane post from the implied hourly rate", () => {
    const scored = job("fixed-price-clear.txt");
    assert.equal(scored.scores.skillMatch.score, 75);
    assert.deepEqual(scored.missingSkills, ["React"]);
    assert.equal(scored.budget?.hours, 20);
    assert.equal(scored.budget?.min, 2200);
    assert.equal(scored.scores.budget.score, 100);
    assert.match(scored.scores.budget.reasons[0] ?? "", /20 hours/);
    assert.match(scored.scores.budget.reasons[0] ?? "", /USD 110\/hr/);
    assert.equal(scored.scores.clientSignals.score, 100);
    assert.equal(scored.scores.scamSafety.score, 100);
    assert.equal(scored.recommendation, "apply");
    assert.ok(scored.overall < 100);
  });

  it("scores the below-floor React post as a review", () => {
    const scored = job("below-floor.txt");
    assert.equal(scored.scores.skillMatch.score, 50);
    assert.deepEqual(scored.matchedSkills, ["TypeScript", "React"]);
    assert.equal(scored.budget?.min, 40);
    assert.equal(scored.scores.budget.score, 58);
    assert.equal(scored.scores.clientSignals.score, 82);
    assert.equal(scored.scores.scamSafety.score, 100);
    assert.equal(scored.recommendation, "review");
  });

  it("scores the telegram and crypto post as a quarantined skip", () => {
    const scored = job("telegram-crypto-scam.txt");
    assert.equal(scored.scores.skillMatch.score, 100);
    assert.equal(scored.scores.budget.score, 100);
    assert.equal(scored.scores.clientSignals.score, 50);
    assert.equal(scored.scores.scamSafety.score, 0);
    assert.deepEqual(scored.scamHits, [
      "Asks you to pay to start",
      "Asks for Telegram contact",
      "Mentions crypto payment",
      "Profile red-flag phrase: kindly do the needful",
    ]);
    assert.equal(scored.recommendation, "skip");
  });

  it("scores the vague unpaid post as a skip that is not quarantined", () => {
    const scored = job("vague-unpaid.txt");
    assert.equal(scored.scores.skillMatch.score, 0);
    assert.equal(scored.scores.budget.score, 40);
    assert.equal(scored.scores.scamSafety.score, 80);
    assert.deepEqual(scored.scamHits, ["Asks for unpaid work"]);
    assert.equal(scored.recommendation, "skip");
  });

  it("scores the fake-check post from off-platform, check, and profile phrases", () => {
    const scored = job("fake-check.txt");
    assert.equal(scored.scores.skillMatch.score, 0);
    assert.equal(scored.budget, null);
    assert.equal(scored.scores.scamSafety.score, 10);
    assert.deepEqual(scored.scamHits, [
      "Asks to move off-platform",
      "Fake-check or overpayment language",
      "Profile red-flag phrase: send a copy of your id",
    ]);
    assert.equal(scored.recommendation, "skip");
  });

  it("ranks safer posts first and quarantines the scam fixtures", () => {
    const names = [
      "telegram-crypto-scam.txt",
      "api-dashboard.txt",
      "vague-unpaid.txt",
      "fake-check.txt",
      "below-floor.txt",
      "fixed-price-clear.txt",
    ];
    const ranked = rankJobs(names.map((name) => job(name)));
    assert.deepEqual(
      ranked.map((item) => item.source),
      [
        "api-dashboard.txt",
        "fixed-price-clear.txt",
        "below-floor.txt",
        "vague-unpaid.txt",
        "telegram-crypto-scam.txt",
        "fake-check.txt",
      ],
    );
    assert.ok((ranked[4]?.overall ?? 0) > (ranked[3]?.overall ?? 0));
    assert.equal(ranked[4]?.recommendation, "skip");
  });
});
