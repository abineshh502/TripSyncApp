#!/bin/bash

# TripSync Appium E2E Automation Runner Script (Real Device)
echo "===================================================="
echo "🚀 STARTING TRIPSYNC APPIUM E2E TESTING PIPELINE"
echo "===================================================="

# Ensure test-results folder exists
mkdir -p test-results

# Define target device UDID
TARGET_UDID="3085584598000GN"

# 1. VERIFY REAL DEVICE CONNECTION
echo "🔍 Checking connected ADB devices..."
adb devices

# Check if the specific device is connected
if ! adb devices | grep -q "$TARGET_UDID"; then
    echo "❌ ERROR: Target physical device $TARGET_UDID is not connected or unauthorized!"
    exit 1
fi
echo "✓ Physical device $TARGET_UDID is online and ready!"

# Define adb wrapper function to target the real device
adb() {
    # Bypass device targeting for server controls and device lists
    if [[ "$1" == "devices" ]] || [[ "$1" == "kill-server" ]] || [[ "$1" == "start-server" ]]; then
        command adb "$@"
        return $?
    fi

    # Execute command targeting the physical device
    command adb -s "$TARGET_UDID" "$@"
}

# 2. APK INSTALLATION
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
echo "📦 Installing APK on device $TARGET_UDID from: $APK_PATH..."
if [ -f "$APK_PATH" ]; then
    adb install -r "$APK_PATH"
    if [ $? -eq 0 ]; then
        echo "✓ APK installed successfully on physical device!"
    else
        echo "❌ ERROR: Failed to install APK on device."
        exit 1
    fi
else
    echo "❌ ERROR: Build artifact app-debug.apk not found at $APK_PATH."
    exit 1
fi

# 3. VERIFY PACKAGE INSTALLED
echo "🔍 Checking installed packages on device..."
installed_packages=$(adb shell pm list packages | grep "com.kondajeswanth.TripSyncApp" | tr -d '\r')
if [[ -z "$installed_packages" ]]; then
    echo "❌ ERROR: Package com.kondajeswanth.TripSyncApp was NOT installed correctly on the physical device!"
    exit 1
else
    echo "✓ Verified package is present: $installed_packages"
fi

# Launch App
echo "🚀 Launching TripSync app on physical device..."
adb shell am start -n com.kondajeswanth.TripSyncApp/.MainActivity
sleep 5

# 4. START APPIUM SERVER
echo "🔍 Verifying Appium installation..."
if ! npx appium --version > /dev/null 2>&1; then
    echo "❌ ERROR: Appium is not installed in the environment."
    exit 1
fi
echo "✓ Appium version: $(npx appium --version)"

echo "🔥 Starting Appium Server on port 4723..."
npx appium --port 4723 --allow-insecure chromedriver_autodownload > test-results/appium.log 2>&1 &
APPIUM_PID=$!

# 5. VERIFY APPIUM STATUS ENDPOINT
echo "⏳ Waiting for Appium Server to accept connections..."
appium_ready=false
for i in {1..20}; do
    curl -s http://127.0.0.1:4723/status > /dev/null
    if [ $? -eq 0 ]; then
        echo "✓ Appium Server is healthy and running!"
        appium_ready=true
        break
    fi
    sleep 3
done

if [ "$appium_ready" = false ]; then
    echo "❌ ERROR: Appium Server failed to start on port 4723."
    kill $APPIUM_PID 2>/dev/null
    exit 1
fi

# 6. EXECUTE WDIO E2E TESTS
echo "🧪 Running WebdriverIO Test Suite..."
export APK_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
export ANDROID_DEVICE_SERIAL="$TARGET_UDID"
cd AppiumTests
npx wdio run wdio.conf.js
TEST_EXIT_CODE=$?

# 7. DIAGNOSTIC CAPTURES
echo "⚙️ Gathering diagnostic outputs..."
echo "--- Active Device Focus ---"
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || echo "Focused window details unavailable"

echo "📷 Capturing screenshot..."
mkdir -p ../test-results/screenshots
adb shell screencap -p /sdcard/device_screen.png
adb pull /sdcard/device_screen.png ../test-results/screenshots/device_screen.png

echo "===================================================="
echo "🏁 E2E Suite finished with Exit Code: $TEST_EXIT_CODE"
echo "===================================================="

# Kill Appium background process
kill $APPIUM_PID 2>/dev/null

exit $TEST_EXIT_CODE
