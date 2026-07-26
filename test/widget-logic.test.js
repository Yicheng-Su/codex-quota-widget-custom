const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_DISPLAY_SETTINGS,
  APPROVAL_TIMEOUT_MS,
  DEFAULT_APPROVAL_WAIT_SECONDS,
  formatTokenCount,
  normalizeApprovalWaitSeconds,
  normalizeDisplaySettings,
  normalizeOpacity,
  normalizeRefreshInterval,
  createApprovalSession,
  isApprovalSessionActive,
  getLevel
} = require("../src/renderer/widget-logic");

test("display settings default to all quota visuals with weekly liquid", () => {
  assert.deepEqual(normalizeDisplaySettings(null), DEFAULT_DISPLAY_SETTINGS);
});

test("display settings preserve explicit hidden items and five-hour liquid", () => {
  assert.deepEqual(
    normalizeDisplaySettings({
      showFiveHour: false,
      showWeekly: false,
      showLiquid: false,
      liquidSource: "fiveHour"
    }),
    {
      showFiveHour: false,
      showWeekly: false,
      showLiquid: false,
      liquidSource: "fiveHour"
    }
  );
});

test("quota thresholds are green at 40, amber from 20, and red below 20", () => {
  assert.equal(getLevel(undefined, null, false), "unavailable");
  assert.equal(getLevel(40, null, false), "ready");
  assert.equal(getLevel(39, null, false), "warning");
  assert.equal(getLevel(20, null, false), "warning");
  assert.equal(getLevel(19, null, false), "critical");
  assert.equal(getLevel(0, null, false), "empty");
});

test("window opacity is clamped to the readable 40 to 100 percent range", () => {
  assert.equal(normalizeOpacity(undefined), 1);
  assert.equal(normalizeOpacity(0.1), 0.4);
  assert.equal(normalizeOpacity(0.735), 0.74);
  assert.equal(normalizeOpacity(4), 1);
});

test("approval sessions expire after twelve seconds", () => {
  const target = { hwnd: "123", pid: 456 };
  const session = createApprovalSession(target, 1000);

  assert.equal(session.expiresAt, 1000 + APPROVAL_TIMEOUT_MS);
  assert.equal(isApprovalSessionActive(session, 12999), true);
  assert.equal(isApprovalSessionActive(session, 13000), false);
  assert.equal(createApprovalSession(null, 1000), null);
});

test("approval wait and refresh settings stay within approved choices", () => {
  assert.equal(normalizeApprovalWaitSeconds(undefined), DEFAULT_APPROVAL_WAIT_SECONDS);
  assert.equal(normalizeApprovalWaitSeconds(2), 5);
  assert.equal(normalizeApprovalWaitSeconds(18.4), 18);
  assert.equal(normalizeApprovalWaitSeconds(99), 30);
  assert.equal(normalizeRefreshInterval(1 / 6), 1 / 6);
  assert.equal(normalizeRefreshInterval(1 / 2), 1 / 2);
  assert.equal(normalizeRefreshInterval(2), 5);
});

test("Chinese token counts switch from wan to yi with up to four decimals", () => {
  assert.equal(formatTokenCount(9999, "zh"), "9,999");
  assert.equal(formatTokenCount(12345, "zh"), "1.2\u4e07");
  assert.equal(formatTokenCount(196300000, "zh"), "1.963\u4ebf");
  assert.equal(formatTokenCount(100010000, "zh"), "1.0001\u4ebf");
});
