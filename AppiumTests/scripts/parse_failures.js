const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../../reports-extracted/test-results/html/execution-report.html');
if (!fs.existsSync(htmlPath)) {
  console.error("HTML report not found at:", htmlPath);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// Match fail cards:
// <div class="fail-card">
//   <div class="fail-header">
//     <span class="badge-fail">FAILED</span>
//     <strong>(TEST_ID) (TEST_NAME)</strong>
// ...
// <strong>Spec:</strong> (SPEC_FILE) | <strong>Suite:</strong> (SUITE_NAME)

const regex = /<div class="fail-card">[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?<strong>Spec:<\/strong>\s*([^|\s]+)\s*\|\s*<strong>Suite:<\/strong>\s*([^\n<]+)/g;
let match;
const failures = [];

while ((match = regex.exec(html)) !== null) {
  failures.push({
    testName: match[1].trim(),
    spec: match[2].trim(),
    suite: match[3].trim()
  });
}

console.log(`Found ${failures.length} failed tests:`);
failures.forEach((f, i) => {
  console.log(`${i+1}. [${f.spec}] ${f.testName} (Suite: ${f.suite})`);
});
