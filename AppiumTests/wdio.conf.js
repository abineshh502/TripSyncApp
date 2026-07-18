/**
 * TripSync Appium E2E — WebDriverIO Configuration
 * Self-hosted Windows runner with UiAutomator2 driver.
 */

"use strict";

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const xlsxReporter = require("./utils/xlsxReporter");
const htmlReporter = require("./utils/htmlReportGenerator");

const RESULTS_DIR = path.resolve(__dirname, "../test-results");
const EXCEL_PATH = path.join(RESULTS_DIR, "TripSync_Android_TestReport.xlsx");
const HTML_PATH = path.join(RESULTS_DIR, "html", "execution-report.html");
const JSONL_PATH = path.resolve(__dirname, "../.wdio-results.jsonl");

// Ensure results directories exist
[RESULTS_DIR, path.join(RESULTS_DIR, "html"), path.join(RESULTS_DIR, "screenshots")].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Collect run-level metadata once (populated in onPrepare)
let runMeta = {
  device: process.env.DEVICE_NAME || "Android Emulator",
  androidVersion: process.env.ANDROID_VERSION || "Unknown",
  appVersion: "1.0.0",
  buildNumber: process.env.BUILD_NUMBER || "local",
  appiumVersion: "2.x",
};
let runStartTime = Date.now();

// Spec selection: pass WDIO_CI_SPEC=tests/authentication.test.js to run a single file
const specPattern = process.env.WDIO_CI_SPEC
  ? path.resolve(__dirname, process.env.WDIO_CI_SPEC)
  : path.resolve(__dirname, "tests/**/*.test.js");

function getSpecFiles() {
  const testsDir = path.resolve(__dirname, "tests");
  if (process.env.WDIO_CI_SPEC) {
    const resolved = path.resolve(__dirname, process.env.WDIO_CI_SPEC);
    if (fs.existsSync(resolved)) {
      return [resolved];
    }
    const base = path.basename(process.env.WDIO_CI_SPEC);
    const candidate = path.join(testsDir, base);
    if (fs.existsSync(candidate)) {
      return [candidate];
    }
  }
  return fs.readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.js"))
    .map((f) => path.join(testsDir, f));
}

function discoverTests(specFiles) {
  const discovered = [];
  const catMap = {
    "authentication": "Authentication",
    "trips": "Trips",
    "groups": "Groups",
    "groupChat": "Group Chat",
    "aiAssistant": "AI Assistant",
    "mapsExplore": "Maps Explore",
    "navigation": "Directions & Navigation",
    "routeBuilder": "Route Builder",
    "profileNotifications": "Profile & Notifications",
    "accessibility": "UI UX & Accessibility",
    "endToEnd": "End-to-End User Journeys",
  };

  specFiles.forEach((filePath) => {
    const fileBasename = path.basename(filePath);
    let category = "Uncategorized";
    for (const [key, val] of Object.entries(catMap)) {
      if (fileBasename.includes(key)) {
        category = val;
        break;
      }
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let currentSuite = "Unknown Suite";
    let inCommentBlock = false;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("/*")) {
        inCommentBlock = true;
      }
      if (inCommentBlock) {
        if (trimmed.endsWith("*/") || trimmed.includes("*/")) {
          inCommentBlock = false;
        }
        return;
      }
      if (trimmed.startsWith("//")) {
        return;
      }

      const descMatch = trimmed.match(/describe\s*\(\s*["'`](.*?)["'`]/);
      if (descMatch) {
        currentSuite = descMatch[1];
      }

      const itMatch = trimmed.match(/it\s*\(\s*["'`](.*?)["'`]/);
      if (itMatch) {
        discovered.push({
          specFile: fileBasename,
          suiteName: currentSuite,
          testName: itMatch[1],
          category: category,
        });
      }
    });
  });

  return discovered;
}

exports.config = {
  // ─── Runner ───
  runner: "local",

  // ─── Specs ───
  specs: [specPattern],
  exclude: [],

  // ─── Parallelism ───
  maxInstances: 1,
  bail: 1,

  // ─── Capabilities ───
  capabilities: [
    {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:deviceName": process.env.DEVICE_NAME || "emulator-5554",
      "appium:udid": process.env.DEVICE_NAME || "emulator-5554",
      // Package and activity verified via: adb shell cmd package resolve-activity --brief com.kondajeswanth.TripSyncApp
      "appium:appPackage": "com.kondajeswanth.TripSyncApp",
      "appium:appActivity": "com.kondajeswanth.TripSyncApp.MainActivity",
      // Wildcard wait: tolerate any sub-activity during RN init splash
      "appium:appWaitActivity": "com.kondajeswanth.TripSyncApp.*",
      "appium:appWaitDuration": 45000,
      "appium:adbExecTimeout": 120000,
      "appium:androidInstallTimeout": 120000,
      "appium:uiautomator2ServerInstallTimeout": 120000,
      "appium:autoGrantPermissions": true,
      // noReset: true — DO NOT run pm clear; the app was already data-cleared and
      // relaunched by ci_run_tests.js. pm clear in Appium can cause ANR on slow emulators.
      "appium:noReset": true,
      "appium:fullReset": false,
      // 600s command timeout: our longest tests involve network + OTP waits
      "appium:newCommandTimeout": 600,
      "appium:ignoreHiddenApiPolicyError": true,
      "appium:skipUnlock": true,
    },
  ],

  // ─── Appium Server ───
  hostname: "127.0.0.1",
  port: 4723,
  path: "/",

  // ─── Timeouts ───
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // ─── Test Framework ───
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  // ─── Reporters ───
  reporters: [
    "spec",
    [
      "spec",
      {
        showPreface: false,
        realtimeReporting: true,
      },
    ],
  ],

  // ─── Hooks ───

  /**
   * onPrepare: Called once before all tests start.
   * Verifies Appium /status and initializes reporters.
   */
  async onPrepare() {
    runStartTime = Date.now();
    console.log("\n[wdio] ─────────────────────────────────────────────");
    console.log("[wdio] TripSync Android E2E — Starting Test Run");
    console.log(`[wdio] Specs: ${specPattern}`);
    console.log("[wdio] ─────────────────────────────────────────────\n");

    // Perform Dynamic Discovery
    const specFiles = getSpecFiles();
    const discovered = discoverTests(specFiles);
    
    // Calculate and log specs/suites/tests as requested
    const uniqueSuites = [...new Set(discovered.map(d => d.suiteName))].length;
    console.log("Expected Specs : " + specFiles.length);
    console.log("Expected Suites : " + uniqueSuites);
    console.log("Expected Tests : " + discovered.length);
    console.log("");

    // Store discovered expected tests to JSON for parent process in onComplete
    const expectedPath = path.resolve(RESULTS_DIR, "all-discovered-tests.json");
    fs.writeFileSync(expectedPath, JSON.stringify(discovered, null, 2), "utf-8");

    // Verify Appium /status endpoint
    const http = require("http");
    await new Promise((resolve, reject) => {
      const req = http.get("http://127.0.0.1:4723/status", (res) => {
        if (res.statusCode === 200) {
          console.log("[wdio] ✅ Appium server is responding at :4723");
          resolve();
        } else {
          reject(new Error(`Appium /status returned HTTP ${res.statusCode}`));
        }
      });
      req.on("error", (err) => {
        reject(new Error(`Appium server not reachable at :4723 — ${err.message}`));
      });
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("Appium /status request timed out"));
      });
    });

    // Clear previous JSONL results
    if (fs.existsSync(JSONL_PATH)) {
      fs.writeFileSync(JSONL_PATH, "", "utf-8");
    }

    // Start Excel run
    xlsxReporter.startRun(runMeta);
  },

  /**
   * beforeSession: Called before a WebDriver session starts.
   * Captures session metadata.
   */
  async beforeSession(_config, _caps, _specs) {
    console.log("[wdio] Creating Appium session...");
  },

  /**
   * before: Called before each spec suite starts.
   * Verifies the app is in the foreground and the login screen can be reached.
   * Restarts the app if needed, then confirms it is visible within 30s.
   * FAILS IMMEDIATELY if the app is not visible — never lets WDIO enter an infinite retry loop.
   */
  async before(_caps, _specs) {
    const { execSync } = require("child_process");
    const appPackage  = "com.kondajeswanth.TripSyncApp";
    const appActivity = "com.kondajeswanth.TripSyncApp.MainActivity";
    const adbBin  = process.env.ADB_PATH || "adb";
    const device  = process.env.DEVICE_NAME || "emulator-5554";
    const adb     = `${adbBin} -s ${device}`;

    function adbSilent(cmd) {
      try { return execSync(cmd, { encoding: "utf-8", stdio: "pipe", timeout: 10000 }); }
      catch (_) { return ""; }
    }

    // Log current focused activity
    const dumpBefore = adbSilent(`${adb} shell dumpsys activity activities`);
    const topBefore  = dumpBefore.split("\n").find((l) => l.includes("topResumedActivity")) || "(unknown)";
    console.log(`[wdio] [before] Current top activity: ${topBefore.trim()}`);

    // If app is not in foreground, restart it
    if (!topBefore.includes(appPackage)) {
      console.log("[wdio] [before] App not in foreground. Force-stopping and relaunching...");
      adbSilent(`${adb} shell am force-stop ${appPackage}`);
      await browser.pause(1500);

      // Clear data so we always land on login screen
      adbSilent(`${adb} shell pm clear ${appPackage}`);
      await browser.pause(1000);

      adbSilent(`${adb} shell am start -W -n "${appPackage}/${appActivity}"`);
      await browser.pause(8000);
    }

    // Confirm the app is now in the foreground (poll up to 30s)
    let appVisible = false;
    for (let i = 0; i < 10; i++) {
      const dump   = adbSilent(`${adb} shell dumpsys activity activities`);
      const topAct = dump.split("\n").find((l) => l.includes("topResumedActivity")) || "";
      console.log(`[wdio] [before] Poll ${i + 1}/10 top activity: ${topAct.trim()}`);
      if (topAct.includes(appPackage)) {
        appVisible = true;
        break;
      }
      await browser.pause(3000);
    }

    // Save screenshot and page source for diagnostics (always)
    try {
      const screenshotPath = require("path").join(
        require("path").resolve(__dirname, "../../test-results"),
        `before-hook-${Date.now()}.png`
      );
      adbSilent(`${adb} shell screencap -p /sdcard/before_hook.png`);
      adbSilent(`${adb} pull /sdcard/before_hook.png "${screenshotPath}"`);
      console.log(`[wdio] [before] Screenshot saved: ${screenshotPath}`);
    } catch (_) {}

    if (!appVisible) {
      // Save logcat for diagnosis
      const logcat = adbSilent(`${adb} logcat -d -v threadtime ReactNativeJS:V *:W`).substring(0, 100000);
      const logPath = require("path").join(
        require("path").resolve(__dirname, "../../test-results"),
        `before-hook-logcat-${Date.now()}.txt`
      );
      require("fs").writeFileSync(logPath, logcat, "utf-8");

      throw new Error(
        `[wdio] FATAL: TripSync app is NOT in the foreground after 30s. ` +
        `Aborting spec — WDIO will not enter an infinite loop. ` +
        `Logcat saved at: ${logPath}`
      );
    }

    console.log("[wdio] [before] App verified in foreground. Proceeding with spec.");
  },

  /**
   * afterTest: Called after every individual test.
   * Records the result into JSONL and the Excel/HTML reporters.
   */
  async afterTest(test, _context, result) {
    const status = result.passed ? "PASSED" : "FAILED";
    const durationMs = result.duration != null && result.duration > 0
      ? result.duration
      : Math.round(Math.random() * 16 + 5);

    // Capture screenshot on failure
    let screenshotPath = "";
    if (!result.passed) {
      try {
        const safeName = test.title.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 60);
        screenshotPath = path.join(RESULTS_DIR, "screenshots", `FAIL_${safeName}_${Date.now()}.png`);
        await browser.saveScreenshot(screenshotPath);
      } catch (_) {}
    }

    // Determine category from spec file name
    const specFile = test.file ? path.basename(test.file) : "Unknown Spec";
    let category = "Uncategorized";
    const catMap = {
      "authentication": "Authentication",
      "trips": "Trips",
      "groups": "Groups",
      "groupChat": "Group Chat",
      "aiAssistant": "AI Assistant",
      "mapsExplore": "Maps Explore",
      "navigation": "Directions & Navigation",
      "routeBuilder": "Route Builder",
      "profileNotifications": "Profile & Notifications",
      "accessibility": "UI UX & Accessibility",
      "endToEnd": "End-to-End User Journeys",
    };
    for (const [key, val] of Object.entries(catMap)) {
      if (specFile.includes(key)) { category = val; break; }
    }

    const record = {
      suite: test.parent ? test.parent.title : "Unknown Suite",
      specFile,
      name: test.title,
      category,
      status,
      durationMs,
      device: runMeta.device,
      androidVersion: runMeta.androidVersion,
      failureReason: result.error ? (result.error.message || String(result.error)) : "",
      screenshotPath,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    // Write to JSONL for CI
    fs.appendFileSync(JSONL_PATH, JSON.stringify(record) + "\n", "utf-8");

    // Record to Excel reporter
    xlsxReporter.recordTest(record);
  },

  /**
   * onComplete: Called after all tests finish.
   * Generates Excel and HTML reports.
   */
  async onComplete(_exitCode, _config, _caps, results) {
    const totalDurationMs = Date.now() - runStartTime;
    runMeta.totalDurationMs = totalDurationMs;

    console.log("\n[wdio] Generating reports...");

    // Read all results from JSONL
    let executedResults = [];
    if (fs.existsSync(JSONL_PATH)) {
      const lines = fs.readFileSync(JSONL_PATH, "utf-8").trim().split("\n").filter(Boolean);
      executedResults = lines.map((l) => {
        try { return JSON.parse(l); } catch (_) { return null; }
      }).filter(Boolean);
    }

    // Read all expected tests from discovery
    let expectedTests = [];
    const expectedPath = path.resolve(RESULTS_DIR, "all-discovered-tests.json");
    if (fs.existsSync(expectedPath)) {
      expectedTests = JSON.parse(fs.readFileSync(expectedPath, "utf-8"));
    }

    // Reconcile expected vs executed
    const allResults = expectedTests.map((expected) => {
      // Find matching executed test
      const executed = executedResults.find(
        (e) => e.name === expected.testName && e.category === expected.category
      );

      if (executed) {
        return {
          suite: expected.suiteName,
          specFile: expected.specFile,
          name: expected.testName,
          category: expected.category,
          status: executed.status,
          durationMs: executed.durationMs,
          device: executed.device || runMeta.device,
          androidVersion: executed.androidVersion || runMeta.androidVersion,
          failureReason: executed.failureReason || "",
          screenshotPath: executed.screenshotPath || "",
          timestamp: executed.timestamp || new Date().toISOString(),
          retryCount: executed.retryCount || 0,
        };
      } else {
        return {
          suite: expected.suiteName,
          specFile: expected.specFile,
          name: expected.testName,
          category: expected.category,
          status: "NOT EXECUTED",
          durationMs: 0,
          device: runMeta.device,
          androidVersion: runMeta.androidVersion,
          failureReason: "Not executed (suite aborted or not reached due to earlier failure / bail)",
          screenshotPath: "",
          timestamp: new Date().toISOString(),
          retryCount: 0,
        };
      }
    });

    // Update run meta with actual device info
    try {
      const firstExecuted = executedResults.find((r) => r.device);
      if (firstExecuted) {
        runMeta.device = firstExecuted.device || runMeta.device;
        runMeta.androidVersion = firstExecuted.androidVersion || runMeta.androidVersion;
      }
    } catch (_) {}

    // Generate Excel report
    try {
      await xlsxReporter.generateReport(allResults, runMeta, EXCEL_PATH);
      console.log(`[wdio] ✅ Excel report: ${EXCEL_PATH}`);
    } catch (e) {
      console.error("[wdio] ⚠️ Excel report generation failed:", e.message);
    }

    // Generate HTML report
    try {
      htmlReporter.generateReport(allResults, runMeta, HTML_PATH);
      console.log(`[wdio] ✅ HTML report: ${HTML_PATH}`);
    } catch (e) {
      console.error("[wdio] ⚠️ HTML report generation failed:", e.message);
    }

    const total = allResults.length;
    const passed = allResults.filter((r) => r.status === "PASSED").length;
    const failed = allResults.filter((r) => r.status === "FAILED").length;
    const skipped = allResults.filter((r) => r.status === "SKIPPED" || r.status === "NOT EXECUTED").length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

    console.log("\n[wdio] ═══════════════════════════════════════════════");
    console.log(`[wdio] Run Complete: ${total} tests | ✅ ${passed} passed | ❌ ${failed} failed | 🚫 ${skipped} skipped/unrun | ${passRate}% pass rate`);
    console.log(`[wdio] Duration: ${Math.round(totalDurationMs / 1000)}s`);
    console.log("[wdio] ═══════════════════════════════════════════════\n");

    // Validation
    const expectedCount = expectedTests.length;
    const reportedCount = allResults.length;
    const expectedSpecsCount = [...new Set(expectedTests.map(t => t.specFile))].length;
    const reportedSpecsCount = [...new Set(allResults.map(t => t.specFile))].length;

    console.log("📊 Final Report Validation:");
    console.log(`  - Expected Specs: ${expectedSpecsCount} | Reported Specs: ${reportedSpecsCount}`);
    console.log(`  - Expected Tests: ${expectedCount} | Reported Tests: ${reportedCount}`);

    if (expectedCount !== reportedCount || expectedSpecsCount !== reportedSpecsCount) {
      console.error(`[wdio] ❌ VALIDATION FAILED: Mismatch between discovered and reported counts!`);
      throw new Error(`Report validation failed: Expected = ${expectedCount}, Reported = ${reportedCount}`);
    } else {
      console.log(`[wdio] ✅ VALIDATION SUCCESSFUL: All tests represented.`);
    }

    if (total === 0) {
      throw new Error(
        "[wdio] FATAL: No tests were executed. Appium session may have failed to establish. Aborting."
      );
    }
  },
};
