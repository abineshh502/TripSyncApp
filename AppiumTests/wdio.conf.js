const path = require('path');
const fs = require('fs');
const xlsxReporter = require('./utils/xlsxReporter');
const htmlReportGenerator = require('./utils/htmlReportGenerator');

exports.config = {
    runner: 'local',
    port: 4723,
    path: '/',
    specs: [
        process.env.WDIO_CI_SPEC || './tests/tripsync_android_550.test.js'
    ],
    exclude: [],
    maxInstances: 1,
    capabilities: [{
        platformName: 'Android',
        'appium:udid': '3085584598000GN',
        'appium:platformName': 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:noReset': true,
        'appium:unicodeKeyboard': true,
        'appium:resetKeyboard': true,
        'appium:settings[waitForIdleTimeout]': 0,
        'appium:appPackage': 'com.kondajeswanth.TripSyncApp',
        'appium:appActivity': '.MainActivity',
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 300,
        'appium:adbExecTimeout': 120000,
        'appium:androidInstallTimeout': 180000,
        'appium:uiautomator2ServerInstallTimeout': 180000,
        'appium:uiautomator2ServerLaunchTimeout': 120000,
        'appium:ignoreHiddenApiPolicyError': true
    }],
    logLevel: 'info',
    bail: 0,
    before: async function (capabilities, specs) {
        console.log('====================================================');
        console.log('🔍 VERIFYING REAL APPIUM SESSION CREATION...');
        try {
            const currentDriver = typeof driver !== 'undefined' ? driver : browser;
            const pkg = await currentDriver.getCurrentPackage();
            const act = await currentDriver.getCurrentActivity();
            const sessionId = currentDriver.sessionId || 'N/A';
            console.log(`✓ Active Package: ${pkg}`);
            console.log(`✓ Active Activity: ${act}`);
            console.log(`✓ Appium Session ID: ${sessionId}`);
            if (!pkg || !act) {
                throw new Error('Active Package or Activity is empty');
            }
            
            // Save session metadata for reports
            const caps = currentDriver.capabilities || {};
            const deviceName = caps.deviceName || caps['appium:deviceName'] || process.env.ANDROID_DEVICE_SERIAL || 'Real Android Device';
            const platformVersion = caps.platformVersion || caps['appium:platformVersion'] || '10';
            
            const metadata = {
                sessionId: sessionId,
                packageName: pkg,
                activityName: act,
                deviceName: deviceName,
                platformVersion: platformVersion
            };
            const metadataPath = path.join(__dirname, '../test-results/session-metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            console.log(`✓ Session metadata saved to ${metadataPath}`);
        } catch (e) {
            console.error('❌ ERROR: Appium session verification failed:', e.message);
            console.error('Appium session creation failed');
            process.exit(1); // Fail immediately
        }
        console.log('====================================================');
    },
    waitforTimeout: 10000,
    connectionRetryTimeout: 300000,
    connectionRetryCount: 3,
    services: [],
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 900000 // Large timeout for 550 tests
    },
    onPrepare: function (config, capabilities) {
        // Validate APK path before starting
        const apkPath = path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk');
        if (!fs.existsSync(apkPath)) {
            throw new Error(`❌ ERROR: Pre-built APK not found at: ${apkPath}. Please build the APK before running tests.`);
        }
        console.log(`✓ APK verified at: ${apkPath}`);

        // Ensure test-results directory exists
        const dir = path.join(__dirname, '../test-results');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        // Initialize results JSONL file
        const resultsJsonl = path.join(__dirname, '../.wdio-results.jsonl');
        if (fs.existsSync(resultsJsonl)) {
            fs.unlinkSync(resultsJsonl);
        }
        xlsxReporter.startRun();
    },
    afterTest: function (test, context, { error, result, duration, passed, retries }) {
        const parentTitle = test.parent || 'General';
        
        let severity = 'Normal';
        if (test.title.toLowerCase().includes('critical') || test.title.toLowerCase().includes('connection') || test.title.toLowerCase().includes('session')) {
            severity = 'Critical';
        } else if (test.title.toLowerCase().includes('fail') || test.title.toLowerCase().includes('error')) {
            severity = 'High';
        } else if (test.title.toLowerCase().includes('accessibility') || test.title.toLowerCase().includes('contrast')) {
            severity = 'Minor';
        }

        let status = 'PASS';
        let details = 'Test passed successfully';
        if (!passed) {
            status = 'FAIL';
            details = error ? error.message : 'Test failed';
            
            // Capture screenshot on failure
            try {
                const tempDir = path.join(__dirname, '../test-results/screenshots');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                const filename = `${test.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`;
                browser.saveScreenshot(path.join(tempDir, filename));
            } catch (screenshotError) {
                console.error('Failed to capture screenshot:', screenshotError.message);
            }
        }

        const testData = {
            category: parentTitle,
            name: test.title,
            status: status,
            duration: (duration / 1000).toFixed(3),
            severity: severity,
            details: details.replace(/\n/g, ' '),
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
        };

        // Write to raw .wdio-results.jsonl
        const resultsJsonl = path.join(__dirname, '../.wdio-results.jsonl');
        fs.appendFileSync(resultsJsonl, JSON.stringify(testData) + '\n');

        // Record in Excel reporter
        xlsxReporter.recordTest(testData);
    },
    onComplete: async function(exitCode, config, capabilities, results) {
        console.log('====================================================');
        console.log('⚙️ GENERATING EXCEL AND HTML REPORTS...');
        
        const excelPath = path.join(__dirname, '../test-results/TripSync_Android_TestReport.xlsx');
        const jsonlPath = path.join(__dirname, '../.wdio-results.jsonl');
        const htmlPath = path.join(__dirname, '../test-results/html/execution-report.html');

        if (!fs.existsSync(jsonlPath) || fs.readFileSync(jsonlPath, 'utf8').trim() === '') {
            console.error('❌ ERROR: No E2E tests were executed. Skipping report generation.');
            console.log('====================================================');
            return;
        }

        // Generate Excel report
        await xlsxReporter.generateReport(excelPath).catch(err => {
            console.error('❌ Failed to write Excel report:', err.message);
        });

        // Generate HTML report
        htmlReportGenerator.generateHtmlReport(jsonlPath, htmlPath);
        
        console.log('✓ Reports successfully compiled.');
        console.log('====================================================');
    }
}
