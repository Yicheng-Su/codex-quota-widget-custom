const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PRICING_PER_MILLION,
  CREDITS_PER_MILLION,
  splitUsage,
  calculateCost,
  calculateCredits,
  aggregateEvents,
  summarize,
  aggregateModels,
  normalizeIndexWindow,
  uniformTickIndices
} = require("../src/renderer/usage-logic");

test("pricing includes 5.6 variants plus GPT-5.5 and GPT-5.4", () => {
  assert.deepEqual(PRICING_PER_MILLION["gpt-5.6-sol"], { input: 5, cachedInput: 0.5, output: 30 });
  assert.deepEqual(PRICING_PER_MILLION["gpt-5.6-terra"], { input: 2.5, cachedInput: 0.25, output: 15 });
  assert.deepEqual(PRICING_PER_MILLION["gpt-5.6-luna"], { input: 1, cachedInput: 0.1, output: 6 });
  assert.deepEqual(PRICING_PER_MILLION["gpt-5.5"], { input: 5, cachedInput: 0.5, output: 30 });
  assert.deepEqual(PRICING_PER_MILLION["gpt-5.4"], { input: 2.5, cachedInput: 0.25, output: 15 });
});

test("Codex credits use the official rate card and 2500 credits corresponds to 100 dollars", () => {
  assert.deepEqual(CREDITS_PER_MILLION["gpt-5.6-terra"], { input: 62.5, cachedInput: 6.25, output: 375 });
  assert.deepEqual(CREDITS_PER_MILLION["gpt-5.6-luna"], { input: 25, cachedInput: 2.5, output: 150 });
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 200_000 };
  assert.ok(Math.abs(calculateCredits("gpt-5.6-sol", usage) - calculateCost("gpt-5.6-sol", usage) * 25) < 1e-9);
  assert.ok(Math.abs(calculateCredits("gpt-5.6-terra", usage) - calculateCost("gpt-5.6-terra", usage) * 25) < 1e-9);
});

test("official three token categories are mutually exclusive", () => {
  assert.deepEqual(splitUsage({ inputTokens: 1000, cachedInputTokens: 650, outputTokens: 400 }), {
    uncachedInput: 350, cachedInput: 650,
    input: 1000, output: 400, total: 1400
  });
});

test("reasoning output is not charged twice", () => {
  const usage = { inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 200_000, reasoningOutputTokens: 150_000 };
  assert.equal(calculateCost("gpt-5.6-sol", usage), 9.2);
  assert.equal(calculateCost("gpt-5.4", usage), 4.6);
});

test("aggregation counts one model event as one request and uses inclusive local dates", () => {
  const events = [
    { timestamp: "2026-08-01T01:00:00", model: "gpt-5.5", effort: "high", usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 } },
    { timestamp: "2026-08-01T22:00:00", model: "gpt-5.5", effort: "high", usage: { inputTokens: 200, cachedInputTokens: 50, outputTokens: 30 } },
    { timestamp: "2026-08-02T01:00:00", model: "gpt-5.4", effort: "medium", usage: { inputTokens: 999, outputTokens: 1 } }
  ];
  const rows = aggregateEvents(events, "2026-08-01", "2026-08-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 2);
  assert.equal(rows[0].input, 300);
  assert.equal(summarize(rows).output, 50);
});

test("composition can merge every effort into one model total", () => {
  const rows = [
    { model: "gpt-5.6-sol", effort: "high", requests: 2, input: 100, output: 40, total: 140, cachedInput: 20, uncachedInput: 80, cost: 0.1 },
    { model: "gpt-5.6-sol", effort: "ultra", requests: 3, input: 200, output: 60, total: 260, cachedInput: 50, uncachedInput: 150, cost: 0.2 },
    { model: "gpt-5.4", effort: "high", requests: 1, input: 50, output: 10, total: 60, cachedInput: 0, uncachedInput: 50, cost: 0.02 }
  ];
  const models = aggregateModels(rows);
  const sol = models.find((item) => item.model === "gpt-5.6-sol");
  assert.equal(sol.summary.requests, 5);
  assert.equal(sol.summary.total, 400);
  assert.equal(sol.summary.output, 100);
  assert.deepEqual(sol.efforts.map((item) => item.effort).sort(), ["high", "ultra"]);
});

test("time windows stay between seven days and one year", () => {
  assert.deepEqual(normalizeIndexWindow(20, 21, 500), { start: 20, end: 26, days: 7 });
  assert.deepEqual(normalizeIndexWindow(10, 499, 500), { start: 10, end: 374, days: 365 });
  assert.deepEqual(normalizeIndexWindow(0, 4, 5), { start: 0, end: 4, days: 5 });
});

test("date ticks use a constant day interval and show every day in a week", () => {
  assert.deepEqual(uniformTickIndices(7, 728, 64), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(uniformTickIndices(31, 320, 64), [0, 8, 16, 24]);
});

test("models without a public API price remain visible but are marked unpriced", () => {
  const rows = aggregateEvents([
    { timestamp: "2026-08-01T10:00:00", model: "codex-auto-review", effort: "unknown", usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 } }
  ], "2026-08-01", "2026-08-01");
  const summary = summarize(rows);
  assert.equal(summary.requests, 1);
  assert.equal(summary.pricedRequests, 0);
  assert.equal(summary.unpricedRequests, 1);
  assert.equal(summary.cost, 0);
  assert.equal(summary.credits, 0);
});
