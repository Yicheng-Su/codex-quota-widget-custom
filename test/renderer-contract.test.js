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

  assert.match(html, /id="headerRefreshBtn"/);
  assert.match(html, /id="opacityInput"[^>]*type="range"/);
  assert.match(html, /class="quota-meta-row"/);
  assert.match(html, /id="approvalBtn"/);
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
