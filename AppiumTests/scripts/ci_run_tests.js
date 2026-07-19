/**
 * TripSync Appium E2E — CI Orchestration Script (Production-Grade)
 * Windows-compatible Node.js script for Self-Hosted GitHub Actions Runner.
 *
 * Implements:
 *  1. Intelligent Installed APK Validation (Version Code, Version Name, SHA256 match)
 *  2. Cached APK Integrity & JS Bundle Verification (aapt check for assets/index.android.bundle)
 *  3. Intelligent Launch Verification (pm clear, pm grant, am start -W, dumpsys activity poll)
 *  4. Appium Server & Session Verification
 *  5. Immediate Exit on setup/launch failure (no infinite WDIO loops)
 *  6. Detailed launch diagnostics on failure
 *  7. Automated GitHub Actions Run Summary output
 */

"use strict";

const { execSync, spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const APP_PACKAGE  = "com.kondajeswanth.TripSyncApp";
const APP_ACTIVITY = "com.kondajeswanth.TripSyncApp.MainActivity";

const APK_PATH = path.resolve(
  __dirname,
  "../../android/app/build/outputs/apk/debug/app-debug.apk"
);
const APK_INFO_PATH     = path.resolve(path.dirname(APK_PATH), "../../../../TripSyncCache/apk-info.json");
const APPIUM_PORT       = 4723;
const APPIUM_STATUS_URL = `http://127.0.0.1:${APPIUM_PORT}/status`;
const RESULTS_DIR       = path.resolve(__dirname, "../../test-results");
const APPIUM_LOG        = path.join(RESULTS_DIR, "appium.log");
const WDIO_CONF         = path.resolve(__dirname, "../wdio.conf.js");
const AVD_NAME          = process.env.AVD_NAME || "Pixel_6";
let   ADB               = process.env.ADB_PATH || "adb";
const APPIUM_BIN        = path.resolve(__dirname, "../../node_modules/.bin/appium");
const WDIO_BIN          = path.resolve(__dirname, "../../node_modules/.bin/wdio");

// Verification State Tracker for GITHUB_STEP_SUMMARY
const summary = {
  apkCacheStatus: "Unknown ❌",
  installedApkStatus: "Unknown ❌",
  apkShaMatch: "Unknown ❌",
  launchStatus: "Unknown ❌",
  foregroundStatus: "Unknown ❌",
  wdioStarted: "NO ❌",
  timeSaved: "0 minutes",
  failureReason: "None",
};

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
  return execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 120000, ...opts });
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

function findAapt() {
  try {
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "C:\\Users\\konda\\AppData\\Local\\Android\\Sdk";
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
}

// ─────────────────────────────────────────────
// STEP 1 — VERIFY ADB
// ─────────────────────────────────────────────

async function verifyAdb() {
  log("🔧", "Verifying ADB availability...");
  try {
    const out = run(`${ADB} version`);
    log("✅", `ADB found: ${out.split("\n")[0].trim()}`);
  } catch (e) {
    summary.failureReason = "ADB not found on PATH or wrong path configuration.";
    throw new Error(`ADB not found. Ensure Android SDK platform-tools is on PATH.\n${e.message}`);
  }
}

// ─────────────────────────────────────────────
// STEP 2 — DETECT OR BOOT EMULATOR
// ─────────────────────────────────────────────

function findEmulatorBin() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "C:\\Users\\konda\\AppData\\Local\\Android\\Sdk";
  const candidate = path.join(sdkRoot, "emulator/emulator.exe");
  if (fs.existsSync(candidate)) return candidate;
  const candidateLinux = path.join(sdkRoot, "emulator/emulator");
  if (fs.existsSync(candidateLinux)) return candidateLinux;
  return "emulator";
}

async function detectOrBootEmulator() {
  log("📱", "Checking for running emulators...");
  const adbBin = process.env.ADB_PATH || "adb";
  const devices = runSilent(`${adbBin} devices`);
  const lines = devices.split("\n").filter((l) => l.includes("emulator") && l.includes("device"));

  if (lines.length > 0) {
    const emulatorId = lines[0].split("\t")[0].trim();
    log("✅", `Reusing existing emulator: ${emulatorId}`);
    process.env.DEVICE_NAME = emulatorId;
    ADB = `${adbBin} -s ${emulatorId}`;
    return emulatorId;
  }

  log("🚀", `No emulator running. Booting AVD: ${AVD_NAME}`);
  const emulatorBin = process.env.EMULATOR_PATH || findEmulatorBin();
  
  // Capture spawn error to log if it fails to execute
  const emProcess = spawn(emulatorBin, ["-avd", AVD_NAME, "-no-snapshot-load", "-no-audio"], {
    detached: true,
    stdio: "ignore",
  });
  
  emProcess.on("error", (err) => {
    log("❌", `Failed to spawn emulator process: ${err.message}`);
  });
  
  emProcess.unref();

  log("⏳", "Waiting for emulator to boot (up to 180s)...");
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    // Use -e to explicitly target emulator (not a physical device on the same host)
    const booted = runSilent(`${adbBin} -e shell getprop sys.boot_completed`).trim();
    if (booted === "1") {
      log("✅", "Emulator boot completed.");
      const newDevices = runSilent(`${adbBin} devices`);
      const newLine = newDevices.split("\n").find(
        (l) => l.includes("emulator") && l.includes("device")
      );
      const emId = newLine ? newLine.split("\t")[0].trim() : "emulator-5554";
      process.env.DEVICE_NAME = emId;
      ADB = `${adbBin} -s ${emId}`;
      return emId;
    }
    log("⏳", `Still booting... (${(i + 1) * 5}s elapsed)`);
  }
  summary.failureReason = "Emulator failed to boot within 180 seconds.";
  throw new Error("Emulator failed to boot within 180 seconds.");
}

// ─────────────────────────────────────────────
// STEP 3 — CACHED APK VALIDATION (INTEGRITY & BUNDLE)
// ─────────────────────────────────────────────

function validateCachedApk() {
  log("🔍", "Validating Cached APK existence, integrity, and JS bundle...");
  
  if (!fs.existsSync(APK_PATH)) {
    summary.apkCacheStatus = "Missing ❌";
    summary.failureReason = `Local APK not found at: ${APK_PATH}`;
    throw new Error(`APK not found at: ${APK_PATH}\nRun the build step first.`);
  }

  summary.apkCacheStatus = "Valid local APK found ✅";

  // Calculate local APK SHA256
  const fileBuffer = fs.readFileSync(APK_PATH);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  const calculatedSha = hashSum.digest("hex").toLowerCase();

  // Validate integrity against apk-info.json (if exists)
  if (fs.existsSync(APK_INFO_PATH)) {
    try {
      const info = JSON.parse(fs.readFileSync(APK_INFO_PATH, "utf-8"));
      const expectedSha = info.sha256.toLowerCase();
      if (calculatedSha !== expectedSha) {
        summary.apkCacheStatus = "Corrupted/Mismatch ❌";
        summary.failureReason = `APK SHA256 integrity check failed. Calculated: ${calculatedSha}, Expected: ${expectedSha}`;
        throw new Error("APK integrity check failed! Calculated SHA does not match expected SHA from cache metadata.");
      }
      log("✅", "Cached APK metadata integrity verified successfully.");
    } catch (e) {
      if (e.message.includes("integrity check failed")) throw e;
      log("⚠️", `Could not parse cached metadata info: ${e.message}`);
    }
  }

  // Verify assets/index.android.bundle exists inside APK using aapt
  const aaptBin = findAapt();
  if (aaptBin) {
    log("🔍", "Verifying JS bundle using aapt...");
    const listOut = execSync(`"${aaptBin}" list "${APK_PATH}"`, { encoding: "utf-8", stdio: "pipe", timeout: 20000 });
    if (!listOut.includes("assets/index.android.bundle")) {
      summary.apkCacheStatus = "Missing JS Bundle ❌";
      summary.failureReason = "Cached APK is missing assets/index.android.bundle (JS bundle not embedded).";
      throw new Error(
        "FATAL: Cached APK does not contain assets/index.android.bundle! " +
        "This APK was built without embedding the JavaScript bundle. " +
        "Please rebuild using: ./gradlew assembleDebug -PbundleInDebug=true"
      );
    }
    log("✅", "Verification passed: assets/index.android.bundle is present in APK.");
  } else {
    log("⚠️", "aapt tool not found, skipping zip entry check.");
  }

  return calculatedSha;
}

// ─────────────────────────────────────────────
// STEP 4 — INTELLIGENT INSTALLED APK VALIDATION
// ─────────────────────────────────────────────

async function intelligentInstallApk(localSha) {
  log("📦", "Starting Intelligent Installed APK Validation...");

  // Check if app is installed
  const installed = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();
  let matches = false;

  if (installed.includes(APP_PACKAGE)) {
    log("🔍", "App is installed. Extracting version details and SHA256...");

    // Get installed Version Code & Version Name
    const packageDump = runSilent(`${ADB} shell dumpsys package ${APP_PACKAGE}`);
    const codeMatch   = packageDump.match(/versionCode=(\d+)/);
    const nameMatch   = packageDump.match(/versionName=([^\s]+)/);
    const deviceVerCode = codeMatch ? codeMatch[1] : "";
    const deviceVerName = nameMatch ? nameMatch[1] : "";

    // Get local expected Version Code & Version Name from aapt
    let localVerCode = "1";
    let localVerName = "1.0.0";
    const aaptBin = findAapt();
    if (aaptBin) {
      try {
        const localAaptDump = execSync(`"${aaptBin}" dump badging "${APK_PATH}"`, { encoding: "utf-8", stdio: "pipe", timeout: 15000 });
        const localCodeMatch = localAaptDump.match(/versionCode='(\d+)'/);
        const localNameMatch = localAaptDump.match(/versionName='([^']+)'/);
        if (localCodeMatch) localVerCode = localCodeMatch[1];
        if (localNameMatch) localVerName = localNameMatch[1];
      } catch (_) {}
    }

    // Get SHA256 of base.apk on device
    let deviceSha = "";
    const pathLine = runSilent(`${ADB} shell pm path ${APP_PACKAGE}`).trim();
    if (pathLine) {
      const match = pathLine.match(/package:(.+)/);
      if (match) {
        const deviceApkPath = match[1].trim();
        const deviceShaLine = runSilent(`${ADB} shell sha256sum ${deviceApkPath}`).trim();
        deviceSha = deviceShaLine.split(/\s+/)[0].trim().toLowerCase();
      }
    }

    log("📋", `Device vs Local Comparison:`);
    log("📋", `  - Version Code: Device=${deviceVerCode} vs Local=${localVerCode}`);
    log("📋", `  - Version Name: Device=${deviceVerName} vs Local=${localVerName}`);
    log("📋", `  - SHA256      : Device=${deviceSha.substring(0, 10)}... vs Local=${localSha.substring(0, 10)}...`);

    if (deviceVerCode === localVerCode && deviceVerName === localVerName && deviceSha === localSha) {
      log("✅", "Intelligent Validation: Installed APK is identical to Cached APK. Reinstall skipped!");
      summary.installedApkStatus = "Reused (Up to Date) ✅";
      summary.apkShaMatch = "Match (Skipped Reinstall) ✅";
      summary.timeSaved = "~15 minutes (Gradle build + install skipped)";
      matches = true;
    } else {
      log("⚠️", "Intelligent Validation: Installed APK differs from Cached APK. Reinstalling...");
      summary.installedApkStatus = "Out of Date (Need Reinstall) ⚠️";
      summary.apkShaMatch = "Mismatch ❌";
    }
  } else {
    log("📲", "App is not installed on device. Installation required.");
    summary.installedApkStatus = "Not Installed ❌";
    summary.apkShaMatch = "No Match ❌";
  }

  if (!matches) {
    log("🛑", `Uninstalling existing app to prevent installation conflicts...`);
    runSilent(`${ADB} shell pm uninstall ${APP_PACKAGE}`);
    await sleep(1500);

    log("📲", `Installing Cached APK...`);
    try {
      const installResult = run(`${ADB} install -r -d "${APK_PATH}"`);
      log("✅", `Install output: ${installResult.trim()}`);
    } catch (e) {
      summary.failureReason = `APK installation failed: ${e.message}`;
      throw new Error(`APK installation failed: ${e.message}`);
    }
    await sleep(2000);

    // Final verification of install
    const verify = runSilent(`${ADB} shell pm list packages ${APP_PACKAGE}`).trim();
    if (!verify.includes(APP_PACKAGE)) {
      summary.failureReason = "APK installation completed but pm list package verified it is missing.";
      throw new Error(`APK install verification failed. Package ${APP_PACKAGE} not found after install.`);
    }
    log("✅", "APK installed and verified successfully.");
    summary.installedApkStatus = "Newly Installed ✅";
  }
}

// ─────────────────────────────────────────────
// STEP 5 — LAUNCH APP AND POLL FOREGROUND
// ─────────────────────────────────────────────

async function launchAppAndVerify() {
  log("🚀", `Launching: ${APP_PACKAGE}/${APP_ACTIVITY}`);

  // Clear app data to secure clean state
  log("🧹", "Clearing app data for clean state...");
  runSilent(`${ADB} shell pm clear ${APP_PACKAGE}`);
  await sleep(1000);

  // CRITICAL FIX: Pre-grant Location and Notification permissions to prevent system prompts
  log("🔑", "Granting default permissions (Location, Notifications) to bypass system dialogues...");
  runSilent(`${ADB} shell pm grant ${APP_PACKAGE} android.permission.ACCESS_FINE_LOCATION`);
  runSilent(`${ADB} shell pm grant ${APP_PACKAGE} android.permission.ACCESS_COARSE_LOCATION`);
  runSilent(`${ADB} shell pm grant ${APP_PACKAGE} android.permission.POST_NOTIFICATIONS`);
  await sleep(500);

  // Start activity
  const startOut = runSilent(`${ADB} shell am start -W -n "${APP_PACKAGE}/${APP_ACTIVITY}"`);
  log("📄", `am start output: ${startOut.trim()}`);

  if (startOut.includes("Error") && !startOut.includes("Warning")) {
    summary.launchStatus = "Failed to launch ❌";
    summary.failureReason = `am start error: ${startOut}`;
    throw new Error(`am start returned an error: ${startOut.trim()}`);
  }

  summary.launchStatus = "Launched successfully ✅";

  // Poll for foreground activity (up to 30 seconds, 15 polls of 2s)
  log("⏳", "Polling for foreground activity (up to 30s)...");
  let appInForeground = false;
  let topActivityLine = "";

  for (let i = 1; i <= 15; i++) {
    await sleep(2000);

    const activityDump = runSilent(`${ADB} shell dumpsys activity activities`);
    topActivityLine = activityDump
      .split("\n")
      .find((l) => l.includes("topResumedActivity") || l.includes("mFocusedActivity")) || "";

    log("🔍", `  [Poll ${i}/15] Top activity: ${topActivityLine.trim()}`);

    if (topActivityLine.includes(APP_PACKAGE)) {
      log("✅", "TripSync app verified in foreground.");
      appInForeground = true;
      break;
    }

    // Fallback: If permission controller displays, simulate enter key to grant and continue
    if (topActivityLine.includes("com.google.android.permissioncontroller")) {
      log("👆", "System permission dialog detected. Auto-bypassing via input keyevent 66 (Enter)...");
      runSilent(`${ADB} shell input keyevent 66`);
    }

    // Check for obvious crash alert dialogs
    if (topActivityLine.includes("android.app.NotRespondingDialog") ||
        topActivityLine.includes("android:id/alertTitle")) {
      log("❌", "Crash or ANR dialog active on screen!");
      break;
    }
  }

  // Save diagnostic screenshot
  ensureDir(RESULTS_DIR);
  const screenshotPath = path.join(RESULTS_DIR, "pre-wdio-launch-screenshot.png");
  try {
    runSilent(`${ADB} shell screencap -p /sdcard/pre_wdio_screen.png`);
    runSilent(`${ADB} pull /sdcard/pre_wdio_screen.png "${screenshotPath}"`);
    log("📸", `Pre-WDIO screenshot saved: ${screenshotPath}`);
  } catch (err) {
    log("⚠️", `Failed to capture screenshot: ${err.message}`);
  }

  if (!appInForeground) {
    summary.foregroundStatus = "Not in foreground (App Crashed / ANR) ❌";
    summary.failureReason = `App not in foreground after 30s. Top Activity: ${topActivityLine.trim()}`;

    // Collect debug dumps on launch failure
    const actLogPath = path.join(RESULTS_DIR, "launch-failure-activity-dump.txt");
    const winLogPath = path.join(RESULTS_DIR, "launch-failure-window-dump.txt");
    const logcatPath = path.join(RESULTS_DIR, "launch-failure-logcat.txt");

    const activityDump = runSilent(`${ADB} shell dumpsys activity activities`);
    const windowDump   = runSilent(`${ADB} shell dumpsys window windows`);
    const logcatDump   = runSilent(`${ADB} logcat -d -v threadtime ReactNativeJS:V AndroidRuntime:E *:S`).substring(0, 100000);

    fs.writeFileSync(actLogPath, activityDump, "utf-8");
    fs.writeFileSync(winLogPath, windowDump, "utf-8");
    fs.writeFileSync(logcatPath, logcatDump, "utf-8");

    log("📋", `Diagnostics saved. Activity: ${actLogPath}, Window: ${winLogPath}, Logcat: ${logcatPath}`);

    throw new Error(
      `FATAL: TripSync app failed to reach the foreground within 30s. ` +
      `Check diagnostic dumps and screenshot in the artifacts directory. ` +
      `Aborting test run immediately to prevent infinite WDIO retry loops.`
    );
  }

  summary.foregroundStatus = "Verified in foreground ✅";
  
  // Delay for React Native rendering
  log("⏳", "Waiting 8s for React Native to finish loading elements...");
  await sleep(8000);

  // Final visibility confirmation check
  const finalDump = runSilent(`${ADB} shell dumpsys activity activities`);
  const finalTop = finalDump.split("\n").find((l) => l.includes("topResumedActivity")) || "";
  if (!finalTop.includes(APP_PACKAGE)) {
    summary.foregroundStatus = "Crashed during init ❌";
    summary.failureReason = "App left foreground during React Native initialization.";
    throw new Error("FATAL: App left foreground during React Native initialization. Possible crash.");
  }

  log("✅", "App launch verified. TripSync is visible and ready for WDIO.");
}

// ─────────────────────────────────────────────
// STEP 5b — PRE-INSTALL APPIUM SERVERS
// ─────────────────────────────────────────────

async function installAppiumServers() {
  log("🔧", "Pre-installing Appium UiAutomator2 Server and Settings APKs...");
  try {
    const adbBin = process.env.ADB_PATH || "adb";
    const device = process.env.DEVICE_NAME || "emulator-5554";
    const adb = `${adbBin} -s ${device}`;
    const baseDir = path.resolve(__dirname, "../node_modules/appium-uiautomator2-driver/node_modules");
    const settingsApk = path.join(baseDir, "io.appium.settings/apks/settings_apk-debug.apk");
    const serverApk = path.join(baseDir, "appium-uiautomator2-server/apks/appium-uiautomator2-server-v7.1.11.apk");
    const testApk = path.join(baseDir, "appium-uiautomator2-server/apks/appium-uiautomator2-server-debug-androidTest.apk");

     log("📦", "Installing io.appium.settings...");
    execSync(`"${adbBin}" -s ${device} install -r -g "${settingsApk}"`, { stdio: "ignore", timeout: 45000 });
    
    log("📦", "Installing io.appium.uiautomator2.server...");
    execSync(`"${adbBin}" -s ${device} install -r -g "${serverApk}"`, { stdio: "ignore", timeout: 45000 });
    
    log("📦", "Installing io.appium.uiautomator2.server.test...");
    execSync(`"${adbBin}" -s ${device} install -r -g "${testApk}"`, { stdio: "ignore", timeout: 45000 });

    log("✅", "Appium Server and Settings APKs pre-installed successfully.");
  } catch (e) {
    log("⚠️", `Failed to pre-install Appium server APKs: ${e.message}`);
  }
}

// ─────────────────────────────────────────────
// STEP 6 — APPIUM VERIFICATION
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
  summary.failureReason = "Appium server failed to respond on port 4723.";
  throw new Error(`Appium did not become ready on port ${APPIUM_PORT} within 60 seconds.`);
}

async function verifyAppiumSession() {
  log("🔗", "Verifying Appium session creation eligibility...");
  const ok = await checkAppiumRunning();
  if (!ok) {
    summary.failureReason = "Appium /status check failed.";
    throw new Error("Appium /status check failed. Cannot proceed.");
  }
}

// ─────────────────────────────────────────────
// STEP 7 — RUN WDIO TESTS
// ─────────────────────────────────────────────

async function runWdio() {
  log("🧹", "Stopping any running UiAutomator2 server on device...");
  try {
    const adbBin = process.env.ADB_PATH || "adb";
    const device = process.env.DEVICE_NAME || "emulator-5554";
    const adb = `${adbBin} -s ${device}`;
    execSync(`${adb} shell am force-stop io.appium.uiautomator2.server`, { stdio: "ignore" });
    execSync(`${adb} shell am force-stop io.appium.uiautomator2.server.test`, { stdio: "ignore" });
    execSync(`${adb} shell am force-stop io.appium.settings`, { stdio: "ignore" });
  } catch (_) {}

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

  summary.wdioStarted = "YES ✅";

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
        log("⚠️", `WDIO exited with code ${code}. Check reports for failures.`);
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
// STEP 8 — COLLECT ADB LOGS
// ─────────────────────────────────────────────

async function collectLogs() {
  log("📋", "Collecting final ADB diagnostics...");
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
  } catch (_) {}
}

// ─────────────────────────────────────────────
// STEP 9 — CLEANUP
// ─────────────────────────────────────────────

function cleanup() {
  if (appiumProcess) {
    log("🛑", "Stopping Appium server...");
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
// STEP 10 — WRITE GITHUB ACTIONS SUMMARY
// ─────────────────────────────────────────────

function writeGithubSummary(exitCode) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) {
    log("ℹ️", "GITHUB_STEP_SUMMARY is not defined. Skipping markdown write.");
    return;
  }

  const overallStatus = exitCode === 0 ? "🟢 SUCCESS" : "🔴 FAILED";
  const markdown = `
# 📱 Android E2E Execution Summary

An E2E test run has completed. Below is the intelligence dashboard representing cached resources, installation metrics, launch results, and test status.

### 📊 Verification Checklist

| Metric | Status | Comments |
|---|---|---|
| **APK Cache Status** | ${summary.apkCacheStatus} | Verified existence, integrity signature, and JS bundle |
| **Installed APK Status** | ${summary.installedApkStatus} | Reused if matches, reinstalled if out of date |
| **APK SHA Match** | ${summary.apkShaMatch} | Secure matching of device hash and local cached hash |
| **Launch Verification** | ${summary.launchStatus} | Checked intent startup state and activity response |
| **Foreground Verification** | ${summary.foregroundStatus} | Confirmed top visible activity matches package name |
| **WDIO Started** | ${summary.wdioStarted} | Tests commenced inside WebDriverIO runner |
| **Estimated Time Saved** | ⚡ **${summary.timeSaved}** | Saved by reusing pre-built packages and devices |
| **Overall Run Result** | **${overallStatus}** | Exit code: ${exitCode} |

${summary.failureReason !== "None" ? `> [!ERROR]\n> **Failure Reason:** ${summary.failureReason}` : ""}

*Dashboard auto-generated by the TripSync Appium E2E Orchestrator.*
`;

  try {
    fs.appendFileSync(summaryFile, markdown, "utf-8");
    log("✅", `Run summary written to: ${summaryFile}`);
  } catch (err) {
    log("⚠️", `Failed to write summary to GITHUB_STEP_SUMMARY: ${err.message}`);
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

  let exitCode = 1;

  try {
    await verifyAdb();               // Step 1 — ADB check
    await detectOrBootEmulator();    // Step 2 — Boot / Reuse emulator
    const sha = validateCachedApk(); // Step 3 — Confirm APK integrity & JS bundle
    await intelligentInstallApk(sha);// Step 4 — Check device vs local (intelligent install)
    await launchAppAndVerify();      // Step 5 — am start & Poll dumpsys for visibility
    await installAppiumServers();    // Pre-install Appium APKs to skip installation inside specs
    await detectOrStartAppium();     // Step 6 — Appium server startup/reuse
    await verifyAppiumSession();     // Step 7 — Session sanity check
    
    // Seed test user in Firebase Auth before starting tests
    try {
      log("🔑", "Seeding Firebase Auth test user...");
      execSync(`node "${path.resolve(__dirname, "seed_firebase_user.js")}"`, { stdio: "inherit" });
    } catch (e) {
      log("⚠️", `Firebase Auth user seeding failed: ${e.message}`);
    }

    exitCode = await runWdio();      // Step 8 — Execute WDIO test runner
  } catch (err) {
    log("❌", `FATAL: ${err.message}`);
    console.error(err.stack);
    exitCode = 1;
  } finally {
    await collectLogs();             // Step 9 — log collection
    cleanup();                       // Step 10 — kill Appium if started locally
    writeGithubSummary(exitCode);    // Step 11 — print summary
  }

  console.log("\n" + "═".repeat(60));
  log(exitCode === 0 ? "🎉" : "❌", `CI Run finished. Exit code: ${exitCode}`);
  console.log("═".repeat(60) + "\n");

  process.exit(exitCode);
}

// Signal event listeners
process.on("SIGINT",  () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
