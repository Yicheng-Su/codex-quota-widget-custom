const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createUsageService } = require("../src/main/usage-service");

function line(value) { return `${JSON.stringify(value)}\n`; }
function context(timestamp, model, effort, turnId) {
  return line({ timestamp, type: "turn_context", payload: { model, effort, turn_id: turnId } });
}
function token(timestamp, cumulativeTotal, input, cached, output) {
  return line({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: cumulativeTotal },
        last_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }
      }
    }
  });
}

test("real usage index skips unchanged snapshots, deduplicates files, and resumes appends", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quota-usage-service-"));
  const sessionsRoot = path.join(root, "sessions");
  const cacheFile = path.join(root, "usage-index-v1.json");
  const first = path.join(sessionsRoot, "2026", "08", "01", "first.jsonl");
  const second = path.join(sessionsRoot, "2026", "08", "01", "second.jsonl");
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(first,
    context("2026-08-01T01:00:00.000Z", "gpt-5.6-sol", "high", "turn-a") +
    token("2026-08-01T01:00:01.000Z", 100, 100, 40, 10) +
    token("2026-08-01T01:00:02.000Z", 100, 0, 0, 0) +
    token("2026-08-01T01:01:00.000Z", 200, 80, 20, 20)
  );
  fs.writeFileSync(second, token("2026-08-01T01:01:00.100Z", 200, 80, 20, 20));

  try {
    const service = createUsageService({ sessionsRoot, cacheFile });
    const firstRead = await service.getUsageData();
    assert.equal(firstRead.events.length, 2);
    assert.equal(firstRead.events[1].model, "gpt-5.6-sol");
    assert.equal(firstRead.events[1].effort, "high");
    assert.deepEqual(firstRead.events[0].usage, { inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 });
    assert.equal(fs.existsSync(cacheFile), true);
    assert.doesNotMatch(fs.readFileSync(cacheFile, "utf8"), /prompt|response|message/i);

    fs.appendFileSync(first, token("2026-08-01T01:02:00.000Z", 300, 50, 25, 5));
    const secondRead = await service.getUsageData();
    assert.equal(secondRead.events.length, 3);
    assert.equal(secondRead.changedFiles, 1);

    fs.appendFileSync(first,
      token("2026-08-01T01:03:00.000Z", 100, 100, 40, 10) +
      token("2026-08-02T01:00:00.000Z", 50, 30, 10, 4)
    );
    const resetRead = await service.getUsageData();
    assert.equal(resetRead.events.length, 5);
    assert.equal(resetRead.events[3].cumulativeTotal, 100);
    assert.equal(resetRead.events[4].cumulativeTotal, 50);

    const archived = path.join(sessionsRoot, "2026", "08", "01", "archived.jsonl");
    fs.writeFileSync(archived,
      context("2026-08-02T02:00:00.000Z", "gpt-5.6-terra", "medium", "turn-archived") +
      token("2026-08-02T02:00:01.000Z", 70, 50, 20, 20)
    );
    const beforeDelete = await service.getUsageData();
    assert.equal(beforeDelete.events.length, 6);
    fs.unlinkSync(archived);
    const afterDelete = await service.getUsageData();
    assert.equal(afterDelete.events.length, 6);
    assert.equal(afterDelete.archivedFiles, 1);
    assert.equal(afterDelete.filesRetained, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
