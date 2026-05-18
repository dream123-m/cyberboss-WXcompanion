const crypto = require("crypto");

const { resolveSelectedAccount } = require("../adapters/channel/weixin/account-store");
const { SessionStore } = require("../adapters/runtime/codex/session-store");
const { CheckinConfigStore, resolveDefaultCheckinRange } = require("../core/checkin-config-store");
const { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } = require("../core/default-targets");
const { SystemMessageQueueStore } = require("../core/system-message-queue-store");

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "%USER% comes to mind again.";

async function runSystemCheckinPoller(config) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const checkinConfigStore = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const defaultRange = resolveDefaultCheckinRange();
  let currentRange = checkinConfigStore.getRange(defaultRange);

  console.log(`[cyberboss] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[cyberboss] checkin interval range ${formatRangeMinutes(currentRange)}`);
  console.log(`[cyberboss] checkin quiet hours ${formatQuietHours(config)}`);

  while (true) {
    currentRange = checkinConfigStore.getRange(defaultRange);
    const delayMs = pickRandomDelayMs(currentRange.minIntervalMs, currentRange.maxIntervalMs);
    const scheduledWakeAt = new Date(Date.now() + delayMs);
    const wakeAt = adjustForQuietHours(scheduledWakeAt, config);
    const adjustedDelayMs = Math.max(0, wakeAt.getTime() - Date.now());
    const quietNote = wakeAt.getTime() !== scheduledWakeAt.getTime()
      ? ` (moved from ${formatLocalTime(scheduledWakeAt)} by quiet hours)`
      : "";
    console.log(`[cyberboss] next checkin in ${Math.round(adjustedDelayMs / 60000)}m at ${formatLocalTime(wakeAt)}${quietNote}`);
    await sleep(adjustedDelayMs);

    if (queue.hasPendingForAccount(account.accountId)) {
      console.log("[cyberboss] checkin skipped: pending system message still in queue");
      continue;
    }

    if (isInQuietHours(new Date(), config)) {
      console.log("[cyberboss] checkin skipped: currently inside quiet hours");
      continue;
    }

    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId: target.senderId,
      workspaceRoot: target.workspaceRoot,
      text: buildCheckinTrigger(config),
      createdAt: new Date().toISOString(),
    });
    console.log(`[cyberboss] checkin queued id=${queued.id}`);
  }
}

function resolvePollerTarget({ config, account, sessionStore }) {
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: process.env.CYBERBOSS_CHECKIN_USER_ID || "",
    sessionStore,
  });
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: process.env.CYBERBOSS_CHECKIN_WORKSPACE || "",
    sessionStore,
  });

  if (!senderId) {
    throw new Error("Cannot determine the WeChat user for the checkin poller. Set CYBERBOSS_CHECKIN_USER_ID or let the only active user talk to the bot once first.");
  }
  if (!workspaceRoot) {
    throw new Error("Cannot determine the workspace for the checkin poller. Set CYBERBOSS_WORKSPACE_ROOT first.");
  }

  return { senderId, workspaceRoot };
}

function pickRandomDelayMs(minIntervalMs, maxIntervalMs) {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

function adjustForQuietHours(date, config) {
  if (!isInQuietHours(date, config)) {
    return date;
  }
  return resolveQuietEnd(date, config);
}

function isInQuietHours(date, config) {
  const quietRange = readQuietRange(config);
  if (!quietRange) {
    return false;
  }
  const minuteOfDay = getLocalMinuteOfDay(date);
  const { startMinute, endMinute } = quietRange;
  if (startMinute === endMinute) {
    return false;
  }
  if (startMinute < endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

function resolveQuietEnd(date, config) {
  const quietRange = readQuietRange(config);
  if (!quietRange) {
    return date;
  }

  const parts = getShanghaiDateParts(date);
  const endHour = Math.floor(quietRange.endMinute / 60);
  const endMinute = quietRange.endMinute % 60;
  const endToday = new Date(parts.year, parts.month - 1, parts.day, endHour, endMinute, 0, 0);
  if (endToday.getTime() > date.getTime()) {
    return endToday;
  }

  const endTomorrow = new Date(endToday);
  endTomorrow.setDate(endTomorrow.getDate() + 1);
  return endTomorrow;
}

function readQuietRange(config) {
  const startMinute = parseClockMinutes(process.env.CYBERBOSS_CHECKIN_QUIET_START || config?.checkinQuietStart || "");
  const endMinute = parseClockMinutes(process.env.CYBERBOSS_CHECKIN_QUIET_END || config?.checkinQuietEnd || "");
  if (startMinute === null || endMinute === null) {
    return null;
  }
  return { startMinute, endMinute };
}

function parseClockMinutes(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2] || "0", 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function getLocalMinuteOfDay(date) {
  const parts = getShanghaiDateParts(date);
  return parts.hour * 60 + parts.minute;
}

function getShanghaiDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number.parseInt(map.year, 10),
    month: Number.parseInt(map.month, 10),
    day: Number.parseInt(map.day, 10),
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10),
  };
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function formatRangeMinutes(range) {
  return `${Math.round(range.minIntervalMs / 60000)}m-${Math.round(range.maxIntervalMs / 60000)}m`;
}

function formatQuietHours(config) {
  const quietRange = readQuietRange(config);
  if (!quietRange) {
    return "off";
  }
  return `${formatClockMinutes(quietRange.startMinute)}-${formatClockMinutes(quietRange.endMinute)}`;
}

function formatClockMinutes(value) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildCheckinTrigger(config) {
  const userName = normalizeText(config?.userName) || "the user";
  return INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%USER%", userName);
}

module.exports = { runSystemCheckinPoller };
