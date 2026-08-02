const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CACHE_VERSION = 1;

function defaultSessionsRoot(env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(env.CODEX_HOME || path.join(home, ".codex"), "sessions");
}

function createUsageService({ sessionsRoot = defaultSessionsRoot(), cacheFile = null } = {}) {
  let activeRequest = null;
  let memoryCache = null;

  async function getUsageData({ onProgress } = {}) {
    if (activeRequest) return activeRequest;
    activeRequest = buildUsageData(onProgress);
    try {
      return await activeRequest;
    } finally {
      activeRequest = null;
    }
  }

  async function buildUsageData(onProgress) {
    const files = await listJsonlFiles(sessionsRoot);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const cache = memoryCache || await loadCache(cacheFile);
    let dirtyFiles = 0;
    const livePaths = new Set(files.map((file) => file.path));
    for (const cachedPath of Object.keys(cache.files)) {
      if (!livePaths.has(cachedPath) && cache.files[cachedPath]?.archived !== true) {
        cache.files[cachedPath].archived = true;
        dirtyFiles += 1;
      }
    }

    let processedBytes = 0;
    let changedFiles = 0;
    notifyProgress(onProgress, { phase: "indexing", processedBytes, totalBytes, filesDone: 0, filesTotal: files.length });

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      let state = cache.files[file.path];
      if (state?.archived === true) {
        state.archived = false;
        dirtyFiles += 1;
      }
      const unchanged = state && state.size === file.size && state.mtimeMs === file.mtimeMs;
      if (!unchanged) {
        changedFiles += 1;
        if (!state || file.size < state.offset) state = emptyFileState();
        state = await parseFileIncrement(file.path, state);
        state.size = file.size;
        state.mtimeMs = file.mtimeMs;
        cache.files[file.path] = state;
        dirtyFiles += 1;
        if (cacheFile && dirtyFiles >= 8) {
          await saveCache(cacheFile, cache);
          dirtyFiles = 0;
        }
      }
      processedBytes += file.size;
      notifyProgress(onProgress, {
        phase: "indexing",
        processedBytes,
        totalBytes,
        filesDone: index + 1,
        filesTotal: files.length,
        currentFile: path.basename(file.path)
      });
    }

    if (cacheFile && dirtyFiles > 0) await saveCache(cacheFile, cache);

    memoryCache = cache;
    const events = deduplicateEvents(Object.values(cache.files).flatMap((file) => file.events || []));
    notifyProgress(onProgress, { phase: "complete", processedBytes: totalBytes, totalBytes, filesDone: files.length, filesTotal: files.length });
    return {
      source: "codex-session-logs",
      generatedAt: new Date().toISOString(),
      sessionsRoot,
      filesIndexed: files.length,
      filesRetained: Object.keys(cache.files).length,
      archivedFiles: Object.values(cache.files).filter((file) => file.archived === true).length,
      changedFiles,
      totalBytes,
      events
    };
  }

  return { getUsageData };
}

function emptyFileState() {
  return {
    size: 0,
    mtimeMs: 0,
    offset: 0,
    lastCumulativeTotal: null,
    archived: false,
    context: { model: "unknown", effort: "unknown", turnId: null },
    events: []
  };
}

async function listJsonlFiles(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = await fs.promises.stat(fullPath);
          files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // A live rollout can disappear between directory listing and stat.
        }
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function parseFileIncrement(file, previousState) {
  const state = {
    ...emptyFileState(),
    ...previousState,
    context: { ...emptyFileState().context, ...(previousState.context || {}) },
    events: [...(previousState.events || [])]
  };
  const stream = fs.createReadStream(file, { start: state.offset });
  let consumedBytes = state.offset;
  let lineBytes = 0;
  let prefix = Buffer.alloc(0);
  let relevant = false;
  let decided = false;
  let relevantParts = [];

  const resetLine = () => {
    lineBytes = 0;
    prefix = Buffer.alloc(0);
    relevant = false;
    decided = false;
    relevantParts = [];
  };

  const consumePart = (part, ended) => {
    lineBytes += part.length;
    if (!decided) {
      const remaining = Math.max(0, 4096 - prefix.length);
      const prefixPart = part.subarray(0, remaining);
      if (prefixPart.length) prefix = Buffer.concat([prefix, prefixPart]);
      relevant = isUsageLinePrefix(prefix.toString("utf8"));
      decided = relevant || prefix.length >= 4096 || ended;
      if (relevant) {
        relevantParts = [prefix];
        if (part.length > prefixPart.length) relevantParts.push(part.subarray(prefixPart.length));
      }
    } else if (relevant && part.length) {
      relevantParts.push(part);
    }

    if (!ended) return;
    consumedBytes += lineBytes + 1;
    if (relevant) processLine(Buffer.concat(relevantParts).toString("utf8").trimEnd(), state);
    resetLine();
  };

  for await (const chunk of stream) {
    let start = 0;
    let newlineIndex;
    while ((newlineIndex = chunk.indexOf(0x0a, start)) >= 0) {
      consumePart(chunk.subarray(start, newlineIndex), true);
      start = newlineIndex + 1;
    }
    if (start < chunk.length) consumePart(chunk.subarray(start), false);
  }
  state.offset = consumedBytes;
  return state;
}

function isUsageLinePrefix(prefix) {
  return /"type"\s*:\s*"(?:turn_context|token_count)"/.test(prefix);
}

function processLine(line, state) {
  if (!line || (!line.includes('"turn_context"') && !line.includes('"token_count"'))) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  if (entry.type === "turn_context") {
    state.context = {
      model: normalizeText(entry.payload?.model),
      effort: normalizeText(entry.payload?.effort),
      turnId: entry.payload?.turn_id || null
    };
    return;
  }
  if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") return;

  const info = entry.payload.info;
  const usage = info?.last_token_usage;
  const cumulative = numberOrNull(info?.total_token_usage?.total_tokens);
  if (!usage || cumulative === null) return;
  const previous = numberOrNull(state.lastCumulativeTotal);
  // Equal counters are repeated snapshots. A lower counter indicates that
  // Codex started a new cumulative-counting epoch and must not hide new usage.
  if (previous !== null && cumulative === previous) return;
  state.lastCumulativeTotal = cumulative;

  const inputTokens = numberOrZero(usage.input_tokens);
  const cachedInputTokens = Math.min(inputTokens, numberOrZero(usage.cached_input_tokens));
  const outputTokens = numberOrZero(usage.output_tokens);
  if (inputTokens + outputTokens <= 0) return;
  const timestamp = new Date(entry.timestamp);
  if (!Number.isFinite(timestamp.getTime())) return;

  state.events.push({
    timestamp: timestamp.toISOString(),
    model: state.context.model,
    effort: state.context.effort,
    turnId: state.context.turnId,
    cumulativeTotal: cumulative,
    usage: { inputTokens, cachedInputTokens, outputTokens }
  });
}

function deduplicateEvents(events) {
  const unique = new Map();
  for (const event of events || []) {
    const usage = event.usage || {};
    const key = [
      String(event.timestamp || "").slice(0, 19),
      numberOrZero(event.cumulativeTotal),
      numberOrZero(usage.inputTokens),
      numberOrZero(usage.cachedInputTokens),
      numberOrZero(usage.outputTokens)
    ].join(":");
    const existing = unique.get(key);
    if (!existing || eventQuality(event) > eventQuality(existing)) unique.set(key, event);
  }
  return [...unique.values()].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

function eventQuality(event) {
  let score = 0;
  if (event.model && event.model !== "unknown") score += 2;
  if (event.effort && event.effort !== "unknown") score += 1;
  if (event.turnId) score += 1;
  return score;
}

async function loadCache(cacheFile) {
  if (!cacheFile) return { version: CACHE_VERSION, files: {} };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(cacheFile, "utf8"));
    if (parsed?.version === CACHE_VERSION && parsed.files && typeof parsed.files === "object") return parsed;
  } catch {
    // Missing, stale, or partial caches are rebuilt from source logs.
  }
  return { version: CACHE_VERSION, files: {} };
}

async function saveCache(cacheFile, cache) {
  await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
  const temporary = `${cacheFile}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(cache), "utf8");
  await fs.promises.rename(temporary, cacheFile);
}

function notifyProgress(callback, progress) {
  if (typeof callback === "function") callback({
    ...progress,
    percent: progress.totalBytes > 0 ? Math.round(progress.processedBytes / progress.totalBytes * 100) : 100
  });
}

function normalizeText(value) {
  const text = String(value || "unknown").trim().toLowerCase();
  return text || "unknown";
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

let defaultService = createUsageService();

function configureUsageService(options) {
  defaultService = createUsageService(options);
  return defaultService;
}

function getUsageData(options) {
  return defaultService.getUsageData(options);
}

module.exports = {
  CACHE_VERSION,
  createUsageService,
  configureUsageService,
  getUsageData,
  listJsonlFiles,
  processLine,
  deduplicateEvents
};
