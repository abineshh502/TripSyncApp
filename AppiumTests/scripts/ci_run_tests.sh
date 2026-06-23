#!/bin/bash

# TripSync Appium E2E Automation Runner Script
echo "===================================================="
echo "🚀 STARTING TRIPSYNC APPIUM E2E TESTING PIPELINE"
echo "===================================================="

# Ensure test-results folder exists
mkdir -p test-results

# Helper to verify adb device online state and boot completion
verify_emulator_ready() {
    echo "⏳ Checking emulator state..."
    for i in {1..40}; do
        # Get status of emulator-5554 or first emulator
        device_status=$(adb devices | grep -E "emulator-5554|emulator" | head -n 1 | awk '{print $2}' | tr -d '\r')
        echo "Attempt $i/40: Emulator status: '$device_status'"
        
        if [ "$device_status" = "offline" ]; then
            echo "⚠️ Device is offline. Restarting ADB server..."
            adb kill-server
            adb start-server
            sleep 5
            continue
        elif [ -z "$device_status" ]; then
            echo "⚠️ No emulator detected. Waiting..."
            sleep 5
            continue
        elif [ "$device_status" = "device" ]; then
            # Check sys.boot_completed
            boot_status=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
            echo "sys.boot_completed: '$boot_status'"
            if [ "$boot_status" = "1" ]; then
                echo "✓ Emulator is fully booted and online (device)!"
                
                echo "⏳ Let the emulator settle down (sleep 30s)..."
                sleep 30
                
                # Disable animations to speed up rendering and save CPU resources
                echo "⚙️ Disabling animations..."
                adb shell settings put global window_animation_scale 0.0
                adb shell settings put global transition_animation_scale 0.0
                adb shell settings put global animator_duration_scale 0.0
                
                # Disable ANR dialogs
                echo "⚙️ Disabling system ANR dialogs..."
                adb shell settings put global show_anr_dialogs 0
                
                # Dismiss any leftover crash/ANR/first-run dialogs
                echo "⚙️ Dismissing potential system dialogs..."
                adb shell input keyevent 4
                
                return 0
            fi
        fi
        sleep 5
    done
    echo "❌ ERROR: Emulator failed to boot or remains offline."
    return 1
}

# 1. VERIFY EMULATOR BOOT AND ONLINE STATUS
verify_emulator_ready
if [ $? -ne 0 ]; then
    echo "❌ ERROR: Emulator device is not online or ready."
    exit 1
fi

echo "📱 Connected ADB Devices:"
adb devices

# 2. APK INSTALLATION
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

# 3. VERIFY PACKAGE INSTALLED
echo "🔍 Checking installed packages on device..."
installed_packages=$(adb shell pm list packages | grep "com.kondajeswanth.TripSyncApp" | tr -d '\r')
if [[ -z "$installed_packages" ]]; then
    echo "❌ ERROR: Package com.kondajeswanth.TripSyncApp was NOT installed correctly on the emulator!"
    exit 1
else
    echo "✓ Verified package is present: $installed_packages"
fi

# 4. START APPIUM SERVER
echo "🔥 Installing Appium UiAutomator2 Driver..."
npx appium driver install uiautomator2 || true

echo "🔥 Starting Appium Server on port 4723..."
npx appium --port 4723 --allow-insecure chromedriver_autodownload > test-results/appium.log 2>&1 &
APPIUM_PID=$!

# 5. VERIFY APPIUM STATUS ENDPOINT
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
export APK_PATH="$(pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
echo "📍 Resolved absolute APK path: $APK_PATH"
cd AppiumTests
npx wdio run wdio.conf.js
TEST_EXIT_CODE=$?

# 7. DIAGNOSTIC CAPTURES
echo "⚙️ Gathering diagnostic outputs..."
echo "--- Active Device Focus ---"
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || echo "Focused window details unavailable"

echo "📷 Capturing emulator screenshot..."
mkdir -p ../test-results/screenshots
adb shell screencap -p /sdcard/emulator_screen.png
adb pull /sdcard/emulator_screen.png ../test-results/screenshots/emulator_screen.png

echo "===================================================="
echo "🏁 E2E Suite finished with Exit Code: $TEST_EXIT_CODE"
echo "===================================================="

# Kill Appium background process
kill $APPIUM_PID 2>/dev/null

exit $TEST_EXIT_CODE
