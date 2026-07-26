const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODEX_APP_USER_MODEL_ID,
  createCodexLifecycle,
  outputHasCodexProcess
} = require("../src/main/codex-lifecycle");

test("Codex lifecycle recognizes only the ChatGPT desktop process row", () => {
  assert.equal(outputHasCodexProcess('"ChatGPT.exe","2024","Console","1","100,000 K"'), true);
  assert.equal(outputHasCodexProcess('"codex.exe","2024","Console","1","100,000 K"'), false);
  assert.equal(CODEX_APP_USER_MODEL_ID, "OpenAI.Codex_2p2nqsd0c76g0!App");
});

test("lifecycle launches Codex when absent and exits after it was observed", async () => {
  const states = [false, true, false];
  let launches = 0;
  let exits = 0;
  const lifecycle = createCodexLifecycle({
    platform: "win32",
    isRunning: async () => states.shift() ?? false,
    launch: () => { launches += 1; },
    onCodexExit: () => { exits += 1; },
    pollIntervalMs: 60_000,
    startupGraceMs: 60_000
  });

  assert.equal(await lifecycle.start(), true);
  assert.equal(launches, 1);
  await lifecycle.check();
  assert.equal(exits, 0);
  await lifecycle.check();
  assert.equal(exits, 1);
  lifecycle.stop();
});
