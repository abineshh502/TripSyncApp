const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '../../reports-extracted/test-results/html/execution-report.html');
if (!fs.existsSync(htmlPath)) {
  console.error("HTML report not found at:", htmlPath);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');

// Match fail cards detail:
// <div class="fail-card">
//   <div class="fail-header">
//     <span class="badge-fail">FAILED</span>
//     <strong>(TEST_ID) (TEST_NAME)</strong>
// ...
// <pre class="stack">(STACK_TRACE)</pre>

const regex = /<div class="fail-card">[\s\S]*?<strong>([^<]+)<\/strong>[\s\S]*?Spec:<\/strong>\s*([^|\s]+)[\s\S]*?<pre class="stack">([\s\S]*?)<\/pre>/g;
let match;

console.log("Failed Tests Stack Traces:\n" + "═".repeat(60));
while ((match = regex.exec(html)) !== null) {
  const name = match[1].trim();
  const spec = match[2].trim();
  const stack = match[3].trim().split('\n').slice(0, 3).join('\n'); // first 3 lines
  console.log(`Test: [${spec}] ${name}`);
  console.log(`Stack:\n${stack}`);
  console.log("═".repeat(60));
}
