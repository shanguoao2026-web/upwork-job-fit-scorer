import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBudget, extractClient, extractHours, extractTitle } from "../src/extract.js";

describe("extract", () => {
  it("reads an hourly range with a slash", () => {
    const budget = extractBudget("Hourly rate: $75 - $95/hr");
    assert.equal(budget?.kind, "hourly");
    assert.equal(budget?.min, 75);
    assert.equal(budget?.max, 95);
    assert.equal(budget?.assumed, false);
  });

  it("reads a single hourly rate", () => {
    const budget = extractBudget("Pay is $40 per hour.");
    assert.deepEqual(budget && { kind: budget.kind, min: budget.min, max: budget.max }, {
      kind: "hourly",
      min: 40,
      max: 40,
    });
  });

  it("reads an en dash as a hyphen", () => {
    const budget = extractBudget("Rate $40\u2013$60/hr");
    assert.equal(budget?.min, 40);
    assert.equal(budget?.max, 60);
    assert.equal(budget?.kind, "hourly");
  });

  it("reads a labeled hourly range without per-hour wording", () => {
    const budget = extractBudget("Hourly: $40 - $60");
    assert.equal(budget?.kind, "hourly");
    assert.equal(budget?.min, 40);
    assert.equal(budget?.max, 60);
  });

  it("reads an Upwork-style amount above a standalone Hourly line", () => {
    const budget = extractBudget("$60.00 - $80.00\n\nHourly\n");
    assert.equal(budget?.kind, "hourly");
    assert.equal(budget?.min, 60);
    assert.equal(budget?.max, 80);
  });

  it("reads a labeled fixed budget and ignores client spend", () => {
    const budget = extractBudget("Payment method verified\n$12,000 spent\nBudget: $2200\nThe work is about 20 hours.\n");
    assert.equal(budget?.kind, "fixed");
    assert.equal(budget?.min, 2200);
    assert.equal(budget?.max, 2200);
    assert.equal(budget?.hours, 20);
    assert.equal(budget?.assumed, false);
  });

  it("reads Est. budget with cents", () => {
    const budget = extractBudget("Est. budget: $1,200.00");
    assert.equal(budget?.kind, "fixed");
    assert.equal(budget?.min, 1200);
  });

  it("reads a fixed amount above a standalone Fixed-price line", () => {
    const budget = extractBudget("$500.00\n\nFixed-price\n");
    assert.equal(budget?.kind, "fixed");
    assert.equal(budget?.min, 500);
    assert.equal(budget?.assumed, false);
  });

  it("prefers hourly when both an hourly block and a fixed block are present", () => {
    const budget = extractBudget("$40 - $60\n\nHourly\n\n$500\n\nFixed-price\n");
    assert.equal(budget?.kind, "hourly");
    assert.equal(budget?.min, 40);
    assert.equal(budget?.max, 60);
  });

  it("does not treat $25K+ spent as the budget", () => {
    const budget = extractBudget("Rating: 4.9\n$25K+ spent\nHourly rate: $80/hr\n");
    assert.equal(budget?.kind, "hourly");
    assert.equal(budget?.min, 80);
    assert.equal(extractClient("$25K+ spent").totalSpent, 25000);
  });

  it("treats an unlabeled dollar amount as an assumed fixed budget", () => {
    const budget = extractBudget("The retainer is $500 for the drawings.");
    assert.equal(budget?.kind, "fixed");
    assert.equal(budget?.min, 500);
    assert.equal(budget?.assumed, true);
  });

  it("treats an unlabeled dollar range as a fixed range", () => {
    const budget = extractBudget("They mentioned $500 - $800 and nothing else.");
    assert.equal(budget?.kind, "fixed");
    assert.equal(budget?.min, 500);
    assert.equal(budget?.max, 800);
    assert.equal(budget?.assumed, true);
  });

  it("returns null when no amount is present", () => {
    assert.equal(extractBudget("We should talk about the work."), null);
  });

  it("reads an hour range and ignores a reply window", () => {
    assert.equal(extractHours("This should take 10-15 hours. Please reply within 24 hours."), 12.5);
    assert.equal(extractHours("Please reply within 24 hours."), null);
    assert.equal(extractHours("Expected 8 hours of work."), 8);
  });

  it("reads client badges", () => {
    const facts = extractClient(
      "Payment method verified\nRating: 4.95\n$10K+ spent\n18 hires\nMember since March 2018\nThis is a long-term role.\n",
    );
    assert.equal(facts.paymentVerified, true);
    assert.equal(facts.rating, 4.95);
    assert.equal(facts.totalSpent, 10000);
    assert.equal(facts.hires, 18);
    assert.equal(facts.memberSinceYear, 2018);
    assert.equal(facts.longTerm, true);
  });

  it("reads unverified payment, zero hires, and plain spend", () => {
    const facts = extractClient("Payment method not verified\n0 hires\nSpent: $1,200\nRating 3.2/5\n");
    assert.equal(facts.paymentVerified, false);
    assert.equal(facts.hires, 0);
    assert.equal(facts.totalSpent, 1200);
    assert.equal(facts.rating, 3.2);
    assert.equal(facts.longTerm, false);
  });

  it("reads a fractional thousands spend", () => {
    assert.equal(extractClient("$4.5K spent").totalSpent, 4500);
  });

  it("does not treat the word verified inside 'not verified' as verified", () => {
    assert.equal(extractClient("Payment unverified").paymentVerified, false);
  });

  it("reads a title from the first line, a label, or a heading", () => {
    assert.equal(extractTitle("# Build a portal\n\nDetails"), "Build a portal");
    assert.equal(extractTitle("Title: Data entry clerk\n\nBody"), "Data entry clerk");
    assert.equal(extractTitle("   \n\n"), "Untitled job");
    assert.equal(extractTitle(`${"A".repeat(200)}\n`), `${"A".repeat(117)}...`);
  });
});
