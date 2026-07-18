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

  // Wait for OTP modal OR OTP input screen to become visible
  let mode = null; // 'modal' or 'screen'
  const start = Date.now();
  const timeout = 15000; // max wait for OTP initiation

  while (Date.now() - start < timeout) {
    // Check for OTP modal OK button
    try {
      const okBtn = await driver.$("~otp-modal-ok-button");
      if (await okBtn.isDisplayed()) {
        mode = "modal";
        break;
      }
    } catch (_) {}

    // Check for OTP input screen verify button
    try {
      const verifyBtn = await driver.$("~verify-button");
      if (await verifyBtn.isDisplayed()) {
        mode = "screen";
        break;
      }
    } catch (_) {}

    await driver.pause(500);
  }

  console.log(`[loginAs] Detected OTP mode: ${mode}`);

  if (mode === "modal") {
    let otpText = "";
    try {
      const otpValEl = await driver.$("~otp-display-value");
      otpText = (await otpValEl.getText()).trim();
      console.log(`[loginAs] Found OTP on modal: ${otpText}`);
    } catch (_) {}

    await tapElement(driver, "otp-modal-ok-button");
    await driver.pause(testData.timeouts.animationSettle);
    
    // Now wait for the OTP input screen to load
    await waitForElement(driver, "verify-button", 10000);
    
    // Type the OTP digits
    if (otpText && otpText.length === 6) {
      console.log(`[loginAs] Typing OTP: ${otpText}`);
      const digits = otpText.split("");
      for (let i = 0; i < 6; i++) {
        await typeInto(driver, `otp-input-${i}`, digits[i]);
      }
    }
    
    await tapElement(driver, "verify-button");
    await driver.pause(testData.timeouts.animationSettle);
  } else if (mode === "screen") {
    // If we land on screen directly without modal, check if OTP was prefilled or try tapping verify
    await tapElement(driver, "verify-button");
    await driver.pause(testData.timeouts.animationSettle);
  }
}

async function logoutUser(driver) {
  try {
    await goToTab(driver, "profile");
  } catch (_) {}

  // Scroll down to ensure logout button is visible on smaller device viewport
  try {
    await scrollDown(driver, 2);
  } catch (_) {}

  try {
    await tapElement(driver, "profile-logout-btn", testData.timeouts.elementWait);
    await driver.pause(testData.timeouts.animationSettle);
    
    // Accept standard React Native alert dialog
    try {
      await driver.acceptAlert();
    } catch (_) {
      try {
        const confirmBtn = await driver.$('android=new UiSelector().textMatches("(?i)Logout")');
        await confirmBtn.click();
      } catch (_) {}
    }
    await driver.pause(testData.timeouts.animationSettle);
  } catch (_) {}
}

/**
 * Navigate to a named tab by accessibility label.
 */
async function goToTab(driver, tabName) {
  // Dismiss keyboard if shown to ensure tab bar is visible
  try {
    if (await driver.isKeyboardShown()) {
      await driver.hideKeyboard();
      await driver.pause(500);
    }
  } catch (_) {}

  const nameLower = tabName.toLowerCase();
  const nameCap = nameLower.charAt(0).toUpperCase() + nameLower.slice(1);
  
  const selectors = [
    `~${nameCap}`,
    `~${nameLower}`,
    `android=new UiSelector().text("${nameCap}")`,
    `android=new UiSelector().text("${nameLower}")`,
    `android=new UiSelector().description("${nameCap}")`,
    `android=new UiSelector().description("${nameLower}")`,
    `android=new UiSelector().descriptionMatches("(?i)${nameLower}, tab,.*")`
  ];

  let error = null;
  for (const sel of selectors) {
    try {
      const el = await driver.$(sel);
      if (await el.isDisplayed()) {
        await el.click();
        await driver.pause(testData.timeouts.animationSettle);
        return;
      }
    } catch (e) {
      error = e;
    }
  }

  throw new Error(`Can't navigate to tab "${tabName}". Checked selectors: ${selectors.join(", ")}. Last error: ${error ? error.message : "None"}`);
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

async function scrollDown(driver, times) {
  const count = times || 1;
  for (let i = 0; i < count; i++) {
    const size = await driver.getWindowSize();
    const x = Math.round(size.width / 2);
    const startY = Math.round(size.height * 0.7);
    const endY = Math.round(size.height * 0.3);

    await driver.performActions([
      {
        type: "pointer",
        id: "finger1",
        parameters: { pointerType: "touch" },
        actions: [
          { type: "pointerMove", duration: 0, x, y: startY },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration: 600, x, y: endY },
          { type: "pointerUp", button: 0 }
        ]
      }
    ]);
    await driver.pause(600);
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
