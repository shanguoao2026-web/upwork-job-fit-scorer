import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { UserError } from "../src/errors.js";
import { DEFAULT_WEIGHTS, loadProfile, parseProfile } from "../src/profile.js";
import { root } from "./root.js";

describe("profile", () => {
  it("loads the fictional fixture", () => {
    const profile = loadProfile(join(root, "fixtures/profile.yaml"));
    assert.equal(profile.name, "Jordan Hale");
    assert.equal(profile.title, "Full-stack TypeScript developer");
    assert.equal(profile.hourlyFloor, 55);
    assert.equal(profile.referenceHours, 10);
    assert.equal(profile.currency, "USD");
    assert.deepEqual(
      profile.skills.map((skill) => skill.name),
      ["TypeScript", "Node.js", "PostgreSQL", "React"],
    );
    assert.deepEqual(profile.skills[0]?.aliases, ["ts"]);
    assert.deepEqual(profile.skills[1]?.aliases, ["node", "nodejs"]);
    assert.deepEqual(profile.redFlags, ["kindly do the needful", "send a copy of your id"]);
    assert.deepEqual(profile.weights, DEFAULT_WEIGHTS);
  });

  it("uppercases a currency code and fills defaults", () => {
    const profile = parseProfile("skills:\n  - Go\nhourly_floor: 40\ncurrency: eur\n");
    assert.equal(profile.currency, "EUR");
    assert.equal(profile.referenceHours, 10);
    assert.equal(profile.name, null);
    assert.deepEqual(profile.redFlags, []);
  });

  it("accepts custom weights that sum to 1", () => {
    const profile = parseProfile(`
skills: [TypeScript]
hourly_floor: 10
weights:
  skill_match: 1
  budget: 0
  client_signals: 0
  scope_clarity: 0
  scam_safety: 0
`);
    assert.equal(profile.weights.skillMatch, 1);
    assert.equal(profile.weights.budget, 0);
  });

  it("rejects an empty skills list", () => {
    assert.throws(() => parseProfile("skills: []\nhourly_floor: 10\n"), UserError);
  });

  it("rejects a non-positive floor", () => {
    assert.throws(() => parseProfile("skills: [Go]\nhourly_floor: 0\n"), /hourly_floor/);
  });

  it("rejects a string floor", () => {
    assert.throws(() => parseProfile('skills: [Go]\nhourly_floor: "50"\n'), /hourly_floor/);
  });

  it("rejects weights that do not sum to 1", () => {
    assert.throws(
      () =>
        parseProfile(`
skills: [Go]
hourly_floor: 10
weights:
  skill_match: 0.5
  budget: 0.5
  client_signals: 0.5
  scope_clarity: 0
  scam_safety: 0
`),
      /sum to 1/,
    );
  });

  it("rejects an unknown top-level key", () => {
    assert.throws(() => parseProfile("skills: [Go]\nhourly_floor: 10\nemail: a@example.com\n"), /unknown key/);
  });

  it("rejects a duplicate skill", () => {
    assert.throws(() => parseProfile("skills: [React, react]\nhourly_floor: 10\n"), /more than once/);
  });

  it("rejects a short red-flag phrase", () => {
    assert.throws(() => parseProfile("skills: [Go]\nhourly_floor: 10\nred_flags: [id]\n"), /at least 3/);
  });

  it("rejects a bad currency code", () => {
    assert.throws(() => parseProfile("skills: [Go]\nhourly_floor: 10\ncurrency: dollars\n"), /currency/);
  });

  it("rejects a skill mapping with an unknown field", () => {
    assert.throws(
      () => parseProfile("skills:\n  - name: Go\n    level: expert\nhourly_floor: 10\n"),
      /unknown key/,
    );
  });

  it("rejects a missing profile path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-profile-"));
    assert.throws(() => loadProfile(join(dir, "missing.yaml")), /Profile not found/);
  });

  it("rejects a directory passed as the profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ujfs-profile-dir-"));
    await writeFile(join(dir, "note.txt"), "skills: [Go]\n", "utf8");
    assert.throws(() => loadProfile(dir), /not a file/);
  });

  it("wraps invalid YAML", () => {
    assert.throws(() => parseProfile("skills: [\n"), /Could not parse/);
  });
});
