const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const host = "127.0.0.1";
const port = Number(process.env.CHATGPT_QUOTA_QA_PORT || 8769);
const rendererRoot = path.join(__dirname, "..", "src", "renderer");

const mockBridge = String.raw`
(() => {
  const listeners = { refresh: [], top: [], interval: [], blur: [], compact: [], approval: [] };
  let compact = false;
  const quota = {
    fetchedAt: new Date().toISOString(),
    planType: "plus",
    fiveHour: { remainingPercent: 40, resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() },
    weekly: { remainingPercent: 76, resetsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
    todayTokens: { available: true, totalTokens: 196300000, inputTokens: 156400000, outputTokens: 39900000, events: 42 }
  };
  window.codexQuota = {
    getQuota: async () => {
      document.body.dataset.qaQuotaCalls = String(Number(document.body.dataset.qaQuotaCalls || 0) + 1);
      return { ...quota, fetchedAt: new Date().toISOString() };
    },
    getRefreshIntervalMinutes: async () => 5,
    setRefreshIntervalMinutes: async (value) => value,
    getWindowOpacity: async () => 1,
    setWindowOpacity: async (value) => {
      document.documentElement.style.opacity = String(value);
      return value;
    },
    minimize: async () => true,
    getCompactMode: async () => compact,
    setCompactMode: async (value) => {
      compact = Boolean(value);
      listeners.compact.forEach((callback) => callback(compact));
      return compact;
    },
    moveCompactBy: (deltaX, deltaY) => {
      const moves = Number(document.body.dataset.qaCompactMoves || 0) + 1;
      document.body.dataset.qaCompactMoves = String(moves);
      document.body.dataset.qaCompactDelta = Math.round(deltaX) + "," + Math.round(deltaY);
    },
    setInteractionMode: async () => true,
    close: async () => true,
    getAlwaysOnTop: async () => true,
    setAlwaysOnTop: async (value) => value,
    openCodex: async () => true,
    isApprovalSupported: async () => true,
    prepareApprovalTarget: async () => ({ ok: true, target: { prepared: true } }),
    insertApproval: async () => ({ ok: true, target: { token: "qa-token" }, expiresAt: Date.now() + 12000 }),
    sendApproval: async () => ({ ok: true }),
    cancelApproval: async () => true,
    getApprovalWaitSeconds: async () => 12,
    setApprovalWaitSeconds: async (value) => value,
    getApprovalShortcutEnabled: async () => true,
    setApprovalShortcutEnabled: async (value) => Boolean(value),
    onRefresh: (callback) => listeners.refresh.push(callback),
    onAlwaysOnTopChanged: (callback) => listeners.top.push(callback),
    onRefreshIntervalChanged: (callback) => listeners.interval.push(callback),
    onWindowBlur: (callback) => listeners.blur.push(callback),
    onCompactModeChanged: (callback) => listeners.compact.push(callback),
    onApprovalStateChanged: (callback) => listeners.approval.push(callback)
  };
})();
`;

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function send(response, statusCode, type, body) {
  response.writeHead(statusCode, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${host}:${port}`).pathname;
  if (requestPath === "/qa-mock.js") {
    send(response, 200, "text/javascript; charset=utf-8", mockBridge);
    return;
  }

  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(rendererRoot, relativePath);
  if (!filePath.startsWith(rendererRoot + path.sep)) {
    send(response, 403, "text/plain; charset=utf-8", "Forbidden");
    return;
  }

  try {
    let body = fs.readFileSync(filePath);
    if (relativePath === "index.html") {
      body = Buffer.from(
        body.toString("utf8").replace(
          '<script src="./widget-logic.js"></script>',
          '<script src="./qa-mock.js"></script>\n    <script src="./widget-logic.js"></script>'
        ),
        "utf8"
      );
    }
    send(response, 200, contentType(filePath), body);
  } catch (error) {
    send(response, error.code === "ENOENT" ? 404 : 500, "text/plain; charset=utf-8", "Not found");
  }
});

server.listen(port, host, () => {
  console.log(`QA widget preview: http://${host}:${port}/`);
});
