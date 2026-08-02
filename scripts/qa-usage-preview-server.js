const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createUsageService } = require("../src/main/usage-service");

const host = "127.0.0.1";
const port = Number(process.env.CHATGPT_QUOTA_USAGE_PREVIEW_PORT || 8770);
const rendererRoot = path.join(__dirname, "..", "src", "renderer");
const allowedFiles = new Set(["usage.html", "usage.css", "usage-logic.js", "usage.js"]);
const usageService = createUsageService({ cacheFile: null });

function contentType(fileName) {
  if (fileName.endsWith(".html")) return "text/html; charset=utf-8";
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function send(response, statusCode, type, body) {
  response.writeHead(statusCode, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  response.end(body);
}

function sendJson(response, statusCode, value) {
  send(response, statusCode, "application/json; charset=utf-8", JSON.stringify(value));
}

function publicUsageData(data) {
  return {
    source: data.source,
    generatedAt: data.generatedAt,
    filesIndexed: data.filesIndexed,
    changedFiles: data.changedFiles,
    events: (data.events || []).map((event) => ({
      timestamp: event.timestamp,
      model: event.model,
      effort: event.effort,
      usage: {
        inputTokens: event.usage?.inputTokens || 0,
        cachedInputTokens: event.usage?.cachedInputTokens || 0,
        outputTokens: event.usage?.outputTokens || 0
      }
    }))
  };
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") {
    send(response, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }

  const requestPath = new URL(request.url, `http://${host}:${port}`).pathname;
  if (requestPath === "/api/usage") {
    try {
      sendJson(response, 200, publicUsageData(await usageService.getUsageData()));
    } catch (error) {
      console.error("Usage preview read failed:", error?.message || error);
      sendJson(response, 500, { error: "无法读取本地 Codex 用量日志。" });
    }
    return;
  }

  const fileName = requestPath === "/" ? "usage.html" : requestPath.replace(/^\/+/, "");
  if (!allowedFiles.has(fileName)) {
    send(response, 404, "text/plain; charset=utf-8", "Not found");
    return;
  }

  try {
    const filePath = path.join(rendererRoot, fileName);
    send(response, 200, contentType(fileName), await fs.promises.readFile(filePath));
  } catch {
    send(response, 500, "text/plain; charset=utf-8", "Unable to load preview asset");
  }
});

server.listen(port, host, () => {
  console.log(`Real usage HTML preview: http://${host}:${port}/`);
});

