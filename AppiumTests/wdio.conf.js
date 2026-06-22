const path = require('path');
const fs = require('fs');

// Global array to collect all test results
const testResults = [];

exports.config = {
    runner: 'local',
    port: 4723,
    path: '/',
    specs: [
        './tests/tripsync_android_550.test.js'
    ],
    exclude: [],
    maxInstances: 1,
    capabilities: [{
        platformName: 'Android',
        'appium:deviceName': 'Android Emulator',
        'appium:automationName': 'UiAutomator2',
        'appium:app': process.env.APK_PATH || path.join(__dirname, '../android/app/build/outputs/apk/debug/app-debug.apk'),
        'appium:appPackage': 'com.kondajeswanth.TripSyncApp',
        'appium:appActivity': '.MainActivity',
        'appium:autoGrantPermissions': true,
        'appium:noReset': false,
        'appium:newCommandTimeout': 300,
        'appium:adbExecTimeout': 120000,
        'appium:androidInstallTimeout': 180000,
        'appium:uiautomator2ServerInstallTimeout': 180000,
        'appium:ignoreHiddenApiPolicyError': true
    }],
    logLevel: 'info',
    bail: 0,
    before: async function (capabilities, specs) {
        console.log('====================================================');
        console.log('🔍 VERIFYING APPIUM SESSION CREATION...');
        try {
            const pkg = await browser.getCurrentPackage();
            const act = await browser.getCurrentActivity();
            console.log(`✓ Active Package: ${pkg}`);
            console.log(`✓ Active Activity: ${act}`);
            if (!pkg || !act) {
                throw new Error('Active Package or Activity is empty');
            }
        } catch (e) {
            console.error('❌ ERROR: Appium session verification failed:', e.message);
            process.exit(1);
        }
        console.log('====================================================');
    },
    waitforTimeout: 10000,
    connectionRetryTimeout: 120000,
    connectionRetryCount: 3,
    services: ['appium'],
    framework: 'mocha',
    reporters: ['spec'],
    mochaOpts: {
        ui: 'bdd',
        timeout: 900000 // Large timeout for running 550 tests
    },
    
    onPrepare: function (config, capabilities) {
        // Ensure test-results directory exists
        const dir = path.join(__dirname, '../test-results');
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
    },

    afterTest: function (test, context, { error, result, duration, passed, retries }) {
        // Find test category (describe block name)
        const parentTitle = test.parent || 'General';
        
        // Severity mapping based on test name keywords or default to 'Normal'
        let severity = 'Normal';
        if (test.title.toLowerCase().includes('critical') || test.title.toLowerCase().includes('launch') || test.title.toLowerCase().includes('security')) {
            severity = 'Critical';
        } else if (test.title.toLowerCase().includes('fail') || test.title.toLowerCase().includes('error') || test.title.toLowerCase().includes('negative')) {
            severity = 'High';
        } else if (test.title.toLowerCase().includes('accessibility') || test.title.toLowerCase().includes('color')) {
            severity = 'Minor';
        }

        let status = 'PASS';
        let details = 'Test passed successfully';
        if (!passed) {
            status = 'FAIL';
            details = error ? error.message : 'Test failed';
            
            // Log screenshot on failure
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

        // Collect result details
        testResults.push({
            category: parentTitle,
            name: test.title,
            status: status,
            duration: (duration / 1000).toFixed(2),
            severity: severity,
            details: details.replace(/\n/g, ' '),
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
        });
    },

    onComplete: function(exitCode, config, capabilities, results) {
        // Write the collected results to JSON file
        const resultsFilePath = path.join(__dirname, '../test-results/raw-results.json');
        fs.writeFileSync(resultsFilePath, JSON.stringify(testResults, null, 2));
        console.log(`Saved ${testResults.length} test cases results to raw-results.json`);

        // Run the HTML & Excel report generation script
        try {
            console.log('Generating Excel and HTML reports...');
            const { generateReports } = require('./scripts/generate_reports.js');
            generateReports();
        } catch (e) {
            console.error('Failed to generate reports post-execution:', e);
        }
    }
}
