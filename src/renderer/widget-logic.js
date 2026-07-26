(function exposeWidgetLogic(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.WidgetLogic = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
    showFiveHour: true,
    showWeekly: true,
    showLiquid: true,
    liquidSource: "weekly"
  });

  const DEFAULT_OPACITY = 1;
  const MIN_OPACITY = 0.4;
  const DEFAULT_APPROVAL_WAIT_SECONDS = 12;
  const MIN_APPROVAL_WAIT_SECONDS = 5;
  const MAX_APPROVAL_WAIT_SECONDS = 30;
  const APPROVAL_TIMEOUT_MS = DEFAULT_APPROVAL_WAIT_SECONDS * 1000;
  const REFRESH_INTERVAL_OPTIONS = Object.freeze([1 / 6, 1 / 2, 1, 5, 15, 30, 60]);
  const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;

  function normalizeDisplaySettings(value) {
    const settings = value && typeof value === "object" ? value : {};
    return {
      showFiveHour: settings.showFiveHour !== false,
      showWeekly: settings.showWeekly !== false,
      showLiquid: settings.showLiquid !== false,
      liquidSource: settings.liquidSource === "fiveHour" ? "fiveHour" : "weekly"
    };
  }

  function getLevel(percent, error, loading) {
    if (loading) return "loading";
    if (error) return "error";
    if (typeof percent !== "number") return "unavailable";
    if (percent <= 0) return "empty";
    if (percent < 20) return "critical";
    if (percent < 40) return "warning";
    return "ready";
  }

  function normalizeOpacity(value) {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return DEFAULT_OPACITY;
    return Math.round(Math.max(MIN_OPACITY, Math.min(opacity, 1)) * 100) / 100;
  }

  function normalizeApprovalWaitSeconds(value) {
    const seconds = Math.round(Number(value));
    if (!Number.isFinite(seconds)) return DEFAULT_APPROVAL_WAIT_SECONDS;
    return Math.max(MIN_APPROVAL_WAIT_SECONDS, Math.min(seconds, MAX_APPROVAL_WAIT_SECONDS));
  }

  function normalizeRefreshInterval(value) {
    const minutes = Number(value);
    return REFRESH_INTERVAL_OPTIONS.includes(minutes) ? minutes : DEFAULT_REFRESH_INTERVAL_MINUTES;
  }

  function formatTokenCount(value, lang = "zh") {
    const count = Number(value);
    if (!Number.isFinite(count)) return "--";
    if (lang === "zh") {
      if (count >= 100000000) return `${stripZeros((count / 100000000).toFixed(4))}\u4ebf`;
      if (count >= 10000) return `${stripZeros((count / 10000).toFixed(count >= 1000000 ? 0 : 1))}\u4e07`;
      return Math.round(count).toLocaleString("zh-CN");
    }
    return new Intl.NumberFormat("en-US", {
      notation: count >= 10000 ? "compact" : "standard",
      maximumFractionDigits: count >= 10000 ? 1 : 0
    }).format(count);
  }

  function stripZeros(value) {
    return String(value).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }

  function createApprovalSession(target, startedAt = Date.now(), timeoutMs = APPROVAL_TIMEOUT_MS) {
    if (!target || typeof target !== "object") return null;
    const start = Number(startedAt);
    const timeout = Number(timeoutMs);
    if (!Number.isFinite(start) || !Number.isFinite(timeout) || timeout <= 0) return null;
    return Object.freeze({ target, startedAt: start, expiresAt: start + timeout });
  }

  function isApprovalSessionActive(session, now = Date.now()) {
    const current = Number(now);
    return Boolean(
      session &&
      session.target &&
      Number.isFinite(session.startedAt) &&
      Number.isFinite(session.expiresAt) &&
      Number.isFinite(current) &&
      current >= session.startedAt &&
      current < session.expiresAt
    );
  }

  return {
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_OPACITY,
    MIN_OPACITY,
    DEFAULT_APPROVAL_WAIT_SECONDS,
    MIN_APPROVAL_WAIT_SECONDS,
    MAX_APPROVAL_WAIT_SECONDS,
    APPROVAL_TIMEOUT_MS,
    REFRESH_INTERVAL_OPTIONS,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    normalizeDisplaySettings,
    normalizeOpacity,
    normalizeApprovalWaitSeconds,
    normalizeRefreshInterval,
    formatTokenCount,
    createApprovalSession,
    isApprovalSessionActive,
    getLevel
  };
});
