/**
 * TripSync Appium E2E — HTML Dashboard Reporter
 * Generates a professional dark-themed responsive HTML report.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CATEGORY_ORDER = [
  "Authentication",
  "Trips",
  "Groups",
  "Group Chat",
  "AI Assistant",
  "Maps Explore",
  "Directions & Navigation",
  "Route Builder",
  "Profile & Notifications",
  "UI UX & Accessibility",
  "End-to-End User Journeys",
];

/**
 * Generate the HTML execution report.
 * @param {object[]} results - Array of test result objects
 * @param {object} meta - Run metadata { device, androidVersion, buildNumber, appVersion, appiumVersion, totalDurationMs }
 * @param {string} outputPath - Where to save the HTML file
 */
function generateReport(results, meta, outputPath) {
  if (!outputPath) {
    outputPath = path.resolve(__dirname, "../../test-results/html/execution-report.html");
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const total = results.length;
  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
  const runDate = new Date().toLocaleString();

  // Build category stats
  const catStats = CATEGORY_ORDER.map((cat) => {
    const catR = results.filter((r) => r.category === cat);
    const catPassed = catR.filter((r) => r.status === "PASSED").length;
    const catFailed = catR.filter((r) => r.status === "FAILED").length;
    const catTotal = catR.length;
    const catRate = catTotal > 0 ? ((catPassed / catTotal) * 100).toFixed(0) : 0;
    return { cat, catPassed, catFailed, catTotal, catRate };
  });

  // Failed tests for detail section
  const failedTests = results.filter((r) => r.status === "FAILED");

  const categoryRows = catStats
    .map(
      ({ cat, catPassed, catFailed, catTotal, catRate }) => `
    <tr>
      <td>${cat}</td>
      <td>${catTotal}</td>
      <td class="pass">${catPassed}</td>
      <td class="fail">${catFailed}</td>
      <td>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${catRate}%;background:${Number(catRate) >= 80 ? "#22C55E" : Number(catRate) >= 50 ? "#EAB308" : "#EF4444"}"></div>
        </div>
        <span class="${Number(catRate) >= 80 ? "pass" : "fail"}">${catRate}%</span>
      </td>
    </tr>`
    )
    .join("");

  const failedRows = failedTests
    .map(
      (r) => `
    <div class="fail-card">
      <div class="fail-header">
        <span class="badge-fail">FAILED</span>
        <strong>${escHtml(r.name)}</strong>
        <span class="cat-badge">${escHtml(r.category)}</span>
        <span class="duration">${r.durationMs}ms</span>
      </div>
      <pre class="stack">${escHtml(r.failureReason || "No error message captured")}</pre>
      ${r.screenshotPath ? `<div class="screenshot-label">📸 ${escHtml(r.screenshotPath)}</div>` : ""}
    </div>`
    )
    .join("");

  const allResultRows = results
    .map(
      (r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escHtml(r.name)}</td>
      <td><span class="badge-${r.status === "PASSED" ? "pass" : r.status === "FAILED" ? "fail" : "skip"}">${r.status}</span></td>
      <td>${escHtml(r.category)}</td>
      <td>${r.durationMs}ms</td>
      <td class="small">${escHtml(r.timestamp ? r.timestamp.substring(11, 19) : "")}</td>
    </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TripSync Android E2E — Execution Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0F172A;color:#E2E8F0;min-height:100vh}
  a{color:#38BDF8}
  h1{font-size:28px;font-weight:800;color:#38BDF8;margin-bottom:4px}
  h2{font-size:18px;font-weight:700;color:#94A3B8;margin:28px 0 14px;border-bottom:1px solid #1E293B;padding-bottom:8px}
  .container{max-width:1300px;margin:0 auto;padding:24px}
  .header-bar{background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);border-bottom:1px solid #334155;padding:20px 32px;display:flex;align-items:center;gap:16px}
  .header-bar .logo{font-size:32px}
  .subtitle{color:#64748B;font-size:13px;margin-top:2px}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:28px}
  .meta-card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:16px}
  .meta-card .label{color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px}
  .meta-card .value{font-size:16px;font-weight:700;color:#E2E8F0}
  .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:28px}
  .kpi{background:#1E293B;border:1px solid #334155;border-radius:16px;padding:20px;text-align:center;transition:.2s}
  .kpi:hover{border-color:#38BDF8;transform:translateY(-2px)}
  .kpi .num{font-size:36px;font-weight:900;line-height:1}
  .kpi .lbl{font-size:12px;color:#64748B;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}
  .kpi.total .num{color:#38BDF8}
  .kpi.pass-kpi .num{color:#22C55E}
  .kpi.fail-kpi .num{color:#EF4444}
  .kpi.skip-kpi .num{color:#EAB308}
  .kpi.rate-kpi .num{color:${Number(passRate) >= 80 ? "#22C55E" : "#EAB308"}}
  table{width:100%;border-collapse:collapse;background:#1E293B;border-radius:12px;overflow:hidden;margin-bottom:20px;font-size:13px}
  th{background:#0F172A;color:#94A3B8;padding:12px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  td{padding:10px 14px;border-bottom:1px solid #0F172A}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(56,189,248,.04)}
  .pass{color:#22C55E;font-weight:700}
  .fail{color:#EF4444;font-weight:700}
  .skip-kpi .num,.skip{color:#EAB308}
  .small{font-size:11px;color:#64748B}
  .progress-bar{background:#0F172A;border-radius:6px;height:8px;width:120px;display:inline-block;vertical-align:middle;margin-right:8px;overflow:hidden}
  .progress-fill{height:100%;border-radius:6px;transition:width .4s}
  .badge-pass{background:rgba(34,197,94,.15);color:#22C55E;border:1px solid rgba(34,197,94,.3);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .badge-fail{background:rgba(239,68,68,.15);color:#EF4444;border:1px solid rgba(239,68,68,.3);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .badge-skip{background:rgba(234,179,8,.15);color:#EAB308;border:1px solid rgba(234,179,8,.3);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700}
  .cat-badge{background:#0F172A;color:#94A3B8;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px}
  .fail-card{background:#1E293B;border:1px solid rgba(239,68,68,.3);border-radius:12px;padding:16px;margin-bottom:12px}
  .fail-header{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
  .duration{color:#64748B;font-size:11px;margin-left:auto}
  .stack{background:#0F172A;border:1px solid #334155;border-radius:8px;padding:12px;font-size:12px;color:#FCA5A5;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
  .screenshot-label{margin-top:8px;font-size:11px;color:#64748B}
  .empty-fail{color:#334155;text-align:center;padding:32px;font-size:15px}
  .footer{text-align:center;color:#334155;font-size:12px;margin-top:40px;padding-top:20px;border-top:1px solid #1E293B}
  @media(max-width:900px){.kpi-grid{grid-template-columns:repeat(3,1fr)}.meta-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="header-bar">
  <div class="logo">✈️</div>
  <div>
    <h1>TripSync Android E2E</h1>
    <div class="subtitle">Execution Report · ${runDate} · Self-Hosted Runner</div>
  </div>
</div>

<div class="container">

  <!-- KPI Cards -->
  <div class="kpi-grid" style="margin-top:24px">
    <div class="kpi total"><div class="num">${total}</div><div class="lbl">Total Tests</div></div>
    <div class="kpi pass-kpi"><div class="num">${passed}</div><div class="lbl">Passed ✅</div></div>
    <div class="kpi fail-kpi"><div class="num">${failed}</div><div class="lbl">Failed ❌</div></div>
    <div class="kpi skip-kpi"><div class="num">${skipped}</div><div class="lbl">Skipped ⚠️</div></div>
    <div class="kpi rate-kpi"><div class="num">${passRate}%</div><div class="lbl">Pass Rate</div></div>
  </div>

  <!-- Device Info -->
  <h2>Device & Environment</h2>
  <div class="meta-grid">
    <div class="meta-card"><div class="label">Device</div><div class="value">${escHtml(meta.device || "N/A")}</div></div>
    <div class="meta-card"><div class="label">Android Version</div><div class="value">${escHtml(meta.androidVersion || "N/A")}</div></div>
    <div class="meta-card"><div class="label">App Version</div><div class="value">${escHtml(meta.appVersion || "1.0.0")}</div></div>
    <div class="meta-card"><div class="label">Build Number</div><div class="value">${escHtml(meta.buildNumber || "N/A")}</div></div>
    <div class="meta-card"><div class="label">Appium Version</div><div class="value">${escHtml(meta.appiumVersion || "2.x")}</div></div>
    <div class="meta-card"><div class="label">Total Duration</div><div class="value">${meta.totalDurationMs ? Math.round(meta.totalDurationMs / 1000) + "s" : "N/A"}</div></div>
  </div>

  <!-- Category Stats -->
  <h2>Category Results</h2>
  <table>
    <thead><tr><th>Category</th><th>Total</th><th>Passed</th><th>Failed</th><th>Pass Rate</th></tr></thead>
    <tbody>${categoryRows}</tbody>
  </table>

  <!-- Failure Details -->
  <h2>Failure Details (${failed} failed)</h2>
  ${failedTests.length === 0
    ? '<div class="empty-fail">🎉 No failures detected in this run!</div>'
    : failedRows}

  <!-- All Results Table -->
  <h2>All Test Results</h2>
  <table>
    <thead><tr><th>#</th><th>Test Name</th><th>Status</th><th>Category</th><th>Duration</th><th>Time</th></tr></thead>
    <tbody>${allResultRows}</tbody>
  </table>

  <div class="footer">
    TripSync Android E2E Automation Framework · Generated ${runDate}<br>
    Real Appium Execution · Self-Hosted Windows Runner · ${total} Tests
  </div>
</div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, "utf-8");
  console.log(`[htmlReporter] Report saved: ${outputPath}`);
  return outputPath;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = { generateReport };
