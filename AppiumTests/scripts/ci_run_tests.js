/**
 * TripSync Appium E2E — CI Orchestration Script
 * Windows-compatible Node.js script for Self-Hosted GitHub Actions Runner.
 *
 * Key guarantees:
 *  1. Always force-reinstalls the APK (clears stale cached installs).
 *  2. Verifies the app is in the FOREGROUND before WDIO starts.
 *  3. Saves a screenshot and page source on failure.
 *  4. Hard-fails if the app is not visible — never enters an infinite loop.
 */

"use strict";

const { execSync, spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const APP_PACKAGE  = "com.kondajeswanth.TripSyncApp";
const APP_ACTIVITY = "com.kondajeswanth.TripSyncApp.MainActivity";
// appWaitActivity uses a wildcard to match any activity in the package after startup
const APP_WAIT_ACTIVITY = "com.kondajeswanth.TripSyncApp.*";

const APK_PATH = path.resolve(
  __dirname,
  "../../android/app/build/outputs/apk/debug/app-debug.apk"
);
const APPIUM_PORT       = 4723;
const APPIUM_STATUS_URL = `http://127.0.0.1:${APPIUM_PORT}/status`;
const RESULTS_DIR       = path.resolve(__dirname, "../../test-results");
const APPIUM_LOG        = path.join(RESULTS_DIR, "appium.log");
const WDIO_CONF         = path.resolve(__dirname, "../wdio.conf.js");
const AVD_NAME          = process.env.AVD_NAME || "Pixel_6_API_30";
let   ADB               = process.env.ADB_PATH || "adb";
const APPIUM_BIN        = path.resolve(__dirname, "../../node_modules/.bin/appium");
const WDIO_BIN          = path.resolve(__dirname, "../../node_modules/.bin/wdio");

// How long to wait for the app to render after launch (ms)
const APP_LAUNCH_WAIT_MS = 15000;
// How many 1-second polls to confirm foreground activity
const APP_FOREGROUND_POLL_COUNT = 15;

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
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 15000 });
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
  const devices = runSilent("adb devices");
  const lines = devices.split("\n").filter((l) => l.includes("emulator") && l.includes("device"));

  if (lines.length > 0) {
    const emulatorId = lines[0].split("\t")[0].trim();
    log("✅", `Reusing existing emulator: ${emulatorId}`);
    process.env.DEVICE_NAME = emulatorId;
    ADB = `${process.env.ADB_PATH || "adb"} -s ${emulatorId}`;
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
      const newDevices = runSilent("adb devices");
      const newLine = newDevices.split("\n").find(
        (l) => l.includes("emulator") && l.includes("device")
      );
      const emId = newLine ? newLine.split("\t")[0].trim() : "emulator-5554";
      process.env.DEVICE_NAME = emId;
      ADB = `${process.env.ADB_PATH || "adb"} -s ${emId}`;
      return emId;
    }
    log("⏳", `Still booting... (${(i + 1) * 5}s elapsed)`);
  }
  throw new Error("Emulator failed to boot within 180 seconds.");
}

// ─────────────────────────────────────────────
// STEP 3 — FORCE REINSTALL APK
// ─────────────────────────────────────────────
//
// CRITICAL FIX: We always force-reinstall the APK using `adb install -r -d`.
// This ensures stale APKs (built without an embedded JS bundle) are replaced
// with the current build that has `assets/index.android.bundle` embedded.
// Previously the script skipped installation if the package name existed —
// causing old dev-mode APKs to persist indefinitely on the emulator.

async function forceInstallApk() {
  log("📦", "Force-installing APK (always reinstall to avoid stale builds)...");

  if (!fs.existsSync(APK_PATH)) {
    throw new Error(`APK not found at: ${APK_PATH}\nRun the build step first.`);
  }

  const apkStat = fs.statSync(APK_PATH);
  log("📄", `APK path : ${APK_PATH}`);
  log("📄", `APK size : ${(apkStat.size / 1024 / 1024).toFixed(1)} MB`);

  // Confirm the APK contains an embedded JS bundle
  log("🔍", "Verifying APK has embedded JS bundle...");
  const listBin = (() => {
    try {
      // Use aapt from ANDROID_HOME if available
      const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
      const buildToolsBase = path.join(androidHome, "build-tools");
      if (fs.existsSync(buildToolsBase)) {
        const versions = fs.readdirSync(buildToolsBase).sort().reverse();
        for (const v of versions) {
          const candidate = path.join(buildToolsBase, v, "aapt.exe");
          if (fs.existsSync(candidate)) return candidate;
          const candidateLinux = path.join(buildToolsBase, v, "aapt");
          if (fs.existsSync(candidateLinux)) return candidateLinux;
        }
      }
    } catch (_) {}
    return null;
  })();

  let bundleEmbedded = false;
  if (listBin) {
    try {
      const listOut = execSync(`"${listBin}" list "${APK_PATH}"`, { encoding: "utf-8", stdio: "pipe", timeout: 20000 });
      bundleEmbedded = listOut.includes("assets/index.android.bundle");
      if (bundleEmbedded) {
        log("✅", "Confirmed: APK contains assets/index.android.bundle (JS bundle embedded).");
      } else {
        log("❌", "FATAL: APK does NOT contain assets/index.android.bundle!");
        log("❌", "The APK was built without bundleInDebug=true or debuggableVariants=[]. Rebuild required.");
        log("❌", "Run: ./gradlew assembleDebug -PbundleInDebug=true");
        throw new Error(
          "APK missing embedded JS bundle (assets/index.android.bundle). " +
          "This APK will show 'Unable to load script' on the emulator. " +
          "Rebuild with: gradlew assembleDebug -PbundleInDebug=true"
        );
      }
    } catch (e) {
      if (e.message.includes("FATAL") || e.message.includes("APK missing")) throw e;
      log("⚠️", `aapt list failed (non-fatal): ${e.message}`);
    }
  } else {
    log("⚠️", "aapt not found — skipping APK bundle verification. Proceeding with install.");
  }

  // Force-stop if currently running before reinstall
  log("🛑", `Force-stopping ${APP_PACKAGE} before reinstall...`);
  runSilent(`${ADB} shell am force-stop ${APP_PACKAGE}`);
  await sleep(1000);

  // Install with -r (replace) and -d (allow version downgrade)
  log("📲", "Installing APK with adb install -r -d ...");
  try {
    const installOut = run(`${ADB} install -r -d "${APK_PATH}"`);
    log("✅", `Install output: ${installOut.trim()}`);
  } catch (e) {
    throw new Error(`APK installation failed: ${e.message}`);
  }

  await sleep(2000);

  // Verify installation
  const verify = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();
  if (!verify.includes(APP_PACKAGE)) {
    throw new Error(`APK install verification failed. Package ${APP_PACKAGE} not found after install.`);
  }
  log("✅", "APK installed and verified.");
}

// ─────────────────────────────────────────────
// STEP 4 — LAUNCH APP AND VERIFY FOREGROUND
// ─────────────────────────────────────────────
//
// CRITICAL FIX: After `am start`, we poll `dumpsys activity activities` to
// confirm that TripSyncApp/.MainActivity is the topResumedActivity.
// If it is NOT in the foreground after polling, we FAIL IMMEDIATELY.
// We also save a screenshot so the failure is visible in artifacts.

async function launchAppAndVerify() {
  log("🚀", `Launching: ${APP_PACKAGE}/${APP_ACTIVITY}`);

  // Clear app data for clean state (ensures we land on login screen)
  log("🧹", "Clearing app data for clean login state...");
  runSilent(`${ADB} shell pm clear ${APP_PACKAGE}`);
  await sleep(1000);

  // Start the activity
  const startOut = runSilent(`${ADB} shell am start -W -n "${APP_PACKAGE}/${APP_ACTIVITY}"`);
  log("📄", `am start output: ${startOut.trim()}`);

  if (startOut.includes("Error") && !startOut.includes("Warning")) {
    throw new Error(`am start returned an error: ${startOut.trim()}`);
  }

  // Poll for foreground activity
  log("⏳", `Waiting up to ${APP_LAUNCH_WAIT_MS / 1000}s for app to appear in foreground...`);
  let appInForeground = false;

  for (let i = 0; i < APP_FOREGROUND_POLL_COUNT; i++) {
    await sleep(APP_LAUNCH_WAIT_MS / APP_FOREGROUND_POLL_COUNT);

    const activityDump = runSilent(`${ADB} shell dumpsys activity activities`);
    const topActivityLine = activityDump
      .split("\n")
      .find((l) => l.includes("topResumedActivity") || l.includes("mFocusedActivity")) || "";

    log("🔍", `[${i + 1}/${APP_FOREGROUND_POLL_COUNT}] Top activity: ${topActivityLine.trim()}`);

    if (topActivityLine.includes(APP_PACKAGE)) {
      log("✅", "TripSync app is in the foreground!");
      appInForeground = true;
      break;
    }

    // Check for ANR dialog (app crashed)
    if (topActivityLine.includes("android.app.NotRespondingDialog") ||
        topActivityLine.includes("android:id/alertTitle")) {
      log("❌", "ANR (App Not Responding) dialog detected — app crashed on launch!");
      break;
    }
  }

  // Take diagnostic screenshot regardless
  const screenshotPath = path.join(RESULTS_DIR, "pre-wdio-launch-screenshot.png");
  try {
    runSilent(`${ADB} shell screencap -p /sdcard/pre_wdio_screen.png`);
    runSilent(`${ADB} pull /sdcard/pre_wdio_screen.png "${screenshotPath}"`);
    log("📸", `Pre-WDIO screenshot saved: ${screenshotPath}`);
  } catch (_) {}

  if (!appInForeground) {
    // Save full activity dump for debugging
    const dumpPath = path.join(RESULTS_DIR, "activity-dump-on-failure.txt");
    const fullDump = runSilent(`${ADB} shell dumpsys activity activities`);
    fs.writeFileSync(dumpPath, fullDump, "utf-8");

    // Save logcat for React Native errors
    const logcatPath = path.join(RESULTS_DIR, "logcat-on-launch-failure.txt");
    const logcat = runSilent(`${ADB} logcat -d -v threadtime *:W`).substring(0, 300000);
    fs.writeFileSync(logcatPath, logcat, "utf-8");

    throw new Error(
      `FATAL: TripSync app is NOT in the foreground after ${APP_LAUNCH_WAIT_MS}ms. ` +
      `This usually means the APK crashed on launch (missing JS bundle, ANR, or permission error). ` +
      `Check: ${screenshotPath} and ${logcatPath} for details. ` +
      `DO NOT proceed to WDIO — no UI elements will be found.`
    );
  }

  // Extra wait for React Native to fully render the login screen
  log("⏳", "Waiting 8s for React Native to render login screen...");
  await sleep(8000);

  // Final foreground check
  const finalDump = runSilent(`${ADB} shell dumpsys activity activities`);
  const finalTop = finalDump.split("\n").find((l) => l.includes("topResumedActivity")) || "";
  log("🔍", `Final top activity: ${finalTop.trim()}`);

  if (!finalTop.includes(APP_PACKAGE)) {
    throw new Error(
      `FATAL: TripSync app left the foreground during React Native init. ` +
      `The app likely crashed while loading the JS bundle. ` +
      `Check logcat at: ${path.join(RESULTS_DIR, "logcat-on-launch-failure.txt")}`
    );
  }

  log("✅", "App launch verified. TripSync is visible and in the foreground.");
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
  const devices = runSilent("adb devices");
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
// STEP 7 — PRE-WDIO DIAGNOSTIC SUMMARY
// ─────────────────────────────────────────────

async function printPreWdioDiagnostics() {
  log("📊", "=== PRE-WDIO DIAGNOSTICS ===");

  const deviceId    = process.env.DEVICE_NAME || "emulator-5554";
  const pkg         = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();
  const topActivity = runSilent(`${ADB} shell dumpsys activity activities`)
    .split("\n").find((l) => l.includes("topResumedActivity")) || "(not found)";
  const appState    = runSilent(`${ADB} shell dumpsys activity processes | grep -A2 ${APP_PACKAGE}`);
  const appiumOk    = await checkAppiumRunning();

  log("📱", `Device           : ${deviceId}`);
  log("📦", `App installed    : ${pkg.includes(APP_PACKAGE) ? "YES ✅" : "NO ❌"}`);
  log("🎯", `Top activity     : ${topActivity.trim()}`);
  log("🔌", `Appium server    : ${appiumOk ? "HEALTHY ✅" : "DOWN ❌"}`);
  log("📊", "=============================");

  if (!pkg.includes(APP_PACKAGE)) {
    throw new Error("FATAL pre-WDIO check: App is NOT installed.");
  }
  if (!topActivity.includes(APP_PACKAGE)) {
    throw new Error(
      `FATAL pre-WDIO check: App is NOT in foreground. Top: ${topActivity.trim()}. ` +
      "WDIO cannot find any UI elements. Aborting."
    );
  }
  if (!appiumOk) {
    throw new Error("FATAL pre-WDIO check: Appium server is not responding.");
  }

  log("✅", "All pre-WDIO checks passed. Proceeding to test execution.");
}

// ─────────────────────────────────────────────
// STEP 8 — RUN WDIO TESTS
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
    log("📋", "Running all tests across all suites");
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
// STEP 9 — COLLECT ADB LOGCAT
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

  try {
    const activityInfo = runSilent(`${ADB} shell dumpsys activity activities`).substring(0, 50000);
    const actPath = path.join(RESULTS_DIR, "adb-activity.log");
    fs.writeFileSync(actPath, activityInfo, "utf-8");
    log("✅", `Activity dump saved: ${actPath}`);
  } catch (_) {}
}

// ─────────────────────────────────────────────
// STEP 10 — CLEANUP
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
    await verifyAdb();               // Step 1 — ADB available
    await detectOrBootEmulator();    // Step 2 — reuse if running
    await forceInstallApk();         // Step 3 — ALWAYS reinstall (no stale APK)
    await launchAppAndVerify();      // Step 4 — launch + VERIFY foreground
    await detectOrStartAppium();     // Step 5 — reuse if running
    await verifyAppiumSession();     // Step 6 — FATAL if Appium not responding
    await printPreWdioDiagnostics(); // Step 7 — gate before WDIO starts
    wdioExitCode = await runWdio();  // Step 8 — run tests
  } catch (err) {
    log("❌", `FATAL: ${err.message}`);
    console.error(err.stack);
    wdioExitCode = 1;
  } finally {
    await collectLogs();             // Step 9 — always collect
    cleanup();                       // Step 10
  }

  console.log("\n" + "═".repeat(60));
  log(wdioExitCode === 0 ? "🎉" : "❌", `CI Run finished. Exit code: ${wdioExitCode}`);
  console.log("═".repeat(60) + "\n");

  process.exit(wdioExitCode);
}

// Handle process signals
process.on("SIGINT",  () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
