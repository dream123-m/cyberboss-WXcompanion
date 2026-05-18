class TurnGateStore {
  constructor() {
    this.scopeByThreadId = new Map();
    this.pendingByScopeKey = new Map();
  }

  begin(bindingKey, workspaceRoot, { nowMs = Date.now() } = {}) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) {
      return "";
    }
    this.pendingByScopeKey.set(scopeKey, {
      scopeKey,
      bindingKey: normalizeText(bindingKey),
      workspaceRoot: normalizeText(workspaceRoot),
      threadId: "",
      startedAtMs: normalizeTimestampMs(nowMs),
    });
    return scopeKey;
  }

  attachThread(scopeKey, threadId) {
    const normalizedScopeKey = normalizeText(scopeKey);
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedScopeKey || !normalizedThreadId) {
      return;
    }
    const pending = this.pendingByScopeKey.get(normalizedScopeKey);
    if (pending) {
      this.pendingByScopeKey.set(normalizedScopeKey, {
        ...pending,
        threadId: normalizedThreadId,
      });
    }
    this.scopeByThreadId.set(normalizedThreadId, normalizedScopeKey);
  }

  releaseScope(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    if (!scopeKey) {
      return;
    }
    this.pendingByScopeKey.delete(scopeKey);
    for (const [threadId, mappedScopeKey] of this.scopeByThreadId.entries()) {
      if (mappedScopeKey === scopeKey) {
        this.scopeByThreadId.delete(threadId);
      }
    }
  }

  releaseThread(threadId) {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const scopeKey = this.scopeByThreadId.get(normalizedThreadId) || "";
    if (scopeKey) {
      this.pendingByScopeKey.delete(scopeKey);
      this.scopeByThreadId.delete(normalizedThreadId);
    }
  }

  isPending(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    return scopeKey ? this.pendingByScopeKey.has(scopeKey) : false;
  }

  getPending(bindingKey, workspaceRoot) {
    const scopeKey = buildTurnScopeKey(bindingKey, workspaceRoot);
    const pending = scopeKey ? this.pendingByScopeKey.get(scopeKey) : null;
    return pending ? { ...pending } : null;
  }

  releasePending(bindingKey, workspaceRoot) {
    this.releaseScope(bindingKey, workspaceRoot);
  }
}

function buildTurnScopeKey(bindingKey, workspaceRoot) {
  const normalizedBindingKey = normalizeText(bindingKey);
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
  if (!normalizedBindingKey || !normalizedWorkspaceRoot) {
    return "";
  }
  return `${normalizedBindingKey}::${normalizedWorkspaceRoot}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestampMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : Date.now();
}

module.exports = { TurnGateStore };
