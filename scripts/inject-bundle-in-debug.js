const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../android/app/build.gradle');

if (!fs.existsSync(file)) {
  console.log('⚠️ android/app/build.gradle does not exist yet (prebuild might have skipped or failed)');
  process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');
if (content.includes('bundleCommand =') && !content.includes('bundleInDebug =')) {
  content = content.replace('bundleCommand = "export:embed"', 'bundleCommand = "export:embed"\n    bundleInDebug = true');
  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Successfully injected bundleInDebug = true into build.gradle');
} else {
  console.log('⚠️ Could not find bundleCommand or bundleInDebug already exists');
}
