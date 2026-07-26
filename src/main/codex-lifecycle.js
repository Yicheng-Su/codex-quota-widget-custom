const { execFile, spawn } = require("node:child_process");

const CODEX_APP_USER_MODEL_ID = "OpenAI.Codex_2p2nqsd0c76g0!App";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_STARTUP_GRACE_MS = 20_000;

function outputHasCodexProcess(output) {
  return String(output || "")
    .split(/\r?\n/)
    .some((line) => /^\s*"?ChatGPT\.exe"?(?:\s|,|$)/i.test(line));
}

function listCodexProcesses() {
  return new Promise((resolve) => {
    execFile(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq ChatGPT.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true, encoding: "utf8", timeout: 2_000 },
      (error, stdout) => resolve(!error && outputHasCodexProcess(stdout))
    );
  });
}

function launchCodex() {
  const child = spawn("explorer.exe", [`shell:AppsFolder\\${CODEX_APP_USER_MODEL_ID}`], {
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
}

function createCodexLifecycle(options = {}) {
  const platform = options.platform || process.platform;
  const isRunning = options.isRunning || listCodexProcesses;
  const launch = options.launch || launchCodex;
  const onCodexExit = options.onCodexExit || (() => {});
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? Math.max(50, options.pollIntervalMs)
    : DEFAULT_POLL_INTERVAL_MS;
  const startupGraceMs = Number.isFinite(options.startupGraceMs)
    ? Math.max(pollIntervalMs, options.startupGraceMs)
    : DEFAULT_STARTUP_GRACE_MS;
  let timer = null;
  let stopped = false;
  let observedRunning = false;
  let startedAt = 0;
  let checking = false;

  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      const running = await isRunning();
      if (stopped) return;
      if (running) {
        observedRunning = true;
        return;
      }
      if (observedRunning || Date.now() - startedAt >= startupGraceMs) {
        stop();
        onCodexExit();
      }
    } finally {
      checking = false;
    }
  }

  async function start() {
    if (platform !== "win32" || timer) return false;
    stopped = false;
    startedAt = Date.now();
    observedRunning = await isRunning();
    if (!observedRunning) launch();
    timer = setInterval(check, pollIntervalMs);
    return true;
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return Object.freeze({ start, stop, check });
}

module.exports = {
  CODEX_APP_USER_MODEL_ID,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_STARTUP_GRACE_MS,
  createCodexLifecycle,
  launchCodex,
  listCodexProcesses,
  outputHasCodexProcess
};
