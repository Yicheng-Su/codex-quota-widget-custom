const test = require("node:test");
const assert = require("node:assert/strict");
const {
  APPROVAL_TEXT,
  OFFICIAL_CODEX_PACKAGE_FAMILY,
  buildRunnerRequest,
  createWindowsApprovalInput,
  isEditableControlFingerprint,
  isOfficialCodexIdentity,
  parsePowerShellOutput,
  resolveApprovalHelperPath,
  sameTargetSnapshot,
  validateTargetSnapshot
} = require("../src/main/windows-approval-input");

function makeTarget(overrides = {}) {
  const base = {
    hwnd: "0x1234abcd",
    pid: 4100,
    processCreated: "134139900000000000",
    imagePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
    packageFamily: OFFICIAL_CODEX_PACKAGE_FAMILY,
    control: {
      processId: 4200,
      processCreated: "134139900000000111",
      imagePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.721.4979.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
      packageFamily: OFFICIAL_CODEX_PACKAGE_FAMILY,
      runtimeId: "42.4200.17",
      ancestry: ["42.4200.17", "42.4200.8", "42.4100.1"],
      controlType: "ControlType.Edit",
      automationId: "prompt-input",
      className: "",
      frameworkId: "Chrome",
      isKeyboardFocusable: true,
      hasKeyboardFocus: true,
      isEnabled: true
    }
  };
  return {
    ...base,
    ...overrides,
    control: { ...base.control, ...(overrides.control || {}) }
  };
}

test("official Codex identity requires both the MSIX family and packaged image path", () => {
  const target = makeTarget();
  assert.equal(isOfficialCodexIdentity(target), true);
  assert.equal(
    isOfficialCodexIdentity({ ...target, packageFamily: "OpenAI.ChatGPT_2p2nqsd0c76g0" }),
    false
  );
  assert.equal(
    isOfficialCodexIdentity({
      ...target,
      imagePath: "C:\\Users\\person\\AppData\\Local\\OpenAI\\Codex\\bin\\hash\\codex.exe"
    }),
    false
  );
});

test("editable fingerprints fail closed for buttons, disabled controls, and foreign processes", () => {
  const control = makeTarget().control;
  assert.equal(isEditableControlFingerprint(control), true);
  assert.equal(isEditableControlFingerprint({ ...control, controlType: "ControlType.Button" }), false);
  assert.equal(isEditableControlFingerprint({ ...control, hasKeyboardFocus: false }), false);
  assert.equal(
    isEditableControlFingerprint({ ...control, packageFamily: "Foreign.App_example" }),
    false
  );
});

test("target snapshots include foreground process lifetime and focused UIA ancestry", () => {
  const target = makeTarget();
  assert.equal(validateTargetSnapshot(target), true);
  assert.equal(sameTargetSnapshot(target, structuredClone(target)), true);
  assert.equal(sameTargetSnapshot(target, makeTarget({ hwnd: "0x9999" })), false);
  assert.equal(sameTargetSnapshot(target, makeTarget({ processCreated: "134139900000000001" })), false);
  assert.equal(
    sameTargetSnapshot(target, makeTarget({ control: { runtimeId: "42.4200.99" } })),
    false
  );
  assert.equal(
    sameTargetSnapshot(target, makeTarget({ control: { ancestry: ["42.4200.17"] } })),
    false
  );
});

test("runner requests expose only fixed insert and submit actions", () => {
  assert.deepEqual(buildRunnerRequest("insert"), { action: "insert" });
  assert.deepEqual(buildRunnerRequest("submit", makeTarget()), {
    action: "submit",
    expected: makeTarget()
  });
  assert.throws(() => buildRunnerRequest("insert-arbitrary-text"), /Invalid/);
  assert.throws(() => buildRunnerRequest("submit", { hwnd: "0x1" }), /Invalid/);
});

test("first stage inserts the fixed Unicode text and returns an opaque expiring token", async () => {
  const requests = [];
  const target = makeTarget();
  const input = createWindowsApprovalInput({
    platform: "win32",
    now: () => 1_000,
    tokenTtlMs: 15_000,
    makeToken: () => "approval-test-token",
    runner: async (request) => {
      requests.push(request);
      return { ok: true, code: "inserted", target };
    }
  });

  const result = await input.insertApprovalText();
  assert.deepEqual(requests, [{ action: "insert" }]);
  assert.deepEqual(result, {
    ok: true,
    code: "inserted",
    token: "approval-test-token",
    expiresAt: 16_000,
    text: APPROVAL_TEXT
  });
  assert.equal(input.hasPending(result.token), true);
});

test("second stage sends once only when the exact target is returned", async () => {
  const target = makeTarget();
  const requests = [];
  const input = createWindowsApprovalInput({
    platform: "win32",
    now: () => 5_000,
    makeToken: () => "approval-one-shot",
    runner: async (request) => {
      requests.push(request);
      return request.action === "insert"
        ? { ok: true, code: "inserted", target }
        : { ok: true, code: "submitted", target };
    }
  });

  const inserted = await input.insertApprovalText();
  assert.equal((await input.submitApproval(inserted.token)).ok, true);
  assert.equal((await input.submitApproval(inserted.token)).code, "invalid-or-expired-token");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], { action: "submit", expected: target });
});

test("second stage rejects target changes even when a runner claims success", async () => {
  const target = makeTarget();
  const changed = makeTarget({ control: { runtimeId: "42.4200.changed" } });
  const input = createWindowsApprovalInput({
    platform: "win32",
    makeToken: () => "approval-changed",
    runner: async (request) =>
      request.action === "insert"
        ? { ok: true, code: "inserted", target }
        : { ok: true, code: "submitted", target: changed }
  });

  const inserted = await input.insertApprovalText();
  assert.deepEqual(await input.submitApproval(inserted.token), {
    ok: false,
    code: "target-changed"
  });
});

test("expired and cancelled tokens never invoke the submit runner", async () => {
  let currentTime = 100;
  let calls = 0;
  const input = createWindowsApprovalInput({
    platform: "win32",
    now: () => currentTime,
    tokenTtlMs: 10,
    makeToken: () => "approval-expiring",
    runner: async () => {
      calls += 1;
      return { ok: true, code: "inserted", target: makeTarget() };
    }
  });

  const inserted = await input.insertApprovalText();
  currentTime = 111;
  assert.equal((await input.submitApproval(inserted.token)).code, "invalid-or-expired-token");
  assert.equal(calls, 1);

  currentTime = 200;
  const next = await input.insertApprovalText();
  assert.equal(input.cancel(next.token), true);
  assert.equal((await input.submitApproval(next.token)).code, "invalid-or-expired-token");
  assert.equal(calls, 2);
});

test("unsupported platforms and runner failures fail without a target token", async () => {
  let called = false;
  const unsupported = createWindowsApprovalInput({
    platform: "darwin",
    runner: async () => {
      called = true;
    }
  });
  assert.deepEqual(await unsupported.insertApprovalText(), {
    ok: false,
    code: "unsupported-platform"
  });
  assert.equal(called, false);

  const broken = createWindowsApprovalInput({
    platform: "win32",
    runner: async () => {
      throw new Error("desktop unavailable");
    }
  });
  assert.deepEqual(await broken.insertApprovalText(), { ok: false, code: "runner-failed" });
});

test("concurrent stages are rejected while the Windows runner is busy", async () => {
  let release;
  const runnerWait = new Promise((resolve) => {
    release = resolve;
  });
  const input = createWindowsApprovalInput({
    platform: "win32",
    runner: async () => {
      await runnerWait;
      return { ok: true, code: "inserted", target: makeTarget() };
    }
  });

  const first = input.insertApprovalText();
  assert.deepEqual(await input.insertApprovalText(), { ok: false, code: "busy" });
  release();
  assert.equal((await first).ok, true);
});

test("PowerShell output parser accepts the final JSON line only", () => {
  assert.deepEqual(parsePowerShellOutput('diagnostic\r\n{"ok":true,"code":"inserted"}\r\n'), {
    ok: true,
    code: "inserted"
  });
  assert.throws(() => parsePowerShellOutput(""), /no result/);
  assert.throws(() => parsePowerShellOutput('{"code":"missing-ok"}'), /invalid result/);
});

test("packaged approval runner resolves only the fixed helper executable", () => {
  const helper = resolveApprovalHelperPath({ helperPath: "C:\\fixed\\ChatGPTQuotaApprovalHelper.exe" });
  assert.equal(helper, "C:\\fixed\\ChatGPTQuotaApprovalHelper.exe");
});
