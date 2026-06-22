const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function generateHtmlReport(jsonlPath, outputPath) {
    console.log(`[HTML Reporter] Reading results from ${jsonlPath}...`);
    if (!fs.existsSync(jsonlPath)) {
        console.error(`[HTML Reporter] Error: Results file not found at ${jsonlPath}`);
        return;
    }

    const fileContent = fs.readFileSync(jsonlPath, 'utf8');
    const testResults = fileContent
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => {
            try {
                return JSON.parse(line);
            } catch (e) {
                console.error('[HTML Reporter] Error parsing line:', line, e.message);
                return null;
            }
        })
        .filter(t => t !== null);

    if (testResults.length === 0) {
        console.error('[HTML Reporter] No test results found.');
        return;
    }

    // Try reading session metadata
    let activePackage = 'com.kondajeswanth.TripSyncApp';
    let activeActivity = '.MainActivity';
    let deviceName = 'Android Emulator';
    let androidVersion = 'Android 10';
    let sessionId = 'N/A';
    
    const metadataPath = path.join(__dirname, '../../test-results/session-metadata.json');
    if (fs.existsSync(metadataPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            activePackage = meta.packageName || activePackage;
            activeActivity = meta.activityName || activeActivity;
            deviceName = meta.deviceName || deviceName;
            androidVersion = meta.platformVersion ? `Android ${meta.platformVersion}` : androidVersion;
            sessionId = meta.sessionId || sessionId;
        } catch (e) {
            console.warn('[HTML Reporter] Could not parse session metadata, using defaults:', e.message);
        }
    }

    const executionDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const buildNumber = process.env.GITHUB_RUN_NUMBER || 'Local-Dev';
    
    let commitSha = process.env.GITHUB_SHA || 'N/A';
    if (commitSha === 'N/A') {
        try {
            commitSha = execSync('git rev-parse --short HEAD').toString().trim();
        } catch (e) {
            commitSha = 'Local-Commit';
        }
    }

    // Summary calculations
    const totalTests = testResults.length;
    const passedTests = testResults.filter(t => t.status === 'PASS').length;
    const failedTests = testResults.filter(t => t.status === 'FAIL').length;
    const warnTests = testResults.filter(t => t.status === 'WARN').length;
    const passRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) : '0.00';

    const categories = [
        'Authentication', 'Trips', 'Groups', 'Group Chat', 'AI Assistant',
        'Maps Explore', 'Directions & Navigation', 'Route Builder',
        'Profile & Notifications', 'UI UX & Accessibility', 'End-to-End User Journeys'
    ];

    const categoryStats = {};
    categories.forEach(cat => {
        const catResults = testResults.filter(t => t.category.includes(cat) || cat.includes(t.category));
        categoryStats[cat] = {
            total: catResults.length,
            passed: catResults.filter(t => t.status === 'PASS').length,
            failed: catResults.filter(t => t.status === 'FAIL').length,
            warn: catResults.filter(t => t.status === 'WARN').length,
            passRate: catResults.length > 0 ? ((catResults.filter(t => t.status === 'PASS').length / catResults.length) * 100).toFixed(1) + '%' : '0%'
        };
    });

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const catLabels = JSON.stringify(categories);
    const catPassed = JSON.stringify(categories.map(c => categoryStats[c].passed));
    const catFailed = JSON.stringify(categories.map(c => categoryStats[c].failed));

    const testCasesJson = JSON.stringify(testResults.map((t, idx) => {
        const catIndex = categories.findIndex(c => t.category.includes(c) || c.includes(t.category));
        const prefix = catIndex !== -1 ? categories[catIndex].substring(0, 4).toUpperCase().trim() : 'TEST';
        const idNumber = String(idx + 1).padStart(3, '0');
        return {
            id: `${prefix}-${idNumber}`,
            category: t.category,
            name: t.name,
            status: t.status,
            duration: t.duration,
            severity: t.severity,
            details: t.details,
            timestamp: t.timestamp
        };
    }));

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TripSync Appium E2E Automation Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-darkest: #020617;
            --bg-dark: #0f172a;
            --bg-card: #1e293b;
            --border: #334155;
            --primary: #38bdf8;
            --primary-hover: #0ea5e9;
            --success: #22c55e;
            --fail: #ef4444;
            --warn: #eab308;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-darkest);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            padding: 24px;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
            margin-bottom: 30px;
        }

        .header-title h1 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 28px;
            letter-spacing: -0.5px;
            margin-bottom: 5px;
        }

        .header-title h1 span {
            color: var(--primary);
        }

        .header-title p {
            color: var(--text-muted);
            font-size: 14px;
        }

        .meta-badges {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .badge {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 6px 16px;
            font-size: 13px;
            font-weight: 600;
            color: var(--text-muted);
        }

        .badge span {
            color: var(--primary);
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .metric-card {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            transition: transform 0.2s;
        }

        .metric-card:hover {
            transform: translateY(-4px);
        }

        .metric-card::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 4px;
            background-color: var(--border);
        }

        .metric-card.total::after { background-color: var(--primary); }
        .metric-card.passed::after { background-color: var(--success); }
        .metric-card.failed::after { background-color: var(--fail); }
        .metric-card.warnings::after { background-color: var(--warn); }

        .metric-label {
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .metric-value {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 40px;
            font-weight: 700;
            line-height: 1;
        }

        .text-success { color: var(--success); }
        .text-fail { color: var(--fail); }
        .text-warn { color: var(--warn); }
        .text-primary { color: var(--primary); }

        .dashboard-row {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 20px;
            margin-bottom: 30px;
        }

        .card {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 24px;
            padding: 24px;
        }

        .card h2 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 18px;
            margin-bottom: 20px;
            border-left: 4px solid var(--primary);
            padding-left: 10px;
        }

        .chart-container {
            position: relative;
            height: 250px;
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .filter-bar {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 16px 24px;
            margin-bottom: 20px;
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            align-items: center;
        }

        .filter-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-group label {
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 600;
        }

        .filter-control {
            background-color: var(--bg-darkest);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-main);
            padding: 8px 14px;
            font-family: inherit;
            font-size: 13px;
            outline: none;
            cursor: pointer;
        }

        .search-control {
            flex: 1;
            min-width: 200px;
            background-color: var(--bg-darkest);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-main);
            padding: 8px 16px;
            font-family: inherit;
            font-size: 13px;
            outline: none;
        }

        .results-container {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 24px;
            overflow: hidden;
            margin-bottom: 30px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }

        th {
            background-color: var(--bg-dark);
            padding: 16px 20px;
            font-size: 13px;
            font-weight: 700;
            color: var(--text-muted);
            border-bottom: 1px solid var(--border);
            text-transform: uppercase;
        }

        td {
            padding: 14px 20px;
            font-size: 14px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover td {
            background-color: rgba(255, 255, 255, 0.02);
        }

        .status-badge {
            border-radius: 8px;
            padding: 4px 10px;
            font-size: 11px;
            font-weight: 700;
            display: inline-block;
        }

        .status-badge.pass { background-color: rgba(34, 197, 94, 0.15); color: var(--success); }
        .status-badge.fail { background-color: rgba(239, 68, 68, 0.15); color: var(--fail); }
        .status-badge.warn { background-color: rgba(234, 179, 8, 0.15); color: var(--warn); }

        .severity-badge {
            border-radius: 6px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--border);
        }

        .severity-badge.critical { border-color: rgba(239, 68, 68, 0.5); color: var(--fail); }
        .severity-badge.high { border-color: rgba(234, 179, 8, 0.5); color: var(--warn); }
        .severity-badge.normal { border-color: var(--border); color: var(--text-muted); }

        .details-text {
            color: var(--text-muted);
            font-size: 13px;
            max-width: 350px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .details-cell {
            position: relative;
        }

        .details-cell:hover .details-tooltip {
            display: block;
        }

        .details-tooltip {
            display: none;
            position: absolute;
            background: var(--bg-darkest);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px;
            z-index: 10;
            width: 250px;
            bottom: 100%;
            left: 0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-size: 12px;
            color: var(--text-main);
            white-space: normal;
        }

        .footer {
            text-align: center;
            padding: 40px 0 20px 0;
            color: var(--text-muted);
            font-size: 12px;
            border-top: 1px solid var(--border);
        }

        @media (max-width: 1024px) {
            .dashboard-row {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <header>
        <div class="header-title">
            <h1>TripSync <span>E2E Results</span></h1>
            <p>Appium Mobile UI Automation Testing & Verification Report</p>
        </div>
        <div class="meta-badges">
            <div class="badge">Run: <span>#${buildNumber}</span></div>
            <div class="badge">Commit: <span>${commitSha}</span></div>
            <div class="badge">OS: <span>${androidVersion}</span></div>
            <div class="badge">Device: <span>${deviceName}</span></div>
            <div class="badge">Package: <span>${activePackage}</span></div>
            <div class="badge">Activity: <span>${activeActivity}</span></div>
        </div>
    </header>

    <main>
        <div class="metrics-grid">
            <div class="metric-card total">
                <span class="metric-label">Total Executed</span>
                <span class="metric-value text-primary">${totalTests}</span>
            </div>
            <div class="metric-card passed">
                <span class="metric-label">Passed Cases</span>
                <span class="metric-value text-success">${passedTests}</span>
            </div>
            <div class="metric-card failed">
                <span class="metric-label">Failed Cases</span>
                <span class="metric-value text-fail">${failedTests}</span>
            </div>
            <div class="metric-card warnings">
                <span class="metric-label">Pass Rate</span>
                <span class="metric-value text-success">${passRate}%</span>
            </div>
        </div>

        <div class="dashboard-row">
            <div class="card">
                <h2>Execution Ratio</h2>
                <div class="chart-container">
                    <canvas id="ratioChart"></canvas>
                </div>
            </div>
            <div class="card">
                <h2>Category Distribution</h2>
                <div class="chart-container">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>
        </div>

        <div class="filter-bar">
            <input type="text" id="searchInput" placeholder="Search test name or details..." class="search-control" onkeyup="filterTests()">
            
            <div class="filter-group">
                <label for="statusFilter">Status:</label>
                <select id="statusFilter" class="filter-control" onchange="filterTests()">
                    <option value="ALL">All Status</option>
                    <option value="PASS">Passed</option>
                    <option value="FAIL">Failed</option>
                    <option value="WARN">Warning</option>
                </select>
            </div>

            <div class="filter-group">
                <label for="categoryFilter">Category:</label>
                <select id="categoryFilter" class="filter-control" onchange="filterTests()">
                    <option value="ALL">All Categories</option>
                    ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                </select>
            </div>

            <div class="filter-group">
                <label for="severityFilter">Severity:</label>
                <select id="severityFilter" class="filter-control" onchange="filterTests()">
                    <option value="ALL">All Severities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Normal">Normal</option>
                    <option value="Minor">Minor</option>
                </select>
            </div>
        </div>

        <div class="results-container">
            <table>
                <thead>
                    <tr>
                        <th width="8%">ID</th>
                        <th width="18%">Category</th>
                        <th width="30%">Test Title</th>
                        <th width="10%">Status</th>
                        <th width="10%">Duration</th>
                        <th width="10%">Severity</th>
                        <th width="14%">Details</th>
                    </tr>
                </thead>
                <tbody id="testTableBody">
                    <!-- Dynamic Rows -->
                </tbody>
            </table>
        </div>
    </main>

    <div class="footer">
        <p>Generated by TripSync CI/CD Appium Test Suite pipeline on ${executionDate}</p>
        <p>&copy; 2026 TripSync QA Department. Premium Travel Analytics.</p>
    </div>

    <script>
        const testCases = ${testCasesJson};

        function renderTable(data) {
            const tbody = document.getElementById('testTableBody');
            tbody.innerHTML = '';
            
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 30px; color: var(--text-muted);">No tests match the filters!</td></tr>';
                return;
            }

            data.forEach(t => {
                const tr = document.createElement('tr');
                tr.innerHTML = \`
                    <td><strong>\${t.id}</strong></td>
                    <td style="color: var(--primary); font-weight:600;">\${t.category}</td>
                    <td>\${t.name}</td>
                    <td><span class="status-badge \${t.status.toLowerCase()}">\${t.status}</span></td>
                    <td style="text-align:right; font-weight:600; padding-right:30px;">\${t.duration}s</td>
                    <td><span class="severity-badge \${t.severity.toLowerCase()}">\${t.severity}</span></td>
                    <td class="details-cell">
                        <div class="details-text">\${t.details}</div>
                        <div class="details-tooltip">\${t.details}</div>
                    </td>
                \`;
                tbody.appendChild(tr);
            });
        }

        function filterTests() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            const status = document.getElementById('statusFilter').value;
            const category = document.getElementById('categoryFilter').value;
            const severity = document.getElementById('severityFilter').value;

            const filtered = testCases.filter(t => {
                const matchesSearch = t.name.toLowerCase().includes(query) || t.details.toLowerCase().includes(query) || t.id.toLowerCase().includes(query);
                const matchesStatus = status === 'ALL' || t.status === status;
                const matchesCategory = category === 'ALL' || t.category.includes(category) || category.includes(t.category);
                const matchesSeverity = severity === 'ALL' || t.severity === severity;
                return matchesSearch && matchesStatus && matchesCategory && matchesSeverity;
            });

            renderTable(filtered);
        }

        renderTable(testCases);

        new Chart(document.getElementById('ratioChart'), {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed', 'Warnings'],
                datasets: [{
                    data: [${passedTests}, ${failedTests}, ${warnTests}],
                    backgroundColor: ['#22c55e', '#ef4444', '#eab308'],
                    borderColor: '#1e293b',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#f8fafc' }
                    }
                }
            }
        });

        new Chart(document.getElementById('categoryChart'), {
            type: 'bar',
            data: {
                labels: ${catLabels},
                datasets: [
                    {
                        label: 'Passed',
                        data: ${catPassed},
                        backgroundColor: '#22c55e'
                    },
                    {
                        label: 'Failed',
                        data: ${catFailed},
                        backgroundColor: '#ef4444'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { 
                        stacked: true,
                        grid: { color: '#334155' },
                        ticks: { color: '#94a3b8', font: { size: 9 } }
                    },
                    y: { 
                        stacked: true,
                        grid: { color: '#334155' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#f8fafc' }
                    }
                }
            }
        });
    </script>
</body>
</html>`;

    fs.writeFileSync(outputPath, htmlContent);
    console.log(`[HTML Reporter] HTML dashboard saved to ${outputPath}`);

    // Generate GitHub Step Summary if running in GitHub Actions
    if (process.env.GITHUB_STEP_SUMMARY) {
        const summaryMarkdown = `# TripSync Android E2E Results 🚀

* **Total Tests:** ${totalTests}
* **Passed:** ✅ ${passedTests}
* **Failed:** ❌ ${failedTests}
* **Warnings:** ⚠️ ${warnTests}
* **Pass Rate:** ${passRate}%
* **Build Number:** ${buildNumber}
* **Commit SHA:** \`${commitSha}\`
* **Device Name:** ${deviceName}
* **Android Version:** ${androidVersion}
* **Active Package:** \`${activePackage}\`
* **Active Activity:** \`${activeActivity}\`
* **Appium Session ID:** \`${sessionId}\`
`;
        fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown);
        console.log('[HTML Reporter] Saved GHA step summary.');
    }
}

module.exports = {
    generateHtmlReport
};
