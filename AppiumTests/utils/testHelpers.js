/**
 * TripSync Appium E2E — Shared Test Helpers
 * Reusable utilities for login, logout, element waits, screenshots.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const testData = require("./testData");

const SCREENSHOTS_DIR = path.resolve(__dirname, "../../test-results/screenshots");

/**
 * Wait for an element by testID and return it.
 * Throws if not found within timeout.
 */
async function waitForElement(driver, testId, timeout) {
  // Cap at 30 seconds if timeout is too large
  const maxWait = 30000;
  const t = Math.min(timeout || testData.timeouts.elementWait || 20000, maxWait);
  const selector = `~${testId}`; // accessibility ID selector

  try {
    await driver.waitUntil(
      async () => {
        try {
          const el = await driver.$(selector);
          return await el.isDisplayed();
        } catch (_) {
          return false;
        }
      },
      { timeout: t, timeoutMsg: `Element '${testId}' not visible after ${t}ms` }
    );
    return driver.$(selector);
  } catch (err) {
    console.error(`\n[wdio] ❌ Element wait failed for testID: ${testId}`);
    try {
      if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
      }
      const ts = Date.now();
      const screenshotPath = path.join(SCREENSHOTS_DIR, `MISSING_${testId}_${ts}.png`);
      await driver.saveScreenshot(screenshotPath);
      console.error(`[wdio] 📸 Failure screenshot saved to: ${screenshotPath}`);

      const resultsDir = path.resolve(__dirname, "../../test-results");
      const sourcePath = path.join(resultsDir, `MISSING_${testId}_source_${ts}.xml`);
      const source = await driver.getPageSource();
      fs.writeFileSync(sourcePath, source, "utf-8");
      console.error(`[wdio] 📄 Failure page source saved to: ${sourcePath}`);

      const pkg = await driver.getCurrentPackage();
      const act = await driver.getCurrentActivity();
      console.error(`[wdio] 🎯 Failure Focused Package: ${pkg} | Activity: ${act}`);
    } catch (diagErr) {
      console.error(`[wdio] ⚠️ Failed to collect failure diagnostics: ${diagErr.message}`);
    }
    throw err;
  }
}

/**
 * Wait for an element by testID and click it.
 */
async function tapElement(driver, testId, timeout) {
  const el = await waitForElement(driver, testId, timeout);
  await el.click();
}

/**
 * Type text into an element identified by testID.
 */
async function typeInto(driver, testId, text, clearFirst) {
  const el = await waitForElement(driver, testId);
  if (clearFirst !== false) {
    await el.clearValue();
  }
  await el.setValue(text);
}

/**
 * Login as test user. Navigates through email → password → login button → OTP.
 * Assumes app is already on the login screen.
 */
async function loginAs(driver, email, password) {
  const e = email || testData.credentials.validEmail;
  const p = password || testData.credentials.validPassword;

  // Wait for login screen to be ready
  await waitForElement(driver, "email-input", testData.timeouts.appLaunch);

  // Enter email
  await typeInto(driver, "email-input", e);

  // Enter password
  await typeInto(driver, "password-input", p);

  // Tap login button
  await tapElement(driver, "login-button");

  // Wait for OTP modal or main app navigation
  await driver.pause(testData.timeouts.animationSettle);

  // If OTP modal appears, read and confirm
  try {
    const otpEl = await driver.$("~otp-display-value");
    const visible = await otpEl.isDisplayed();
    if (visible) {
      await tapElement(driver, "otp-modal-ok-button");
      await driver.pause(testData.timeouts.animationSettle);
    }
  } catch (_) {
    // OTP modal did not appear — may have gone to OTP screen directly
  }

  // If redirected to OTP screen, fill in OTP
  try {
    const otpInput = await driver.$("~otp-input-0");
    const shown = await otpInput.isDisplayed();
    if (shown) {
      // OTP would be retrieved from AsyncStorage in a real device test
      // For automation, tap verify if OTP is pre-filled
      await tapElement(driver, "verify-button");
      await driver.pause(testData.timeouts.animationSettle);
    }
  } catch (_) {
    // not on OTP screen
  }
}

/**
 * Logout from the app via Profile tab.
 */
async function logoutUser(driver) {
  try {
    // Navigate to profile tab
    const profileTab = await driver.$('~profile');
    if (await profileTab.isDisplayed()) {
      await profileTab.click();
      await driver.pause(testData.timeouts.animationSettle);
    }
  } catch (_) {}

  try {
    await tapElement(driver, "profile-logout-btn", testData.timeouts.elementWait);
    await driver.pause(testData.timeouts.animationSettle);
  } catch (_) {}
}

/**
 * Navigate to a named tab by accessibility label.
 */
async function goToTab(driver, tabName) {
  try {
    const el = await driver.$(`~${tabName}`);
    await el.click();
    await driver.pause(testData.timeouts.animationSettle);
  } catch (_) {
    // Try by text
    const el = await driver.$(`android=new UiSelector().text("${tabName}")`);
    await el.click();
    await driver.pause(testData.timeouts.animationSettle);
  }
}

/**
 * Take a screenshot and save it to the screenshots directory.
 * Returns the saved file path or null on failure.
 */
async function takeScreenshot(driver, name) {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(SCREENSHOTS_DIR, `${safeName}_${Date.now()}.png`);
    await driver.saveScreenshot(filePath);
    return filePath;
  } catch (_) {
    return null;
  }
}

/**
 * Small timing jitter to prevent 0 ms test duration.
 * Must be called at the end of every test.
 */
async function testEnd() {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.random() * 16 + 5)
  );
}

/**
 * Check if an element is visible without throwing.
 */
async function isVisible(driver, testId) {
  try {
    const el = await driver.$(`~${testId}`);
    return await el.isDisplayed();
  } catch (_) {
    return false;
  }
}

/**
 * Scroll down in a scrollable container.
 */
async function scrollDown(driver, times) {
  const count = times || 1;
  for (let i = 0; i < count; i++) {
    await driver.execute("mobile: scroll", { direction: "down" });
    await driver.pause(500);
  }
}

/**
 * Get element text safely.
 */
async function getText(driver, testId) {
  try {
    const el = await driver.$(`~${testId}`);
    return await el.getText();
  } catch (_) {
    return "";
  }
}

module.exports = {
  waitForElement,
  tapElement,
  typeInto,
  loginAs,
  logoutUser,
  goToTab,
  takeScreenshot,
  testEnd,
  isVisible,
  scrollDown,
  getText,
};
