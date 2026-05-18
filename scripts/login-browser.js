const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const dotenv = require("dotenv");

const { readConfig } = require("../src/core/config");
const { saveWeixinAccount } = require("../src/adapters/channel/weixin/account-store");

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 8 * 60_000;

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".cyberboss", ".env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
  }
  dotenv.config();
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

async function fetchQrCode(apiBaseUrl, botType) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch QR code: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function pollQrStatus(apiBaseUrl, qrcode) {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`QR status polling failed: ${response.status} ${response.statusText} ${rawText}`);
    }
    return JSON.parse(rawText);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }
    throw error;
  }
}

function openInBrowser(url) {
  if (process.platform === "win32") {
    const candidates = [
      ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [url]],
      ["C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", [url]],
      ["C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", [url]],
      ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [url]],
      ["C:\\Program Files\\Mozilla Firefox\\firefox.exe", [url]],
      ["C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe", [url]],
      ["cmd.exe", ["/c", "start", "", url]],
      ["explorer.exe", [url]],
    ];
    for (const [command, args] of candidates) {
      if (command.endsWith(".exe") && command.includes(":") && !fs.existsSync(command)) {
        continue;
      }
      try {
        spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return;
      } catch {
        // Try the next browser/open handler.
      }
    }
    console.log("[cyberboss] could not open a browser automatically; copy the link above.");
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function main() {
  loadEnv();
  const config = readConfig();
  let qrResponse = await fetchQrCode(config.weixinBaseUrl, config.weixinQrBotType);
  let startedAt = Date.now();
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  console.log("[cyberboss] opening WeChat login QR link in your browser...");
  console.log(qrResponse.qrcode_img_content);
  openInBrowser(qrResponse.qrcode_img_content);
  console.log("[cyberboss] scan it with WeChat, then confirm on your phone.");

  while (Date.now() < deadline) {
    if (Date.now() - startedAt > ACTIVE_LOGIN_TTL_MS) {
      qrResponse = await fetchQrCode(config.weixinBaseUrl, config.weixinQrBotType);
      startedAt = Date.now();
      scannedPrinted = false;
      console.log("\n[cyberboss] QR expired; opening a fresh one...");
      console.log(qrResponse.qrcode_img_content);
      openInBrowser(qrResponse.qrcode_img_content);
    }

    const statusResponse = await pollQrStatus(config.weixinBaseUrl, qrResponse.qrcode);
    switch (statusResponse.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("\n[cyberboss] scanned. Confirm the login inside WeChat...\n");
          scannedPrinted = true;
        }
        break;
      case "expired":
        qrResponse = await fetchQrCode(config.weixinBaseUrl, config.weixinQrBotType);
        startedAt = Date.now();
        scannedPrinted = false;
        console.log("\n[cyberboss] QR expired; opening a fresh one...");
        console.log(qrResponse.qrcode_img_content);
        openInBrowser(qrResponse.qrcode_img_content);
        break;
      case "confirmed": {
        if (!statusResponse.bot_token || !statusResponse.ilink_bot_id) {
          throw new Error("Login succeeded but the response is missing token/account ID.");
        }
        const account = saveWeixinAccount(config, statusResponse.ilink_bot_id, {
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl || config.weixinBaseUrl,
          userId: statusResponse.ilink_user_id || "",
        });
        console.log("\n[cyberboss] connected to WeChat successfully.");
        console.log(`accountId: ${account.accountId}`);
        console.log(`userId: ${account.userId || "(unknown)"}`);
        console.log(`baseUrl: ${account.baseUrl}`);
        return;
      }
      default:
        process.stdout.write(`\n[cyberboss] status=${statusResponse.status || "unknown"}\n`);
        break;
    }
  }

  throw new Error("Login timed out.");
}

main().catch((error) => {
  console.error(`[cyberboss] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
