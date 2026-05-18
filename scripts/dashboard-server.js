const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { buildDashboardHtml } = require("./dashboard-page");
const { shouldUseSharedAppServer } = require("./shared-common");

const rootDir = path.resolve(__dirname, "..");
const stateDir = process.env.CYBERBOSS_STATE_DIR || path.join(os.homedir(), ".cyberboss");
const port = Number(process.env.CYBERBOSS_DASHBOARD_PORT || 8787);

const ROUTES = new Map([
  ["/", serveHtml],
  ["/api/status", serveStatus],
  ["/api/diary", serveDiary],
  ["/api/logs", serveLogs],
  ["/api/stickers", serveStickers],
  ["/api/sessions", serveSessions],
  ["/api/memory", serveMemory],
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/assets/stickers/")) {
      serveStickerAsset(req, res, url);
      return;
    }
    const handler = ROUTES.get(url.pathname);
    if (!handler) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    await handler(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error || "unknown error") });
  }
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Cyberboss dashboard: ${url}`);
});

function serveHtml(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(buildDashboardHtml());
}

function serveStatus(req, res) {
  const sessions = readJson(path.join(stateDir, "sessions.json"), {});
  const runtimeContext = readJson(path.join(stateDir, "project-tool-runtime-context.json"), {});
  const sharedAppServerEnabled = shouldUseSharedAppServer();
  const appPid = sharedAppServerEnabled ? readPid(path.join(stateDir, "logs", "shared-app-server.pid")) : 0;
  const bridgePid = readPid(path.join(stateDir, "logs", "shared-wechat.pid"));
  const bindings = Object.values(sessions.bindings || {});
  const latestBinding = bindings
    .slice()
    .sort((left, right) => Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0))[0] || null;
  sendJson(res, 200, {
    stateDir,
    rootDir,
    generatedAt: new Date().toISOString(),
    appServer: {
      pid: appPid || null,
      alive: sharedAppServerEnabled && appPid ? isPidAlive(appPid) : false,
      skipped: !sharedAppServerEnabled,
    },
    bridge: {
      pid: bridgePid || null,
      alive: bridgePid ? isPidAlive(bridgePid) : false,
    },
    latestBinding: latestBinding ? summarizeBinding(latestBinding) : null,
    runtimeContext,
  });
}

function serveDiary(req, res) {
  const diaryDir = path.join(stateDir, "diary");
  const files = listFiles(diaryDir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .reverse();
  const days = files.map((fileName) => {
    const filePath = path.join(diaryDir, fileName);
    const text = readText(filePath);
    return {
      date: path.basename(fileName, ".md"),
      fileName,
      updatedAt: readMtime(filePath),
      entries: parseDiaryEntries(text),
      raw: text,
    };
  });
  sendJson(res, 200, { days });
}

function serveLogs(req, res, url) {
  const limit = clamp(Number(url.searchParams.get("limit") || 240), 20, 1000);
  const logDir = path.join(stateDir, "logs");
  const files = listFiles(logDir)
    .filter((file) => file.endsWith(".log"))
    .sort();
  const logs = files.map((fileName) => {
    const filePath = path.join(logDir, fileName);
    const lines = tailLines(filePath, limit).map(stripAnsi);
    return {
      fileName,
      updatedAt: readMtime(filePath),
      lines,
      events: extractLogEvents(lines),
    };
  });
  sendJson(res, 200, { logs });
}

function serveStickers(req, res) {
  const stickerDir = path.join(stateDir, "stickers");
  const assetDir = path.join(stickerDir, "assets");
  const index = readJson(path.join(stickerDir, "index.json"), {});
  const tags = readJson(path.join(stickerDir, "tags.json"), []);
  const entries = Object.entries(index)
    .map(([stickerId, value]) => {
      const fileName = `${stickerId}.gif`;
      const filePath = path.join(assetDir, fileName);
      const stat = safeStat(filePath);
      return {
        stickerId,
        tags: Array.isArray(value?.tags) ? value.tags : [],
        desc: typeof value?.desc === "string" ? value.desc : "",
        fileName,
        exists: !!stat,
        size: stat?.size || 0,
        updatedAt: stat ? stat.mtime.toISOString() : "",
        assetUrl: stat ? `/assets/stickers/${encodeURIComponent(fileName)}` : "",
      };
    })
    .sort((left, right) => right.stickerId.localeCompare(left.stickerId));
  sendJson(res, 200, {
    tagCount: Array.isArray(tags) ? tags.length : 0,
    tags: Array.isArray(tags) ? tags : [],
    stickers: entries,
  });
}

function serveStickerAsset(req, res, url) {
  const rawName = decodeURIComponent(url.pathname.slice("/assets/stickers/".length));
  const fileName = path.basename(rawName);
  if (!/^stk_[a-zA-Z0-9_-]+\.gif$/.test(fileName)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const filePath = path.join(stateDir, "stickers", "assets", fileName);
  const stat = safeStat(filePath);
  if (!stat) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Cache-Control": "no-store",
    "Content-Length": String(stat.size),
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveSessions(req, res) {
  const sessions = readJson(path.join(stateDir, "sessions.json"), {});
  const bindings = Object.values(sessions.bindings || {})
    .map(summarizeBinding)
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
  sendJson(res, 200, { bindings });
}

function serveMemory(req, res) {
  const reminderState = readJson(path.join(stateDir, "reminder-queue.json"), {});
  const systemQueueState = readJson(path.join(stateDir, "system-message-queue.json"), {});
  const deferredReplyState = readJson(path.join(stateDir, "deferred-system-replies.json"), {});
  const durableState = readJson(path.join(stateDir, "memory-state.json"), {});
  const inboxFiles = walkFiles(path.join(stateDir, "inbox"), 80)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 30)
    .map((file) => ({
      name: path.basename(file.filePath),
      relativePath: path.relative(stateDir, file.filePath),
      size: file.size,
      updatedAt: new Date(file.mtimeMs).toISOString(),
    }));
  const timelineFiles = walkFiles(path.join(stateDir, "timeline"), 80)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 30)
    .map((file) => ({
      name: path.basename(file.filePath),
      relativePath: path.relative(stateDir, file.filePath),
      size: file.size,
      updatedAt: new Date(file.mtimeMs).toISOString(),
      preview: readText(file.filePath).slice(0, 420),
    }));
  sendJson(res, 200, {
    reminders: Array.isArray(reminderState?.reminders) ? reminderState.reminders : [],
    systemQueue: Array.isArray(systemQueueState?.messages) ? systemQueueState.messages : [],
    deferredReplies: Array.isArray(deferredReplyState?.replies) ? deferredReplyState.replies : [],
    durableState: durableState && typeof durableState === "object" ? durableState : {},
    inboxFiles,
    timelineFiles,
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value, null, 2));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readMtime(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return "";
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function listFiles(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function walkFiles(dirPath, limit = 200) {
  const results = [];
  const stack = [dirPath];
  while (stack.length && results.length < limit) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(filePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const stat = fs.statSync(filePath);
        results.push({
          filePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // ignore unreadable files
      }
    }
  }
  return results;
}

function readPid(filePath) {
  const raw = readText(filePath).trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function summarizeBinding(binding) {
  const runtimeMap = binding?.threadIdByWorkspaceRootByRuntime || {};
  return {
    bindingKey: binding?.bindingKey || "",
    workspaceId: binding?.workspaceId || "",
    accountId: binding?.accountId || "",
    senderId: binding?.senderId || "",
    activeWorkspaceRoot: binding?.activeWorkspaceRoot || "",
    modelByWorkspaceRoot: binding?.modelByWorkspaceRoot || {},
    threadIdByWorkspaceRootByRuntime: runtimeMap,
    updatedAt: binding?.updatedAt || "",
  };
}

function parseDiaryEntries(text) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(/^##\s+(\d{2}:\d{2})(?:\s+(.*))?$/);
    if (match) {
      if (current) {
        current.body = current.body.trim();
        current.summary = summarizeDiaryBody(current.body);
        current.tags = buildDiaryTags(current);
        entries.push(current);
      }
      current = {
        time: match[1],
        title: (match[2] || "").trim(),
        body: "",
        summary: "",
        tags: [],
      };
      continue;
    }
    if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) {
    current.body = current.body.trim();
    current.summary = summarizeDiaryBody(current.body);
    current.tags = buildDiaryTags(current);
    entries.push(current);
  }
  return entries;
}

function summarizeDiaryBody(body) {
  const compact = String(body || "")
    .replace(/[#*_>`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= 118) {
    return compact;
  }
  return `${compact.slice(0, 116)}...`;
}

function buildDiaryTags(entry) {
  const text = `${entry?.title || ""}\n${entry?.body || ""}`;
  const tags = new Set();
  const explicitTags = text.match(/#[\p{L}\p{N}_-]+/gu) || [];
  for (const tag of explicitTags.slice(0, 3)) {
    tags.add(tag.replace(/^#/, ""));
  }
  if (/night|sleep|22:|23:|晚|夜|睡|梦|安静/i.test(text)) {
    tags.add("夜间整理");
  }
  if (/user|你|她|陪|想念|在意|关系|亲密|喜欢/i.test(text)) {
    tags.add("关系");
  }
  if (/提醒|reminder|明天|后来|下次|记得/i.test(text)) {
    tags.add("待回望");
  }
  if (!tags.size) {
    tags.add("私密日记");
  }
  return Array.from(tags).slice(0, 4);
}

function tailLines(filePath, maxLines) {
  const text = readText(filePath);
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function extractLogEvents(lines) {
  return lines
    .filter((line) => /MCP tool call error|Transport closed|error:|WARN|failed|started|readyz/i.test(line))
    .slice(-80)
    .map((line) => {
      const level = /error|failed|Transport closed/i.test(line) ? "error" : /WARN/i.test(line) ? "warn" : "info";
      return { level, text: line };
    });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

