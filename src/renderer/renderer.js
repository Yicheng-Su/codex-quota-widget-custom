const i18n = {
  zh: {
    brand: "\u989d\u5ea6",
    loading: "\u8bfb\u53d6\u4e2d",
    readNormal: "\u8bfb\u53d6\u6b63\u5e38",
    readFailed: "\u8bfb\u53d6\u5931\u8d25",
    unavailable: "\u65e0\u6570\u636e",
    ready: "\u6b63\u5e38",
    warning: "\u504f\u4f4e",
    critical: "\u7d27\u5f20",
    empty: "\u7528\u5c3d",
    error: "\u5931\u8d25",
    remaining: "\u5269\u4f59",
    fiveHour: "5\u5c0f\u65f6",
    weekly: "7\u5929",
    plan: "\u8ba1\u5212",
    todayTokens: "\u4eca\u65e5Token",
    refresh: "\u5237\u65b0",
    hide: "\u9690\u85cf",
    close: "\u9000\u51fa",
    pinOn: "\u53d6\u6d88\u7f6e\u9876",
    pinOff: "\u7f6e\u9876",
    statusLoading: "\u6b63\u5728\u5237\u65b0",
    statusReady: "\u5df2\u66f4\u65b0",
    statusError: "\u989d\u5ea6\u8bfb\u53d6\u5931\u8d25",
    settings: "\u66f4\u591a",
    settingsHint: "\u5feb\u6377\u64cd\u4f5c\u4e0e\u663e\u793a\u8bbe\u7f6e",
    showFiveHour: "5\u5c0f\u65f6\u989d\u5ea6",
    showWeekly: "7\u5929\u989d\u5ea6",
    showLiquid: "\u6c34\u4f4d\u663e\u793a",
    liquidSource: "\u6c34\u4f4d\u4ee3\u8868",
    opacity: "\u900f\u660e\u5ea6",
    refreshInterval: "\u5237\u65b0\u95f4\u9694",
    approvalWait: "\u6279\u51c6\u7b49\u5f85",
    approvalShortcut: "\u5feb\u6377\u952e Ctrl+Alt+A",
    approve: "\u6279\u51c6",
    sendApproval: "\u53d1\u9001\u6279\u51c6",
    approvalNeedsCodex: "\u8bf7\u5148\u628a\u5149\u6807\u653e\u5728 Codex \u8f93\u5165\u6846\u6216\u6ce8\u91ca\u6846",
    approvalExpired: "\u6279\u51c6\u5df2\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5",
    approvalFailed: "\u672a\u80fd\u5b89\u5168\u53d1\u9001",
    fiveHourRemaining: "5\u5c0f\u65f6\u5269\u4f59",
    weeklyRemaining: "7\u5929\u5269\u4f59",
    codexNotFound: "\u672a\u627e\u5230 Codex\uff0c\u8bf7\u5148\u5b89\u88c5\u6216\u542f\u52a8 Codex",
    codexBlocked: "Codex \u542f\u52a8\u88ab\u62e6\u622a\uff0c\u8bf7\u5148\u542f\u52a8 Codex \u6216\u68c0\u67e5\u5b89\u5168\u8f6f\u4ef6",
    codexTimeout: "Codex \u54cd\u5e94\u8d85\u65f6\uff0c\u8bf7\u91cd\u542f Codex \u540e\u91cd\u8bd5",
    codexAuth: "Codex \u672a\u767b\u5f55\uff0c\u8bf7\u5148\u5728 Codex \u4e2d\u767b\u5f55",
    noData: "--",
    tokenUnavailable: "\u65e0\u65e5\u5fd7"
  },
  en: {
    brand: "Quota",
    loading: "Loading",
    readNormal: "Read OK",
    readFailed: "Read failed",
    unavailable: "No data",
    ready: "OK",
    warning: "Low",
    critical: "Critical",
    empty: "Empty",
    error: "Failed",
    remaining: "Left",
    fiveHour: "5h",
    weekly: "7d",
    plan: "Plan",
    todayTokens: "Today",
    refresh: "Refresh",
    hide: "Hide",
    close: "Quit",
    pinOn: "Unpin",
    pinOff: "Pin",
    statusLoading: "Refreshing",
    statusReady: "Updated",
    statusError: "Quota read failed",
    settings: "More",
    settingsHint: "Quick actions and display settings",
    showFiveHour: "5-hour quota",
    showWeekly: "7-day quota",
    showLiquid: "Liquid meter",
    liquidSource: "Meter shows",
    opacity: "Opacity",
    refreshInterval: "Refresh every",
    approvalWait: "Approval wait",
    approvalShortcut: "Shortcut Ctrl+Alt+A",
    approve: "Approve",
    sendApproval: "Send approval",
    approvalNeedsCodex: "Focus a Codex prompt or comment field first.",
    approvalExpired: "Approval expired. Try again.",
    approvalFailed: "Could not send safely.",
    fiveHourRemaining: "5h left",
    weeklyRemaining: "7d left",
    codexNotFound: "Codex was not found. Install or start Codex first.",
    codexBlocked: "Codex was blocked. Start Codex first or check security software.",
    codexTimeout: "Codex timed out. Restart Codex and try again.",
    codexAuth: "Codex is not signed in. Sign in to Codex first.",
    noData: "--",
    tokenUnavailable: "No logs"
  }
};

const state = {
  lang: localStorage.getItem("codexQuotaLang") || "zh",
  quota: null,
  error: null,
  loading: false,
  alwaysOnTop: true,
  refreshIntervalMinutes: 5,
  approvalWaitSeconds: window.WidgetLogic.DEFAULT_APPROVAL_WAIT_SECONDS,
  approvalShortcutEnabled: true,
  compact: false,
  opacity: window.WidgetLogic.DEFAULT_OPACITY,
  displaySettings: loadDisplaySettings(),
  approvalSupported: false,
  approvalPreparedTarget: null,
  approvalSession: null,
  approvalBusy: false,
  approvalError: null
};

let refreshTimer = null;
let approvalTimer = null;
let approvalPreparePromise = null;
let pointerOverApproval = false;
let sloshHoldTimer = null;
let sloshPointerId = null;
let sloshActive = false;
let liquidSimulation = null;
let compactLiquidSimulation = null;
let compactDrag = null;

const $ = (id) => document.getElementById(id);

const elements = {
  body: document.body,
  trafficLight: $("trafficLight"),
  brandName: $("brandName"),
  stateText: $("stateText"),
  langBtn: $("langBtn"),
  settingsBtn: $("settingsBtn"),
  settingsBackdrop: $("settingsBackdrop"),
  settingsPanel: $("settingsPanel"),
  settingsTitle: $("settingsTitle"),
  settingsHint: $("settingsHint"),
  showFiveHourLabel: $("showFiveHourLabel"),
  showWeeklyLabel: $("showWeeklyLabel"),
  showLiquidLabel: $("showLiquidLabel"),
  liquidSourceLabel: $("liquidSourceLabel"),
  showFiveHourInput: $("showFiveHourInput"),
  showWeeklyInput: $("showWeeklyInput"),
  showLiquidInput: $("showLiquidInput"),
  liquidSourceInput: $("liquidSourceInput"),
  liquidFiveHourOption: $("liquidFiveHourOption"),
  liquidWeeklyOption: $("liquidWeeklyOption"),
  opacityLabel: $("opacityLabel"),
  opacityInput: $("opacityInput"),
  opacityValue: $("opacityValue"),
  refreshIntervalLabel: $("refreshIntervalLabel"),
  refreshIntervalInput: $("refreshIntervalInput"),
  approvalWaitLabel: $("approvalWaitLabel"),
  approvalWaitInput: $("approvalWaitInput"),
  approvalWaitValue: $("approvalWaitValue"),
  approvalShortcutLabel: $("approvalShortcutLabel"),
  approvalShortcutInput: $("approvalShortcutInput"),
  pinBtn: $("pinBtn"),
  refreshBtn: $("refreshBtn"),
  headerRefreshBtn: $("headerRefreshBtn"),
  minimizeBtn: $("minimizeBtn"),
  closeBtn: $("closeBtn"),
  content: document.querySelector(".content"),
  liquidMeter: $("liquidMeter"),
  liquidCanvas: $("liquidCanvas"),
  remaining: $("remaining"),
  remainingLabel: $("remainingLabel"),
  fiveHourCard: $("fiveHourCard"),
  fiveHourLabel: $("fiveHourLabel"),
  fiveHourText: $("fiveHourText"),
  weeklyCard: $("weeklyCard"),
  weeklyLabel: $("weeklyLabel"),
  weeklyText: $("weeklyText"),
  planLabel: $("planLabel"),
  planText: $("planText"),
  todayTokenLabel: $("todayTokenLabel"),
  todayTokenText: $("todayTokenText"),
  approvalBtn: $("approvalBtn"),
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  compactBall: $("compactBall"),
  compactLiquidCanvas: $("compactLiquidCanvas"),
  compactPercent: $("compactPercent"),
  compactSource: $("compactSource")
};

function t(key) {
  return i18n[state.lang][key] || key;
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem("codexQuotaLang", lang);
  render();
}

async function refreshQuota() {
  if (state.loading) return;
  state.loading = true;
  render();

  try {
    state.quota = await window.codexQuota.getQuota();
    state.error = state.quota?.quotaError || null;
  } catch (error) {
    state.quota = null;
    state.error = error?.message || String(error);
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const quota = state.quota;
  const selectedWindow = state.displaySettings.liquidSource === "fiveHour" ? quota?.fiveHour : quota?.weekly;
  const percent = selectedWindow?.remainingPercent;
  const healthLevel = state.loading ? "loading" : state.error ? "error" : "ready";
  const liquidLevel = window.WidgetLogic.getLevel(percent, null, false);
  const fiveHourLevel = window.WidgetLogic.getLevel(quota?.fiveHour?.remainingPercent, null, false);
  const weeklyLevel = window.WidgetLogic.getLevel(quota?.weekly?.remainingPercent, null, false);

  elements.body.dataset.state = healthLevel;
  elements.brandName.textContent = "ChatGPT Quota";
  elements.stateText.textContent = state.loading ? t("loading") : state.error ? t("readFailed") : t("readNormal");
  elements.langBtn.textContent = state.lang === "zh" ? "English" : "\u4e2d\u6587";
  elements.settingsBtn.title = t("settings");
  elements.settingsBtn.setAttribute("aria-label", t("settings"));
  elements.settingsTitle.textContent = t("settings");
  elements.settingsHint.textContent = t("settingsHint");
  elements.showFiveHourLabel.textContent = t("showFiveHour");
  elements.showWeeklyLabel.textContent = t("showWeekly");
  elements.showLiquidLabel.textContent = t("showLiquid");
  elements.liquidSourceLabel.textContent = t("liquidSource");
  elements.opacityLabel.textContent = t("opacity");
  elements.refreshIntervalLabel.textContent = t("refreshInterval");
  elements.approvalWaitLabel.textContent = t("approvalWait");
  elements.approvalShortcutLabel.textContent = t("approvalShortcut");
  elements.liquidFiveHourOption.textContent = t("showFiveHour");
  elements.liquidWeeklyOption.textContent = t("showWeekly");
  elements.remainingLabel.textContent = state.displaySettings.liquidSource === "fiveHour" ? t("fiveHourRemaining") : t("weeklyRemaining");
  elements.fiveHourLabel.textContent = t("fiveHour");
  elements.weeklyLabel.textContent = t("weekly");
  elements.planLabel.textContent = t("plan");
  elements.todayTokenLabel.textContent = t("todayTokens");

  elements.pinBtn.classList.toggle("active", state.alwaysOnTop);
  elements.pinBtn.title = state.alwaysOnTop ? t("pinOn") : t("pinOff");
  elements.pinBtn.setAttribute("aria-label", elements.pinBtn.title);
  elements.pinBtn.textContent = elements.pinBtn.title;
  elements.refreshBtn.title = t("refresh");
  elements.refreshBtn.textContent = t("refresh");
  elements.headerRefreshBtn.title = t("refresh");
  elements.headerRefreshBtn.setAttribute("aria-label", t("refresh"));
  elements.headerRefreshBtn.disabled = state.loading;
  elements.headerRefreshBtn.classList.toggle("loading", state.loading);
  elements.minimizeBtn.title = t("hide");
  elements.closeBtn.title = t("close");

  elements.trafficLight.className = `traffic-light ${healthLevel}`;

  if (state.loading) {
    elements.statusDot.className = "status-dot refreshing";
    elements.statusText.textContent = t("statusLoading");
    elements.statusText.title = "";
  } else if (state.error) {
    elements.statusDot.className = "status-dot error";
    elements.statusText.textContent = formatQuotaError(state.error);
    elements.statusText.title = trimError(state.error, 180);
  } else {
    elements.statusDot.className = "status-dot ready";
    elements.statusText.textContent = quota?.fetchedAt ? `${t("statusReady")} ${formatTime(quota.fetchedAt)}` : t("statusReady");
    elements.statusText.title = "";
  }

  elements.remaining.textContent = typeof percent === "number" ? `${percent}%` : "--%";
  liquidSimulation?.setPercent(typeof percent === "number" ? percent : 0);
  compactLiquidSimulation?.setPercent(typeof percent === "number" ? percent : 0);
  elements.liquidMeter.dataset.level = liquidLevel;
  elements.fiveHourCard.dataset.level = fiveHourLevel;
  elements.weeklyCard.dataset.level = weeklyLevel;
  elements.fiveHourText.textContent = formatWindow(quota?.fiveHour);
  elements.weeklyText.textContent = formatWindow(quota?.weekly, true);
  elements.planText.textContent = quota?.planType ? quota.planType.toUpperCase() : t("noData");
  elements.todayTokenText.textContent = formatTokens(quota?.todayTokens);
  elements.todayTokenText.title = formatTokenTitle(quota?.todayTokens);

  elements.liquidMeter.hidden = !state.displaySettings.showLiquid;
  elements.fiveHourCard.hidden = !state.displaySettings.showFiveHour;
  elements.weeklyCard.hidden = !state.displaySettings.showWeekly;
  elements.content.classList.toggle("no-meter", !state.displaySettings.showLiquid);
  elements.showFiveHourInput.checked = state.displaySettings.showFiveHour;
  elements.showWeeklyInput.checked = state.displaySettings.showWeekly;
  elements.showLiquidInput.checked = state.displaySettings.showLiquid;
  elements.liquidSourceInput.value = state.displaySettings.liquidSource;
  elements.liquidSourceInput.disabled = !state.displaySettings.showLiquid;
  elements.opacityInput.value = String(Math.round(state.opacity * 100));
  elements.opacityValue.value = `${Math.round(state.opacity * 100)}%`;
  elements.opacityValue.textContent = elements.opacityValue.value;
  elements.refreshIntervalInput.value = String(state.refreshIntervalMinutes);
  elements.approvalWaitInput.value = String(state.approvalWaitSeconds);
  elements.approvalWaitValue.value = `${state.approvalWaitSeconds} ${state.lang === "zh" ? "\u79d2" : "s"}`;
  elements.approvalWaitValue.textContent = elements.approvalWaitValue.value;
  elements.approvalShortcutInput.checked = state.approvalShortcutEnabled;
  updateRefreshOptionLabels();
  elements.liquidMeter.setAttribute("aria-label", elements.remainingLabel.textContent);
  elements.body.classList.toggle("compact", state.compact);
  elements.compactBall.hidden = !state.compact;
  elements.compactPercent.textContent = typeof percent === "number" ? `${percent}%` : "--%";
  elements.compactSource.textContent = state.displaySettings.liquidSource === "fiveHour" ? t("fiveHourRemaining") : t("weeklyRemaining");
  elements.compactBall.dataset.level = liquidLevel;
  renderApproval();
}

function renderApproval() {
  const armed = window.WidgetLogic.isApprovalSessionActive(state.approvalSession);
  elements.approvalBtn.hidden = !state.approvalSupported;
  elements.approvalBtn.disabled = state.approvalBusy;
  elements.approvalBtn.classList.toggle("armed", armed);
  elements.approvalBtn.classList.toggle("error", Boolean(state.approvalError));
  elements.approvalBtn.textContent = armed ? t("sendApproval") : t("approve");
  elements.approvalBtn.title = state.approvalError || "";
}

function loadDisplaySettings() {
  try {
    return window.WidgetLogic.normalizeDisplaySettings(JSON.parse(localStorage.getItem("codexQuotaDisplaySettings")));
  } catch {
    return { ...window.WidgetLogic.DEFAULT_DISPLAY_SETTINGS };
  }
}

function saveDisplaySettings() {
  localStorage.setItem("codexQuotaDisplaySettings", JSON.stringify(state.displaySettings));
}

function updateDisplaySettings() {
  state.displaySettings = window.WidgetLogic.normalizeDisplaySettings({
    showFiveHour: elements.showFiveHourInput.checked,
    showWeekly: elements.showWeeklyInput.checked,
    showLiquid: elements.showLiquidInput.checked,
    liquidSource: elements.liquidSourceInput.value
  });
  saveDisplaySettings();
  render();
}

function formatQuotaError(error) {
  const message = String(error || "");
  if (/ENOENT|not found|cannot find|executable was not found/i.test(message)) return t("codexNotFound");
  if (/EPERM|EACCES|access is denied|operation not permitted/i.test(message)) return t("codexBlocked");
  if (/timed out|timeout/i.test(message)) return t("codexTimeout");
  if (/unauthorized|not logged|sign.?in|authentication/i.test(message)) return t("codexAuth");
  return `${t("statusError")}: ${trimError(message, 52)}`;
}

function formatWindow(windowInfo, includeDate = false) {
  if (!windowInfo) return t("noData");
  const reset = windowInfo.resetsAt ? ` ${includeDate ? formatDateTime(windowInfo.resetsAt) : formatTime(windowInfo.resetsAt)}` : "";
  return `${windowInfo.remainingPercent}%${reset}`;
}

function formatTokens(todayTokens) {
  if (!todayTokens?.available) return t("tokenUnavailable");
  return window.WidgetLogic.formatTokenCount(todayTokens.totalTokens, state.lang);
}

function formatTokenTitle(todayTokens) {
  if (!todayTokens?.available) return t("tokenUnavailable");
  return [
    `Total ${todayTokens.totalTokens.toLocaleString()}`,
    `Input ${todayTokens.inputTokens.toLocaleString()}`,
    `Output ${todayTokens.outputTokens.toLocaleString()}`,
    `Events ${todayTokens.events}`
  ].join(" | ");
}

function updateRefreshOptionLabels() {
  const labels = state.lang === "zh"
    ? ["10 \u79d2", "30 \u79d2", "1 \u5206\u949f", "5 \u5206\u949f", "15 \u5206\u949f", "30 \u5206\u949f", "60 \u5206\u949f"]
    : ["10 seconds", "30 seconds", "1 minute", "5 minutes", "15 minutes", "30 minutes", "60 minutes"];
  Array.from(elements.refreshIntervalInput.options).forEach((option, index) => {
    option.textContent = labels[index] || option.textContent;
  });
}

function formatTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("noData");
  return new Intl.DateTimeFormat(state.lang === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("noData");
  if (state.lang === "zh") {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function trimError(error, length = 80) {
  return String(error).replace(/\s+/g, " ").slice(0, length);
}

async function updateOpacityFromInput() {
  state.opacity = window.WidgetLogic.normalizeOpacity(Number(elements.opacityInput.value) / 100);
  elements.opacityValue.value = `${Math.round(state.opacity * 100)}%`;
  elements.opacityValue.textContent = elements.opacityValue.value;
  state.opacity = window.WidgetLogic.normalizeOpacity(await window.codexQuota.setWindowOpacity(state.opacity));
}

async function updateRefreshIntervalFromInput() {
  const requested = window.WidgetLogic.normalizeRefreshInterval(elements.refreshIntervalInput.value);
  state.refreshIntervalMinutes = window.WidgetLogic.normalizeRefreshInterval(
    await window.codexQuota.setRefreshIntervalMinutes(requested)
  );
  scheduleRefresh();
  render();
}

async function updateApprovalWaitFromInput() {
  const requested = window.WidgetLogic.normalizeApprovalWaitSeconds(elements.approvalWaitInput.value);
  state.approvalWaitSeconds = window.WidgetLogic.normalizeApprovalWaitSeconds(
    await window.codexQuota.setApprovalWaitSeconds(requested)
  );
  render();
}

async function updateApprovalShortcutFromInput() {
  state.approvalShortcutEnabled = Boolean(
    await window.codexQuota.setApprovalShortcutEnabled(elements.approvalShortcutInput.checked)
  );
  render();
}

function showApprovalError(message) {
  state.approvalError = trimError(message || t("approvalFailed"), 100);
  renderApproval();
  setTimeout(() => {
    state.approvalError = null;
    renderApproval();
  }, 2200);
}

async function ensureApprovalTarget() {
  if (state.approvalPreparedTarget) return state.approvalPreparedTarget;
  if (approvalPreparePromise) return approvalPreparePromise;

  approvalPreparePromise = (async () => {
    const result = await window.codexQuota.prepareApprovalTarget();
    if (!result?.ok || !result.target) {
      showApprovalError(result?.message || t("approvalNeedsCodex"));
      return null;
    }
    state.approvalPreparedTarget = result.target;
    return state.approvalPreparedTarget;
  })().catch((error) => {
    showApprovalError(error?.message || t("approvalFailed"));
    return null;
  }).finally(() => {
    approvalPreparePromise = null;
  });

  return approvalPreparePromise;
}

async function cancelApprovalSession({ notifyMain = true, expired = false } = {}) {
  if (approvalTimer) clearTimeout(approvalTimer);
  approvalTimer = null;
  state.approvalSession = null;
  state.approvalPreparedTarget = null;
  state.approvalBusy = false;
  if (notifyMain) {
    try {
      await window.codexQuota.cancelApproval();
    } catch {
      // The local UI still has to return to a safe unarmed state.
    }
  }
  renderApproval();
  if (expired) showApprovalError(t("approvalExpired"));
}

function armApprovalSession(target, expiresAt) {
  if (approvalTimer) clearTimeout(approvalTimer);
  const now = Date.now();
  const configuredTimeout = state.approvalWaitSeconds * 1000;
  const remaining = Number.isFinite(Number(expiresAt))
    ? Math.max(1, Math.min(configuredTimeout, Number(expiresAt) - now))
    : configuredTimeout;
  state.approvalPreparedTarget = target;
  state.approvalSession = window.WidgetLogic.createApprovalSession(target, now, remaining);
  approvalTimer = setTimeout(() => cancelApprovalSession({ expired: true }), remaining);
  renderApproval();
}

async function applyApprovalStateChange(change) {
  if (change?.phase === "armed" && change.target) {
    state.approvalError = null;
    armApprovalSession(change.target, change.expiresAt);
    return;
  }
  await cancelApprovalSession({ notifyMain: false });
  if (change?.phase === "error") showApprovalError(change.message || t("approvalFailed"));
}

async function handleApprovalClick() {
  if (state.approvalBusy) return;
  state.approvalBusy = true;
  state.approvalError = null;
  renderApproval();

  try {
    if (state.approvalSession) {
      if (!window.WidgetLogic.isApprovalSessionActive(state.approvalSession)) {
        await cancelApprovalSession({ expired: true });
        return;
      }
      const result = await window.codexQuota.sendApproval(state.approvalSession.target);
      if (!result?.ok) {
        await cancelApprovalSession({ notifyMain: false });
        showApprovalError(result?.message || t("approvalFailed"));
        return;
      }
      await cancelApprovalSession({ notifyMain: false });
      return;
    }

    const target = await ensureApprovalTarget();
    if (!target) return;
    const result = await window.codexQuota.insertApproval(target);
    if (!result?.ok) {
      await cancelApprovalSession({ notifyMain: false });
      showApprovalError(result?.message || t("approvalFailed"));
      return;
    }

    armApprovalSession(result.target || target, result.expiresAt);
  } catch (error) {
    await cancelApprovalSession({ notifyMain: false });
    showApprovalError(error?.message || t("approvalFailed"));
  } finally {
    state.approvalBusy = false;
    renderApproval();
  }
}

function wireLiquidInteraction() {
  liquidSimulation = new window.LiquidSimulation.CanvasLiquid(elements.liquidCanvas, elements.liquidMeter, {
    ambientScale: 1
  });
  compactLiquidSimulation = new window.LiquidSimulation.CanvasLiquid(elements.compactLiquidCanvas, elements.compactBall, {
    ambientScale: 0.5,
    pointCount: 18
  });
  let pointerX = 0.5;
  let pointerStartClientX = 0;
  let pointerStartClientY = 0;
  let lastPointerClientX = 0;
  let lastPointerClientY = 0;
  const settle = (refreshAfterInteraction = false) => {
    const shouldRefresh = refreshAfterInteraction && sloshActive;
    if (sloshHoldTimer) clearTimeout(sloshHoldTimer);
    sloshHoldTimer = null;
    sloshActive = false;
    sloshPointerId = null;
    elements.liquidMeter.classList.remove("is-sloshing");
    liquidSimulation.setActive(false);
    if (shouldRefresh) refreshQuota();
  };

  elements.liquidMeter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    sloshPointerId = event.pointerId;
    const rect = elements.liquidMeter.getBoundingClientRect();
    pointerX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    pointerStartClientX = event.clientX;
    pointerStartClientY = event.clientY;
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    elements.liquidMeter.setPointerCapture(event.pointerId);
    sloshHoldTimer = setTimeout(() => {
      sloshActive = true;
      elements.liquidMeter.classList.add("is-sloshing");
      liquidSimulation.setActive(true);
      liquidSimulation.disturb(pointerX, 6.6, true);
    }, 180);
  });

  elements.liquidMeter.addEventListener("pointermove", (event) => {
    if (event.pointerId !== sloshPointerId) return;
    const rect = elements.liquidMeter.getBoundingClientRect();
    pointerX = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const totalMovement = Math.hypot(event.clientX - pointerStartClientX, event.clientY - pointerStartClientY);
    const horizontalDelta = event.clientX - lastPointerClientX;
    const verticalDelta = event.clientY - lastPointerClientY;
    const movement = Math.hypot(horizontalDelta, verticalDelta);
    if (!sloshActive && totalMovement >= 4) {
      if (sloshHoldTimer) clearTimeout(sloshHoldTimer);
      sloshHoldTimer = null;
      sloshActive = true;
      elements.liquidMeter.classList.add("is-sloshing");
      liquidSimulation.setActive(true);
      const initialStrength = Math.max(-8, Math.min(9, verticalDelta * 0.75 + movement * 0.28));
      liquidSimulation.disturb(pointerX, initialStrength || 5.8, true);
    }
    if (sloshActive && movement >= 0.5) {
      const strength = Math.max(-8, Math.min(9, verticalDelta * 0.72 + movement * 0.24));
      liquidSimulation.disturb(pointerX, strength, verticalDelta < -6);
    }
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
  });

  elements.liquidMeter.addEventListener("pointerup", () => settle(true));
  elements.liquidMeter.addEventListener("pointercancel", () => settle(false));
  elements.liquidMeter.addEventListener("lostpointercapture", () => settle(false));
  elements.liquidMeter.addEventListener("contextmenu", (event) => event.preventDefault());
}

function refreshWithLiquidMotion() {
  liquidSimulation?.ripple(1);
  compactLiquidSimulation?.ripple(0.65);
  return refreshQuota();
}

function wireEvents() {
  elements.langBtn.addEventListener("click", () => {
    setLanguage(state.lang === "zh" ? "en" : "zh");
  });
  elements.refreshBtn.addEventListener("click", () => {
    closeSettingsPanel();
    refreshWithLiquidMotion();
  });
  elements.headerRefreshBtn.addEventListener("click", refreshWithLiquidMotion);
  elements.settingsBtn.addEventListener("click", () => {
    if (elements.settingsPanel.hidden) openSettingsPanel();
    else closeSettingsPanel();
  });
  elements.settingsBackdrop.addEventListener("click", closeSettingsPanel);
  elements.showFiveHourInput.addEventListener("change", updateDisplaySettings);
  elements.showWeeklyInput.addEventListener("change", updateDisplaySettings);
  elements.showLiquidInput.addEventListener("change", updateDisplaySettings);
  elements.liquidSourceInput.addEventListener("change", updateDisplaySettings);
  elements.opacityInput.addEventListener("input", updateOpacityFromInput);
  elements.refreshIntervalInput.addEventListener("change", updateRefreshIntervalFromInput);
  elements.approvalWaitInput.addEventListener("input", updateApprovalWaitFromInput);
  elements.approvalShortcutInput.addEventListener("change", updateApprovalShortcutFromInput);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeSettingsPanel();
    if (state.approvalSession || state.approvalPreparedTarget) cancelApprovalSession();
  });
  window.addEventListener("resize", updateUiScale);
  elements.minimizeBtn.addEventListener("click", () => window.codexQuota.setCompactMode(true));
  elements.compactBall.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.compact) return;
    compactDrag = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      dragged: false
    };
    elements.compactBall.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  elements.compactBall.addEventListener("pointermove", (event) => {
    if (!compactDrag || event.pointerId !== compactDrag.pointerId) return;
    const distance = Math.hypot(event.screenX - compactDrag.startX, event.screenY - compactDrag.startY);
    if (!compactDrag.dragged && distance < 4) return;
    if (!compactDrag.dragged) {
      compactDrag.dragged = true;
      elements.compactBall.classList.add("dragging");
    }
    const deltaX = event.screenX - compactDrag.lastX;
    const deltaY = event.screenY - compactDrag.lastY;
    compactDrag.lastX = event.screenX;
    compactDrag.lastY = event.screenY;
    if (deltaX || deltaY) window.codexQuota.moveCompactBy(deltaX, deltaY);
    event.preventDefault();
  });
  const finishCompactPointer = (event, restoreOnClick) => {
    if (!compactDrag || event.pointerId !== compactDrag.pointerId) return;
    const wasDragged = compactDrag.dragged;
    compactDrag = null;
    elements.compactBall.classList.remove("dragging");
    if (elements.compactBall.hasPointerCapture(event.pointerId)) {
      elements.compactBall.releasePointerCapture(event.pointerId);
    }
    if (restoreOnClick && !wasDragged) window.codexQuota.setCompactMode(false);
  };
  elements.compactBall.addEventListener("pointerup", (event) => finishCompactPointer(event, true));
  elements.compactBall.addEventListener("pointercancel", (event) => finishCompactPointer(event, false));
  elements.compactBall.addEventListener("lostpointercapture", (event) => finishCompactPointer(event, false));
  elements.compactBall.addEventListener("click", (event) => {
    if (event.detail === 0) window.codexQuota.setCompactMode(false);
  });
  elements.compactBall.addEventListener("contextmenu", (event) => event.preventDefault());
  elements.closeBtn.addEventListener("click", () => window.codexQuota.close());
  elements.pinBtn.addEventListener("click", async () => {
    state.alwaysOnTop = await window.codexQuota.setAlwaysOnTop(!state.alwaysOnTop);
    render();
  });
  window.codexQuota.onRefresh(refreshQuota);
  window.codexQuota.onAlwaysOnTopChanged((value) => {
    state.alwaysOnTop = value;
    render();
  });
  window.codexQuota.onRefreshIntervalChanged((value) => {
    state.refreshIntervalMinutes = window.WidgetLogic.normalizeRefreshInterval(value);
    scheduleRefresh();
    render();
  });
  window.codexQuota.onCompactModeChanged((value) => {
    state.compact = Boolean(value);
    updateUiScale();
    render();
  });
  window.codexQuota.onApprovalStateChanged(applyApprovalStateChange);
  window.codexQuota.onWindowBlur(closeSettingsPanel);
  elements.approvalBtn.addEventListener("pointerenter", () => {
    pointerOverApproval = true;
    if (!state.approvalSession) ensureApprovalTarget();
  });
  elements.approvalBtn.addEventListener("pointerleave", () => {
    pointerOverApproval = false;
  });
  elements.approvalBtn.addEventListener("click", handleApprovalClick);
  elements.approvalBtn.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    cancelApprovalSession();
  });
  wireLiquidInteraction();
}

function updateUiScale() {
  const widthScale = window.innerWidth / 260;
  const heightScale = window.innerHeight / 192;
  const scale = Math.max(0.72, Math.min(3, Math.min(widthScale, heightScale)));
  document.documentElement.style.setProperty("--ui-scale", scale.toFixed(3));
}

function closeSettingsPanel() {
  elements.settingsPanel.hidden = true;
  elements.settingsBackdrop.hidden = true;
  elements.settingsBtn.classList.remove("active");
  elements.settingsBtn.setAttribute("aria-expanded", "false");
  window.codexQuota.setInteractionMode(false);
}

function openSettingsPanel() {
  elements.settingsPanel.hidden = false;
  elements.settingsBackdrop.hidden = false;
  elements.settingsBtn.classList.add("active");
  elements.settingsBtn.setAttribute("aria-expanded", "true");
  window.codexQuota.setInteractionMode(true);
}

async function init() {
  updateUiScale();
  wireEvents();
  const [
    alwaysOnTop,
    refreshIntervalMinutes,
    opacity,
    approvalSupported,
    approvalWaitSeconds,
    approvalShortcutEnabled,
    compact
  ] = await Promise.all([
    window.codexQuota.getAlwaysOnTop(),
    window.codexQuota.getRefreshIntervalMinutes(),
    window.codexQuota.getWindowOpacity(),
    window.codexQuota.isApprovalSupported(),
    window.codexQuota.getApprovalWaitSeconds(),
    window.codexQuota.getApprovalShortcutEnabled(),
    window.codexQuota.getCompactMode()
  ]);
  state.alwaysOnTop = alwaysOnTop;
  state.refreshIntervalMinutes = window.WidgetLogic.normalizeRefreshInterval(refreshIntervalMinutes);
  state.opacity = window.WidgetLogic.normalizeOpacity(opacity);
  state.approvalSupported = Boolean(approvalSupported);
  state.approvalWaitSeconds = window.WidgetLogic.normalizeApprovalWaitSeconds(approvalWaitSeconds);
  state.approvalShortcutEnabled = Boolean(approvalShortcutEnabled);
  state.compact = Boolean(compact);
  render();
  refreshQuota();
  scheduleRefresh();
}

function scheduleRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  refreshTimer = setInterval(refreshQuota, state.refreshIntervalMinutes * 60 * 1000);
}

init();
