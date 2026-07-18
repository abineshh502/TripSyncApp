const { execSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 0. AUTO-DETECT ANDROID SDK AND CONFIGURE PATH
const possiblePaths = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(process.env.USERPROFILE || '', 'AppData/Local/Android/Sdk'),
  path.join(process.env.HOME || '', 'Library/Android/sdk'),
  path.join(process.env.HOME || '', 'Android/Sdk'),
  'C:/Users/konda/AppData/Local/Android/Sdk',
  'C:/Android/Sdk',
  '/usr/lib/android-sdk',
  '/Library/Android/sdk'
].filter(Boolean);

let sdkPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    sdkPath = p;
    break;
  }
}

if (!sdkPath) {
  console.error("❌ ERROR: Android SDK path could not be resolved.");
  process.exit(1);
}
console.log(`✓ Resolved Android SDK Path: ${sdkPath}`);

const platformToolsDir = path.join(sdkPath, 'platform-tools');
if (!fs.existsSync(platformToolsDir)) {
  console.error(`❌ ERROR: platform-tools directory not found at: ${platformToolsDir}`);
  process.exit(1);
}

process.env.ANDROID_HOME = sdkPath;
process.env.ANDROID_SDK_ROOT = sdkPath;
console.log(`✓ Exported ANDROID_HOME and ANDROID_SDK_ROOT: ${sdkPath}`);

const isWindows = process.platform === 'win32';
if (isWindows) {
    process.env.PATH = `${platformToolsDir};${process.env.PATH}`;
} else {
    process.env.PATH = `${platformToolsDir}:${process.env.PATH}`;
}
console.log(`✓ Prepended platform-tools to PATH: ${platformToolsDir}`);

console.log("====================================================");
console.log("🚀 STARTING TRIPSYNC APPIUM E2E TESTING PIPELINE");
console.log("====================================================");

const TARGET_UDID = "3085584598000GN";

// Helper to recursively find the newest APK file
function getNewestApk(dir) {
    let newestApk = null;
    let newestTime = 0;

    function search(currentDir) {
        if (!fs.existsSync(currentDir)) return;
        const files = fs.readdirSync(currentDir);
        for (const file of files) {
            const filePath = path.join(currentDir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                search(filePath);
            } else if (file.endsWith('.apk')) {
                if (stat.mtimeMs > newestTime) {
                    newestTime = stat.mtimeMs;
                    newestApk = filePath;
                }
            }
        }
    }

    search(dir);
    return newestApk;
}

const apkSearchDir = path.join(__dirname, "../../android/app/build/outputs/apk");
const detectedApk = getNewestApk(apkSearchDir);
const APK_PATH = detectedApk || path.join(__dirname, "../../android/app/build/outputs/apk/debug/app-debug.apk");
console.log(`🔍 Auto-detected newest APK: ${APK_PATH}`);

const screenshotsDir = path.join(__dirname, "../../test-results/screenshots");

// Helper to run commands synchronously and log output
function runCmd(cmd, options = {}) {
    try {
        console.log(`Executing: ${cmd}`);
        return execSync(cmd, { stdio: 'inherit', ...options });
    } catch (e) {
        console.error(`❌ Command failed: ${cmd}`);
        process.exit(1);
    }
}

// 1. VERIFY REAL DEVICE CONNECTION
console.log("🔍 Checking connected ADB devices...");
const devicesOutput = execSync('adb devices').toString();
console.log(devicesOutput);

if (!devicesOutput.includes(TARGET_UDID)) {
    console.error(`❌ ERROR: Target physical device ${TARGET_UDID} is not connected or unauthorized!`);
    process.exit(1);
}
console.log(`✓ Physical device ${TARGET_UDID} is online and ready!`);

// Define adb wrapper function to target the real device
function adb(args) {
    runCmd(`adb -s ${TARGET_UDID} ${args}`);
}

// 2. APK INSTALLATION
console.log(`📦 Installing APK on device ${TARGET_UDID} from: ${APK_PATH}...`);
if (!fs.existsSync(APK_PATH)) {
    console.error(`❌ ERROR: Build artifact app-debug.apk not found at ${APK_PATH}.`);
    process.exit(1);
}

adb(`install -r "${APK_PATH}"`);
console.log("✓ APK installed successfully on physical device!");

// 3. VERIFY PACKAGE INSTALLED
console.log("🔍 Checking installed packages on device...");
const packageOutput = execSync(`adb -s ${TARGET_UDID} shell pm list packages`).toString();
if (!packageOutput.includes("com.kondajeswanth.TripSyncApp")) {
    console.error("❌ ERROR: Package com.kondajeswanth.TripSyncApp was NOT installed correctly on the physical device!");
    process.exit(1);
}
console.log("✓ Verified package is present!");

// Launch App
console.log("🚀 Launching TripSync app on physical device...");
adb(`shell am start -n com.kondajeswanth.TripSyncApp/.MainActivity`);
console.log("⏳ Waiting 5s for app startup...");
execSync('node -e "setTimeout(() => {}, 5000)"');

// 4. START APPIUM SERVER
console.log("🔍 Verifying Appium installation...");
try {
    const appiumVer = execSync('npx appium --version').toString().trim();
    console.log(`✓ Appium version: ${appiumVer}`);
} catch (e) {
    console.error("❌ ERROR: Appium is not installed in the environment.");
    process.exit(1);
}

console.log("🔥 Starting Appium Server on port 4723...");
const testResultsDir = path.join(__dirname, '../../test-results');
if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, { recursive: true });
}
const logFd = fs.openSync(path.join(testResultsDir, 'appium.log'), 'a');
const appiumPath = path.join(__dirname, '../../node_modules/appium/index.js');
const appiumProcess = spawn('node', [appiumPath, '--port', '4723', '--allow-insecure', 'chromedriver_autodownload'], {
    stdio: ['ignore', logFd, logFd],
    detached: false
});

appiumProcess.on('error', (err) => {
    console.error('❌ Failed to start Appium process:', err);
    process.exit(1);
});

// 5. VERIFY APPIUM STATUS ENDPOINT
console.log("⏳ Waiting for Appium Server to accept connections...");
let appiumReady = false;

function checkStatus(attempts = 1) {
    return new Promise((resolve) => {
        if (attempts > 20) {
            resolve(false);
            return;
        }

        http.get('http://127.0.0.1:4723/status', (res) => {
            if (res.statusCode === 200) {
                resolve(true);
            } else {
                setTimeout(() => resolve(checkStatus(attempts + 1)), 3000);
            }
        }).on('error', () => {
            setTimeout(() => resolve(checkStatus(attempts + 1)), 3000);
        });
    });
}

async function startTests() {
    appiumReady = await checkStatus();
    if (!appiumReady) {
        console.error("❌ ERROR: Appium Server failed to start on port 4723.");
        appiumProcess.kill();
        process.exit(1);
    }
    console.log("✓ Appium Server is healthy and running!");

    // 6. EXECUTE WDIO E2E TESTS
    console.log("🧪 Running WebdriverIO Test Suite...");
    process.env.APK_PATH = APK_PATH;
    process.env.ANDROID_DEVICE_SERIAL = TARGET_UDID;

    // Run wdio
    let testExitCode = 0;
    try {
        execSync('npx wdio run wdio.conf.js', { stdio: 'inherit', cwd: path.join(__dirname, '../') });
    } catch (error) {
        testExitCode = error.status || 1;
    }

    // 7. DIAGNOSTIC CAPTURES
    console.log("⚙️ Gathering diagnostic outputs...");
    console.log("--- Active Device Focus ---");
    try {
        const focusOutput = execSync(`adb -s ${TARGET_UDID} shell dumpsys window`).toString();
        const focusLines = focusOutput.split('\n').filter(line => line.includes('mCurrentFocus') || line.includes('mFocusedApp'));
        focusLines.forEach(line => console.log(line.trim()));
    } catch (e) {
        console.log("Focused window details unavailable");
    }

    console.log("📷 Capturing screenshot...");
    try {
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }
        execSync(`adb -s ${TARGET_UDID} shell screencap -p /sdcard/device_screen.png`);
        execSync(`adb -s ${TARGET_UDID} pull /sdcard/device_screen.png "${path.join(screenshotsDir, 'device_screen.png')}"`);
        console.log("✓ Screenshot captured and pulled successfully.");
    } catch (e) {
        console.error("❌ Failed to capture or pull screenshot:", e.message);
    }

    console.log("====================================================");
    console.log(`🏁 E2E Suite finished with Exit Code: ${testExitCode}`);
    console.log("====================================================");

    // Kill Appium background process
    appiumProcess.kill();
    process.exit(testExitCode);
}

startTests();
