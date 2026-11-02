import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProfile } from "../src/profile.js";
import {
  rankJobs,
  ratioToScore,
  recommend,
  scoreBudget,
  scoreClient,
  scoreJob,
  scoreScam,
  scoreScope,
  scoreSkills,
  skillAppears,
  weightedOverall,
} from "../src/score.js";
import type { ClientFacts, ScoredJob, Skill } from "../src/types.js";
import { fixedNow } from "./root.js";

const now = fixedNow;

function skill(name: string, aliases: string[] = []): Skill {
  return { name, aliases };
}

describe("ratio and budget", () => {
  it("maps pay ratios onto the documented curve", () => {
    assert.equal(ratioToScore(0), 0);
    assert.equal(ratioToScore(-1), 0);
    assert.equal(ratioToScore(Number.NaN), 0);
    assert.equal(ratioToScore(0.25), 20);
    assert.equal(ratioToScore(0.5), 40);
    assert.equal(ratioToScore(0.75), 60);
    assert.equal(ratioToScore(1), 80);
    assert.equal(ratioToScore(1.25), 90);
    assert.equal(ratioToScore(1.5), 100);
    assert.equal(ratioToScore(3), 100);
  });

  it("scores a missing budget at 40", () => {
    const scored = scoreBudget(null, 50, 10, "USD");
    assert.equal(scored.score, 40);
    assert.match(scored.reasons[0] ?? "", /No hourly rate/);
  });

  it("scores an hourly rate at the floor as 80 and 1.5x as 100", () => {
    assert.equal(scoreBudget({ kind: "hourly", min: 50, max: 50, hours: null, assumed: false }, 50, 10, "USD").score, 80);
    assert.equal(scoreBudget({ kind: "hourly", min: 75, max: 75, hours: null, assumed: false }, 50, 10, "USD").score, 100);
    assert.equal(scoreBudget({ kind: "hourly", min: 25, max: 25, hours: null, assumed: false }, 50, 10, "USD").score, 40);
  });

  it("turns a fixed budget plus hours into an implied rate", () => {
    const scored = scoreBudget(
      { kind: "fixed", min: 1000, max: 1000, hours: 10, assumed: false },
      50,
      10,
      "USD",
    );
    assert.equal(scored.score, 100);
    assert.match(scored.reasons[0] ?? "", /10 hours/);
    assert.match(scored.reasons[0] ?? "", /USD 100\/hr/);
  });

  it("compares a fixed budget with no hours to floor times reference hours", () => {
    const atReference = scoreBudget(
      { kind: "fixed", min: 500, max: 500, hours: null, assumed: false },
      50,
      10,
      "USD",
    );
    const small = scoreBudget(
      { kind: "fixed", min: 100, max: 100, hours: null, assumed: true },
      50,
      10,
      "USD",
    );
    assert.equal(atReference.score, 80);
    assert.equal(small.score, 16);
    assert.match(small.reasons[0] ?? "", /Unlabeled amount/);
  });
});

describe("skills", () => {
  it("scores the share of profile skills found in the post", () => {
    const skills = [skill("TypeScript"), skill("Node.js"), skill("PostgreSQL"), skill("React")];
    const scored = scoreSkills(skills, "We need TypeScript and React only.");
    assert.equal(scored.score, 50);
    assert.deepEqual(scored.matched, ["TypeScript", "React"]);
    assert.deepEqual(scored.missing, ["Node.js", "PostgreSQL"]);
  });

  it("matches built-in aliases and keeps word boundaries", () => {
    assert.equal(skillAppears(skill("Node.js"), "We use Node in production."), true);
    assert.equal(skillAppears(skill("Node.js"), "anode"), false);
    assert.equal(skillAppears(skill("TypeScript"), "The file is TS."), true);
    assert.equal(skillAppears(skill("TypeScript"), "its fits"), false);
    assert.equal(skillAppears(skill("JavaScript"), "See the json schema."), false);
    assert.equal(skillAppears(skill("JavaScript"), "Plain js modules."), true);
    assert.equal(skillAppears(skill("PostgreSQL"), "Postgres 16"), true);
    assert.equal(skillAppears(skill("Go"), "we want to go fast"), false);
    assert.equal(skillAppears(skill("Go"), "We need a Go service"), true);
    assert.equal(skillAppears(skill("Go"), "golang service"), true);
  });
});

describe("client signals", () => {
  it("stays at 50 when the paste has no badges", () => {
    const facts: ClientFacts = {
      paymentVerified: null,
      rating: null,
      totalSpent: null,
      hires: null,
      memberSinceYear: null,
      longTerm: false,
    };
    assert.equal(scoreClient(facts, now).score, 50);
  });

  it("reaches 100 for a strong client history", () => {
    const scored = scoreClient(
      {
        paymentVerified: true,
        rating: 4.9,
        totalSpent: 25000,
        hires: 18,
        memberSinceYear: 2018,
        longTerm: true,
      },
      now,
    );
    assert.equal(scored.score, 100);
    assert.match(scored.reasons.join(" "), /\+15/);
    assert.match(scored.reasons.join(" "), /\+7/);
  });

  it("drops for an unverified new client with a weak rating", () => {
    const scored = scoreClient(
      {
        paymentVerified: false,
        rating: 3.2,
        totalSpent: null,
        hires: 0,
        memberSinceYear: null,
        longTerm: false,
      },
      now,
    );
    assert.equal(scored.score, 12);
  });

  it("gives a smaller membership bonus under three years", () => {
    const scored = scoreClient(
      {
        paymentVerified: null,
        rating: null,
        totalSpent: 500,
        hires: 2,
        memberSinceYear: 2024,
        longTerm: false,
      },
      now,
    );
    assert.equal(scored.score, 50 + 4 + 3);
    assert.match(scored.reasons.join(" "), /under 1000/);
  });
});

describe("scope", () => {
  it("scores a one-word post low and a hype line at 0", () => {
    assert.equal(scoreScope("Hi").score, 12);
    assert.equal(scoreScope("Need a rockstar for a simple task").score, 0);
  });

  it("scores a concrete post at 100", () => {
    const text = [
      "A".repeat(600),
      "You will build the service.",
      "Requirements are firm.",
      "- one item here",
      "- two item here",
      "- three item here",
      "Deliverables include a milestone and acceptance criteria.",
      "Timeline: 2 weeks.",
    ].join("\n");
    assert.equal(scoreScope(text).score, 100);
  });
});

describe("scam safety", () => {
  it("leaves ordinary escrow and technical wording alone", () => {
    const text =
      "The first milestone is funded in escrow before work starts. Weekly check-ins are fine. Beth reviewed the Ethernet and cryptography notes.";
    const scored = scoreScam(text, []);
    assert.equal(scored.score, 100);
    assert.deepEqual(scored.hits, []);
  });

  it("penalizes each built-in category once", () => {
    assert.equal(scoreScam("Message me on Telegram", []).score, 70);
    assert.equal(scoreScam("Ping me on WhatsApp", []).score, 70);
    assert.equal(scoreScam("or whats app me", []).score, 70);
    assert.equal(scoreScam("https://wa.me/example", []).score, 70);
    assert.equal(scoreScam("Pay in bitcoin.", []).score, 75);
    assert.equal(scoreScam("We will mail a cashier's check.", []).score, 60);
    assert.equal(scoreScam("Pay a fee before we begin.", []).score, 60);
    assert.equal(scoreScam("Email me directly.", []).score, 65);
    assert.equal(scoreScam("Add me on Skype.", []).score, 65);
    assert.equal(scoreScam("This is unpaid.", []).score, 80);
    assert.equal(scoreScam("Work for exposure only.", []).score, 80);
    assert.equal(scoreScam("You will be reimbursed after you buy a laptop.", []).score, 60);
  });

  it("stacks separate categories and profile phrases", () => {
    const stacked = scoreScam("Pay a fee before kickoff. Telegram. Settle in USDT.", []);
    assert.equal(stacked.score, 5);
    assert.deepEqual(stacked.hits, [
      "Asks you to pay to start",
      "Asks for Telegram contact",
      "Mentions crypto payment",
    ]);
    assert.equal(scoreScam("Kindly do the needful today.", ["kindly do the needful"]).score, 85);
    assert.equal(
      scoreScam("Kindly do the needful and send a copy of your id.", [
        "kindly do the needful",
        "send a copy of your id",
      ]).score,
      70,
    );
  });
});

describe("overall, recommendation, and rank", () => {
  it("rounds the weighted sum and honors a custom weight", () => {
    const scores = {
      skillMatch: { score: 1, reasons: ["a"] },
      budget: { score: 1, reasons: ["b"] },
      clientSignals: { score: 1, reasons: ["c"] },
      scopeClarity: { score: 1, reasons: ["d"] },
      scamSafety: { score: 1, reasons: ["e"] },
    };
    assert.equal(
      weightedOverall(scores, {
        skillMatch: 0.3,
        budget: 0.25,
        clientSignals: 0.15,
        scopeClarity: 0.15,
        scamSafety: 0.15,
      }),
      1,
    );
    const profile = parseProfile(`
skills: [TypeScript]
hourly_floor: 50
weights:
  skill_match: 1
  budget: 0
  client_signals: 0
  scope_clarity: 0
  scam_safety: 0
`);
    const job = scoreJob(profile, { source: "a.txt", text: "TypeScript only. $10/hr.", now });
    assert.equal(job.overall, job.scores.skillMatch.score);
    assert.equal(job.overall, 100);
  });

  it("applies the recommendation bands", () => {
    assert.equal(recommend(80, 100), "apply");
    assert.equal(recommend(75, 100), "apply");
    assert.equal(recommend(74, 100), "review");
    assert.equal(recommend(55, 100), "review");
    assert.equal(recommend(54, 100), "skip");
    assert.equal(recommend(90, 80), "review");
    assert.equal(recommend(40, 80), "skip");
    assert.equal(recommend(99, 49), "skip");
    assert.equal(recommend(99, 50), "review");
  });

  it("lists likely scams after safer posts", () => {
    const profile = parseProfile("skills: [TypeScript]\nhourly_floor: 50\n");
    const safe = scoreJob(profile, { source: "b-safe.txt", text: "Hello there.", now });
    const risky = scoreJob(profile, {
      source: "a-risky.txt",
      text: "TypeScript $200/hr. Pay a fee before you start. Telegram.",
      now,
    });
    assert.ok(risky.overall > safe.overall);
    assert.ok(risky.scores.scamSafety.score < 50);
    const ranked = rankJobs([risky, safe]);
    assert.deepEqual(
      ranked.map((job) => job.source),
      ["b-safe.txt", "a-risky.txt"],
    );
  });

  it("keeps scam safety of 50 with the safer posts and quarantines 49", () => {
    const quarantined = fakeJob("risky.txt", 99, 49);
    const boundary = fakeJob("boundary.txt", 10, 50);
    assert.deepEqual(
      rankJobs([quarantined, boundary]).map((job) => job.source),
      ["boundary.txt", "risky.txt"],
    );
  });
});

function fakeJob(source: string, overall: number, scamSafety: number): ScoredJob {
  const dimension = { score: 0, reasons: ["unused"] };
  return {
    source,
    title: source,
    text: "",
    overall,
    recommendation: "skip",
    summary: "Skip.",
    llmSummary: null,
    scores: {
      skillMatch: dimension,
      budget: dimension,
      clientSignals: dimension,
      scopeClarity: dimension,
      scamSafety: { score: scamSafety, reasons: ["safety"] },
    },
    matchedSkills: [],
    missingSkills: [],
    budget: null,
    client: {
      paymentVerified: null,
      rating: null,
      totalSpent: null,
      hires: null,
      memberSinceYear: null,
      longTerm: false,
    },
    scamHits: [],
  };
}
