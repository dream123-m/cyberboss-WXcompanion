const fs = require("fs");
const path = require("path");

class StateService {
  constructor({ config }) {
    this.filePath = config.stateStoreFile;
    this.state = createEmptyState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.state = normalizeState(parsed);
    } catch {
      this.state = createEmptyState();
    }
  }

  save() {
    this.ensureParentDirectory();
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  read({ namespace = "" } = {}) {
    this.load();
    const normalizedNamespace = normalizeNamespace(namespace, { allowEmpty: true });
    if (!normalizedNamespace) {
      return {
        filePath: this.filePath,
        namespaces: this.state.namespaces,
        updatedAt: this.state.updatedAt,
      };
    }
    return {
      filePath: this.filePath,
      namespace: normalizedNamespace,
      value: cloneJson(this.state.namespaces[normalizedNamespace] || {}),
      updatedAt: this.state.updatedAt,
    };
  }

  update({ namespace = "", patch = {}, mode = "merge", reason = "" } = {}) {
    this.load();
    const normalizedNamespace = normalizeNamespace(namespace);
    const normalizedMode = normalizeMode(mode);
    if (!isPlainObject(patch)) {
      throw new Error("state patch must be an object.");
    }

    const before = this.state.namespaces[normalizedNamespace];
    const nextValue = normalizedMode === "replace"
      ? cloneJson(patch)
      : deepMerge(isPlainObject(before) ? before : {}, patch);
    const updatedAt = new Date().toISOString();

    this.state.namespaces[normalizedNamespace] = nextValue;
    this.state.updatedAt = updatedAt;
    this.state.history.push({
      namespace: normalizedNamespace,
      mode: normalizedMode,
      reason: normalizeText(reason),
      updatedAt,
    });
    if (this.state.history.length > 200) {
      this.state.history = this.state.history.slice(-200);
    }
    this.save();

    return {
      filePath: this.filePath,
      namespace: normalizedNamespace,
      mode: normalizedMode,
      value: cloneJson(nextValue),
      updatedAt,
    };
  }
}

function createEmptyState() {
  return {
    namespaces: {},
    history: [],
    updatedAt: "",
  };
}

function normalizeState(value) {
  const state = createEmptyState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return state;
  }
  state.namespaces = isPlainObject(value.namespaces) ? value.namespaces : {};
  state.history = Array.isArray(value.history)
    ? value.history.filter((entry) => entry && typeof entry === "object").slice(-200)
    : [];
  state.updatedAt = normalizeText(value.updatedAt);
  return state;
}

function normalizeNamespace(value, { allowEmpty = false } = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    if (allowEmpty) {
      return "";
    }
    throw new Error("state namespace is required.");
  }
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized)) {
    throw new Error("state namespace may only contain letters, numbers, _, ., :, or -.");
  }
  return normalized;
}

function normalizeMode(value) {
  const normalized = normalizeText(value).toLowerCase() || "merge";
  if (normalized === "merge" || normalized === "replace") {
    return normalized;
  }
  throw new Error("state mode must be merge or replace.");
}

function deepMerge(base, patch) {
  const result = cloneJson(base);
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = cloneJson(value);
    }
  }
  return result;
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  StateService,
  deepMerge,
};
