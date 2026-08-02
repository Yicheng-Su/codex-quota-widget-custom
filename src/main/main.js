const { app, BrowserWindow, globalShortcut, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { getQuota } = require("./quota-service");
const { configureUsageService, getUsageData } = require("./usage-service");
const { syncDockVisibility } = require("./dock-visibility");
const { MENU_BAR_POPOVER_SIZE } = require("./menu-bar-layout");
const { createWindowsApprovalInput } = require("./windows-approval-input");
const { createCodexLifecycle } = require("./codex-lifecycle");
const {
  DEFAULT_MENU_BAR_QUOTA_SOURCE,
  normalizeMenuBarQuotaSource,
  formatMenuBarTitle
} = require("./menu-bar-logic");

let mainWindow;
let menuBarWindow;
let usageWindow;
let tray;
let isAlwaysOnTop = true;
let refreshIntervalMinutes = 5;
let approvalWaitSeconds = 12;
let approvalShortcutEnabled = true;
let windowOpacity = 1;
let windowSize = { width: 260, height: 192 };
let compactPosition = null;
let expandedWindowBounds = null;
let isCompactMode = false;
let menuBarQuotaSource = DEFAULT_MENU_BAR_QUOTA_SOURCE;
let latestQuota = null;
let isRefreshingMenuBar = false;
let lastTrayClickAt = 0;
let saveWindowSizeTimer;
let saveCompactPositionTimer;
let approvalFocusTimer;
let approvalFocusBypass = false;
let activeApprovalTarget = null;
let codexLifecycle = null;
let lastApprovalShortcutAt = 0;

const windowsApprovalInput = createWindowsApprovalInput();

const REFRESH_INTERVAL_OPTIONS = [1 / 6, 1 / 2, 1, 5, 15, 30, 60];
const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;
const APPROVAL_SHORTCUT = "CommandOrControl+Alt+A";
const COMPACT_WINDOW_SIZE = 52;

app.setName("ChatGPT Quota");

function getIcon() {
  const iconPath = path.join(__dirname, "../../assets/icon.png");
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

function createWindow() {
  // macOS reads the application icon exclusively from the application bundle.
  // Windows still needs an explicit window icon for the taskbar executable.
  const icon = process.platform === "darwin" ? undefined : getIcon();
  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    // Keep the compact layout usable while allowing the meter to be hidden
    // without leaving an unnecessarily large native window constraint.
    minWidth: 180,
    minHeight: 140,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: true,
    focusable: process.platform !== "win32",
    show: false,
    backgroundColor: "#00000000",
    opacity: windowOpacity,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the always-visible Apple Silicon widget responsive when macOS
      // moves it to the background; Windows keeps the lower-power default.
      backgroundThrottling: process.platform !== "darwin",
      v8CacheOptions: "bypassHeatCheckAndEagerCompile"
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("resize", () => {
    if (!mainWindow || isCompactMode || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
    const { width, height } = mainWindow.getBounds();
    windowSize = { width, height };
    clearTimeout(saveWindowSizeTimer);
    saveWindowSizeTimer = setTimeout(saveSettings, 300);
  });
  mainWindow.on("show", () => {
    syncDockVisibility({ platform: process.platform, dock: app.dock, widgetVisible: true });
    notifyMenuBarStateChanged();
  });
  mainWindow.on("hide", () => {
    // The widget remains available from the macOS menu bar while it runs in
    // the background, so it should not leave a redundant Dock icon behind.
    syncDockVisibility({ platform: process.platform, dock: app.dock, widgetVisible: false });
    notifyMenuBarStateChanged();
  });
  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("window:blurred");
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.setSkipTaskbar(true);
    if (process.platform === "win32") mainWindow.showInactive();
    else mainWindow.show();
    placeWindowTopRight();
  });
}

function createUsageWindow() {
  if (usageWindow && !usageWindow.isDestroyed()) {
    if (usageWindow.isMinimized()) usageWindow.restore();
    usageWindow.show();
    usageWindow.focus();
    return usageWindow;
  }

  usageWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: "#0d141b",
    icon: process.platform === "darwin" ? undefined : getIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload-usage.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  usageWindow.setMenuBarVisibility(false);
  usageWindow.loadFile(path.join(__dirname, "../renderer/usage.html"));
  usageWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  usageWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  usageWindow.once("ready-to-show", () => usageWindow?.show());
  usageWindow.on("closed", () => {
    usageWindow = null;
  });
  return usageWindow;
}

function createMenuBarWindow() {
  if (process.platform !== "darwin") return;
  menuBarWindow = new BrowserWindow({
    width: MENU_BAR_POPOVER_SIZE.width,
    height: MENU_BAR_POPOVER_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    type: "panel",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload-menu-bar.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  menuBarWindow.loadFile(path.join(__dirname, "../renderer/menu-bar.html"));
  menuBarWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  menuBarWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  menuBarWindow.on("blur", () => {
    setTimeout(() => {
      if (Date.now() - lastTrayClickAt > 180) menuBarWindow?.hide();
    }, 200);
  });
}

function placeWindowTopRight() {
  if (!mainWindow) return;
  const display = screen.getPrimaryDisplay();
  const { width, height } = mainWindow.getBounds();
  const { workArea } = display;
  mainWindow.setBounds({
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height
  });
}

function placeCompactBottomRight() {
  if (!mainWindow) return;
  const size = COMPACT_WINDOW_SIZE;
  const anchor = compactPosition
    ? { x: compactPosition.x + Math.floor(size / 2), y: compactPosition.y + Math.floor(size / 2) }
    : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchor);
  const { workArea } = display;
  const fallback = {
    x: workArea.x + workArea.width - size - 22,
    y: workArea.y + workArea.height - size - 22
  };
  const position = clampCompactPosition(compactPosition || fallback, workArea, size);
  mainWindow.setBounds({
    x: position.x,
    y: position.y,
    width: size,
    height: size
  });
}

function clampCompactPosition(position, workArea, size = COMPACT_WINDOW_SIZE) {
  const margin = 4;
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = Math.max(minX, workArea.x + workArea.width - size - margin);
  const maxY = Math.max(minY, workArea.y + workArea.height - size - margin);
  return {
    x: Math.max(minX, Math.min(Math.round(position.x), maxX)),
    y: Math.max(minY, Math.min(Math.round(position.y), maxY))
  };
}

function moveCompactBy(deltaX, deltaY) {
  if (!mainWindow || mainWindow.isDestroyed() || !isCompactMode) return false;
  const dx = Number(deltaX);
  const dy = Number(deltaY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  const bounds = mainWindow.getBounds();
  const proposed = {
    x: bounds.x + Math.max(-500, Math.min(Math.round(dx), 500)),
    y: bounds.y + Math.max(-500, Math.min(Math.round(dy), 500))
  };
  const display = screen.getDisplayNearestPoint({
    x: proposed.x + Math.floor(bounds.width / 2),
    y: proposed.y + Math.floor(bounds.height / 2)
  });
  compactPosition = clampCompactPosition(proposed, display.workArea, bounds.width);
  mainWindow.setPosition(compactPosition.x, compactPosition.y);
  clearTimeout(saveCompactPositionTimer);
  saveCompactPositionTimer = setTimeout(saveSettings, 250);
  return true;
}

function setCompactMode(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const next = Boolean(value);
  if (next === isCompactMode) return isCompactMode;
  if (next) {
    expandedWindowBounds = mainWindow.getBounds();
    isCompactMode = true;
    mainWindow.setMinimumSize(COMPACT_WINDOW_SIZE, COMPACT_WINDOW_SIZE);
    mainWindow.setResizable(false);
    mainWindow.setFocusable(false);
    placeCompactBottomRight();
  } else {
    isCompactMode = false;
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(180, 140);
    const bounds = expandedWindowBounds || { ...windowSize, x: undefined, y: undefined };
    if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) mainWindow.setBounds(bounds);
    else {
      mainWindow.setSize(windowSize.width, windowSize.height);
      placeWindowTopRight();
    }
    if (process.platform === "win32") mainWindow.setFocusable(false);
  }
  mainWindow.webContents.send("window:compactChanged", isCompactMode);
  return isCompactMode;
}

function setInteractionMode(value) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") return false;
  const interactive = Boolean(value) && !isCompactMode && !approvalFocusBypass;
  mainWindow.setFocusable(interactive);
  return interactive;
}

function createTray() {
  const icon = getIcon();
  const iconSize = process.platform === "darwin" ? 18 : 16;
  tray = new Tray(icon ? icon.resize({ width: iconSize, height: iconSize }) : nativeImage.createEmpty());
  tray.setToolTip("ChatGPT Quota");
  if (process.platform === "darwin") {
    createMenuBarWindow();
    updateMenuBarTitle();
    tray.on("click", toggleMenuBarWindow);
    tray.on("right-click", toggleMenuBarWindow);
  } else {
    rebuildTrayMenu();
    tray.on("click", toggleWindow);
  }
}

function rebuildTrayMenu() {
  if (!tray || process.platform === "darwin") return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示/隐藏", click: toggleWindow },
      { label: "刷新额度", click: () => mainWindow?.webContents.send("quota:refresh") },
      {
        label: isAlwaysOnTop ? "取消置顶" : "置顶",
        click: () => setAlwaysOnTop(!isAlwaysOnTop)
      },
      {
        label: "刷新间隔",
        submenu: REFRESH_INTERVAL_OPTIONS.map((minutes) => ({
          label: formatRefreshInterval(minutes),
          type: "radio",
          checked: refreshIntervalMinutes === minutes,
          click: () => setRefreshIntervalMinutes(minutes)
        }))
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() }
    ])
  );
}

function formatRefreshInterval(minutes) {
  if (minutes === 1 / 6) return "10 秒";
  if (minutes === 1 / 2) return "30 秒";
  return `${minutes} 分钟`;
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    refreshIntervalMinutes = normalizeRefreshInterval(settings.refreshIntervalMinutes);
    approvalWaitSeconds = normalizeApprovalWaitSeconds(settings.approvalWaitSeconds);
    approvalShortcutEnabled = settings.approvalShortcutEnabled !== false;
    windowOpacity = normalizeWindowOpacity(settings.windowOpacity);
    windowSize = normalizeWindowSize(settings.windowSize);
    compactPosition = normalizeCompactPosition(settings.compactPosition);
    menuBarQuotaSource = normalizeMenuBarQuotaSource(settings.menuBarQuotaSource);
  } catch {
    refreshIntervalMinutes = DEFAULT_REFRESH_INTERVAL_MINUTES;
    approvalWaitSeconds = 12;
    approvalShortcutEnabled = true;
    windowOpacity = 1;
    windowSize = { width: 260, height: 192 };
    compactPosition = null;
    menuBarQuotaSource = DEFAULT_MENU_BAR_QUOTA_SOURCE;
  }
}

function saveSettings() {
  fs.writeFileSync(
    getSettingsPath(),
    JSON.stringify(
      {
        refreshIntervalMinutes,
        approvalWaitSeconds,
        approvalShortcutEnabled,
        windowOpacity,
        windowSize,
        compactPosition,
        menuBarQuotaSource
      },
      null,
      2
    )
  );
}

function normalizeWindowSize(value) {
  const width = Math.round(Number(value?.width));
  const height = Math.round(Number(value?.height));
  return {
    width: Number.isFinite(width) ? Math.max(180, Math.min(width, 1600)) : 260,
    height: Number.isFinite(height) ? Math.max(140, Math.min(height, 1200)) : 192
  };
}

function normalizeCompactPosition(value) {
  const x = Math.round(Number(value?.x));
  const y = Math.round(Number(value?.y));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function normalizeRefreshInterval(value) {
  const minutes = Number(value);
  return REFRESH_INTERVAL_OPTIONS.includes(minutes) ? minutes : DEFAULT_REFRESH_INTERVAL_MINUTES;
}

function normalizeApprovalWaitSeconds(value) {
  const seconds = Math.round(Number(value));
  return Number.isFinite(seconds) ? Math.max(5, Math.min(seconds, 30)) : 12;
}

function normalizeWindowOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return 1;
  return Math.round(Math.max(0.4, Math.min(opacity, 1)) * 100) / 100;
}

function setWindowOpacity(value) {
  windowOpacity = normalizeWindowOpacity(value);
  if (mainWindow && !mainWindow.isDestroyed() && process.platform === "win32") {
    mainWindow.setOpacity(windowOpacity);
  }
  saveSettings();
  return windowOpacity;
}

function approvalMessage(code) {
  if (/foreground|focused-control|uia-focus/.test(String(code))) {
    return "请先把光标放在 Codex 提示词栏或注释框";
  }
  if (code === "modifier-key-down") return "请松开 Shift、Ctrl、Alt 或 Win 键后重试";
  if (code === "target-changed") return "窗口或输入框已经变化，为避免误发已取消";
  if (code === "invalid-or-expired-token") return "批准已超时，请重新开始";
  if (code === "busy") return "批准输入仍在处理中";
  return "未能安全地向 Codex 发送批准";
}

function restoreApprovalWindowFocusability() {
  clearTimeout(approvalFocusTimer);
  approvalFocusTimer = null;
  approvalFocusBypass = false;
  if (mainWindow && !mainWindow.isDestroyed() && process.platform === "win32") {
    mainWindow.setFocusable(false);
  }
}

function notifyApprovalState(change) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("approval:stateChanged", change);
}

function scheduleApprovalExpiry() {
  clearTimeout(approvalFocusTimer);
  approvalFocusTimer = setTimeout(() => {
    windowsApprovalInput.cancel();
    activeApprovalTarget = null;
    restoreApprovalWindowFocusability();
    notifyApprovalState({ phase: "error", message: approvalMessage("invalid-or-expired-token") });
  }, approvalWaitSeconds * 1000);
}

function prepareApprovalInput() {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, code: "unsupported-platform", message: "此功能仅支持 Windows Codex" };
  }

  windowsApprovalInput.cancel();
  activeApprovalTarget = null;
  clearTimeout(approvalFocusTimer);
  approvalFocusBypass = true;
  mainWindow.setFocusable(false);
  approvalFocusTimer = setTimeout(() => {
    windowsApprovalInput.cancel();
    restoreApprovalWindowFocusability();
  }, 5_000);
  return { ok: true, target: { prepared: true } };
}

async function insertApprovalInput() {
  if (!approvalFocusBypass) {
    const prepared = prepareApprovalInput();
    if (!prepared.ok) return prepared;
  }
  const result = await windowsApprovalInput.insertApprovalText();
  if (!result.ok) {
    restoreApprovalWindowFocusability();
    return { ...result, message: approvalMessage(result.code) };
  }
  activeApprovalTarget = { token: result.token };
  scheduleApprovalExpiry();
  return {
    ok: true,
    code: result.code,
    target: activeApprovalTarget,
    expiresAt: Date.now() + approvalWaitSeconds * 1000
  };
}

async function submitApprovalInput(target) {
  if (
    !approvalFocusBypass ||
    typeof target?.token !== "string" ||
    target.token !== activeApprovalTarget?.token
  ) {
    activeApprovalTarget = null;
    restoreApprovalWindowFocusability();
    return { ok: false, code: "invalid-or-expired-token", message: approvalMessage("invalid-or-expired-token") };
  }
  try {
    const result = await windowsApprovalInput.submitApproval(target.token);
    return result.ok ? result : { ...result, message: approvalMessage(result.code) };
  } finally {
    activeApprovalTarget = null;
    restoreApprovalWindowFocusability();
  }
}

function cancelApprovalInput() {
  windowsApprovalInput.cancel();
  activeApprovalTarget = null;
  restoreApprovalWindowFocusability();
  return true;
}

function setApprovalWaitSeconds(value) {
  approvalWaitSeconds = normalizeApprovalWaitSeconds(value);
  saveSettings();
  return approvalWaitSeconds;
}

function registerApprovalShortcut() {
  globalShortcut.unregister(APPROVAL_SHORTCUT);
  if (process.platform !== "win32" || !approvalShortcutEnabled) return false;
  return globalShortcut.register(APPROVAL_SHORTCUT, () => {
    const now = Date.now();
    if (now - lastApprovalShortcutAt < 500) return;
    lastApprovalShortcutAt = now;
    setTimeout(handleApprovalShortcut, 10);
  });
}

function setApprovalShortcutEnabled(value) {
  approvalShortcutEnabled = Boolean(value);
  const registered = approvalShortcutEnabled ? registerApprovalShortcut() : (globalShortcut.unregister(APPROVAL_SHORTCUT), false);
  if (approvalShortcutEnabled && !registered) approvalShortcutEnabled = false;
  saveSettings();
  return approvalShortcutEnabled;
}

async function handleApprovalShortcut() {
  if (activeApprovalTarget) {
    const result = await submitApprovalInput(activeApprovalTarget);
    notifyApprovalState(result.ok
      ? { phase: "idle" }
      : { phase: "error", message: result.message || approvalMessage(result.code) });
    return;
  }

  const prepared = prepareApprovalInput();
  if (!prepared.ok) {
    notifyApprovalState({ phase: "error", message: prepared.message });
    return;
  }
  const result = await insertApprovalInput();
  notifyApprovalState(result.ok
    ? { phase: "armed", target: result.target, expiresAt: result.expiresAt }
    : { phase: "error", message: result.message || approvalMessage(result.code) });
}

function setRefreshIntervalMinutes(minutes) {
  refreshIntervalMinutes = normalizeRefreshInterval(minutes);
  saveSettings();
  mainWindow?.webContents.send("settings:refreshIntervalChanged", refreshIntervalMinutes);
  usageWindow?.webContents.send("settings:refreshIntervalChanged", refreshIntervalMinutes);
  rebuildTrayMenu();
  notifyMenuBarStateChanged();
  return refreshIntervalMinutes;
}

function getAutoLaunchOptions() {
  if (app.isPackaged) {
    return { path: process.execPath, args: [] };
  }
  return { path: process.execPath, args: [app.getAppPath()] };
}

function isAutoLaunchEnabled() {
  try {
    return app.getLoginItemSettings(getAutoLaunchOptions()).openAtLogin;
  } catch {
    return false;
  }
}

function setAutoLaunch(enabled) {
  const options = getAutoLaunchOptions();
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: options.path,
      args: options.args
    });
  } finally {
    rebuildTrayMenu();
    notifyMenuBarStateChanged();
  }
}

function setAlwaysOnTop(value) {
  isAlwaysOnTop = Boolean(value);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    mainWindow.webContents.send("window:alwaysOnTopChanged", isAlwaysOnTop);
  }
  rebuildTrayMenu();
  return isAlwaysOnTop;
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.setSkipTaskbar(true);
    if (process.platform === "win32") mainWindow.showInactive();
    else {
      mainWindow.show();
      mainWindow.focus();
    }
  }
  menuBarWindow?.hide();
  notifyMenuBarStateChanged();
}

function toggleMenuBarWindow() {
  if (!menuBarWindow || !tray) return;
  lastTrayClickAt = Date.now();
  if (menuBarWindow.isVisible()) {
    menuBarWindow.hide();
    return;
  }

  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2)
  });
  const { width, height } = menuBarWindow.getBounds();
  const minX = display.workArea.x + 8;
  const maxX = display.workArea.x + display.workArea.width - width - 8;
  const x = Math.max(minX, Math.min(maxX, Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)));
  const y = Math.min(
    display.workArea.y + display.workArea.height - height - 8,
    Math.round(trayBounds.y + trayBounds.height + 6)
  );

  menuBarWindow.setPosition(x, y, false);
  notifyMenuBarStateChanged();
  menuBarWindow.show();
  menuBarWindow.focus();
}

function updateLatestQuota(quota) {
  latestQuota = quota;
  updateMenuBarTitle();
  notifyMenuBarStateChanged();
}

function updateMenuBarTitle() {
  if (!tray || process.platform !== "darwin") return;
  tray.setTitle(formatMenuBarTitle(latestQuota, menuBarQuotaSource));
}

function setMenuBarQuotaSource(value) {
  menuBarQuotaSource = normalizeMenuBarQuotaSource(value);
  saveSettings();
  updateMenuBarTitle();
  notifyMenuBarStateChanged();
  return menuBarQuotaSource;
}

function getMenuBarState() {
  return {
    quota: latestQuota,
    quotaSource: menuBarQuotaSource,
    autoLaunch: isAutoLaunchEnabled(),
    refreshIntervalMinutes,
    widgetVisible: Boolean(mainWindow?.isVisible()),
    refreshing: isRefreshingMenuBar
  };
}

function notifyMenuBarStateChanged() {
  if (!menuBarWindow || menuBarWindow.isDestroyed()) return;
  menuBarWindow.webContents.send("menu-bar:state-changed", getMenuBarState());
}

async function refreshFromMenuBar() {
  if (isRefreshingMenuBar) return getMenuBarState();
  isRefreshingMenuBar = true;
  notifyMenuBarStateChanged();

  try {
    const quotaPromise = getQuota();
    mainWindow?.webContents.send("quota:refresh");
    updateLatestQuota(await quotaPromise);
  } finally {
    isRefreshingMenuBar = false;
    notifyMenuBarStateChanged();
  }
  return getMenuBarState();
}

async function handleMenuBarAction(action, value) {
  switch (action) {
    case "toggle-widget":
      toggleWindow();
      break;
    case "refresh":
      return refreshFromMenuBar();
    case "set-quota-source":
      setMenuBarQuotaSource(value);
      break;
    case "set-auto-launch":
      setAutoLaunch(Boolean(value));
      break;
    case "set-refresh-interval":
      setRefreshIntervalMinutes(value);
      break;
    case "quit":
      app.quit();
      return null;
    default:
      throw new Error(`Unsupported menu bar action: ${action}`);
  }
  return getMenuBarState();
}

app.whenReady().then(() => {
  loadSettings();
  configureUsageService({
    cacheFile: path.join(app.getPath("userData"), "usage-index-v1.json")
  });
  if (process.platform === "win32") {
    const options = getAutoLaunchOptions();
    app.setLoginItemSettings({ openAtLogin: false, path: options.path, args: options.args });
  }
  createWindow();
  createTray();
  registerApprovalShortcut();
  if (process.platform === "win32" && app.isPackaged) {
    codexLifecycle = createCodexLifecycle({ onCodexExit: () => app.quit() });
    codexLifecycle.start();
  }

  ipcMain.handle("quota:get", async () => {
    const quota = await getQuota();
    updateLatestQuota(quota);
    return quota;
  });
  ipcMain.handle("usage:get-data", () => getUsageData({
    onProgress: (progress) => {
      if (usageWindow && !usageWindow.isDestroyed()) usageWindow.webContents.send("usage:progress", progress);
    }
  }));
  ipcMain.handle("settings:refreshInterval:get", () => refreshIntervalMinutes);
  ipcMain.handle("settings:refreshInterval:set", (_event, value) => setRefreshIntervalMinutes(value));
  ipcMain.handle("window:opacity:get", () => windowOpacity);
  ipcMain.handle("window:opacity:set", (_event, value) => setWindowOpacity(value));
  ipcMain.handle("approval:is-supported", () => process.platform === "win32");
  ipcMain.handle("approval:prepare", prepareApprovalInput);
  ipcMain.handle("approval:insert", insertApprovalInput);
  ipcMain.handle("approval:submit", (_event, target) => submitApprovalInput(target));
  ipcMain.handle("approval:cancel", cancelApprovalInput);
  ipcMain.handle("approval:wait:get", () => approvalWaitSeconds);
  ipcMain.handle("approval:wait:set", (_event, value) => setApprovalWaitSeconds(value));
  ipcMain.handle("approval:shortcut:get", () => approvalShortcutEnabled);
  ipcMain.handle("approval:shortcut:set", (_event, value) => setApprovalShortcutEnabled(value));
  ipcMain.handle("window:minimize", () => setCompactMode(true));
  ipcMain.handle("window:compact:get", () => isCompactMode);
  ipcMain.handle("window:compact:set", (_event, value) => setCompactMode(value));
  ipcMain.on("window:compact:move", (_event, deltaX, deltaY) => moveCompactBy(deltaX, deltaY));
  ipcMain.handle("window:interaction-mode", (_event, value) => setInteractionMode(value));
  ipcMain.handle("window:close", () => {
    if (process.platform === "darwin") mainWindow?.hide();
    else app.quit();
  });
  ipcMain.handle("window:alwaysOnTop:get", () => isAlwaysOnTop);
  ipcMain.handle("window:alwaysOnTop:set", (_event, value) => setAlwaysOnTop(value));
  ipcMain.handle("external:openCodex", () => {
    const codexPath = process.platform === "darwin"
      ? "/Applications/Codex.app"
      : path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex");
    shell.openPath(codexPath);
  });
  ipcMain.handle("usage:open", () => {
    const window = createUsageWindow();
    if (window.webContents && !window.webContents.isLoading()) window.webContents.send("usage:refresh");
    return true;
  });
  ipcMain.handle("menu-bar:get-state", getMenuBarState);
  ipcMain.handle("menu-bar:action", (_event, action, value) => handleMenuBarAction(action, value));

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else if (!mainWindow.isVisible()) toggleWindow();
  });
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("will-quit", () => {
  codexLifecycle?.stop();
  globalShortcut.unregisterAll();
});
