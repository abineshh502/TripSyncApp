const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const excelPath = path.resolve(__dirname, "../../test-results/TripSync_Android_TestReport.xlsx");
const htmlPath = path.resolve(__dirname, "../../test-results/html/execution-report.html");

async function verify() {
  console.log("=== REPORT ROW COUNT VERIFIER ===");

  // 1. Verify Excel
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);
  let totalExcelRows = 0;
  
  // "Overview" sheet is workbook.worksheets[0] (or check by name)
  const overviewSheet = workbook.getWorksheet("Overview");
  const detailSheet = workbook.getWorksheet("UI UX & Accessibility");
  
  workbook.worksheets.forEach(ws => {
    if (ws.name !== "Overview") {
      // Subtract header row (row 1)
      const testRows = ws.rowCount > 0 ? ws.rowCount - 1 : 0;
      totalExcelRows += testRows;
      console.log(`  Excel Sheet [${ws.name}]: ${testRows} test rows`);
    }
  });

  // 2. Verify HTML
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");
  // Count matches of <tr class="test-row"
  const htmlMatches = (htmlContent.match(/class="test-row"/g) || []).length;
  console.log(`  HTML report test rows: ${htmlMatches}`);

  console.log(`\nVerification results:`);
  console.log(`  Excel Total Test Rows: ${totalExcelRows}`);
  console.log(`  HTML Total Test Rows: ${htmlMatches}`);
  
  if (totalExcelRows === 50 && htmlMatches === 50) {
    console.log("\n✅ VERIFICATION SUCCESSFUL: Both reports contain exactly 50 test rows matching the single-spec run.");
  } else {
    console.error(`\n❌ VERIFICATION FAILED: Row count mismatch! Expected 50, got Excel=${totalExcelRows}, HTML=${htmlMatches}`);
    process.exit(1);
  }
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});
