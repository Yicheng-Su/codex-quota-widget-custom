(function exposeUsageLogic(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UsageLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createUsageLogic() {
  "use strict";

  const PRICING_PER_MILLION = Object.freeze({
    "gpt-5.6-sol": Object.freeze({ input: 5, cachedInput: 0.5, output: 30 }),
    "gpt-5.6-terra": Object.freeze({ input: 2.5, cachedInput: 0.25, output: 15 }),
    "gpt-5.6-luna": Object.freeze({ input: 1, cachedInput: 0.1, output: 6 }),
    "gpt-5.5": Object.freeze({ input: 5, cachedInput: 0.5, output: 30 }),
    "gpt-5.4": Object.freeze({ input: 2.5, cachedInput: 0.25, output: 15 })
  });
  const CREDITS_PER_MILLION = Object.freeze({
    "gpt-5.6-sol": Object.freeze({ input: 125, cachedInput: 12.5, output: 750 }),
    "gpt-5.6-terra": Object.freeze({ input: 62.5, cachedInput: 6.25, output: 375 }),
    "gpt-5.6-luna": Object.freeze({ input: 25, cachedInput: 2.5, output: 150 }),
    "gpt-5.5": Object.freeze({ input: 125, cachedInput: 12.5, output: 750 }),
    "gpt-5.4": Object.freeze({ input: 62.5, cachedInput: 6.25, output: 375 })
  });

  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function normalizeModel(model) {
    const value = String(model || "unknown").toLowerCase();
    if (value === "gpt-5.6") return "gpt-5.6-sol";
    return value;
  }

  function splitUsage(usage = {}) {
    const input = finiteNonNegative(usage.inputTokens);
    const cachedInput = Math.min(input, finiteNonNegative(usage.cachedInputTokens));
    const output = finiteNonNegative(usage.outputTokens);
    return {
      uncachedInput: input - cachedInput,
      cachedInput,
      input,
      output,
      total: input + output
    };
  }

  function getPricing(model) {
    return PRICING_PER_MILLION[normalizeModel(model)] || null;
  }

  function getCreditPricing(model) {
    return CREDITS_PER_MILLION[normalizeModel(model)] || null;
  }

  function calculateWithRates(rates, usage = {}) {
    if (!rates) return null;
    const parts = splitUsage(usage);
    return (
      parts.uncachedInput * rates.input +
      parts.cachedInput * rates.cachedInput +
      parts.output * rates.output
    ) / 1_000_000;
  }

  function calculateCost(model, usage = {}) {
    return calculateWithRates(getPricing(model), usage);
  }

  function calculateCredits(model, usage = {}) {
    return calculateWithRates(getCreditPricing(model), usage);
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function inDateRange(event, startDate, endDate) {
    const key = localDateKey(event.timestamp);
    return Boolean(key && (!startDate || key >= startDate) && (!endDate || key <= endDate));
  }

  function aggregateEvents(events, startDate, endDate) {
    const groups = new Map();
    for (const event of events || []) {
      if (!inDateRange(event, startDate, endDate)) continue;
      const date = localDateKey(event.timestamp);
      const model = normalizeModel(event.model);
      const effort = String(event.effort || "unknown").toLowerCase();
      const key = `${date}|${model}|${effort}`;
      const usage = splitUsage(event.usage);
      const row = groups.get(key) || {
        date, model, effort, requests: 0, uncachedInput: 0, cachedInput: 0,
        input: 0, output: 0, total: 0, cost: 0, credits: 0,
        pricedRequests: 0
      };
      row.requests += 1;
      for (const field of ["uncachedInput", "cachedInput", "input", "output", "total"]) {
        row[field] += usage[field];
      }
      const cost = calculateCost(model, event.usage);
      const credits = calculateCredits(model, event.usage);
      if (cost !== null && credits !== null) {
        row.cost += cost;
        row.credits += credits;
        row.pricedRequests += 1;
      }
      groups.set(key, row);
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model));
  }

  function summarize(rows) {
    const total = (rows || []).reduce((sum, row) => {
      for (const field of ["requests", "pricedRequests", "uncachedInput", "cachedInput", "input", "output", "total", "cost", "credits"]) {
        sum[field] += finiteNonNegative(row[field]);
      }
      return sum;
    }, { requests: 0, pricedRequests: 0, uncachedInput: 0, cachedInput: 0, input: 0, output: 0, total: 0, cost: 0, credits: 0 });
    total.cacheHitRate = total.input > 0 ? total.cachedInput / total.input : 0;
    total.unpricedRequests = Math.max(0, total.requests - total.pricedRequests);
    return total;
  }

  function aggregateModels(rows) {
    const groups = new Map();
    for (const row of rows || []) {
      const model = normalizeModel(row.model);
      const current = groups.get(model) || { model, rows: [], efforts: new Map() };
      current.rows.push(row);
      const effort = String(row.effort || "unknown").toLowerCase();
      if (!current.efforts.has(effort)) current.efforts.set(effort, []);
      current.efforts.get(effort).push(row);
      groups.set(model, current);
    }
    return [...groups.values()].map((group) => ({
      model: group.model,
      summary: summarize(group.rows),
      efforts: [...group.efforts.entries()].map(([effort, effortRows]) => ({
        effort,
        summary: summarize(effortRows)
      })).sort((a, b) => b.summary.total - a.summary.total)
    })).sort((a, b) => b.summary.total - a.summary.total);
  }

  function normalizeIndexWindow(start, end, total, minDays = 7, maxDays = 365) {
    const count = Math.max(0, Math.floor(finiteNonNegative(total)));
    if (!count) return { start: 0, end: -1, days: 0 };
    const minimum = Math.min(count, Math.max(1, Math.floor(finiteNonNegative(minDays))));
    const maximum = Math.min(count, Math.max(minimum, Math.floor(finiteNonNegative(maxDays))));
    let first = Math.max(0, Math.min(count - 1, Math.floor(Number(start) || 0)));
    let last = Math.max(first, Math.min(count - 1, Math.floor(Number(end) || 0)));
    let days = last - first + 1;
    if (days < minimum) {
      last = Math.min(count - 1, first + minimum - 1);
      first = Math.max(0, last - minimum + 1);
    } else if (days > maximum) {
      last = first + maximum - 1;
    }
    days = last - first + 1;
    return { start: first, end: last, days };
  }

  function uniformTickIndices(dateCount, plotWidth = 728, minimumSpacing = 64) {
    const count = Math.max(0, Math.floor(finiteNonNegative(dateCount)));
    if (!count) return [];
    const maximumLabels = Math.max(2, Math.floor(finiteNonNegative(plotWidth) / Math.max(1, finiteNonNegative(minimumSpacing))));
    const step = count <= maximumLabels ? 1 : Math.ceil((count - 1) / (maximumLabels - 1));
    const indices = [];
    for (let index = 0; index < count; index += step) indices.push(index);
    return indices;
  }

  return {
    PRICING_PER_MILLION, CREDITS_PER_MILLION, normalizeModel, splitUsage,
    getPricing, getCreditPricing, calculateCost, calculateCredits,
    localDateKey, inDateRange, aggregateEvents, summarize, aggregateModels,
    normalizeIndexWindow, uniformTickIndices
  };
});
