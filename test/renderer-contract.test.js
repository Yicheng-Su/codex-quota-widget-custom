const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("main and menu renderers share the approved quota palette", () => {
  const widgetStyles = read("src/renderer/styles.css").toLowerCase();
  const menuStyles = read("src/renderer/menu-bar.css").toLowerCase();

  for (const color of ["#34c98f", "#f2b84b", "#ff5c5c"]) {
    assert.match(widgetStyles, new RegExp(color));
    assert.match(menuStyles, new RegExp(color));
  }
});

test("read health stays separate from quota severity", () => {
  const renderer = read("src/renderer/renderer.js");

  assert.match(renderer, /healthLevel = state\.loading \? "loading" : state\.error \? "error" : "ready"/);
  assert.match(renderer, /fiveHourCard\.dataset\.level = fiveHourLevel/);
  assert.match(renderer, /weeklyCard\.dataset\.level = weeklyLevel/);
  assert.match(renderer, /liquidMeter\.dataset\.level = liquidLevel/);
});

test("reset time is separated by whitespace instead of a slash", () => {
  const renderer = read("src/renderer/renderer.js");

  assert.doesNotMatch(renderer, /` \/ \$\{includeDate/);
  assert.match(renderer, /` \$\{includeDate/);
});

test("menu percentage uses shared quota threshold logic", () => {
  const menuHtml = read("src/renderer/menu-bar.html");
  const menuRenderer = read("src/renderer/menu-bar.js");

  assert.match(menuHtml, /widget-logic\.js/);
  assert.match(menuRenderer, /summaryPercent\.dataset\.level = window\.WidgetLogic\.getLevel/);
});

test("compact widget exposes the new controls without the overlapping footer", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");

  assert.match(html, /id="headerRefreshBtn"/);
  assert.match(html, /id="opacityInput"[^>]*type="range"/);
  assert.match(html, /class="quota-meta-row"/);
  assert.match(html, /id="approvalBtn"/);
  assert.doesNotMatch(html, /id="langBtn"/);
  assert.doesNotMatch(renderer, /codexQuotaLang|elements\.langBtn|setLanguage\(/);
  assert.doesNotMatch(html, /<footer class="status">/);
});

test("liquid meter idles and responds to a deliberate long press", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const simulation = read("src/renderer/liquid-simulation.js");

  assert.match(html, /id="liquidCanvas"/);
  assert.match(simulation, /class SurfaceModel/);
  assert.match(simulation, /class ParticlePool/);
  assert.match(simulation, /broadWave/);
  assert.match(simulation, /crossingWave/);
  assert.match(simulation, /quadraticCurveTo/);
  assert.match(renderer, /setTimeout\(\(\) => \{\s*sloshActive = true;/);
  assert.match(renderer, /totalMovement >= 4/);
  assert.match(renderer, /verticalDelta \* 0\.72/);
  assert.match(renderer, /if \(shouldRefresh\) refreshQuota\(\)/);
  assert.match(renderer, /refreshWithLiquidMotion/);
});

test("settings close on outside pointer input and native window blur", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const main = read("src/main/main.js");

  assert.match(html, /id="settingsBackdrop"/);
  assert.match(renderer, /settingsBackdrop\.addEventListener\("click", closeSettingsPanel\)/);
  assert.match(renderer, /onWindowBlur\(closeSettingsPanel\)/);
  assert.match(main, /webContents\.send\("window:blurred"\)/);
});

test("Windows widget stays passive and exposes compact mode plus Ctrl Alt A", () => {
  const html = read("src/renderer/index.html");
  const main = read("src/main/main.js");
  const preload = read("src/main/preload.js");
  const renderer = read("src/renderer/renderer.js");
  const styles = read("src/renderer/styles.css");

  assert.match(html, /id="compactBall"/);
  assert.match(html, /id="compactLiquidCanvas"/);
  assert.match(html, />7天剩余</);
  assert.match(html, /id="approvalShortcutInput"/);
  assert.match(main, /focusable: process\.platform !== "win32"/);
  assert.match(main, /CommandOrControl\+Alt\+A/);
  assert.match(main, /COMPACT_WINDOW_SIZE = 52/);
  assert.match(main, /setTimeout\(handleApprovalShortcut, 10\)/);
  assert.match(main, /placeCompactBottomRight/);
  assert.match(main, /clampCompactPosition/);
  assert.match(main, /ipcMain\.on\("window:compact:move"/);
  assert.match(preload, /moveCompactBy:.*window:compact:move/);
  assert.match(renderer, /distance < 4/);
  assert.match(renderer, /moveCompactBy\(deltaX, deltaY\)/);
  assert.match(styles, /\.compact-ball\s*\{[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/s);
  assert.match(styles, /\.compact-ball\.dragging/);
});

test("opacity is persisted by the main process and applied to the native window", () => {
  const main = read("src/main/main.js");
  const preload = read("src/main/preload.js");

  assert.match(main, /windowOpacity = normalizeWindowOpacity\(settings\.windowOpacity\)/);
  assert.match(main, /mainWindow\.setOpacity\(windowOpacity\)/);
  assert.match(preload, /window:opacity:set/);
});

test("token usage opens in a separate safe renderer window", () => {
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");
  const preload = read("src/main/preload.js");
  const usagePreload = read("src/main/preload-usage.js");
  const main = read("src/main/main.js");
  const usageHtml = read("src/renderer/usage.html");

  assert.match(html, /id="usageBtn"/);
  assert.match(renderer, /openUsageWindow\(\)/);
  assert.match(preload, /openUsageWindow:.*usage:open/);
  assert.match(main, /function createUsageWindow\(\)/);
  assert.match(main, /ipcMain\.handle\("usage:open"/);
  assert.match(main, /preload: path\.join\(__dirname, "preload-usage\.js"\)/);
  assert.match(main, /ipcMain\.handle\("usage:get-data"/);
  assert.match(usagePreload, /getUsageData:.*usage:get-data/);
  assert.match(usagePreload, /usage:progress/);
  assert.match(usageHtml, /usage-logic\.js/);
  assert.match(usageHtml, /data-token-mode="composition"/);
  assert.match(usageHtml, /id="compositionModelSelect"/);
  assert.match(usageHtml, /id="rangeNavigator"/);
  assert.match(usageHtml, /id="rangeStartHandle"/);
  assert.match(usageHtml, /id="rangeEndHandle"/);
  assert.match(usageHtml, /id="modelDetails"/);
  assert.match(usageHtml, /id="dataStatus"/);
  assert.match(usageHtml, /id="usageRefreshBtn"/);
  assert.doesNotMatch(usageHtml, /本地真实数据/);
  assert.doesNotMatch(usageHtml, /样例数据/);
  assert.doesNotMatch(usageHtml, /type="date"/);
  assert.doesNotMatch(usageHtml, /class="billing-note"/);
  assert.match(usageHtml, /2,500 credits 约对应 US\$100/);
  const usageRenderer = read("src/renderer/usage.js");
  assert.match(usageRenderer, /hiddenModels: new Set\(\)/);
  assert.match(usageRenderer, /className = "legend-item legend-toggle"/);
  assert.match(usageRenderer, /state\.hiddenModels\.has\(model\)/);
  assert.match(usagePreload, /getRefreshIntervalMinutes:.*settings:refreshInterval:get/);
  assert.match(usagePreload, /onRefreshIntervalChanged/);
  assert.match(usageRenderer, /scheduleAutoRefresh/);
  assert.match(usageRenderer, /onRefresh\?\./);
  assert.match(usageRenderer, /document\.visibilityState === "visible"/);
});

test("real usage HTML preview is loopback-only and exposes token aggregates only", () => {
  const server = read("scripts/qa-usage-preview-server.js");
  const renderer = read("src/renderer/usage.js");

  assert.match(server, /const host = "127\.0\.0\.1"/);
  assert.match(server, /createUsageService\(\{ cacheFile: null \}\)/);
  assert.match(server, /requestPath === "\/api\/usage"/);
  assert.match(server, /allowedFiles = new Set\(\["usage\.html", "usage\.css", "usage-logic\.js", "usage\.js"\]\)/);
  assert.match(server, /timestamp: event\.timestamp/);
  assert.match(server, /cachedInputTokens: event\.usage\?\.cachedInputTokens/);
  assert.doesNotMatch(server, /turnId: event\.turnId/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin/);
  assert.match(renderer, /window\.location\.protocol !== "http:"/);
  assert.match(renderer, /loopbackHosts\.has\(window\.location\.hostname\)/);
  assert.match(renderer, /fetch\("\/api\/usage", \{ cache: "no-store", credentials: "omit" \}\)/);
});
