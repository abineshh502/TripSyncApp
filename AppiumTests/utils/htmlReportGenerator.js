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
  const notExecuted = results.filter((r) => r.status === "NOT EXECUTED").length;
  const totalSkipped = skipped + notExecuted;
  
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
  const runDate = new Date().toLocaleString();

  // Specs calculations
  const allSpecs = [...new Set(results.map((r) => r.specFile))].filter(Boolean);
  const totalSpecs = allSpecs.length;
  
  // A spec is "executed" if it contains at least one test that wasn't skipped or not-executed
  const executedSpecsList = allSpecs.filter((spec) => {
    const specTests = results.filter((r) => r.specFile === spec);
    return specTests.some((t) => t.status === "PASSED" || t.status === "FAILED");
  });
  const executedSpecs = executedSpecsList.length;
  const skippedSpecs = totalSpecs - executedSpecs;

  // Suites calculation
  const totalSuites = [...new Set(results.map((r) => r.suite))].filter(Boolean).length;

  // Build category stats
  const catStats = CATEGORY_ORDER.map((cat) => {
    const catR = results.filter((r) => r.category === cat);
    const catPassed = catR.filter((r) => r.status === "PASSED").length;
    const catFailed = catR.filter((r) => r.status === "FAILED").length;
    const catSkipped = catR.filter((r) => r.status === "SKIPPED" || r.status === "NOT EXECUTED").length;
    const catTotal = catR.length;
    const catRate = catTotal > 0 ? ((catPassed / catTotal) * 100).toFixed(0) : 0;
    return { cat, catPassed, catFailed, catSkipped, catTotal, catRate };
  });

  // Group failures by category for summary diagnostics
  const failedTests = results.filter((r) => r.status === "FAILED");
  
  const categoryRows = catStats
    .map(
      ({ cat, catPassed, catFailed, catSkipped, catTotal, catRate }) => `
    <tr>
      <td><strong>${cat}</strong></td>
      <td>${catTotal}</td>
      <td class="pass">${catPassed}</td>
      <td class="fail">${catFailed}</td>
      <td class="skip">${catSkipped}</td>
      <td>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${catRate}%;background:${Number(catRate) >= 80 ? "#22C55E" : Number(catRate) >= 50 ? "#EAB308" : "#EF4444"}"></div>
        </div>
        <span class="${Number(catRate) >= 80 ? "pass" : "fail"}" style="font-size: 11px; font-weight: bold;">${catRate}%</span>
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
      <div style="font-size: 11px; color: #94A3B8; margin-bottom: 8px;">
        <strong>Spec:</strong> ${escHtml(r.specFile)} | <strong>Suite:</strong> ${escHtml(r.suite)}
      </div>
      <pre class="stack">${escHtml(r.failureReason || "No error message captured")}</pre>
      ${r.screenshotPath ? `
        <div class="screenshot-box">
          <div class="screenshot-label">📸 Screenshot: ${escHtml(path.basename(r.screenshotPath))}</div>
          <a href="../screenshots/${escHtml(path.basename(r.screenshotPath))}" target="_blank">
            <img class="screenshot-img" src="../screenshots/${escHtml(path.basename(r.screenshotPath))}" alt="Failure Screenshot" />
          </a>
        </div>
      ` : ""}
    </div>`
    )
    .join("");

  const allResultRows = results
    .map(
      (r, i) => `
    <tr class="test-row" data-status="${r.status}">
      <td>${i + 1}</td>
      <td>
        <strong>${escHtml(r.name)}</strong>
        <div class="sub-text">${escHtml(r.suite)} (${escHtml(r.specFile)})</div>
      </td>
      <td><span class="badge-${r.status === "PASSED" ? "pass" : r.status === "FAILED" ? "fail" : "skip"}">${r.status}</span></td>
      <td>${escHtml(r.category)}</td>
      <td>${r.durationMs}ms</td>
      <td class="small">${escHtml(r.timestamp ? r.timestamp.substring(11, 19) : "")}</td>
    </tr>`
    )
    .join("");

  // Chart computations (SVG pie chart)
  const passAngle = (passed / total) * 360 || 0;
  const failAngle = (failed / total) * 360 || 0;
  const skipAngle = (totalSkipped / total) * 360 || 0;

  // Coordinates for pie chart sectors
  let currentAngle = 0;
  function getCoordinatesForPercent(percent) {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TripSync Android E2E — Dashboard Report</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Outfit',system-ui,-apple-system,sans-serif;background:#0B0F19;color:#F1F5F9;min-height:100vh}
  a{color:#38BDF8;text-decoration:none}
  a:hover{text-decoration:underline}
  h1{font-size:32px;font-weight:800;background:linear-gradient(to right,#38BDF8,#818CF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  h2{font-size:20px;font-weight:700;color:#94A3B8;margin:32px 0 16px;border-bottom:1px solid #1E293B;padding-bottom:10px;display:flex;align-items:center;gap:8px}
  .container{max-width:1400px;margin:0 auto;padding:32px}
  
  /* Header section */
  .header-bar{background:#111827;border-bottom:1px solid #1F2937;padding:24px 40px;display:flex;align-items:center;justify-content:space-between;border-radius:16px;margin-bottom:32px;box-shadow:0 10px 15px -3px rgba(0,0,0,0.3)}
  .header-info{display:flex;align-items:center;gap:18px}
  .header-logo{font-size:40px;background:rgba(56,189,248,0.1);padding:10px;border-radius:12px}
  .subtitle{color:#6B7280;font-size:14px;margin-top:4px}
  
  /* Layout columns */
  .dashboard-grid{display:grid;grid-template-columns:3fr 1fr;gap:32px;margin-bottom:32px}
  
  /* KPI Cards */
  .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:32px}
  .kpi{background:#1E293B;border:1px solid #334155;border-radius:18px;padding:24px;text-align:center;transition:all 0.3s cubic-bezier(0.4,0,0.2,1);box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}
  .kpi:hover{border-color:#38BDF8;transform:translateY(-4px);box-shadow:0 12px 20px -3px rgba(56,189,248,0.15)}
  .kpi .num{font-size:40px;font-weight:800;line-height:1}
  .kpi .lbl{font-size:12px;color:#94A3B8;margin-top:8px;text-transform:uppercase;letter-spacing:1px;font-weight:600}
  .kpi.total{background:linear-gradient(135deg,#1E293B 0%,#0F172A 100%)}
  .kpi.total .num{color:#38BDF8}
  .kpi.pass-kpi{background:linear-gradient(135deg,#1E293B 0%,#062F19 100%)}
  .kpi.pass-kpi .num{color:#22C55E}
  .kpi.fail-kpi{background:linear-gradient(135deg,#1E293B 0%,#450A0A 100%)}
  .kpi.fail-kpi .num{color:#EF4444}
  .kpi.skip-kpi{background:linear-gradient(135deg,#1E293B 0%,#3C300E 100%)}
  .kpi.skip-kpi .num{color:#EAB308}
  .kpi.rate-kpi{background:linear-gradient(135deg,#1E293B 0%,#1F1E3D 100%)}
  .kpi.rate-kpi .num{color:#818CF8}
  
  /* Environment cards */
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  .meta-card{background:#111827;border:1px solid #1F2937;border-radius:14px;padding:18px;display:flex;flex-direction:column;justify-content:center}
  .meta-card .label{color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;font-weight:600}
  .meta-card .value{font-size:16px;font-weight:700;color:#F3F4F6}
  
  /* Tables */
  table{width:100%;border-collapse:collapse;background:#111827;border-radius:16px;overflow:hidden;margin-bottom:32px;border:1px solid #1F2937;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}
  th{background:#1F2937;color:#9CA3AF;padding:16px 20px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:700;border-bottom:1px solid #374151}
  td{padding:14px 20px;border-bottom:1px solid #1F2937;font-size:14px;color:#D1D5DB}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(56,189,248,0.02)}
  .pass{color:#22C55E;font-weight:700}
  .fail{color:#EF4444;font-weight:700}
  .skip{color:#EAB308;font-weight:700}
  .sub-text{font-size:11px;color:#6B7280;margin-top:2px}
  
  /* Progress Bars */
  .progress-bar{background:#1F2937;border-radius:8px;height:10px;width:130px;display:inline-block;vertical-align:middle;margin-right:10px;overflow:hidden}
  .progress-fill{height:100%;border-radius:8px;transition:width 0.6s ease-out}
  
  /* Status Badges */
  .badge-pass{background:rgba(34,197,94,0.12);color:#4ADE80;border:1px solid rgba(34,197,94,0.3);padding:4px 12px;border-radius:24px;font-size:11px;font-weight:700;letter-spacing:0.5px}
  .badge-fail{background:rgba(239,68,68,0.12);color:#F87171;border:1px solid rgba(239,68,68,0.3);padding:4px 12px;border-radius:24px;font-size:11px;font-weight:700;letter-spacing:0.5px}
  .badge-skip{background:rgba(234,179,8,0.12);color:#FACC15;border:1px solid rgba(234,179,8,0.3);padding:4px 12px;border-radius:24px;font-size:11px;font-weight:700;letter-spacing:0.5px}
  .cat-badge{background:#1F2937;color:#9CA3AF;padding:2px 10px;border-radius:12px;font-size:11px;margin-left:8px;border:1px solid #374151}
  
  /* Failures Section */
  .fail-card{background:#111827;border:1px solid rgba(239,68,68,0.25);border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 10px rgba(239,68,68,0.05);transition:border-color 0.2s}
  .fail-card:hover{border-color:rgba(239,68,68,0.5)}
  .fail-header{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
  .duration{color:#6B7280;font-size:12px;margin-left:auto;font-weight:600}
  .stack{background:#0B0F19;border:1px solid #1F2937;border-radius:10px;padding:16px;font-family:'Courier New',Courier,monospace;font-size:13px;color:#FCA5A5;overflow-x:auto;white-space:pre-wrap;word-break:break-all;line-height:1.5}
  
  /* Screenshots */
  .screenshot-box{margin-top:16px;border:1px solid #1F2937;border-radius:12px;padding:12px;background:#0B0F19}
  .screenshot-label{font-size:12px;color:#6B7280;margin-bottom:8px;font-weight:600}
  .screenshot-img{max-width:350px;max-height:600px;border-radius:8px;border:1px solid #374151;transition:transform 0.2s}
  .screenshot-img:hover{transform:scale(1.02)}
  .empty-fail{background:#111827;border:1px solid #1F2937;text-align:center;padding:48px;border-radius:16px;font-size:16px;color:#9CA3AF}
  
  /* Search & Filter Controls */
  .table-controls{background:#111827;border:1px solid #1F2937;padding:20px 24px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:between;gap:16px;flex-wrap:wrap;border-bottom:none}
  .search-input{background:#0B0F19;border:1px solid #1F2937;padding:10px 18px;border-radius:10px;color:#F3F4F6;font-size:14px;width:300px;outline:none;transition:border-color 0.2s}
  .search-input:focus{border-color:#38BDF8}
  .filter-btn{background:#1F2937;border:1px solid #374151;color:#9CA3AF;padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s}
  .filter-btn:hover{background:#374151;color:#F3F4F6}
  .filter-btn.active{background:#38BDF8;color:#0B0F19;border-color:#38BDF8}
  
  /* Pie Chart card */
  .chart-card{background:#111827;border:1px solid #1F2937;border-radius:16px;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1)}
  .pie-chart{transform:rotate(-90deg);border-radius:50%;width:180px;height:180px;margin-bottom:20px}
  .chart-legend{width:100%}
  .legend-item{display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:8px}
  .legend-color{width:12px;height:12px;border-radius:3px;display:inline-block;margin-right:8px}
  
  .footer{text-align:center;color:#4B5563;font-size:13px;margin-top:60px;padding-top:24px;border-top:1px solid #1F2937}
  @media(max-width:1100px){.dashboard-grid{grid-template-columns:1fr}.kpi-grid{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:700px){.kpi-grid{grid-template-columns:1fr 1fr}.table-controls{flex-direction:column;align-items:stretch}}
</style>
</head>
<body>
<div class="container">
  
  <!-- Header Banner -->
  <div class="header-bar">
    <div class="header-info">
      <div class="header-logo">✈️</div>
      <div>
        <h1>TripSync Android E2E</h1>
        <div class="subtitle">Execution Dashboard · ${runDate} · Self-Hosted Windows Runner</div>
      </div>
    </div>
    <div style="text-align:right">
      <span style="font-size:12px;color:#6B7280">SPEC RUN</span><br>
      <strong style="color:#E5E7EB;font-size:14px">${totalSpecs} specs (${executedSpecs} executed, ${skippedSpecs} skipped)</strong>
    </div>
  </div>

  <!-- KPI Cards -->
  <div class="kpi-grid">
    <div class="kpi total"><div class="num">${total}</div><div class="lbl">Discovered Tests</div></div>
    <div class="kpi pass-kpi"><div class="num">${passed}</div><div class="lbl">Passed ✅</div></div>
    <div class="kpi fail-kpi"><div class="num">${failed}</div><div class="lbl">Failed ❌</div></div>
    <div class="kpi skip-kpi"><div class="num">${totalSkipped}</div><div class="lbl">Skipped/Unrun 🚫</div></div>
    <div class="kpi rate-kpi"><div class="num">${passRate}%</div><div class="lbl">Overall Pass Rate</div></div>
  </div>

  <div class="dashboard-grid">
    <!-- Left Hand: Environment & Category Breakdowns -->
    <div>
      <h2>Device & System Settings</h2>
      <div class="meta-grid" style="margin-bottom:32px">
        <div class="meta-card"><div class="label">Device Name</div><div class="value">${escHtml(meta.device || "N/A")}</div></div>
        <div class="meta-card"><div class="label">Android OS</div><div class="value">Android ${escHtml(meta.androidVersion || "N/A")}</div></div>
        <div class="meta-card"><div class="label">App Version</div><div class="value">${escHtml(meta.appVersion || "1.0.0")}</div></div>
        <div class="meta-card"><div class="label">Build Status</div><div class="value">${escHtml(meta.buildNumber || "N/A")}</div></div>
        <div class="meta-card"><div class="label">Appium Engine</div><div class="value">v${escHtml(meta.appiumVersion || "2.x")}</div></div>
        <div class="meta-card"><div class="label">Elapsed Time</div><div class="value">${meta.totalDurationMs ? Math.round(meta.totalDurationMs / 1000) + "s" : "N/A"}</div></div>
      </div>

      <h2>Category Summary Metrics</h2>
      <table>
        <thead><tr><th>Category Tab</th><th>Expected Tests</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Success Rate</th></tr></thead>
        <tbody>${categoryRows}</tbody>
      </table>
    </div>

    <!-- Right Hand: Visual Charts -->
    <div>
      <h2>Visual Analytics</h2>
      <div class="chart-card">
        <!-- SVG Donut Chart -->
        <svg class="pie-chart" viewBox="-1 -1 2 2">
          <!-- background circle representing skipped/unrun -->
          <circle r="1" cx="0" cy="0" fill="#EAB308" />
          
          <!-- segment for passed -->
          ${(passed > 0 && total > 0) ? `<path d="M 0 0 L 1 0 A 1 1 0 ${passed / total > 0.5 ? 1 : 0} 1 ${getCoordinatesForPercent(passed / total)[0]} ${getCoordinatesForPercent(passed / total)[1]} Z" fill="#22C55E" transform="rotate(0)" />` : ""}
          
          <!-- segment for failed -->
          ${(failed > 0 && total > 0) ? `
            <path d="M 0 0 L ${getCoordinatesForPercent(passed / total)[0]} ${getCoordinatesForPercent(passed / total)[1]} A 1 1 0 ${failed / total > 0.5 ? 1 : 0} 1 ${getCoordinatesForPercent((passed + failed) / total)[0]} ${getCoordinatesForPercent((passed + failed) / total)[1]} Z" fill="#EF4444" />
          ` : ""}
          
          <!-- hole to make it a donut chart -->
          <circle r="0.6" cx="0" cy="0" fill="#111827" />
        </svg>
        <div class="chart-legend">
          <div class="legend-item">
            <div><span class="legend-color" style="background:#22C55E"></span>Passed</div>
            <strong>${passed} (${total > 0 ? ((passed / total) * 100).toFixed(0) : 0}%)</strong>
          </div>
          <div class="legend-item">
            <div><span class="legend-color" style="background:#EF4444"></span>Failed</div>
            <strong>${failed} (${total > 0 ? ((failed / total) * 100).toFixed(0) : 0}%)</strong>
          </div>
          <div class="legend-item">
            <div><span class="legend-color" style="background:#EAB308"></span>Skipped / Unrun</div>
            <strong>${totalSkipped} (${total > 0 ? ((totalSkipped / total) * 100).toFixed(0) : 0}%)</strong>
          </div>
        </div>
      </div>
      
      <div style="background:#111827;border:1px solid #1F2937;border-radius:16px;padding:20px;margin-top:20px;font-size:12px;color:#9CA3AF;line-height:1.5">
        <strong>💡 Insight Dashboard:</strong><br>
        ${failed > 0 
          ? `There are active regression failures in the suite. Scroll down to review failure details, stack traces, and screenshots.` 
          : `Excellent! All executed suites passed. Keep maintaining this level of coverage.`}
      </div>
    </div>
  </div>

  <!-- Failure Details -->
  <h2>Failure Diagnostics (${failed} failed)</h2>
  ${failedTests.length === 0
    ? '<div class="empty-fail">🎉 No failures detected in this run! All executed suites are passing.</div>'
    : failedRows}

  <!-- All Results Table -->
  <h2>Interactive Test Cases Browser (${total} tests)</h2>
  
  <!-- Search Controls -->
  <div class="table-controls">
    <input type="text" id="searchInput" class="search-input" placeholder="Search by test name or category..." onkeyup="filterTable()" />
    <div style="display:flex;gap:8px">
      <button class="filter-btn active" id="btn-all" onclick="setFilter('ALL')">All (${total})</button>
      <button class="filter-btn" id="btn-passed" onclick="setFilter('PASSED')">Passed (${passed})</button>
      <button class="filter-btn" id="btn-failed" onclick="setFilter('FAILED')">Failed (${failed})</button>
      <button class="filter-btn" id="btn-skipped" onclick="setFilter('SKIPPED')">Skipped/Unrun (${totalSkipped})</button>
    </div>
  </div>
  
  <table id="resultsTable">
    <thead>
      <tr>
        <th style="width: 5%">#</th>
        <th style="width: 50%">Test Specification</th>
        <th style="width: 15%">Status</th>
        <th style="width: 15%">Category</th>
        <th style="width: 8%">Duration</th>
        <th style="width: 7%">Time</th>
      </tr>
    </thead>
    <tbody>${allResultRows}</tbody>
  </table>

  <div class="footer">
    TripSync E2E Automation Framework Dashboard · Generated ${runDate}<br>
    Appium Server Engine · Self-Hosted Windows Runner · Total expected ${total} tests
  </div>
</div>

<script>
  let currentStatusFilter = 'ALL';

  function setFilter(status) {
    currentStatusFilter = status;
    
    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (status === 'ALL') document.getElementById('btn-all').classList.add('active');
    else if (status === 'PASSED') document.getElementById('btn-passed').classList.add('active');
    else if (status === 'FAILED') document.getElementById('btn-failed').classList.add('active');
    else if (status === 'SKIPPED') document.getElementById('btn-skipped').classList.add('active');
    
    filterTable();
  }

  function filterTable() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const rows = document.querySelectorAll('.test-row');
    
    rows.forEach(row => {
      const text = row.innerText.toLowerCase();
      const status = row.getAttribute('data-status');
      
      const matchesSearch = text.includes(query);
      
      let matchesStatus = false;
      if (currentStatusFilter === 'ALL') {
        matchesStatus = true;
      } else if (currentStatusFilter === 'PASSED') {
        matchesStatus = (status === 'PASSED');
      } else if (currentStatusFilter === 'FAILED') {
        matchesStatus = (status === 'FAILED');
      } else if (currentStatusFilter === 'SKIPPED') {
        matchesStatus = (status === 'SKIPPED' || status === 'NOT EXECUTED');
      }
      
      if (matchesSearch && matchesStatus) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  }
</script>
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
