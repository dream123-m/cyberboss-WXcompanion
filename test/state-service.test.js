const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { StateService } = require("../src/services/state-service");

function createService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-state-test-"));
  return new StateService({
    config: {
      stateStoreFile: path.join(dir, "memory-state.json"),
    },
  });
}

test("state service merges namespace patches durably", () => {
  const service = createService();
  const first = service.update({
    namespace: "relationship",
    patch: {
      intimacy: {
        score: 2,
        level: "warming",
      },
    },
    reason: "first meaningful signal",
  });
  const second = service.update({
    namespace: "relationship",
    patch: {
      intimacy: {
        score: 3,
      },
      lastSignal: "shared trust",
    },
  });
  const read = service.read({ namespace: "relationship" });

  assert.equal(first.namespace, "relationship");
  assert.deepEqual(second.value, {
    intimacy: {
      score: 3,
      level: "warming",
    },
    lastSignal: "shared trust",
  });
  assert.deepEqual(read.value, second.value);
});

test("state service can replace a namespace", () => {
  const service = createService();
  service.update({
    namespace: "self_notes",
    patch: { old: true },
  });
  const replaced = service.update({
    namespace: "self_notes",
    patch: { current: true },
    mode: "replace",
  });

  assert.deepEqual(replaced.value, { current: true });
});
