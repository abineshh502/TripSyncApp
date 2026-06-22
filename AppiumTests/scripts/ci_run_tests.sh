#!/bin/bash

# TripSync Appium E2E Automation Runner Script
echo "===================================================="
echo "🚀 STARTING TRIPSYNC APPIUM E2E TESTING PIPELINE"
echo "===================================================="

# Ensure test-results folder exists
mkdir -p test-results

# Helper to verify adb device online state
verify_adb_device() {
    for attempt in {1..10}; do
        echo "🔍 Checking adb device state (Attempt $attempt/10)..."
        adb wait-for-device
        
        # Check if the device is showing offline
        device_status=$(adb devices | grep -E "emulator-5554|emulator" | head -n 1 | awk '{print $2}' | tr -d '\r')
        echo "Device status reported as: '$device_status'"
        
        if [ "$device_status" = "offline" ] || [ -z "$device_status" ]; then
            echo "⚠️ Device is offline or undetected. Restarting ADB server..."
            adb kill-server
            adb start-server
            sleep 5
        elif [ "$device_status" = "device" ]; then
            echo "✓ Device is online and ready!"
            return 0
        else
            echo "⚠️ Device status is '$device_status', waiting..."
            sleep 3
        fi
    done
    
    echo "❌ ERROR: ADB device is not ready or still offline."
    return 1
}

# 1. VERIFY EMULATOR BOOT COMPLETION
echo "⏳ Waiting for Android emulator boot completion..."
adb wait-for-device
boot_completed=false
for i in {1..60}; do
    status=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [ "$status" = "1" ]; then
        echo "✓ Emulator is fully booted (sys.boot_completed=1)!"
        boot_completed=true
        break
    fi
    echo "  - Waiting for sys.boot_completed... ($i/60 seconds)"
    sleep 2
done

if [ "$boot_completed" = false ]; then
    echo "❌ ERROR: Emulator failed to boot within time limit."
    exit 1
fi

# 2. VERIFY ADB DEVICES ONLINE
verify_adb_device
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Emulator device is offline or unavailable."
    exit 1
fi

echo "📱 Connected ADB Devices:"
adb devices

# 3. APK INSTALLATION
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
echo "📦 Installing APK from: $APK_PATH..."
if [ -f "$APK_PATH" ]; then
    adb install -r "$APK_PATH"
    if [ $? -eq 0 ]; then
        echo "✓ APK installed successfully on emulator!"
    else
        echo "❌ ERROR: Failed to install APK on device."
        exit 1
    fi
else
    echo "❌ ERROR: Build artifact app-debug.apk not found at $APK_PATH."
    exit 1
fi

# 4. VERIFY PACKAGE INSTALLED
echo "🔍 Checking installed packages on device..."
installed_packages=$(adb shell pm list packages | grep "com.kondajeswanth.TripSyncApp" | tr -d '\r')
if [[ -z "$installed_packages" ]]; then
    echo "❌ ERROR: Package com.kondajeswanth.TripSyncApp was NOT installed correctly on the emulator!"
    exit 1
else
    echo "✓ Verified package is present: $installed_packages"
fi

# 5. START APPIUM SERVER
echo "🔥 Starting Appium Server on port 4723..."
npx appium --port 4723 --allow-insecure chromedriver_autodownload > test-results/appium.log 2>&1 &
APPIUM_PID=$!

echo "⏳ Waiting for Appium Server to accept connections..."
appium_ready=false
for i in {1..30}; do
    curl -s http://127.0.0.1:4723/status > /dev/null
    if [ $? -eq 0 ]; then
        echo "✓ Appium Server is healthy and running!"
        appium_ready=true
        break
    fi
    sleep 2
done

if [ "$appium_ready" = false ]; then
    echo "❌ ERROR: Appium Server failed to start on port 4723."
    kill $APPIUM_PID 2>/dev/null
    exit 1
fi

# 6. EXECUTE WDIO E2E TESTS
echo "🧪 Running WebdriverIO Test Suite..."
cd AppiumTests
npm install
APK_PATH="../android/app/build/outputs/apk/debug/app-debug.apk" npx wdio run wdio.conf.js
TEST_EXIT_CODE=$?

# 7. DIAGNOSTIC CAPTURES
echo "⚙️ Gathering diagnostic outputs..."
echo "--- Active Device Focus ---"
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || echo "Focused window details unavailable"

echo "📸 Capturing emulator screenshot..."
mkdir -p ../test-results/screenshots
adb shell screencap -p /sdcard/emulator_screen.png
adb pull /sdcard/emulator_screen.png ../test-results/screenshots/emulator_screen.png

echo "===================================================="
echo "🏁 E2E Suite finished with Exit Code: $TEST_EXIT_CODE"
echo "===================================================="

# Kill Appium background process
kill $APPIUM_PID 2>/dev/null

exit $TEST_EXIT_CODE
