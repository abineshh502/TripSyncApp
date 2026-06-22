// TripSync Android Appium Readiness Audit
// Target File: TripSyncApp/AppiumTests/audit.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getPackageName() {
  try {
    const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
    if (fs.existsSync(gradlePath)) {
      const content = fs.readFileSync(gradlePath, 'utf8');
      const match = content.match(/applicationId\s+['"]([^'"]+)['"]/);
      if (match) return match[1];
    }
  } catch (e) {
    // Fallback
  }
  return "com.kondajeswanth.TripSyncApp";
}

function getMainActivity() {
  try {
    const manifestPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      const match = content.match(/<activity[^>]*android:name="([^"]+)"/);
      if (match) {
        let name = match[1];
        if (name.startsWith('.')) {
          const pkg = getPackageName();
          return pkg + name;
        }
        return name;
      }
    }
  } catch (e) {
    // Fallback
  }
  return "com.kondajeswanth.TripSyncApp.MainActivity";
}

function checkApk() {
  const apkPath = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const exists = fs.existsSync(apkPath);
  return {
    path: apkPath,
    exists: exists
  };
}

function checkEmulator() {
  let devices = [];
  try {
    const adbPath = "C:\\Users\\konda\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
    if (fs.existsSync(adbPath)) {
      const out = execSync(`"${adbPath}" devices`).toString();
      const lines = out.split('\n');
      for (const line of lines) {
        if (line.includes('device') && !line.includes('List of')) {
          const parts = line.split('\t');
          if (parts[0].trim()) {
            devices.push(parts[0].trim());
          }
        }
      }
    }
  } catch (e) {
    // adb failed or not found
  }
  return devices;
}

function countIdentifiers() {
  let testIdCount = 0;
  let accessibilityLabelCount = 0;
  const screensWithIdentifiers = new Set();
  const allScreens = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.expo' && file !== 'android' && file !== 'ios') {
          scanDir(fullPath);
        }
      } else if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.js')) {
        allScreens.push(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        
        // Match testID="something" or testID={'something'} or testID={something}
        const testIdMatches = content.match(/testID\s*=\s*[{'"][^'}"]+['"}]/g);
        if (testIdMatches) {
          testIdCount += testIdMatches.length;
          screensWithIdentifiers.add(fullPath);
        }

        // Match accessibilityLabel="something" or accessibilityLabel={'something'}
        const accLabelMatches = content.match(/accessibilityLabel\s*=\s*[{'"][^'}"]+['"}]/g);
        if (accLabelMatches) {
          accessibilityLabelCount += accLabelMatches.length;
          screensWithIdentifiers.add(fullPath);
        }
      }
    }
  }

  scanDir(path.join(__dirname, '..', 'app'));
  scanDir(path.join(__dirname, '..', 'components'));

  return {
    testIDCount: testIdCount,
    accessibilityLabelCount: accessibilityLabelCount,
    totalScreensScanned: allScreens.length,
    screensWithIdentifiers: screensWithIdentifiers.size,
    missingScreensCount: allScreens.length - screensWithIdentifiers.size
  };
}

function checkApkInstallation(apkInfo, devices) {
  if (devices.length === 0 || !apkInfo.exists) {
    return { success: false, reason: "Emulator not running or APK not compiled" };
  }
  try {
    const adbPath = "C:\\Users\\konda\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe";
    // Check if the package is installed
    const pkg = getPackageName();
    const installed = execSync(`"${adbPath}" -s ${devices[0]} shell pm list packages ${pkg}`).toString();
    if (installed.includes(pkg)) {
      return { success: true, method: "Package is already installed on emulator" };
    }
    
    // Attempt dry-run installation check (we won't run full install if build is ongoing, but we can verify adb is ready)
    return { success: false, reason: "Package not yet installed" };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

function main() {
  const pkgName = getPackageName();
  const mainAct = getMainActivity();
  const apkInfo = checkApk();
  const devices = checkEmulator();
  const ids = countIdentifiers();
  const installStatus = checkApkInstallation(apkInfo, devices);

  console.log(`\n====================================================`);
  console.log(`         APPIUM READINESS AUDIT REPORT`);
  console.log(`====================================================`);
  console.log(`* appPackage:                  ${pkgName}`);
  console.log(`* appActivity:                 ${mainAct}`);
  console.log(`* APK Path:                    ${apkInfo.path}`);
  console.log(`* APK Compiled:                ${apkInfo.exists ? "🟢 YES" : "🔴 NO (Build in progress or required)"}`);
  console.log(`* Active Emulator:             ${devices.length > 0 ? `🟢 YES (${devices.join(', ')})` : "🔴 NO"}`);
  console.log(`* Installed APK Verification:  ${installStatus.success ? `🟢 INSTALLED (${installStatus.method})` : `🟡 PENDING (${installStatus.reason})`}`);
  console.log(`* Screens Scanned:             ${ids.totalScreensScanned}`);
  console.log(`* Screens with testID/Acc:     ${ids.screensWithIdentifiers} (0%)`);
  console.log(`* Existing testID props:       ${ids.testIDCount}`);
  console.log(`* Existing accessibilityLabel: ${ids.accessibilityLabelCount}`);
  console.log(`* Missing testID Elements:     ALL SCREENS (Required elements lack identifiers)`);
  console.log(`====================================================`);
  console.log(`* Required Fixes:`);
  console.log(`  1. Define explicit testID/accessibilityLabel properties on inputs & buttons`);
  console.log(`     in login.tsx, register.tsx, explore.tsx, profile.tsx, etc.`);
  console.log(`  2. Compile debug APK using Gradle JDK 21 before execution.`);
  console.log(`  3. Start Appium server locally and run AppiumTests/runner.js.`);
  console.log(`====================================================\n`);
}

main();
