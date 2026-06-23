const { execSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

console.log("====================================================");
console.log("🚀 STARTING TRIPSYNC APPIUM E2E TESTING PIPELINE");
console.log("====================================================");

const TARGET_UDID = "3085584598000GN";
const APK_PATH = path.join(__dirname, "../../android/app/build/outputs/apk/debug/app-debug.apk");
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
const logStream = fs.createWriteStream(path.join(testResultsDir, 'appium.log'), { flags: 'a' });
const appiumProcess = spawn('npx', ['appium', '--port', '4723', '--allow-insecure', 'chromedriver_autodownload'], {
    shell: true,
    detached: false
});

appiumProcess.stdout.pipe(logStream);
appiumProcess.stderr.pipe(logStream);

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
