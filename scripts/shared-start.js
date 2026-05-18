const fs = require("fs");
const { spawn } = require("child_process");
const {
  rootDir,
  stateDir,
  listenUrl,
  bridgePidFile,
  bridgeLogFile,
  ensureLogDir,
  writePidFile,
  removePidFileIfMatches,
  ensureSharedAppServer,
  ensureBridgeNotRunning,
  appServerPidFile,
  nightlyPidFile,
  nightlyLogFile,
  readPidFile,
  isPidAlive,
  spawnDetachedCommand,
} = require("./shared-common");

async function main() {
  const runtime = process.env.CYBERBOSS_RUNTIME || "codex";
  console.log(`starting shared bridge runtime=${runtime}`);
  const appServer = await ensureSharedAppServer();
  const appServerPidLabel = appServer.pid ? ` pid=${appServer.pid}` : "";
  if (appServer.status === "skipped") {
    fs.rmSync(appServerPidFile, { force: true });
    console.log(`shared app-server skipped (runtime=${runtime})`);
  } else {
    console.log(`shared app-server ${appServer.status}${appServerPidLabel} listen=${listenUrl}`);
  }
  const nightly = ensureNightlyRunning();
  console.log(`nightly ${nightly.status}${nightly.pid ? ` pid=${nightly.pid}` : ""} log=${nightlyLogFile}`);

  const existingBridgePid = ensureBridgeNotRunning();
  if (existingBridgePid) {
    console.log(`shared cyberboss already running pid=${existingBridgePid}`);
    return;
  }

  const childEnv = { ...process.env };
  const isCodex = runtime === "codex";
  if (isCodex && appServer.status !== "skipped") {
    childEnv.CYBERBOSS_CODEX_ENDPOINT = listenUrl;
  } else {
    delete childEnv.CYBERBOSS_CODEX_ENDPOINT;
  }

  ensureLogDir();
  const stdoutFd = fs.openSync(bridgeLogFile, "a");
  const stderrFd = fs.openSync(bridgeLogFile, "a");
  const child = spawn(process.execPath, ["./bin/cyberboss.js", "start", "--checkin"], {
    cwd: rootDir,
    env: childEnv,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  });
  console.log(`shared cyberboss log=${bridgeLogFile}`);

  writePidFile(bridgePidFile, child.pid);
  const cleanup = () => removePidFileIfMatches(bridgePidFile, child.pid);
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

function ensureNightlyRunning() {
  const existingPid = readPidFile(nightlyPidFile);
  if (existingPid && isPidAlive(existingPid)) {
    return { pid: existingPid, status: "already_running" };
  }
  if (existingPid) {
    fs.rmSync(nightlyPidFile, { force: true });
  }

  const command = process.env.CYBERBOSS_PYTHON || "python";
  const pid = spawnDetachedCommand(command, ["./scripts/nightly.py"], {
    logFile: nightlyLogFile,
    cwd: rootDir,
    env: {
      CYBERBOSS_STATE_DIR: stateDir,
      TIMELINE_FOR_AGENT_STATE_DIR: stateDir,
    },
  });
  if (!pid) {
    return { pid: 0, status: "failed_to_start" };
  }
  writePidFile(nightlyPidFile, pid);
  return { pid, status: "started" };
}
