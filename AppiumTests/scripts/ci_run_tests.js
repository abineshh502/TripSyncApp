/**
 * TripSync Appium E2E — CI Orchestration Script
 * Windows-compatible Node.js script for Self-Hosted GitHub Actions Runner.
 *
 * Intelligence built in:
 *  - Reuse running emulator (skip boot)
 *  - Reuse installed APK (skip install)
 *  - Reuse running Appium server (skip start)
 *  - Skip gradlew clean unless new build requested
 *  - Collect adb logcat on completion
 */

"use strict";

const { execSync, spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const APP_PACKAGE = "com.kondajeswanth.TripSyncApp";
const APP_ACTIVITY = `${APP_PACKAGE}.MainActivity`;
const APK_PATH = path.resolve(
  __dirname,
  "../../android/app/build/outputs/apk/debug/app-debug.apk"
);
const APPIUM_PORT = 4723;
const APPIUM_STATUS_URL = `http://127.0.0.1:${APPIUM_PORT}/status`;
const RESULTS_DIR = path.resolve(__dirname, "../../test-results");
const APPIUM_LOG = path.join(RESULTS_DIR, "appium.log");
const WDIO_CONF = path.resolve(__dirname, "../wdio.conf.js");
const AVD_NAME = process.env.AVD_NAME || "Pixel_6_API_30";
let ADB = process.env.ADB_PATH || "adb";
const APPIUM_BIN = path.resolve(__dirname, "../../node_modules/.bin/appium");
const WDIO_BIN = path.resolve(__dirname, "../../node_modules/.bin/wdio");

let appiumProcess = null;

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function log(emoji, msg) {
  const ts = new Date().toTimeString().substring(0, 8);
  console.log(`[${ts}] ${emoji}  ${msg}`);
}

function run(cmd, opts) {
  log("⚙️", `$ ${cmd}`);
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts });
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
  } catch (_) {
    return "";
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─────────────────────────────────────────────
// STEP 1 — VERIFY ADB AVAILABLE
// ─────────────────────────────────────────────

async function verifyAdb() {
  log("🔧", "Verifying ADB availability...");
  try {
    const out = run(`${ADB} version`);
    log("✅", `ADB found: ${out.split("\n")[0].trim()}`);
  } catch (e) {
    throw new Error(`ADB not found. Ensure Android SDK platform-tools is on PATH.\n${e.message}`);
  }
}

// ─────────────────────────────────────────────
// STEP 2 — DETECT OR BOOT EMULATOR
// ─────────────────────────────────────────────

async function detectOrBootEmulator() {
  log("📱", "Checking for running emulators...");
  const devices = runSilent(`${ADB} devices`);
  const lines = devices.split("\n").filter((l) => l.includes("emulator") && l.includes("device"));

  if (lines.length > 0) {
    const emulatorId = lines[0].split("\t")[0].trim();
    log("✅", `Reusing existing emulator: ${emulatorId}`);
    process.env.DEVICE_NAME = emulatorId;
    ADB = `adb -s ${emulatorId}`; // dynamically target the correct emulator ID
    return emulatorId;
  }

  log("🚀", `No emulator running. Booting AVD: ${AVD_NAME}`);
  const emulatorBin = process.env.EMULATOR_PATH || "emulator";
  spawn(emulatorBin, ["-avd", AVD_NAME, "-no-snapshot-load", "-no-audio"], {
    detached: true,
    stdio: "ignore",
  }).unref();

  log("⏳", "Waiting for emulator to boot (up to 180s)...");
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    const booted = runSilent(`${ADB} shell getprop sys.boot_completed`).trim();
    if (booted === "1") {
      log("✅", "Emulator boot completed.");
      const newDevices = runSilent(`adb devices`); // use raw adb to list devices
      const newLine = newDevices.split("\n").find(
        (l) => l.includes("emulator") && l.includes("device")
      );
      const emId = newLine ? newLine.split("\t")[0].trim() : "emulator-5554";
      process.env.DEVICE_NAME = emId;
      ADB = `adb -s ${emId}`; // dynamically target the correct emulator ID
      return emId;
    }
    log("⏳", `Still booting... (${(i + 1) * 5}s elapsed)`);
  }
  throw new Error("Emulator failed to boot within 180 seconds.");
}

// ─────────────────────────────────────────────
// STEP 3 — DETECT OR INSTALL APK
// ─────────────────────────────────────────────

async function detectOrInstallApk() {
  log("📦", "Checking if APK is already installed...");
  const installed = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();

  if (installed.includes(APP_PACKAGE)) {
    log("✅", `${APP_PACKAGE} already installed. Force-stopping for clean state.`);
    runSilent(`${ADB} shell am force-stop ${APP_PACKAGE}`);
    await sleep(1000);
    return;
  }

  if (!fs.existsSync(APK_PATH)) {
    throw new Error(`APK not found at: ${APK_PATH}\nRun the build step first.`);
  }

  log("📲", `Installing APK: ${APK_PATH}`);
  run(`${ADB} install -r "${APK_PATH}"`);
  await sleep(2000);

  const verify = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();
  if (!verify.includes(APP_PACKAGE)) {
    throw new Error(`APK install verification failed. Package ${APP_PACKAGE} not found.`);
  }
  log("✅", "APK installed and verified.");
}

// ─────────────────────────────────────────────
// STEP 4 — LAUNCH APP
// ─────────────────────────────────────────────

async function launchApp() {
  log("🚀", `Launching: ${APP_ACTIVITY}`);
  runSilent(`${ADB} shell am start -n "${APP_PACKAGE}/${APP_ACTIVITY}"`);
  await sleep(3000);
  log("✅", "App launch command sent.");
}

// ─────────────────────────────────────────────
// STEP 5 — DETECT OR START APPIUM
// ─────────────────────────────────────────────

async function checkAppiumRunning() {
  return new Promise((resolve) => {
    const req = http.get(APPIUM_STATUS_URL, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function detectOrStartAppium() {
  log("🔍", `Checking Appium on port ${APPIUM_PORT}...`);

  if (await checkAppiumRunning()) {
    log("✅", "Appium already running. Reusing existing server.");
    return;
  }

  log("🚀", "Starting Appium server...");
  ensureDir(RESULTS_DIR);

  const logStream = fs.createWriteStream(APPIUM_LOG, { flags: "a" });
  const appiumCmd = process.platform === "win32" ? `${APPIUM_BIN}.cmd` : APPIUM_BIN;

  appiumProcess = spawn(appiumCmd, [
    "--port", String(APPIUM_PORT),
    "--log-level", "info",
    "--relaxed-security",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    shell: true,
  });

  appiumProcess.stdout.pipe(logStream);
  appiumProcess.stderr.pipe(logStream);

  appiumProcess.on("error", (err) => {
    log("❌", `Appium process error: ${err.message}`);
  });

  log("⏳", "Waiting for Appium to become ready...");
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    if (await checkAppiumRunning()) {
      log("✅", `Appium is ready at :${APPIUM_PORT}`);
      return;
    }
  }
  throw new Error(`Appium did not become ready on port ${APPIUM_PORT} within 60 seconds.`);
}

// ─────────────────────────────────────────────
// STEP 6 — VERIFY APPIUM SESSION
// ─────────────────────────────────────────────

async function verifyAppiumSession() {
  log("🔗", "Verifying Appium /status endpoint...");
  const ok = await checkAppiumRunning();
  if (!ok) {
    throw new Error("Appium /status check failed. Cannot proceed without Appium session.");
  }

  const statusData = await new Promise((resolve, reject) => {
    http.get(APPIUM_STATUS_URL, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (_) { resolve({}); }
      });
    }).on("error", reject);
  });

  const appiumVersion = statusData?.value?.build?.version || "unknown";
  log("✅", `Appium responding. Version: ${appiumVersion}`);
  process.env.APPIUM_VERSION = appiumVersion;

  // Inject into run meta for reports
  const metaPath = path.join(RESULTS_DIR, ".run-meta.json");
  ensureDir(RESULTS_DIR);
  const devices = runSilent(`${ADB} devices`);
  const deviceLine = devices.split("\n").find(
    (l) => l.includes("emulator") || l.includes("device\t")
  );
  const deviceId = deviceLine ? deviceLine.split("\t")[0].trim() : "Unknown";
  const androidVer = runSilent(`${ADB} shell getprop ro.build.version.release`).trim() || "Unknown";
  const buildNum = runSilent(`${ADB} shell getprop ro.build.display.id`).trim() || "Unknown";

  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      device: process.env.DEVICE_NAME || deviceId,
      androidVersion: androidVer,
      buildNumber: buildNum,
      appiumVersion,
      appVersion: "1.0.0",
    }),
    "utf-8"
  );
  log("✅", `Device: ${deviceId} | Android: ${androidVer} | Appium: ${appiumVersion}`);
}

// ─────────────────────────────────────────────
// STEP 7 — RUN WDIO TESTS
// ─────────────────────────────────────────────

async function runWdio() {
  log("🧪", "Starting WebDriverIO test execution...");
  const spec = process.env.WDIO_CI_SPEC || "";
  const wdioCmd = process.platform === "win32" ? `${WDIO_BIN}.cmd` : WDIO_BIN;

  const args = ["run", WDIO_CONF];
  if (spec) {
    args.push("--spec", spec);
    log("📋", `Running single spec: ${spec}`);
  } else {
    log("📋", "Running all 550 tests across 11 suites");
  }

  return new Promise((resolve) => {
    const wdio = spawn(wdioCmd, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        APPIUM_PORT: String(APPIUM_PORT),
      },
      shell: true,
    });

    wdio.on("close", (code) => {
      if (code === 0) {
        log("✅", "WDIO tests completed successfully.");
      } else {
        log("⚠️", `WDIO exited with code ${code}. Check results for failures.`);
      }
      resolve(code);
    });

    wdio.on("error", (err) => {
      log("❌", `WDIO process error: ${err.message}`);
      resolve(1);
    });
  });
}

// ─────────────────────────────────────────────
// STEP 8 — COLLECT ADB LOGCAT
// ─────────────────────────────────────────────

async function collectLogs() {
  log("📋", "Collecting ADB logcat...");
  try {
    const logcatPath = path.join(RESULTS_DIR, "adb-logcat.log");
    const logcat = runSilent(
      `${ADB} logcat -d -v threadtime *:W`
    ).substring(0, 500000); // cap at 500KB
    fs.writeFileSync(logcatPath, logcat, "utf-8");
    log("✅", `Logcat saved: ${logcatPath}`);
  } catch (e) {
    log("⚠️", `Logcat collection failed: ${e.message}`);
  }

  // ADB activity info
  try {
    const activityInfo = runSilent(`${ADB} shell dumpsys activity activities | head -50`);
    const actPath = path.join(RESULTS_DIR, "adb-activity.log");
    fs.writeFileSync(actPath, activityInfo, "utf-8");
    log("✅", `Activity dump saved: ${actPath}`);
  } catch (_) {}
}

// ─────────────────────────────────────────────
// STEP 9 — CLEANUP
// ─────────────────────────────────────────────

function cleanup() {
  if (appiumProcess) {
    log("🛑", "Stopping Appium server (started by this script)...");
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${appiumProcess.pid} /T`, { stdio: "pipe" });
      } else {
        appiumProcess.kill("SIGTERM");
      }
    } catch (_) {}
  }
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(60));
  console.log(" TripSync Android E2E — CI Orchestrator");
  console.log(" Self-Hosted Windows Runner");
  console.log("═".repeat(60) + "\n");

  ensureDir(RESULTS_DIR);
  ensureDir(path.join(RESULTS_DIR, "html"));
  ensureDir(path.join(RESULTS_DIR, "screenshots"));

  let wdioExitCode = 1;

  try {
    await verifyAdb();                   // Step 1
    await detectOrBootEmulator();        // Step 2 — reuse if possible
    await detectOrInstallApk();          // Step 3 — reuse if possible
    await launchApp();                   // Step 4
    await detectOrStartAppium();         // Step 5 — reuse if possible
    await verifyAppiumSession();         // Step 6 — FATAL if fails
    wdioExitCode = await runWdio();      // Step 7
  } catch (err) {
    log("❌", `FATAL: ${err.message}`);
    console.error(err.stack);
    wdioExitCode = 1;
  } finally {
    await collectLogs();                 // Step 8 — always collect
    cleanup();                           // Step 9
  }

  console.log("\n" + "═".repeat(60));
  log(wdioExitCode === 0 ? "🎉" : "❌", `CI Run finished. Exit code: ${wdioExitCode}`);
  console.log("═".repeat(60) + "\n");

  process.exit(wdioExitCode);
}

// Handle process signals
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
