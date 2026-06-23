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
    for i in {1..20}; do
        # Get status of the first detected emulator
        temp_device=$(command adb devices | awk '/emulator/{print $1; exit}')
        device_status=$(command adb devices | grep -E "emulator" | head -n 1 | awk '{print $2}' | tr -d '\r')
        echo "Attempt $i/20: Emulator ($temp_device) status: '$device_status'"
        
        if [ "$device_status" = "offline" ]; then
            echo "⚠️ Device is offline. Restarting ADB server..."
            command adb kill-server
            command adb start-server
            sleep 5
            continue
        elif [ -z "$device_status" ]; then
            echo "⚠️ No emulator detected. Waiting..."
            sleep 5
            continue
        elif [ "$device_status" = "device" ]; then
            # Check sys.boot_completed
            boot_status=$(command adb -s "$temp_device" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
            echo "sys.boot_completed: '$boot_status'"
            if [ "$boot_status" = "1" ]; then
                echo "✓ Emulator is fully booted and online (device)!"
                
                echo "⏳ Let the emulator settle down (sleep 30s)..."
                sleep 30
                
                # Disable animations to speed up rendering and save CPU resources
                echo "⚙️ Disabling animations..."
                command adb -s "$temp_device" shell settings put global window_animation_scale 0.0
                command adb -s "$temp_device" shell settings put global transition_animation_scale 0.0
                command adb -s "$temp_device" shell settings put global animator_duration_scale 0.0
                
                # Disable ANR dialogs
                echo "⚙️ Disabling system ANR dialogs..."
                command adb -s "$temp_device" shell settings put global show_anr_dialogs 0
                
                # Dismiss any leftover crash/ANR/first-run dialogs
                echo "⚙️ Dismissing potential system dialogs..."
                command adb -s "$temp_device" shell input keyevent 4
                
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
    echo "❌ ERROR: Emulator device is not online or ready after 20 attempts."
    exit 1
fi

# Dynamically resolve emulator serial
DEVICE=$(command adb devices | awk '/emulator/{print $1; exit}')
if [ -z "$DEVICE" ]; then
    echo "❌ ERROR: No emulator found after boot verification!"
    exit 1
fi

export ANDROID_DEVICE_SERIAL="$DEVICE"
echo "Resolved Emulator Serial: $DEVICE"

# Log to GitHub Step Summary
if [ -n "$GITHUB_STEP_SUMMARY" ]; then
    echo "### 📱 Resolved Emulator Serial" >> "$GITHUB_STEP_SUMMARY"
    echo "- **Serial:** \`$DEVICE\`" >> "$GITHUB_STEP_SUMMARY"
    echo "" >> "$GITHUB_STEP_SUMMARY"
    echo "#### ADB Devices Output" >> "$GITHUB_STEP_SUMMARY"
    echo "\`\`\`text" >> "$GITHUB_STEP_SUMMARY"
    command adb devices >> "$GITHUB_STEP_SUMMARY"
    echo "\`\`\`" >> "$GITHUB_STEP_SUMMARY"
fi

# Define adb wrapper function to target the resolved device and check connection
adb() {
    # Bypass verification/device targeting for server controls and device lists
    if [[ "$1" == "devices" ]] || [[ "$1" == "kill-server" ]] || [[ "$1" == "start-server" ]]; then
        command adb "$@"
        return $?
    fi

    # Before every adb command verify adb devices contains our emulator in device state
    if ! command adb devices | grep -w "$DEVICE" | grep -q "device"; then
        echo "❌ ERROR: Emulator '$DEVICE' disappeared during execution!"
        echo "=== Current ADB Devices ==="
        command adb devices
        
        # Log failure to GitHub Step Summary
        if [ -n "$GITHUB_STEP_SUMMARY" ]; then
            echo "### ❌ E2E Workflow Failure" >> "$GITHUB_STEP_SUMMARY"
            echo "Emulator \`$DEVICE\` disappeared during test execution." >> "$GITHUB_STEP_SUMMARY"
            echo "#### ADB Devices Output:" >> "$GITHUB_STEP_SUMMARY"
            echo "\`\`\`text" >> "$GITHUB_STEP_SUMMARY"
            command adb devices >> "$GITHUB_STEP_SUMMARY"
            echo "\`\`\`" >> "$GITHUB_STEP_SUMMARY"
        fi
        
        # Terminate main workflow process immediately
        kill -s TERM $$ 2>/dev/null
        exit 1
    fi

    # Execute command targeting the resolved emulator
    command adb -s "$DEVICE" "$@"
}

# Start background system dialog and ANR dismisser daemon
dismiss_system_dialogs_loop() {
    echo "🕵️ Starting background system dialog and ANR dismisser daemon..."
    while true; do
        focus=$(adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' 2>/dev/null)
        if [[ "$focus" == *"Application Not Responding"* ]] || [[ "$focus" == *"Crash"* ]] || [[ "$focus" == *"stopped"* ]] || [[ "$focus" == *"not responding"* ]]; then
            echo "⚠️ System ANR or dialog detected: $focus"
            if [[ "$focus" == *"com.android.systemui"* ]]; then
                echo "⚙️ Force-stopping com.android.systemui to clear ANR..."
                adb shell am force-stop com.android.systemui 2>/dev/null
            fi
            
            echo "⚙️ Sending CLOSE_SYSTEM_DIALOGS broadcast..."
            adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS 2>/dev/null
            
            echo "⚙️ Pressing BACK key..."
            adb shell input keyevent 4 2>/dev/null
            
            echo "⚙️ Sending DPAD_RIGHT and ENTER to dismiss dialog..."
            adb shell input keyevent 22 2>/dev/null
            adb shell input keyevent 66 2>/dev/null
        fi
        sleep 5
    done
}
dismiss_system_dialogs_loop &
DISMISSER_PID=$!

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

# 3b. LAUNCH APP AND VERIFY REACT NATIVE BUNDLE IS LOADED
echo "🚀 Launching TripSync app and waiting for React Native JS bundle to load..."
adb shell am start -n com.kondajeswanth.TripSyncApp/.MainActivity

echo "⏳ Waiting up to 90s for React Native JS thread to initialize..."
rn_ready=false
for i in {1..18}; do
    # Check if the app process is alive and check for RN thread startup signal
    rn_signal=$(adb shell logcat -d -t 500 2>/dev/null | grep -E '(Running application|ReactInstanceManager|js_thread|jsinspector|AppRegistry)' | tail -5)
    if [[ -n "$rn_signal" ]]; then
        echo "✓ React Native JS thread signal detected: $rn_signal"
        rn_ready=true
        break
    fi
    echo "Attempt $i/18: Waiting for React Native JS thread... (5s)"
    sleep 5
done

if [ "$rn_ready" = false ]; then
    echo "⚠️ React Native JS thread signal not detected in logcat. The JS bundle may not have loaded."
    echo "📋 Recent logcat output:"
    adb shell logcat -d -t 100 2>/dev/null | tail -30
    echo "Continuing anyway - Appium waitForDisplayed will handle the timeout."
else
    echo "✓ App is rendering. Waiting 10s more for UI to stabilize..."
    sleep 10
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

# Kill background dismisser process
kill $DISMISSER_PID 2>/dev/null

# Kill Appium background process
kill $APPIUM_PID 2>/dev/null

exit $TEST_EXIT_CODE
