const fs = require('fs');
const path = require('path');

function generateSummary() {
  console.log('=== Generating GitHub Step Summary ===');

  const jsonlPath = path.join(__dirname, '../.wdio-results.jsonl');
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let passRate = 0;

  if (fs.existsSync(jsonlPath)) {
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() !== '');
      total = lines.Count || lines.length;
      
      lines.forEach(line => {
        try {
          const result = JSON.parse(line);
          if (result.status === 'PASSED') {
            passed++;
          } else if (result.status === 'FAILED') {
            failed++;
          } else if (result.status === 'SKIPPED') {
            skipped++;
          }
        } catch (e) {
          // ignore parse error
        }
      });
      
      passRate = total > 0 ? Math.round((passed / total) * 100 * 10) / 10 : 0;
    } catch (err) {
      console.error('Failed to read .wdio-results.jsonl:', err);
    }
  } else {
    console.log('.wdio-results.jsonl not found. Standard summary defaults will be used.');
  }

  // Calculate execution time
  let elapsedStr = 'unknown';
  const startTimeStr = process.env.JOB_START_TIME;
  if (startTimeStr) {
    try {
      // startTimeStr is in Format "yyyy-MM-dd HH:mm:ss"
      // Let's parse it safely
      const parts = startTimeStr.split(' ');
      const dateParts = parts[0].split('-');
      const timeParts = parts[1].split(':');
      const startTime = new Date(
        parseInt(dateParts[0]),
        parseInt(dateParts[1]) - 1,
        parseInt(dateParts[2]),
        parseInt(timeParts[0]),
        parseInt(timeParts[1]),
        parseInt(timeParts[2])
      );
      const elapsedMs = new Date() - startTime;
      const elapsedMin = Math.floor(elapsedMs / 1000 / 60);
      const elapsedSec = Math.floor((elapsedMs / 1000) % 60);
      elapsedStr = `${elapsedMin}m ${elapsedSec}s`;
    } catch (e) {
      console.warn('Failed to parse start time:', e);
    }
  }

  // Collect status values
  let deviceName = process.env.DEVICE_NAME || 'emulator-5554';
  let androidVer = process.env.ANDROID_VERSION || 'unknown';
  let appiumVersion = 'unknown';

  const metaPath = path.join(__dirname, '../test-results/.run-meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.device) deviceName = meta.device;
      if (meta.androidVersion) androidVer = meta.androidVersion;
      if (meta.appiumVersion) appiumVersion = meta.appiumVersion;
    } catch (e) {
      console.warn('Failed to parse .run-meta.json:', e);
    }
  }

  const apkStatus = process.env.APK_STATUS || 'Reused (Cached)';
  const appiumStatus = process.env.APPIUM_STATUS || (appiumVersion !== 'unknown' ? `Active (${appiumVersion})` : 'Reused (Already Running)');
  const emulatorStatus = process.env.EMULATOR_STATUS || 'Reused (Already Running)';
  const buildNum = process.env.GITHUB_RUN_NUMBER || 'Local';
  const branch = process.env.GITHUB_REF_NAME || 'main';
  const commitSha = process.env.GITHUB_SHA || 'unknown';
  const runId = process.env.GITHUB_RUN_ID || '';

  // Determine overall build status
  let buildStatus = '🟢 Success';
  if (failed > 0 || total === 0) {
    buildStatus = '🔴 Failure';
  }

  // Print text summary to console
  console.log(`  Total Tests : ${total}`);
  console.log(`  Passed      : ${passed}`);
  console.log(`  Failed      : ${failed}`);
  console.log(`  Pass Rate   : ${passRate}%`);
  console.log(`  Time Elapsed: ${elapsedStr}`);

  // Construct Markdown
  const markdown = `# 📱 TripSync Android E2E Results

| Metric | Status / Value |
| :--- | :--- |
| 🟢 **Build Status** | ${buildStatus} |
| 📦 **APK Status** | ${apkStatus} |
| 🤖 **Appium Status** | ${appiumStatus} |
| 📱 **Device** | ${deviceName} |
| 📱 **Android Version** | ${androidVer} |
| 🧪 **Total Tests** | ${total} |
| ✅ **Passed** | ${passed} |
| ❌ **Failed** | ${failed} |
| ⏭️ **Skipped** | ${skipped} |
| 📈 **Pass Rate** | ${passRate}% |
| ⏱️ **Execution Time** | ${elapsedStr} |
| 🔢 **Build Number** | #${buildNum} |
| 🌿 **Branch** | ${branch} |
| 📝 **Commit SHA** | \`${commitSha}\` |

## 📄 Artifacts & Reports
- 📊 **Excel Test Report:** [TripSync_Android_TestReport.xlsx](https://github.com/abineshh502/TripSyncApp/actions/runs/${runId}) (Artifacts)
- 🌐 **HTML Execution Report:** [execution-report.html](https://github.com/abineshh502/TripSyncApp/actions/runs/${runId}) (Artifacts)
- 📸 **Screenshots:** Capture-on-failure folder uploaded (Artifacts)
- 📋 **Appium Server Log:** appium.log uploaded (Artifacts)
`;

  // Write to GitHub Step Summary
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    try {
      fs.appendFileSync(summaryFile, markdown, 'utf8');
      console.log('✓ Successfully wrote GITHUB_STEP_SUMMARY');
    } catch (err) {
      console.error('Failed to write to GITHUB_STEP_SUMMARY:', err);
    }
  } else {
    console.log('GITHUB_STEP_SUMMARY environment variable not set. Markdown output:');
    console.log(markdown);
  }
}

generateSummary();
